// ============================================================
// Vigil Platform — Dahua CGI Protocol: pure parsing helpers
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Pure functions only — no I/O, no DB, no side effects.
// Importable by tests without triggering any runtime deps.
// ============================================================
'use strict';

const { dltProvince } = require('../helpers/dltProvince');
const { plateType } = require('../helpers/plateType');

const DAHUA_EVENT_MAP = {
  CrossLineDetection:   { event_type: 'LineDetector/Crossed',        rule_name: 'Line Crossing' },
  CrossRegionDetection: { event_type: 'FieldDetector/ObjectsInside', rule_name: 'Intrusion Detection' },
  SmartMotionHuman:     { event_type: 'SmartMotion/Human',           rule_name: 'Smart Motion (Human)' },
  SmartMotionVehicle:   { event_type: 'SmartMotion/Vehicle',         rule_name: 'Smart Motion (Vehicle)' },
  LeftDetection:        { event_type: 'UnattendedBaggage',           rule_name: 'Object Left' },
  TakenAwayDetection:   { event_type: 'ObjectRemoval',               rule_name: 'Object Removed' },
  VideoBlind:           { event_type: 'TamperDetection',             rule_name: 'Camera Tampering (Covered)' },
  // NVR onboard-AI codes (DHI-NVR5216-16P-I/L and similar) — added for multi-channel
  // NVR support (2026-07-15 plan). These arrive on the same eventManager stream as
  // the codes above; FaceDetection is opt-in per channel via capture_categories,
  // not globally excluded (see dahua-cgi.js SCOPE note).
  // event_type is 'anprAlarm' (not 'ANPR/Detected') so Dahua plate reads flow
  // through the SAME downstream as Hikvision LPR: the license_plates JOIN on
  // the LPR page, the watchlist-alert query (lpr-alerts.js gates on
  // event_type='anprAlarm'), and event-domains.js's LPR badge/plaque render.
  // The plate fields themselves are parsed by parseDahuaTrafficJunction() and
  // written to a license_plates row (2026-07-15 ANPR integration).
  TrafficJunction:      { event_type: 'anprAlarm',                rule_name: 'License Plate' },
  FaceDetection:        { event_type: 'FaceDetector/Detected',     rule_name: 'Face Detected' },
  FaceRecognition:      { event_type: 'FaceDetector/Recognized',   rule_name: 'Face Recognized' },
  FaceAttribute:        { event_type: 'FaceDetector/Attribute',    rule_name: 'Face Attribute' },
  FaceAnalysis:         { event_type: 'FaceDetector/Analysis',     rule_name: 'Face Analysis' },
  VehicleDetect:        { event_type: 'SmartMotion/Vehicle',       rule_name: 'Vehicle Detected' },
  NonMotorDetect:       { event_type: 'SmartMotion/Vehicle',       rule_name: 'Non-Motor Detected' },
  HumanTrait:           { event_type: 'SmartMotion/Human',         rule_name: 'Human Detected' },
  // Face blacklist/gallery match result (2026-07-15 Face system plan). Carries
  // Sim (similarity), CandPath, ChName — captured raw into raw_json, NOT
  // auto-classified match/no-match yet (no confirmed live sample of a real
  // match — owner's explicit call: capture first, verify before alerting).
  FaceComparision:      { event_type: 'FaceDetector/Comparison',   rule_name: 'Face Comparison' },
};

// Plate → Vehicle, HumanFace → Person: the NVR's onboard-AI codes report
// Object.ObjectType values the original DAHUA_CLASS didn't cover — Plate for
// TrafficJunction/ANPR, HumanFace for FaceRecognition/FaceDetection/etc.
// Both live-verified 2026-07-15 against a DHI-NVR5216-16P-I/L (the
// FaceRecognition ObjectType is literally "HumanFace", not "Human").
// Normalize both so object_class stays within the platform's existing
// vocabulary (Person/Vehicle/Bicycle/Animal) instead of leaking a raw value.
const DAHUA_CLASS = {
  Human: 'Person', Vehicle: 'Vehicle', NonMotor: 'Vehicle',
  Plate: 'Vehicle', HumanFace: 'Person',
};

// Friendly category → Dahua event codes, for the per-channel capture_categories
// allow-list (2026-07-15 multi-channel NVR plan). Used two ways:
//   1. Device subscription = union of codesForCategories() across all channels
//      of a device, so the NVR is only asked to stream what some channel wants.
//   2. Per-event post-filter (channelAllowsCode) — because the subscription is a
//      device-wide union, a channel can still receive codes it didn't ask for.
const DAHUA_CATEGORY_CODES = {
  face:     ['FaceRecognition', 'FaceDetection', 'FaceAttribute', 'FaceAnalysis', 'FaceComparision'],
  anpr:     ['TrafficJunction'],
  vehicle:  ['VehicleDetect', 'SmartMotionVehicle'],
  nonmotor: ['NonMotorDetect'],
  person:   ['HumanTrait', 'SmartMotionHuman'],
  rule:     ['CrossLineDetection', 'CrossRegionDetection', 'LeftDetection',
             'TakenAwayDetection', 'VideoBlind'],
};

// Parse a Dahua CGI eventManager text part.
// Returns null when there is no Code= field (e.g. plain "Heartbeat" body).
// Otherwise returns { code, action, index, mapping, data, dedupKey } for ALL Code=
// lines regardless of whether the code is mapped or the action is Start/Stop —
// the caller is responsible for last_seen_at, mapping guard, action filter, and dedup.
//
// `index` is the Dahua channel number (0-based) carried in the raw line
// (`Code=X;action=Start;index=N;data={...}`) — NOT present in the JSON `data`
// blob. On a single-channel camera it is always 0; on an NVR it is the only
// field that identifies which channel the event belongs to (live-verified
// 2026-07-15 against a DHI-NVR5216-16P-I/L — no `Channel` key in the JSON body).
function parseDahuaEventText(text) {
  const codeM = text.match(/Code=([^;]+)/);
  if (!codeM) return null;
  const code   = codeM[1].trim();
  const action = ((text.match(/action=([^;]+)/) || [])[1] || '').trim();
  const indexM = text.match(/index=([^;]+)/);
  const index  = indexM ? parseInt(indexM[1], 10) : null;
  const mapping = DAHUA_EVENT_MAP[code] || null;
  let data = {};
  const braceIdx = text.indexOf('{');
  if (braceIdx >= 0) {
    try { data = JSON.parse(text.slice(braceIdx)); } catch { /* malformed JSON → keep {} */ }
  }
  // Channel is included so an NVR's channels never collide in the dedup
  // window — e.g. two channels firing the same code+ObjectID within
  // DEDUP_WINDOW_MS would otherwise be treated as the same event.
  const dedupKey = code
    + '|' + (Number.isInteger(index) ? index : '')
    + '|' + (data?.Object?.ObjectID ?? '')
    + '|' + (data?.Direction ?? '');
  return { code, action, index, mapping, data, dedupKey };
}

// Returns the first mapped event code from a snapManager text chunk, or null.
function parseSnapManagerCode(text) {
  const direct = text.match(/(?:^|[;\r\n])Code=([^;\r\n]+)/);
  if (direct) {
    const code = direct[1].trim();
    return DAHUA_EVENT_MAP[code] ? code : null;
  }
  for (const m of text.matchAll(/Events\[\d+\]\.Code=([^\r\n]+)/g)) {
    const code = m[1].trim();
    if (DAHUA_EVENT_MAP[code]) return code;
  }
  return null;
}

// Sibling of parseSnapManagerCode — returns the 0-based NVR channel carried
// by a snapManager text chunk, or null when absent (single-channel cameras,
// or a firmware that doesn't tag it — caller falls back to the RTSP buffer,
// which is already channel-correct via media-recorder). Same two formats as
// parseSnapManagerCode: direct (`index=N`) and array (`Events[N].Index=`).
function parseSnapManagerIndex(text) {
  const direct = text.match(/(?:^|[;\r\n])index=([^;\r\n]+)/);
  if (direct) {
    const n = parseInt(direct[1], 10);
    return Number.isInteger(n) ? n : null;
  }
  const arr = text.match(/Events\[\d+\]\.Index=([^\r\n]+)/);
  if (arr) {
    const n = parseInt(arr[1], 10);
    return Number.isInteger(n) ? n : null;
  }
  // Third shape, on the NVR face channels (live text part, 2026-07-27): the
  // channel sits under EventBaseInfo, which neither branch above matches — so
  // face snapshots used to arrive tagged channel=null and any channel of the
  // device could claim them. On a 2-channel face NVR (ขาเข้า/ขาออก) that means
  // one person's crop landing on the other direction's event, which is worse
  // than no crop: it is a confident wrong answer.
  const base = text.match(/Events\[\d+\]\.EventBaseInfo\.Index=([^\r\n]+)/);
  if (base) {
    const n = parseInt(base[1], 10);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

// The cutout the camera already cropped, delivered inside the snapManager
// image part (appended after the scene JPEG). The text metadata gives its byte
// {offset,length} into that image body. Field shapes, live-verified:
// cars carry it under Object.Image (when Object.ObjectType=Plate, 2026-07-17),
// motorcycles under NonMotor.Plate.PlateImage, and FACES under the very same
// Object.Image with ObjectType=HumanFace (2026-07-27 — 7/7 sampled face events
// across HDY-NVR-03/04 had a complete JPEG at the advertised window, crops
// 128x144 to 240x264, 1.3-2.5KB against a 78-101KB scene part).
//
// NOTE the face crop rides the snapManager stream ONLY. The eventManager
// stream carries the same Object.Image numbers but never the bytes they point
// at — those offsets index the NVR's internal packed storage there, not the
// live body (confirmed 2026-07-15, see handlePart() in dahua-cgi.js). Reading
// this off the wrong stream is byte-math against a blob that was never sent.
// Returns {off,len} or null.
function parseObjectCutout(text) {
  if (/Object\.ObjectType=(?:Plate|HumanFace)/.test(text)) {
    const o = text.match(/Object\.Image\.Offset=(\d+)/);
    const l = text.match(/Object\.Image\.Length=(\d+)/);
    if (o && l) return { off: parseInt(o[1], 10), len: parseInt(l[1], 10) };
  }
  const po = text.match(/\.Plate\.PlateImage\.Offset=(\d+)/);
  const pl = text.match(/\.Plate\.PlateImage\.Length=(\d+)/);
  if (po && pl) return { off: parseInt(po[1], 10), len: parseInt(pl[1], 10) };
  return null;
}

function extractObjectClass(data) {
  const t = data?.Object?.ObjectType || data?.Objects?.[0]?.ObjectType || null;
  return t ? (DAHUA_CLASS[t] || t) : null;
}

// Extract face attributes from a FaceRecognition/FaceAnalysis payload, for
// mirroring into the `appearances` table the same way Hikvision Face Capture
// already does (2026-07-15 Face system plan). Mirrors the Hikvision
// convention: gender capitalized 'Male'/'Female', glasses boolean.
//
// IMPORTANT (live-verified 2026-07-15, one sample): the raw `Glass`/`Mask`
// fields are small integers whose enum meaning is NOT confirmed — the one
// sample seen had Glass:1 while Feature explicitly said "NoGlasses" for the
// same face. The `Feature` text array is self-documenting and preferred;
// numeric Glass/Mask are kept only in `raw` for later reference, not used
// to derive `glasses` here. Re-verify against more samples before trusting
// the numeric codes.
function extractFaceAttributes(data) {
  const face = data?.Object || data?.Face || {};
  const features = Array.isArray(face.Feature) ? face.Feature : [];
  const gender = face.Sex === 'Man' ? 'Male' : face.Sex === 'Woman' ? 'Female' : null;
  const hasNoGlasses = features.some(f => typeof f === 'string' && /^noglasses$/i.test(f));
  const hasGlasses   = features.some(f => typeof f === 'string' && /glasses/i.test(f) && !/^no/i.test(f));
  const glasses = hasGlasses ? true : hasNoGlasses ? false : null;
  const confidence = Number.isFinite(face.Confidence) ? face.Confidence / 100 : null;
  return {
    gender,
    glasses,
    age: Number.isFinite(face.Age) ? face.Age : null,
    confidence,
    raw: {
      sex: face.Sex ?? null, age: face.Age ?? null, glass: face.Glass ?? null,
      mask: face.Mask ?? null, emotion: face.Emotion ?? null, feature: features,
      // beard/hat (2026-07-15, "องค์ประกอบใบหน้า" plan) — raw integer only,
      // same caveat as glass/mask above: enum direction NOT verified against
      // a ground-truth photo (face-crop retrieval is blocked, see dahua-cgi.js
      // handlePart() comment) so these are NOT mapped to 'yes'/'no' strings
      // anywhere downstream yet. Collected for future verification only.
      beard: face.Beard ?? null, hat: face.Hat ?? null,
    },
  };
}

// FaceComparision blacklist match cutoff (2026-07-15 Face-page integration
// pass) — mirrors the NVR's own "High Risk Person" group Similarity config
// (VideoAnalyseRule, live-verified 2026-07-15: Similarity=70), not an
// invented threshold. Every live FaceComparision sample seen so far is
// Sim:0 (no match) — this reproduces the NVR's own decision, it doesn't
// invent a new one, but the real-match code path is unverified until a
// live Sim>=70 sample is observed.
const FACE_BLACKLIST_SIM_THRESHOLD = 70;

// Derive the Hikvision-convention `listType` ('blackList' | null) from a
// Dahua FaceComparision event's raw `Sim` field (0-100 scale). Returns null
// for any non-finite input (missing/malformed Sim) rather than throwing —
// mirrors codesForCategories()'s "degrade gracefully on bad input" stance.
function faceComparisonListType(sim, threshold = FACE_BLACKLIST_SIM_THRESHOLD) {
  const n = Number(sim);
  return Number.isFinite(n) && n >= threshold ? 'blackList' : null;
}

// Connection-grouping key for multi-channel NVR support — channels that share
// this key are served by ONE eventManager + ONE snapManager stream instead of
// one pair per configured channel (the naive per-row approach would open
// N-channel × 2 concurrent CGI sessions against a single physical device).
// An explicit `device_id` is preferred (disambiguates NVRs that could share an
// ip:port:user tuple behind NAT); otherwise it's derived from the connection
// identity, which is a safe default for the common case.
function deviceKey(cam) {
  if (cam?.device_id) return String(cam.device_id);
  const ip   = cam?.ip_address || '';
  const port = cam?.http_port || cam?.port || 80;
  const user = cam?.username || '';
  return `${ip}:${port}:${user}`;
}

// Friendly categories → the Dahua codes they cover. Unknown category names are
// ignored (not thrown) so a typo in config degrades to "no codes from that
// category" rather than crashing the ingester.
function codesForCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return Object.keys(DAHUA_EVENT_MAP);
  }
  const set = new Set();
  for (const cat of categories) {
    for (const code of (DAHUA_CATEGORY_CODES[cat] || [])) set.add(code);
  }
  return [...set];
}

// Per-channel allow-list check, applied AFTER the device-wide subscription
// (which is a union across all of a device's channels — see
// DAHUA_CATEGORY_CODES doc comment above). null/empty categories = capture
// everything mapped, matching codesForCategories()'s "no filter" behavior.
function channelAllowsCode(captureCategories, code) {
  if (!Array.isArray(captureCategories) || captureCategories.length === 0) return true;
  return codesForCategories(captureCategories).includes(code);
}

// ============================================================
// ANPR / TrafficJunction plate parsing (2026-07-15 ANPR integration).
// Maps a Dahua ITC TrafficJunction event's `data` blob to the SAME
// normalized shape Hikvision's parseAnprXml (lpr-core.js) produces, so the
// downstream (license_plates row + LPR page + watchlist) is vendor-agnostic.
// Field names ground-truthed from a real live event (Porsche, plate ศษ4091,
// 2026-07-15) — see the per-field UNVERIFIED flags below; unconfirmed fields
// degrade to null rather than guess.
// ============================================================

// Dahua Vehicle.Category → Hikvision's vehicle_type vocabulary (the strings
// license_plates.vehicle_type already holds for Hikvision, and the exact
// values the LPR search filter's dropdown offers — lpr-query.js matches
// `vehicle_type = ANY(selected)`, so a Dahua row is only findable in search
// if it stores one of THESE strings, not the raw Dahua category). Storing the
// Hikvision vocab also lets object_class derive through the existing
// VEHICLE_TYPE_TO_CLASS map (lpr-core.js) — one shared path for both vendors.
// Only categories observed live are mapped; unknown → null (raw category kept
// in raw_json.data for later; don't invent mappings for unseen types).
const DAHUA_CATEGORY_TO_HIK_VTYPE = {
  SaloonCar:  'vehicle',      // sedan → generic car (Hik 'vehicle' → class Vehicle) — live-verified
  Pickup:     'pickupTruck',  // → class Pickup — live-verified (ChuanQi, 2026-07-16)
  SUV:        'SUVMPV',       // → class Car — live-verified (2026-07-16, backfill sample)
  LargeTruck: 'truck',        // → class Truck — live-verified (2026-07-16, backfill sample)
  Motorcycle: 'twoWheelVehicle', // → class Motorcycle — live-verified (hdy-motor-lotus1 @172.17.22.181, 2026-07-16)
  Unknown:    null,           // Dahua couldn't classify → leave vehicle_type null (honest)
  // 2026-07-18 — remaining 12 categories, image-reviewed with the owner
  // (sample crops sent + inspected per category) rather than live-verified
  // against a labelled ground truth. SUVMPV/truck/vehicle are taxonomy-forced
  // (no finer bucket exists); van/twoWheelVehicle/threeWheelVehicle are the
  // owner's own reading of the sample images.
  Microbus:       'van',             // รถตู้
  MidPassengerCar:'van',             // รถตู้
  MPV:            'SUVMPV',          // รถอเนกประสงค์ — bucket name is literally MPV's match
  MicroTruck:     'truck',           // Pickup is its own separate category — this is a small truck, not a pickup
  MidTruck:       'truck',
  // 🔴 แก้ 2026-08-31 — เดิม map เป็น 'vehicle' พร้อมคอมเมนต์ว่า "generic car,
  // same bucket as SaloonCar" ซึ่งผิด · ชื่อ PassengerCar เป็นเพื่อนปลอม: รถเก๋ง
  // จริง ๆ คือ SaloonCar ซึ่งมีช่องของตัวเองอยู่แล้ว ส่วนชุดนี้เป็นบันไดขนาดของ
  // "รถโดยสาร" — Microbus → MidPassengerCar → PassengerCar
  //
  // หลักฐานตรง: กล้อง Dahua เผาคลาสลงบนภาพเองผ่าน OSD และในตัวอย่างที่ตรวจ
  // OSD เขียนว่า "Vehicle Type:Large Bus" ขณะที่ field ในpayload ส่ง PassengerCar
  // มา · ตรวจภาพ 10 คันสุ่มจาก hdy กับเจ้าของ (วิธีเดียวกับรอบ 2026-07-18):
  // 8 ใน 10 เป็นรถบัส/รถทัวร์ (Nong Peens, Kan Eng, รถร่วม บขส., Scania)
  // ยี่ห้อที่ผลิตรถบัสอย่างเดียว (YuTong/JingLong/Sunlong) พบใน PassengerCar
  // 4.6% เทียบกับ SaloonCar 0.006% — หนาแน่นกว่าราว 700 เท่า
  //
  // ⚠️ ไม่ใช่ 100%: 2 ใน 10 ตัวอย่างเป็นรถกระบะ ซึ่งกล้องเองก็เขียน "Large Bus"
  //    ให้เหมือนกัน · ถังนี้จึงถูกกว่าเดิมมาก แต่ไม่สมบูรณ์
  //
  // ผลกระทบก่อนแก้: largeBus มีเฉพาะที่ hkt (Hikvision) · ไซต์ Dahua ทั้งสาม
  // รายงานศูนย์ ค้นรถบัสที่หาดใหญ่จึงไม่เจอเลยทั้งที่มีวิ่งอยู่ตลอด และเพราะผลลัพธ์
  // เป็นเซตว่างพิสูจน์ได้ query จึงกวาดทั้งประวัติจนหน้าค้าง — อาการช้ากับข้อมูลผิด
  // เป็นบั๊กตัวเดียวกัน
  PassengerCar:   'largeBus',        // รถบัส/รถทัวร์ (ดูเหตุผลด้านบน)
  Bicycle:        'twoWheelVehicle', // no dedicated bicycle bucket; a plated "Bicycle" read is almost
                                      // certainly a misclassified e-bike/motorcycle anyway
  Electricbike:   'twoWheelVehicle',
  Tricycle:              'threeWheelVehicle',
  VanTricycle:            'threeWheelVehicle',
  MannedConvertibleTricycle:   'threeWheelVehicle',
  NoMannedConvertibleTricycle: 'threeWheelVehicle',
};

// Dahua's on-camera logo OCR mangles some brand names — correct the ones seen
// live (2026-07-16). Keys are the exact camera output, values the real brand.
// Only fix confirmed observations; unrecognised brands pass through unchanged.
//
// 2026-07-23 — numbered-suffix duplicates (CarLogoIndex confirms these are
// separate trained logo classes in the camera's recognition model — e.g.
// Toyota=idx5 vs Toyota2=idx416 — but the same real-world manufacturer, just
// a different logo variant/angle the firmware never renamed back to the
// base brand). Verified against production distinct-brand counts before
// merging (Toyota 222,420 + Toyota2 13,553 etc.) — categories A (clean
// base+suffix pair) and B (3+ variants, ChangAn/1/2) below. Category C
// entries (Dodge2, Dacia2/3, Vauxhall2/3, Hyundai3, Smart2) had no base-name
// row in the current data window but are the same pattern — mapped on the
// same confidence. NOT merged: Mazda2 (real model name, not a logo variant),
// RANGEROVER2/ESQ2 (ambiguous vs LandRover/Infiniti), Alphard2/Crown/Harrier/
// Estima/DISCOVERY2 (model names in the brand field, different bug entirely).
const DAHUA_BRAND_FIX = {
  Lsuzu: 'Isuzu',   // live-verified — the camera reads the Isuzu logo as "Lsuzu"
  Hino2: 'Hino',    // OCR quirk of the Hino truck logo (2026-07-16)
  Toyota2: 'Toyota', Ford2: 'Ford', Nissan2: 'Nissan', Volvo2: 'Volvo',
  Porsche2: 'Porsche', Suzuki2: 'Suzuki', Kia2: 'Kia', Chery2: 'Chery',
  JAC2: 'JAC', Jaguar2: 'Jaguar', TataMotors2: 'TataMotors', Lincoln2: 'Lincoln',
  Hafu1: 'Hafu', ChangAn1: 'ChangAn', ChangAn2: 'ChangAn',
  Dodge2: 'Dodge', Dacia2: 'Dacia', Dacia3: 'Dacia',
  Vauxhall2: 'Vauxhall', Vauxhall3: 'Vauxhall', Hyundai3: 'Hyundai', Smart2: 'Smart',
  FIAT: 'Fiat', // same brand, camera sends both cases depending on logo variant
};
// Brand values that mean "couldn't recognise" — store null, not the literal,
// so they drop out of the brand breakdown (the LPR chart filters NULL/'' but
// not 'Unknown'). Matches the vehicle_type Unknown→null decision.
const DAHUA_BRAND_UNKNOWN = new Set(['Unknown', 'unknown']);

// Dahua face Emotion → the platform's (Hikvision) emotion vocabulary, so the
// Face page's อารมณ์ chart shows the shared Thai labels (faceExpr.* i18n) and
// colours (EXPR_COLORS) instead of raw English. All 6 values live-verified
// from hdy-nvr1 (2026-07-16); unmapped values fall back to lowercase so a new
// emotion is at least vocab-consistent rather than a stray capitalised token.
const DAHUA_EMOTION_MAP = {
  Neutral: 'neutral', Happy: 'happy', Confused: 'confused',
  Disgust: 'disgusted', Surprise: 'surprised', Sadness: 'sad',
};
function normalizeDahuaEmotion(e) {
  if (!e || typeof e !== 'string') return null;
  return DAHUA_EMOTION_MAP[e] || e.toLowerCase();
}

// Dahua colors arrive as an RGBA int array ([r,g,b,a]); reuse the platform's
// existing sRGB→name palette (color-utils.xyzToColorName, which takes an
// "r,g,b" string). Kept as a tiny local reimplementation-free adapter — the
// actual mapping lives in color-utils; dahua-cgi.js passes xyzToColorName in
// to avoid this pure module taking an I/O-free dependency it doesn't need.
function dahuaRgbaToName(rgba, xyzToColorName) {
  if (!Array.isArray(rgba) || rgba.length < 3 || typeof xyzToColorName !== 'function') return null;
  const [r, g, b] = rgba;
  if (![r, g, b].every(Number.isFinite)) return null;
  const name = xyzToColorName(`${Math.round(r)},${Math.round(g)},${Math.round(b)}`);
  return name ? name.toLowerCase() : null;
}

// Parse TrafficJunction `data` → normalized LPR record. `xyzToColorName` is
// injected (see dahuaRgbaToName). Returns null when there is no plate text at
// all (nothing worth a license_plates row).
function parseDahuaTrafficJunction(data, xyzToColorName) {
  const obj = data?.Object || {};
  const veh = data?.Vehicle || {};
  const comm = data?.CommInfo || {};

  const plate = (typeof obj.Text === 'string' ? obj.Text.trim() : '') || null;
  if (!plate) return null;

  // Confidence: Dahua reports 0-255 (live sample: 222). UNVERIFIED scale —
  // normalize to the 0-100 the license_plates.confidence column expects
  // (Hikvision writes 0-100). Raw value stays in raw_json.data for audit.
  const rawConf = obj.Confidence;
  const confidence = Number.isFinite(rawConf) ? Math.round((rawConf / 255) * 100) : null;

  // Province: CommInfo.Province may be a full Thai name ("กรุงเทพมหานคร") OR a DLT
  // code ("SKA") depending on camera model — so run it through dltProvince first
  // (a full name maps to null → we keep it raw). Fall back to Object.Province's
  // code, then the raw code (unknown) rather than a wrong name. country → 'TH'.
  const region = dltProvince(comm.Province) || comm.Province
    || dltProvince(obj.Province) || obj.Province || null;
  const country = (comm.Country && comm.Country !== 'Unknown') ? comm.Country
    : (obj.Country && obj.Country !== 'Unknown') ? obj.Country : 'TH';

  // Vehicle type → Hikvision vocab (see DAHUA_CATEGORY_TO_HIK_VTYPE note) so
  // the row is searchable via the shared LPR filter. rawCategory keeps the
  // original Dahua string for reference/debugging. object_class is derived
  // downstream (dahua-cgi.js) from vehicleType via VEHICLE_TYPE_TO_CLASS —
  // not here, to keep this pure module free of the lpr-core dependency.
  const rawCategory = veh.Category || null;
  const vehicleType = DAHUA_CATEGORY_TO_HIK_VTYPE[veh.Category] || null;
  const rawBrand = (typeof veh.Text === 'string' && veh.Text.trim()) || null;
  const vehicleBrand = (!rawBrand || DAHUA_BRAND_UNKNOWN.has(rawBrand))
    ? null
    : (DAHUA_BRAND_FIX[rawBrand] || rawBrand);

  // Speed (km/h) — TrafficCar.Speed is always null, unused. No Hikvision
  // analog exists (its ANPR XML only has speedLimit, the camera-configured
  // ceiling, not a measured value) — this is a Dahua-only capability.
  //
  // 255 is a sentinel/error value, NOT a real reading (live-verified: byte
  // overflow, same pattern as Confidence's 0-255 scale). Object.Speed is the
  // reliable field — Vehicle.Speed hits 255 in ~3% of events (77/2,528),
  // Object.Speed only ever hits 255 in lockstep with Vehicle.Speed (never
  // alone). Prefer Object.Speed; fall back to Vehicle.Speed only when
  // Object.Speed itself is invalid.
  const isValidSpeed = (v) => Number.isFinite(v) && v !== 255;
  const speed = isValidSpeed(obj.Speed) ? obj.Speed
    : isValidSpeed(veh.Speed) ? veh.Speed
    : null;

  // Colors: RGBA → nearest palette name (UNVERIFIED accuracy — cosmetic, not
  // a gate; refine once multi-sample photos confirm).
  const vehicleColor = dahuaRgbaToName(veh.MainColor, xyzToColorName);
  const plateColor = dahuaRgbaToName(obj.MainColor, xyzToColorName);
  // Thai registration category from the plate colour (obj is the Plate object).
  const plateReg = plateType(obj.MainColor);

  // Direction: Head = toward camera, Tail = away → in/out tokens.
  // 🔴 ยืนยัน 2026-09-01 (ITC431-RW1F-IRL8, fw 5.000.0000000.1.R build:2025-03-12
  // @rmutr-v — ดัก eventManager.cgi ตรงจากกล้อง 16 event/98KB): ตระกูล ITC
  // **ไม่ส่งคีย์ VehicleDirection เลย** (grep ทั้ง payload = 0 hit) → direction
  // เป็น null 100% บนกล้องพวกนี้ ตรงกับข้อมูลเก็บจริง (DAHUA-ANPR-CAM01: null
  // 6,290/6,290 แถวใน 24 ชม.) · คีย์อื่นแทนก็ไม่ได้: data.Direction = ทิศเลี้ยว
  // ที่แยก ไม่ใช่เข้า-ออก · directionRun = เลขเลน (จับคู่ Lane เป๊ะ 16/16) ·
  // และภาพเป็น snapshot จุดเดียว (Speed:0, Center เดียว) derive เองไม่ได้
  // การนับเข้า-ออกบน Dahua จึงต้องใช้ cameras.lpr_direction ที่ตั้งมือ (RF5)
  // หรือกล้อง Bosch ที่มี track จริงเท่านั้น — ดู GOTCHAS #186
  // บรรทัดนี้คงไว้เผื่อรุ่น non-ITC ที่อาจส่งจริง แต่ห้ามสร้างฟีเจอร์บนมัน
  const rawDir = veh.VehicleDirection;
  const direction = rawDir === 'Head' ? 'in' : rawDir === 'Tail' ? 'out' : null;

  const laneNo = Number.isFinite(data?.Lane) ? data.Lane : null;

  // Seatbelt: only assert no_seatbelt when explicitly 'no'. Every live sample
  // so far is 'unknow' (mounting angle can't see the driver) → false.
  const noSeatbelt = obj?.MainSeat?.SafeBelt === 'no';

  // BBox: OriginalBoundingBox is pixel-space [x1,y1,x2,y2] on the scene JPEG
  // (BoundingBox is the NVR-internal grid, discarded). Used to sharp-crop the
  // plate out of the scene (dahua-cgi.js) since the event carries no crop path.
  let bbox = null;
  const ob = obj.OriginalBoundingBox;
  if (Array.isArray(ob) && ob.length >= 4 && ob.every(Number.isFinite)) {
    bbox = { x: Math.round(ob[0]), y: Math.round(ob[1]),
             width: Math.round(ob[2] - ob[0]), height: Math.round(ob[3] - ob[1]) };
  }

  // Vehicle box (migration 117) — unlike the plate bbox above, this one uses
  // Vehicle.BoundingBox (the "NVR-internal grid" the plate bbox comment says
  // is discarded), on purpose: DetectRegion on every live sample spans the
  // fixed corners [[0,0],[8191,0],[8191,8191],[0,8191]] regardless of actual
  // scene resolution, i.e. it's already a resolution-independent 0-8191
  // square — normalize /8192 → the same 0-1000 grid license_plates.bbox_x
  // stores for Hikvision's <PlateRect>, so the frontend/backend overlay code
  // (which only knows that one wire format) needs no vendor branch.
  // OriginalBoundingBox isn't used here because Vehicle's copy of it wasn't
  // verified live the way Object's (the plate's) was.
  let vehicleBbox = null;
  const vb = veh.BoundingBox;
  if (Array.isArray(vb) && vb.length >= 4 && vb.every(Number.isFinite)) {
    vehicleBbox = {
      x:      Math.round((vb[0] / 8192) * 1000),
      y:      Math.round((vb[1] / 8192) * 1000),
      width:  Math.round(((vb[2] - vb[0]) / 8192) * 1000),
      height: Math.round(((vb[3] - vb[1]) / 8192) * 1000),
    };
  }

  // Helmet + pillion count — NonMotor-only classification carried alongside
  // ANPR data on Dahua ITC431 (live-verified 2026-07-21 against camera OSD
  // burn-in; absent on ITC237 and on car/Pickup events — both read as null,
  // never asserted false from silence, same care as noSeatbelt above).
  // Output contract mirrors Hikvision's helmet/nonMotorManned strings
  // (lpr-core.js) so the existing no_helmet column + raw_json badge/filter
  // work unchanged for Dahua. RiderList[0] is the only entry with a Helmet
  // field even when NumOfCycling>=2 — additional riders aren't classified.
  const nonMotor = data?.NonMotor;
  const primaryRider = nonMotor?.RiderList?.[0];
  const helmet = primaryRider?.Helmet === 1 ? 'no' : primaryRider?.Helmet === 2 ? 'yes' : null;
  const riderCount = Number.isFinite(nonMotor?.NumOfCycling) ? nonMotor.NumOfCycling : null;
  const nonMotorManned = riderCount == null ? null : (riderCount >= 2 ? 'yes' : 'no');

  return {
    plate, confidence, country, region,
    vehicleType, rawCategory, vehicleBrand, vehicleColor, plateColor, plateType: plateReg,
    direction, laneNo, noSeatbelt, bbox, vehicleBbox, speed,
    helmet, nonMotorManned, riderCount,
  };
}

// ---------- storage pruning ----------
// The Dahua event payload is stored whole in raw_json.data, and that payload is
// 90.4% of every byte in the events table (measured 2026-07-31 across the July
// partition: 5.4M anprAlarm rows, ~90% of them Dahua).
//
// These four keys are dead weight. Not "probably unused" — grepped across all
// of src/ and dashboard/, the only mention of any of them is a comment in this
// file saying TrafficCar.Speed is always null. Nothing reads them at ingest, in
// the snapshot second pass, in the frame scorer, or in the browser.
//
//   TrafficCar             ~945 B  the biggest single key in the payload
//   YuvPacket              ~382 B  image-packet metadata for a frame we already saved
//   Object.SlaveSeat               passenger seatbelt/phone/smoking, always "unknow"
//   Object.ValidAnalyseAttributes  an attribute bitmask
//
// Dropping them shrinks stored Dahua ANPR rows by 20.3% on disk, which is 18.4%
// of the events heap and ~16.5% of the whole partition once indexes are counted.
// Measured by materialising both variants into real tables — computing the
// stripped value inline and calling pg_column_size on it reports the
// UNCOMPRESSED size and makes stripping look like it grows the row.
//
// Forward-only, and reversible by deleting this function's call site: rows
// already written keep their keys. What is deliberately NOT dropped, despite
// looking similar: DetectRegion (page-snapshots.js draws it) and NonMotor
// (read here, line ~475).
const DAHUA_DROP_KEYS = ['TrafficCar', 'YuvPacket'];
const DAHUA_DROP_OBJECT_KEYS = ['SlaveSeat', 'ValidAnalyseAttributes'];

function pruneDahuaData(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const k of DAHUA_DROP_KEYS) delete out[k];
  if (out.Object && typeof out.Object === 'object') {
    out.Object = { ...out.Object };
    for (const k of DAHUA_DROP_OBJECT_KEYS) delete out.Object[k];
  }
  return out;
}

module.exports = {
  pruneDahuaData,
  DAHUA_EVENT_MAP, DAHUA_CLASS, DAHUA_CATEGORY_CODES, FACE_BLACKLIST_SIM_THRESHOLD,
  DAHUA_CATEGORY_TO_HIK_VTYPE, DAHUA_BRAND_FIX, DAHUA_BRAND_UNKNOWN,
  parseDahuaEventText, parseSnapManagerCode, parseSnapManagerIndex, parseObjectCutout, extractObjectClass,
  deviceKey, codesForCategories, channelAllowsCode, extractFaceAttributes, faceComparisonListType,
  parseDahuaTrafficJunction, dahuaRgbaToName, normalizeDahuaEmotion,
};
