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
const { faceComparisonListType } = require('./ingesters/dahua-protocol');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
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

const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');
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

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
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
const _camFlagsCache = new Map();   // camera_id -> { flags, fetchedAt }
const _CAM_FLAGS_TTL = 30_000;
async function getCamFlags(cameraId) {
  const now = Date.now();
  const cached = _camFlagsCache.get(cameraId);
  if (cached && (now - cached.fetchedAt) < _CAM_FLAGS_TTL) return cached.flags;
  let flags = { enable_snapshot: true, enable_vca_overlay: true, paused: false };
  try {
    const r = await pool.query(
      `SELECT enable_snapshot, enable_vca_overlay, paused FROM cameras WHERE id=$1`,
      [cameraId]
    );
    if (r.rows[0]) flags = {
      enable_snapshot:    r.rows[0].enable_snapshot    !== false,
      enable_vca_overlay: r.rows[0].enable_vca_overlay !== false,
      paused:             r.rows[0].paused === true,
    };
  } catch {}
  _camFlagsCache.set(cameraId, { flags, fetchedAt: now });
  return flags;
}

// ── Per-camera site code from DB (Task #16 cross-check, 30s cache) ─────────
// cameras.site_id is an INT FK → sites.id; MQTT topics carry sites.code
// (e.g. projects/bma/...), so this resolves id → code via a join.
const _camSiteCache = new Map(); // camera_id -> { siteCode, fetchedAt }
const _CAM_SITE_TTL = 30_000;
async function getCamSiteCode(cameraId) {
  const now = Date.now();
  const cached = _camSiteCache.get(cameraId);
  if (cached && (now - cached.fetchedAt) < _CAM_SITE_TTL) return cached.siteCode;
  let siteCode = null;
  try {
    const r = await pool.query(
      `SELECT s.code FROM cameras c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`,
      [cameraId]
    );
    siteCode = r.rows[0]?.code ?? null;
  } catch {}
  _camSiteCache.set(cameraId, { siteCode, fetchedAt: now });
  return siteCode;
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
  if (!r || !r.ok) {
    await pool.query(
      `UPDATE cameras SET sd_last_check_at = NOW(), sd_status = 'unreachable', sd_error = $2 WHERE id = $1`,
      [cameraId, r?.error || 'unknown']
    ).catch((err) => console.error('  💾 SD status (edge) update error:', err.message));
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

  // 🆕 SD status poller (Bosch RCP+ 0x0CB5)
  setTimeout(pollAllSdStatus, 5000);
  setInterval(pollAllSdStatus, SD_POLL_INTERVAL_MS);

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
    // Delete-media reply (OPT5-EDGE-005): edge-config-agent → _config/delete-media-result.
    // The camera row is already gone by the time this arrives (delete-media is
    // fired after the DB delete) — log-only, this is the audit trail the
    // finding asked for ("return result for audit/health visibility").
    if (stripped.startsWith('_config/delete-media-result')) {
      if (msg.error) console.warn(`[edge] delete-media ${msg.camera_id}: ${msg.error}`);
      else            console.log(`[edge] delete-media ${msg.camera_id}: removed ${msg.dirs_removed} date-dir(s)`);
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

// EM3: upsert edge heartbeat into edge_status (cross-process channel → api-server health endpoint)
async function recordEdgeHeartbeat(siteId, payload) {
  const { ts, pm2 = [], disk = {}, bridge = {}, snapshots = {} } = payload;
  // snapshots inventory (oldest date-dir + count) rides only the ~hourly ticks;
  // COALESCE so the 60s heartbeats in between don't clobber good values with NULL.
  await pool.query(`
    INSERT INTO edge_status
      (site_id, last_seen_at, disk_free_gb, disk_total_gb,
       bridge_forwarded, bridge_dropped, bridge_remote, bridge_local, pm2_json,
       snapshot_oldest, snapshot_dirs, updated_at)
    VALUES ($1, to_timestamp($2::bigint / 1000.0), $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, now())
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
  ]);
}

// Central passthrough for pre-normalized edge events (LOGIC_edge-ingester-divergence.md).
// When msg._edge is truthy, skip processMessage ONVIF normalization and INSERT verbatim.
async function handleEdgeEvent(_topic, msg) {
  const ev = msg.event;
  if (!ev?.camera_id) { console.warn('[edge] malformed _edge payload: missing event.camera_id'); return; }
  const cameraId = ev.camera_id;
  // Task #19: cameraMap only holds Bosch cameras (see loadCameraConfig), so
  // cameraMap[cameraId] is always undefined here — this function only ever
  // handles non-Bosch edge-relayed events. Go straight to the DB-backed flag
  // (same cache processMessage's Bosch path effectively gets via cameraMap).
  if ((await getCamFlags(cameraId)).paused) return;
  await ensureCamera(cameraId);
  await touchCamera(cameraId);

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
  // Dahua NVR face channel: derive the Hikvision-convention listType from the
  // NVR's own similarity score (data.Sim, 0-100) so the Face page + counters
  // segment blacklist (≥70 → เฝ้าระวัง) vs miss (< 70 → ไม่รู้จัก). The NVR did
  // the compare; we just translate its verdict.
  if (ev.event_type === 'FaceDetector/Comparison') {
    const sim = ev.raw_json?.data?.Sim;
    rawJson.listType = faceComparisonListType(sim);
    if (sim != null) rawJson.similarity = Number(sim);
  }

  let eventId;
  try {
    let result;
    if (msg.dedup?.window_start) {
      // people-counting retransmit guard — mirror non-EDGE_MODE NOT EXISTS pattern
      result = await pool.query(
        `INSERT INTO events
           (camera_id, event_category, event_type, rule_name,
            object_id, object_class, likelihood, event_state, raw_json, event_time)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10
          WHERE NOT EXISTS (
            SELECT 1 FROM events
             WHERE camera_id=$1 AND event_type=$3
               AND raw_json->>'window_start'=$11)
         RETURNING id`,
        [cameraId, ev.event_category, ev.event_type, ev.rule_name,
         ev.object_id ?? null, ev.object_class ?? null, ev.likelihood ?? null,
         ev.event_state ?? null, JSON.stringify(rawJson), ev.event_time,
         msg.dedup.window_start]
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

  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
    .catch(err => console.error('[edge] pg_notify new_event:', err.message));

  // face-capture appearance (Hik EDGE_MODE=1 only — format: {object_class,confidence,gender,glasses})
  if (msg.appearance) {
    const a = msg.appearance;
    pool.query(
      `INSERT INTO appearances
         (event_id, camera_id, object_class, confidence, gender, glasses)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [eventId, cameraId, a.object_class ?? null, a.confidence ?? null, a.gender ?? null, a.glasses ?? null]
    ).catch(err => console.error('[edge] appearance insert:', err.message));
  }

  // LPR edge (Hik lpr-core EDGE_MODE=1 — format matches license_plates columns 1:1)
  if (msg.license_plate) {
    const lp = msg.license_plate;
    pool.query(
      `INSERT INTO license_plates
         (event_id, camera_id, plate_number, confidence, country, region,
          vehicle_type, vehicle_color, vehicle_brand, plate_type,
          bbox_x, bbox_y, bbox_width, bbox_height, plate_image,
          plate_color, no_helmet, rider_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [eventId, cameraId,
       lp.plate_number ?? null, lp.confidence ?? null, lp.country ?? null, lp.region ?? null,
       lp.vehicle_type ?? null, lp.vehicle_color ?? null, lp.vehicle_brand ?? null, lp.plate_type ?? null,
       lp.bbox_x ?? null, lp.bbox_y ?? null, lp.bbox_width ?? null, lp.bbox_height ?? null,
       lp.plate_image ?? null,
       // #085/#090 perf — populated from the same raw_json the backfill/stats read (single
       // source). riderCount is Dahua ITC431-only (edge; central-direct path in dahua-cgi.js
       // mirrors this) — null for Hikvision/ITC237, never inferred from silence.
       rawJson?.plateColor ?? null, rawJson?.helmet === 'no', rawJson?.riderCount ?? null]
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
  await touchCamera(cameraId);

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
    }
    return;
  }

  // Edge-reported SD/recording status (edge-site cameras only — see pollSdStatusForCamera).
  if (eventType === 'sd-status') {
    await applySdStatusResult(cameraId, msg);
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

  if (mqttSnapshotB64 && camFlags.enable_snapshot) {
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
  if (shouldHttp && !isLeaveEvent && !isAggregationEvent && camFlags.enable_snapshot) {
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
    await pool.query(
      `UPDATE events
          SET raw_json = raw_json || $1::jsonb,
              snapshot_filename = $2,
              has_snapshot = TRUE
        WHERE id = $3`,
      [JSON.stringify({ _snapshot: snapshotFilename, _snapshot_source: snapshotSource, ...extra }), snapshotFilename, eventId]
    ).catch(() => {});
  }

  // Decision A — race back-link: if this edge event arrived AFTER its snapshot's
  // window-UPDATE already ran (so it's still imageless), link the recent edge
  // snapshot for this camera when it sits in the same ±window. Path string only —
  // image stays on edge disk. Mirrors saveEdgeSnapshot's [-5s,+10s] window.
  if (!snapshotFilename) {
    const cached = _recentEdgeSnap.get(cameraId);
    const dt = cached ? new Date(eventTime).getTime() - cached.tsMs : NaN;
    if (cached && dt >= -5000 && dt <= 10000) {
      const r = await pool.query(
        `UPDATE events
            SET raw_json = raw_json || jsonb_build_object('_snapshot_full', $1::text, '_snapshot_source', 'edge-http'),
                snapshot_filename = COALESCE(snapshot_filename, $1::text),
                has_snapshot = TRUE
          WHERE id = $2 AND (raw_json->>'_snapshot_full') IS NULL
          RETURNING id`,
        [cached.file, eventId]
      ).catch(() => ({ rowCount: 0 }));
      if (r.rowCount) {
        snapshotFilename = cached.file;
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
      await extractLPR(eventId, cameraId, msg.Data);
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

async function touchCamera(cameraId) {
  await pool.query(
    `UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
    [cameraId]
  ).catch(() => {});
}

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
  if (!Number.isNaN(_snapTsMs)) _recentEdgeSnap.set(cameraId, { file: filename, tsMs: _snapTsMs });

  let linkedId;
  let notifyIds = [];
  try {
    let result;
    if (msg.event_id) {
      // Hikvision / Dahua — publisher sends event_id directly
      result = await pool.query(
        `UPDATE events
            SET raw_json          = raw_json || jsonb_build_object('_snapshot_full', $1::text, '_snapshot_source', 'edge-http'),
                snapshot_filename  = $1::text,
                has_snapshot       = TRUE
          WHERE id = $2
          RETURNING id`,
        [filename, msg.event_id]
      ).catch(e => { console.warn(`[edge-snapshot] DB update failed: ${e.message}`); return { rowCount: 0, rows: [] }; });
    } else {
      // Bosch — no event_id; update ALL events in the timestamp window so
      // simultaneous rules (e.g. LineDetector + FieldDetector) all get the snapshot.
      // COALESCE preserves the MQTT body crop in snapshot_filename (if already set).
      const snapTs = msg.ts || new Date(Date.now() - 2000).toISOString();
      result = await pool.query(
        `UPDATE events
            SET raw_json          = raw_json || jsonb_build_object('_snapshot_full', $1::text, '_snapshot_source', 'edge-http'),
                snapshot_filename  = COALESCE(snapshot_filename, $1::text),
                has_snapshot       = TRUE
          WHERE camera_id  = $2
            AND event_time BETWEEN ($3::timestamptz - interval '5s') AND ($3::timestamptz + interval '10s')
            AND (raw_json->>'_snapshot_full') IS NULL
          RETURNING id`,
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

async function extractLPR(eventId, cameraId, data) {
  try {
    const p = data?.LicensePlateInfo?.LicensePlateInfo || {};
    const v = data?.VehicleInfo?.VehicleInfo || {};
    await pool.query(
      `INSERT INTO license_plates
       (event_id, camera_id, plate_number, confidence, country, region,
        vehicle_type, vehicle_color, vehicle_brand)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [eventId, cameraId,
       p.PlateNumber?.['#text']        ?? null,
       p.PlateNumber?.['@Likelihood']  ?? null,
       p.CountryCode?.['#text']        ?? null,
       p.IssuingEntity?.['#text']      ?? null,
       v.Type?.['#text']               ?? null,
       null,                                    // vehicle_color: Bosch doesn't send; Hikvision/Dahua will
       v.Brand?.['#text']              ?? null]
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
