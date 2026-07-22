// ============================================================
// Vigil Platform — Hikvision ISAPI Ingester
// CCTV Analytics & Management Suite — Multi-vendor (Path B, MVP)
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ------------------------------------------------------------
// Receives Smart Events from Hikvision cameras over the ISAPI
// Alert Stream (`GET /ISAPI/Event/notification/alertStream`), a
// long-lived multipart/mixed HTTP response the camera pushes XML
// events into. The ingester normalises each event to the same
// shape mqtt-subscriber.js produces for Bosch, INSERTs into the
// shared `events` table, and fires the `new_event` NOTIFY so the
// dashboard's WS bridge picks it up — alert-engine / stats / UI
// need no vendor-specific code.
//
// Camera list: cameras-config.json entries with vendor:'hikvision'.
// Run standalone:  node src/ingesters/hikvision-isapi.js
// ============================================================

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const mqtt   = require('mqtt');
const { Pool } = require('pg');
const alertEngine = require('../alert-engine');
const { decryptCamCreds } = require('../crypto-creds');
const { parseChallenge, buildDigestHeader } = require('../helpers/digestAuth');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// EDGE_MODE: on a Site Edge box there is no local Postgres — instead of
// INSERTing rows, publish pre-normalized events to the local NanoMQ broker
// (which bridges to central EMQX). See docs/LOGIC_edge-ingester-divergence.md.
const { EDGE_MODE, publishEdgeEvent, newCorrId } = require('../edge/publisher');
// Single-instance lock + boot only when run as a real process (PM2 / standalone).
// Guarded so tests can `require()` this module for _matchPushCam without the lock
// killing the test (it would see the live PM2 ingester's pid) or booting anything.
if (require.main === module) require('../singleton')('hikvision');

const CONFIG_FILE  = path.join(__dirname, '..', '..', 'cameras-config.json');
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'snapshots');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
const { snapPath } = require('../snapshot-path');

// MQTT client for publishing edge snapshots to central via NanoMQ → bridge.
// Task #23: on central (EDGE_MQTT_BROKER unset), this hits central's own EMQX
// directly and needs auth — SNAPSHOT_PUBLISHER_USER/PASSWORD (PUBLISH-only on
// +/onvif-ej/Device/snapshot). On edge, EDGE_MQTT_BROKER points at the local
// NanoMQ which allows anonymous, so these env vars are simply unset there.
const _snapMqttOpts = {
  clientId: `hkv-snap-${process.pid}`, reconnectPeriod: 5000, clean: true,
};
if (process.env.SNAPSHOT_PUBLISHER_USER && process.env.SNAPSHOT_PUBLISHER_PASSWORD) {
  _snapMqttOpts.username = process.env.SNAPSHOT_PUBLISHER_USER;
  _snapMqttOpts.password = process.env.SNAPSHOT_PUBLISHER_PASSWORD;
}
const _snapMqtt = mqtt.connect(process.env.EDGE_MQTT_BROKER || 'mqtt://localhost:1883', _snapMqttOpts);
_snapMqtt.on('error', (e) => console.warn('[hkv-snap-mqtt]', e.message));
const RECONNECT_BASE_MS  = 5_000;   // base reconnect delay
const RECONNECT_MAX_MS   = 30_000;  // backoff ceiling
const UNREACHABLE_CODES  = new Set(['EHOSTUNREACH', 'ENETUNREACH']);
const DEDUP_WINDOW_MS = 3000;    // collapse repeated 'active' posts of one detection

// ============================================================
// Hikvision eventType → normalized event shape
// ------------------------------------------------------------
// event_type reuses Bosch's vocabulary where the concept maps 1:1
// (LineDetector/Crossed, FieldDetector/ObjectsInside) so existing
// category-mapping rules + CLASS_HIERARCHY apply unchanged. Hikvision-
// only events get their own type names. rule_name is set so the event
// counts as an "incident" (like a Bosch IVA rule) in stats + alerts.
// ============================================================
const HIK_EVENT_MAP = {
  linedetection:     { event_type: 'LineDetector/Crossed',        rule_name: 'Line Crossing' },
  fielddetection:    { event_type: 'FieldDetector/ObjectsInside', rule_name: 'Intrusion Detection' },
  regionEntrance:    { event_type: 'RegionEntrance',              rule_name: 'Region Entrance' },
  regionExiting:     { event_type: 'RegionExit',                  rule_name: 'Region Exit' },
  unattendedBaggage: { event_type: 'UnattendedBaggage',           rule_name: 'Unattended Baggage' },
  attendedBaggage:   { event_type: 'ObjectRemoval',               rule_name: 'Object Removal' },
  faceSnap:          { event_type: 'FaceCapture',                 rule_name: 'Face Capture' },
  facedetection:     { event_type: 'FaceDetection',               rule_name: 'Face Detection' },
  // Camera tampering (2026-06-11) — กล้องโดนบัง/ฉากเปลี่ยน/เบลอ = ช่องโหว่
  // security ต้องรู้ทันที. ชื่อ eventType อิงสเปค ISAPI — ถ้า firmware ใช้
  // string อื่น warn "unmapped eventType" จะโผล่ใน log ให้แก้ map ตาม
  shelteralarm:         { event_type: 'TamperDetection', rule_name: 'Camera Tampering (Covered)' },
  scenechangedetection: { event_type: 'TamperDetection', rule_name: 'Camera Tampering (Scene Change)' },
  defocus:              { event_type: 'TamperDetection', rule_name: 'Camera Tampering (Defocus)' },
};

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 3,
  application_name: 'hikvision',
});
pool.on('connect', (c) => { c.query("SET TIME ZONE 'UTC'").catch(() => {}); });


// ============================================================
// Event snapshot capture — pull a still from the camera's ISAPI
// picture endpoint when an event fires, save it under snapshots/,
// so the event shows an image in the Live feed + Snapshots page
// (parity with the Bosch HTTP-snapshot path). Digest two-step.
// snapshot_stream picks quality (default 1 = main).
// ============================================================
// Returns the JPEG Buffer (not saved locally — published to central via MQTT)
function captureSnapshot(cam) {
  return new Promise((resolve) => {
    const stream = parseInt(cam.snapshot_stream, 10) || 1;
    const uri    = `/ISAPI/Streaming/channels/10${stream}/picture`;
    const port   = cam.http_port || 80;

    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get(
        { host: cam.ip_address, port, path: uri, headers, timeout: 5000, insecureHTTPParser: true },
        (res) => {
          if (res.statusCode === 401 && !authHeader) {
            const wa = res.headers['www-authenticate'];
            res.resume();
            if (!wa || !/digest/i.test(wa)) return resolve(null);
            return attempt(buildDigestHeader(
              cam.username, cam.password, 'GET', uri, parseChallenge(wa)));
          }
          if (res.statusCode !== 200) { res.resume(); return resolve(null); }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      );
      r.on('error', () => resolve(null));
      r.on('timeout', () => { r.destroy(); resolve(null); });
    };
    attempt(null);
  });
}

// ============================================================
// Minimal XML field extractor — Hikvision EventNotificationAlert
// is flat enough that a per-tag regex beats pulling in a parser
// dependency (keeps the declared-deps list at decision #97's 10).
// ============================================================
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

// All occurrences of a repeating block tag — inner content per match.
function xmlBlocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

// ============================================================
// Coordinate capture (Smart Events) — VCA EventNotificationAlert
// ส่ง rule polygon (<DetectionRegionList>) และบางรุ่นส่ง target rect
// (<TargetRect>) มาด้วย. เก็บค่า "ดิบ" ลง raw_json โดยไม่แปลง scale —
// สเปค ISAPI บอก RegionCoordinates เป็น grid 0–1000 แต่ยังไม่เคยเห็น
// XML จริงจากกล้องเรา (Smart Events ยังไม่เปิด); ตัดสินเรื่อง scale
// ตอนทำ overlay เมื่อมี event จริงให้เทียบ. additive อย่างเดียว —
// ไม่มีพิกัด = ไม่เพิ่ม field, ห้าม throw เด็ดขาด (อยู่ใน ingest path)
// ============================================================
function extractDetectionRegions(xml) {
  // Number(null/'') = 0 — tag ที่หายไปต้องเป็น NaN ไม่ใช่พิกัด 0 ปลอม
  const numTag = (x, t) => {
    const v = xmlTag(x, t);
    return (v === null || v === '') ? NaN : Number(v);
  };
  try {
    const out = [];
    for (const entry of xmlBlocks(xml, 'DetectionRegionEntry')) {
      const region = {};
      const pts = [];
      for (const rc of xmlBlocks(entry, 'RegionCoordinates')) {
        const x = numTag(rc, 'positionX');
        const y = numTag(rc, 'positionY');
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
      }
      if (pts.length) region.points = pts;
      const rid = numTag(entry, 'regionID');
      if (Number.isFinite(rid)) region.regionID = rid;
      const target = xmlTag(entry, 'detectionTarget');
      if (target) region.target = target;
      const tr = xmlBlocks(entry, 'TargetRect')[0];
      if (tr) {
        const r = ['X', 'Y', 'width', 'height'].map(t => numTag(tr, t));
        if (r.every(Number.isFinite)) {
          region.targetRect = { x: r[0], y: r[1], width: r[2], height: r[3] };
        }
      }
      if (Object.keys(region).length) out.push(region);
    }
    return out;
  } catch { return []; }
}

// ============================================================
// Per-camera Alert Stream connection
// ============================================================
const _dedup = new Map();   // key `${cameraId}|${eventType}` → last host-ms
const _unmappedSeen = new Set();   // eventTypes นอก map ที่ log ไปแล้ว (log once)

function shouldRecord(cameraId, hikType) {
  const key = `${cameraId}|${hikType}`;
  const now = Date.now();
  const last = _dedup.get(key) || 0;
  _dedup.set(key, now);
  return (now - last) > DEDUP_WINDOW_MS;
}

async function ingestEvent(cam, xml) {
  const hikType = xmlTag(xml, 'eventType');
  if (!hikType) return;
  // Touch last_seen on EVERY alertStream message — including the
  // `videoloss` heartbeat the camera sends ~every 10s. Without this the
  // camera only refreshed last_seen when a Smart Event fired, so it went
  // "offline" (and its Camera Status thumbnail vanished) whenever nobody
  // walked past for 90s. The heartbeat keeps it genuinely live.
  // EDGE_MODE: no local DB — central touches last_seen when an event arrives.
  if (!EDGE_MODE) {
    pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
      [cam.camera_id]).catch(() => {});
  }
  // People Counting (2026-06-12) — กล้อง push สถิติ enter/exit ทุก 15 นาที
  // (statisticalMethods=timeRange, ยืนยันจาก XML จริง). เก็บเป็น metric event
  // ตระกูล Aggregation — ชื่อมี 'Aggregation' ทำให้ filter เดิมซ่อนจาก Events
  // list + WS broadcast ให้ฟรี (isMetricEventType / NOT LIKE '%Aggregation%').
  // ไม่มี alert/snapshot/clip. กล้อง retransmit window เก่าได้หลัง reconnect
  // (isDataRetransmission) → กัน insert ซ้ำด้วย NOT EXISTS บน window_start
  if (hikType === 'PeopleCounting') {
    const pc = xmlBlocks(xml, 'peopleCounting')[0];
    if (!pc) return;
    const num = (x, t) => { const v = xmlTag(x, t); return v === null || v === '' ? null : Number(v); };
    const winStart = xmlTag(pc, 'startTime');
    // กล้องส่ง 2 โหมด: timeRange (สรุปต่อ window — increment) และ realtime
    // (ยอดสะสมรายวัน ไม่มี TimeRange) — เก็บเฉพาะ timeRange: ยอดสะสมห้ามปน
    // SUM ของกราฟ และ window_start=null ทำให้กัน duplicate ไม่ทำงาน
    // (เจอจริง 2026-06-12 14:16 "null in=7" ตามด้วย "null in=8")
    if (xmlTag(pc, 'statisticalMethods') !== 'timeRange' || !winStart) return;
    const rawJson = {
      vendor:       'hikvision',
      eventType:    hikType,
      method:       xmlTag(pc, 'statisticalMethods'),
      window_start: winStart,
      window_end:   xmlTag(pc, 'endTime'),
      enter:        num(pc, 'enter'),
      exit:         num(pc, 'exit'),
      duplicate:    num(pc, 'duplicatePeople'),
      regions:      xmlBlocks(xml, 'Region').map(r => ({
        id: num(r, 'id'), name: xmlTag(r, 'name'),
        enter: num(r, 'enter'), exit: num(r, 'exit'),
      })),
      retransmission: xmlTag(xml, 'isDataRetransmission') === 'true',
      dateTime:     xmlTag(xml, 'dateTime'),
    };
    const dt = xmlTag(xml, 'dateTime');
    if (EDGE_MODE) {
      publishEdgeEvent({
        vendor: 'hikvision',
        event: {
          camera_id: cam.camera_id,
          event_category: 'RuleEngine',
          event_type: 'CountAggregation/PeopleCounting',
          rule_name: 'People Counting',
          object_id: null, object_class: null, likelihood: null,
          event_state: 'unknown',
          raw_json: rawJson,
          event_time: (dt ? new Date(dt) : new Date()).toISOString(),
        },
        dedup: { window_start: winStart },
      });
      console.log(`  🔢 [${cam.camera_id}] People Counting ${winStart} in=${rawJson.enter} out=${rawJson.exit} → edge`);
      return;
    }
    pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood, event_state, raw_json, event_time)
       SELECT $1::varchar,'RuleEngine','CountAggregation/PeopleCounting','People Counting',
              NULL,NULL,NULL,'unknown',$2::jsonb,$3::timestamptz
       WHERE NOT EXISTS (
         SELECT 1 FROM events
         WHERE camera_id = $1::varchar AND event_type = 'CountAggregation/PeopleCounting'
           AND raw_json->>'window_start' = $4::text)`,
      [cam.camera_id, JSON.stringify(rawJson), dt ? new Date(dt) : new Date(), winStart]
    ).then(r => {
      if (r.rowCount > 0) {
        console.log(`  🔢 [${cam.camera_id}] People Counting ${winStart} in=${rawJson.enter} out=${rawJson.exit}`);
      }
    }).catch(err => console.error(`  ❌ DB insert counting [${cam.camera_id}]:`, err.message));
    return;
  }

  const mapping = HIK_EVENT_MAP[hikType];
  if (!mapping) {
    // videoloss = heartbeat ~ทุก 10s — เงียบไว้. type อื่นที่ไม่อยู่ใน map
    // log ครั้งแรกที่เจอ (กัน Smart Event ชื่อไม่ตรง map หายเงียบ — 2026-06-11)
    if (hikType !== 'videoloss' && !_unmappedSeen.has(hikType)) {
      _unmappedSeen.add(hikType);
      console.warn(`  ⚠️ [${cam.camera_id}] unmapped eventType "${hikType}" — ignored (add to HIK_EVENT_MAP?)`);
      // dump XML ตัวอย่างครั้งแรกของ type นั้น — ไว้ดู payload โครงจริง
      // ตอนตัดสินใจ map (เช่น PeopleCounting 2026-06-12) โดยไม่ต้อง probe ซ้ำ
      console.warn(`  ⚠️ sample XML: ${xml.replace(/\s+/g, ' ').slice(0, 1500)}`);
    }
    return;
  }

  const hikState = (xmlTag(xml, 'eventState') || 'active').toLowerCase();
  // Hikvision re-posts 'active' ~1×/s while a detection persists; collapse
  // those into one row per detection.
  // 'inactive' ของ fielddetection = ขา "โซนว่างแล้ว" — เก็บเป็น
  // event_state='false' ให้ /api/stats/dwell จับคู่ true→false ได้แบบ
  // Bosch/Dahua (2026-06-11). ขา false ไม่มี snapshot/alert/clip และ UI
  // ซ่อนอยู่แล้ว (convention FieldDetector false เดิม). type อื่น
  // (linedetection ฯลฯ) เป็น event ชั่วขณะ — inactive ทิ้งเหมือนเดิม
  if (hikState !== 'active') {
    if (hikType !== 'fielddetection') return;
    if (!shouldRecord(cam.camera_id, hikType + '|inactive')) return;
    const dtEnd = xmlTag(xml, 'dateTime');
    if (EDGE_MODE) {
      publishEdgeEvent({
        vendor: 'hikvision',
        event: {
          camera_id: cam.camera_id,
          event_category: 'RuleEngine',
          event_type: mapping.event_type,
          rule_name: mapping.rule_name,
          object_id: null, object_class: null, likelihood: null,
          event_state: 'false',
          raw_json: { vendor: 'hikvision', eventType: hikType, eventState: hikState, dateTime: dtEnd },
          event_time: (dtEnd ? new Date(dtEnd) : new Date()).toISOString(),
        },
      });
      console.log(`  ◻️ [${cam.camera_id}] ${mapping.rule_name} zone clear (false half) → edge`);
      return;
    }
    pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood,
        event_state, raw_json, event_time)
       VALUES ($1,'RuleEngine',$2,$3,NULL,NULL,NULL,'false',$4,$5)`,
      [cam.camera_id, mapping.event_type, mapping.rule_name,
       JSON.stringify({ vendor: 'hikvision', eventType: hikType, eventState: hikState, dateTime: dtEnd }),
       dtEnd ? new Date(dtEnd) : new Date()]
    ).then(() => console.log(`  ◻️ [${cam.camera_id}] ${mapping.rule_name} zone clear (false half)`))
     .catch(err => console.error(`  ❌ DB insert false-half [${cam.camera_id}]:`, err.message));
    return;
  }
  if (!shouldRecord(cam.camera_id, hikType)) return;

  const dt = xmlTag(xml, 'dateTime');
  const eventTime = dt ? new Date(dt) : new Date();
  const rawJson = {
    vendor:       'hikvision',
    eventType:    hikType,
    eventState:   hikState,
    channelID:    xmlTag(xml, 'channelID'),
    ipAddress:    xmlTag(xml, 'ipAddress'),
    dateTime:     dt,
    description:  xmlTag(xml, 'eventDescription'),
    activePostCount: xmlTag(xml, 'activePostCount'),
  };
  // rule polygon + target rect (เมื่อกล้องแนบมา) — สำหรับ snapshot overlay
  const regions = extractDetectionRegions(xml);
  if (regions.length) rawJson.detectionRegions = regions;

  if (EDGE_MODE) {
    const corr = newCorrId();
    let previewRef = null;
    try { previewRef = await captureSnapshot(cam, corr); } catch { previewRef = null; }
    const eventTimeIso = eventTime.toISOString();
    publishEdgeEvent({
      vendor: 'hikvision',
      corr,
      previewRef,
      event: {
        camera_id: cam.camera_id,
        event_category: 'RuleEngine',
        event_type: mapping.event_type,
        rule_name: mapping.rule_name,
        object_id: null, object_class: null, likelihood: null,
        event_state: 'true',
        raw_json: rawJson,
        event_time: eventTimeIso,
      },
      alert: {
        camera_name: cam.camera_name || cam.camera_id,
        location: cam.location || null,
        rule_name: mapping.rule_name,
        event_type: mapping.event_type,
        object_class: null,
        likelihood: null,
        event_time: eventTimeIso,
      },
      clip: {
        camera_id: cam.camera_id,
        event_time: eventTimeIso,
        received_at_ms: Date.now(),
      },
    });
    console.log(`  ✅ [${cam.camera_id}] ${mapping.rule_name} → edge${previewRef ? ` 📸 ${previewRef}` : ''}`);
    return;
  }

  try {
    const r = await pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood,
        event_state, raw_json, event_time)
       VALUES ($1,'RuleEngine',$2,$3,NULL,NULL,NULL,'true',$4,$5)
       RETURNING id`,
      [cam.camera_id, mapping.event_type, mapping.rule_name,
       JSON.stringify(rawJson), eventTime]
    );
    const eventId = r.rows[0].id;
    console.log(`  ✅ [${cam.camera_id}] ${mapping.rule_name} → event ${eventId}`);
    // Alert engine — Hikvision Smart Events run the SAME rule-match +
    // cooldown + quiet-hours + LINE pipeline as Bosch IVA rules (rule_name
    // is set). Fire-and-forget so a slow LINE push never blocks ingest.
    // object_class / snapshot_filename are null — Hikvision ingester
    // doesn't capture a snapshot yet (Phase MV.2b).
    alertEngine.onEvent({
      event_id:          eventId,
      camera_id:         cam.camera_id,
      camera_name:       cam.camera_name || cam.camera_id,
      location:          cam.location || null,
      rule_name:         mapping.rule_name,
      event_type:        mapping.event_type,
      object_class:      null,
      likelihood:        null,
      event_time:        eventTime,
      snapshot_filename: null,
    }).catch(err => console.error(`  🔔 alert [${cam.camera_id}]:`, err.message));
    // Notify media-recorder for pre-alarm clip capture (Phase MV.2b).
    // media-recorder LISTENs 'event_for_clip' and decides per-camera from
    // cameras.enable_clip_capture whether to dump a clip — same channel +
    // payload shape mqtt-subscriber uses for Bosch. received_at_ms anchors
    // the clip window to host wall-clock (matches ffmpeg segment names).
    pool.query(
      `SELECT pg_notify('event_for_clip', $1)`,
      [JSON.stringify({
        event_id:       eventId,
        camera_id:      cam.camera_id,
        event_time:     eventTime,
        received_at_ms: Date.now(),
      })]
    ).catch(err => console.error(`  🎬 pg_notify clip [${cam.camera_id}]:`, err.message));
    // pg_notify first — WS push doesn't wait for snapshot (snapshot arrives via MQTT shortly after)
    pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
      .catch(err => console.error('  pg_notify:', err.message));
    // Event snapshot — capture from ISAPI, publish base64 to central via NanoMQ → bridge
    captureSnapshot(cam).then((buf) => {
      if (!buf || buf.length === 0) return;
      const payload = JSON.stringify({
        ts:       eventTime,
        data:     buf.toString('base64'),
        event_id: eventId,
        source:   'hikvision-isapi',
      });
      _snapMqtt.publish(`${cam.camera_id}/onvif-ej/Device/snapshot`, payload, { qos: 0 });
      console.log(`  📸 [${cam.camera_id}] snapshot → MQTT (${(buf.length / 1024).toFixed(0)}KB)`);
    }).catch(() => {});
  } catch (err) {
    console.error(`  ❌ DB insert [${cam.camera_id}]:`, err.message);
    return;
  }
  if (!EDGE_MODE) {
    pool.query(
      `UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
      [cam.camera_id]
    ).catch(() => {});
  }
}

// ============================================================
// Multipart/mixed stream parser (Phase MV.3a)
// ------------------------------------------------------------
// The alertStream is one long multipart/mixed body. Each part is
//   --boundary\r\n
//   Content-Type: <ct>\r\n  Content-Length: <n>\r\n  [more headers]\r\n
//   \r\n
//   <body — exactly Content-Length bytes>
// Part types we handle:
//   application/xml   → Smart Event <EventNotificationAlert>
//   application/json  → Face Capture event (faceCapture)
//   image/jpeg        → face crop / background, bound to a JSON
//                       event by Content-Disposition name="<pId>"
// Binary-safe: works on a Buffer (was a utf8 string — broke on JPEGs).
// ============================================================
const _BOUNDARY = Buffer.from('--boundary');
const _HDR_END  = Buffer.from('\r\n\r\n');

function processMultipart(cam, buf) {
  let offset = 0;
  while (true) {
    const bStart = buf.indexOf(_BOUNDARY, offset);
    if (bStart < 0) break;
    const hdrStart = bStart + _BOUNDARY.length;
    const hdrEnd = buf.indexOf(_HDR_END, hdrStart);
    if (hdrEnd < 0) { offset = bStart; break; }          // headers incomplete — wait
    const headers = buf.slice(hdrStart, hdrEnd).toString('utf8');
    const clMatch = headers.match(/Content-Length:\s*(\d+)/i);
    if (!clMatch) { offset = hdrEnd + _HDR_END.length; continue; }  // skip malformed
    const bodyLen   = parseInt(clMatch[1], 10);
    const bodyStart = hdrEnd + _HDR_END.length;
    if (buf.length < bodyStart + bodyLen) { offset = bStart; break; } // body incomplete — wait
    handlePart(cam, headers, buf.slice(bodyStart, bodyStart + bodyLen));
    offset = bodyStart + bodyLen;
  }
  return offset > 0 ? buf.slice(offset) : buf;
}

function handlePart(cam, headers, body) {
  const ct = (headers.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1] || '';
  if (/application\/json/i.test(ct)) {
    try { handleFaceJson(cam, JSON.parse(body.toString('utf8'))); }
    catch (e) { /* malformed JSON part — ignore */ }
  } else if (/application\/xml/i.test(ct)) {
    ingestEvent(cam, body.toString('utf8'));   // Smart Event (videoloss filtered inside)
  } else if (/image\/jpeg/i.test(ct)) {
    const nm = (headers.match(/name="([^"]+)"/i) || [])[1];
    if (nm) handleImagePart(nm, body);
  }
}

// ── Face Capture (faceCapture JSON + face-crop + background image) ──
// Stream order per capture: JSON part → faceImage part → backgroundImage
// part. The JSON registers a pending entry per face (keyed by face.pId)
// and notes the shared background pId (targetAttrs.pId). Both image
// parts arrive AFTER the JSON; we collect them onto the pending entry
// and ingest ONCE both the crop AND the background are in hand (or an
// 8s timer fires — then ingest with whatever arrived).
//
// Why wait for both: ingestFaceEvent is async. The earlier version
// ingested on the face-crop part, which fired ingestFaceEvent without
// awaiting — the synchronous processMultipart loop then reached the
// background part before the INSERT resolved, so the background had
// nothing to attach to and was dropped.
const _pendingFaces = new Map();   // facePid → { cam, face, eventTime, bgPid, faceImg, bgImg, timer }
const _pendingBodyLink = new Map(); // camera_id → { eventId, ts }

function handleFaceJson(cam, json) {
  if (json.eventType !== 'faceCapture') return;
  const eventTime = json.dateTime ? new Date(json.dateTime) : new Date();
  for (const cap of (json.faceCapture || [])) {
    const bgPid = cap.targetAttrs?.pId || null;
    for (const face of (cap.faces || [])) {
      if (!face.pId) continue;
      const timer = setTimeout(() => flushPendingFace(face.pId), 8000);
      _pendingFaces.set(face.pId, {
        cam, face, eventTime, bgPid, faceImg: null, bgImg: null, timer,
      });
    }
  }
}

function handleImagePart(name, body) {
  // face crop — name matches a pending face's pId
  const pending = _pendingFaces.get(name);
  if (pending) {
    pending.faceImg = body;
    maybeIngestFace(name);
    return;
  }
  // full-frame background — name matches targetAttrs.pId; one background
  // is shared by every face from the same capture, so fan it out.
  for (const [pid, p] of _pendingFaces) {
    if (p.bgPid === name) {
      p.bgImg = body;
      maybeIngestFace(pid);
    }
  }
}

// Ingest once the crop AND background are both collected (or the face
// carries no background pId). Until then, keep waiting for the timer.
function maybeIngestFace(pId) {
  const p = _pendingFaces.get(pId);
  if (!p) return;
  if (!p.faceImg) return;             // crop not in yet
  if (p.bgPid && !p.bgImg) return;    // background expected but not in yet
  clearTimeout(p.timer);
  _pendingFaces.delete(pId);
  ingestFaceEvent(p);
}

function flushPendingFace(pId) {
  const p = _pendingFaces.get(pId);
  if (!p) return;
  _pendingFaces.delete(pId);
  ingestFaceEvent(p);   // timed out — ingest with whatever images arrived
}

async function ingestFaceEvent(pending) {
  const { cam, face, eventTime, faceImg, bgImg } = pending;
  // Flatten the Hikvision face attributes into raw_json. Everything
  // is stored; the Face gallery page picks which fields to display.
  const rawJson = {
    vendor:         'hikvision',
    eventType:      'faceCapture',
    faceId:         face.faceId ?? null,
    age:            face.age?.value ?? null,
    ageGroup:       face.age?.ageGroup ?? null,
    gender:         face.gender?.value ?? null,
    glass:          face.glass?.value ?? null,
    mask:           face.mask?.value ?? null,
    hat:            face.hat?.value ?? null,
    faceExpression: face.faceExpression?.value ?? null,
    stayDuration:   face.stayDuration ?? null,
    faceScore:      face.faceScore ?? null,
    faceRect:       face.faceRect ?? null,
    pId:            face.pId ?? null,
  };

  if (EDGE_MODE) {
    const corr = newCorrId();
    // Buffer both images locally (Tier 2 — never cross MQTT), named by corr.
    let snapFile = null, fullFile = null;
    const tsMs = Date.now();
    const { dir: faceDir2, relBase: faceBase2 } = snapPath(SNAPSHOT_DIR, 'face', cam.camera_id, tsMs);
    const fn2 = `${corr}_${tsMs}.jpg`;
    if (faceImg && faceImg.length > 0) {
      try { fs.writeFileSync(path.join(faceDir2, fn2), faceImg); snapFile = `${faceBase2}/${fn2}`; } catch { snapFile = null; }
    }
    if (bgImg && bgImg.length > 0) {
      try { fs.writeFileSync(path.join(faceDir2, `full_${fn2}`), bgImg); fullFile = `${faceBase2}/full_${fn2}`; } catch { fullFile = null; }
    }
    const g = face.gender?.value;
    const gender = g === 'male' ? 'Male' : g === 'female' ? 'Female' : null;
    const glasses = face.glass?.value === 'yes' || face.glass?.value === 'sunglasses';
    const conf = Number(face.faceScore);
    const appearance = (gender || glasses) ? {
      object_class: 'Person',
      confidence: Number.isFinite(conf) ? conf / 100 : null,
      gender, glasses,
    } : null;
    const eventTimeIso = (eventTime instanceof Date ? eventTime : new Date(eventTime)).toISOString();
    publishEdgeEvent({
      vendor: 'hikvision',
      corr,
      previewRef: snapFile,
      previewFull: fullFile,
      previewSource: 'hikvision-face',
      appearance,
      event: {
        camera_id: cam.camera_id,
        event_category: 'RuleEngine',
        event_type: 'FaceCapture',
        rule_name: 'Face Capture',
        object_id: null, object_class: null, likelihood: null,
        event_state: 'true',
        raw_json: rawJson,
        event_time: eventTimeIso,
      },
      alert: {
        camera_name: cam.camera_name || cam.camera_id,
        location: cam.location || null,
        rule_name: 'Face Capture',
        event_type: 'FaceCapture',
        object_class: null,
        likelihood: null,
        event_time: eventTimeIso,
      },
      clip: {
        camera_id: cam.camera_id,
        event_time: eventTimeIso,
        received_at_ms: Date.now(),
      },
    });
    console.log(`  🙂 [${cam.camera_id}] Face Capture → edge (${rawJson.gender || '?'}, age ${rawJson.age ?? '?'})`
      + (snapFile ? ' +crop' : '') + (fullFile ? ' +full' : ''));
    return corr;
  }

  let eventId;
  try {
    const r = await pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood,
        event_state, raw_json, event_time)
       VALUES ($1,'RuleEngine','FaceCapture','Face Capture',NULL,NULL,NULL,'true',$2,$3)
       RETURNING id`,
      [cam.camera_id, JSON.stringify(rawJson), eventTime]
    );
    eventId = r.rows[0].id;
  } catch (err) {
    console.error(`  ❌ DB insert face [${cam.camera_id}]:`, err.message);
    return null;
  }
  // AP.1 (2026-06-12) — face attributes ลง appearances ให้ Appearance Search
  // ครอบ Hikvision: เพศ (normalize เป็น Male/Female ตาม vocabulary ของ Bosch)
  // + แว่น (sunglasses นับเป็นใส่แว่น). hat จงใจไม่ map → helmet ของ Bosch
  // คือหมวกนิรภัย คนละความหมาย (กัน search หลอก). age ไม่มี column — อยู่ใน
  // raw_json/หน้า Faces ตามเดิม
  {
    const g = face.gender?.value;
    const gender = g === 'male' ? 'Male' : g === 'female' ? 'Female' : null;
    const glasses = face.glass?.value === 'yes' || face.glass?.value === 'sunglasses';
    const conf = Number(face.faceScore);
    if (gender || glasses) {
      pool.query(
        `INSERT INTO appearances (event_id, camera_id, object_class, confidence, gender, glasses)
         VALUES ($1,$2,'Person',$3,$4,$5)`,
        [eventId, cam.camera_id, Number.isFinite(conf) ? conf / 100 : null, gender, glasses]
      ).catch(err => console.error(`  ❌ appearance insert [${cam.camera_id}]:`, err.message));
    }
  }
  // Save both images: face crop (gallery thumbnail) + full-frame
  // background (detail modal). Patched onto raw_json in one UPDATE.
  let snapFile = null, fullFile = null;
  const { dir: faceDir, relBase: faceBase } = snapPath(SNAPSHOT_DIR, 'face', cam.camera_id, Date.now());
  if (faceImg && faceImg.length > 0) {
    const fn = `face_${eventId}.jpg`;
    try { fs.writeFileSync(path.join(faceDir, fn), faceImg); snapFile = `${faceBase}/${fn}`; }
    catch { snapFile = null; }
  }
  if (bgImg && bgImg.length > 0) {
    const fn = `full_${eventId}.jpg`;
    try { fs.writeFileSync(path.join(faceDir, fn), bgImg); fullFile = `${faceBase}/${fn}`; }
    catch { fullFile = null; }
  }
  const patch = {};
  if (snapFile) { patch._snapshot = snapFile; patch._snapshot_source = 'hikvision-face'; }
  if (fullFile) { patch._snapshot_full = fullFile; }
  if (Object.keys(patch).length) {
    const fields = [`raw_json = raw_json || $1::jsonb`];
    const params = [JSON.stringify(patch)];
    if (snapFile) {
      fields.push(`snapshot_filename = $2`, `has_snapshot = TRUE`);
      params.push(snapFile);
    }
    params.push(eventId);
    await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id=$${params.length}`,
      params).catch(() => {});
  }
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
    .catch(err => console.error('  pg_notify:', err.message));
  // Pre-alarm clip — Face Capture gets a clip too (full-scene video
  // context, not just the crop). media-recorder LISTENs event_for_clip.
  pool.query(`SELECT pg_notify('event_for_clip', $1)`, [JSON.stringify({
    event_id:       eventId,
    camera_id:      cam.camera_id,
    event_time:     eventTime,
    received_at_ms: Date.now(),
  })]).catch(err => console.error(`  🎬 pg_notify clip [${cam.camera_id}]:`, err.message));
  console.log(`  🙂 [${cam.camera_id}] Face Capture → event ${eventId}`
    + ` (${rawJson.gender || '?'}, age ${rawJson.age ?? '?'})`
    + (snapFile ? ' +crop' : '') + (fullFile ? ' +full' : ''));
  alertEngine.onEvent({
    event_id:          eventId,
    camera_id:         cam.camera_id,
    camera_name:       cam.camera_name || cam.camera_id,
    location:          cam.location || null,
    rule_name:         'Face Capture',
    event_type:        'FaceCapture',
    object_class:      null,
    likelihood:        null,
    event_time:        eventTime,
    snapshot_filename: snapFile,
  }).catch(err => console.error(`  🔔 alert [${cam.camera_id}]:`, err.message));
  if (!EDGE_MODE) {
    pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
      [cam.camera_id]).catch(() => {});
  }
  return eventId;
}

function connectCamera(cam) {
  if (_destroyed.has(cam.camera_id)) return;
  _activeCams.set(cam.camera_id, cam);
  const port = cam.http_port || cam.port || 80;
  const uri  = '/ISAPI/Event/notification/alertStream';
  const method = 'GET';

  const doRequest = (authHeader) => {
    const headers = { Accept: 'application/xml, multipart/mixed' };
    if (authHeader) headers.Authorization = authHeader;

    const req = http.request(
      { host: cam.ip_address, port, path: uri, method, headers, timeout: 0, insecureHTTPParser: true },
      (res) => {
        if (res.statusCode === 401) {
          const wa = res.headers['www-authenticate'];
          if (!wa || !/digest/i.test(wa)) {
            console.error(`  ❌ [${cam.camera_id}] 401 without Digest challenge`);
            res.resume();
            return scheduleReconnect(cam);
          }
          res.resume();   // drain
          const challenge = parseChallenge(wa);
          const digest = buildDigestHeader(
            cam.username, cam.password, method, uri, challenge);
          return doRequest(digest);
        }
        if (res.statusCode !== 200) {
          console.error(`  ❌ [${cam.camera_id}] HTTP ${res.statusCode}`);
          res.resume();
          return scheduleReconnect(cam);
        }

        console.log(`  📡 [${cam.camera_id}] Alert Stream connected (${cam.ip_address}:${port})`);
        _retryCount.delete(cam.camera_id);
        // Binary-safe Buffer accumulation — JPEG parts ride in this stream.
        let buffer = Buffer.alloc(0);
        res.on('data', (chunk) => {
          buffer = processMultipart(cam, Buffer.concat([buffer, chunk]));
          // runaway guard — a stuck part shouldn't grow memory unbounded
          if (buffer.length > 4 * 1024 * 1024) buffer = buffer.slice(-1024 * 1024);
        });
        res.on('end',   () => { console.warn(`  ⚠️  [${cam.camera_id}] stream ended`); scheduleReconnect(cam); });
        res.on('error', (e) => { console.error(`  ❌ [${cam.camera_id}] stream:`, e.message); scheduleReconnect(cam); });
      }
    );
    _eventReqs.set(cam.camera_id, req);
    req.on('error', (e) => {
      if (_eventReqs.get(cam.camera_id) === req) _eventReqs.delete(cam.camera_id);
      console.error(`  ❌ [${cam.camera_id}] request:`, e.message);
      scheduleReconnect(cam, e.code);
    });
    req.end();
  };

  doRequest(null);
}

const _reconnectTimers = new Map();
const _activeCams      = new Map();   // camera_id → cam (currently live or reconnecting)
const _eventReqs       = new Map();   // camera_id → current long-lived ISAPI request
const _destroyed       = new Set();   // camera_ids that must not reconnect (hot-removed)
const _retryCount      = new Map();   // camera_id → consecutive EHOSTUNREACH count (for backoff)

function cameraConfigSignature(cam) {
  return JSON.stringify({
    ip_address: cam.ip_address || '',
    username: cam.username || '',
    password: cam.password || '',
    http_port: cam.http_port || cam.port || 80,
    snapshot_stream: parseInt(cam.snapshot_stream, 10) || 1,
  });
}

function stopCameraConnection(cameraId) {
  _destroyed.add(cameraId);
  _activeCams.delete(cameraId);
  clearTimeout(_reconnectTimers.get(cameraId));
  _reconnectTimers.delete(cameraId);
  _retryCount.delete(cameraId);
  const req = _eventReqs.get(cameraId);
  if (req) {
    try { req.destroy(); } catch { /* ignore */ }
    _eventReqs.delete(cameraId);
  }
}

function scheduleReconnect(cam, errCode = null) {
  if (_destroyed.has(cam.camera_id)) return;
  if (_reconnectTimers.has(cam.camera_id)) return;   // already pending
  let delay;
  if (UNREACHABLE_CODES.has(errCode)) {
    const retries = _retryCount.get(cam.camera_id) || 0;
    delay = Math.min(RECONNECT_BASE_MS * (2 ** retries), RECONNECT_MAX_MS);
    _retryCount.set(cam.camera_id, retries + 1);
  } else {
    delay = RECONNECT_BASE_MS;
    _retryCount.delete(cam.camera_id);
  }
  const t = setTimeout(() => {
    _reconnectTimers.delete(cam.camera_id);
    connectCamera(cam);
  }, delay);
  _reconnectTimers.set(cam.camera_id, t);
}

// ============================================================
// Bootstrap — config load + hot-reload via fs.watch
// ============================================================
function loadHikvisionCameras() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return (cfg.cameras || [])
      .filter(c => String(c.vendor || 'bosch').toLowerCase() === 'hikvision')
      .filter(c => !c.paused)
      // push_only cameras send events to us (FAS/ANPR push receiver), so the server
      // never needs to pull their alertStream — and usually CAN'T (push-only sites are
      // unreachable for inbound). Excluding them here stops the connect-ETIMEDOUT retry
      // spam. syncCameras()'s teardown loop also stops a live pull if the flag is set later.
      .filter(c => !c.push_only)
      .map(decryptCamCreds);
  } catch (e) {
    console.error('❌ Cannot read cameras-config.json:', e.message);
    return [];
  }
}

// Diff the new camera list against _activeCams: connect new cameras,
// stop removed ones, reconnect cameras whose IP/credentials changed.
function syncCameras() {
  const newCams = loadHikvisionCameras();
  const newById = new Map(newCams.map(c => [c.camera_id, c]));

  for (const cam of newCams) {
    if (!cam.ip_address || !cam.username || !cam.password) continue;
    const prev    = _activeCams.get(cam.camera_id);
    const changed = prev && cameraConfigSignature(prev) !== cameraConfigSignature(cam);
    if (changed) {
      console.log(`  🔄 [${cam.camera_id}] config changed — reconnecting`);
      stopCameraConnection(cam.camera_id);
      setTimeout(() => { _destroyed.delete(cam.camera_id); connectCamera(cam); }, RECONNECT_BASE_MS);
    } else if (!prev) {
      // Clear any stale _destroyed flag: a camera flipped push_only→pull was
      // torn down (stopCameraConnection set _destroyed), so connectCamera would
      // no-op without this. Lets a live pull→push→pull flip reconnect, no restart.
      _destroyed.delete(cam.camera_id);
      console.log(`  ➕ [${cam.camera_id}] new camera — connecting`);
      connectCamera(cam);
    }
  }

  for (const [id] of _activeCams) {
    if (!newById.has(id)) {
      console.log(`  ➖ [${id}] removed from config — stopping`);
      stopCameraConnection(id);
    }
  }
}

function watchConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    fs.watch(CONFIG_FILE, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        console.log('  🔄 cameras-config.json changed — syncing Hikvision cameras...');
        setTimeout(syncCameras, 500);
      }
    });
    console.log(`  👁️  Watching ${CONFIG_FILE}`);
  } catch (e) { console.warn('Watch failed:', e.message); }
}

function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  📷 Hikvision ISAPI Ingester (Multi-vendor MVP)  ║');
  console.log('╚══════════════════════════════════════════════════╝');

  // Alert engine — own instance in this process. Cooldown caches don't need
  // sharing across vendors; centralising is a plugin-refactor task (MV.x).
  // EDGE_MODE: alerts run centrally (no local DB) — edge publishes alert info.
  if (!EDGE_MODE) alertEngine.init(pool);
  _faceAlarmServer = startFaceAlarmServer();
  const cams = loadHikvisionCameras();
  // ponytail: observability only — name push-only cameras we intentionally skip pulling,
  // so an absent camera in the connect log reads as "by design" not "lost".
  try {
    const skipped = (JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).cameras || [])
      .filter(c => String(c.vendor || 'bosch').toLowerCase() === 'hikvision' && !c.paused && c.push_only)
      .map(c => c.camera_id);
    if (skipped.length) console.log(`  ⏭️  push_only (no pull, events via push receiver): ${skipped.join(', ')}`);
  } catch { /* config already validated above */ }
  if (cams.length === 0) {
    console.log('  ℹ️  No vendor:"hikvision" cameras in cameras-config.json — waiting.');
    console.log('     Add one via the dashboard — no restart needed.');
  }
  for (const cam of cams) {
    if (!cam.ip_address || !cam.username || !cam.password) {
      console.error(`  ⚠️  [${cam.camera_id}] missing ip_address/username/password — skipped`);
      continue;
    }
    console.log(`  → ${cam.camera_id} (${cam.ip_address})`);
    connectCamera(cam);
  }
  watchConfig();
}

// ── Face Alarm Push Server (port 3010) ───────────────────────────────────
// Receives Hikvision Alarm Server HTTP POST push (face recognition results).
// Format: multipart/form-data; boundary=boundary
//   Part 1: JSON (alarmResult) — recognition result with name/listType/similarity
//   Parts 2-4: JPEG images — face crop (img.jpg), full frame (liveCapture.jpg),
//              FDLib reference photo (contrImg.jpg)
// Camera sends two POSTs per detection: alarmResult (processed) + mixedTargetDetection (skipped).
// ponytail: bind to LAN IP only + allowlist source IP (GOTCHAS #57)
const FACE_PUSH_BIND      = process.env.FACE_PUSH_BIND  || '192.168.10.31';
const FACE_PUSH_PORT      = parseInt(process.env.FACE_PUSH_PORT  || '3010', 10);
// 1.6: comma-separated allowlist → Set (multi-camera support)
const FACE_PUSH_ALLOW     = new Set(
  (process.env.FACE_PUSH_ALLOW || '192.168.10.235').split(',').map(s => s.trim()).filter(Boolean)
);
// 1.3: body size cap — default 10 MB
const FAS_MAX_BODY_BYTES  = parseInt(process.env.FAS_MAX_BODY_BYTES || String(10 * 1024 * 1024), 10);

let _faceAlarmServer = null; // 1.8: stored for shutdown()

// IM3: resolve a push_only Hikvision cam by IP from a config camera list.
// Pure + testable. push_only cams aren't in _activeCams (IM1 skips connectCamera
// for them) but still push face events to the FAS server. Creds aren't needed on
// the push path, so no decrypt. Paused cams are ignored (no ingest while paused).
function _matchPushCam(cameras, ip) {
  return (cameras || []).find(c =>
    c.ip_address === ip &&
    String(c.vendor || 'bosch').toLowerCase() === 'hikvision' &&
    c.push_only && !c.paused
  ) || null;
}

function findCamByIp(ip) {
  for (const [, cam] of _activeCams) {
    if (cam.ip_address === ip) return cam;
  }
  // Fallback for push_only cams. The FACE_PUSH_ALLOW check (line ~1096) already
  // gated this IP, so this only ever matches an explicitly-configured camera.
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return _matchPushCam(cfg.cameras, ip);
  } catch { return null; }
}

// 1.7: parse boundary from Content-Type header
function parseBoundary(ct) {
  const m = (ct || '').match(/boundary=([^\s;]+)/i);
  return m ? m[1].replace(/^"(.*)"$/, '$1') : null;
}

// Shared with the api-server cross-site receiver (routes/face-push.js, IM3-R)
// so both parse the Hikvision face-push body identically.
const { parseFaceAlarmMultipart } = require('../helpers/face-multipart');

async function ingestFaceAlarmEvent(cam, alarmJson, images) {
  const eventTime  = new Date();
  const cap        = alarmJson?.CaptureResult?.[0] ?? null;
  const candidate  = cap?.FaceContrastResult?.[0]?.faces?.[0]?.identify?.[0]?.candidate?.[0] ?? null;
  const attrMap    = {};
  for (const p of (cap?.Face?.Property ?? [])) {
    if (p.description) attrMap[p.description] = p.value;
  }

  const personName = candidate?.reserve_field?.name ?? null;
  const listType   = candidate?.listType ?? null;
  const fdLibName  = candidate?.FDLibName ?? null;
  const similarity = candidate?.similarity ?? null;
  const humanId    = candidate?.human_id ?? null;

  const rawJson = {
    vendor: 'hikvision',
    eventType: 'faceRecognition',
    personName, listType, fdLibName, similarity, humanId,
    age:            attrMap.age ?? null,
    ageGroup:       attrMap.ageGroup ?? null,
    gender:         attrMap.gender ?? null,
    glass:          attrMap.glass ?? null,
    mask:           attrMap.mask ?? null,
    hat:            attrMap.hat ?? null,
    faceExpression: attrMap.faceExpression ?? null,
    faceScore:      attrMap.score ?? null,
  };

  // EDGE_MODE: no local DB — buffer images (Tier 2, never cross MQTT) + publish to NanoMQ.
  // Central ingests via the bridge and fetches the images via the Tier-2 proxy. GOTCHAS #101.
  if (EDGE_MODE) {
    const corr = newCorrId();
    let snapFile = null, fullFile = null;
    const tsMs = Date.now();
    const { dir: alarmDir, relBase: alarmBase } = snapPath(SNAPSHOT_DIR, 'face', cam.camera_id, tsMs);
    const fn = `${corr}_${tsMs}.jpg`;
    const fImg = images?.['faceImage'], bImg = images?.['backgroundImage'];
    if (fImg && fImg.length > 0) {
      try { fs.writeFileSync(path.join(alarmDir, fn), fImg); snapFile = `${alarmBase}/${fn}`; } catch { snapFile = null; }
    }
    if (bImg && bImg.length > 0) {
      try { fs.writeFileSync(path.join(alarmDir, `full_${fn}`), bImg); fullFile = `${alarmBase}/full_${fn}`; } catch { fullFile = null; }
    }
    // Library/ref photo (FDLib enrolled face): deterministic path per person → written ONCE,
    // central reuses the same filename so Tier-2 fetches it once (no re-send per recognition).
    let libFile = null;
    if (humanId) {
      const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'x';
      const libRel = `face/ref/${safe(cam.camera_id)}/${safe(fdLibName || 'lib')}/${safe(humanId)}.jpg`;
      const libAbs = path.join(SNAPSHOT_DIR, libRel);
      const libImg = images?.['faceLibImage'];
      try {
        if (libImg && libImg.length > 0 && !fs.existsSync(libAbs)) {
          fs.mkdirSync(path.dirname(libAbs), { recursive: true });
          fs.writeFileSync(libAbs, libImg);
        }
        if (fs.existsSync(libAbs)) libFile = libRel;   // attach if present (written now or earlier)
      } catch { libFile = null; }
    }
    // Immediate appearance from the recognition attributes themselves — same
    // pattern as FaceCapture (line ~640). Independent of the body-pairing
    // path (_pendingBodyLink/ingestBodyAppearance below): that one only fires
    // if the terminal ALSO sends a separate Body message within 10s, which
    // some Hikvision face-recognition terminals never do (found 2026-07-06 —
    // Hikvision_FaceReg_C01 stopped pairing after 2026-06-23, leaving 0
    // Person Data rows despite every event carrying usable attributes).
    const recGender = attrMap.gender === 'male' ? 'Male' : attrMap.gender === 'female' ? 'Female' : null;
    const recGlasses = attrMap.glass === 'yes' || attrMap.glass === 'sunglasses';
    const recConf = Number(attrMap.score);
    const recAppearance = (recGender || recGlasses) ? {
      object_class: 'Person',
      confidence: Number.isFinite(recConf) ? recConf / 100 : null,
      gender: recGender, glasses: recGlasses,
    } : null;
    publishEdgeEvent({
      vendor: 'hikvision',
      corr,
      previewRef: snapFile,
      previewFull: fullFile,
      previewLib: libFile,
      previewSource: 'hikvision-alarm',
      appearance: recAppearance,
      event: {
        camera_id: cam.camera_id,
        event_category: 'RuleEngine',
        event_type: 'FaceRecognition',
        rule_name: 'Face Recognition Match',
        object_id: null, object_class: null, likelihood: null,
        event_state: 'true',
        raw_json: rawJson,
        event_time: eventTime.toISOString(),
      },
    });
    return;
  }

  let eventId;
  try {
    const r = await pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood,
        event_state, raw_json, event_time)
       VALUES ($1,'RuleEngine','FaceRecognition','Face Recognition Match',NULL,NULL,NULL,'true',$2,$3)
       RETURNING id`,
      [cam.camera_id, JSON.stringify(rawJson), eventTime]
    );
    eventId = r.rows[0].id;
    _pendingBodyLink.set(cam.camera_id, { eventId, ts: Date.now() });
  } catch (err) {
    console.error(`  ❌ DB insert face alarm [${cam.camera_id}]:`, err.message);
    return;
  }
  // Immediate appearance from the recognition attributes — same pattern as
  // FaceCapture (line ~713). Doesn't wait for the body-pairing message
  // (found 2026-07-06: some terminals never send one, leaving Person Data
  // permanently empty for that camera despite usable attributes on every event).
  {
    const gender = attrMap.gender === 'male' ? 'Male' : attrMap.gender === 'female' ? 'Female' : null;
    const glasses = attrMap.glass === 'yes' || attrMap.glass === 'sunglasses';
    const conf = Number(attrMap.score);
    if (gender || glasses) {
      pool.query(
        `INSERT INTO appearances (event_id, camera_id, object_class, confidence, gender, glasses)
         VALUES ($1,$2,'Person',$3,$4,$5)`,
        [eventId, cam.camera_id, Number.isFinite(conf) ? conf / 100 : null, gender, glasses]
      ).catch(err => console.error(`  ❌ appearance insert [${cam.camera_id}]:`, err.message));
    }
  }

  const { dir: alarmDir, relBase: alarmBase } = snapPath(SNAPSHOT_DIR, 'face', cam.camera_id, Date.now());
  const saveImg = (buf, suffix) => {
    if (!buf || buf.length === 0) return null;
    const fn = `${suffix}_${eventId}.jpg`;
    try { fs.writeFileSync(path.join(alarmDir, fn), buf); return `${alarmBase}/${fn}`; }
    catch { return null; }
  };
  const snapFile = saveImg(images['faceImage'],       'face');
  const fullFile = saveImg(images['backgroundImage'], 'full');
  const refFile  = saveImg(images['faceLibImage'],    'ref');

  const patch = {};
  if (snapFile) { patch._snapshot = snapFile; patch._snapshot_source = 'hikvision-alarm'; }
  if (fullFile) patch._snapshot_full = fullFile;
  if (refFile)  patch._snapshot_ref  = refFile;
  if (Object.keys(patch).length) {
    const fields = [`raw_json = raw_json || $1::jsonb`];
    const params = [JSON.stringify(patch)];
    if (snapFile) { fields.push(`snapshot_filename = $2`, `has_snapshot = TRUE`); params.push(snapFile); }
    params.push(eventId);
    await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id=$${params.length}`,
      params).catch(() => {});
  }

  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
    .catch(err => console.error('  pg_notify:', err.message));
  pool.query(`SELECT pg_notify('event_for_clip', $1)`, [JSON.stringify({
    event_id: eventId, camera_id: cam.camera_id,
    event_time: eventTime, received_at_ms: Date.now(),
  })]).catch(err => console.error(`  clip notify [${cam.camera_id}]:`, err.message));

  const groupLabel = fdLibName || (listType === 'blackList' ? 'Blacklist' : listType === 'whiteList' ? 'Whitelist' : listType || 'Unknown');
  const matchInfo = personName
    ? ` ${personName} (${groupLabel}, ${Math.round((similarity || 0) * 100)}%)`
    : ' (no match)';
  console.log(`  🔍 [${cam.camera_id}] Face Recognition →${matchInfo} event ${eventId}`);

  alertEngine.onEvent({
    event_id:          eventId,
    camera_id:         cam.camera_id,
    camera_name:       cam.camera_name || cam.camera_id,
    location:          cam.location || null,
    rule_name:         'Face Recognition Match',
    event_type:        'FaceRecognition',
    object_class:      null,
    likelihood:        null,
    event_time:        eventTime,
    snapshot_filename: fullFile || snapFile,
    person_name:       personName,
    match_confidence:  similarity ? `${Math.round(similarity * 100)}%` : null,
    list_type:         listType,
  }).catch(err => console.error(`  alert [${cam.camera_id}]:`, err.message));

  if (!EDGE_MODE) {
    pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
      [cam.camera_id]).catch(() => {});
  }
}

async function ingestBodyAppearance(cam, bodyJson, images) {
  const pending = _pendingBodyLink.get(cam.camera_id);
  if (!pending) return;
  if (Date.now() - pending.ts > 10_000) { _pendingBodyLink.delete(cam.camera_id); return; }
  const eventId = pending.eventId;
  _pendingBodyLink.delete(cam.camera_id);

  const human = bodyJson?.CaptureResult?.[0]?.Human ?? null;
  if (!human) return;

  const pm = {};
  for (const p of (human.Property ?? [])) {
    if (p.description) pm[p.description] = p.value;
  }

  let bodyFile = null;
  const humanBuf = images['humanImage'];
  if (humanBuf && humanBuf.length > 0) {
    const { dir: bodyDir, relBase: bodyBase } = snapPath(SNAPSHOT_DIR, 'face', cam.camera_id, Date.now());
    const fn = `body_${eventId}.jpg`;
    try { fs.writeFileSync(path.join(bodyDir, fn), humanBuf); bodyFile = `${bodyBase}/${fn}`; }
    catch { bodyFile = null; }
  }

  const patch = {};
  if (bodyFile)         patch._snapshot_body  = bodyFile;
  if (pm.jacketColor)   patch.jacketColor      = pm.jacketColor;
  if (pm.trousersColor) patch.trousersColor    = pm.trousersColor;
  if (pm.jacketType)    patch.jacketType       = pm.jacketType;
  if (pm.trousersType)  patch.trousersType     = pm.trousersType;
  if (pm.direction)     patch.direction        = pm.direction;
  if (pm.bag)           patch.bag              = pm.bag;
  if (pm.hairStyle)     patch.hairStyle        = pm.hairStyle;
  if (pm.things != null)  patch.things         = pm.things;
  // Capture remaining Hikvision body attributes (e.g. ridingBike, ridingWithPassenger)
  // that are not individually handled above, so future fields are stored automatically.
  const _bodyHandled = new Set(['jacketColor','trousersColor','jacketType','trousersType',
    'direction','bag','hairStyle','things','score','gender','glass','mask','age','ageGroup',
    'faceExpression','hat']);
  for (const [k, v] of Object.entries(pm)) {
    if (!_bodyHandled.has(k) && v != null) patch[k] = v;
  }

  if (Object.keys(patch).length) {
    pool.query(
      `UPDATE events SET raw_json = raw_json || $1::jsonb WHERE id = $2`,
      [JSON.stringify(patch), eventId]
    ).catch(err => console.error(`  body patch [${cam.camera_id}]:`, err.message));
  }

  const _cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  // Hikvision bottom category values differ from BOSCH — map to canonical names
  const _BOT_MAP = { longTrousers: 'Trousers', shortTrousers: 'Shorts', skirt: 'Skirt', dress: 'Dress' };
  const upper_color     = (pm.jacketColor   && pm.jacketColor.toLowerCase()   !== 'unknown') ? _cap(pm.jacketColor)   : null;
  const lower_color     = (pm.trousersColor && pm.trousersColor.toLowerCase() !== 'unknown') ? _cap(pm.trousersColor) : null;
  const top_category    = pm.jacketType    ? _cap(pm.jacketType)                              : null;
  const bottom_category = pm.trousersType  ? (_BOT_MAP[pm.trousersType] || _cap(pm.trousersType)) : null;
  const bag_category    = pm.bag === 'yes' ? 'Backpack' : null;
  const gender          = pm.gender === 'male' ? 'Male' : pm.gender === 'female' ? 'Female' : null;
  const glasses         = pm.glass === 'yes' || pm.glass === 'sunglasses';
  const confidence      = pm.score != null ? Number(pm.score) / 100 : null;
  const attributes      = {};
  if (pm.direction) attributes.direction = pm.direction;
  if (pm.hairStyle) attributes.hairStyle = pm.hairStyle;
  if (pm.things === 'yes') attributes.carrying = true;
  if (pm.mask && pm.mask !== 'unknown') attributes.mask = pm.mask;

  // The immediate FaceRecognition insert (above, in ingestFaceAlarmEvent) may
  // already have created a minimal appearances row for this event_id — no
  // UNIQUE constraint on event_id, so enrich that row instead of inserting a
  // duplicate (found 2026-07-06 while adding the immediate-insert fallback).
  (async () => {
    try {
      const upd = await pool.query(
        `UPDATE appearances SET
           object_class=$2, confidence=$3, gender=$4, glasses=$5,
           upper_color=$6, lower_color=$7, top_category=$8, bottom_category=$9,
           bag_category=$10, attributes=$11
         WHERE event_id=$1`,
        [eventId, 'Person', confidence, gender, glasses,
         upper_color, lower_color, top_category, bottom_category, bag_category,
         Object.keys(attributes).length ? JSON.stringify(attributes) : null]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO appearances
           (event_id, camera_id, object_class, confidence, gender, glasses,
            upper_color, lower_color, top_category, bottom_category, bag_category, attributes)
           VALUES ($1,$2,'Person',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [eventId, cam.camera_id, confidence, gender, glasses,
           upper_color, lower_color, top_category, bottom_category, bag_category,
           Object.keys(attributes).length ? JSON.stringify(attributes) : null]
        );
      }
    } catch (err) { console.error(`  body appearance upsert [${cam.camera_id}]:`, err.message); }
  })();

  console.log(`  👕 [${cam.camera_id}] Body appearance -> event ${eventId} (${upper_color ?? '?'}/${lower_color ?? '?'})`);
}

function startFaceAlarmServer() {
  const srv = http.createServer((req, res) => {
    const src = req.socket.remoteAddress?.replace('::ffff:', '');

    // 1.4: request timeout — destroy silently, no response needed
    req.setTimeout(10_000, () => {
      console.warn(`  [FAS] request timeout from ${src}`);
      if (!res.headersSent) { res.writeHead(408); res.end('Request Timeout'); }
      req.destroy();
    });

    // 1.6: allowlist check (Set supports multi-IP)
    if (!FACE_PUSH_ALLOW.has(src)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    // 1.1: POST-only
    if (req.method !== 'POST') {
      res.writeHead(405); res.end('Method Not Allowed'); return;
    }
    // 1.2: must be multipart
    const ct = req.headers['content-type'] || '';
    if (!/multipart\//i.test(ct)) {
      res.writeHead(415); res.end('Unsupported Media Type'); return;
    }
    // 1.5: reject unknown camera early (before reading body)
    const cam = findCamByIp(src);
    if (!cam) {
      console.warn(`  [FAS] unknown camera IP ${src} — rejected`);
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // 1.7: parse boundary from Content-Type header
    const boundary = parseBoundary(ct);

    let totalBytes = 0;
    let rejected   = false;
    const chunks   = [];

    // 1.3: body size cap
    req.on('data', c => {
      if (rejected) return;
      totalBytes += c.length;
      if (totalBytes > FAS_MAX_BODY_BYTES) {
        rejected = true;
        console.warn(`  [FAS] body too large from ${src} (${totalBytes} B) — rejected`);
        res.writeHead(413); res.end('Payload Too Large');
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (rejected) return;
      res.writeHead(200); res.end('OK');
      const body = Buffer.concat(chunks);
      const { alarmJson, bodyJson, images } = parseFaceAlarmMultipart(body, boundary);
      if (alarmJson) {
        ingestFaceAlarmEvent(cam, alarmJson, images)
          .catch(err => console.error('  face alarm ingest error:', err.message));
      } else if (bodyJson) {
        ingestBodyAppearance(cam, bodyJson, images)
          .catch(err => console.error('  body appearance ingest error:', err.message));
      }
    });
  });
  // IM6: degrade, don't crash. FACE_PUSH_BIND อาจไม่ใช่ interface ของเครื่องนี้
  // (เช่น dev ที่บ้าน bind 192.168.10.31 = EADDRNOTAVAIL) → เดิม unhandled 'error'
  // ทำให้ทั้ง ingester crash-loop. face push เป็น optional → log แล้วไปต่อ
  // (pull cameras + sync ยังทำงาน). GOTCHAS: FAS bind failure must not kill ingester.
  srv.on('error', (e) => {
    console.error(`  ⚠️  [FAS] face push server bind failed (${e.code} ${FACE_PUSH_BIND}:${FACE_PUSH_PORT}) — face push receiver DISABLED, ingester continues. Set FACE_PUSH_BIND to an available interface to enable.`);
  });
  srv.listen(FACE_PUSH_PORT, FACE_PUSH_BIND, () =>
    console.log(`  Face alarm server on ${FACE_PUSH_BIND}:${FACE_PUSH_PORT} (allow: ${[...FACE_PUSH_ALLOW].join(',')})`));
  return srv; // 1.8: return for shutdown()
}

function shutdown() {
  console.log('\n⏏  Hikvision ingester shutting down...');
  for (const t of _reconnectTimers.values()) clearTimeout(t);
  try { alertEngine.shutdown(); } catch { /* ignore */ }
  _faceAlarmServer?.close(); // 1.8: graceful FAS shutdown
  pool.end().finally(() => process.exit(0));
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// Run only when launched directly (PM2). Guarded so tests can require the
// module for _matchPushCam without booting the ingester / FAS server / DB.
if (require.main === module) main();

module.exports = { _matchPushCam };
