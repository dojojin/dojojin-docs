// ============================================================
// Vigil Platform — LPR ANPR Core (shared ingest logic)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CS7 — the parse + resolve + ingest logic that used to live inline in
// routes/lpr.js, lifted into a transport-agnostic module so MORE THAN ONE
// "way" can feed the SAME core:
//   Way 1 (lpr-pull.js, dormant) — pulls a Hikvision subscribeEvent stream on
//          the LAN and hands each multipart frame to ingestLprPush().
//   Way 2 (routes/lpr.js, active) — the HTTP push receiver mounts on api-server
//          AND on the standalone lpr-receiver.js; both call ingestLprPush().
// The downstream forward (CIB) is INJECTED (see lpr-forward.js) so this module
// has no transport/retry policy baked in — that stays the caller's concern.
// ============================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');
const { snapPath } = require('./snapshot-path');
// EDGE_MODE: publish pre-normalized LPR events to local NanoMQ instead of
// writing to a local Postgres. Shared with api-server (central) where EDGE_MODE
// is unset → unchanged. CIB forward (gov-critical) is independent and always
// runs. See docs/LOGIC_edge-ingester-divergence.md.
const { EDGE_MODE, publishEdgeEvent } = require('./edge/publisher');
const { plateTypeFromColorName } = require('./helpers/plateType');

// ── RF-IMG: scene downscale-at-ingest ───────────────────────────────
// LPR scene frames arrive at 5–9MP; we don't need that on disk — the plate
// crop carries the readable plate, the scene is just context. Downscale the
// SCENE before storing. CIB already has the raw bytes (forward fires before
// save), and the plate image is left UNTOUCHED (sharpest). The in-code default
// 1080p/q80 is the safety gate that makes "open the data tap" safe regardless
// of the Settings UI — UI only tunes it.
const _RES_DIMS = { '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440] };
let _sceneCfg = { res: '1080p', quality: 80, at: 0 };
async function getSceneCfg(pool) {
  // ponytail: 60s cache — a Settings change lags up to a minute at ingest, fine.
  if (Date.now() - _sceneCfg.at < 60000) return _sceneCfg;
  try {
    const r = await pool.query(
      "SELECT key, value FROM system_settings WHERE key IN ('lpr_scene_resolution','lpr_scene_quality')");
    for (const row of r.rows) {
      if (row.key === 'lpr_scene_resolution' && _RES_DIMS[row.value]) _sceneCfg.res = row.value;
      if (row.key === 'lpr_scene_quality') {
        const q = parseInt(row.value, 10);
        if (q >= 60 && q <= 95) _sceneCfg.quality = q;
      }
    }
  } catch (e) { console.error(`[lpr] scene cfg load: ${e.message}`); }
  _sceneCfg.at = Date.now();
  return _sceneCfg;
}
async function resizeScene(buf, pool) {
  const { res, quality } = await getSceneCfg(pool);
  const [w, h] = _RES_DIMS[res] || _RES_DIMS['1080p'];
  // ponytail: global sharp concurrency; cap/queue if ingest rate ever spikes.
  return sharp(buf).rotate()
    .resize(w, h, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality }).toBuffer();
}

// Thai province ID → name (Hikvision tailandStateID field)
const TH_PROVINCE = {
  0:'ไม่ทราบ',1:'กรุงเทพมหานคร',2:'กระบี่',3:'กาญจนบุรี',4:'กาฬสินธุ์',
  5:'กำแพงเพชร',6:'ขอนแก่น',7:'จันทบุรี',8:'ฉะเชิงเทรา',9:'ชลบุรี',
  10:'ชัยนาท',11:'ชัยภูมิ',12:'ชุมพร',13:'เชียงราย',14:'เชียงใหม่',
  15:'ตรัง',16:'ตราด',17:'ตาก',18:'นครนายก',19:'นครปฐม',
  20:'นครพนม',21:'นครราชสีมา',22:'นครศรีธรรมราช',23:'นครสวรรค์',24:'นนทบุรี',
  25:'นราธิวาส',26:'น่าน',27:'บึงกาฬ',28:'บุรีรัมย์',29:'ปทุมธานี',
  30:'ประจวบคีรีขันธ์',31:'ปราจีนบุรี',32:'ปัตตานี',33:'พระนครศรีอยุธยา',34:'พังงา',
  35:'พัทลุง',36:'พิจิตร',37:'พิษณุโลก',38:'เพชรบุรี',39:'เพชรบูรณ์',
  40:'แพร่',41:'พะเยา',42:'ภูเก็ต',43:'มหาสารคาม',44:'มุกดาหาร',
  45:'แม่ฮ่องสอน',46:'ยะลา',47:'ยโสธร',48:'ร้อยเอ็ด',49:'ระนอง',
  50:'ระยอง',51:'ราชบุรี',52:'ลพบุรี',53:'ลำปาง',54:'ลำพูน',
  55:'เลย',56:'ศรีสะเกษ',57:'สกลนคร',58:'สงขลา',59:'สตูล',
  60:'สมุทรปราการ',61:'สมุทรสงคราม',62:'สมุทรสาคร',63:'สระแก้ว',64:'สระบุรี',
  65:'สิงห์บุรี',66:'สุโขทัย',67:'สุพรรณบุรี',68:'สุราษฎร์ธานี',69:'สุรินทร์',
  70:'หนองคาย',71:'หนองบัวลำภู',72:'อ่างทอง',73:'อุดรธานี',74:'อุทัยธานี',
  75:'อุตรดิตถ์',76:'อุบลราชธานี',77:'อำนาจเจริญ',78:'เบตง',
};

// Hikvision vehicleType → events.object_class, using the same vocabulary the
// mapping-rule UI + Events page facet already use for IVA (Car/Truck/Bus/...).
// events.object_class was never populated for anprAlarm, so any category rule
// filtering by Object Class silently counted 0 forever (found 2026-07-06).
const VEHICLE_TYPE_TO_CLASS = {
  largeBus: 'Bus', truck: 'Truck', pickupTruck: 'Pickup', van: 'Van',
  twoWheelVehicle: 'Motorcycle', threeWheelVehicle: 'Motorcycle',
  SUVMPV: 'Car', vehicle: 'Vehicle', buggy: 'Vehicle', pedestrian: 'Pedestrian',
};

// 3-second dedup window per (camera, plate, time-bucket)
const _dedup = new Map();
function isDuplicate(camId, plate, tsMs) {
  const key = `${camId}|${plate}|${Math.floor(tsMs / 3000)}`;
  if (_dedup.has(key)) return true;
  _dedup.set(key, 1);
  setTimeout(() => _dedup.delete(key), 5000);
  return false;
}

// Classify image part by filename prefix (matches Hikvision ITCCAM naming)
function classifyImage(filename) {
  if (!filename) return 'unknown';
  const stem = filename.replace(/\.[^.]+$/, '').toLowerCase();
  if (stem.startsWith('detectionpicture') || stem.startsWith('pedestriandetectionpicture')) return 'scene';
  if (stem.startsWith('licenseplatepicture')) return 'plate';
  if (stem.startsWith('compositepicture')) return 'composite';
  return 'unknown';
}

// Parse multipart body — boundary-based (no Content-Length requirement)
function parseMultipart(buf, boundary) {
  const SEP   = Buffer.from('--' + boundary);
  const CRLF2 = Buffer.from('\r\n\r\n');
  const parts = [];
  let pos = 0;

  while (pos < buf.length) {
    const s = buf.indexOf(SEP, pos);
    if (s === -1) break;
    pos = s + SEP.length;

    const n = buf.indexOf(SEP, pos);
    const end = n === -1 ? buf.length : n;

    // Skip \r\n after boundary line
    let partStart = pos;
    if (buf[partStart] === 0x0d && buf[partStart + 1] === 0x0a) partStart += 2;

    // Trim trailing \r\n before next boundary
    let partEnd = end;
    if (buf[partEnd - 2] === 0x0d && buf[partEnd - 1] === 0x0a) partEnd -= 2;

    const part = buf.slice(partStart, partEnd);
    const hdrEnd = part.indexOf(CRLF2);
    if (hdrEnd < 0) { pos = end; continue; }

    const hdrs = part.slice(0, hdrEnd).toString('ascii');
    const body = part.slice(hdrEnd + 4);
    if (body.length === 0 && !hdrs.trim()) { pos = end; continue; } // preamble

    const ctMatch = hdrs.match(/content-type:\s*([^\r\n;]+)/i);
    const fnMatch = hdrs.match(/filename="([^"]+)"/i) || hdrs.match(/name="([^"]+)"/i);
    parts.push({
      contentType: ctMatch ? ctMatch[1].trim().toLowerCase() : '',
      filename: fnMatch ? fnMatch[1] : '',
      body,
    });
    pos = end;
  }
  return parts;
}

// Regex-based XML field extractor — sufficient for known Hikvision ANPR structure
function xmlText(xml, ...tags) {
  for (const tag of tags) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`, 'i'));
    if (m) return m[1].trim();
  }
  return '';
}

// Different camera models/firmwares report plateColor with different casing
// ("white" vs "White") and even different tokens for the same real category
// ("colorful" vs "Color" — confirmed 2026-07-03 by inspecting actual snapshots,
// both are ป้ายประมูล). Fold at the one ingest choke point so every reader
// (chart, filters, detail view, exports) sees one consistent lowercase value.
const _PLATE_COLOR_ALIAS = { color: 'colorful' };
function normalizePlateColor(raw) {
  if (!raw) return raw;
  const lc = String(raw).trim().toLowerCase();
  return _PLATE_COLOR_ALIAS[lc] || lc;
}

function parseAnprXml(xmlStr) {
  const plate        = xmlText(xmlStr, 'licensePlate', 'plateNumber', 'licensePlateNumber');
  const confStr      = xmlText(xmlStr, 'confidenceLevel');
  const confidence   = confStr ? parseInt(confStr, 10) : 0;
  const country      = xmlText(xmlStr, 'country') || 'TH';
  const vehicleType  = xmlText(xmlStr, 'vehicleType');
  const vehicleColor = xmlText(xmlStr, 'color');
  const vehicleBrand = xmlText(xmlStr, 'vehicleLogoRecog');
  const plateColor   = normalizePlateColor(xmlText(xmlStr, 'plateColor'));
  const plateType    = xmlText(xmlStr, 'plateType');
  const dateTime     = xmlText(xmlStr, 'dateTime', 'time');
  const laneNo       = xmlText(xmlStr, 'laneNo', 'lane', 'line');
  const direction    = xmlText(xmlStr, 'direction', 'detectDir');
  // Camera ITC analytics (yes | no | unknown; unknown = car/not applicable):
  //   helmet='no'         = motorcycle rider without a helmet (violation)
  //   uphone='yes'        = driver using a phone (violation)
  //   nonMotorManned='yes'= motorcycle carrying a passenger (ซ้อนท้าย — info)
  const helmet         = xmlText(xmlStr, 'helmet');
  const uphone         = xmlText(xmlStr, 'uphone');
  const nonMotorManned = xmlText(xmlStr, 'nonMotorManned');
  // Seatbelt — parsed to an indexed column (not left in rawXml) so the filter is
  // fast and rawXml can later expire without breaking it. true = driver or front
  // passenger flagged not-belted; yes/unknown/absent → false.
  const noSeatbelt = xmlText(xmlStr, 'pilotsafebelt') === 'no'
                  || xmlText(xmlStr, 'vicepilotsafebelt') === 'no';
  // Camera self-identity (for multi-camera resolution — Cloudflare masks source IP).
  // mac is globally unique → primary key; ip is the fallback. Normalise mac for compare.
  const macAddress   = xmlText(xmlStr, 'macAddress').toLowerCase().replace(/[:-]/g, '');
  const ipAddress    = xmlText(xmlStr, 'ipAddress');

  // Province: prefer text name, fall back to ID→map
  const provText  = xmlText(xmlStr, 'provinceName', 'stateName');
  const provIdStr = xmlText(xmlStr, 'tailandStateID', 'stateID', 'province', 'provinceID');
  let region = provText;
  if (!region && provIdStr !== '') {
    const idx = parseInt(provIdStr, 10);
    region = TH_PROVINCE[idx] || provIdStr;
  }

  // Plate bounding box from <PlateRect>
  let bbox = null;
  const rectMatch = xmlStr.match(/<[Pp]late[Rr]ect[^>]*>([\s\S]*?)<\/[Pp]late[Rr]ect>/i);
  if (rectMatch) {
    const r = rectMatch[1];
    bbox = {
      x:      parseInt(xmlText(r, 'X', 'x') || '0', 10),
      y:      parseInt(xmlText(r, 'Y', 'y') || '0', 10),
      width:  parseInt(xmlText(r, 'width')  || '0', 10),
      height: parseInt(xmlText(r, 'height') || '0', 10),
    };
  }

  return { plate, confidence, country, vehicleType, vehicleColor, vehicleBrand,
           plateColor, plateType, region, dateTime, laneNo, direction,
           helmet, uphone, nonMotorManned, noSeatbelt, bbox,
           macAddress, ipAddress };
}

// Resolve which configured LPR camera sent this push, by the camera's own
// identity in the ANPR XML (Cloudflare masks the source IP). mac is the primary
// key; ip is the fallback. Scoped to hikvision push_only (decision #86).
function resolveLprCamera(parsed, loadCameraConfig) {
  const normMac = m => String(m || '').toLowerCase().replace(/[:-]/g, '');
  const lprCams = (loadCameraConfig().cameras || []).filter(c =>
    String(c.vendor || '').toLowerCase() === 'hikvision' && c.push_only);
  let cam = null;
  if (parsed.macAddress) cam = lprCams.find(c => c.mac_address && normMac(c.mac_address) === parsed.macAddress);
  if (!cam && parsed.ipAddress) cam = lprCams.find(c => c.ip_address === parsed.ipAddress);
  return cam || null;
}

// The shared ingest path. `forward(rawBody, contentType, targetUrl)` is injected
// — the core never decides forward/retry policy (that's lpr-forward.js). Any
// "way" (push route or LAN pull) calls this with a raw multipart buffer.
async function ingestLprPush({ rawBody, contentType, pool, SNAPSHOT_DIR, loadCameraConfig, forward, preResolvedCam, legacyUnauthenticated }) {
  const ct  = contentType || '';
  const fwd = (url) => { try { if (forward) forward(rawBody, ct, url); } catch (e) { console.error(`[lpr] forward dispatch: ${e.message}`); } };

  const bMatch = ct.match(/boundary=([-\w]+)/i);
  if (!bMatch) { console.warn('[lpr] push missing multipart boundary — ignoring'); return; }

  try {
    const parts = parseMultipart(rawBody, bMatch[1]);

    // Separate XML and image parts
    let xmlStr = null;
    const images = {};
    for (const p of parts) {
      if (p.contentType.includes('xml')) {
        xmlStr = p.body.toString('utf8').replace(/\0/g, '').trim();
      } else if (p.contentType.includes('jpeg') || p.contentType.includes('image')) {
        const kind = classifyImage(p.filename);
        if (!images[kind]) images[kind] = p.body;
      }
    }

    if (!xmlStr) { console.warn('[lpr] No XML part in push body'); fwd(); return; }

    // Detect ANPR event (vs heartbeat / other event types)
    const isAnpr = /eventType[^>]*>\s*ANPR/i.test(xmlStr)
                || /PlateInfoList/i.test(xmlStr)
                || /licensePlate|plateNumber/i.test(xmlStr);
    if (!isAnpr) { fwd(); return; } // non-ANPR (heartbeat/other)

    const parsed = parseAnprXml(xmlStr);
    if (!parsed.plate) { console.warn('[lpr] ANPR event with empty plate number'); fwd(); return; }

    const cam = preResolvedCam || resolveLprCamera(parsed, loadCameraConfig);
    if (!cam) {
      console.warn(`[lpr] unidentified ANPR camera mac=${parsed.macAddress || '?'} ip=${parsed.ipAddress || '?'} plate=${parsed.plate} — not stored`);
      fwd();
      return;
    }
    const camId = cam.camera_id;

    // Log legacy unauthenticated hits so operators know which cameras to migrate to the tokened URL
    if (legacyUnauthenticated) {
      console.warn(`[lpr] legacy unauthenticated /lpr hit — camera_id=${camId} — migrate this camera to the tokened URL`);
    }

    // CS1 — maintenance pause: stop storing on our side but ALWAYS keep forwarding
    // to the downstream partner (CIB). The LPR camera has a single push slot we
    // took, so our forward is CIB's only feed — pausing must not cut it.
    if (cam.paused) { fwd(cam.lpr_forward_url); return; }

    // Heartbeat: push-only camera (server can't poll it), so the ANPR push IS the
    // liveness signal. Update last_seen_at on every push (incl. dedup repeats).
    // EDGE_MODE: no local DB — central touches last_seen on the published event.
    if (!EDGE_MODE) {
      pool.query('UPDATE cameras SET last_seen_at = NOW(), last_event_at = NOW() WHERE id = $1', [camId])
        .catch(() => {});
    }

    // 3-second dedup
    const tsMs = parsed.dateTime ? new Date(parsed.dateTime).getTime() : Date.now();
    const effectiveTsMs = isNaN(tsMs) ? Date.now() : tsMs;
    if (isDuplicate(camId, parsed.plate, effectiveTsMs)) {
      console.debug(`[lpr] dedup skip: ${parsed.plate} @ ${camId}`);
      fwd(cam.lpr_forward_url);
      return;
    }

    // Advisor #3 — CIB is the camera's feed; forward BEFORE local ingest so a disk
    // or DB hiccup can never delay/block the government-critical forward. The
    // forwarder (lpr-forward.js) owns retry/spool, so a CIB blip is captured there.
    fwd(cam.lpr_forward_url);

    // Save image files — lpr/{YYYY-MM-DD}/{cam}/{slot}/
    const { dir: lprDir, relBase } = snapPath(SNAPSHOT_DIR, 'lpr', camId, effectiveTsMs);
    const tsStamp = effectiveTsMs;
    let sceneFile = null;
    let plateFile = null;
    try {
      if (images.scene) {
        let sceneBuf = images.scene;
        try {
          sceneBuf = await resizeScene(images.scene, pool);
        } catch (e) {
          // never drop the image on resize failure — store the original
          console.error(`[lpr] scene resize failed, storing original: ${e.message}`);
          sceneBuf = images.scene;
        }
        fs.writeFileSync(path.join(lprDir, `lpr_scene_${tsStamp}.jpg`), sceneBuf);
        sceneFile = `${relBase}/lpr_scene_${tsStamp}.jpg`;
      }
      if (images.plate) {
        fs.writeFileSync(path.join(lprDir, `lpr_plate_${tsStamp}.jpg`), images.plate);
        plateFile = `${relBase}/lpr_plate_${tsStamp}.jpg`;
      }
    } catch (e) {
      console.error(`[lpr] writeFile error: ${e.message}`);
    }

    const detectedAt = new Date(effectiveTsMs).toISOString();
    const lprRawJson = {
      plate: parsed.plate, confidence: parsed.confidence,
      country: parsed.country, region: parsed.region,
      vehicleType: parsed.vehicleType || null,
      vehicleColor: parsed.vehicleColor || null,
      vehicleBrand: parsed.vehicleBrand || null,
      plateColor: parsed.plateColor || null,
      direction: parsed.direction || null,
      laneNo: parsed.laneNo || null,
      plateType: parsed.plateType || null,
      helmet: parsed.helmet || null,
      uphone: parsed.uphone || null,
      nonMotorManned: parsed.nonMotorManned || null,
      rawXml: xmlStr.slice(0, 2000),
    };

    if (EDGE_MODE) {
      // Publish pre-normalized ANPR event + license_plate row. Routed under
      // RuleEngine so the central +/onvif-ej/RuleEngine/# sub delivers it; the
      // stored event keeps LPR's original null category + 'anprAlarm' type.
      // Scene image is buffered locally (resized); only _preview_ref crosses MQTT.
      publishEdgeEvent({
        vendor: 'hikvision',
        routeCategory: 'RuleEngine',
        previewRef: sceneFile,
        previewSource: 'lpr-scene',
        event: {
          camera_id: camId,
          event_category: null,
          event_type: 'anprAlarm',
          rule_name: null,
          object_id: null, object_class: VEHICLE_TYPE_TO_CLASS[parsed.vehicleType] || null, likelihood: null,
          event_state: null,
          raw_json: lprRawJson,
          event_time: detectedAt,
        },
        licensePlate: {
          plate_number: parsed.plate, confidence: parsed.confidence,
          country: parsed.country, region: parsed.region || null,
          vehicle_type:  parsed.vehicleType  || null,
          vehicle_color: parsed.vehicleColor || null,
          vehicle_brand: parsed.vehicleBrand || null,
          plate_type: plateTypeFromColorName(parsed.plateColor),
          bbox_x: parsed.bbox?.x ?? null, bbox_y: parsed.bbox?.y ?? null,
          bbox_width: parsed.bbox?.width ?? null, bbox_height: parsed.bbox?.height ?? null,
          plate_image: plateFile,
        },
      });
      console.log(`[lpr] ${parsed.plate} (${parsed.region || parsed.country}) → edge`);
      return;
    }

    // DB insert — GOTCHAS #58: events → license_plates → pg_notify (in that order)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const evRes = await client.query(
        `INSERT INTO events
           (event_type, camera_id, event_time, has_snapshot, snapshot_filename, raw_json, object_class, vehicle_type)
         VALUES ('anprAlarm', $1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [camId, detectedAt, !!sceneFile, sceneFile, lprRawJson, VEHICLE_TYPE_TO_CLASS[parsed.vehicleType] || null, parsed.vehicleType || null]
      );
      const eventId = evRes.rows[0].id;
      await client.query(
        `INSERT INTO license_plates
           (event_id, camera_id, plate_number, confidence, country, region,
            vehicle_type, vehicle_color, vehicle_brand, plate_type,
            bbox_x, bbox_y, bbox_width, bbox_height, plate_image, no_seatbelt,
            plate_color, no_helmet)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          eventId, camId,
          parsed.plate, parsed.confidence,
          parsed.country, parsed.region || null,
          parsed.vehicleType || null, parsed.vehicleColor || null, parsed.vehicleBrand || null,
          plateTypeFromColorName(parsed.plateColor),
          parsed.bbox?.x ?? null, parsed.bbox?.y ?? null,
          parsed.bbox?.width ?? null, parsed.bbox?.height ?? null,
          plateFile, parsed.noSeatbelt || false,
          // #085 perf — same values that feed raw_json (plateColor/helmet), so
          // column and raw_json stay in lockstep with the backfill.
          parsed.plateColor || null, parsed.helmet === 'no',
        ]
      );
      await client.query('COMMIT');
      // pg_notify after all writes committed — reaches the api-server ws-bridge
      // LISTENer (api-server.js) even from a separate process (DB-level notify).
      await pool.query('SELECT pg_notify($1, $2)', ['new_event', String(eventId)]);
      console.log(`[lpr] ${parsed.plate} (${parsed.region || parsed.country}) → event #${eventId}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[lpr] DB error: ${e.message}`);
      if (sceneFile) fs.unlink(path.join(SNAPSHOT_DIR, sceneFile), () => {});
      if (plateFile) fs.unlink(path.join(SNAPSHOT_DIR, plateFile), () => {});
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(`[lpr] unhandled error: ${e.message}`);
  }
}

module.exports = {
  TH_PROVINCE, VEHICLE_TYPE_TO_CLASS, isDuplicate, classifyImage, parseMultipart, xmlText,
  parseAnprXml, resolveLprCamera, ingestLprPush, resizeScene, getSceneCfg,
};

// ------------------------------------------------------------
// Self-check (node src/lpr-core.js) — pure parse path only, no DB.
// ponytail: asserts the parser still extracts plate/province/bbox/identity and
// classifies image parts; the DB path is covered by the live verify, not here.
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const xml = `<EventNotificationAlert><eventType>ANPR</eventType>
    <ANPR><licensePlate>1กข2345</licensePlate><confidenceLevel>92</confidenceLevel>
    <country>TH</country><tailandStateID>42</tailandStateID><dateTime>2026-06-20T10:00:00</dateTime>
    <macAddress>AA:BB:CC:DD:EE:FF</macAddress><ipAddress>10.11.100.4</ipAddress>
    <PlateRect><X>10</X><Y>20</Y><width>120</width><height>40</height></PlateRect></ANPR>
    </EventNotificationAlert>`;
  const p = parseAnprXml(xml);
  assert.strictEqual(p.plate, '1กข2345', 'plate');
  assert.strictEqual(p.confidence, 92, 'confidence');
  assert.strictEqual(p.region, 'ภูเก็ต', 'province 42 → ภูเก็ต');
  assert.strictEqual(p.macAddress, 'aabbccddeeff', 'mac normalised');
  assert.deepStrictEqual(p.bbox, { x: 10, y: 20, width: 120, height: 40 }, 'bbox');

  const b = 'myboundary';
  const mp = Buffer.from(
    `--${b}\r\nContent-Type: application/xml\r\n\r\n${xml}\r\n` +
    `--${b}\r\nContent-Disposition: form-data; name="x"; filename="licensePlatePicture.jpg"\r\nContent-Type: image/jpeg\r\n\r\nJPEGDATA\r\n` +
    `--${b}--\r\n`, 'utf8');
  const parts = parseMultipart(mp, b);
  assert.strictEqual(parts.length, 2, 'two parts');
  assert.ok(parts[0].contentType.includes('xml'), 'xml part');
  assert.strictEqual(classifyImage(parts[1].filename), 'plate', 'plate image classified');

  assert.strictEqual(isDuplicate('C', 'X', 1000), false, 'first not dup');
  assert.strictEqual(isDuplicate('C', 'X', 1000), true,  'second is dup');

  const cam = resolveLprCamera({ macAddress: 'aabbccddeeff', ipAddress: '' },
    () => ({ cameras: [{ camera_id: 'L1', vendor: 'hikvision', push_only: true, mac_address: 'AA-BB-CC-DD-EE-FF' }] }));
  assert.strictEqual(cam && cam.camera_id, 'L1', 'resolve by mac');

  console.log('lpr-core self-check OK');

  // RF-IMG scene-resize self-check (synthetic — proves the resize LOGIC, NOT the
  // real-camera −70% disk claim, which only holds on photographic 9MP scenes).
  (async () => {
    const fakePool = { query: async () => ({ rows: [] }) }; // no rows → defaults 1080p/q80
    const big = await sharp({ create: { width: 4096, height: 2160, channels: 3,
      background: { r: 120, g: 130, b: 140 } } }).jpeg().toBuffer();
    const small = await resizeScene(big, fakePool);
    const meta = await sharp(small).metadata();
    assert.strictEqual(meta.format, 'jpeg', 'resized output is jpeg');
    assert.ok(meta.width <= 1920 && meta.height <= 1080,
      `fit inside 1920x1080 (got ${meta.width}x${meta.height})`);
    assert.strictEqual(meta.width, 1920, '4096w → 1920w');
    console.log(`  scene resize: 4096x2160 → ${meta.width}x${meta.height}, ` +
      `${big.length}B → ${small.length}B (🟡 synthetic; real −% only on camera scenes)`);
    // fallback: a corrupt buffer must reject so the caller's catch stores the original
    let fellBack = false;
    try { await resizeScene(Buffer.from('not a jpeg'), fakePool); } catch { fellBack = true; }
    assert.ok(fellBack, 'corrupt buffer rejects → caller stores original (never drops image)');
    console.log('lpr-core resize self-check OK');
  })().catch(e => { console.error(e); process.exit(1); });
}
