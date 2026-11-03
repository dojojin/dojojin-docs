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
const { touchCamera } = require('./helpers/touchCamera');

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const env    = require('./config');
const sharp = require('sharp');
const { snapPath } = require('./snapshot-path');
// EDGE_MODE: publish pre-normalized LPR events to local NanoMQ instead of
// writing to a local Postgres. Shared with api-server (central) where EDGE_MODE
// is unset → unchanged. CIB forward (gov-critical) is independent and always
// runs. See docs/LOGIC_edge-ingester-divergence.md.
const { EDGE_MODE, publishEdgeEvent } = require('./edge/publisher');
const { plateTypeFromColorName } = require('./helpers/plateType');
// ตัดสิน "อ่านป้ายได้ดีพอ" ตอนบันทึกแล้วตรึงไว้ (migration 234) ห้ามคำนวณใหม่ย้อนหลัง
const helmet = require('./helpers/helmetCriteria');

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

// ── crop ป้ายทะเบียนเอง แทนที่ cutout ของกล้อง (2026-08-26) ─────────────────
//
// ปัญหาที่แก้: cutout ที่กล้อง Hikvision ส่งมาวางกรอบเยื้อง ป้ายไปชนขอบแล้วโดนตัด
// แทบทุกใบ (สำรวจ 6 กล้อง hkt: บรรทัดจังหวัดหรือเลขท้ายหายไปทุกตัวอย่าง) ทั้งที่
// กล้องให้พื้นที่มามากพอ — เป็นเรื่องการวางกรอบ ไม่ใช่เรื่องขนาด
//
// ทำไมต้อง crop "ก่อน" resize:
//   กล้องส่งภาพเต็มเฟรมมาที่ ~3840x2160 (9MP) แล้วเราย่อเหลือ 1920x1080 เก็บลงดิสก์
//   ถ้า crop จากภาพที่ย่อแล้วจะได้ป้ายกว้างครึ่งเดียว เบลอจนอ่านบรรทัดจังหวัดไม่ออก
//   บนป้ายขนาดกลางของระบบ (50px) — วัดจริงแล้วเห็นชัดในภาพเทียบ
//
// ทำไมต้อง clone ไม่ใช่เรียก sharp() สองครั้ง:
//   ต้นทุนเกือบทั้งหมดคือการถอดรหัส JPEG 9MP (~35 ms) ส่วน extract เองราคา ~1 ms
//   วัดบนเครื่อง hkt จริง: resize อย่างเดียว 40 ms · clone 41 ms · เรียกใหม่ 49 ms
//   ที่พีค 10.6 event/วินาที = 43.5% ของ 1 core (clone) เทียบ 51.9% (เรียกใหม่)
//   🔴 ห้ามเปลี่ยนกลับไปเรียก sharp() สองครั้ง — โหลดขึ้น 22% โดยไม่มีอะไรฟ้อง
const PLATE_CROP_PAD = 0.15;   // เผื่อรอบป้าย 15% ต่อด้าน — เจ้าของเลือกจากภาพเทียบจริง
const PLATE_CROP_MIN_PX = 24;  // เล็กกว่านี้ crop ไปก็อ่านไม่ออก ใช้ของกล้องดีกว่า

// bbox ต้องเป็นกริด 0–1000 เท่านั้น — กฎเดียวกับ _bboxInRange117() ใน api-server.js
// ที่ใช้วาดกรอบทับภาพ · เวนเดอร์ที่ส่งพิกเซลดิบมาจะไม่ผ่านด่านนี้และตกไปใช้ cutout
// ของกล้องแทน ซึ่งถูกต้องกว่าการ crop ด้วยพิกัดที่ตีความผิด
// คืน null = ใช้ได้ · คืนสตริง = เหตุผลที่ใช้ไม่ได้ (เอาไปขึ้น log ให้คนอ่านรู้เรื่อง)
// แยกสองกรณีออกจากกันเพราะความหมายต่างกันคนละเรื่อง:
//   "กล้องไม่ได้ส่งกรอบมา" = ปกติ วัดที่ hkt ได้ 3.60% ของ event (ทุกกล้องมี ไม่ใช่ตัวไหนเสีย)
//   "กรอบเกินกริด 0–1000"  = ผิดปกติ แปลว่าเวนเดอร์ส่งพิกเซลดิบมา ต้องไปดูตัวแปลง
function _bboxReason(b) {
  if (!b) return 'กล้องไม่ได้ส่งกรอบมา';
  const { x, y, width: w, height: h } = b;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return 'กล้องไม่ได้ส่งกรอบมา';
  if (x < 0 || y < 0 || (x + w) > 1000 || (y + h) > 1000) return 'กรอบเกินกริด 0–1000 (พิกเซลดิบ?)';
  return null;
}
function _bboxUsable(b) { return _bboxReason(b) === null; }

/**
 * ถอดรหัสภาพเต็มเฟรมรอบเดียว แล้วแตกเป็นสองสาย: scene ที่ย่อแล้ว + crop ป้าย
 * คืน { sceneBuf, plateBuf, reason } — plateBuf เป็น null ได้เสมอ ผู้เรียกต้อง
 * ตกกลับไปใช้ cutout ของกล้อง ไม่ใช่ถือว่าเป็นความล้มเหลว
 */
async function sceneAndPlate(buf, pool, bbox) {
  const { res, quality } = await getSceneCfg(pool);
  const [rw, rh] = _RES_DIMS[res] || _RES_DIMS['1080p'];
  const pipe = sharp(buf).rotate();
  const meta = await pipe.metadata();

  // ── ตัดสินใจเรื่อง crop ให้จบก่อน แล้วค่อยยิงสองสายพร้อมกัน ────────────────
  let reason = null, region = null;
  // EXIF orientation ≠ 1 = .rotate() สลับด้านภาพ แต่ bbox ที่กล้องส่งมาอ้างอิงเฟรม
  // ก่อนหมุน → crop จะเลื่อนทุกใบแบบเงียบ ๆ · สำรวจ 25 ใบที่ hkt พบ 0 ใบ แต่ถ้าวันหนึ่ง
  // มีขึ้นมา ต้องถอยไปใช้ cutout ของกล้อง ไม่ใช่เดาต่อ
  if (meta.orientation && meta.orientation !== 1) reason = `EXIF orientation=${meta.orientation}`;
  else if (_bboxReason(bbox)) reason = _bboxReason(bbox);
  else {
    const sx = meta.width / 1000, sy = meta.height / 1000;
    const X = bbox.x * sx, Y = bbox.y * sy;
    const W = bbox.width * sx, H = bbox.height * sy;
    const px = W * PLATE_CROP_PAD, py = H * PLATE_CROP_PAD;
    // หนีบให้อยู่ในกรอบภาพ — รถชิดขอบเฟรมจะได้ระยะเผื่อไม่ครบ ซึ่งยังดีกว่าไม่ได้ crop
    const L = Math.max(0, Math.round(X - px));
    const T = Math.max(0, Math.round(Y - py));
    const RW = Math.min(meta.width - L, Math.round(W + px * 2));
    const RH = Math.min(meta.height - T, Math.round(H + py * 2));
    if (RW < PLATE_CROP_MIN_PX || RH < PLATE_CROP_MIN_PX) reason = `กรอบเล็กเกิน (${RW}x${RH})`;
    else region = { left: L, top: T, width: RW, height: RH };
  }

  // 🔴 สองสายนี้ต้องทำงาน **พร้อมกัน** ห้ามเรียงกัน — clone ใช้ผลการถอดรหัสร่วมกัน
  //    ได้ต่อเมื่อทั้งคู่ยังทำงานอยู่ · พอสายแรกจบ libvips ปล่อยของที่ถอดไว้ทิ้ง
  //    สายที่สองจึงต้องถอดรหัส 9MP ใหม่ทั้งดุ้น
  //    วัดบนเครื่อง hkt: เรียงกัน 52 ms · พร้อมกัน 41 ms · ของเดิมไม่มี crop 40 ms
  //    เขียนผิดเป็นเรียงกันแล้ว "ยังทำงานถูกทุกอย่าง" แค่แพงขึ้น 30% เงียบ ๆ
  //
  // ⚠️ แต่ละสายมี .catch() ของตัวเองที่จุดสร้าง ไม่ใช่ที่ await — Promise.all จึงไม่มี
  //    ทางถูก reject และ crop ที่ล้มไม่พา scene ตกไปด้วย (scene คือสิ่งที่ห้ามหายที่สุด)
  const sceneJob = pipe.clone()
    .resize(rw, rh, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality }).toBuffer()
    .catch((e) => { console.error(`[lpr] scene resize failed: ${e.message}`); return null; });

  const plateJob = region
    ? pipe.clone().extract(region).jpeg({ quality: 92 }).toBuffer()
        .catch((e) => { reason = e.message; return null; })
    : Promise.resolve(null);

  const [sceneBuf, plateBuf] = await Promise.all([sceneJob, plateJob]);
  return { sceneBuf, plateBuf, reason };
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

// ชื่อไฟล์ภาพของหนึ่งเหตุการณ์
// 🔴 เวลาอย่างเดียวไม่พอ — กล้องรายงานเป็นมิลลิวินาที และรถสองคันในเฟรมเดียว
//    (หรือคนละเลน) ได้ timestamp เท่ากันบ่อยมาก ไฟล์จึงทับกันแล้วแถวหนึ่งไปโชว์
//    ภาพป้ายของอีกคัน · วัดจริง 2026-08-16: 4,046 ไฟล์ถูกใช้ร่วมกัน กระทบ 8,098 แถว
//    = 1.29% ของภาพทั้งหมด (เช่น กว7012 กับ 9ขบ2564 ที่ 14:15:15.922 ตรงกันเป๊ะ)
//    prefix ต้องคงเดิม — health.js นับพื้นที่ดิสก์จาก 'lpr_plate_' / 'lpr_scene_'
function lprImageName(kind, tsMs) {
  return `lpr_${kind}_${tsMs}_${crypto.randomBytes(3).toString('hex')}.jpg`;
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

// ── One-off survey hook (diagnostic only — never affects parsing or forwarding) ──
// classifyImage() knows scene/plate/composite; anything else becomes 'unknown' and
// is dropped with no trace, so a camera can push driver-face or body crops for
// months without anyone noticing (2026-08-15 survey). Two safety valves:
//   • the first 'unknown' filename per camera is warned once — permanent, no spam
//   • LPR_DIAG_CAMS="C32-...,C30-..." additionally dumps the FULL XML + part list
//     to LPR_DIAG_DIR, capped at LPR_DIAG_MAX per camera, because raw_json.rawXml
//     is truncated at 2000 chars and the tail has never been seen.
// Unset LPR_DIAG_CAMS and the hook costs one Set lookup per event.
const _diagCams = new Set(env.list('LPR_DIAG_CAMS'));
const _diagDir  = env.str('LPR_DIAG_DIR') || path.join(__dirname, '..', 'data', 'lpr-diag');
// สุ่มตาม "เวลา" ไม่ใช่ "จำนวน" — เพดานแบบนับจำนวนจะเต็มด้วยของชั่วโมงแรกที่เปิด
// (เปิดตี 4 ก็ได้แต่ข้อมูลกลางคืน) และตัวนับยังรีเซ็ตทุกครั้งที่ pm2 restart
// เก็บ 1 ใบต่อกล้องต่อ N วินาที ⇒ กระจายทั้งวันเอง ไม่ขึ้นกับว่าเริ่มตอนไหน
const _diagEverySec = env.int('LPR_DIAG_EVERY_SEC');
const _diagMaxBytes = env.int('LPR_DIAG_MAX_MB') * 1024 * 1024;
// ฟิลด์ที่กำลังตามหาค่าจริง — เจอเมื่อไหร่เก็บทันที ไม่ต้องรอรอบ (ของหายากห้ามพลาด)
const _diagWatch = env.list('LPR_DIAG_WATCH');
const _diagLast = new Map();   // camId -> เวลาที่เก็บใบล่าสุด
let _diagBytes = 0;
const _warnedUnknown = new Set();
// เตือนครั้งเดียวต่อกล้องเมื่อ crop ป้ายเองไม่ได้ — ที่ 300 ครั้ง/นาที การเตือนทุกใบคือการถล่ม log
const _warnedNoCrop = new Set();
// LPR_FACE_DIR ตั้งเมื่อไหร่ = เก็บรูปที่ classifyImage() ไม่รู้จักลงดิสก์ (ทุกกล้อง ไม่ใช่แค่ diag)
const _faceDir = env.str('LPR_FACE_DIR');
const _faceMaxBytes = env.int('LPR_FACE_MAX_MB') * 1024 * 1024;
let _faceBytes = 0;
let _faceWarned = false;
// เก็บเฉพาะ event ของรถชนิดนี้ (เช่น twoWheelVehicle) — ว่างไว้ = ทุกชนิด
const _faceVehicle = env.str('LPR_FACE_VEHICLE');
// เก็บภาพ scene เต็มเฟรมของ event ที่ตรงเงื่อนไขด้วย — วัตถุดิบสำหรับตรวจใบหน้าเอง
// (กล้องรุ่นนี้ส่งหน้าคนขี่มอเตอร์ไซค์เป็นไฟล์แยกไม่ได้ ดู §15.1.1)
// ภาพ scene ~1 MB/ใบ จึงจำกัดทั้ง "กล้องไหน" และ "ทุกกี่วินาที"
const _sceneCams = new Set(env.list('LPR_SCENE_CAMS'));
const _sceneEverySec = env.int('LPR_SCENE_EVERY_SEC');
const _sceneLast = new Map();

function _diagCapture(camId, xmlStr, partNames, unknownParts, images) {
  const unknown = partNames.filter(n => n.includes('=unknown('));
  if (unknown.length && !_warnedUnknown.has(camId)) {
    _warnedUnknown.add(camId);
    console.warn(`[lpr] ${camId}: ภาพที่ classifyImage() ไม่รู้จักและถูกทิ้ง — ${unknown.join(' ')}`);
  }

  // เก็บรูปที่ไม่มีที่ไป (pilotPicture / copilotPicture / ภาพลำตัว) ลงดิสก์ไว้ดูเอง
  // ยังไม่ต่อเข้า pipeline และไม่มี UI — สำรวจอย่างเดียว มีเพดานไบต์กันดิสก์เต็ม
  if (_faceDir && _faceBytes < _faceMaxBytes) {
    const vtype = (xmlStr.match(/<vehicleType>([^<]*)<\/vehicleType>/) || [])[1] || '';
    const wanted = !_faceVehicle || vtype === _faceVehicle;
    // วันที่ท้องถิ่น ไม่ใช่ UTC — ไม่งั้นช่วงเที่ยงคืนถึงเจ็ดโมงเช้าจะไปกองในโฟลเดอร์ของเมื่อวาน
    const day = new Date().toLocaleDateString('sv-SE');
    const write = (sub, name, buf) => {
      try {
        const dir = path.join(_faceDir, day, sub, camId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), buf);
        _faceBytes += buf.length;
      } catch (e) {
        if (!_faceWarned) { _faceWarned = true; console.warn(`[lpr] face capture: ${e.message}`); }
      }
    };

    if (wanted && unknownParts) {
      for (const p of unknownParts) {
        if (_faceBytes >= _faceMaxBytes) break;
        if (p.body.length < 1024) continue;        // ข้าม plateBinaryPicture 280B ที่ไม่ใช่รูปคน
        const stem = String(p.filename || 'part').replace(/[^\w.-]/g, '_');
        write('face', `${Date.now()}_${stem}`, p.body);
      }
    }

    // ภาพเต็มเฟรมของ event ที่สนใจ — จำกัดกล้องและความถี่ เพราะใบละ ~1 MB
    const scene = images && images.scene;
    if (wanted && scene && _sceneCams.has(camId) && _faceBytes < _faceMaxBytes) {
      const now = Date.now();
      if (now - (_sceneLast.get(camId) || 0) >= _sceneEverySec * 1000) {
        _sceneLast.set(camId, now);
        const plate = ((xmlStr.match(/<licensePlate>([^<]*)<\/licensePlate>/) || [])[1] || 'x').replace(/[^\w]/g, '');
        write('scene', `${now}_${plate}.jpg`, scene);
      }
    }
  }

  if (!_diagCams.has(camId)) return;
  if (_diagBytes >= _diagMaxBytes) return;

  const hit = _diagWatch.find((t) => {
    const m = xmlStr.match(new RegExp(`<${t}>([^<]*)</${t}>`));
    return m && !['0', '', 'unknown'].includes(m[1].trim());
  });
  const now = Date.now();
  if (!hit && now - (_diagLast.get(camId) || 0) < _diagEverySec * 1000) return;

  try {
    fs.mkdirSync(_diagDir, { recursive: true });
    // ใบที่เจอค่าที่ตามหา ตั้งชื่อขึ้นต้น hit_ ให้หยิบง่าย
    const base = path.join(_diagDir, `${hit ? `hit-${hit}_` : ''}${camId}_${now}`);
    const parts = partNames.join('\n') + '\n';
    fs.writeFileSync(`${base}.xml`, xmlStr);
    fs.writeFileSync(`${base}.parts.txt`, parts);
    _diagBytes += xmlStr.length + parts.length;
    _diagLast.set(camId, now);
  } catch (e) { console.warn(`[lpr] diag capture: ${e.message}`); }
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

// Hikvision's vehicleLogoRecog is a numeric code (full official ANPR SDK
// table lives client-side in dashboard/page-lpr.js's _LPR_BRAND, used there
// for DISPLAY only — the raw code was never resolved before writing to the
// DB, so it showed up as a second, separate "brand" next to the Dahua text
// name for the same real manufacturer, e.g. Toyota (text) vs "1060" (never
// resolved) — both counted, neither filter caught the other. 2026-07-23:
// resolve to the SAME canonical spelling Dahua already uses in our data, at
// the one ingest choke point (parseAnprXml below), so /api/lpr/brands's
// GROUP BY collapses correctly and both vendors' rows are one filter option.
// Only the codes actually observed in production so far — an unseen code
// just passes through as the raw string, same "confirmed observations only"
// convention as DAHUA_BRAND_FIX (dahua-protocol.js).
const HIK_BRAND_FIX = {
  1027: 'AstonMartin', 1028: 'Audi', 1030: 'Porsche', 1031: 'Buick', 1036: 'Benz',
  1037: 'BMW', 1040: 'Bentley', 1043: 'Honda', 1044: 'Peugeot', 1045: 'BYD',
  1053: 'Volkswagen', 1056: 'Dodge', 1060: 'Toyota', 1063: 'Ferrari', 1064: 'Ford',
  1067: 'Fiat', 1084: 'Jeep', 1085: 'Jaguar', 1089: 'Cadillac', 1095: 'RollsRoyce',
  1101: 'LandRover', 1102: 'Suzuki', 1104: 'Lexus', 1105: 'Renault', 1107: 'MINI',
  1108: 'Maserati', 1112: 'Mazda', 1116: 'Opel', 1120: 'Chery', 1121: 'Kia',
  1123: 'Nissan', 1128: 'Mitsubishi', 1133: 'Subaru', 1134: 'Skoda', 1139: 'Tesla',
  1144: 'Volvo', 1149: 'Hyundai', 1151: 'Chevrolet', 1167: 'Isuzu', 1559: 'Foton',
  1579: 'JAC', 1581: 'JMC', 1584: 'Jinbei', 1586: 'KAMA', 1614: 'Scania',
  1633: 'YuTong', 1691: 'ChangAn', 1707: 'ZhongTong', 1715: 'MG', 1723: 'Hino',
  1771: 'Perodua', 1772: 'UD', 1775: 'Isuzu', 1840: 'Isuzu', 1853: 'Beijing',
  1877: 'MAN', 1911: 'PROTON',
};
function resolveHikBrand(raw) {
  if (!raw) return raw;
  const s = String(raw).trim();
  return /^[0-9]+$/.test(s) ? (HIK_BRAND_FIX[Number(s)] || s) : s;
}

function parseAnprXml(xmlStr) {
  const plate        = xmlText(xmlStr, 'licensePlate', 'plateNumber', 'licensePlateNumber');
  const confStr      = xmlText(xmlStr, 'confidenceLevel');
  const confidence   = confStr ? parseInt(confStr, 10) : 0;
  const country      = xmlText(xmlStr, 'country') || 'TH';
  const vehicleType  = xmlText(xmlStr, 'vehicleType');
  const vehicleColor = xmlText(xmlStr, 'color');
  const vehicleBrand = resolveHikBrand(xmlText(xmlStr, 'vehicleLogoRecog'));
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
  // Columnised at migration 108. These two were the last fields living only
  // inside rawXml, which enforceRawXmlRetention() strips after 90 days — the
  // values were on a clock nobody was watching. plateCharBelieve is per-
  // character OCR confidence ("92,92,92,..."), useful for judging whether a
  // misread was one bad glyph or a bad frame; licenseBright is 0-255 plate
  // brightness, which is how you tell an OCR failure caused by lighting.
  const plateCharBelieve = xmlText(xmlStr, 'plateCharBelieve') || null;
  const _brightRaw = parseInt(xmlText(xmlStr, 'licenseBright'), 10);
  const licenseBright = Number.isFinite(_brightRaw) ? Math.max(0, Math.min(32767, _brightRaw)) : null;
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

  // Vehicle-level bounding box from <vehicelRect> — yes, "vehicel" is how the
  // camera firmware actually spells the tag (verified live, C28-KAT-SB-15,
  // migration 117). Same 0-1000 normalized grid as PlateRect.
  let vehicleBbox = null;
  const vehicleRectMatch = xmlStr.match(/<vehicelRect>([\s\S]*?)<\/vehicelRect>/i);
  if (vehicleRectMatch) {
    const r = vehicleRectMatch[1];
    vehicleBbox = {
      x:      parseInt(xmlText(r, 'X', 'x') || '0', 10),
      y:      parseInt(xmlText(r, 'Y', 'y') || '0', 10),
      width:  parseInt(xmlText(r, 'width')  || '0', 10),
      height: parseInt(xmlText(r, 'height') || '0', 10),
    };
  }

  return { plate, confidence, country, vehicleType, vehicleColor, vehicleBrand,
           plateColor, plateType, region, dateTime, laneNo, direction,
           helmet, uphone, nonMotorManned, noSeatbelt, bbox, vehicleBbox,
           plateCharBelieve, licenseBright,
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
    const partNames = [];      // diagnostic only — see _diagCapture()
    const unknownParts = [];   // image parts classifyImage() has no home for
    for (const p of parts) {
      if (p.contentType.includes('xml')) {
        xmlStr = p.body.toString('utf8').replace(/\0/g, '').trim();
      } else if (p.contentType.includes('jpeg') || p.contentType.includes('image')) {
        const kind = classifyImage(p.filename);
        partNames.push(`${p.filename}=${kind}(${p.body.length}B)`);
        if (kind === 'unknown') unknownParts.push(p);
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
    _diagCapture(camId, xmlStr, partNames, unknownParts, images);

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
      touchCamera(pool, camId, { event: true });
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
    // crop ป้ายของเราแทนที่ cutout ของกล้อง (ดู sceneAndPlate) — ทำจากบัฟเฟอร์ 9MP
    // ที่ยังไม่ถูกย่อ จึงต้องเกิดที่นี่ ก่อนเขียน scene ลงดิสก์
    let ourPlate = null;
    try {
      if (images.scene) {
        let sceneBuf;
        try {
          const r = await sceneAndPlate(images.scene, pool, parsed.bbox);
          sceneBuf = r.sceneBuf;
          ourPlate = r.plateBuf;
          // เหตุผลที่ crop ไม่ได้ บอกครั้งเดียวต่อกล้อง — ไม่งั้นท่วม log ที่ 300 ครั้ง/นาที
          if (!ourPlate && r.reason && !_warnedNoCrop.has(camId)) {
            _warnedNoCrop.add(camId);
            console.warn(`[lpr] ${camId}: crop ป้ายเองไม่ได้ (${r.reason}) → ใช้ cutout ของกล้อง`);
          }
        } catch (e) {
          console.error(`[lpr] sceneAndPlate failed: ${e.message}`);
        }
        // never drop the image on resize failure — store the original
        const fn = lprImageName('scene', tsStamp);
        fs.writeFileSync(path.join(lprDir, fn), sceneBuf || images.scene);
        sceneFile = `${relBase}/${fn}`;
      }
      // แทนที่ ไม่ใช่เก็บคู่ — ชื่อไฟล์และ prefix คงเดิม (health.js นับดิสก์จาก prefix นี้)
      // ทุกหน้าอ่าน license_plates.plate_image เหมือนเดิมแล้วได้รูปใหม่ทันที
      const plateBuf = ourPlate || images.plate;
      if (plateBuf) {
        const fn = lprImageName('plate', tsStamp);
        fs.writeFileSync(path.join(lprDir, fn), plateBuf);
        plateFile = `${relBase}/${fn}`;
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
      // noSeatbelt was parsed above and then went nowhere on the edge path: the
      // central-direct INSERT below writes the column straight from `parsed`,
      // but EDGE_MODE only ships what is in this object, and this object never
      // carried it. So the column sat NULL for every plate that arrived through
      // an edge — which today is all of them (4,952,925 rows over 7 days,
      // no_seatbelt NULL on every one). Sent as a boolean, not a string, to
      // match what the column takes.
      noSeatbelt: parsed.noSeatbelt || false,
      // Mirrored out of rawXml so the value outlives the 90-day strip on the
      // raw_json side as well, not only in license_plates.
      plateCharBelieve: parsed.plateCharBelieve || null,
      licenseBright: parsed.licenseBright ?? null,
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
          plate_char_believe: parsed.plateCharBelieve || null,
          license_bright: parsed.licenseBright ?? null,
          no_seatbelt: parsed.noSeatbelt || false,
          bbox_x: parsed.bbox?.x ?? null, bbox_y: parsed.bbox?.y ?? null,
          bbox_width: parsed.bbox?.width ?? null, bbox_height: parsed.bbox?.height ?? null,
          vehicle_bbox_x: parsed.vehicleBbox?.x ?? null, vehicle_bbox_y: parsed.vehicleBbox?.y ?? null,
          vehicle_bbox_width: parsed.vehicleBbox?.width ?? null, vehicle_bbox_height: parsed.vehicleBbox?.height ?? null,
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
            bbox_x, bbox_y, bbox_width, bbox_height,
            vehicle_bbox_x, vehicle_bbox_y, vehicle_bbox_width, vehicle_bbox_height,
            plate_image, no_seatbelt,
            plate_color, no_helmet, plate_char_believe, license_bright,
            lane_no, pillion, detected_at, plate_identified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
                 ${helmet.stampSql('$28', '$29', '$30')})`,
        [
          eventId, camId,
          parsed.plate, parsed.confidence,
          parsed.country, parsed.region || null,
          parsed.vehicleType || null, parsed.vehicleColor || null, parsed.vehicleBrand || null,
          plateTypeFromColorName(parsed.plateColor),
          parsed.bbox?.x ?? null, parsed.bbox?.y ?? null,
          parsed.bbox?.width ?? null, parsed.bbox?.height ?? null,
          parsed.vehicleBbox?.x ?? null, parsed.vehicleBbox?.y ?? null,
          parsed.vehicleBbox?.width ?? null, parsed.vehicleBbox?.height ?? null,
          plateFile, parsed.noSeatbelt || false,
          // #085 perf — same values that feed raw_json (plateColor/helmet), so
          // column and raw_json stay in lockstep with the backfill.
          parsed.plateColor || null, parsed.helmet === 'no',
          parsed.plateCharBelieve || null, parsed.licenseBright ?? null,
          // migration 194 — ค่าเดียวกับที่ลง raw_json (laneNo/nonMotorManned)
          parsed.laneNo != null ? String(parsed.laneNo) : null,
          parsed.nonMotorManned || null,
          // Same timestamp the events row got — see the note in mqtt-subscriber.
          detectedAt,
          // $28-$30 — ค่าสำหรับตรึงผล "พร้อมข้อมูลทะเบียน" (ส่งซ้ำเป็นพารามิเตอร์
          // ของตัวเอง ห้ามชี้ไปที่ $2/$4 ของคอลัมน์ — ดูหมายเหตุที่ stampSql)
          helmet.plateMatches(parsed.plate), parsed.confidence, camId,
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
  TH_PROVINCE, VEHICLE_TYPE_TO_CLASS, isDuplicate, classifyImage, lprImageName, parseMultipart, xmlText,
  parseAnprXml, resolveLprCamera, ingestLprPush, resizeScene, getSceneCfg,
  sceneAndPlate, _bboxUsable, PLATE_CROP_PAD,
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

  // รถสองคันในเฟรมเดียวได้เวลาเท่ากันเป๊ะ — ชื่อไฟล์ต้องไม่ชนกัน ไม่งั้นภาพทับกัน
  const n1 = lprImageName('plate', 1786864515922);
  const n2 = lprImageName('plate', 1786864515922);
  assert.notStrictEqual(n1, n2, 'ชื่อไฟล์ของสองเหตุการณ์ที่เวลาเท่ากันต้องต่างกัน');
  assert.ok(n1.startsWith('lpr_plate_1786864515922_'), 'prefix + เวลา ต้องคงเดิม (health.js นับจาก prefix)');
  assert.ok(/^lpr_scene_\d+_[0-9a-f]{6}\.jpg$/.test(lprImageName('scene', 1)), 'รูปแบบชื่อไฟล์');

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
