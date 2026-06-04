// ============================================================
// DojoJin Tech Dashboard — Hikvision ISAPI Ingester
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
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { Pool } = require('pg');
const alertEngine = require('../alert-engine');
const { decryptCamCreds } = require('../crypto-creds');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('../singleton')('hikvision');   // refuse to run a second copy

const CONFIG_FILE  = path.join(__dirname, '..', '..', 'cameras-config.json');
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'snapshots');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
const RECONNECT_MS = 5000;       // delay before re-opening a dropped stream
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
};

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
pool.on('connect', (c) => { c.query("SET TIME ZONE 'UTC'").catch(() => {}); });

// ============================================================
// HTTP Digest auth — Hikvision ISAPI rejects Basic by default.
// Two-step: first request gets 401 + WWW-Authenticate challenge,
// we hash the response and retry. RFC 2617 (qop=auth, MD5).
// ============================================================
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function parseChallenge(header) {
  const out = {};
  // header looks like: Digest realm="...", nonce="...", qop="auth", opaque="..."
  const body = header.replace(/^Digest\s+/i, '');
  for (const m of body.matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

function buildDigestHeader(user, pass, method, uri, challenge) {
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';
  const qop = challenge.qop ? challenge.qop.split(',')[0].trim() : null;
  const ha1 = md5(`${user}:${challenge.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${challenge.realm}", `
        + `nonce="${challenge.nonce}", uri="${uri}", response="${response}"`;
  if (challenge.opaque) h += `, opaque="${challenge.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

// ============================================================
// Event snapshot capture — pull a still from the camera's ISAPI
// picture endpoint when an event fires, save it under snapshots/,
// so the event shows an image in the Live feed + Snapshots page
// (parity with the Bosch HTTP-snapshot path). Digest two-step.
// snapshot_stream picks quality (default 1 = main).
// ============================================================
function captureSnapshot(cam, eventId) {
  return new Promise((resolve) => {
    const stream = parseInt(cam.snapshot_stream, 10) || 1;
    const uri    = `/ISAPI/Streaming/channels/10${stream}/picture`;
    const port   = cam.http_port || 80;
    const filename = `${cam.camera_id}_${eventId}_${Date.now()}.jpg`;
    const filepath = path.join(SNAPSHOT_DIR, filename);

    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get(
        { host: cam.ip_address, port, path: uri, headers, timeout: 5000 },
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
          res.on('end', () => {
            try { fs.writeFileSync(filepath, Buffer.concat(chunks)); resolve(filename); }
            catch { resolve(null); }
          });
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

// ============================================================
// Per-camera Alert Stream connection
// ============================================================
const _dedup = new Map();   // key `${cameraId}|${eventType}` → last host-ms

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
  pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
    [cam.camera_id]).catch(() => {});
  const mapping = HIK_EVENT_MAP[hikType];
  if (!mapping) return;   // ignore videoloss heartbeats + unmapped types

  const hikState = (xmlTag(xml, 'eventState') || 'active').toLowerCase();
  // Hikvision re-posts 'active' ~1×/s while a detection persists; collapse
  // those into one row per detection. The 'inactive' (ended) half is dropped
  // outright — mirrors how the dashboard hides Bosch state='false' halves.
  if (hikState !== 'active') return;
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
    // Event snapshot — pull a still from the camera so the event shows an
    // image in the Live feed + Snapshots page (parity with Bosch). pg_notify
    // fires AFTER snapshot UPDATE so WS event arrives with snapshot_file ready.
    captureSnapshot(cam, eventId).then(async (filename) => {
      if (filename) {
        await pool.query(
          `UPDATE events
              SET raw_json = raw_json || $1::jsonb,
                  snapshot_filename = $2,
                  has_snapshot = TRUE
            WHERE id = $3`,
          [JSON.stringify({ _snapshot: filename, _snapshot_source: 'hikvision-isapi' }), filename, eventId]
        ).catch(() => {});
        console.log(`  📸 [${cam.camera_id}] snapshot ${filename}`);
      }
      pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
        .catch(err => console.error('  pg_notify:', err.message));
    }).catch(() => {
      pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
        .catch(err => console.error('  pg_notify:', err.message));
    });
  } catch (err) {
    console.error(`  ❌ DB insert [${cam.camera_id}]:`, err.message);
    return;
  }
  pool.query(
    `UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
    [cam.camera_id]
  ).catch(() => {});
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
  // Save both images: face crop (gallery thumbnail) + full-frame
  // background (detail modal). Patched onto raw_json in one UPDATE.
  let snapFile = null, fullFile = null;
  if (faceImg && faceImg.length > 0) {
    snapFile = `${cam.camera_id}_${eventId}_${Date.now()}.jpg`;
    try { fs.writeFileSync(path.join(SNAPSHOT_DIR, snapFile), faceImg); }
    catch { snapFile = null; }
  }
  if (bgImg && bgImg.length > 0) {
    fullFile = `${cam.camera_id}_full_${eventId}_${Date.now()}.jpg`;
    try { fs.writeFileSync(path.join(SNAPSHOT_DIR, fullFile), bgImg); }
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
  pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
    [cam.camera_id]).catch(() => {});
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
      { host: cam.ip_address, port, path: uri, method, headers, timeout: 0 },
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
      scheduleReconnect(cam);
    });
    req.end();
  };

  doRequest(null);
}

const _reconnectTimers = new Map();
const _activeCams      = new Map();   // camera_id → cam (currently live or reconnecting)
const _eventReqs       = new Map();   // camera_id → current long-lived ISAPI request
const _destroyed       = new Set();   // camera_ids that must not reconnect (hot-removed)

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
  const req = _eventReqs.get(cameraId);
  if (req) {
    try { req.destroy(); } catch { /* ignore */ }
    _eventReqs.delete(cameraId);
  }
}

function scheduleReconnect(cam) {
  if (_destroyed.has(cam.camera_id)) return;
  if (_reconnectTimers.has(cam.camera_id)) return;   // already pending
  const t = setTimeout(() => {
    _reconnectTimers.delete(cam.camera_id);
    connectCamera(cam);
  }, RECONNECT_MS);
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
      setTimeout(() => { _destroyed.delete(cam.camera_id); connectCamera(cam); }, RECONNECT_MS);
    } else if (!prev) {
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
  alertEngine.init(pool);
  const cams = loadHikvisionCameras();
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

function shutdown() {
  console.log('\n⏏  Hikvision ingester shutting down...');
  for (const t of _reconnectTimers.values()) clearTimeout(t);
  try { alertEngine.shutdown(); } catch { /* ignore */ }
  pool.end().finally(() => process.exit(0));
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

main();
