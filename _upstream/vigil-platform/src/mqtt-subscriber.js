// ============================================================
// DojoJin Tech Dashboard — MQTT Subscriber
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
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
require('./singleton')('mqtt-subscriber');   // refuse to run a second copy

// 🆕 Alert engine (LINE notifications)
let alertEngine;
try { alertEngine = require('./alert-engine'); } catch (e) {
  console.warn('🔔 Alert engine not available:', e.message);
}

// ============================================================
// Filter Config — events ที่ ignore (ไม่บันทึก)
// ============================================================

const IGNORED_EVENT_TYPES = [
  'MotionAlarm',           // เก็บ noise มาก ไม่มีประโยชน์
  'JobState',              // RecordingConfig/JobState — recording state ใช้ ONVIF poll แทน
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
  const filename = `${cameraId}_${eventId}_${Date.now()}.jpg`;
  const filepath = path.join(SNAPSHOT_DIR, filename);

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
  let flags = { enable_snapshot: true, enable_vca_overlay: true };
  try {
    const r = await pool.query(
      `SELECT enable_snapshot, enable_vca_overlay FROM cameras WHERE id=$1`,
      [cameraId]
    );
    if (r.rows[0]) flags = {
      enable_snapshot:    r.rows[0].enable_snapshot    !== false,
      enable_vca_overlay: r.rows[0].enable_vca_overlay !== false,
    };
  } catch {}
  _camFlagsCache.set(cameraId, { flags, fetchedAt: now });
  return flags;
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
    const filename = `${cameraId}_${eventId}_mqtt_${Date.now()}.jpg`;
    const filepath = path.join(SNAPSHOT_DIR, filename);
    const buffer = Buffer.from(cleaned, 'base64');
    if (buffer.length < 1000) return null;          // <1KB → not an image
    fs.writeFileSync(filepath, buffer);
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

  // 🆕 Init alert engine
  if (alertEngine) {
    try { alertEngine.init(pool); } catch (e) { console.warn('🔔 Alert engine init error:', e.message); }
  }

  // 🆕 SD status poller (Bosch RCP+ 0x0CB5)
  setTimeout(pollAllSdStatus, 5000);
  setInterval(pollAllSdStatus, SD_POLL_INTERVAL_MS);

  ['+/onvif-ej/RuleEngine/#', '+/onvif-ej/VideoSource/#',
   '+/onvif-ej/Device/#', '+/onvif-ej/RecordingConfig/#'].forEach(t => {
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
    await processMessage(topic, msg);
  } catch (err) { console.error('Parse:', err.message); }
});

client.on('error', (err) => console.error('❌ MQTT:', err.message));

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

  if (!snapshotFilename && shouldHttp && !isLeaveEvent && !isAggregationEvent && camFlags.enable_snapshot) {
    const snap = await captureHttpSnapshot(cameraId, eventId, { withOverlay: camFlags.enable_vca_overlay });
    if (snap) { snapshotFilename = snap.filename; snapshotSource = 'http'; }
  }

  if (snapshotFilename) {
    await pool.query(
      `UPDATE events
          SET raw_json = raw_json || $1::jsonb,
              snapshot_filename = $2,
              has_snapshot = TRUE
        WHERE id = $3`,
      [JSON.stringify({ _snapshot: snapshotFilename, _snapshot_source: snapshotSource }), snapshotFilename, eventId]
    ).catch(() => {});
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
    if (obj?.Appearance?.HumanFace || obj?.Appearance?.HumanBody) {
      await extractAppearance(eventId, cameraId, objectId, obj.Appearance, snapshotFilename);
    }
    if (msg.Data?.LicensePlateInfo) {
      await extractLPR(eventId, cameraId, msg.Data);
    }
  }

  // 🆕 Alert engine hook — เช็ค rules + ส่ง LINE notification (async, ไม่ block)
  if (alertEngine && ruleName) {
    // Enrich with camera_name + location from cameras-config.json so the
    // LINE message can show the real camera name + install location
    // instead of the raw camera_id. cameraMap is the config object keyed
    // by camera_id (see loadConfig).
    const camCfg = cameraMap[cameraId] || {};
    alertEngine.onEvent({
      event_id: eventId,
      camera_id: cameraId,
      camera_name: camCfg.camera_name || cameraId,
      location: camCfg.location || null,
      rule_name: ruleName,
      event_type: eventType,
      object_class: objectClass,
      likelihood,
      event_time: eventTime,
      snapshot_filename: snapshotFilename,
    }).catch(err => console.error('🔔 Alert error:', err.message));
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

async function extractAppearance(eventId, cameraId, objectId, appearance, snapshot) {
  try {
    const face = appearance.HumanFace || {};
    const body = appearance.HumanBody || {};
    const clothing = body.Clothing || {};
    const colorStr = (c) => {
      const cc = c?.ColorCluster?.Color;
      return cc ? `${cc['@X']},${cc['@Y']},${cc['@Z']}` : null;
    };
    const objectClass  = appearance.Class?.Type?.['#text'] || null;
    const confidence   = appearance.Class?.Type?.['@Likelihood'] != null
      ? parseFloat(appearance.Class.Type['@Likelihood']) : null;
    const topXyz    = colorStr(clothing.Tops?.Color);
    const bottomXyz = colorStr(clothing.Bottoms?.Color);
    const hairXyz   = colorStr(face.Hair?.Color);
    await pool.query(
      `INSERT INTO appearances
       (event_id, camera_id, object_id, object_class, confidence,
        gender, hair_length, hair_color_xyz,
        top_category, top_color_xyz, bottom_category, bottom_color_xyz,
        glasses, bag_category, helmet_wear, helmet_subtype, vest_style,
        upper_color, lower_color, hair_color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [eventId, cameraId, objectId, objectClass, confidence,
       face.Gender||null, face.Hair?.Length||null, hairXyz,
       clothing.Tops?.Category||null,    topXyz,
       clothing.Bottoms?.Category||null, bottomXyz,
       face.Accessory?.Opticals?.Wear==='true', body.Belonging?.Bag?.Category||null,
       face.Accessory?.Helmet?.Wear==='true', face.Accessory?.Helmet?.Subtype||null,
       clothing.Tops?.Style||null,
       xyzToColorName(topXyz), xyzToColorName(bottomXyz), xyzToColorName(hairXyz)]
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
