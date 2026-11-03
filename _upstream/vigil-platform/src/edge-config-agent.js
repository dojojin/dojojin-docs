// ============================================================
// Vigil Platform — Edge Config Agent
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// EC2: subscribe _config/cameras from local NanoMQ → write cameras-config.json
// → fs.watch in ingesters triggers live-reload (no restart needed).
// Publishes ack to _config/ack so central can show "applied / pending" status.
//
// Also captures HTTP snapshots from edge cameras (local LAN reachable) and
// publishes them base64-encoded to central via MQTT bridge, so the dashboard
// can display full-scene photos for cameras behind NAT.
//
// Required env:
//   EDGE_SITE_CODE   — site code, e.g. "vss"
//   EDGE_MQTT_BROKER — local broker URL (default: mqtt://localhost:1883)

const mqtt   = require('mqtt');
const fs     = require('fs');
const net    = require('net');
const os     = require('os');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { rebootCamera, supportsReboot } = require('./helpers/cameraReboot');
const { decryptCamCreds }             = require('./crypto-creds');
const { snapPath }                    = require('./snapshot-path');
const { createRetainGate } = require('./helpers/retainGate');
const { assertImageBuffer } = require('./helpers/imageMagic');
const { buildSdDetail } = require('./helpers/hikStorage');
const { boschSdProbe, pushMqttSettings, readTaskNames } = require('./helpers/boschRcp');
const { writeAuthFiles, localBrokerUsersFromEnv, incompleteLocalUserKeys } = require('./helpers/mosquittoAuthFiles');
const { parseChallenge, buildDigestHeader } = require('./helpers/digestAuth');
const { parseChannelTitles } = require('./ingesters/dahua-channels');
const { detectModel } = require('./model-detect');
const metaTrack = require('./helpers/onvifMetaTrack');
const { deleteCameraMedia } = require('./camera-media-delete');
require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
// after dotenv on purpose — the old const above it could never have seen SNAPSHOT_DIR
const { snapshotDir } = require('./helpers/snapshotDir');
const SNAPSHOT_DIR = snapshotDir();

const SITE = process.env.EDGE_SITE_CODE;
if (!SITE) { console.error('[edge-config] EDGE_SITE_CODE not set — exiting'); process.exit(1); }

const CONFIG_PATH = path.resolve(__dirname, '..', 'cameras-config.json');

// Map of camera_id → decrypted camera config (ip, username, password).
// Seeded from existing file so heartbeat + snapshot fire immediately after restart.
function _loadCameraMap() {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const m = {};
    for (const c of (d.cameras || [])) {
      if (c.camera_id) m[c.camera_id] = decryptCamCreds(c);
    }
    return m;
  } catch { return {}; }
}

let _cameraMap = _loadCameraMap();

// E2 (docs/reports/2026-09-27_mosquitto-migration-plan.md §11). Keeps
// ~/.config/vigil/mosquitto.{passwd,acl} in sync with _cameraMap so the
// Mosquitto LAN listener's per-camera ACL never falls behind the config
// this agent already applies everywhere else — no-op on NanoMQ edges.
// Debounced: a config push and the self-heal reload path can both fire in
// the same tick, and hashing + an execFile round trip is not free.
const MOSQUITTO_AUTH_DIR = path.join(os.homedir(), '.config', 'vigil');
let _brokerAuthTimer = null;
function syncBrokerAuth() {
  if (process.env.EDGE_BROKER !== 'mosquitto') return; // read live, not cached — see EDGE_MQTT_BROKER comment above
  if (_brokerAuthTimer) clearTimeout(_brokerAuthTimer);
  _brokerAuthTimer = setTimeout(() => {
    _brokerAuthTimer = null;
    (async () => {
      try {
        // same guard as scripts/edge-sync-broker-auth.js: writing a passwd
        // without this account would lock the local service out on loopback
        const incomplete = incompleteLocalUserKeys(process.env);
        if (incomplete.length) {
          console.warn(`[edge-mosquitto-auth] ข้าม — ${incomplete.join(', ')} มีค่าแต่ไม่มีรหัสคู่กัน`);
          return;
        }
        const r = await writeAuthFiles({
          cameras: Object.values(_cameraMap),
          localUsers: localBrokerUsersFromEnv(process.env), // MQTT_SUBSCRIBER_*/SNAPSHOT_PUBLISHER_* — read live
          dir: MOSQUITTO_AUTH_DIR,
        });
        let reloaded = 'no';
        if (r.changed) {
          reloaded = await new Promise((resolve) => {
            execFile('pm2', ['sendSignal', 'SIGHUP', 'mosquitto'], { timeout: 10_000 },
              (err) => resolve(err ? `failed (${err.message})` : 'yes'));
          });
        }
        const skippedDesc = r.skipped.map((s) => `${s.camera_id}: ${s.reason}`).join('; ');
        console.log(`[edge-mosquitto-auth] users=${r.users.length}${skippedDesc ? ` skipped=[${skippedDesc}]` : ''} reloaded=${reloaded}`);
      } catch (e) {
        console.warn(`[edge-mosquitto-auth] sync failed: ${e.message}`);
      }
    })();
  }, 2000);
}
syncBrokerAuth(); // startup load — cover an edge that boots with EDGE_BROKER=mosquitto and an existing cameras-config.json

const TOPIC_IN  = `projects/${SITE}/_config/cameras`;
const TOPIC_ACK = `projects/${SITE}/_config/ack`;
// NVR channel scan (Phase 3): central publishes a request here (relayed down by
// the bridge); we enumerate the NVR's channels over the LAN and publish the
// reply on _config/scan-result, which rides the normal upstream path to central.
const TOPIC_SCAN        = `projects/${SITE}/_config/scan-nvr`;
const TOPIC_SCAN_RESULT = `projects/${SITE}/_config/scan-result`;
// Model detect (OPT5-EDGE-004): central publishes a request here on camera Save
// (self-contained connection params, same shape as scan-nvr — no _cameraMap
// lookup, so a brand-new/just-edited camera can't lose a race against the
// separate _config/cameras config-apply). Reply on _config/detect-model-result.
const TOPIC_DETECT        = `projects/${SITE}/_config/detect-model`;
const TOPIC_DETECT_RESULT = `projects/${SITE}/_config/detect-model-result`;
// Delete-media (OPT5-EDGE-005): central publishes here after a camera delete
// (keepData=false). Reply on _config/delete-media-result for audit visibility.
// Edge service control (H2, 2026-07-27). Until now the only way to restart a
// process on an edge was to SSH in, which meant nobody did it during an incident
// unless they were at a laptop. Fifth command on the channel the config push,
// NVR scan, model detect and media delete already share.
// Storage scan/purge (2026-08-24) — central มองไม่เห็นว่าดิสก์ของ edge หายไปกับอะไร
// และลบด้วยมือไม่ได้เลย · scan อ่านอย่างเดียว · purge เป็นคำสั่งทำลายจึงต้องผ่าน
// shared secret เหมือน detect-model/delete-media และต้อง dry-run ก่อนทุกครั้ง
const TOPIC_STOR_SCAN         = `projects/${SITE}/_config/storage-scan`;
const TOPIC_STOR_SCAN_RESULT  = `projects/${SITE}/_config/storage-scan-result`;
const TOPIC_STOR_PURGE        = `projects/${SITE}/_config/storage-purge`;
const TOPIC_STOR_PURGE_RESULT = `projects/${SITE}/_config/storage-purge-result`;
const TOPIC_SVC        = `projects/${SITE}/_config/svc`;
// Camera reboot (2026-07-27). Central cannot route to a site LAN, so the actual
// HTTP call has to happen here. Same one-shot request/result shape as the rest.
const TOPIC_REBOOT        = `projects/${SITE}/_config/reboot-device`;
const TOPIC_REBOOT_RESULT = `projects/${SITE}/_config/reboot-device-result`;
// Push MQTT settings into a Bosch camera (Mosquitto migration phase B1,
// decision 6.1 item 4) — same one-shot request/result shape as reboot-device.
// Credentials never travel on the wire: the command carries only camera_id,
// the edge reads mqtt_username/mqtt_password from its own decrypted
// _cameraMap, same reasoning as camera reboot above.
const TOPIC_CAMERA_MQTT        = `projects/${SITE}/_config/camera-mqtt`;
const TOPIC_CAMERA_MQTT_RESULT = `projects/${SITE}/_config/camera-mqtt-result`;
const TOPIC_SVC_RESULT = `projects/${SITE}/_config/svc-result`;
// Allowlist, not validation: an arbitrary name would let anyone who can publish
// stop any process pm2 knows about on a police site.
const SVC_NAMES = new Set(['nanomq', 'mosquitto', 'hikvision', 'dahua', 'lpr-receiver',
                           'edge-config-agent', 'edge-bridge', 'pm2-logrotate']);
const SVC_ACTIONS = new Set(['restart', 'start', 'stop']);
// Stopping any of these severs the very channel this command arrives on, and
// nothing short of a site visit brings it back: nanomq/mosquitto is whichever
// broker the agent listens to (EDGE_BROKER, only one runs at a time — see
// ecosystem.edge.config.js), edge-bridge is the only path to central, and
// edge-config-agent is the listener itself. Restart is fine — each one comes
// back on its own.
const SVC_NO_STOP = new Set(['nanomq', 'mosquitto', 'edge-bridge', 'edge-config-agent']);

const TOPIC_DELETE_MEDIA        = `projects/${SITE}/_config/delete-media`;
const TOPIC_DELETE_MEDIA_RESULT = `projects/${SITE}/_config/delete-media-result`;
const _CHANNEL_TITLE_URI = '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle';

// SEC5-HIGH-003 mitigation (partial): local NanoMQ allows anonymous publish, so
// anyone on the camera LAN can reach TOPIC_DETECT/TOPIC_DELETE_MEDIA. Reusing
// CAMERA_SECRET_KEY (already shared identically Central+every Edge) as a plain
// shared-secret check — not full NanoMQ auth, just gates these two admin/
// destructive command channels specifically. Constant-time compare.
function hasValidCommandSecret(req) {
  const expected = process.env.CAMERA_SECRET_KEY;
  const got = req && req.secret;
  if (!expected || !got || typeof got !== 'string') return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const client = mqtt.connect(process.env.EDGE_MQTT_BROKER || 'mqtt://localhost:1883', {
  clientId: `edge-config-${SITE}-${process.pid}`,
  clean: true,
  reconnectPeriod: 5000,
});

// Live retained detection events vs the broker's replay-on-subscribe (GOTCHAS #103)
const _retainGate = createRetainGate({
  graceMs: parseInt(process.env.RETAIN_REPLAY_GRACE_MS || '5000', 10),
});

client.on('connect', () => {
  console.log(`[edge-config] connected — subscribing config + detection topics`);
  _retainGate.ready();    // เริ่มนับหน้าต่าง replay ใหม่ทุกครั้งที่ต่อใหม่
  _reconcileMetaTracks(); // idempotent — safe on every reconnect
  client.subscribe([TOPIC_IN, TOPIC_SCAN, TOPIC_DETECT, TOPIC_DELETE_MEDIA, TOPIC_SVC, TOPIC_REBOOT, TOPIC_STOR_SCAN, TOPIC_STOR_PURGE, TOPIC_CAMERA_MQTT, '+/onvif-ej/RuleEngine/#'], { qos: 1 }, (err) => {
    if (err) console.error('[edge-config] subscribe failed:', err.message);
  });
});

// Throttle: one snapshot per camera per N ms to avoid flooding on rapid events
const _snapCooldown = new Map();
const SNAP_COOLDOWN_MS = parseInt(process.env.SNAP_COOLDOWN_MS || '3000', 10);

// ONVIF metadata crop (2026-08-19) — opt-in per camera, per edge, default off.
// The full-scene HTTP snapshot is fetched ~0.28s after the trigger and returns a
// LIVE frame, so on fast objects it shows the road after the vehicle has gone;
// separately the camera only embeds its own Appearance.Image crop for slow
// objects (measured on BH5100i_RMUTR-V_01 over 7 days: Person 88%, Car 30%,
// Motorcycle 9.9%). Subscribing to the camera's ONVIF metadata track gives a
// bounding box per tracked ObjectId at ~15Hz, and MQTT events already carry
// @ObjectId — so the snapshot can be cropped to the object that actually
// triggered it. Metadata only, ~2.5 KB/s and 0.2% of a core per camera; the
// video track is never requested.
//
// Switched on per camera from the dashboard (cameras.meta_crop, migration 164)
// and delivered on the same config push as snapshot_mode. It used to be a
// META_CROP_CAMERAS env allow-list, which meant an SSH session per box to
// enable a second camera and nothing visible in the UI.
//
// Bosch-only, enforced HERE and not just in the UI: pointing this at a
// Hikvision would DESCRIBE it on RTSP 554, find no vnd.onvif.metadata track,
// and retry on a backoff forever. Sites with no Bosch cameras (hkt, 20 of
// them) must reconcile to an empty set and do nothing at all.
const META_CROP_PAD   = parseFloat(process.env.META_CROP_PAD || '0.12');
const META_CROP_MINPX = parseInt(process.env.META_CROP_MINPX || '40', 10);

// ── ชดเชยเวลาที่ภาพ "แก่กว่า" นาฬิกาที่เราจับได้ (2026-08-26) ─────────────────
//
// T_snap ที่เราใช้หา metadata คือ Date.now() ตอนไบต์สุดท้ายของ JPEG มาถึง แต่เนื้อภาพ
// เป็นของก่อนหน้านั้น — กล้องต้องถ่าย เข้ารหัส แล้วส่ง ~490KB ข้ามเครือข่ายมาก่อน
// เราจึงไปหยิบ "ตำแหน่งวัตถุ ณ ตอนดาวน์โหลดเสร็จ" มาครอป "ภาพของอดีต"
//
// ผลที่วัดได้จริงที่ vss3 ช่วง 13:25–13:45 (109 ใบ): ครอปได้ถนนเปล่า
//   มอเตอร์ไซค์ 16/75 = 21%   ·   รถยนต์ 0/33 = 0%
// ของเล็กพัง ของใหญ่รอด เพราะกรอบรถยนต์ยาวพอจะยังคาบเกี่ยวหลังเลื่อนไปหลายเมตร
// พิสูจน์: ครอปภาพเต็มใบเดิมที่ตำแหน่งย้อนหลังบนเส้นทางเดิน ใบที่พังได้ sd 14.5–15.5
// (ถนนเรียบ) แต่ย้อนกลับ ~4 ตัวอย่างได้ sd 37–46 (รถเต็มคัน)
//
// ⚠️ ด่าน driftMetres() ที่มีอยู่จับเรื่องนี้ไม่ได้ — มันวัด dtMs = ระยะจาก T_snap ไป
// ตัวอย่าง metadata ที่ใกล้ที่สุด ซึ่งเล็กมากอยู่แล้ว (p50 26ms · p99 101ms จาก 1,677 ใบ)
// คนละปริมาณกับ "T_snap ห่างจากเนื้อภาพเท่าไหร่" ซึ่งไม่เคยมีใครวัด
//
// ค่านี้ขึ้นกับกล้อง/เครือข่ายของแต่ละไซต์ (skew กล้อง→edge ต่างกัน 10 เท่า: vss3 31ms
// vs hdy 316ms) จึงตั้งต่อไซต์ที่ .env — ค่าเริ่มต้น 0 = พฤติกรรมเดิมทุกประการ
const META_SNAP_LAG_MS = parseInt(process.env.META_SNAP_LAG_MS || '0', 10);

// เวลาที่ "เนื้อภาพ" น่าจะถูกถ่ายจริง — ใช้หา metadata เท่านั้น
// ไม่ใช้ตั้งชื่อไฟล์หรือคิดอายุเฟรม เพราะสองอย่างนั้นถามถึงนาฬิกาของเราจริง ๆ
const _snapInstant = (tsMs) => tsMs - META_SNAP_LAG_MS;

function _metaCropWanted(cam) {
  return !!cam && cam.vendor === 'bosch' && cam.meta_crop === true && !!cam.ip_address;
}

// Brings live metadata sessions in line with the config — starts what should be
// running, and stops what should not. A reconcile rather than a start because
// the toggle can now go off at runtime, and a session nobody stops keeps an
// RTSP connection open on the camera indefinitely.
function _reconcileMetaTracks() {
  const wanted = new Set(
    Object.entries(_cameraMap).filter(([, cam]) => _metaCropWanted(cam)).map(([id]) => id)
  );
  for (const id of metaTrack.activeIds()) {
    if (!wanted.has(id)) {
      console.log(`[meta] ${id} ปิดการใช้งาน — หยุด metadata session`);
      metaTrack.stop(id);
    }
  }
  for (const id of wanted) metaTrack.ensure(id, _cameraMap[id], console);
}

// Self-heal: if a detection arrives for a camera not in _cameraMap (config drift —
// process missed a rebuild), reload cameras-config.json from disk. Throttled per
// camera so a genuinely-unknown camera doesn't spam disk reads / logs.
const _unknownCam = new Map();
const UNKNOWN_RELOAD_MS = 30_000;

client.on('message', (topic, buf, packet) => {
  // Config push from central (allow retained — bridge publishes with retain:true so
  // the current config reloads automatically when edge-config-agent restarts)
  if (topic === TOPIC_IN) {
    try {
      const payload = JSON.parse(buf.toString());
      if (!Array.isArray(payload.cameras)) throw new Error('payload.cameras is not an array');

      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ cameras: payload.cameras }, null, 2));
      fs.chmodSync(CONFIG_PATH, 0o600); // SEC5-HIGH-001: contains camera credentials
      _cameraMap = {};
      for (const c of payload.cameras) {
        if (c.camera_id) _cameraMap[c.camera_id] = decryptCamCreds(c);
      }

      client.publish(TOPIC_ACK, JSON.stringify({
        version: payload.version,
        applied_at: new Date().toISOString(),
        ok: true,
      }), { qos: 1 });

      console.log(`[edge-config] applied v${payload.version} — ${payload.cameras.length} cameras`);
      _reconcileMetaTracks(); // a toggle flipped in the dashboard takes effect here, no restart
      syncBrokerAuth(); // Mosquitto only — no-op on NanoMQ
    } catch (e) {
      console.error('[edge-config] apply failed:', e.message);
      client.publish(TOPIC_ACK, JSON.stringify({ ok: false, error: e.message }), { qos: 1 });
    }
    return;
  }

  // NVR channel scan request (Phase 3) — enumerate the NVR over the LAN and
  // reply. The NVR is on this edge's LAN, so we (not central) can reach it.
  if (topic === TOPIC_SCAN) {
    let scanId = null;
    try {
      const req = JSON.parse(buf.toString());
      scanId = req.scan_id || null;
      _fetchJpeg(req.ip_address, req.http_port || 80, _CHANNEL_TITLE_URI,
        req.username || '', req.password || '', (err, body) => {
          if (err) {
            client.publish(TOPIC_SCAN_RESULT, JSON.stringify({ scan_id: scanId, error: err.message }), { qos: 1 });
            console.warn(`[edge-scan] ${req.ip_address}: ${err.message}`);
            return;
          }
          const channels = parseChannelTitles(body.toString('utf8'));
          client.publish(TOPIC_SCAN_RESULT, JSON.stringify({ scan_id: scanId, channels }), { qos: 1 });
          console.log(`[edge-scan] ${req.ip_address} → ${channels.length} channels`);
        });
    } catch (e) {
      client.publish(TOPIC_SCAN_RESULT, JSON.stringify({ scan_id: scanId, error: e.message }), { qos: 1 });
    }
    return;
  }

  // Model detect request (OPT5-EDGE-004) — fired by central on camera Save.
  // Connection params come in the request itself (not looked up from
  // _cameraMap), so this can't race the separate _config/cameras config-apply
  // for a brand-new or just-edited camera.
  if (topic === TOPIC_DETECT) {
    let cameraId = null;
    (async () => {
      try {
        const req = JSON.parse(buf.toString());
        cameraId = req.camera_id || null;
        if (!hasValidCommandSecret(req)) {
          console.warn(`[edge-detect] ${cameraId}: rejected — missing/invalid command secret`);
          return;
        }
        const cam = { ip_address: req.ip_address, username: req.username, vendor: req.vendor };
        const info = await detectModel(cam, req.password || '');
        if (info && info.model) {
          client.publish(TOPIC_DETECT_RESULT, JSON.stringify({
            camera_id: cameraId, model: info.model, firmware: info.firmware, serial: info.serial,
          }), { qos: 1 });
          console.log(`[edge-detect] ${cameraId} (${req.ip_address}) → ${info.model}`);
        } else {
          client.publish(TOPIC_DETECT_RESULT, JSON.stringify({
            camera_id: cameraId, error: 'unreachable, auth failed, or model not recognized',
          }), { qos: 1 });
          console.warn(`[edge-detect] ${cameraId} (${req.ip_address}): no model detected`);
        }
      } catch (e) {
        client.publish(TOPIC_DETECT_RESULT, JSON.stringify({ camera_id: cameraId, error: e.message }), { qos: 1 });
      }
    })();
    return;
  }

  // Delete-media request (OPT5-EDGE-005) — remove a deleted camera's on-disk
  // media from this edge's local snapshot tree. deleteCameraMedia() carries
  // its own reject-then-use validation (rejects '..'/'.'/empty/malformed
  // camera_id outright rather than sanitizing) and exact dir-name matching.
  if (topic === TOPIC_DELETE_MEDIA) {
    let cameraId = null;
    (async () => {
      try {
        const req = JSON.parse(buf.toString());
        cameraId = req.camera_id || null;
        if (!hasValidCommandSecret(req)) {
          console.warn(`[edge-delete-media] ${cameraId}: rejected — missing/invalid command secret`);
          return;
        }
        const r = await deleteCameraMedia(SNAPSHOT_DIR, cameraId);
        if (r.rejected) {
          client.publish(TOPIC_DELETE_MEDIA_RESULT, JSON.stringify({
            camera_id: cameraId, error: 'camera_id rejected (invalid or unsafe)',
          }), { qos: 1 });
          console.warn(`[edge-delete-media] ${cameraId}: rejected`);
        } else {
          client.publish(TOPIC_DELETE_MEDIA_RESULT, JSON.stringify({
            camera_id: cameraId, dirs_removed: r.dirsRemoved,
          }), { qos: 1 });
          console.log(`[edge-delete-media] ${cameraId} → removed ${r.dirsRemoved} date-dir(s)`);
        }
      } catch (e) {
        client.publish(TOPIC_DELETE_MEDIA_RESULT, JSON.stringify({ camera_id: cameraId, error: e.message }), { qos: 1 });
      }
    })();
    return;
  }

  // Storage scan — อ่านอย่างเดียว ไม่ต้องมี secret เพราะไม่เปลี่ยนอะไรบนเครื่อง
  // edge ไม่มี postgres จึงนับ orphan ไม่ได้ ส่งแต่ขนาด/จำนวน/ไฟล์เก่าสุด
  if (topic === TOPIC_STOR_SCAN) {
    (async () => {
      try {
        const { scanAll, getDiskUsage } = require('./helpers/storageScan');
        const t0 = Date.now();
        const results = await scanAll({
          budgetMs: 120000,
          SNAPSHOT_DIR,
          REPORTS_DIR: path.join(__dirname, '..', 'reports'),
          PHOTO_DIR: path.join(__dirname, '..', 'blacklist-photos'),
        });
        const disk = await getDiskUsage(SNAPSHOT_DIR);
        client.publish(TOPIC_STOR_SCAN_RESULT, JSON.stringify({
          site: SITE, results, disk, scanMs: Date.now() - t0,
        }), { qos: 1 });
        console.log(`[edge-storage] scan ${results.length} หมวด ใช้เวลา ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (e) {
        client.publish(TOPIC_STOR_SCAN_RESULT, JSON.stringify({ site: SITE, error: e.message }), { qos: 1 });
        console.error('[edge-storage] scan ล้มเหลว:', e.message);
      }
    })();
    return;
  }

  // Storage purge — คำสั่งทำลาย ต้องผ่าน shared secret และ dry-run มาก่อน
  // ตรรกะจริงอยู่ใน helpers/storagePurge.js ตัวเดียวกับที่ central ใช้ ไม่เขียนซ้ำ
  // เพราะกติกาความปลอดภัยสองสำเนาจะเลื่อนออกจากกันโดยไม่มีใครรู้ตัว
  if (topic === TOPIC_STOR_PURGE) {
    const reply = (o) => client.publish(TOPIC_STOR_PURGE_RESULT, JSON.stringify({ site: SITE, ...o }), { qos: 1 });
    // helper เป็น async แล้ว (ไม่บล็อก event loop ของ agent ตอนเดินไฟล์หลักแสนใบ)
    // → ห่อด้วย async IIFE แบบเดียวกับ TOPIC_STOR_SCAN ข้างบน · try/catch ต้องอยู่
    // **ใน** IIFE ไม่ใช่นอก ไม่งั้น rejection กลายเป็น unhandled แล้ว pm2 ฆ่า process บน edge
    (async () => {
      try {
        const req = JSON.parse(buf.toString());
        if (!hasValidCommandSecret(req)) {
          console.warn('[edge-storage] purge ปฏิเสธ — secret ไม่ถูกต้อง');
          return;   // เงียบไปเลย ไม่ตอบ เพื่อไม่บอกใบ้ว่ามีคำสั่งนี้อยู่
        }
        const sp = require('./helpers/storagePurge');
        const { category, days, reqId } = req;
        if (req.dryRun !== false) {
          const plan = await sp.planPurge(SNAPSHOT_DIR, category, days);
          if (plan.rejected) return reply({ reqId, error: plan.rejected });
          return reply({ reqId, dryRun: true, category, days, files: plan.files, bytesDisk: plan.bytesDisk, sample: plan.sample });
        }
        const r = await sp.executePurge(SNAPSHOT_DIR, category, days, req.confirmFiles);
        if (r.rejected) return reply({ reqId, error: r.rejected, expected: r.expected, actual: r.actual });
        console.warn(`[edge-storage] purge ${category} เก่ากว่า ${days} วัน — ลบ ${r.deleted}/${r.files} ไฟล์`);
        reply({ reqId, dryRun: false, category, days, files: r.files, deleted: r.deleted, bytesDisk: r.bytesDisk });
      } catch (e) {
        reply({ error: e.message });
      }
    })();
    return;
  }

  // Service control (H2). Guarded three ways before pm2 is touched: the shared
  // secret, a name allowlist, and a stop-blocklist for the processes that carry
  // this very command. execFile with an argument array — never a shell string.
  if (topic === TOPIC_SVC) {
    const reply = (o) => client.publish(TOPIC_SVC_RESULT, JSON.stringify(o), { qos: 1 });
    let req = {};
    try { req = JSON.parse(buf.toString()); } catch { return reply({ error: 'bad request' }); }
    const { name, action, req_id: reqId = null } = req;
    if (!hasValidCommandSecret(req)) {
      console.warn(`[edge-svc] ${action} ${name}: rejected — missing/invalid command secret`);
      return;                       // stay silent — do not confirm the topic even exists
    }
    if (!SVC_NAMES.has(name) || !SVC_ACTIONS.has(action)) {
      console.warn(`[edge-svc] rejected ${action} ${name} — not allowlisted`);
      return reply({ req_id: reqId, name, action, error: 'not allowed' });
    }
    if (action === 'stop' && SVC_NO_STOP.has(name)) {
      console.warn(`[edge-svc] refused stop ${name} — would cut the command channel`);
      return reply({ req_id: reqId, name, action, error: 'stop refused: would cut the command channel' });
    }
    console.log(`[edge-svc] ${action} ${name}`);
    execFile('pm2', [action, name], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[edge-svc] ${action} ${name} failed: ${err.message}`);
        return reply({ req_id: reqId, name, action, ok: false, error: String(stderr || err.message).slice(0, 300) });
      }
      console.log(`[edge-svc] ${action} ${name} ok`);
      reply({ req_id: reqId, name, action, ok: true });
    });
    return;
  }

  // Camera reboot. Credentials come from this edge's own decrypted config, never
  // over the wire — the command carries only which camera, so a captured message
  // cannot be replayed against a different device or leak a password.
  if (topic === TOPIC_REBOOT) {
    const reply = (o) => client.publish(TOPIC_REBOOT_RESULT, JSON.stringify(o), { qos: 1 });
    let req = {};
    try { req = JSON.parse(buf.toString()); } catch { return reply({ error: 'bad request' }); }
    const { camera_id: camId, req_id: reqId = null } = req;
    if (!hasValidCommandSecret(req)) {
      console.warn(`[edge-reboot] ${camId}: rejected — missing/invalid command secret`);
      return;
    }
    const found = _cameraMap[camId];
    if (!found) return reply({ req_id: reqId, camera_id: camId, ok: false, error: 'unknown camera on this site' });
    const cam = { ...found, vendor: found.vendor || 'bosch' }; // same (vendor || 'bosch') convention as central
    if (!supportsReboot(cam.vendor)) {
      return reply({ req_id: reqId, camera_id: camId, ok: false, error: `reboot not supported for '${cam.vendor}'` });
    }
    console.warn(`[edge-reboot] rebooting ${camId} (${cam.ip_address})`);
    rebootCamera(cam).then((r) => {
      if (r.ok) console.warn(`[edge-reboot] ${camId} accepted${r.unconfirmed ? ' (connection dropped — expected)' : ''}`);
      else      console.warn(`[edge-reboot] ${camId} failed: ${r.error}`);
      reply({ req_id: reqId, camera_id: camId, ...r });
    });
    return;
  }

  // Push MQTT settings into a Bosch camera. Same secret gate + camera lookup
  // as reboot above; vendor default mirrors routes/cameras.js's own convention
  // ((vendor || 'bosch')) so a camera with no vendor field still counts as
  // Bosch instead of being rejected by a stricter check here than everywhere
  // else. The reply never carries a password — pushMqttSettings()'s result
  // only ever has {ok, before, after, error}, none of which include it.
  if (topic === TOPIC_CAMERA_MQTT) {
    const reply = (o) => client.publish(TOPIC_CAMERA_MQTT_RESULT, JSON.stringify(o), { qos: 1 });
    let req = {};
    try { req = JSON.parse(buf.toString()); } catch { return reply({ error: 'bad request' }); }
    const { camera_id: camId, req_id: reqId = null } = req;
    if (!hasValidCommandSecret(req)) {
      console.warn(`[edge-camera-mqtt] ${camId}: rejected — missing/invalid command secret`);
      return;
    }
    const cam = _cameraMap[camId];
    if (!cam) return reply({ req_id: reqId, camera_id: camId, ok: false, error: 'unknown camera on this site' });
    if ((cam.vendor || 'bosch').toLowerCase() !== 'bosch') {
      return reply({ req_id: reqId, camera_id: camId, ok: false, error: `push-mqtt not supported for vendor '${cam.vendor}'` });
    }
    pushMqttSettings(cam).then((r) => {
      const rebootMsg = !r.reboot ? 'n/a'
        : r.reboot.ok ? (r.reboot.unconfirmed ? 'unconfirmed' : 'ok')
        : `failed: ${r.reboot.error}`;
      if (r.ok) console.warn(`[edge-camera-mqtt] ${camId} applied (${r.after && r.after.address}) · reboot ${rebootMsg}`);
      else      console.warn(`[edge-camera-mqtt] ${camId} failed: ${r.error}`);
      reply({ req_id: reqId, camera_id: camId, ...r });
    });
    return;
  }

  // Detection events: skip broker-replayed stale retained messages on reconnect
  // (Bosch publishes with retain=true; on restart we'd re-fire HTTP captures for
  //  old events whose DB rows may already have _snapshot_full set → silent no-match).
  //
  // NOTE: stateful detectors (FieldDetector/ObjectsInside occupancy, CountAggregation)
  // are published retained too, so a blanket skip threw their *live* events away and
  // those rules never got a snapshot — measured again 2026-09-07 on BOSCH_3100i_02:
  // ObjectsInside 99/100 imageless while LineDetector/Crossed was 4/4.
  // The 2026-06-29 attempt compared the camera's UtcTime to edge Date.now() and died
  // on a 3.5h clock skew (49f0464 → dbfb008). helpers/retainGate decides with two
  // edge-local facts instead: the burst right after (re)subscribe is replay, and after
  // that a payload identical to the last one on the same topic is replay. Anything
  // else is a live state change. See GOTCHAS #103.
  if (packet && packet.retain && _retainGate.skip(topic, buf)) return;

  // Detection event → capture HTTP snapshot and forward to central.
  // CountAggregation excluded: it's a people-COUNT state (feeds occupancy stats via
  // msg.Data.Count, not snapshots), the Events list filters it out, and it fires far
  // too often — capturing for it wasted disk on frames nothing displays (2026-06-29).
  if (!['ObjectDetection', 'LineDetector', 'FieldDetector'].some(t => topic.includes(t))) return;

  const cameraId = topic.split('/')[0];
  let cam        = _cameraMap[cameraId];
  if (!cam || !cam.ip_address) {
    // Config drift: detection for a camera not in the in-memory map. Reload from
    // disk (throttled per camera) so newly-added cameras work without a restart.
    const t = Date.now();
    if (t - (_unknownCam.get(cameraId) || 0) < UNKNOWN_RELOAD_MS) return;
    _unknownCam.set(cameraId, t);
    const before = Object.keys(_cameraMap).length;
    _cameraMap = _loadCameraMap();
    cam = _cameraMap[cameraId];
    if (cam && cam.ip_address) {
      // Third and last place _cameraMap is rebuilt — reconcile here too, or a
      // camera recovered by this path is crop-eligible with no session (and one
      // whose row changed keeps a session it should have lost). _metaCropWanted
      // reads this map, so every assignment to it has to be followed by this.
      _reconcileMetaTracks();
      syncBrokerAuth(); // Mosquitto only — no-op on NanoMQ
      console.log(`[edge-snap] ${cameraId}: not in map → reloaded cameras-config (${before}→${Object.keys(_cameraMap).length} cams) → recovered`);
    } else {
      console.warn(`[edge-snap] ${cameraId}: detection event but NOT in cameras-config (no snapshot). Reloaded disk (${before}→${Object.keys(_cameraMap).length} cams), still missing — check central config / camera_id match.`);
      return;
    }
  }

  // Mirrors mqtt-subscriber.js's captureHttpSnapshot() gate on central — this flag
  // was never wired to the edge path before (same class of gap as enable_vca_overlay).
  if (cam.enable_snapshot === false) return;
  // snapshot_mode (migration 160) — this whole function only ever does the HTTP
  // full-scene fetch (the MQTT-embedded crop, if the camera sends one, is parsed
  // by central directly from the event payload, independent of this file). In
  // mqtt_only mode skip it entirely — this is the actual bandwidth/disk saving,
  // not just cosmetic: no HTTP round-trip to the camera happens at all.
  if (cam.snapshot_mode === 'mqtt_only') return;

  // Throttle: burst events within SNAP_COOLDOWN_MS skip the HTTP capture — and no
  // longer republish the previous file under the new event's timestamp. Repro
  // 2026-08-19 (live, this camera): a fast rule (Vehicle Count crossings 1-2s apart)
  // reused a photo from 1-3s earlier and central linked it to the new event — the
  // MQTT crop showed the correct vehicle, the full-scene showed a different one.
  // No full-scene beats a wrong one; the event still gets its own MQTT-embedded crop
  // when the camera sends one.
  let utcTime, objectId = null;
  try {
    const ev = JSON.parse(buf.toString());
    utcTime  = ev.UtcTime;
    // Bosch nests the tracked object here; it is the same ObjectId the metadata
    // track uses, which is what makes the crop attributable to THIS event
    // rather than to whatever else was in frame.
    objectId = ev?.Data?.Object?.Object?.['@ObjectId'] ?? null;
  } catch { /* ignore */ }
  if (!utcTime) utcTime = new Date().toISOString();

  const now = Date.now();
  if (_snapCooldown.has(cameraId) && now - _snapCooldown.get(cameraId) < SNAP_COOLDOWN_MS) {
    // The cooldown exists to stop a burst hammering the camera for photos, and
    // that still stands. What it should not do is throw the EVENT away: when two
    // vehicles cross seconds apart, the second one was in the frame we already
    // fetched for the first. Measured on this camera over 6 hours: of 5,846
    // events carrying an ObjectId, 829 ended up with the full scene only and
    // 1,737 with no image at all — 2,566, or 44%, all of them blocked here and
    // all of them identifying an object we were tracking at the time.
    //
    // So re-cut the frame we already hold, at THIS object's position in it. No
    // extra HTTP request, no second file, and the crop is still that object's
    // own: the ring buffer is keyed per ObjectId, so looking it up at the frame's
    // capture instant gives where IT was, not where the first vehicle was.
    const reuse = reuseFrameForObject(cameraId, cam, utcTime, objectId);
    if (reuse.ok) return;
    // เฟรมที่ถืออยู่ตอบวัตถุนี้ไม่ได้ (ยังไม่เข้าเฟรม / ขยับเกินงบ / ไม่มีเฟรม)
    // เหตุผลของ cooldown คือกันการถ่าย "ซ้ำ" โดยไม่จำเป็น — พอเฟรมเดิมใช้ไม่ได้
    // การถ่ายใหม่ก็ไม่ใช่การถ่ายซ้ำอีกต่อไป ยอมให้ถ่ายได้ แต่ไม่ถี่กว่า REFETCH_MIN_MS
    // เพื่อไม่ให้ burst ที่รถเข้าใหม่ทุกคันกลายเป็นการยิงกล้องรัว
    //
    // วัดแล้วว่ากล้องรับไหว: ยิง 1 ครั้ง/วินาที 30 ครั้งติด สำเร็จ 30/30 เวลาตอบกลาง
    // 198ms ไม่ต่างจากที่ 1 ครั้ง/3 วินาที (218ms) — และนั่นคือยิงเพิ่มจากที่ระบบ
    // ยิงอยู่แล้ว · วัดซ้ำที่ 2 ครั้ง/วินาที 30 วินาที (2026-09-11, BH5100i_RMUTR-V_01)
    // สำเร็จ 60/60 กลาง 228ms p95 295ms โหลดเครื่องขึ้นจาก 0.12 เป็น 0.66 จาก 4 คอร์
    const sinceMs = now - _snapCooldown.get(cameraId);
    if (sinceMs < REFETCH_MIN_MS) {
      // 🔴 บรรทัดนี้คือจุดเดียวในไฟล์ที่ event จบลงโดย **ไม่มีภาพเลย** — เดิม `return`
      // เงียบ ๆ ไม่ทิ้งอะไรไว้ให้ตามเลย (เพิ่ม log 2026-09-12 ตาม WA #3.4 ชั้นแรก:
      // log/metric ที่ไม่แตะ control flow ทำได้เลย)
      //
      // ปริมาณจำกัดในตัวเอง: บรรทัดนี้ออกเท่ากับจำนวน event ที่ไม่มีภาพจริง ๆ
      // (~130/วัน/กล้องที่ RMUTR-V) ไม่ใช่ทุก event ที่อยู่ในช่วง cooldown
      // (~8,000/วัน/กล้อง) · และ handler นี้รับเฉพาะกล้อง Bosch ONVIF ซึ่งทั้งระบบ
      // มี 8 ตัวใน 3 ไซต์ จึงไม่มีทางบวมข้ามไซต์
      //
      // ⚠️ ยังมีอีก 2 ทางที่ออกไปเงียบ ๆ ก่อนถึงตรงนี้ — `enable_snapshot === false`
      //    และ `snapshot_mode === 'mqtt_only'` · จงใจไม่ log เพราะเป็น "สถานะการตั้งค่า"
      //    ที่คงที่ทั้งกล้อง ถ้า log จะออกทุก event ของกล้องนั้น · กล้องที่ตั้งไว้แบบนั้น
      //    ไม่มีภาพจาก edge โดยตั้งใจ ⇒ ไม่มีบรรทัดนี้ให้เห็นก็ถูกแล้ว
      console.log(`[edge-snap] ${cameraId} oid=${objectId} ไม่มีภาพ — reuse:${reuse.reason} `
        + `· ห่างจากภาพล่าสุด ${sinceMs}ms < ${REFETCH_MIN_MS}ms`);
      return;
    }
    console.log(`[edge-snap] ${cameraId} oid=${objectId} เฟรมเดิมใช้ไม่ได้ (${reuse.reason}) `
      + `— ถ่ายใหม่ (ห่าง ${sinceMs}ms)`);
  }
  _snapCooldown.set(cameraId, now);

  captureAndPublish(cameraId, cam, utcTime, objectId);
});

// The most recent full scene per camera, held only as long as the cooldown that
// blocks re-fetching it. Kept as the decoded buffer because the crop is cut from
// it directly — reading the file back would work too, but the whole point is to
// avoid doing work the burst already did.
const _lastFrame = new Map();  // cameraId → { buf, tsMs, dir, relBase, file }

// Whether a position may stand in for where the object was IN a reused frame.
//
// The question is not how old the sample is, it is how far the object moved in
// between. A pedestrian at 1.7 m/s barely shifts in 120ms; a motorcycle at 10
// m/s covers more than its own width. A flat time budget is wrong at both ends
// — it discards slow objects that are still exactly where the box says, and
// admits fast ones that are already gone.
//
// So the budget is a distance, scaled by the object's own size: the camera
// reports area in m², and √area is roughly how wide the thing is. Half a metre
// ruins a crop of a person and barely dents one of a truck.
//   motorcycle (area ~1.2) → ~0.44m → 44ms at 10 m/s
//   pedestrian (area ~0.75) → ~0.35m → 200ms at 1.7 m/s
//   truck      (area ~13.7) → ~1.48m → 148ms at 10 m/s
//
// Two guards, and both must pass:
//   - drift within budget, and
//   - the track BRACKETS the frame's instant. Drift alone is not enough: an
//     object that entered after the frame and is standing still has no drift at
//     all, and would be cropped onto a frame it was never in.
// Speed unknown means the drift cannot be judged, so the time cap decides.
const DRIFT_FRAC   = 0.4;   // ของขนาดวัตถุ (√area)
const DRIFT_MIN_M  = 0.25;  // เล็กกว่านี้ไม่มีเหตุผลจะเข้มไปกว่านั้น
const DRIFT_MAX_M  = 1.5;   // ใหญ่แค่ไหนก็ไม่ควรเกินนี้
const REUSE_TOL_MS = 400;   // เพดานเวลาสูงสุด ใช้เมื่อไม่รู้ความเร็ว
const REFETCH_MIN_MS = parseInt(process.env.SNAP_REFETCH_MIN_MS || '1000', 10);
function reuseHitAcceptable(hit, cameraId, objectId) {
  if (!hit.bracketed) {
    console.log(`[meta-crop] ${cameraId} oid=${objectId} วัตถุยังไม่อยู่ในเฟรมนั้น — ไม่ใช้ภาพเดิม`);
    return false;
  }
  const drift = metaTrack.driftMetres(hit);
  if (drift == null) return hit.dtMs <= 120;   // ไม่รู้ความเร็ว → ใช้เกณฑ์เวลาเดิม
  const size = Number.isFinite(hit.area) && hit.area > 0 ? Math.sqrt(hit.area) : 1;
  const budget = Math.min(DRIFT_MAX_M, Math.max(DRIFT_MIN_M, DRIFT_FRAC * size));
  if (drift > budget) {
    console.log(`[meta-crop] ${cameraId} oid=${objectId} ขยับไป ${drift.toFixed(2)}m `
      + `ระหว่างเฟรมกับตำแหน่ง (งบ ${budget.toFixed(2)}m) — ไม่ใช้ภาพเดิม`);
    return false;
  }
  return true;
}

// คืน `{ ok, reason }` — `ok` คือสิ่งที่ผู้เรียกใช้ตัดสินว่าจะถ่ายภาพใหม่ไหม (ต้องตอบ
// แบบ synchronous ส่วนการครอปจริงทำต่อแบบ async ได้) ส่วน `reason` มีไว้ให้ log
//
// 🔴 ทำไมต้องมี `reason` (2026-09-12): ทางออกทั้ง 5 ทางนี้เดิม `return false` เฉย ๆ
// แล้วผู้เรียกก็ `return` เงียบต่อ ⇒ **event จบลงโดยไม่มีภาพและไม่มีร่องรอยใด ๆ ใน log**
// กว่าจะตอบเจ้าของได้ว่าทำไมภาพหาย ต้องใช้สองเครื่องไล่ย้อนกันทั้งวัน (2026-09-11)
// และยังเหลืออีก 19–27% ของที่หายที่ตอบไม่ได้เลยเพราะไม่มีอะไรให้อ่าน
// **เพิ่มทางออกใหม่เมื่อไหร่ ต้องมี reason เสมอ** — มีเทสต์ยึดไว้
// (test/edge-snap-drop-reason.test.js)
function reuseFrameForObject(cameraId, cam, utcTime, objectId) {
  if (objectId == null) return { ok: false, reason: 'no-object-id' };
  if (!_metaCropWanted(_cameraMap[cameraId])) return { ok: false, reason: 'meta-crop-off' };
  const f = _lastFrame.get(cameraId);
  if (!f) return { ok: false, reason: 'no-held-frame' };
  // Older than the cooldown means a fresh capture was already allowed and this
  // frame is not the burst's frame any more — a stale one would put the object
  // where it used to be, which is the wrong-vehicle bug in a new costume.
  if (Date.now() - f.tsMs > SNAP_COOLDOWN_MS) {
    _lastFrame.delete(cameraId);
    return { ok: false, reason: 'frame-stale' };
  }

  // ตัดสินใจก่อนด้วยข้อมูลใน ring (synchronous) ว่าเฟรมนี้ตอบวัตถุนี้ได้ไหม —
  // ถ้าไม่ได้ ต้องบอกผู้เรียกทันทีเพื่อให้ไปถ่ายใหม่ ไม่ใช่รู้ทีหลังใน callback
  // แยกสองเหตุออกจากกัน: "ยังไม่เข้าเฟรมนั้น" กับ "เข้าแล้วแต่ขยับไปไกลเกินงบ"
  // คนละเรื่องกันตอนจะปรับจูน (อันแรกเป็นเรื่องจังหวะ อันหลังเป็นเรื่องความเร็ว)
  const probe = metaTrack.lookup(cameraId, objectId, _snapInstant(f.tsMs), REUSE_TOL_MS);
  if (!probe) return { ok: false, reason: 'not-in-frame' };
  if (!reuseHitAcceptable(probe, cameraId, objectId)) return { ok: false, reason: 'drifted' };

  cropToObject(cameraId, objectId, _snapInstant(f.tsMs), f.buf, f.dir, f.tsMs, f.relBase, REUSE_TOL_MS)
    .catch((e) => { console.warn(`[meta-crop] ${cameraId} reuse failed: ${e.stack || e.message}`); return null; })
    .then((meta) => {
      if (!meta) return;   // object not in that frame — nothing honest to publish
      console.log(`[meta-reuse] ${cameraId} oid=${objectId} ← ภาพเดิม (อายุ ${Date.now() - f.tsMs}ms)`);
      client.publish(`${cameraId}/onvif-ej/Device/snapshot`, JSON.stringify({
        ts: utcTime,
        snapshot_file: f.file,
        object_id: objectId,
        ...(meta.file ? { crop_file: meta.file } : {}),
        ...(meta.box ? { bbox: meta.box } : {}),
        ...(meta.avgSpeed ? { speed_avg: meta.avgSpeed } : {}),
        ...(meta.speedSeries ? { speed_series: meta.speedSeries } : {}),
        ...(meta.area != null ? { area: meta.area } : {}),
        ...(meta.heading != null ? { heading: meta.heading } : {}),
        ...(meta.trail ? { trail: meta.trail } : {}),
        ...(meta.colors ? { colors: meta.colors } : {}),
      }), { qos: 0 });
    });
  // รับงานนี้ไว้แล้ว — ผู้เรียกต้องไม่ไปถ่ายภาพใหม่ซ้อน (การครอปทำต่อแบบ async)
  return { ok: true, reason: 'reused' };
}

// Locates the object that triggered the event inside the just-captured full
// scene, and crops to it.
//
// Returns { file, box } — and the two are independent. `box` is the object's
// position as fractions of the frame, sent whenever the object was found at
// all; `file` is the crop, which can be null for the same lookup (the box was
// too small to be worth cutting). That split matters: a frame drawn over the
// full scene is useful exactly in the cases where a 40px crop is not.
// Returns null only when there is nothing to say at all.
async function cropToObject(cameraId, objectId, tSnapMs, buf, dir, tsMs, relBase, tolMs, accept) {
  if (objectId == null || !_metaCropWanted(_cameraMap[cameraId])) return null;
  const hit = metaTrack.lookup(cameraId, objectId, tSnapMs, tolMs);
  // Say why there is no crop rather than returning a silent null: "the object
  // had already left" and "the box was too small to show" are different
  // outcomes, and only the counts tell Phase 3 which one to tune.
  if (!hit) {
    console.log(`[meta-crop] ${cameraId} oid=${objectId} ไม่พบใน metadata ณ เวลาถ่ายภาพ (ออกนอกเฟรมแล้ว)`);
    return null;
  }
  // เกณฑ์เพิ่มเติมของทาง reuse — ทางปกติไม่ส่ง accept มา จึงผ่านตลอด
  if (accept && !accept(hit)) return null;
  const box = metaTrack.boxToFraction(hit.box);
  // Averaged over the object's samples still in the ring — the MQTT event
  // already carries one instantaneous reading, so sending that again adds
  // nothing; this is the part only the metadata track can answer.
  const avgSpeed = Number.isFinite(hit.avgSpeed)
    ? Math.round(hit.avgSpeed * 100) / 100 : null;
  // The whole series drives the sparkline in the event modal. Capped and rounded
  // on the way out: at ~15Hz five seconds is ~75 readings, and neither the wire
  // nor a 300px chart gains anything from that many. Evenly sampled so the shape
  // of the run survives — taking the first 40 would show only its beginning.
  const SERIES_MAX = 40;
  const raw = Array.isArray(hit.speedSeries) ? hit.speedSeries : [];
  const step = raw.length > SERIES_MAX ? raw.length / SERIES_MAX : 1;
  const speedSeries = raw.length
    ? Array.from({ length: Math.min(raw.length, SERIES_MAX) },
                 (_, i) => Math.round(raw[Math.floor(i * step)] * 10) / 10)
    : null;
  const area = Number.isFinite(hit.area) ? Math.round(hit.area * 100) / 100 : null;
  const heading = Number.isFinite(hit.heading) ? hit.heading : null;
  const trail = Array.isArray(hit.trail) && hit.trail.length > 1 ? hit.trail : null;
  // กลุ่มสีของวัตถุจากสตรีม metadata — ส่งดิบเป็น XYZ+weight ให้ central แปลงชื่อสีเอง
  // เรียงตามน้ำหนักและตัดเหลือ 4 ก้อน เท่าที่ central เก็บจริง (extractAppearance slice(0,4))
  const colors = Array.isArray(hit.colors) && hit.colors.length
    ? hit.colors.slice().sort((a, b) => b.w - a.w).slice(0, 4) : null;
  try {
    const sharp = require('sharp');
    const img = sharp(buf);
    const { width, height } = await img.metadata();
    // Dimensions come from the JPEG itself rather than the requested JpegSize:
    // the camera is free to return something else, and a wrong denominator puts
    // the box on the wrong part of the picture.
    const region = metaTrack.boxToPixels(hit.box, width, height,
      { pad: META_CROP_PAD, minPx: META_CROP_MINPX });
    if (!region) {
      const raw = metaTrack.boxToPixels(hit.box, width, height, { pad: META_CROP_PAD, minPx: 1 });
      console.log(`[meta-crop] ${cameraId} oid=${objectId} กรอบเล็กเกิน `
        + `${raw ? raw.width + 'x' + raw.height : '?'} < ${META_CROP_MINPX}px — ไม่ crop (แต่ยังส่งพิกัดกรอบ)`);
      return { file: null, box, avgSpeed, speedSeries, area, heading, trail, colors };
    }
    // ObjectId ต้องอยู่ในชื่อไฟล์ ไม่ใช่แค่ timestamp — ตั้งแต่มี reuseFrameForObject
    // เฟรมเดียวถูกครอปได้หลายครั้งสำหรับวัตถุคนละตัว ถ้าใช้แต่ timestamp ของเฟรม
    // ไฟล์จะชื่อเดียวกันแล้วเขียนทับกันเอง วัตถุตัวหลังจะได้ภาพของตัวแรก
    const fname = `event_meta_${tsMs}_${objectId}.jpg`;
    await img.extract(region).jpeg({ quality: 85 }).toFile(path.join(dir, fname));
    console.log(`[meta-crop] ${cameraId} oid=${objectId} ${hit.type || '?'} `
      + `${region.width}x${region.height} dt=${hit.dtMs}ms → ${fname}`);
    return { file: `${relBase}/${fname}`, box, avgSpeed, speedSeries, area, heading, trail, colors };
  } catch (e) {
    console.warn(`[meta-crop] ${cameraId} oid=${objectId} failed: ${e.message}`);
    // The crop failed, but the lookup did not — the frame still stands.
    return { file: null, box, avgSpeed, speedSeries, area, heading, trail, colors };
  }
}

function captureAndPublish(cameraId, cam, utcTime, objectId = null) {
  const topic = `${cameraId}/onvif-ej/Device/snapshot`;
  // enable_vca_overlay rides in on the synced camera config (publishSiteConfig.js) —
  // mirrors mqtt-subscriber.js's captureHttpSnapshot() on central, which has always
  // done this for directly-reachable cameras. Bosch-only param; harmless if the
  // camera ignores it.
  const snapUrl = `http://${cam.ip_address}/snap.jpg?JpegSize=1920x1080` +
    (cam.enable_vca_overlay !== false ? '&VCAOverlay=1' : '');
  const options = { timeout: 5000, headers: {} };
  if (cam.username && cam.password) {
    options.headers['Authorization'] =
      'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
  }

  // ── จับเวลาการดึงภาพ (2026-08-26) ────────────────────────────────────────
  // เราบันทึกขนาดไฟล์และผลลัพธ์ของการครอปไว้หมดแล้ว แต่ไม่เคยบันทึก "กว่าภาพจะมาถึง
  // ใช้เวลาเท่าไหร่" ซึ่งเป็นตัวเดียวที่ตอบได้ว่าภาพแก่กว่ากรอบ metadata แค่ไหน
  //
  // แยกสองท่อนเพราะบอกคนละเรื่อง:
  //   ขอ→ไบต์แรก  = กล้องถ่าย+เข้ารหัสนานแค่ไหน (โตขึ้น = กล้องทำงานหนัก/ตั้งค่าเปลี่ยน)
  //   ไบต์แรก→ครบ = เวลาส่งข้ามเครือข่ายที่ไซต์
  //
  // ที่มา: 2026-08-26 เปิด EIS บน BH5100i_RMUTR-V_01 ช่วง 11:45–14:00 แล้ว meta crop
  // ของมอเตอร์ไซค์ได้ถนนเปล่า 21% (รถยนต์ 0% เพราะกรอบใหญ่พอจะยังคาบเกี่ยว) ตอนนั้น
  // ไล่หาสาเหตุทั้งวันเพราะไม่มีตัวเลขนี้ — ถ้ามี จะรู้ใน 5 นาที
  const tReq = Date.now();
  let tFirstByte = null;
  const req = http.get(snapUrl, options, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      console.warn(`[edge-snap] ${cameraId} HTTP ${res.statusCode}`);
      return;
    }
    const chunks = [];
    res.on('data', (c) => { if (tFirstByte === null) tFirstByte = Date.now(); chunks.push(c); });
    res.on('end', () => {
      const buf  = Buffer.concat(chunks);
      // กล้องที่กำลังถูกปิด/หลุด ยังตอบ HTTP 200 ได้แต่ body ว่าง — เขียนไปก็ได้ไฟล์
      // 0 ไบต์ แล้ว publish path นั้นให้ central ผูกเข้า event ⇒ ระบบเชื่อว่ามีรูป
      // ทั้งที่เปิดไม่ได้ (เจอจริง 2026-09-07 18:04 BOSCH_3100i_02 นาทีเดียวกับที่
      // กล้องหยุดส่ง event: 2 ไฟล์จาก 12 ของวันนั้นเป็น 0 ไบต์ หน้าเว็บขึ้น "err")
      // magic byte กัน body ที่เป็นหน้า error HTML พร้อม 200 ด้วย
      try {
        assertImageBuffer(buf);
      } catch (e) {
        console.warn(`[edge-snap] ${cameraId} ทิ้งภาพที่ใช้ไม่ได้ (${buf.length} ไบต์): ${e.message}`);
        return;
      }
      // T_snap: the instant the frame finished arriving, on the edge clock —
      // the same clock the metadata ring is keyed on, so camera↔edge skew
      // cannot shift the lookup.
      const tsMs = Date.now();
      const { dir, relBase } = snapPath(SNAPSHOT_DIR, 'events', cameraId, tsMs);
      const fname = `event_edge_${tsMs}.jpg`;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fname), buf);
      } catch (e) { console.warn(`[edge-snap] ${cameraId} write fail: ${e.message}`); return; }
      const snapshot_file = `${relBase}/${fname}`;
      // Held for the length of the cooldown so events blocked by it can still be
      // cropped from this same frame (reuseFrameForObject). Released on a timer
      // as well as by the staleness check there: a camera that goes quiet after
      // one capture would otherwise hold its ~430KB frame indefinitely. The
      // identity check stops the timer from evicting a newer frame.
      const held = { buf, tsMs, dir, relBase, file: snapshot_file };
      _lastFrame.set(cameraId, held);
      setTimeout(() => { if (_lastFrame.get(cameraId) === held) _lastFrame.delete(cameraId); },
                 SNAP_COOLDOWN_MS + 500).unref?.();
      const tFb = tFirstByte ?? tsMs;
      console.log(`[edge-snap] ${cameraId} → ${(buf.length / 1024).toFixed(0)}KB · `
        + `ขอ→ไบต์แรก ${tFb - tReq}ms · ไบต์แรก→ครบ ${tsMs - tFb}ms @ ${snapshot_file}`);
      // Publish once, after the crop attempt, so both paths reach central in the
      // same message and the crop never races the event's timestamp match.
      cropToObject(cameraId, objectId, _snapInstant(tsMs), buf, dir, tsMs, relBase)
        .catch((e) => { console.warn(`[meta-crop] ${cameraId} unexpected: ${e.stack || e.message}`); return null; })
        .then((meta) => {
          client.publish(topic, JSON.stringify({
            ts: utcTime, snapshot_file,
            // object_id travels with both: central matches them to its own
            // event on this, not on timestamp proximity.
            ...(meta ? { object_id: objectId } : {}),
            ...(meta?.file ? { crop_file: meta.file } : {}),
            // bbox goes even when there is no crop — a frame over the full
            // scene answers "which one was it" for the cases the crop cannot.
            ...(meta?.box ? { bbox: meta.box } : {}),
            ...(meta?.avgSpeed ? { speed_avg: meta.avgSpeed } : {}),
            ...(meta?.speedSeries ? { speed_series: meta.speedSeries } : {}),
            ...(meta?.area != null ? { area: meta.area } : {}),
            ...(meta?.heading != null ? { heading: meta.heading } : {}),
            ...(meta?.trail ? { trail: meta.trail } : {}),
            ...(meta?.colors ? { colors: meta.colors } : {}),
          }), { qos: 0 });
        });
    });
  });
  req.on('error',   (e) => console.warn(`[edge-snap] ${cameraId} error: ${e.message}`));
  req.on('timeout', ()  => { req.destroy(); console.warn(`[edge-snap] ${cameraId} timeout`); });
}

client.on('error',    (e) => console.error('[edge-config] MQTT error:', e.message || e.code));
client.on('reconnect', () => console.log('[edge-config] reconnecting…'));

// Keepalive heartbeat every 60s — central touchCamera to prevent false-offline.
// TCP probe gates each publish: offline cameras are silently skipped, central
// marks them offline after OFFLINE_THRESHOLD_SEC (90s).
// ponytail: warns every 60s per down camera — add transition-state dedup if log noise matters
//
// กระจายกล้องให้ทั่ว 60 วิ ห้ามยิงพร้อมกัน — เดิมยิงทุกกล้อง
// ในวินาทีเดียว (~50 ข้อความใน ~90 ms ที่ hdy) แล้ว edge-bridge ส่งต่อขึ้น central เป็นก้อน ⇒ broker ตัดสาย
// "Protocol error" ตรงวินาทีนั้นซ้ำ ๆ (hdy :19 · hkt :12 · จับได้จริง 2026-10-17) · กล้องแต่ละตัวยังได้รอบละ
// 60 วิเท่าเดิม (ช่องเวลาคงที่ต่อกล้อง) จึงไม่ชนเกณฑ์ offline 90 วิของ central
const HEARTBEAT_INTERVAL_MS = 60_000;
function heartbeatRound() {
  if (!client.connected) return;
  // ช่องเวลาผูกกับ id ของกล้อง ไม่ใช่ลำดับในแผนที่ — เพิ่ม/ลบกล้อง หรือ _config/cameras ถูกส่งซ้ำตอน bridge ต่อใหม่
  // (วันละหลายสิบครั้งที่ hdy) ต้องไม่ทำให้กล้องย้ายช่องจนห่างรอบก่อนเกิน 90 วิ
  for (const id of Object.keys(_cameraMap)) setTimeout(() => {
    const cam = _cameraMap[id];
    if (!cam || !cam.ip_address || !client.connected) return;
    const sock = net.createConnection({ host: cam.ip_address, port: cam.http_port || 80, timeout: 3000 });
    sock.once('connect', () => {
      sock.destroy();
      client.publish(`${id}/onvif-ej/Device/heartbeat`,
        JSON.stringify({ UtcTime: new Date().toISOString() }), { qos: 0 });
    });
    sock.once('timeout', () => { sock.destroy(); console.warn(`[edge-hb] ${id} unreachable (timeout) — heartbeat suppressed`); });
    sock.once('error',   () => { console.warn(`[edge-hb] ${id} unreachable — heartbeat suppressed`); });
  }, heartbeatSlotMs(id));
}
function heartbeatSlotMs(id) {
  return crypto.createHash('sha1').update(String(id)).digest().readUInt32BE(0) % HEARTBEAT_INTERVAL_MS;
}
// รอบแรกทันทีหลังบูต — ไม่งั้นกล้องท้ายแถวต้องรอเกือบ 2 นาทีหลัง restart ซึ่งเกินเกณฑ์ offline 90 วิ
setTimeout(heartbeatRound, 5_000);
setInterval(heartbeatRound, HEARTBEAT_INTERVAL_MS);

// SD/recording status (Bosch ONVIF GetRecordingSummary) — central can't reach edge-site
// cameras directly, but we're on their LAN, so we probe locally and push the result
// up via MQTT (mqtt-subscriber.js applySdStatusResult). Hourly: recording status doesn't
// need heartbeat-rate freshness, and this is a full ONVIF SOAP round-trip per camera.
const { buildOnvifSecurityHeader } = require('./helpers/onvifSecurity');

function onvifGetRecordingSummary(cam) {
  return new Promise((resolve) => {
    if (!cam.ip_address) return resolve({ ok: false, error: 'no ip' });
    const security = buildOnvifSecurityHeader(cam.username || '', cam.password || '');
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trc="http://www.onvif.org/ver10/search/wsdl"><s:Header>${security}</s:Header><s:Body><trc:GetRecordingSummary/></s:Body></s:Envelope>`;
    const req = http.request({
      method: 'POST', hostname: cam.ip_address, port: cam.http_port || 80,
      path: '/onvif/search_service',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const xml = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
        const dataFrom  = (xml.match(/<tt:DataFrom>([^<]+)<\/tt:DataFrom>/) || [])[1];
        const dataUntil = (xml.match(/<tt:DataUntil>([^<]+)<\/tt:DataUntil>/) || [])[1];
        const numRec = parseInt((xml.match(/<tt:NumberRecordings>(\d+)<\/tt:NumberRecordings>/) || [])[1] || '0', 10);
        if (!dataUntil) {
          const fault = (xml.match(/<SOAP-ENV:Text[^>]*>([^<]+)/) || [])[1];
          return resolve({ ok: false, error: fault || 'no DataUntil' });
        }
        resolve({ ok: true, dataFrom, dataUntil, numRec });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// OPT5-EDGE-002 — this used to fire onvifGetRecordingSummary (8s timeout each)
// for every Bosch camera in one synchronous loop, all at once. capturePreview
// already solved the same problem by staggering across its poll interval; cap
// the spread here at 30s instead of the full hour so probes still finish well
// before the next cycle (an hourly startup dribble isn't worth the anti-burst
// benefit at this cadence — see advisor review, 2026-07-22).
const SD_POLL_STAGGER_MS = 30_000;
function pollSdStatusOnce() {
  if (!client.connected) return;
  const ids = Object.keys(_cameraMap).filter(id => {
    const cam = _cameraMap[id];
    return cam && cam.ip_address && String(cam.vendor || '').toLowerCase() === 'bosch';
  });
  const gap = ids.length > 1 ? Math.floor(SD_POLL_STAGGER_MS / ids.length) : 0;
  ids.forEach((id, i) => {
    setTimeout(() => {
      const cam = _cameraMap[id];
      if (!cam) return;
      // Two sources, one message. ONVIF answers "how far back does the footage
      // reach" (dataFrom/dataUntil/numRec, which central maps to
      // recording_data_*); RCP+ answers what the card and the recorder actually
      // are — present/RW/capacity/RUNNING. Neither replaces the other, and the
      // RCP+ half is the one that catches a camera reporting the 2000-01-01
      // "nothing recorded" sentinel over ONVIF while it is in fact RUNNING
      // (4 of 6 Bosch cameras did exactly that, verified 2026-08-05).
      //
      // The RCP+ probe never rejects and never blocks the ONVIF result: if it
      // fails, its detail is simply absent and the panel falls back to the four
      // ONVIF rows it has always shown.
      Promise.all([onvifGetRecordingSummary(cam), boschSdProbe(cam).catch(() => null)])
        .then(([r, b]) => {
          // The halves fail independently. BOSCH_8000i answers RCP+ fine and
          // 400s the ONVIF call, so the detail has to ride along even when
          // r.ok is false — central decides what to do with each half.
          const payload = (b && b.ok) ? { ...r, detail: b.detail } : r;
          client.publish(`${id}/onvif-ej/Device/sd-status`, JSON.stringify(payload), { qos: 0 });
        });
    }, gap * i);
  });
}
const SD_POLL_INTERVAL_MS = parseInt(process.env.SD_POLL_INTERVAL_MS || '3600000', 10); // 1h
setTimeout(pollSdStatusOnce, 10_000);
setInterval(pollSdStatusOnce, SD_POLL_INTERVAL_MS);

// Rule (IVA task) name check — Bosch caps a task name at 64 BYTES and cuts it
// mid-character, which then makes the broker either silently drop the
// resulting malformed-UTF-8 PUBLISH (NanoMQ) or disconnect the camera
// ("malformed packet", Mosquitto 2.x). Read-only RCP+ (helpers/boschRcp.js
// readTaskNames) — this only ever reports what a name currently is, it never
// renames anything on the camera. Bosch-only, same hourly cadence and
// staggering pattern as the SD poll above, offset by 20s so the two probes
// don't compete for the same cameras' HTTP connections at once.
const VCA_RULES_POLL_STAGGER_MS = 30_000;
function pollVcaRulesOnce() {
  if (!client.connected) return;
  const ids = Object.keys(_cameraMap).filter(id => {
    const cam = _cameraMap[id];
    return cam && cam.ip_address && String(cam.vendor || 'bosch').toLowerCase() === 'bosch';
  });
  const gap = ids.length > 1 ? Math.floor(VCA_RULES_POLL_STAGGER_MS / ids.length) : 0;
  ids.forEach((id, i) => {
    setTimeout(() => {
      const cam = _cameraMap[id];
      if (!cam) return;
      readTaskNames(cam).then((r) => {
        const payload = r.ok
          ? {
              ok: true,
              checked_at: new Date().toISOString(),
              task_count: r.tasks.length,
              issues: r.tasks.filter(t => t.problem).map(t => ({ id: t.id, type: t.type, name: t.name, problem: t.problem })),
            }
          : { ok: false, error: r.error };
        client.publish(`${id}/onvif-ej/Device/vca-rules`, JSON.stringify(payload), { qos: 0 });
      });
    }, gap * i);
  });
}
const VCA_RULES_POLL_INTERVAL_MS = parseInt(process.env.VCA_RULES_POLL_INTERVAL_MS || '3600000', 10); // 1h
setTimeout(pollVcaRulesOnce, 20_000);
setInterval(pollVcaRulesOnce, VCA_RULES_POLL_INTERVAL_MS);

// ── Hikvision on-camera storage ─────────────────────────────
// Same hourly cadence, same MQTT topic, same DB columns as the Bosch probe —
// only the protocol differs (three ISAPI documents instead of one ONVIF call).
//
// Staggered over five minutes rather than the Bosch thirty seconds: there are 50
// Hikvision cameras at Phuket against a handful of Bosch, each probe is three
// requests, and one of them (ContentMgmt/search) makes the camera walk its own
// filesystem. Hourly telemetry has no deadline, so it costs nothing to spread it
// out and it keeps the burst off cameras that are also serving an alertStream.
const HIK_SD_STAGGER_MS = 5 * 60_000;

function hikIsapi(cam, method, uri, body) {
  return new Promise((resolve) => {
    if (!cam.ip_address) return resolve({ code: 0, xml: 'no ip' });
    const attempt = (authHeader) => {
      const headers = { Accept: 'application/xml' };
      if (authHeader) headers.Authorization = authHeader;
      if (body) { headers['Content-Type'] = 'application/xml'; headers['Content-Length'] = Buffer.byteLength(body); }
      const req = http.request({
        hostname: cam.ip_address, port: cam.http_port || 80, path: uri, method, headers, timeout: 12_000,
      }, (res) => {
        if (res.statusCode === 401 && !authHeader) {
          const wa = res.headers['www-authenticate'] || '';
          res.resume();
          if (!/digest/i.test(wa)) return resolve({ code: 401, xml: '' });
          return attempt(buildDigestHeader(cam.username || '', cam.password || '', method, uri, parseChallenge(wa)));
        }
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => resolve({ code: res.statusCode, xml: d }));
      });
      req.on('error', (e) => resolve({ code: 0, xml: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ code: 0, xml: 'timeout' }); });
      if (body) req.write(body);
      req.end();
    };
    attempt(null);
  });
}

async function hikSdProbe(cam) {
  if (authBackoffActive(cam.camera_id)) {
    // Deliberately does not say "locked": we saw a 401, which is all we know.
    return { ok: false, error: '401 — polls paused' };
  }
  // System/status first, because it is the one document EVERY Hikvision model
  // here answers. ANPR (traffic) cameras 403 ContentMgmt/Storage outright —
  // a different device class with a different ISAPI surface, not a permission
  // problem — and this is where their disk list and upload counters live.
  const status = await hikIsapi(cam, 'GET', '/ISAPI/System/status');
  const storage = await hikIsapi(cam, 'GET', '/ISAPI/ContentMgmt/Storage');
  // Unreachable only when NEITHER answered. 403 on one document is a normal
  // answer from a camera that simply does not implement it; treating it as a
  // failure is what left 16 ANPR cameras with no telemetry at all.
  if (storage.code !== 200 && status.code !== 200) {
    if (storage.code === 401 || status.code === 401) noteAuthFailure(cam.camera_id, 'sd-probe');
    return { ok: false, error: `status HTTP ${status.code} / storage HTTP ${storage.code}` };
  }
  // Asked unconditionally. Gating this on the storage code was wrong for the
  // same reason the original bug was: ANPR cameras 403 every storage document
  // and still answer record/tracks 200 with a full seven-day continuous
  // schedule. One document's refusal says nothing about the next one.
  const tracks = await hikIsapi(cam, 'GET', '/ISAPI/ContentMgmt/record/tracks');
  // Traffic-camera surface (spec 14.5.1.37). Face models 403 it; ANPR answers,
  // and whether an arming server is set decides if an outage is replayable.
  const anr = await hikIsapi(cam, 'GET', '/ISAPI/Traffic/ANR');
  // Face models count nothing about their pushes — uploadTimeConsumingList is
  // a traffic-camera counter — so this configured list is the only destination
  // view they have. Same call the alarm-server survey uses, read-only.
  const hosts = await hikIsapi(cam, 'GET', '/ISAPI/Event/notification/httpHosts');
  const now = new Date(), from = new Date(now - 30 * 86400000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  // The one call that IS conditional, and on its own precondition rather than a
  // proxy: searching means walking a filesystem, so it needs a filesystem. No
  // storage document means there is nothing to walk.
  const search = storage.code !== 200 ? { code: 0, xml: '' } : await hikIsapi(cam, 'POST', '/ISAPI/ContentMgmt/search', `<?xml version="1.0" encoding="utf-8"?>
<CMSearchDescription><searchID>VIGIL-SD-${Date.now()}</searchID>
<trackIDList><trackID>101</trackID></trackIDList>
<timeSpanList><timeSpan><startTime>${iso(from)}</startTime><endTime>${iso(now)}</endTime></timeSpan></timeSpanList>
<maxResults>40</maxResults><searchResultPostion>0</searchResultPostion>
<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>
</CMSearchDescription>`);
  const detail = buildSdDetail({
    storageXml: storage.code === 200 ? storage.xml : null,
    tracksXml: tracks.code === 200 ? tracks.xml : null,
    searchXml: search.code === 200 ? search.xml : null,
    statusXml: status.code === 200 ? status.xml : null,
    anrXml: anr.code === 200 ? anr.xml : null,
    hostsXml: hosts.code === 200 ? hosts.xml : null,
    // Distinguishes "the camera says it has no card" from "the camera will not
    // discuss its storage". The panel claimed the first for 16 cameras that
    // meant the second.
    storageSupported: storage.code === 200,
  });
  // ok reports that the PROBE succeeded. Whether the card is healthy is
  // detail.state, and central decides what to store from that — a card that is
  // missing or unformatted is a successful probe with bad news, not a failure.
  noteAuthOk(cam.camera_id);
  return { ok: true, detail };
}

function pollHikSdOnce() {
  if (!client.connected) return;
  const ids = Object.keys(_cameraMap).filter((id) => {
    const cam = _cameraMap[id];
    return cam && cam.ip_address && String(cam.vendor || '').toLowerCase() === 'hikvision';
  });
  if (!ids.length) return;
  const gap = ids.length > 1 ? Math.floor(HIK_SD_STAGGER_MS / ids.length) : 0;
  ids.forEach((id, i) => {
    setTimeout(() => {
      const cam = _cameraMap[id];
      if (!cam) return;
      hikSdProbe(cam)
        .then((r) => client.publish(`${id}/onvif-ej/Device/sd-status`, JSON.stringify(r), { qos: 0 }))
        .catch((e) => console.warn(`[sd] ${id}: ${e.message}`));
    }, gap * i);
  });
  console.log(`[sd] Hikvision storage probe: ${ids.length} กล้อง กระจายใน ${HIK_SD_STAGGER_MS / 1000} วินาที`);
}
setTimeout(pollHikSdOnce, 45_000);   // after the Bosch pass, not alongside it
setInterval(pollHikSdOnce, SD_POLL_INTERVAL_MS);

// Pilot (2026-07-19) — Dahua LPR cameras at HDY have no storage of their own (confirmed
// live: storageDevice.cgi 400s on a standalone LPR cam); they're recorded by one of 4
// physical NVRs instead, which aren't modeled as separate rows for these LPR camera_ids.
// Probe each NVR once (reusing its existing camera_id entry's ip/creds) and fan the
// result out to every camera_id it actually backs, over the SAME sd-status topic/columns
// as Bosch — sd_status/sd_error/sd_last_check_at only (mqtt-subscriber.js coalesces the
// ONVIF-only dataFrom/dataUntil/numRec fields to null since this isn't ONVIF). No-op on
// any edge node that doesn't have these camera_ids locally (e.g. VSS).
const DAHUA_NVR_PILOT = {
  'HDY-NVR-01-ch0': ['HDY-NVR-01-ch0', 'HDY-NVR-01-ch1', 'hdy-anpr1', 'hdy-anpr-lotus2', 'hdy-motor-lotus1', 'hdy-motor-lotus2'],
  'HDY-NVR-02-ch0': ['HDY-NVR-02-ch0', 'HDY-NVR-02-ch1', 'hdy-motor-bigc1', 'hdy-motor-bigc2', 'hdy-anpr-bigc1', 'hdy-anpr-bigc2'],
  'HDY-NVR-03-ch0': ['HDY-NVR-03-ch0', 'HDY-NVR-03-ch1', 'hdy-anpr-r51', 'hdy-anpr-r52', 'hdy-motor-r51', 'hdy-motor-r52'],
  'HDY-NVR-04-ch0': ['HDY-NVR-04-ch0', 'HDY-NVR-04-ch1', 'hdy-anpr-1081', 'hdy-anpr-1082', 'hdy-motor-1081', 'hdy-motor-1082'],
};

// list.info[N].State / .Detail[M].IsError — classic Dahua key=value text, not JSON.
// UsedBytes≈TotalBytes is normal ring-buffer overwrite, not a fault — ignore capacity,
// judge health from State/IsError only (confirmed live against HDY-NVR-01, 2026-07-19).
function dahuaStorageHealthy(text) {
  const states = [...text.matchAll(/\.State=([^\r\n]+)/g)].map(m => m[1].trim());
  const errors = [...text.matchAll(/\.IsError=(true|false)/g)].map(m => m[1] === 'true');
  if (!states.length) return { ok: false, error: 'no storage device reported' };
  if (errors.some(Boolean)) return { ok: false, error: 'storage IsError=true' };
  if (states.some((s) => s !== 'Success')) return { ok: false, error: `storage state: ${states.join(',')}` };
  return { ok: true };
}

function dahuaGetDeviceStorage(cam) {
  return new Promise((resolve) => {
    if (!cam.ip_address) return resolve({ ok: false, error: 'no ip' });
    const uriPath = '/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo';
    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const req = http.request({
        hostname: cam.ip_address, port: cam.http_port || 80, path: uriPath, method: 'GET',
        headers, timeout: 8000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode === 401 && !authHeader) {
            const wa = res.headers['www-authenticate'] || '';
            return attempt(buildDigestHeader(cam.username || '', cam.password || '', 'GET', uriPath, parseChallenge(wa)));
          }
          if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          resolve(dahuaStorageHealthy(data));
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    };
    attempt(null);
  });
}

function pollDahuaNvrStorageOnce() {
  if (!client.connected) return;
  for (const [nvrRefId, targets] of Object.entries(DAHUA_NVR_PILOT)) {
    const cam = _cameraMap[nvrRefId];
    if (!cam || !cam.ip_address) continue; // this edge's site doesn't have this NVR
    dahuaGetDeviceStorage(cam).then((r) => {
      for (const targetId of targets) {
        client.publish(`${targetId}/onvif-ej/Device/sd-status`, JSON.stringify(r), { qos: 0 });
      }
    });
  }
}
setTimeout(pollDahuaNvrStorageOnce, 15_000);
setInterval(pollDahuaNvrStorageOnce, SD_POLL_INTERVAL_MS);

// Vendor-aware JPEG fetch with Digest/Basic auth fallback (shared by preview loop
// + NVR channel scan). Timeout 45s (was 8s) — live-measured: a loaded 16-channel
// NVR (DHI-NVR5216-16P-I/L, Intelligent Algorithm running on several channels)
// took 37.5s for a full digest-auth ChannelTitle fetch (2026-07-16). Response
// speed varies a lot device-to-device (some answer in ms) — a longer timeout
// only affects the slow ones since we resolve as soon as a response lands.
const _FETCH_JPEG_TIMEOUT_MS = 45000;
function _fetchJpeg(host, port, uri, user, pass, cb) {
  const attempt = (authHeader) => {
    // Guard against double-invoking cb: req.destroy() on timeout can also fire
    // a subsequent 'error' event (e.g. "socket hang up") — without this, that
    // second call would overwrite the clearer "timeout" error already reported.
    let settled = false;
    const finish = (err, buf) => { if (!settled) { settled = true; cb(err, buf); } };
    const headers = {};
    if (authHeader) headers.Authorization = authHeader;
    const req = http.get({ host, port: port || 80, path: uri, headers, timeout: _FETCH_JPEG_TIMEOUT_MS }, (res) => {
      if (res.statusCode === 401 && !authHeader) {
        const wa = res.headers['www-authenticate'] || '';
        res.resume();
        // Retry with a fresh attempt() (its own settled/finish) — do NOT call
        // finish() here, this attempt isn't done, it's handing off to the next one.
        if (/digest/i.test(wa)) { settled = true; return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa))); }
        if (/basic/i.test(wa))  { settled = true; return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')); }
        return finish(new Error('401 no supported auth'));
      }
      if (res.statusCode !== 200) { res.resume(); return finish(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', finish);
    });
    req.on('error', finish);
    req.on('timeout', () => { req.destroy(); finish(new Error('timeout')); });
  };
  attempt(null);
}

// True when >1 configured camera shares this IP — i.e. a multi-channel recorder
// (NVR), not a standalone camera. Standalone cams (even ones tagged nvr_channel,
// e.g. a direct ANPR) own their IP and snapshot.cgi works on them.
function _sharesIp(ip) {
  if (!ip) return false;
  let n = 0;
  for (const id in _cameraMap) {
    if (_cameraMap[id] && _cameraMap[id].ip_address === ip && ++n > 1) return true;
  }
  return false;
}

// ── auth-failure backoff ────────────────────────────────────
// Hikvision locks an account after a few bad logins (GOTCHAS #141). While it is
// locked every request comes back 401 no matter how right the password is, so a
// poller running every two minutes produces nothing but noise — and the camera
// reads OFFLINE on the dashboard the whole time while working perfectly.
//
// This backoff exists to stop that noise, NOT to let the lock expire: the
// observed countdown kept decrementing while polls continued, so polling does
// not appear to extend it. How long the lock actually lasts is unknown — the
// figure the camera reports outlived it. 35 minutes is therefore a guess chosen
// to be longer than the reported number, not a derived value.
//
// Only 401 backs off. A camera that is merely unreachable keeps being retried,
// because retrying is what notices it coming back.
// C10-KAR-SB-04 went twelve hours and roughly twenty of these backoff cycles
// without recovering, so a fixed retry interval is the wrong shape for the case
// that actually happened: a camera that will not come back on its own goes on
// generating a 401 and an OFFLINE badge every 35 minutes, forever. After the
// second cycle the camera is set aside indefinitely and the operator is told —
// this needs a person either way, and repeating a failed login is not a fix.
//
// Persisted, because "indefinitely" that a process restart clears is not
// indefinitely: restarts happen for unrelated reasons and would silently put
// the camera straight back into the loop. Delete the file to release.
const AUTH_BACKOFF_MS = parseInt(process.env.AUTH_BACKOFF_MS || String(35 * 60_000), 10);
const AUTH_GIVEUP_AFTER = 2;
const AUTH_HELD_PATH = path.join(__dirname, '..', 'data', 'auth-held.json');
const _authLockedUntil = new Map();
const _authCycles = new Map();
// Read ONCE, here, at module load. Every message that tells an operator to
// delete the file has to say "and restart" as well, or they will delete it,
// watch nothing happen, and conclude the file was not the problem (hit
// 2026-08-07 on C10-KAR-SB-04 — 55 hours of stale preview).
const _authHeld = new Set(loadAuthHeld());

function loadAuthHeld() {
  try {
    const held = JSON.parse(fs.readFileSync(AUTH_HELD_PATH, 'utf8'));
    if (Array.isArray(held) && held.length) {
      console.warn(`[edge-auth] not polling ${held.join(', ')} — held from a previous run. To resume: fix the credentials, delete ${AUTH_HELD_PATH}, THEN restart this agent — the list below is read once at startup, so deleting the file on its own changes nothing.`);
    }
    return Array.isArray(held) ? held : [];
  } catch { return []; }
}

function saveAuthHeld() {
  try {
    fs.mkdirSync(path.dirname(AUTH_HELD_PATH), { recursive: true });
    fs.writeFileSync(AUTH_HELD_PATH, JSON.stringify([..._authHeld], null, 1));
  } catch (e) { console.warn('[edge-auth] could not persist held list:', e.message); }
}

function authBackoffActive(cameraId) {
  if (_authHeld.has(cameraId)) return true;
  const until = _authLockedUntil.get(cameraId);
  if (!until) return false;
  if (Date.now() < until) return true;
  _authLockedUntil.delete(cameraId);
  return false;
}

// Without this the counter is cumulative across the camera's whole life: one
// transient 401 in March plus one in September would give up permanently on the
// second, having polled perfectly for six months in between. Escalation is meant
// to mean "twice in a row", so a success has to reset it.
function noteAuthOk(cameraId) {
  if (_authCycles.has(cameraId)) _authCycles.delete(cameraId);
}

function noteAuthFailure(cameraId, where) {
  if (_authLockedUntil.has(cameraId) || _authHeld.has(cameraId)) return;  // already set aside
  const cycles = (_authCycles.get(cameraId) || 0) + 1;
  _authCycles.set(cameraId, cycles);
  if (cycles >= AUTH_GIVEUP_AFTER) {
    _authHeld.add(cameraId);
    saveAuthHeld();
    console.warn(`[edge-auth] ${cameraId} still 401 after ${cycles} backoff cycles — no longer polling it. This needs a person: check the credentials, or power-cycle the camera if its account is locked. To resume: delete ${AUTH_HELD_PATH} AND restart this agent (the held list is loaded once at startup — deleting the file alone does nothing).`);
    return;
  }
  _authLockedUntil.set(cameraId, Date.now() + AUTH_BACKOFF_MS);
  console.warn(`[edge-auth] ${cameraId} 401 from ${where} — pausing polls ${Math.round(AUTH_BACKOFF_MS / 60000)} min. Check the camera's credentials: a wrong password looks exactly like this.`);
}

// A JPEG starts FF D8 and ends FF D9; the SOI marker plus a floor is enough to
// tell "a picture" from "an empty 200" without decoding anything.
function _looksLikeJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 1024 && buf[0] === 0xFF && buf[1] === 0xD8;
}

// Cameras that cannot produce a still would otherwise be asked every interval
// forever — 716 pointless requests a day each, and 716 log lines to match. Back
// off after a few, but keep trying occasionally: a camera that starts working
// (firmware, config) should heal on its own rather than need someone to notice.
const PREVIEW_MISS_LIMIT = 3;
const PREVIEW_MISS_BACKOFF_MS = 30 * 60_000;
const _previewMiss = new Map();   // cameraId → { n, until }

function _previewSuppressed(cameraId) {
  const m = _previewMiss.get(cameraId);
  return !!m && m.n >= PREVIEW_MISS_LIMIT && Date.now() < m.until;
}

function _noteUnusablePreview(cameraId, bytes) {
  const m = _previewMiss.get(cameraId) || { n: 0, until: 0 };
  m.n += 1;
  m.until = Date.now() + PREVIEW_MISS_BACKOFF_MS;
  _previewMiss.set(cameraId, m);
  // Tell central to drop the stale pointer, so the fallback below it can run.
  // Done over the wire rather than by editing the row by hand: a manual UPDATE
  // is invisible to git and nobody would know to undo it.
  client.publish(`${cameraId}/onvif-ej/Device/preview`,
    JSON.stringify({ ts: new Date().toISOString(), snapshot_file: null, unsupported: true }), { qos: 0 });
  if (m.n <= PREVIEW_MISS_LIMIT) {
    console.warn(`[edge-preview] ${cameraId} ตอบ 200 แต่ไม่ใช่ภาพ (${bytes} bytes)`
      + (m.n === PREVIEW_MISS_LIMIT
        ? ` — ครั้งที่ ${m.n} พักการถ่าย tile ${PREVIEW_MISS_BACKOFF_MS / 60000} นาที แล้วใช้ภาพเหตุการณ์ล่าสุดแทน`
        : ` — ครั้งที่ ${m.n}`));
  }
}

// Periodic full-scene tile preview — vendor-aware, writes to stable path
// snapshots/preview/{cameraId}.jpg (overwritten in place, out of retention tree).
function capturePreview(cameraId, cam) {
  if (authBackoffActive(cameraId)) return;
  if (_previewSuppressed(cameraId)) return;
  const vendor = String(cam.vendor || '').toLowerCase();
  // Dahua NVR sub-channels: snapshot.cgi returns HTTP 500 on the recorder for remote
  // channels (verified live — every channel/subtype 500s on these NVRs). We detect the
  // NVR case by shared IP (sibling channels on one recorder), NOT nvr_channel alone —
  // a standalone ANPR tagged nvr_channel=0 still serves snapshot.cgi fine (200).
  // serveLatestSnapshot already serves the per-channel event scene (snapManager JPEG)
  // for NVR channels, so the tile fetch never succeeds and never gets used — pure
  // 500-spam + needless NVR load every interval. Skip it.
  // ponytail: shared-IP heuristic — no ffmpeg on edge, event scene is the only still
  if (vendor === 'dahua' && Number.isInteger(cam.nvr_channel) && _sharesIp(cam.ip_address)) return;
  // NVR channel is 0-based; Dahua CGI channel= is 1-based (matches dahua-cgi.js
  // snapshot path). A plain single-channel camera has no nvr_channel → channel 1.
  const dahuaCh = Number.isInteger(cam.nvr_channel) ? cam.nvr_channel + 1 : 1;
  const uri = vendor === 'hikvision'
    ? '/ISAPI/Streaming/channels/102/picture'
    : vendor === 'dahua'
      ? (cam.snapshot_path || `/cgi-bin/snapshot.cgi?channel=${dahuaCh}&subtype=1`)
      : (cam.snapshot_path || '/snap.jpg?JpegSize=1920x1080');

  _fetchJpeg(cam.ip_address, cam.http_port || 80, uri, cam.username || '', cam.password || '', (err, buf) => {
    if (err) {
      if (/\b401\b/.test(err.message)) noteAuthFailure(cameraId, 'preview');
      console.warn(`[edge-preview] ${cameraId} ${err.message}`); return;
    }
    // HTTP 200 does not mean there is a picture in the body. DS-TCG405-E answers
    // the snapshot URL with Content-Type: image/jpeg and Content-Length: 0 — it
    // has no manual-capture function at all (/picture/capabilities returns 403
    // notSupport), so this is its way of saying no. Writing that through gave a
    // 0-byte file, and because serveLatestSnapshot prefers tile_snap_file over
    // everything else, the tile stayed black while a perfectly good scene image
    // sat one fallback step below (reported 2026-08-20: 4,735 attempts across
    // 7 days, zero pictures, on 2 of 89 cameras at hkt).
    if (!_looksLikeJpeg(buf)) { _noteUnusablePreview(cameraId, buf.length); return; }
    _previewMiss.delete(cameraId);
    const dir  = path.join(SNAPSHOT_DIR, 'preview');
    const dest = path.join(dir, `${cameraId}.jpg`);
    const tmp  = path.join(dir, `.${cameraId}.tmp`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
    } catch (e) { console.warn(`[edge-preview] ${cameraId} write fail: ${e.message}`); return; }
    const snapshot_file = `preview/${cameraId}.jpg`;
    client.publish(`${cameraId}/onvif-ej/Device/preview`,
      JSON.stringify({ ts: new Date().toISOString(), snapshot_file }), { qos: 0 });
    noteAuthOk(cameraId);
    console.log(`[edge-preview] ${cameraId} ${vendor} → ${(buf.length / 1024).toFixed(0)}KB`);
  });
}

const PREVIEW_INTERVAL_MS = parseInt(process.env.PREVIEW_INTERVAL_MS || '120000', 10);
setInterval(() => {
  if (!client.connected) return;
  const ids = Object.keys(_cameraMap);
  const gap = ids.length > 1 ? Math.floor(PREVIEW_INTERVAL_MS / ids.length) : 0;
  ids.forEach((id, i) => {
    setTimeout(() => {
      const cam = _cameraMap[id];
      if (!cam || !cam.ip_address) return;
      capturePreview(id, cam);
    }, gap * i);
  });
}, PREVIEW_INTERVAL_MS);
