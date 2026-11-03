// ============================================================
// Vigil Platform — MQTT Subscriber
// CCTV Analytics & Management Suite
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ============================================================
// Features:
// - อ่าน camera config จาก cameras-config.json (live reload)
// - Filter MotionAlarm events ออก
// - Snapshot capture (MQTT base64 + HTTP fallback)
// - Hook → alert engine (LINE notification)
// ============================================================

const mqtt = require('mqtt');
const { Pool } = require('pg');
const http = require('http');
const fs = require('fs');
const { xyzToColorName } = require('./color-utils');
const { decryptCamCreds } = require('./crypto-creds');
const { snapPath } = require('./snapshot-path');
const { encryptPii } = require('./helpers/blacklist-crypto');
const { faceComparisonListType } = require('./ingesters/dahua-protocol');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ quiet: true });
const env = require('./config');
const { touchCamera } = require('./helpers/touchCamera');
// ตัดสิน "อ่านป้ายได้ดีพอ" ตอนบันทึกแล้วตรึงไว้ (migration 234)
const helmet = require('./helpers/helmetCriteria');
const { createTtlCache } = require('./helpers/ttlCache');
const { assertImageBuffer } = require('./helpers/imageMagic');
const { validCameraBrokerUrl } = require('./helpers/edgeCameraBrokerUrl');
const { readTaskNames } = require('./helpers/boschRcp');
const { validVcaRuleIssues } = require('./helpers/vcaRuleIssues');
require('./singleton')('mqtt-subscriber');   // refuse to run a second copy


// ============================================================
// Filter Config — events ที่ ignore (ไม่บันทึก)
// ============================================================

const IGNORED_EVENT_TYPES = [
  'MotionAlarm',           // เก็บ noise มาก ไม่มีประโยชน์
  'JobState',              // RecordingConfig/JobState — recording state ใช้ ONVIF poll แทน
  'heartbeat',             // edge-agent keepalive — touchCamera เท่านั้น ไม่บันทึก event
  // เพิ่ม event types อื่นๆ ที่ไม่ต้องการได้ที่นี่
];

const { snapshotDir } = require('./helpers/snapshotDir');
const SNAPSHOT_DIR = snapshotDir();
const CONFIG_FILE = path.join(__dirname, '..', 'cameras-config.json');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

// ============================================================
// Camera Config (from JSON file)
// ============================================================

let cameraMap = {};

function loadCameraConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      cameraMap = {};
      return;
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (config.cameras) config.cameras = config.cameras.map(decryptCamCreds);
    cameraMap = {};
    // Bosch-only — this is the MQTT subscriber. Non-Bosch cameras
    // (vendor:'hikvision' etc.) have their own ingester and never
    // publish MQTT; keeping them out of cameraMap stops ensureCamera()
    // from logging spurious "unknown camera" diagnostics and keeps the
    // Bosch heartbeat/last_seen logic from being confused by them.
    let skipped = 0;
    (config.cameras || []).forEach(c => {
      if (String(c.vendor || 'bosch').toLowerCase() !== 'bosch') { skipped++; return; }
      cameraMap[c.camera_id] = c;
    });
    console.log(`  📋 Loaded ${Object.keys(cameraMap).length} Bosch cameras from config`
      + (skipped ? ` (${skipped} non-Bosch skipped — own ingester)` : ''));
    Object.values(cameraMap).forEach(c => {
      console.log(`     • ${c.camera_id} → ${c.ip_address}`);
    });
  } catch (e) {
    console.error('Config load error:', e.message);
    cameraMap = {};
  }
}

function watchConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    fs.watch(CONFIG_FILE, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        console.log('  🔄 Config file changed, reloading...');
        setTimeout(() => {
          loadCameraConfig();
          // Drop the "we've already evaluated this camera_id" cache so
          // ensureCamera() re-evaluates against the fresh cameraMap on the
          // next event. Without this, an ADD-DELETE-ADD-same-id flow within
          // one process lifetime would short-circuit the re-add and skip
          // the DB INSERT, leaving the new camera without a runtime row.
          knownCameras.clear();
        }, 500);
      }
    });
    console.log(`  👁️  Watching ${CONFIG_FILE}`);
  } catch (e) { console.warn('Watch failed:', e.message); }
}

loadCameraConfig();
watchConfig();

// ============================================================
// Database & MQTT
// ============================================================

const pool =   // 🔴 ไม่มี statement_timeout = query ค้างได้ไม่จำกัด · เจอจริง 2026-08-27:
  // query หนึ่งค้าง 34 ชั่วโมง ทำให้ autovacuum เก็บ dead tuple ไม่ได้ ตาราง events
  // บวมจนทั้งระบบช้า และหน้าสถิติว่างเปล่า · มีแค่ api-server ที่ตั้งค่านี้ไว้
  // insert event ทีละใบบนเส้นทางร้อน ยาวกว่านี้คือผิดปกติ
new Pool({
  options: '-c statement_timeout=60000',
  ...env.db(),
  max: 5,
  application_name: 'mqtt-subscriber',
});

// บังคับ session ทุก connection ให้ใช้ UTC — กันปัญหา timezone mismatch
pool.on('connect', async (client) => {
  try { await client.query("SET TIME ZONE 'UTC'"); } catch (e) { /* ignore */ }
});

// SEC-001 Phase 2: authenticate with EMQX built-in DB user
const _mqttConnOpts = {
  clientId: process.env.MQTT_CLIENT_ID || `bosch-collector-${Date.now()}`,
  reconnectPeriod: 5000,
  clean: true,
};
if (process.env.MQTT_SUBSCRIBER_USER && process.env.MQTT_SUBSCRIBER_PASSWORD) {
  _mqttConnOpts.username = process.env.MQTT_SUBSCRIBER_USER;
  _mqttConnOpts.password = process.env.MQTT_SUBSCRIBER_PASSWORD;
}
const client = mqtt.connect(process.env.MQTT_BROKER_URL, _mqttConnOpts);

const knownCameras = new Set();

// ============================================================
// Snapshot
// ============================================================

async function captureHttpSnapshot(cameraId, eventId, opts = {}) {
  const cam = cameraMap[cameraId];
  if (!cam || !cam.ip_address) return null;

  // Phase 6.1.4 — VCA overlay (burned-in bounding box around IVA-detected object).
  // Bosch FLEXIDOME 8100i FW 9.x uses `VCAOverlay=1` (case-sensitive).
  // Confirmed working 2026-05-08 on FW 9.80.106 — keep the casing exact.
  // JpegSize is intentionally omitted — `snap.jpg` then returns the camera's
  // NATIVE resolution (8100i = 3840x2160). It used to hard-code 1280x720,
  // which silently capped every stored event snapshot (Phase 2 promises a
  // native original; the per-camera full_view_width caps only the view).
  const params = opts.withOverlay ? 'VCAOverlay=1' : '';
  const url = `http://${cam.ip_address}/snap.jpg${params ? '?' + params : ''}`;
  const tsNow = Date.now();
  const { dir: evDir, relBase } = snapPath(SNAPSHOT_DIR, 'events', cameraId, tsNow);
  const fname    = `event_${tsNow}.jpg`;
  const filepath = path.join(evDir, fname);
  const filename = `${relBase}/${fname}`;

  return new Promise((resolve) => {
    const options = { timeout: 5000, headers: {} };
    if (cam.username && cam.password) {
      options.headers['Authorization'] =
        'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
    }

    const req = http.get(url, options, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // เหมือนฝั่ง edge (edge-config-agent.js): กล้องที่กำลังถูกปิดตอบ 200 ได้แต่ body ว่าง
        // และบางรุ่นตอบหน้า error เป็น HTML พร้อม 200 — เขียนไปก็ได้ไฟล์ที่เปิดไม่ได้
        // แล้ว event จะถูกประทับว่ามีรูป (เจอจริง 2026-09-07 ที่ฝั่ง edge)
        try { assertImageBuffer(buffer); }
        catch (e) {
          console.warn(`  ⚠️ [${cameraId}] ทิ้ง snapshot ที่ใช้ไม่ได้ (${buffer.length} ไบต์): ${e.message}`);
          resolve(null); return;
        }
        fs.writeFileSync(filepath, buffer);
        const tag = opts.withOverlay ? 'with VCA overlay' : 'plain';
        console.log(`  📸 HTTP snapshot saved (${tag}): ${filename} (${(buffer.length/1024).toFixed(0)}KB)`);
        resolve({ filename, source: 'http' });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── Per-camera media flags from DB (30s cache) ──────────────
// max ตั้งไว้ **เหนือเพดานของผลิตภัณฑ์** (3,000 กล้อง ตาม HARDWARE_SIZING_GUIDE ·
// ตอนนี้จริง 169 ใน cameras-config.json) เพราะของเดิมเป็น Map ไม่จำกัด — ถ้า evict
// เกิดจริงบน ingest path ที่กล้องวนมาเรื่อย ๆ แคช 30 วิ จะกลายเป็น query ต่อ event
// เป็นแค่กันพื้นที่ระเบิด ไม่ใช่ working-set limit · หนึ่ง entry = boolean 4 ตัว
const _camFlagsCache = createTtlCache({ name: 'mqtt:cam-flags', ttlMs: 30_000, max: 4096 });
async function getCamFlags(cameraId) {
  // try/catch อยู่ **ใน** loader โดยตั้งใจ — query ล้ม = cache ค่า default ไว้ 30 วิ
  // เหมือนเดิม ไม่ใช่โยน rejection ขึ้นมาบน hot path ของ ingest
  return _camFlagsCache.wrap(cameraId, async () => {
    let flags = { enable_snapshot: true, enable_vca_overlay: true, snapshot_mode: 'both', paused: false };
    try {
      const r = await pool.query(
        `SELECT enable_snapshot, enable_vca_overlay, snapshot_mode, paused FROM cameras WHERE id=$1`,
        [cameraId]
      );
      if (r.rows[0]) flags = {
        enable_snapshot:    r.rows[0].enable_snapshot    !== false,
        enable_vca_overlay: r.rows[0].enable_vca_overlay !== false,
        // migration 160 — which source(s) to use when enable_snapshot is true
        snapshot_mode:       r.rows[0].snapshot_mode || 'both',
        paused:             r.rows[0].paused === true,
      };
    } catch {}
    return flags;
  });
}

// ── Per-camera site code from DB (Task #16 cross-check, 30s cache) ─────────
// cameras.site_id is an INT FK → sites.id; MQTT topics carry sites.code
// (e.g. projects/bma/...), so this resolves id → code via a join.
const _camSiteCache = createTtlCache({ name: 'mqtt:cam-site', ttlMs: 30_000, max: 4096 });   // เหตุผลของ max ดู _camFlagsCache
async function getCamSiteCode(cameraId) {
  // เหมือน getCamFlags: query ล้ม = cache null ไว้ 30 วิ ไม่โยนขึ้น hot path
  return _camSiteCache.wrap(cameraId, async () => {
    try {
      const r = await pool.query(
        `SELECT s.code FROM cameras c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`,
        [cameraId]
      );
      return r.rows[0]?.code ?? null;
    } catch { return null; }
  });
}

function saveMqttSnapshot(cameraId, eventId, base64Data) {
  try {
    // Strip any data-URL prefix some firmwares prepend (e.g.
    // "data:image/jpeg;base64,/9j/..."). Buffer.from() on the bare prefix
    // would write garbage bytes ahead of the real JPEG, breaking the file.
    let cleaned = String(base64Data || '').trim();
    const m = cleaned.match(/^data:[^;]+;base64,(.+)$/);
    if (m) cleaned = m[1];
    // Defensive length floor: anything shorter than ~100 base64 chars
    // (~75 bytes decoded) can't be a real JPEG, even thumbnail-sized.
    // Saves us writing 0-byte files when the field is present but empty.
    if (cleaned.length < 100) return null;
    const buffer = Buffer.from(cleaned, 'base64');
    if (buffer.length < 1000) return null;          // <1KB → not an image
    const tsNow = Date.now();
    const { dir: evDir, relBase } = snapPath(SNAPSHOT_DIR, 'events', cameraId, tsNow);
    const fname    = `event_mqtt_${tsNow}.jpg`;
    const filename = `${relBase}/${fname}`;
    fs.writeFileSync(path.join(evDir, fname), buffer);
    console.log(`  📸 MQTT snapshot saved: ${filename} (${(buffer.length/1024).toFixed(0)}KB)`);
    return { filename, source: 'mqtt' };
  } catch (err) {
    console.error(`  📷 MQTT snapshot save error: ${err.message}`);
    return null;
  }
}

// ============================================================
// Helper: Strip base64 / large strings ออกจาก JSON ก่อนเก็บใน DB
// ลด DB bloat — base64 snapshot ขนาด 200-300KB ต่อ event
// ============================================================

const STRIP_THRESHOLD = 1000; // strings ยาวกว่า 1000 chars จะถูก strip

function stripLargeStrings(input) {
  // Deep clone แล้ว replace strings ยาวๆ
  const seen = new WeakSet();
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return obj;
    seen.add(obj);
    if (Array.isArray(obj)) {
      return obj.map(walk);
    }
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > STRIP_THRESHOLD) {
        out[k] = `[stripped: ${v.length} chars]`;
      } else if (typeof v === 'object' && v !== null) {
        out[k] = walk(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return walk(input);
}

// ============================================================
// Recording status poller — ONVIF Search/GetRecordingSummary (Profile G)
// "recording active" = (NOW() - recording_data_until) < RECORDING_FRESH_SEC
// ============================================================

const SD_POLL_INTERVAL_MS = 30_000;

function buildOnvifSecurityHeader(username, password) {
  const nonceBuf = crypto.randomBytes(16);
  const nonceB64 = nonceBuf.toString('base64');
  const created = new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
  const digestBuf = crypto.createHash('sha1')
    .update(Buffer.concat([nonceBuf, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest();
  const digestB64 = digestBuf.toString('base64');
  return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${username}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digestB64}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}

function onvifGetRecordingSummary(cam) {
  return new Promise((resolve) => {
    if (!cam.ip_address) return resolve({ ok: false, error: 'no ip' });
    const security = buildOnvifSecurityHeader(cam.username || '', cam.password || '');
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trc="http://www.onvif.org/ver10/search/wsdl"><s:Header>${security}</s:Header><s:Body><trc:GetRecordingSummary/></s:Body></s:Envelope>`;
    const req = http.request({
      method: 'POST', hostname: cam.ip_address, port: 80,
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

async function pollSdStatusForCamera(cam) {
  // Edge-site cameras (cam.site set) live on a remote LAN — central cannot reach
  // their ONVIF endpoint directly. The edge node itself runs this same ONVIF probe
  // locally (edge-config-agent.js pollSdStatusOnce, hourly) and reports the real
  // result via MQTT → see eventType === 'sd-status' below. Here we only seed the
  // neutral 'edge-site' placeholder before that first real report ever arrives —
  // once sd_last_check_at is set, leave it alone so this 30s loop doesn't stomp
  // the real value back to 'edge-site'.
  if (cam.site) {
    await pool.query(
      `UPDATE cameras SET sd_status = 'edge-site', sd_error = NULL WHERE id = $1 AND sd_last_check_at IS NULL`,
      [cam.camera_id]
    ).catch(() => {});
    return;
  }
  const r = await onvifGetRecordingSummary(cam);
  if (!r.ok) {
    await pool.query(
      `UPDATE cameras SET sd_last_check_at = NOW(),
                          sd_status = 'unreachable',
                          sd_error  = $2
       WHERE id = $1`,
      [cam.camera_id, r.error]
    ).catch(() => {});
    return;
  }
  await pool.query(
    `UPDATE cameras SET sd_last_check_at     = NOW(),
                        sd_status            = 'ok',
                        sd_error             = NULL,
                        recording_data_from  = $2,
                        recording_data_until = $3,
                        recording_count      = $4,
                        last_seen_at         = NOW()
     WHERE id = $1`,
    [cam.camera_id, r.dataFrom, r.dataUntil, r.numRec]
  ).catch((err) => console.error('  💾 Recording status update error:', err.message));
}

// Applies an ONVIF GetRecordingSummary-shaped result ({ok, dataFrom, dataUntil, numRec, error})
// reported by the edge node over MQTT (topic .../Device/sd-status) for edge-site cameras
// central can't probe directly. Mirrors pollSdStatusForCamera's own DB write for the
// direct-probe path, minus last_seen_at (touchCamera already covers liveness for MQTT messages).
async function applySdStatusResult(cameraId, r) {
  // A detail is authoritative on its own, even when the ONVIF half of the same
  // message failed. BOSCH_8000i is the case that proved it: it answers RCP+
  // perfectly (no_card) but 400s GetRecordingSummary, and checking r.ok first
  // threw the good half away and labelled a camera that is plainly online
  // "unreachable". The ONVIF error is still recorded rather than dropped.
  if (!(r && r.detail) && (!r || !r.ok)) {
    await pool.query(
      `UPDATE cameras SET sd_last_check_at = NOW(), sd_status = 'unreachable', sd_error = $2 WHERE id = $1`,
      [cameraId, r?.error || 'unknown']
    ).catch((err) => console.error('  💾 SD status (edge) update error:', err.message));
    return;
  }
  // A Hikvision reporter sends the full picture instead (migration 115). ok:true
  // there means the PROBE worked — the card may still be missing or unformatted,
  // which is detail.state, so sd_status is derived from that rather than being
  // hardcoded to 'ok' the way the ONVIF path can afford to.
  if (r.detail) {
    const st = r.detail.state;
    // Two of the five states are the ones this whole feature exists to expose:
    // a healthy card that is not recording ('idle') and one that is scheduled
    // but still empty ('armed_empty'). Neither is a fault — the card is fine —
    // so sd_status stays 'ok' and the nuance lives in sd_detail_json. Rolling
    // them into 'unreachable' would put 34 Phuket cameras on the Health page's
    // fault list for a condition nobody has decided is wrong.
    const status = st === 'no_card' ? 'no_card'
                 : (st === 'idle' || st === 'armed_empty' || st === 'recording') ? 'ok'
                 : st;                                   // unformatted | error | unknown
    // recording_data_* stay ONVIF's. Filling them from the Hikvision search would
    // make two vendors write the same columns with different meanings, and the
    // Bosch panel reads them expecting GetRecordingSummary semantics.
    //
    // A Bosch message now carries BOTH: the ONVIF summary it always sent plus
    // an RCP+ detail (edge-config-agent pollSdStatusOnce). Before this, `detail`
    // meant "Hikvision" and this branch returned early — attaching a detail to
    // the Bosch payload without also writing the ONVIF columns here would have
    // silently frozen recording_data_* on every Bosch camera, which is the one
    // thing the existing panel reads. Write them only when the message actually
    // carries them, so a detail-only reporter (Hikvision) does not blank them.
    const hasOnvif = r.ok && r.dataUntil !== undefined;
    // Keep the ONVIF complaint visible when only that half failed — the panel
    // has real data to show, but "GetRecordingSummary returns HTTP 400 on this
    // model" is still the sort of thing that should not vanish silently.
    const err = r.ok ? null : (r.error || null);
    await pool.query(
      hasOnvif
        ? `UPDATE cameras SET sd_last_check_at = NOW(), sd_status = $2, sd_error = NULL,
                              sd_detail_json = $3::jsonb, recording_data_from = $4,
                              recording_data_until = $5, recording_count = $6
            WHERE id = $1`
        : `UPDATE cameras SET sd_last_check_at = NOW(), sd_status = $2, sd_error = $4,
                              sd_detail_json = $3::jsonb
            WHERE id = $1`,
      hasOnvif
        ? [cameraId, status, JSON.stringify(r.detail), r.dataFrom ?? null, r.dataUntil ?? null, r.numRec ?? null]
        : [cameraId, status, JSON.stringify(r.detail), err]
    ).catch((err2) => console.error('  💾 SD detail (edge) update error:', err2.message));
    return;
  }
  // dataFrom/dataUntil/numRec are ONVIF-specific (Bosch) — a non-ONVIF reporter (e.g.
  // the Dahua NVR storage-health pilot) sends {ok:true} with none of them, and `pg`
  // throws on an `undefined` bind param (unlike a plain object), so coalesce to null.
  await pool.query(
    `UPDATE cameras SET sd_last_check_at     = NOW(),
                        sd_status            = 'ok',
                        sd_error             = NULL,
                        recording_data_from  = $2,
                        recording_data_until = $3,
                        recording_count      = $4
     WHERE id = $1`,
    [cameraId, r.dataFrom ?? null, r.dataUntil ?? null, r.numRec ?? null]
  ).catch((err) => console.error('  💾 SD status (edge) update error:', err.message));
}

// Applies an edge-reported VCA rule-name check (topic .../Device/vca-rules) for
// edge-site cameras — mirrors applySdStatusResult's split with pollAllVcaRules
// (central-reachable path, direct write, no MQTT round trip). `msg.issues`
// comes from outside this process so it is re-validated here, not trusted
// just because it parsed as JSON.
async function applyVcaRulesResult(cameraId, msg) {
  if (!(msg && msg.ok)) {
    // An unreachable camera this cycle must not CLEAR a known problem — leave
    // vca_rule_issues/vca_rules_checked_at exactly as they were.
    console.warn(`[vca-rules] ${cameraId}: ${(msg && msg.error) || 'unknown'} — keeping last known result`);
    return;
  }
  const issues = validVcaRuleIssues(msg.issues);
  await pool.query(
    `UPDATE cameras SET vca_rule_issues = $2::jsonb, vca_rules_checked_at = NOW() WHERE id = $1`,
    [cameraId, JSON.stringify(issues)]
  ).catch((err) => console.error('  💾 VCA rule names (edge) update error:', err.message));
}

// ขนาด batch concurrent probe — 5 ขนานกัน: worst-case 4s×⌈N/5⌉ < 30s interval
// แม้ทุกกล้อง timeout พร้อมกัน (Phase 2 opt, F3)
const SD_PROBE_CONCURRENCY = 5;

async function pollAllSdStatus() {
  const cams = Object.values(cameraMap);
  if (cams.length === 0) return;
  for (let i = 0; i < cams.length; i += SD_PROBE_CONCURRENCY) {
    await Promise.all(cams.slice(i, i + SD_PROBE_CONCURRENCY).map(pollSdStatusForCamera));
  }
  console.log(`  💾 Recording status polled (${cams.length} cameras)`);
}

// Rule (IVA task) name check — read-only RCP+ (helpers/boschRcp.js
// readTaskNames), same central/edge split as the SD poller above:
// `cam.site` set → edge-site, reported over MQTT instead (Device/vca-rules →
// applyVcaRulesResult); unset/'main' → this process can reach the camera
// directly, so it writes the columns itself.
async function pollVcaRulesForCamera(cam) {
  if (cam.site) return;
  const r = await readTaskNames(cam);
  if (!r.ok) {
    console.warn(`[vca-rules] ${cam.camera_id}: ${r.error} — keeping last known result`);
    return;
  }
  const issues = r.tasks.filter(t => t.problem).map(t => ({ id: t.id, type: t.type, name: t.name, problem: t.problem }));
  await pool.query(
    `UPDATE cameras SET vca_rule_issues = $2::jsonb, vca_rules_checked_at = NOW() WHERE id = $1`,
    [cam.camera_id, JSON.stringify(issues)]
  ).catch((err) => console.error('  💾 VCA rule names update error:', err.message));
}

async function pollAllVcaRules() {
  const cams = Object.values(cameraMap);
  if (cams.length === 0) return;
  for (let i = 0; i < cams.length; i += SD_PROBE_CONCURRENCY) {
    await Promise.all(cams.slice(i, i + SD_PROBE_CONCURRENCY).map(pollVcaRulesForCamera));
  }
}
const VCA_RULES_POLL_INTERVAL_MS = 3600_000; // hourly — same cadence as the edge-side probe

// ============================================================
// MQTT Handlers
// ============================================================

client.on('connect', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  ✅ Connected to MQTT Broker                     ║');
  console.log('║  📸 Snapshot capture enabled (MQTT + HTTP)       ║');
  console.log('║  📋 Camera config: cameras-config.json (live)    ║');
  console.log(`║  🚫 Ignored events: ${IGNORED_EVENT_TYPES.join(', ').padEnd(28, ' ')} ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  // Recording/SD poller — ONVIF Search GetRecordingSummary (Profile G), for
  // cameras this process can reach directly. pollSdStatusForCamera returns
  // early on anything with a site: an edge-site camera is probed by its own
  // edge and arrives over MQTT instead (applySdStatusResult).
  //
  // This comment used to read "Bosch RCP+ 0x0CB5", and both halves were wrong:
  // the call below is ONVIF SOAP, and 0x0CB5 is not the SD-status register
  // either — that is CONF_SD_CARD_STATUS 0x0b89 (spec p.929). No RCP+ code
  // existed anywhere in the repo when it was written. It cost real time this
  // session: it was read as "we already speak RCP+, the plumbing is there",
  // which under-estimated the Bosch storage work by a whole transport. Actual
  // RCP+ now lives in helpers/boschRcp.js and runs on the EDGE, not here.
  setTimeout(pollAllSdStatus, 5000);
  setInterval(pollAllSdStatus, SD_POLL_INTERVAL_MS);
  setTimeout(pollAllVcaRules, 15000);
  setInterval(pollAllVcaRules, VCA_RULES_POLL_INTERVAL_MS);

  ['+/onvif-ej/RuleEngine/#', '+/onvif-ej/VideoSource/#',
   '+/onvif-ej/Device/#', '+/onvif-ej/RecordingConfig/#',
   // Multi-site edge bridge: remote edges bridge their local camera topics under
   // projects/<site>/… (NanoMQ prefix-remap). One wildcard ingests every site —
   // no per-site change here when a site is added (the prefix is stripped below).
   'projects/+/#'].forEach(t => {
    client.subscribe(t, { qos: 0 }, (err) => {
      console.log(err ? `  ❌ ${t}` : `  📌 ${t}`);
    });
  });

  console.log('');
  console.log('⏳ Waiting for messages...');
  console.log('──────────────────────────────────────────────────');
});

client.on('message', async (topic, payload, packet) => {
  try {
    // Skip retained messages — those are the broker's echo of the LAST
    // publish on the topic, replayed to every fresh subscriber. Acting on
    // them after a subscriber restart would: (a) re-insert an event that's
    // already in the DB, (b) refresh last_seen_at falsely so cameras look
    // "online" right after restart even when actually disconnected, and
    // (c) possibly re-fire a LINE alert that already went out live. Bosch
    // IVA event topics are point-in-time and should never be marked retain
    // legitimately — if we see one, it's stale.
    if (packet && packet.retain) {
      if (process.env.DEBUG_MQTT === '1') {
        console.log(`🔍 SKIP retained [${topic}]`);
      }
      return;
    }
    // Debug: ดู raw payload ตั้ง DEBUG_MQTT=1 ใน .env หรือ DEBUG_MQTT=1 npm run subscriber
    if (process.env.DEBUG_MQTT === '1') {
      const txt = payload.toString();
      console.log(`\n🔍 RAW [${topic}] (${txt.length} bytes):`);
      console.log(txt.slice(0, 500) + (txt.length > 500 ? '...[truncated]' : ''));
      console.log('');
    }
    const msg = JSON.parse(payload.toString());
    // Edge-bridged events arrive prefixed projects/<site>/<local-topic>; strip it
    // so the existing per-camera parser treats them like a local camera.
    // (site → events.site_id tagging is Tier-2; the camera must be registered in
    //  cameras-config.json to be ingested, same as a local camera.)
    const stripped = _stripSitePrefix(topic);
    _recordMqttHeartbeat(stripped);
    // NVR scan reply (Phase 3): edge-config-agent → projects/{site}/_config/scan-result.
    // Hand it to api-server (which holds the pending-scan registry) via pg_notify.
    if (stripped.startsWith('_config/scan-result')) {
      pool.query(`SELECT pg_notify('scan_result', $1)`, [JSON.stringify(msg)])
        .catch(err => console.error('[edge] pg_notify scan_result:', err.message));
      return;
    }
    // Model detect reply (OPT5-EDGE-004): edge-config-agent → _config/detect-model-result.
    // No pending-job registry needed (unlike scan-result) — this is background
    // enrichment on Save, not something a UI flow blocks waiting on. Write
    // straight to cameras; model_detected_at/model_detect_error give the
    // audit trail the finding asked for.
    if (stripped.startsWith('_config/detect-model-result')) {
      if (msg.camera_id) {
        const q = msg.model
          ? pool.query(
              `UPDATE cameras SET model=$1, firmware=$2, serial_number=$3, model_detected_at=NOW(), model_detect_error=NULL WHERE id=$4`,
              [msg.model, msg.firmware || null, msg.serial || null, msg.camera_id])
          : pool.query(
              `UPDATE cameras SET model_detected_at=NOW(), model_detect_error=$1 WHERE id=$2`,
              [msg.error || 'unknown error', msg.camera_id]);
        q.catch(err => console.error('[edge] detect-model-result update:', err.message));
      }
      return;
    }
    // Storage scan reply (2026-08-24): edge-config-agent → _config/storage-scan-result
    // edge ไม่มี postgres จึงส่งแค่ขนาด/จำนวน/ไฟล์เก่าสุด ไม่มี orphan
    // เขียนลง storage_stats ด้วย machine = site code เพื่อให้หน้าเดียวดูได้ทุกเครื่อง
    if (stripped.startsWith('_config/storage-scan-result')) {
      if (msg.error) { console.warn(`[edge-storage] ${msg.site}: ${msg.error}`); return; }
      const rows = Array.isArray(msg.results) ? msg.results : [];
      const disk = msg.disk || {};
      (async () => {
        for (const r of rows) {
          await pool.query(
            `INSERT INTO storage_stats
               (machine, category, bytes, bytes_disk, files, oldest_at, partial, disk_total, disk_used, scan_ms, measured_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
             ON CONFLICT (machine, category) DO UPDATE SET
               bytes = $3, bytes_disk = $4, files = $5, oldest_at = $6, partial = $7,
               disk_total = $8, disk_used = $9, scan_ms = $10, measured_at = NOW()`,
            [msg.site, r.category, r.bytes || 0, r.bytesDisk || 0, r.files || 0,
             r.oldestMs ? new Date(r.oldestMs) : null, !!r.partial,
             disk.total_bytes || null, disk.used_bytes || null, r.scanMs || null]
          ).catch(e => console.error('[edge-storage] เขียน storage_stats ไม่สำเร็จ:', e.message));
        }
        console.log(`💾 [edge-storage] ${msg.site}: รับสถิติ ${rows.length} หมวด`);
      })();
      return;
    }
    // Storage purge reply — เก็บไว้ให้ endpoint ที่รออยู่ดึงไปตอบ (ผ่าน pg_notify)
    // ไม่เขียน DB เพราะเป็นผลชั่วคราวของคำสั่งครั้งเดียว ไม่ใช่สถานะที่ต้องคงอยู่
    if (stripped.startsWith('_config/storage-purge-result')) {
      pool.query(`SELECT pg_notify('storage_purge_result', $1)`, [JSON.stringify(msg)])
        .catch(e => console.error('[edge-storage] pg_notify purge ล้มเหลว:', e.message));
      if (msg.error) console.warn(`[edge-storage] ${msg.site} purge: ${msg.error}`);
      else console.warn(`[edge-storage] ${msg.site} purge ${msg.dryRun ? '(dry-run)' : 'จริง'}: ${msg.files} ไฟล์` + (msg.deleted != null ? ` ลบ ${msg.deleted}` : ''));
      return;
    }
    // Camera MQTT push reply (Mosquitto migration B1): edge-config-agent →
    // _config/camera-mqtt-result. The api-server LISTEN handler (fed by this
    // pg_notify) resolves the pending request so the POST route, which is
    // awaiting it, can answer. Only safe scalar fields are logged here — never
    // msg.before/msg.after wholesale, even though pushMqttSettings() never puts
    // a password in them, on the principle that this handler shouldn't have to
    // be the one place trusted to know that.
    if (stripped.startsWith('_config/camera-mqtt-result')) {
      pool.query(`SELECT pg_notify('camera_mqtt_result', $1)`, [JSON.stringify(msg)])
        .catch(e => console.error('[edge-camera-mqtt] pg_notify ล้มเหลว:', e.message));
      if (msg.ok) console.log(`[edge-camera-mqtt] ${msg.camera_id}: applied`);
      else        console.warn(`[edge-camera-mqtt] ${msg.camera_id}: ${msg.error || 'failed'}`);
      return;
    }
    // Delete-media reply (OPT5-EDGE-005): edge-config-agent → _config/delete-media-result.
    // The camera row is already gone by the time this arrives (delete-media is
    // fired after the DB delete) — log-only, this is the audit trail the
    // finding asked for ("return result for audit/health visibility").
    if (stripped.startsWith('_config/delete-media-result')) {
      if (msg.error) console.warn(`[edge] delete-media ${msg.camera_id}: ${msg.error}`);
      else            console.log(`[edge] delete-media ${msg.camera_id}: removed ${msg.dirs_removed} date-dir(s)`);
      return;
    }
    // Edge service control reply (H2). Parked on edge_status so the health page
    // — which polls that already — can show the outcome within a second or two,
    // including a refusal, instead of leaving the operator to infer success from
    // a pm2 uptime reset in a heartbeat up to 60s away.
    if (stripped.startsWith('_config/svc-result')) {
      const siteId = topic.startsWith('projects/') ? topic.split('/')[1] : null;
      if (msg.ok) console.log(`[edge-svc] ${siteId}: ${msg.action} ${msg.name} ok`);
      else        console.warn(`[edge-svc] ${siteId}: ${msg.action} ${msg.name} — ${msg.error || 'failed'}`);
      if (siteId) {
        await pool.query(
          `UPDATE edge_status SET last_svc_result = $2::jsonb WHERE site_id = $1`,
          [siteId, JSON.stringify({ ...msg, at: new Date().toISOString() })]
        ).catch(e => console.warn('[edge-svc] store result:', e.message));
      }
      return;
    }
    if (stripped.startsWith('_config/')) return; // edge config ack — not a camera event
    // EM3: intercept edge heartbeat — read site from raw topic BEFORE strip, return before processMessage
    if (stripped.startsWith('_edge/heartbeat')) {
      const siteId = topic.startsWith('projects/') ? topic.split('/')[1] : null;
      if (siteId) await recordEdgeHeartbeat(siteId, msg).catch(e =>
        console.error('[mqtt] edge heartbeat upsert error:', e.message));
      return;
    }
    // สถานะสายกล้องที่ edge รายงานขึ้นมาเอง — ต้อง return ก่อนด่านตรวจ site ข้างล่าง
    // เหมือน heartbeat เพราะ payload นี้ไม่ใช่ event ของกล้อง (ไม่มี event.camera_id
    // ในรูปที่ด่านนั้นคาดหวัง) ⇒ ถ้าหลุดลงไปจะถูกตีความเป็น event แล้วโดนปฏิเสธ
    if (stripped.startsWith('_edge/camera-status')) {
      const siteId = topic.startsWith('projects/') ? topic.split('/')[1] : null;
      if (siteId) await recordEdgeCameraStatus(siteId, msg).catch(e =>
        console.error('[mqtt] edge camera-status upsert error:', e.message));
      return;
    }
    // Task #16: cross-check the topic's site against the claimed camera's actual
    // site. projects/<site>/ only proves the publisher's ACL was scoped to that
    // namespace — it does NOT stop a payload from claiming a camera_id that
    // belongs to a DIFFERENT site. Reject on mismatch (flipped from warn-only
    // 2026-07-03 after several hours of live traffic across multiple restarts
    // showed zero false positives — every camera's site_id was already
    // correct, so enforcing costs nothing today and closes the impersonation
    // gap going forward). Fail-open on uncertainty: unresolved camera_id,
    // null site_id, or a DB error all pass through unchanged — this only
    // drops a POSITIVELY confirmed mismatch, never guesses.
    const topicSiteId = topic.startsWith('projects/') ? topic.split('/')[1] : null;
    if (topicSiteId) {
      const claimedCameraId = msg._edge ? (msg.event?.camera_id || null) : stripped.split('/')[0];
      if (claimedCameraId) {
        const actualSiteId = await getCamSiteCode(claimedCameraId);
        if (actualSiteId && actualSiteId !== topicSiteId) {
          console.warn(`[mqtt] SITE MISMATCH camera_id=${claimedCameraId} topic_site=${topicSiteId} actual_site=${actualSiteId} — REJECTED (Task #16)`);
          return;
        }
      }
    }

    // Edge pre-normalized events (_edge=1) — bypass processMessage ONVIF normalization
    if (msg._edge) { await handleEdgeEvent(stripped, msg); return; }
    await processMessage(stripped, msg);
  } catch (err) { console.error('Parse:', err.message); }
});

// projects/<site>/<cameraId>/onvif-ej/… → <cameraId>/onvif-ej/… ; non-prefixed
// (local Bosch) topics pass through unchanged. Pure — see self-check at file end.
function _stripSitePrefix(topic) {
  if (!topic.startsWith('projects/')) return topic;
  return topic.split('/').slice(2).join('/');
}

// ── Broker-neutral "camera MQTT message seen" heartbeat (migration 247,
// plan §8 A1) ── replaces checkMqttSilent's dependency on EMQX's connected-
// client list (Bosch cameras never connect to Central — they connect to the
// EDGE broker — so that list never contained them; 904,783 false-positive
// log lines). Any <cam>/onvif-ej/... message (site prefix already stripped)
// updates an in-memory Map; flushed to cameras.last_mqtt_at every 60s in ONE
// batched UPDATE for whichever cameras actually sent something — not a
// per-message DB write.
const _lastMqttAt = new Map(); // cameraId → Date

// Topics the EDGE AGENT publishes on a camera's behalf, not something the
// camera itself sent: Device/heartbeat is a TCP-probe result, Device/sd-status
// and Device/vca-rules are edge-side RCP+/ONVIF probe results republished
// over MQTT so central can see them. All three prove the edge reached the
// camera's HTTP port — none of them prove the camera's own MQTT session is
// alive, so counting them here made checkMqttSilent unable to ever fire for
// an edge camera (found 2026-09-28, GOTCHAS #214).
const AGENT_ORIGINATED_TOPICS = new Set([
  'onvif-ej/Device/heartbeat',
  'onvif-ej/Device/sd-status',
  'onvif-ej/Device/vca-rules',
]);

function _recordMqttHeartbeat(strippedTopic) {
  const slash = strippedTopic.indexOf('/');
  if (slash < 1) return;
  const rest = strippedTopic.slice(slash + 1);
  if (rest.startsWith('onvif-ej/') && !AGENT_ORIGINATED_TOPICS.has(rest)) {
    _lastMqttAt.set(strippedTopic.slice(0, slash), new Date());
  }
}

async function _flushMqttHeartbeats() {
  if (_lastMqttAt.size === 0) return;
  const entries = [..._lastMqttAt.entries()];
  _lastMqttAt.clear(); // snapshot-then-clear so messages during the UPDATE land in the next flush
  try {
    await pool.query(
      `UPDATE cameras c SET last_mqtt_at = v.t
       FROM unnest($1::text[], $2::timestamptz[]) AS v(id, t)
       WHERE c.id = v.id`,
      [entries.map((e) => e[0]), entries.map((e) => e[1])]
    );
  } catch (e) {
    console.warn('[mqtt-heartbeat] flush last_mqtt_at failed:', e.message); // non-fatal — next flush retries with fresh data
  }
}
setInterval(() => { _flushMqttHeartbeats().catch(() => {}); }, 60_000).unref();

// คอลัมน์ที่ยอมให้ edge อัปเดตได้ — allow-list ไม่ใช่ deny-list
// payload มาจากนอกเครื่อง จึงห้ามเอา key ไปต่อ SQL ตรง ๆ เด็ดขาด (SQL injection)
// และห้ามให้แก้ `camera_id` หรือ `reported_by` ซึ่งเป็นตัวระบุตัวตนของแถว
const EDGE_STATUS_COLS = new Set([
  'event_stream', 'snap_stream', 'retry_count',
  'last_event_http_status', 'last_snap_http_status', 'last_error_code',
]);

/**
 * รับสถานะสายกล้องที่ edge รายงานขึ้นมา (migration 155)
 *
 * ต่างจากแถวที่ central เขียนเองตรงที่ `reported_by = 'edge'` — ความเห็นของ central
 * เรื่องกล้องที่อยู่หลัง edge ใช้ไม่ได้ (มันต่อไม่ถึงอยู่แล้ว) แต่ของ edge ใช้ได้จริง
 *
 * ⚠️ ตรวจว่ากล้องเป็นของไซต์นั้นจริงก่อนเขียน — topic `projects/<site>/` พิสูจน์ได้แค่ว่า
 * ผู้ส่งมีสิทธิ์ใน namespace นั้น ไม่ได้พิสูจน์ว่า camera_id ใน payload เป็นของไซต์นั้น
 * (หลักการเดียวกับด่าน Task #16 ของ event ปกติ)
 */
async function recordEdgeCameraStatus(siteId, payload) {
  const camId = payload && payload.camera_id;
  const patch = (payload && payload.patch) || {};
  if (!camId || typeof camId !== 'string') return;

  const keys = Object.keys(patch).filter(k => EDGE_STATUS_COLS.has(k));
  if (!keys.length) return;

  const { rows } = await pool.query(
    `SELECT s.code FROM cameras c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`, [camId]);
  // ⚠️ ต้องรู้จักกล้องก่อนเสมอ — ไม่ใช่ fail-open
  //
  // เหตุผลที่แข็งขึ้นตั้งแต่ migration 156: มี FK ไป `cameras` แบบ ON DELETE CASCADE
  // แล้ว ⇒ insert ของกล้องที่ไม่มีในตารางจะ **throw** ไม่ใช่แค่เขียนแถวกำพร้า
  // ปล่อยผ่านไปแล้วจะกลายเป็น error ทุก 5 วินาทีในล็อกโดยไม่มีใครได้อะไร
  // และแถวสถานะของกล้องที่เราไม่รู้จักก็ไม่มีความหมายอยู่แล้ว
  if (!rows.length) {
    console.warn(`[mqtt] camera-status: ไม่รู้จักกล้อง ${camId} (จาก ${siteId}) — ข้าม`);
    return;
  }
  if (rows[0].code !== siteId) {
    console.warn(`[mqtt] camera-status SITE MISMATCH camera_id=${camId} topic_site=${siteId} actual=${rows[0].code} — ปฏิเสธ`);
    return;
  }

  const cols = ['camera_id', ...keys, 'reported_by', 'updated_at'];
  const vals = [camId, ...keys.map(k => patch[k]), 'edge', new Date()];
  const ph   = cols.map((_, i) => `$${i + 1}`).join(', ');
  const set  = [...keys.map((k, i) => `${k} = $${i + 2}`),
                `reported_by = $${keys.length + 2}`, `updated_at = $${keys.length + 3}`].join(', ');
  await pool.query(
    `INSERT INTO ingester_camera_status (${cols.join(', ')}) VALUES (${ph})
     ON CONFLICT (camera_id) DO UPDATE SET ${set}`, vals);
}

// EM3: upsert edge heartbeat into edge_status (cross-process channel → api-server health endpoint)
async function recordEdgeHeartbeat(siteId, payload) {
  const { ts, pm2 = [], disk = {}, bridge = {}, snapshots = {}, storage = null, tunnel = null,
          retention = null, last_prune = null, inventory = null, spec = null,
          camera_broker_url = null } = payload;
  // camera_broker_url comes from outside the process (edge heartbeat payload,
  // migration 248) — validate before it ever reaches the query, else null.
  const cameraBrokerUrl = validCameraBrokerUrl(camera_broker_url);
  // snapshots inventory (oldest date-dir + count) rides only the ~hourly ticks;
  // COALESCE so the 60s heartbeats in between don't clobber good values with NULL.
  // storage (mounts + mdraid, src/helpers/storageHealth.js) rides every 60s tick
  // same as disk/pm2 — no COALESCE needed, a null sample just means the sampler
  // threw that tick (storageHealth.js itself never throws by design).
  await pool.query(`
    INSERT INTO edge_status
      (site_id, last_seen_at, disk_free_gb, disk_total_gb,
       bridge_forwarded, bridge_dropped, bridge_remote, bridge_local, pm2_json,
       snapshot_oldest, snapshot_dirs, storage_json, retention_json, last_prune_json, inventory_json, host_spec_json, camera_broker_url, updated_at)
    VALUES ($1, to_timestamp($2::bigint / 1000.0), $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, now())
    ON CONFLICT (site_id) DO UPDATE SET
      last_seen_at     = EXCLUDED.last_seen_at,
      disk_free_gb     = EXCLUDED.disk_free_gb,
      disk_total_gb    = EXCLUDED.disk_total_gb,
      bridge_forwarded = EXCLUDED.bridge_forwarded,
      bridge_dropped   = EXCLUDED.bridge_dropped,
      bridge_remote    = EXCLUDED.bridge_remote,
      bridge_local     = EXCLUDED.bridge_local,
      pm2_json         = EXCLUDED.pm2_json,
      snapshot_oldest  = COALESCE(EXCLUDED.snapshot_oldest, edge_status.snapshot_oldest),
      snapshot_dirs    = COALESCE(EXCLUDED.snapshot_dirs,   edge_status.snapshot_dirs),
      storage_json     = EXCLUDED.storage_json,
      retention_json   = EXCLUDED.retention_json,
      -- COALESCE like snapshot_*: a prune result only exists on the hourly tick
      -- that ran one, and the 60s heartbeats in between must not erase it.
      last_prune_json  = COALESCE(EXCLUDED.last_prune_json, edge_status.last_prune_json),
      -- hourly like the prune result, same COALESCE reason
      inventory_json   = COALESCE(EXCLUDED.inventory_json, edge_status.inventory_json),
      -- host spec is static, only updates when edge sends it
      host_spec_json   = COALESCE(EXCLUDED.host_spec_json, edge_status.host_spec_json),
      -- migration 248 — an older edge build simply omits this field; COALESCE
      -- keeps the last known-good URL instead of letting a stale build erase it
      camera_broker_url = COALESCE(EXCLUDED.camera_broker_url, edge_status.camera_broker_url),
      updated_at       = now()
  `, [
    siteId,
    ts || Date.now(),
    disk.free_gb  ?? null,
    disk.total_gb ?? null,
    bridge.forwarded ?? null,
    bridge.dropped   ?? null,
    bridge.remote    ?? null,
    bridge.local     ?? null,
    JSON.stringify(pm2),
    snapshots?.oldest ?? null,
    snapshots?.dirs   ?? null,
    storage ? JSON.stringify(storage) : null,
    retention  ? JSON.stringify(retention)  : null,
    last_prune ? JSON.stringify(last_prune) : null,
    inventory  ? JSON.stringify(inventory)  : null,
    spec ? JSON.stringify(spec) : null,
    cameraBrokerUrl,
  ]);
  await recordHostMetrics(siteId, payload.host, ts, { tunnelUp: tunnel ? (tunnel.active ? 1 : 0) : null });
  // bridge ตกไปเส้นสำรอง (SSH/Cloudflare) นานเกิน 30 นาที → LINE ถึง Dojo-mAn (helpers/bridgePathWatch.js)
  require('./helpers/bridgePathWatch').onHeartbeat(pool, siteId, bridge).catch(e =>
    console.warn('[bridge-path] watch error:', e.message));
}

// ── Host performance series (P1/P2, 2026-07-27) ─────────────────────────
// One row per machine per minute, feeding the performance graphs. Written from
// this process because it is already the only writer of edge_status — a second
// writer racing on the same series would be a needless source of duplicate
// ticks. Never throws outward: the caller is a heartbeat handler, and losing a
// metric must not stop a site being marked alive.
async function recordHostMetrics(source, host, tsMs, extra = {}) {
  if (!host || typeof host !== 'object') return;   // edge still on an older build
  try {
    await pool.query(`
      INSERT INTO metrics_host
        (source, sampled_at, cpu_pct, load_avg_1m, mem_used_mb, mem_total_mb,
         disk_free_gb, disk_total_gb, net_rx_bytes, net_tx_bytes, net_iface, tunnel_up)
      VALUES ($1, to_timestamp($2::bigint / 1000.0), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (source, sampled_at) DO NOTHING
    `, [
      source, tsMs || Date.now(),
      host.cpu_pct ?? null, host.load_avg_1m ?? null,
      host.mem_used_mb ?? null, host.mem_total_mb ?? null,
      host.disk_free_gb ?? null, host.disk_total_gb ?? null,
      host.net_rx_bytes ?? null, host.net_tx_bytes ?? null, host.net_iface ?? null,
      extra.tunnelUp ?? null,
    ]);
  } catch (e) {
    console.warn(`[metrics] ${source}: ${e.message}`);
  }
}

// Tailscale peer status — central-only (see connectivityHealth.js: one call
// from central already reports every peer's Online state). Written as its own
// insert per site rather than merged into that site's own heartbeat row: the
// two run on independent 60s clocks that will not usually land on the same
// sampled_at, so a separate row (mostly null except tailscale_up) is normal,
// not a gap — the reader only ever looks at the column it wants.
async function recordTailscaleStatus(source, online, tsMs) {
  try {
    await pool.query(`
      INSERT INTO metrics_host (source, sampled_at, tailscale_up)
      VALUES ($1, to_timestamp($2::bigint / 1000.0), $3)
      ON CONFLICT (source, sampled_at) DO UPDATE SET tailscale_up = EXCLUDED.tailscale_up
    `, [source, tsMs, online ? 1 : 0]);
  } catch (e) {
    console.warn(`[metrics] tailscale ${source}: ${e.message}`);
  }
}

// Central samples itself on the same 60s beat so both sides of a graph land on
// the same X positions and can be read against each other.
const { sampleHost: sampleCentralHost } = require('./helpers/hostMetrics');
const { sampleTunnel, sampleTailscale } = require('./helpers/connectivityHealth');
sampleCentralHost();                      // prime the CPU delta — first read is null by design

// Tailscale hostnames don't follow the site_id naming 1:1 (vss2-edge vs site
// "vss") — an explicit map beats guessing a pattern that breaks on the next
// site added with a different suffix convention.
const TAILSCALE_PEER_TO_SITE = { 'hdy-edge': 'hdy', 'vss2-edge': 'vss', 'hkt-edge': 'hkt' };

setInterval(() => {
  const now = Date.now();
  let tunnel = null;
  try { tunnel = sampleTunnel(); } catch (e) { console.warn('[metrics] central tunnel:', e.message); }
  recordHostMetrics('central', sampleCentralHost(), now, { tunnelUp: tunnel ? (tunnel.active ? 1 : 0) : null })
    .catch(e => console.warn('[metrics] central:', e.message));

  let ts = null;
  try { ts = sampleTailscale(); } catch (e) { console.warn('[metrics] central tailscale:', e.message); }
  if (ts) {
    recordTailscaleStatus('central', ts.self_online, now).catch(() => {});
    for (const p of ts.peers) {
      const site = TAILSCALE_PEER_TO_SITE[p.hostname];
      if (site) recordTailscaleStatus(site, p.online, now).catch(() => {});
    }
  }
}, 60_000).unref();

// Prune to the retention configured in Settings. Lives in-process on an
// interval rather than in cron or a systemd timer, because a schedule that
// lives outside the repo is exactly what went missing when this platform
// changed OS (GOTCHAS #123) — if this process is running, pruning is happening.
async function pruneHostMetrics() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'metrics_retention_days'`);
    const days = Math.min(730, Math.max(1, parseInt(rows[0]?.value, 10) || 90));
    const r = await pool.query(
      `DELETE FROM metrics_host WHERE sampled_at < now() - ($1 || ' days')::interval`, [String(days)]);
    if (r.rowCount) console.log(`[metrics] pruned ${r.rowCount} rows older than ${days}d`);
  } catch (e) {
    console.warn('[metrics] prune:', e.message);
  }
}
setTimeout(pruneHostMetrics, 120_000).unref();     // once shortly after boot
setInterval(pruneHostMetrics, 3600_000).unref();   // then hourly

// ── how long each camera has held events before delivering them ──
// A camera that loses its link keeps recording and replays afterwards; the
// evidence is already in the table, as the gap between the camera's own
// event_time and our received_at. Rolled into a running maximum per camera
// (migration 116) because the panel that shows it must not run a seven-day
// scan of a 26 GB partitioned table on every open.
//
// The window overlaps the hour deliberately: a run that starts late, or an
// event delivered right on the boundary, would otherwise fall through the gap
// between two scans. Re-reading ten minutes twice costs nothing — the maximum
// is idempotent.
const HOLD_WINDOW = '70 minutes';
// Two minutes filters ordinary jitter — network latency, clock skew between the
// camera and us, our own queueing — from an actual outage-and-replay.
const HOLD_FLOOR = '2 minutes';

async function refreshCameraHold() {
  try {
    const r = await pool.query(
      `WITH recent AS (
         SELECT camera_id,
                max(EXTRACT(EPOCH FROM (received_at - event_time)))::int AS hold,
                max(received_at) AS at
           FROM events
          WHERE event_time > now() - $1::interval
            AND received_at - event_time > $2::interval
          GROUP BY camera_id
       )
       UPDATE cameras c
          SET max_hold_sec = r.hold, max_hold_at = r.at
         FROM recent r
        WHERE c.id = r.camera_id
          AND (c.max_hold_sec IS NULL OR r.hold > c.max_hold_sec)`,
      [HOLD_WINDOW, HOLD_FLOOR]);
    if (r.rowCount) console.log(`[hold] new maximum on ${r.rowCount} camera(s)`);
  } catch (e) {
    console.warn('[hold] refresh:', e.message);
  }
}
setTimeout(refreshCameraHold, 180_000).unref();
setInterval(refreshCameraHold, 3600_000).unref();

// Central passthrough for pre-normalized edge events (LOGIC_edge-ingester-divergence.md).
// When msg._edge is truthy, skip processMessage ONVIF normalization and INSERT verbatim.
async function handleEdgeEvent(_topic, msg) {
  const ev = msg.event;

  // HC1 (HCP face matches) publishes with camera_id=null; resolve hcp_index here
  let cameraId = ev.camera_id;
  if (!cameraId && ev.raw_json?.hcp_index) {
    const hcpIndexRaw = parseInt(ev.raw_json.hcp_index, 10);
    if (!Number.isFinite(hcpIndexRaw)) {
      console.warn(`[hcp-edge] invalid hcp_index: ${ev.raw_json.hcp_index}`);
      cameraId = null;
    } else {
      try {
        const mapResult = await pool.query(
          'SELECT camera_id FROM hcp_camera_map WHERE hcp_index = $1 AND site_id = $2 LIMIT 1',
          [hcpIndexRaw, 'hkt'] // HC-scope: HKT-only per spec §HC; change here when adding multi-site
        );
        if (mapResult.rows[0]) {
          cameraId = mapResult.rows[0].camera_id;
        } else {
          // Unmapped HCP camera — allow through with null so gap is visible in data
          cameraId = null;
          console.warn(`[hcp-edge] unmapped hcp_index=${hcpIndexRaw}`);
        }
      } catch (err) {
        console.error(`[hcp-edge] camera map lookup failed: ${err.message}`);
        cameraId = null;
      }
    }
  }

  // For non-HCP edge events, camera_id must be present. For HCP (camera_id=null),
  // allow through — unmapped cameras become visible NULL rows in events table.
  if (!cameraId && !ev.raw_json?.hcp_index) {
    console.warn('[edge] malformed _edge payload: missing camera_id and no hcp_index');
    return;
  }

  // Task #19: cameraMap only holds Bosch cameras (see loadCameraConfig), so
  // cameraMap[cameraId] is always undefined here — this function only ever
  // handles non-Bosch edge-relayed events. Go straight to the DB-backed flag
  // (same cache processMessage's Bosch path effectively gets via cameraMap).
  // Skip for unmapped HCP cameras (camera_id=null) — they land as visible rows.
  if (cameraId) {
    if ((await getCamFlags(cameraId)).paused) return;
    await ensureCamera(cameraId);
    await touchCamera(pool, cameraId);
  }

  const previewRef    = msg._preview_ref   || null;
  const previewFull   = msg._preview_full  || null;
  const previewLib    = msg._preview_lib   || null;
  const previewSource = msg._preview_source || null;
  const rawJson = {
    ...(ev.raw_json || {}),
    _edge_vendor: msg._edge_vendor,
    ...(previewRef  ? { _snapshot: previewRef, _snapshot_source: previewSource } : {}),
    ...(previewFull ? { _snapshot_full: previewFull } : {}),
    ...(previewLib  ? { _snapshot_ref: previewLib } : {}),
  };

  // PII ที่ edge ส่งมาดิบ ๆ ต้องเข้ารหัสที่นี่ก่อนแตะฐานข้อมูล (เจ้าของเลือก 2026-08-08)
  //
  // BLACKLIST_SECRET_KEY เป็นคนละ key กับ CAMERA_SECRET_KEY โดยตั้งใจ (spec §4.3) —
  // camera key รั่วต้องไม่พลอยเปิด PII · จึงเก็บ key ไว้ที่ central ที่เดียว แทนที่จะ
  // แจกไปทุก edge ที่ต่อ HCP · ระหว่างทางวิ่งบน wss:// และ edge ไม่เขียนลงดิสก์
  //
  // ฟิลด์ _plain ถูกลบทิ้งเสมอ ไม่ว่าเข้ารหัสสำเร็จหรือไม่ — ล้มเหลวแล้วยอมเสียข้อมูล
  // ดีกว่าเก็บ PII เป็น plaintext ลงตารางที่มีคนอ่านได้กว้างกว่า
  // ลบคีย์ทิ้งทุกกรณีที่มันมีอยู่ ไม่ใช่เฉพาะตอนมีค่า — ค่า null ที่ค้างไว้ไม่ได้
  // ทำให้ PII รั่ว แต่ทำให้คนที่มาตรวจตารางภายหลังต้องมานั่งไล่ว่ามี plaintext ไหม
  if ('hcp_person_code_plain' in rawJson) {
    const plain = rawJson.hcp_person_code_plain;
    delete rawJson.hcp_person_code_plain;
    if (plain) {
      try {
        rawJson.hcp_person_code = encryptPii(String(plain));
      } catch (e) {
        console.warn('[hcp-edge] เข้ารหัส person code ไม่ได้ จึงทิ้งค่านั้นไป:', e.message);
      }
    }
  }
  // Auto-populate face_blacklist.hcp_person_id on first sighting, while the HCP
  // name still matches the enrolled label, so a later HCP rename doesn't break
  // ID-based reference-image resolution. Fire-and-forget, HCP-only (~1/day),
  // non-throwing — never blocks event ingest.
  if (rawJson.hcp_person_id && rawJson.hcp_person_name) {
    pool.query(
      `UPDATE face_blacklist SET hcp_person_id = $1
         WHERE label = $2 AND hcp_person_id IS DISTINCT FROM $1`,
      [String(rawJson.hcp_person_id), String(rawJson.hcp_person_name)]
    ).catch(err => console.warn('[hcp-edge] face_blacklist hcp_person_id upsert:', err.message));
  }
  // Dahua NVR face channel: derive the Hikvision-convention listType from the
  // NVR's own similarity score (data.Sim, 0-100) so the Face page + counters
  // segment blacklist (≥70 → เฝ้าระวัง) vs miss (< 70 → ไม่รู้จัก). The NVR did
  // the compare; we just translate its verdict.
  if (ev.event_type === 'FaceDetector/Comparison') {
    const sim = ev.raw_json?.data?.Sim;
    rawJson.listType = faceComparisonListType(sim);
    // Bug found 2026-08-18 (first-ever live Sim>=70 match, event 19721191,
    // showed 9300% on the Face modal): dahua-cgi.js already normalizes this
    // to Hikvision's 0-1 convention (Sim/100) before it reaches here — this
    // line was clobbering that with the raw 0-100 value, so the frontend's
    // ×100 display doubled up. Match the same /100 convention instead of
    // reintroducing the raw scale.
    if (sim != null) rawJson.similarity = Number(sim) / 100;
  }

  let eventId;
  try {
    let result;
    // dedup guard — เดิมรองรับแค่ people-counting ที่คีย์อยู่ใน raw_json.window_start
    // HC1 ต้องใช้ด้วยแต่คีย์คนละชื่อ: HCP ไม่มี record id ที่เสถียร (recordIndexCode
    // เป็น -1 ทุกแถว) จึงต้องประกอบคีย์เอง · เลยรับ {field,value} เพิ่ม แทนที่จะ
    // ยัดคีย์ใบหน้าลงช่องชื่อ window_start ซึ่งจะอ่านผิดความหมายไปตลอด
    const dedupField = msg.dedup?.field || (msg.dedup?.window_start ? 'window_start' : null);
    const dedupValue = msg.dedup?.value ?? msg.dedup?.window_start ?? null;
    if (dedupField && dedupValue) {
      result = await pool.query(
        `INSERT INTO events
           (camera_id, event_category, event_type, rule_name,
            object_id, object_class, likelihood, event_state, raw_json, event_time)
         SELECT $1::varchar,$2,$3::varchar,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz
          WHERE NOT EXISTS (
            SELECT 1 FROM events
             WHERE camera_id=$1::varchar AND event_type=$3::varchar
               AND raw_json->>($11::text)=($12::text))
         RETURNING id`,
        [cameraId, ev.event_category, ev.event_type, ev.rule_name,
         ev.object_id ?? null, ev.object_class ?? null, ev.likelihood ?? null,
         ev.event_state ?? null, JSON.stringify(rawJson), ev.event_time,
         dedupField, dedupValue]
      );
    } else {
      result = await pool.query(
        `INSERT INTO events
           (camera_id, event_category, event_type, rule_name,
            object_id, object_class, likelihood, event_state, raw_json, event_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         RETURNING id`,
        [cameraId, ev.event_category, ev.event_type, ev.rule_name,
         ev.object_id ?? null, ev.object_class ?? null, ev.likelihood ?? null,
         ev.event_state ?? null, JSON.stringify(rawJson), ev.event_time]
      );
    }
    if (!result.rows[0]) return; // dedup hit — silent
    eventId = result.rows[0].id;
  } catch (err) { console.error('[edge] DB INSERT:', err.message); return; }

  if (previewRef) {
    await pool.query(
      `UPDATE events SET snapshot_filename=$1, has_snapshot=TRUE WHERE id=$2`,
      [previewRef, eventId]
    ).catch(() => {});
  }

  // Phase 1 (AuraFace-v1, Internal Test Only) — enqueue เท่านั้น ไม่ embed สดตรงนี้
  // (audit เตือนไว้: ห้ามเอาอะไรมาหน่วง hot path ของ ingest) worker แยกต่างหาก
  // (face-embed-worker.js) จะดึงคิวไปประมวลผลเอง · เฉพาะ hkt เพราะโมเดล AuraFace-v1
  // อยู่บน edge เครื่องนั้นเครื่องเดียว — ผูก .then/.catch ไม่ await กันช้าแม้แต่
  // นิดเดียวจากจุดนี้เป็นต้นไป
  //
  // ขอบเขต event_type: ตอนแรก copy CAPTURE_TYPES_SQL ของ faces.js มา (FaceCapture /
  // FaceDetector/Recognized) แต่ตัวนั้นตอบคำถามคนละเรื่อง (แสดงในแกลเลอรีอะไรบ้าง)
  // — Advisor audit ชี้ว่า FaceDetector/Comparison (ผลเทียบจาก Dahua NVR เอง, บรรทัด
  // ~921 ด้านบน) ก็มี previewRef เหมือนกัน และเป็นประเภทที่ตั้งใจให้ตรวจ blacklist
  // มากที่สุด จึงเพิ่มเข้ามาด้วย
  if (previewRef && (ev.event_type === 'FaceCapture' || ev.event_type === 'FaceDetector/Recognized'
      || ev.event_type === 'FaceDetector/Comparison')) {
    getCamSiteCode(cameraId).then((siteCode) => {
      if (siteCode !== 'hkt') return;
      // Dedup: 41.9% of captures on the same camera fire within 3s of the
      // previous one (same person still in frame) — measured 2026-08-10,
      // real cost was a growing face_embed_queue backlog the single-core
      // edge could never catch up on. First cut used a "WHERE NOT EXISTS
      // within 3s" check-then-insert — raced under real concurrent MQTT
      // delivery (multiple faces at the same event_time each passed the
      // check before any committed) and barely suppressed anything in
      // practice. Fixed-width 3s bucket + a real UNIQUE constraint
      // (migration 139) instead — atomic, the database rejects the second
      // insert outright, no window for two checks to both see "not exists".
      const timeBucket = Math.floor(new Date(ev.event_time).getTime() / 3000);
      return pool.query(
        `INSERT INTO face_embed_queue (event_id, event_time, rel_path, model_name, camera_id, time_bucket)
         VALUES ($1,$2,$3,'auraface-v1',$4,$5)
         ON CONFLICT DO NOTHING`,
        [eventId, ev.event_time, previewRef, cameraId, timeBucket]
      );
    }).catch(err => console.error('[edge] face-embed enqueue:', err.message));
  }

  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
    .catch(err => console.error('[edge] pg_notify new_event:', err.message));

  // face-capture appearance (Hik EDGE_MODE=1). Started as
  // {object_class,confidence,gender,glasses}; widened 2026-08-02 because
  // mixedTargetDetection carries the body of the same target beside the face,
  // so the row can be filled instead of leaving Appearance Search nothing to
  // match on. Every added field is read with `?? null`, so an edge still
  // running the older publisher inserts exactly what it did before — the two
  // sides do not have to be deployed together.
  if (msg.appearance) {
    const a = msg.appearance;
    pool.query(
      `INSERT INTO appearances
         (event_id, camera_id, object_class, confidence, gender, glasses,
          upper_color, lower_color, top_category, bottom_category, bag_category, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [eventId, cameraId, a.object_class ?? null, a.confidence ?? null, a.gender ?? null, a.glasses ?? null,
       a.upper_color ?? null, a.lower_color ?? null, a.top_category ?? null,
       a.bottom_category ?? null, a.bag_category ?? null,
       a.attributes ? JSON.stringify(a.attributes) : null]
    ).catch(err => console.error('[edge] appearance insert:', err.message));
  }

  // LPR edge (Hik lpr-core EDGE_MODE=1 — format matches license_plates columns 1:1)
  if (msg.license_plate) {
    const lp = msg.license_plate;
    pool.query(
      `INSERT INTO license_plates
         (event_id, camera_id, plate_number, confidence, country, region,
          vehicle_type, vehicle_color, vehicle_brand, plate_type,
          bbox_x, bbox_y, bbox_width, bbox_height,
          vehicle_bbox_x, vehicle_bbox_y, vehicle_bbox_width, vehicle_bbox_height,
          plate_image,
          plate_color, no_helmet, rider_count, plate_char_believe, license_bright,
          no_seatbelt,
          lane_no, pillion,
          detected_at, plate_identified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
               COALESCE($28::timestamptz, now()),
               ${helmet.stampSql('$29', '$30', '$31')})`,
      [eventId, cameraId,
       lp.plate_number ?? null, lp.confidence ?? null, lp.country ?? null, lp.region ?? null,
       lp.vehicle_type ?? null, lp.vehicle_color ?? null, lp.vehicle_brand ?? null, lp.plate_type ?? null,
       lp.bbox_x ?? null, lp.bbox_y ?? null, lp.bbox_width ?? null, lp.bbox_height ?? null,
       // migration 117 — vehicle-level box (<vehicelRect>), same shape as the plate bbox above
       lp.vehicle_bbox_x ?? null, lp.vehicle_bbox_y ?? null, lp.vehicle_bbox_width ?? null, lp.vehicle_bbox_height ?? null,
       lp.plate_image ?? null,
       // #085/#090 perf — populated from the same raw_json the backfill/stats read (single
       // source). riderCount is Dahua ITC431-only (edge; central-direct path in dahua-cgi.js
       // mirrors this) — null for Hikvision/ITC237, never inferred from silence.
       rawJson?.plateColor ?? null, rawJson?.helmet === 'no', rawJson?.riderCount ?? null,
       // migration 108 — Hikvision-only fields that used to live solely in
       // rawXml. Read from the payload first, falling back to raw_json so an
       // edge running older code still lands them once it forwards raw_json.
       lp.plate_char_believe ?? rawJson?.plateCharBelieve ?? null,
       lp.license_bright ?? rawJson?.licenseBright ?? null,
       // Seatbelt was missing from this INSERT entirely, so every plate that
       // came through an edge left the column NULL — all of them. Payload
       // first, raw_json second, same as the two above, so an edge on older
       // code lands it as soon as it forwards either.
       //
       // `?? null` and NOT `|| false`: NULL means "nobody looked", false means
       // "looked, they were belted". Dahua takes a different path and reports
       // no seatbelt at all, so defaulting to false here would turn 49% of the
       // fleet's silence into a claim that every one of those drivers was
       // wearing one.
       lp.no_seatbelt ?? rawJson?.noSeatbelt ?? null,
       // detected_at is the time the CAMERA saw the plate, not the time this row
       // was written. It defaulted to now(), which is the same thing for a
       // central-direct insert and is the ARRIVAL time for anything that came
       // through an edge spool: measured 2026-07-31, 1.2% of rows were stamped
       // ~10 minutes late (hdy 588s, hkt 687s), and 1.39% of a month landed in
       // the wrong hour bucket on the LPR stats charts because of it.
       // COALESCE in the SQL, not `?? now()` here: passing NULL explicitly
       // OVERRIDES a column default in Postgres, it does not fall back to it —
       // so an edge that ever publishes without event_time would write
       // detected_at IS NULL and drop the row out of every range query.
       // migration 194 — เลน/คนซ้อนท้าย จาก raw_json แหล่งเดียวกับที่ตัวกรองเคยอ่าน
       // (#085/#090 pattern) · text ตามค่าดิบ: 'unknown' ≠ NULL (ไม่รายงาน)
       rawJson?.laneNo != null ? String(rawJson.laneNo) : null,
       rawJson?.nonMotorManned ?? null,
       ev.event_time ?? null,
       // $29-$31 — ค่าสำหรับตรึงผล "พร้อมข้อมูลทะเบียน" (ดูหมายเหตุที่ stampSql)
       helmet.plateMatches(lp.plate_number), lp.confidence ?? null, cameraId]
    ).catch(err => console.error('[edge] license_plate insert:', err.message));
    // #089 perf — denormalize onto events so stats.js can filter without joining license_plates
    if (lp.vehicle_type) {
      pool.query(`UPDATE events SET vehicle_type = $1 WHERE id = $2`, [lp.vehicle_type, eventId])
        .catch(err => console.error('[edge] events.vehicle_type update:', err.message));
    }
  }

  if (msg.alert) {
    pool.query(
      `SELECT pg_notify('alert_event', $1)`,
      [JSON.stringify({ ...msg.alert, camera_id: cameraId, event_id: eventId, snapshot_filename: previewRef })]
    ).catch(err => console.error('[edge] pg_notify alert_event:', err.message));
  }

  if (msg.clip) {
    pool.query(
      `SELECT pg_notify('event_for_clip', $1)`,
      [JSON.stringify({ ...msg.clip, event_id: eventId })]
    ).catch(err => console.error('[edge] pg_notify event_for_clip:', err.message));
  }

  console.log(`[edge] ${cameraId} ${msg._edge_vendor} ${ev.event_type} rule:${ev.rule_name ?? '-'} class:${ev.object_class ?? '-'} snap:${previewRef ? 'yes' : 'no'} id:${eventId}`);
}

// err.message อาจว่างตอน broker teardown — fallback เป็น code/error เต็ม
// เพื่อไม่ให้ log บรรทัดว่าง (incident 2026-06-07, audit A5)
client.on('error', (err) => console.error('❌ MQTT:', err.message || err.code || err));

// ============================================================
// Process Message
// ============================================================

async function processMessage(topic, msg) {
  const parts = topic.split('/');
  const cameraId = parts[0];
  const category = parts[2];
  const subParts = parts.slice(3);

  // Skip paused cameras entirely — don't update last_seen so watchdog
  // keeps the camera in paused state and doesn't flip it online
  if (cameraMap[cameraId]?.paused) return;

  // Touch camera last_seen แม้จะ filter event ออก
  // (เพื่อให้รู้ว่ากล้อง online อยู่ — MotionAlarm/JobState ก็นับเป็น keepalive)
  await ensureCamera(cameraId);
  await touchCamera(pool, cameraId);

  // 🚫 Filter out ignored event types (after touch, so heartbeat ยังทำงาน)
  if (IGNORED_EVENT_TYPES.some(ignored =>
      subParts[0] === ignored || topic.includes(`/${ignored}/`))) {
    return; // skip silently
  }

  // Always store as UTC ISO string — กัน timezone confusion
  // msg.UtcTime จาก ONVIF Profile M เป็น UTC อยู่แล้ว
  const eventTimeDate = msg.UtcTime ? new Date(msg.UtcTime) : new Date();
  const eventTime = eventTimeDate.toISOString(); // -> "2026-04-30T09:50:00.000Z"

  const videoSource = msg.Source?.VideoSource || msg.Source?.Source || null;
  const ruleName = msg.Source?.Rule || null;

  let eventType = subParts.join('/');

  // Per-camera suppression (e.g. GlobalSceneChange noise on specific cameras).
  // Loaded from cameraMap (dual-written by PUT /api/cameras) — checked before
  // storage so suppress kills DB row + HTTP snapshot + LINE alert together.
  // NOTE: must be after `let eventType` — using it before declaration caused TDZ bug.
  const camIgnore = cameraMap[cameraId]?.ignore_event_types;
  if (Array.isArray(camIgnore) && camIgnore.length > 0) {
    if (camIgnore.some(t => eventType === t || eventType.startsWith(t + '/') || topic.includes('/' + t + '/'))) {
      return; // suppress per-camera
    }
  }
  // Edge HTTP snapshot (base64) — save to disk + link to event, skip normal event insert
  if (eventType === 'snapshot') {
    await saveEdgeSnapshot(cameraId, msg);
    return;
  }

  // Periodic full-scene tile preview from edge — update cameras.tile_snap_file so
  // serveLatestSnapshot serves a scene image instead of a face/event crop.
  if (eventType === 'preview') {
    if (msg.snapshot_file) {
      pool.query(
        `UPDATE cameras SET tile_snap_file=$1, tile_snap_ts=NOW() WHERE id=$2`,
        [msg.snapshot_file, cameraId]
      ).catch(err => console.error('[preview] DB:', err.message));
    } else if (msg.unsupported) {
      // The edge has decided this camera cannot produce a still. Clearing the
      // pointer is the whole fix: serveLatestSnapshot prefers tile_snap_file
      // over everything, so a stale one kept a 0-byte file winning over the
      // scene image sitting in the step below it.
      pool.query(
        `UPDATE cameras SET tile_snap_file=NULL, tile_snap_ts=NULL
          WHERE id=$1 AND tile_snap_file IS NOT NULL RETURNING id`, [cameraId]
      ).then(r => { if (r.rowCount) console.log(`  🖼  ${cameraId}: กล้องถ่าย tile ไม่ได้ — ล้างค่าเดิม ใช้ภาพเหตุการณ์ล่าสุดแทน`); })
       .catch(err => console.error('[preview] DB:', err.message));
    }
    return;
  }

  // Edge-reported SD/recording status (edge-site cameras only — see pollSdStatusForCamera).
  if (eventType === 'sd-status') {
    await applySdStatusResult(cameraId, msg);
    return;
  }

  // Edge-reported VCA rule-name check (edge-site cameras only — see pollAllVcaRules
  // for the central-reachable path, which writes directly, no MQTT round trip).
  if (eventType === 'vca-rules') {
    await applyVcaRulesResult(cameraId, msg);
    return;
  }

  let objectId = null, objectClass = null, likelihood = null;
  let speed = null, geoLat = null, geoLon = null, geoElev = null;
  let state = null, count = null;
  let mqttSnapshotB64 = null;

  if (category === 'RuleEngine') {
    const detector = subParts[0];
    const sub = subParts[1];
    eventType = `${detector}/${sub}`;

    // Object payload shape per ONVIF Profile M. Bosch FW 9.x (8100i/3100i)
    // and Bosch IVA Basic on older firmware (8000i and the 7000-series)
    // both nest as msg.Data.Object.Object — that's the canonical shape.
    // Some non-Bosch ONVIF cameras emit a flatter msg.Data.Object so we
    // include that as a fallback. The Pro path hits the first branch and
    // short-circuits, so this never changes 8100i/3100i behaviour.
    const obj = msg.Data?.Object?.Object || msg.Data?.Object || null;
    if (obj && typeof obj === 'object') {
      objectId = obj['@ObjectId'] ?? null;
      // IVA Basic CAN produce object_class / likelihood / speed / geo —
      // but ONLY after the operator has run Camera Calibration + Object
      // Calibration in Bosch CM. Without calibration the fields are
      // simply absent → null. That's expected, not a bug. The event row
      // still flows in normally because every extraction below is
      // optional-chained.
      objectClass = obj?.Appearance?.Class?.Type?.['#text'] ?? null;
      likelihood = obj?.Appearance?.Class?.Type?.['@Likelihood'] ?? null;
      speed = obj?.Behaviour?.Speed ?? null;
      geoLat = parseFloat(obj?.Appearance?.GeoLocation?.['@lat']) || null;
      geoLon = parseFloat(obj?.Appearance?.GeoLocation?.['@lon']) || null;
      geoElev = parseFloat(obj?.Appearance?.GeoLocation?.['@elevation']) || null;

      // 🆕 Snapshot fallback chain — ครอบคลุมหลาย firmware/vendor.
      // Bosch IVA Pro FW 9.80.106 sends `Appearance.Image` as a BARE
      // BASE64 STRING (not an object with .Data / .#text subfield), so
      // the string check has to come first — the older object-shaped
      // checks below still cover XML-style ONVIF and Bosch's legacy
      // firmware which use the wrapped form.
      const _str = (v) => (typeof v === 'string' && v.length > 100) ? v : null;
      mqttSnapshotB64 =
        _str(obj?.Appearance?.Image) ||         // Bosch IVA Pro FW 9.x  ← new
        obj?.Appearance?.Image?.Data ||         // IVA Pro 3D (object form)
        obj?.Appearance?.Image?.['#text'] ||    // XML-style ONVIF
        _str(obj?.Appearance?.Snapshot) ||      // Bosch firmware เก่า
        null;
    }

    // Fallback ระดับ msg.Data (บางกล้อง / event types)
    if (!mqttSnapshotB64) {
      const _str = (v) => (typeof v === 'string' && v.length > 100) ? v : null;
      mqttSnapshotB64 =
        _str(msg.Data?.Image) ||                // string form (new)
        msg.Data?.Image?.Data ||                // generic ONVIF (object)
        msg.Data?.Image?.['#text'] ||           // XML-style
        _str(msg.Data?.Snapshot) ||             // shorthand string
        msg.Data?.Picture?.Data ||              // alternative naming
        null;
    }

    if (detector === 'CountAggregation') count = msg.Data?.Count ?? null;
    if (detector === 'FieldDetector') state = String(msg.Data?.Status ?? msg.Data?.IsInside ?? 'unknown');

    if (detector === 'Recognition') {
      // 🆕 Recognition (LPR) snapshot — รองรับหลาย field
      mqttSnapshotB64 =
        msg.Data?.LicensePlateInfo?.Snapshot ||
        msg.Data?.LicensePlateInfo?.Image?.Data ||
        msg.Data?.VehicleInfo?.Image?.Data ||
        mqttSnapshotB64;
      const plate = msg.Data?.LicensePlateInfo?.LicensePlateInfo;
      console.log(`  🚗 [${cameraId}] LPR | Plate: ${plate?.PlateNumber?.['#text'] ?? '?'} | Rule: ${ruleName}`);
    } else {
      console.log(`  📊 [${cameraId}] ${eventType} | ${objectClass || state || `Count:${count}`} | Rule: ${ruleName}`);
    }
  } else if (category === 'IVA') {
    // Bosch publishes IVA rules on their OWN topic tree, parallel to
    // RuleEngine — see docs/vendor/bosch/ONVIF_Profile_M_MQTT_Event_Broker_TechNote.pdf
    // §3.2. These rows were already being INSERTed (the projects/+/# wildcard
    // catches them from every edge site), but with no branch here their
    // Data.State never reached the event_state column: 21,766 IVA rows in one
    // week, every one of them blank, while raw_json plainly held
    // {"Data":{"State":"false"}}. Anything filtering or alerting on
    // event_state was therefore blind to IVA entirely.
    //
    // One generic read rather than a per-rule switch: the TechNote documents
    // nine IVA rules (ObjectInField, Loitering, CrowdDetection, EnteringField,
    // LeavingField, IdleObject, RemovedObject, FollowRoute, Counter) and all
    // nine carry the same {Data:{State}} shape — and production is already
    // sending a tenth the document doesn't list at all (CrossingLine, 27k rows
    // from BSH-HDY-4038), which this handles for free. Enumerating rule names
    // would have missed it.
    state = String(msg.Data?.State ?? 'unknown');
    console.log(`  🎯 [${cameraId}] IVA/${eventType} | State: ${state}`);
  } else if (category === 'VideoSource') {
    state = String(msg.Data?.State ?? 'unknown');
    console.log(`  📹 [${cameraId}] VideoSource/${eventType} | State: ${state}`);
  } else if (category === 'Device') {
    state = String(msg.Data?.LogicalState ?? 'unknown');
    console.log(`  ⚡ [${cameraId}] Device/${eventType} | State: ${state}`);
  } else if (category === 'RecordingConfig') {
    state = msg.Data?.State ?? 'unknown';
    eventType = 'JobState';
    console.log(`  🔴 [${cameraId}] Recording | State: ${state}`);
  }

  let eventId;
  try {
    // 🆕 Strip base64 / large strings ก่อนเก็บลง raw_json — กัน DB บวม
    const cleanMsg = stripLargeStrings(msg);

    // Only insert columns present in canonical events schema.
    // topic/video_source/speed/geo_*/count are preserved inside raw_json
    // for any downstream readers that need them.
    const result = await pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood,
        event_state, raw_json, event_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [cameraId, category, eventType, ruleName,
       objectId, objectClass, likelihood,
       state, JSON.stringify(cleanMsg), eventTime]
    );
    eventId = result.rows[0].id;
  } catch (err) { console.error('  DB:', err.message); return; }

  let snapshotFilename = null, snapshotSource = null;

  // Phase 6.1.4 — per-camera media flags (enable_snapshot + enable_vca_overlay)
  const camFlags = await getCamFlags(cameraId);

  if (mqttSnapshotB64 && camFlags.enable_snapshot && camFlags.snapshot_mode !== 'http_only') {
    // MQTT-embedded snapshot has no overlay knob (camera-side bake-in is HTTP-only).
    // Honour enable_snapshot but VCA overlay flag is N/A here.
    const snap = saveMqttSnapshot(cameraId, eventId, mqttSnapshotB64);
    if (snap) { snapshotFilename = snap.filename; snapshotSource = 'mqtt'; }
  }

  const shouldHttp = ['LineDetector', 'FieldDetector', 'ObjectDetection',
    'ObjectTrack', 'Recognition', 'GlobalSceneChange'].some(t => eventType.includes(t) || topic.includes(t));

  // skip snapshot for state=false (object left field / rule cleared) — only capture on enter
  const isLeaveEvent = state === 'false' || state === 'False';

  // Bosch IVA "Aggregation" events are end-of-track summaries — they fire AFTER
  // the tracked object has already exited the scene. Capturing a snapshot at
  // this point gives an empty frame even though object_class shows "Person".
  // The original detection moment was already snapshotted by the corresponding
  // LineDetector/Crossed or FieldDetector event that fired earlier.
  const isAggregationEvent = eventType.includes('Aggregation') || topic.includes('Aggregation');

  let snapshotFullFilename = null;
  if (shouldHttp && !isLeaveEvent && !isAggregationEvent && camFlags.enable_snapshot
      && camFlags.snapshot_mode !== 'mqtt_only') {
    if (!snapshotFilename) {
      // No MQTT body crop → HTTP is the primary snapshot (existing behaviour)
      const snap = await captureHttpSnapshot(cameraId, eventId, { withOverlay: camFlags.enable_vca_overlay });
      if (snap) { snapshotFilename = snap.filename; snapshotSource = 'http'; }
    } else if (eventType.startsWith('ObjectDetection')) {
      // MQTT body crop already saved → also capture HTTP full-scene as _snapshot_full
      // so the face-gallery modal can show crop (left) + full scene (right)
      const snap = await captureHttpSnapshot(cameraId, eventId, { withOverlay: camFlags.enable_vca_overlay });
      if (snap) { snapshotFullFilename = snap.filename; }
    }
  }

  if (snapshotFilename) {
    const extra = snapshotFullFilename ? { _snapshot_full: snapshotFullFilename } : {};
    // Must not clobber a metadata crop that already won this row. The two writes
    // race: the edge publishes its snapshot message the moment the crop is cut,
    // so the meta UPDATE (~1750) can land while this handler is still inside the
    // `await captureHttpSnapshot()` above — hundreds of ms wide. `||` lets the
    // right side win, so an unguarded write put the camera's own MQTT thumbnail
    // back over a crop that was already applied.
    //
    // Repro 2026-08-20 (live, BOSCH_8100iX_02 @ vss, object 701693):
    //   17:15:00.229  MQTT thumbnail saved      event_mqtt_1787220900229.jpg
    //   17:15:00.232  🎯 Meta: object 701693 → 1 event(s)   ← crop applied
    //   after         this UPDATE ran → row back to _snapshot_source='mqtt'
    // Fingerprint in the data: rows carrying `_bbox` (written only by the meta
    // UPDATE) whose image is still 'mqtt' — 3,934 on BSH-HDY-4031 in 24h against
    // 383 survivors. vss3 escaped only because that camera rarely embeds a
    // preview at all, so there was nothing to overwrite with.
    //
    // `_snapshot_full` is unaffected: the full scene and the crop answer
    // different questions and the modal shows both.
    await pool.query(
      `UPDATE events
          SET raw_json = raw_json
                || CASE WHEN (raw_json->>'_snapshot_source') = 'edge-meta'
                        THEN $1::jsonb - '_snapshot' - '_snapshot_source'
                        ELSE $1::jsonb END,
              snapshot_filename = CASE WHEN (raw_json->>'_snapshot_source') = 'edge-meta'
                                       THEN snapshot_filename ELSE $2 END,
              has_snapshot = TRUE
        WHERE id = $3`,
      [JSON.stringify({ _snapshot: snapshotFilename, _snapshot_source: snapshotSource, ...extra }), snapshotFilename, eventId]
    ).catch(() => {});
  }

  // Decision A — race back-link: if this edge event arrived AFTER its snapshot's
  // window-UPDATE already ran (so it's still imageless), link the recent edge
  // snapshot for this camera when it sits in the same ±window. Path string only —
  // image stays on edge disk. Mirrors saveEdgeSnapshot's [-5s,+10s] window.
  // Also the mqtt_only leak path: without this gate a stale _recentEdgeSnap
  // entry could still attach a full-scene image even in mqtt_only mode.
  if (!snapshotFilename && camFlags.enable_snapshot && camFlags.snapshot_mode !== 'mqtt_only') {
    const cached = _recentEdgeSnap.get(cameraId);
    // dt = เวลาเหตุการณ์ − เวลาที่ถ่ายภาพ
    //   dt ติดลบ = ถ่ายภาพ "หลัง" เหตุการณ์ ← เคสปกติ (edge ต้องยิง HTTP ไปขอภาพ
    //             หลังได้ detection แล้วรอกล้องส่งกลับ · วัดจริงบน BH5100i_RMUTR-V_01
    //             2026-08-19: median +0.28 วินาที)
    //   dt เป็นบวก = ภาพถูกถ่าย "ก่อน" เหตุการณ์ ← ภาพเก่า ไม่ใช่ของ event นี้
    //
    // เดิมเปิดกว้าง -5s ถึง +10s ซึ่งแปลว่ายอมรับภาพที่ถ่ายก่อนเหตุการณ์ถึง 10 วินาที
    // นั่นคือภาพของรถคันก่อนหน้าชัด ๆ · วัดจริงพบไฟล์เดียวถูกแปะให้ event ที่ห่างกัน
    // 5.7 วินาทีผ่านทางนี้ แม้หลังจากบีบหน้าต่างของ saveEdgeSnapshot ไปแล้ว
    //
    // จงใจไม่สมมาตรและจงใจไม่เท่ากับ ±250ms ของ saveEdgeSnapshot — คนละหน้าที่กัน
    // ที่นั่นถามว่า "event ไหนบ้างที่เป็นช่วงเวลาเดียวกับภาพนี้" (รวมกฎที่ยิงพร้อมกัน)
    // ที่นี่ถามว่า "ภาพที่เพิ่งถ่ายไป เป็นของ event นี้หรือเปล่า" ซึ่งต้องเผื่อ capture lag
    // ให้พอ แต่ไม่เผื่อภาพเก่า
    //
    // ผลที่ยอมรับ: event ที่มาช้ากว่านี้จะไม่มีภาพฉากเลย — ตรงกับหลักที่ตกลงกันไว้
    // ทั้งฝั่ง edge และ central ว่า "ไม่มีภาพ ดีกว่าภาพผิดคัน"
    const BACKLINK_LAG_MS   = 2000;  // ถ่ายหลังเหตุการณ์ได้ถึง 2 วิ (เผื่อ capture lag)
    const BACKLINK_EARLY_MS = 500;   // ถ่ายก่อนเหตุการณ์ได้แค่ 0.5 วิ
    const dt = cached ? new Date(eventTime).getTime() - cached.tsMs : NaN;
    if (cached && dt >= -BACKLINK_LAG_MS && dt <= BACKLINK_EARLY_MS) {
      const r = await pool.query(
        `UPDATE events
            SET raw_json = raw_json || jsonb_build_object('_snapshot_full', $1::text, '_snapshot_source', COALESCE(raw_json->>'_snapshot_source', 'edge-http')),
                snapshot_filename = COALESCE(snapshot_filename, $1::text),
                has_snapshot = TRUE
          WHERE id = $2 AND (raw_json->>'_snapshot_full') IS NULL
          RETURNING id`,
        [cached.file, eventId]
      ).catch(() => ({ rowCount: 0 }));
      if (r.rowCount) {
        snapshotFilename = cached.file;
        // Same crop, other direction: the capture happened before this event row
        // existed, so the object_id match in saveEdgeSnapshot found nothing.
        // Still gated on the ids agreeing — a crop of object A is never shown
        // for object B just because the timestamps line up.
        if ((cached.crop || cached.bbox || cached.extra) && cached.objectId && objectId != null && String(objectId) === cached.objectId) {
          const rc = await pool.query(
            `UPDATE events
                SET raw_json = raw_json
                      || CASE WHEN $1::text IS NOT NULL AND (raw_json->>'_snapshot') IS NULL
                              THEN jsonb_build_object('_snapshot', $1::text, '_snapshot_source', 'edge-meta')
                              ELSE '{}'::jsonb END
                      || CASE WHEN $3::jsonb IS NOT NULL AND (raw_json->'_bbox') IS NULL
                              THEN jsonb_build_object('_bbox', $3::jsonb)
                              ELSE '{}'::jsonb END
                      || CASE WHEN $4::jsonb IS NOT NULL AND (raw_json->'_speed_series') IS NULL
                              THEN $4::jsonb ELSE '{}'::jsonb END,
                    snapshot_filename = COALESCE($1::text, snapshot_filename)
              WHERE id = $2 AND ((raw_json->>'_snapshot') IS NULL OR (raw_json->'_bbox') IS NULL)
              RETURNING id`,
            [cached.crop, eventId, cached.bbox ? JSON.stringify(cached.bbox) : null, cached.extra || null]
          ).catch(() => ({ rowCount: 0 }));
          if (rc.rowCount) {
            if (cached.crop) snapshotFilename = cached.crop;
            console.log(`  🎯 Meta (back-link): event ${eventId} object ${objectId}`
              + (cached.crop ? ` ← ${cached.crop}` : ' (กรอบอย่างเดียว)'));
          }
        }
        // Log only the meaningful (displayed) cases — momentary detections that lost
        // the race. CountAggregation back-links constantly during activity and isn't
        // shown in the Events list, so logging each would just spam.
        if (!eventType.includes('Aggregation')) {
          console.log(`  📸 Edge snapshot (back-link): event ${eventId} ${eventType} ← ${cached.file} (Δ${(dt / 1000).toFixed(1)}s)`);
        }
        pool.query(`SELECT pg_notify('event_snapshot', $1)`,
          [JSON.stringify({ event_id: eventId, snapshot_file: cached.file })]).catch(() => {});
      }
    }
  }

  // Fire NOTIFY after snapshot is saved so the WS broadcast carries snapshot_file.
  // Live Pulse on map receives event with snapshot ready — no frontend re-fetch needed.
  // Events without snapshot (LeaveEvent, Aggregation, enable_snapshot=false) notify
  // near-instantly since no HTTP fetch is attempted. Adds ~1-3s latency for events
  // with HTTP snapshot before the live counter increments on the Events page.
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
    .catch(err => console.error('  pg_notify new_event:', err.message));

  if (category === 'RuleEngine') {
    const obj = msg.Data?.Object?.Object;
    // HumanFace/HumanBody = IVA Pro attributes เต็มชุด (8x00i);
    // Class+Color อย่างเดียว = generic IVA metadata (เช่น 3100i) → เก็บเป็นแถว
    // low-fidelity (dominant color) ให้ Person Data ค้นแบบหยาบได้
    if (obj?.Appearance?.HumanFace || obj?.Appearance?.HumanBody ||
        (obj?.Appearance?.Class && obj?.Appearance?.Color)) {
      await extractAppearance(eventId, cameraId, objectId, obj.Appearance, snapshotFilename);
    }
    if (msg.Data?.LicensePlateInfo) {
      await extractLPR(eventId, cameraId, msg.Data, eventTime);
    }
  }

  // 🔔 Notify alert-worker via pg_notify (async, ไม่ block ingestion)
  if (ruleName) {
    const camCfg = cameraMap[cameraId] || {};
    pool.query(
      `SELECT pg_notify('alert_event', $1)`,
      [JSON.stringify({
        event_id:          eventId,
        camera_id:         cameraId,
        camera_name:       camCfg.camera_name || cameraId,
        location:          camCfg.location || null,
        rule_name:         ruleName,
        event_type:        eventType,
        object_class:      objectClass,
        likelihood,
        event_time:        eventTime,
        snapshot_filename: snapshotFilename,
      })]
    ).catch(err => console.error('🔔 pg_notify alert_event error:', err.message));
  } else {
    // ข้อ 5 (2026-06-12) — Bosch tampering: GlobalSceneChange/ImageToo* เป็น
    // analytics events ไม่มี rule_name จึงไม่เคยถึง alert engine. ยิง
    // alert_event ด้วย rule_name สังเคราะห์ตระกูล "Camera Tampering (...)"
    // เดียวกับ Hik (shelteralarm/defocus) + Dahua (VideoBlind) → LINE rule
    // ใบเดียวครอบ 3 vendor. event ใน DB ไม่ถูกแก้ — ยิงเฉพาะขา true
    // (เริ่มเกิด); ความถี่คุมด้วย cooldown ของ rule ฝั่ง operator
    const tamperRule = bosch_tamper_rule_name(eventType, state);
    if (tamperRule) {
      const camCfg = cameraMap[cameraId] || {};
      pool.query(
        `SELECT pg_notify('alert_event', $1)`,
        [JSON.stringify({
          event_id:          eventId,
          camera_id:         cameraId,
          camera_name:       camCfg.camera_name || cameraId,
          location:          camCfg.location || null,
          rule_name:         tamperRule,
          event_type:        eventType,
          object_class:      null,
          likelihood:        null,
          event_time:        eventTime,
          snapshot_filename: snapshotFilename,
        })]
      ).catch(err => console.error('🔔 pg_notify tamper error:', err.message));
    }
  }

  // 🎬 Notify media-recorder for pre-alarm clip capture (Phase 6.1).
  // media-recorder LISTENs on 'event_for_clip' and decides per-camera
  // whether to dump a clip (based on cameras.enable_clip_capture).
  //
  // Skip Aggregation events — same reason as snapshot capture above:
  // Bosch IVA Aggregation fires AFTER the object exits the scene
  // (typically 10-30s post-detection). The pre+post clip window
  // captures empty frames even though object_class='Person'.
  // The actual detection moment was already captured by the
  // corresponding LineDetector/Crossed or FieldDetector clip
  // earlier in the same track.
  if (ruleName && !isAggregationEvent) {
    // received_at_ms = host wall-clock at MQTT receive. Used by media-recorder
    // to anchor the clip window — camera's UtcTime is unreliable for clip
    // timing (Bosch stamps LineDetector/Crossed with track-appearance time,
    // and camera-vs-host clock skew on Bosch FW 9.80.106 is ±5–10s in
    // practice). Host clock matches ffmpeg segment filenames exactly.
    pool.query(
      `SELECT pg_notify('event_for_clip', $1)`,
      [JSON.stringify({
        event_id: eventId,
        camera_id: cameraId,
        event_time: eventTime,
        received_at_ms: Date.now(),
      })]
    ).catch(err => console.error('🎬 pg_notify failed:', err.message));
  }
}

async function ensureCamera(cameraId) {
  if (knownCameras.has(cameraId)) return;
  // Decision #86: cameras-config.json is the source of truth for the camera
  // list. Don't auto-register an unfamiliar camera_id seen on MQTT — those
  // are usually retained broadcasts from decommissioned cameras and would
  // otherwise grow stale rows in the DB forever. The event itself still
  // gets stored (the events table doesn't FK into cameras), just no new
  // cameras row. To add a new camera, update cameras-config.json + restart.
  if (!cameraMap[cameraId]) {
    // Diagnostic: when a camera_id arrives via MQTT but isn't in config,
    // log it ONCE per process so the operator can spot character mismatches
    // (e.g. an invisible Thai phinthu U+0E3A that snuck into config when
    // typing in a Thai keyboard layout — see CLAUDE.md gotcha #32).
    const configIds = Object.keys(cameraMap);
    const lookalike = configIds.find(cfg =>
      cfg.replace(/[^A-Za-z0-9_-]/g, '') === cameraId.replace(/[^A-Za-z0-9_-]/g, '')
    );
    if (lookalike) {
      console.log(`  ⚠️  MQTT id "${cameraId}" matches config id "${lookalike}" except for non-printable characters — events will be SKIPPED. Fix the config id in cameras-config.json.`);
    } else {
      console.log(`  ⚠️  MQTT id "${cameraId}" not in config — event stored but no camera row. Add to cameras-config.json if this is a real camera.`);
    }
    knownCameras.add(cameraId);  // cache the "skip" decision for this run
    return;
  }
  try {
    const { rows } = await pool.query('SELECT 1 FROM cameras WHERE id=$1', [cameraId]);
    if (rows.length === 0) {
      const cam = cameraMap[cameraId];
      await pool.query(
        `INSERT INTO cameras (id, name, ip_address, location_label, enabled)
         VALUES ($1,$2,$3,$4,TRUE)`,
        [cameraId, cam.camera_name || cameraId, cam.ip_address || null, cam.location || null]
      );
      console.log(`  🆕 Camera auto-registered: ${cameraId}`);
    }
    knownCameras.add(cameraId);
  } catch (e) { /* ignore */ }
}

// ตัวประทับเวลาอยู่ใน helpers/touchCamera.js แล้ว (เขียนเฉพาะเมื่อค่าเดิมเก่าเกิน
// คาบ) — คิวรีเดิมที่เขียนทุกครั้งคือคิวรีที่กินระบบมากที่สุด 836,635 ครั้ง/9 ชม.

// Edge snapshot — published by edge-config-agent after HTTP capture.
// Accepts new Tier-2 path (msg.snapshot_file) OR legacy base64 (msg.data).
// Links to the nearest unlinked event by timestamp (Bosch) or exact id (Hik/Dahua).
// Decision A (2026-06-30) — race back-link cache. A Bosch edge event and its
// snapshot reach central on two independent paths (event: camera→NanoMQ→edge-bridge
// →WSS→here; snapshot: edge-config-agent→here). When the snapshot's window-UPDATE
// runs BEFORE the event row is inserted, the event stays imageless even though a
// matching frame was captured (GOTCHAS #104 — a race, not clock drift). saveEdgeSnapshot
// records the last snapshot per camera here; handleEvent back-links a freshly inserted
// imageless edge event to it within the same ±window. Stores only the path string —
// the image never moves off edge disk (Tier-2 / PDPA unchanged).
const _recentEdgeSnap = new Map(); // cameraId -> { file, tsMs }

// The extras the metadata track can answer and the MQTT event cannot: how big
// the camera thinks the object is, which way it was travelling across the
// picture, and the speed readings over its whole run. Built as one jsonb blob
// because they arrive and are written together — three more CASE arms for three
// fields that are never independently present would only add ways to get it
// wrong. Returns null when the message carries none of them, which is what the
// caller's guard tests.
function _metaExtra(msg) {
  const o = {};
  if (Array.isArray(msg.speed_series) && msg.speed_series.length) o._speed_series = msg.speed_series;
  if (Number.isFinite(msg.area)) o._area = msg.area;
  if (Number.isFinite(msg.heading)) o._heading = msg.heading;
  if (Array.isArray(msg.trail) && msg.trail.length > 1) o._trail = msg.trail;
  return Object.keys(o).length ? JSON.stringify(o) : null;
}

// ── แถว appearances จากสีในสตรีม metadata (2026-08-26) ───────────────────────
//
// ทำไมต้องมี: กล้อง Bosch คำนวณสีของวัตถุได้ และส่งมาในสตรีม ONVIF metadata ทุกเฟรม
// แต่ firmware 9.80 **ไม่แนบสีไปกับ event MQTT** (วัดที่ BH5100i_RMUTR-V_02:
// Appearance.Color = 0 จาก 4,335 ครั้ง) ขณะที่ 9.82 แนบมาให้ 100% เดิมเราเติมตาราง
// appearances จากฝั่ง event ทางเดียว กล้องที่ยังไม่ได้อัปจึงได้ 0 แถวมาตลอด → หน้า
// "ข้อมูลวัตถุ" ค้นไม่เจอ และแถบ "สีของวัตถุ" ในการ์ด event ก็ไม่ขึ้น (ทั้งสองหน้าอ่าน
// จากตารางนี้ตัวเดียวกัน)
//
// เขียนเฉพาะ event ที่ยังไม่มีแถว — กล้อง firmware ใหม่จะถูก extractAppearance เขียน
// ไปก่อนแล้วพร้อม attribute อื่นที่สตรีมไม่มี ทางนี้จึงเป็นการเติมช่องว่าง ไม่ใช่
// เส้นทางที่สองที่จะไปทับของที่ดีกว่า
//
// ⚠️ ไม่มี unique constraint บน event_id — กันซ้ำด้วย NOT EXISTS ในคำสั่งเดียวกัน
// ไม่ใช่ SELECT แล้วค่อย INSERT ซึ่งเปิดช่องให้มีตัวอื่นแทรกกลางได้
async function _appearanceFromMetaColors(eventIds, objectId, colors) {
  if (!Array.isArray(eventIds) || !eventIds.length) return 0;
  if (!Array.isArray(colors) || !colors.length) return 0;
  const arr = colors
    .filter(c => Number.isFinite(c?.x) && Number.isFinite(c?.y) && Number.isFinite(c?.z))
    .map(c => {
      const xyz = `${c.x},${c.y},${c.z}`;
      return { xyz, name: xyzToColorName(xyz), weight: Number(c.w) || 0 };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
  if (!arr.length) return 0;
  try {
    // object_class / confidence อ่านจากแถว event เอง ไม่ได้ให้ edge ส่งซ้ำมา —
    // แหล่งเดียวกับที่หน้าอื่นใช้ จะได้ไม่มีทางขัดกันเอง
    const r = await pool.query(
      `INSERT INTO appearances
         (event_id, camera_id, object_id, object_class, confidence,
          overall_color, overall_color_xyz, color_clusters)
       SELECT e.id, e.camera_id, $2, e.object_class, e.likelihood, $3, $4, $5
         FROM events e
        WHERE e.id = ANY($1::bigint[])
          AND NOT EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = e.id)`,
      [eventIds, objectId != null ? String(objectId) : null,
       arr[0].name, arr[0].xyz, JSON.stringify(arr)]);
    return r.rowCount;
  } catch (e) {
    console.warn(`[meta-color] เขียน appearances ไม่สำเร็จ: ${e.message}`);
    return 0;
  }
}

async function saveEdgeSnapshot(cameraId, msg) {
  let filename;
  if (msg.snapshot_file) {
    // NEW Tier-2: image lives on edge disk; central only stores the path
    filename = msg.snapshot_file;
    console.log(`  📸 Edge snapshot (Tier-2): ${filename}`);
  } else if (msg.data) {
    // LEGACY base64: write to central disk (backward-compat during rollout)
    try {
      const buffer = Buffer.from(msg.data, 'base64');
      const tsNow  = Date.now();
      const { dir: evDir, relBase } = snapPath(SNAPSHOT_DIR, 'events', cameraId, tsNow);
      const fname  = `event_edge_${tsNow}.jpg`;
      filename     = `${relBase}/${fname}`;
      fs.writeFileSync(path.join(evDir, fname), buffer);
      console.log(`  📸 Edge snapshot (base64): ${filename} (${(buffer.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.error(`[edge-snapshot] ${cameraId} write failed:`, e.message);
      return;
    }
  } else { return; }

  // Record for the race back-link (decision A) BEFORE the match below — so it's
  // remembered even when the window-UPDATE matches 0 rows (event not inserted yet).
  const _snapTsMs = msg.ts ? Date.parse(msg.ts) : Date.now();
  if (!Number.isNaN(_snapTsMs)) {
    _recentEdgeSnap.set(cameraId, {
      file: filename, tsMs: _snapTsMs,
      // ONVIF metadata crop — rides along so the back-link path below can apply
      // it too when the event lost the race and wasn't inserted yet.
      crop: msg.crop_file || null,
      bbox: msg.bbox || null,
      speedAvg: msg.speed_avg ?? null,
      extra: _metaExtra(msg),
      objectId: msg.object_id != null ? String(msg.object_id) : null,
    });
  }

  // ONVIF metadata crop (edge, opt-in per camera): unlike the full scene, this
  // image belongs to exactly ONE tracked object, so it is matched on object_id
  // rather than by timestamp proximity — a sibling rule firing 200ms later on a
  // different vehicle must not inherit it. Runs before the full-scene UPDATE so
  // that statement's COALESCE(snapshot_filename, …) keeps the crop as the
  // displayed image, matching how the MQTT-embedded crop already behaves.
  if ((msg.crop_file || msg.bbox || msg.speed_avg != null || _metaExtra(msg)) && msg.object_id != null) {
    // Two independent payloads on one match. _bbox is only geometry and is
    // written whenever it is missing, because a frame is useful over the full
    // scene regardless of which crop won.
    //
    // The crop used to defer to an MQTT-embedded one the camera had already
    // supplied, on the assumption the camera knew better. Measured on this
    // camera over 3 hours it does not: the camera's own crop runs 51x60 median
    // (2,889 px) against 72x147 (10,934 px) for one cut from the 1080p frame —
    // 3.8x the pixels. So a metadata crop now replaces an MQTT one, and only an
    // MQTT one. Anything else already in _snapshot is left alone.
    const c = await pool.query(
      `UPDATE events
          SET raw_json = raw_json
                || CASE WHEN $1::text IS NOT NULL
                             AND ((raw_json->>'_snapshot') IS NULL
                                  OR (raw_json->>'_snapshot_source') = 'mqtt')
                        THEN jsonb_build_object('_snapshot', $1::text, '_snapshot_source', 'edge-meta')
                        ELSE '{}'::jsonb END
                || CASE WHEN $5::jsonb IS NOT NULL AND (raw_json->'_bbox') IS NULL
                        THEN jsonb_build_object('_bbox', $5::jsonb)
                        ELSE '{}'::jsonb END
                || CASE WHEN $6::numeric IS NOT NULL AND (raw_json->'_speed_avg') IS NULL
                        THEN jsonb_build_object('_speed_avg', $6::numeric)
                        ELSE '{}'::jsonb END
                || CASE WHEN $7::jsonb IS NOT NULL AND (raw_json->'_speed_series') IS NULL
                             AND (raw_json->'_area') IS NULL AND (raw_json->'_heading') IS NULL
                        THEN $7::jsonb ELSE '{}'::jsonb END,
              snapshot_filename = CASE WHEN $1::text IS NOT NULL
                                            AND ((raw_json->>'_snapshot') IS NULL
                                                 OR (raw_json->>'_snapshot_source') = 'mqtt')
                                       THEN $1::text ELSE snapshot_filename END,
              has_snapshot = has_snapshot OR $1::text IS NOT NULL
        WHERE camera_id = $2
          AND object_id = $3
          AND event_time BETWEEN ($4::timestamptz - interval '5s') AND ($4::timestamptz + interval '10s')
          AND ((raw_json->>'_snapshot') IS NULL OR (raw_json->'_bbox') IS NULL
               OR ($1::text IS NOT NULL AND (raw_json->>'_snapshot_source') = 'mqtt')
               OR ($6::numeric IS NOT NULL AND (raw_json->'_speed_avg') IS NULL)
               OR ($7::jsonb IS NOT NULL AND (raw_json->'_speed_series') IS NULL))
        RETURNING id`,
      [msg.crop_file || null, cameraId, String(msg.object_id),
       msg.ts || new Date(_snapTsMs).toISOString(),
       msg.bbox ? JSON.stringify(msg.bbox) : null,
       msg.speed_avg ?? null,
       _metaExtra(msg)]
    ).catch(e => { console.warn(`[meta-crop] DB update failed: ${e.message}`); return { rowCount: 0 }; });
    if (c.rowCount) {
      console.log(`  🎯 Meta: object ${msg.object_id} → ${c.rowCount} event(s)`
        + (msg.crop_file ? ` ← ${msg.crop_file}` : ' (กรอบอย่างเดียว ไม่มี crop)'));
    }
    // สีจากสตรีม metadata — เติมเฉพาะ event ที่ยังไม่มีแถว appearances
    if (msg.colors && c.rows?.length) {
      const n = await _appearanceFromMetaColors(c.rows.map(r => r.id), msg.object_id, msg.colors);
      if (n) console.log(`  🎨 Meta color: object ${msg.object_id} → ${n} appearance row(s)`);
    }
  }

  let linkedId;
  let notifyIds = [];
  try {
    let result;
    if (msg.event_id) {
      // Hikvision / Dahua — publisher sends event_id directly
      result = await pool.query(
        `UPDATE events
            SET raw_json          = raw_json || jsonb_build_object('_snapshot_full', $1::text, '_snapshot_source', COALESCE(raw_json->>'_snapshot_source', 'edge-http')),
                snapshot_filename  = $1::text,
                has_snapshot       = TRUE
          WHERE id = $2
          RETURNING id`,
        [filename, msg.event_id]
      ).catch(e => { console.warn(`[edge-snapshot] DB update failed: ${e.message}`); return { rowCount: 0, rows: [] }; });
    } else {
      // Bosch — no event_id, so the event is found by timestamp.
      //
      // The intent here is unchanged and still deliberate: simultaneous rules
      // (e.g. LineDetector + FieldDetector firing on the same moment) SHOULD
      // share one photo. What changed is what counts as "the same moment".
      //
      // This used to attach the file to EVERY event in the -5s/+10s search
      // window. On a busy camera that window is not one moment, it is fifteen
      // seconds of unrelated traffic. Measured on BH5100i_RMUTR-V_01
      // (2026-08-19, 6h of events sharing a file): only 19% were within 250ms
      // of each other — genuinely simultaneous — while 35% were more than 5s
      // apart, i.e. different vehicles entirely. One file had been attached to
      // 51 events spanning 9 minutes.
      //
      // Now: find the closest event to the capture, then attach only to events
      // within ±250ms of THAT event. Verified against a real case — a file
      // previously shared by 4 events now lands on 1, while a genuine
      // three-rule pile-up 133ms wide still shares one photo as intended.
      //
      // The wide search window is kept: it decides WHERE to look, not how much
      // to claim. Capture lands after its trigger (median +0.28s here), so the
      // asymmetric -5s/+10s bounds still matter.
      //
      // COALESCE preserves the MQTT body crop in snapshot_filename (if already set).
      const snapTs = msg.ts || new Date(Date.now() - 2000).toISOString();
      result = await pool.query(
        `WITH target AS (
           SELECT event_time AS t
             FROM events
            WHERE camera_id  = $2
              AND event_time BETWEEN ($3::timestamptz - interval '5s') AND ($3::timestamptz + interval '10s')
              AND (raw_json->>'_snapshot_full') IS NULL
            ORDER BY abs(EXTRACT(epoch FROM (event_time - $3::timestamptz)))
            LIMIT 1
         )
         UPDATE events
            SET raw_json          = raw_json || jsonb_build_object('_snapshot_full', $1::text, '_snapshot_source', COALESCE(raw_json->>'_snapshot_source', 'edge-http')),
                snapshot_filename  = COALESCE(snapshot_filename, $1::text),
                has_snapshot       = TRUE
           FROM target
          WHERE events.camera_id  = $2
            -- ขอบซ้ำกับ target.t ± 250 ms โดยตั้งใจ (target อยู่ใน [ts-5s, ts+10s] เสมอ) — ขอบจาก CTE
            -- ไม่รู้ตอนวางแผน ฝั่ง UPDATE จึงไม่ตัด partition: ไล่ครบ 20 ตัว และ ก.ค./มิ.ย. ใช้ index
            -- camera_id อย่างเดียว (ไล่ทุกแถวของกล้องนั้น) · วัด 2026-10-07: 45–60 ms → 0.1 ms ต่อครั้ง
            -- (คิวรีที่หนักที่สุดของ DB ~22k ครั้ง/วัน) · ห้ามลบเพราะดูเหมือนซ้ำ
            AND events.event_time BETWEEN ($3::timestamptz - interval '5250 milliseconds')
                                      AND ($3::timestamptz + interval '10250 milliseconds')
            AND events.event_time BETWEEN target.t - interval '250 milliseconds'
                                      AND target.t + interval '250 milliseconds'
            AND (events.raw_json->>'_snapshot_full') IS NULL
          RETURNING events.id`,
        [filename, cameraId, snapTs]
      ).catch(e => { console.warn(`[edge-snapshot] DB update failed: ${e.message}`); return { rowCount: 0, rows: [] }; });
    }
    if (!result.rowCount) {
      console.warn(`[edge-snapshot] ${cameraId}: no matching event (event_id=${msg.event_id || 'none'})`);
      return;
    }
    linkedId = result.rows[0]?.id;
    notifyIds = result.rows.map(r => r.id);
  } catch (e) {
    console.error(`[edge-snapshot] ${cameraId}:`, e.message);
    return;
  }

  for (const id of notifyIds) {
    pool.query(`SELECT pg_notify('event_snapshot', $1)`,
      [JSON.stringify({ event_id: id, snapshot_file: filename })])
      .catch(e => console.warn('[edge-snapshot] notify fail:', e.message));
  }
}

// ข้อ 5 — map Bosch analytics event → ชื่อ rule tampering ข้าม vendor
// (ขา true เท่านั้น; คืน null = ไม่เกี่ยว tampering). แยกเป็นฟังก์ชันเพื่อ unit test
function bosch_tamper_rule_name(eventType, state) {
  if (state === 'false' || state === 'False') return null;
  if (typeof eventType !== 'string') return null;
  if (eventType.includes('GlobalSceneChange')) return 'Camera Tampering (Scene Change)';
  if (eventType.includes('ImageTooBlurry'))    return 'Camera Tampering (Defocus)';
  if (eventType.includes('ImageTooDark'))      return 'Camera Tampering (Image Dark)';
  if (eventType.includes('ImageTooBright'))    return 'Camera Tampering (Image Bright)';
  return null;
}

async function extractAppearance(eventId, cameraId, objectId, appearance, snapshot) {
  try {
    const face = appearance.HumanFace || {};
    const body = appearance.HumanBody || {};
    const clothing = body.Clothing || {};
    // ColorCluster เป็น object เดี่ยวหรือ array ก็ได้ (หลายสีต่อชิ้น) —
    // dominant = ตัวแรก (กล้องเรียง weight มาให้); เดิมเจอ array แล้วได้ null (AP.4)
    const firstCluster = (c) => {
      const cc = c?.ColorCluster;
      return Array.isArray(cc) ? cc[0] : cc;
    };
    const colorStr = (c) => {
      const col = firstCluster(c)?.Color;
      return col ? `${col['@X']},${col['@Y']},${col['@Z']}` : null;
    };
    const objectClass  = appearance.Class?.Type?.['#text'] || null;
    const confidence   = appearance.Class?.Type?.['@Likelihood'] != null
      ? parseFloat(appearance.Class.Type['@Likelihood']) : null;
    const topXyz    = colorStr(clothing.Tops?.Color);
    const bottomXyz = colorStr(clothing.Bottoms?.Color);
    const hairXyz   = colorStr(face.Hair?.Color);
    // Whole-object colour clusters — generic IVA metadata ที่กล้อง non-Pro
    // (เช่น 3100i) แนบมากับทุก detection: เก็บครบทุก cluster เรียงตาม weight
    // (Ph.3, migration 042); overall_* = cluster อันดับ 1 สำหรับ display หลัก
    let overallXyz = null, colorClusters = null;
    const clusters = appearance.Color?.ColorCluster;
    if (clusters) {
      const arr = (Array.isArray(clusters) ? clusters : [clusters])
        .filter(cl => cl?.Color)
        .map(cl => {
          const xyz = `${cl.Color['@X']},${cl.Color['@Y']},${cl.Color['@Z']}`;
          return { xyz, name: xyzToColorName(xyz), weight: parseFloat(cl.Weight ?? '0') || 0 };
        })
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4);
      if (arr.length) {
        colorClusters = JSON.stringify(arr);
        overallXyz = arr[0].xyz;
      }
    }
    // AP.4 — แถว Pro ไม่มี whole-object Color: สังเคราะห์ clusters จากสีของ
    // เสื้อบน/ล่าง พร้อมป้าย part ('top'/'bottom') — search containment แยก
    // ตาม part จึงไม่ cross กับกติกา upper/lower ของ Ph.3 (เสื้อลายหลายสี
    // ค้นเจอทุกสี ไม่ใช่แค่สีเด่น). overall_* คงเป็น null สำหรับแถว Pro
    if (!colorClusters) {
      const partArr = (c, part) => {
        const cc = c?.ColorCluster;
        if (!cc) return [];
        return (Array.isArray(cc) ? cc : [cc])
          .filter(cl => cl?.Color)
          .map(cl => {
            const xyz = `${cl.Color['@X']},${cl.Color['@Y']},${cl.Color['@Z']}`;
            return { xyz, name: xyzToColorName(xyz), weight: parseFloat(cl.Weight ?? '0') || 0, part };
          });
      };
      const arr = [...partArr(clothing.Tops?.Color, 'top'), ...partArr(clothing.Bottoms?.Color, 'bottom')]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 6);
      if (arr.length) colorClusters = JSON.stringify(arr);
    }
    await pool.query(
      `INSERT INTO appearances
       (event_id, camera_id, object_id, object_class, confidence,
        gender, hair_length, hair_color_xyz,
        top_category, top_color_xyz, bottom_category, bottom_color_xyz,
        glasses, bag_category, helmet_wear, helmet_subtype, vest_style,
        upper_color, lower_color, hair_color,
        overall_color, overall_color_xyz, color_clusters)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [eventId, cameraId, objectId, objectClass, confidence,
       face.Gender||null, face.Hair?.Length||null, hairXyz,
       clothing.Tops?.Category||null,    topXyz,
       clothing.Bottoms?.Category||null, bottomXyz,
       face.Accessory?.Opticals?.Wear==='true', body.Belonging?.Bag?.Category||null,
       face.Accessory?.Helmet?.Wear==='true', face.Accessory?.Helmet?.Subtype||null,
       clothing.Tops?.Style||null,
       xyzToColorName(topXyz), xyzToColorName(bottomXyz), xyzToColorName(hairXyz),
       xyzToColorName(overallXyz), overallXyz, colorClusters]
    );
  } catch (e) {
    console.error(`[appearance] extractAppearance failed (event ${eventId}, camera ${cameraId}): ${e.message}`);
  }
}

async function extractLPR(eventId, cameraId, data, eventTime = null) {
  try {
    const p = data?.LicensePlateInfo?.LicensePlateInfo || {};
    const v = data?.VehicleInfo?.VehicleInfo || {};
    await pool.query(
      `INSERT INTO license_plates
       (event_id, camera_id, plate_number, confidence, country, region,
        vehicle_type, vehicle_color, vehicle_brand, detected_at, plate_identified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, now()),
               ${helmet.stampSql('$11', '$12', '$13')})`,
      [eventId, cameraId,
       p.PlateNumber?.['#text']        ?? null,
       p.PlateNumber?.['@Likelihood']  ?? null,
       p.CountryCode?.['#text']        ?? null,
       p.IssuingEntity?.['#text']      ?? null,
       v.Type?.['#text']               ?? null,
       null,                                    // vehicle_color: Bosch doesn't send; Hikvision/Dahua will
       v.Brand?.['#text']              ?? null,
       eventTime,                               // camera time, not insert time
       // $11-$13 — ค่าสำหรับตรึงผล "พร้อมข้อมูลทะเบียน" (ดูหมายเหตุที่ stampSql)
       helmet.plateMatches(p.PlateNumber?.['#text']),
       p.PlateNumber?.['@Likelihood'] ?? null,
       cameraId]
    );
  } catch (e) {
    console.error(`[lpr] extractLPR failed (event ${eventId}, camera ${cameraId}): ${e.message}`);
  }
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  client.end();
  await pool.end();
  process.exit(0);
});
