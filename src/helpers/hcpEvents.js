// ============================================================
// Vigil Platform — HC5 · เหตุการณ์ของ HCP (ยกเว้น LPR / ใบหน้า)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เหตุการณ์ที่ HCP ตรวจได้แต่กล้องไม่ได้ส่งมาที่เรา · รันบน edge เท่านั้น
//
// สิ่งที่ `eventRecords/page` บังคับ (วัดจริง — ขาดอันไหนได้ `code 2` ทันที):
//   `eventTypes` (สตริง คั่นด้วย ,) · `srcType` · `srcIndexs` (กล้อง, **≤1024 ตัวอักษร**)
// ⇒ ต้องแบ่งก้อนกล้องเสมอ · 756 กล้องของภูเก็ต = 4 ก้อน
//
// LPR (130/131) และใบหน้า (49697) ถูกตัดออกโดยตั้งใจ — สองอย่างนั้นเรามีทางเดินของ
// ตัวเองอยู่แล้ว (lpr-receiver / HC1) การดึงซ้ำที่นี่จะกลายเป็นข้อมูลสองชุดที่ไม่ตรงกัน
// ============================================================
'use strict';

const { hcpCall, hcpPageAll } = require('./hcpPage');
const { hcpTime } = require('./hcpTime');

const EXCLUDED_TYPES = ['130', '131', '49697'];   // รถ · รถ · ใบหน้า
const SRC_BATCH_CHARS = 1000;                     // เพดานจริง 1024 — เผื่อขอบไว้
// ค่าปริยาย = รหัสที่ HCP ของภูเก็ต "รับจริง" 137 ตัว (ไล่ถามทีละรหัส 604 คำขอ เมื่อ 2026-10-08)
// ⚠️ เดิมกวาด 1-300 แล้วได้ศูนย์เสมอ: HCP ใช้รหัสเลขใหญ่ (131xxx/196xxx/197xxx) และตอบ
// `code 2` เฉพาะเมื่อ **ไม่มีรหัสไหนในรายการใช้ได้เลย** — มีใช้ได้สักตัว (193-195/641-665)
// มันรับทั้งรายการเงียบ ๆ แล้วคืนว่าง จึงไม่มี error ให้เห็นเลยตั้งแต่สร้างหน้านี้
// HCP ไม่ส่งชื่อชนิดมาให้ · ถ้ารุ่น HCP เปลี่ยน รหัสที่ไม่รู้จักจะถูกข้ามเงียบ ๆ ⇒ ไล่ถามใหม่
// แล้วอัปเดตรายการนี้ (หรือส่ง `types` มาเอง)
const TYPE_NAMES = {   // รหัส → ชื่อตามคู่มือ HCP OpenAPI V3.0.1 ภาคผนวก A.4 (null = HCP รับแต่คู่มือไม่มี)
  '193': 'Temperature Exception',
  '194': 'No Mask',
  '195': 'Generic Event',
  '641': 'On-Board Devices Online',
  '642': 'On-Board Devices Offline',
  '643': 'GPS Data Report',
  '644': 'Forward Collision Warning',
  '645': 'Headway Monitoring Warning',
  '646': 'Lane Deviation Warning',
  '647': 'Pedestrian Collision Warning',
  '648': 'Speed Limit Warning',
  '649': 'Blind Spot Warning',
  '650': 'Smoking',
  '651': 'Using Mobile Phone',
  '652': 'Fatigue Driving',
  '653': 'Distraction',
  '654': 'Seatbelt Unbuckled',
  '655': 'Video Tampering',
  '656': 'Emergency Alarm',
  '657': 'Sharp Turn',
  '658': 'Sudden Brake',
  '659': 'Sudden Acceleration',
  '660': 'Rollover',
  '661': 'Speeding',
  '662': 'Collision',
  '663': 'Fence for Entry Detection',
  '664': 'Deviation',
  '665': 'Fence for Exit Detection',
  '131329': 'Video Loss',
  '131330': 'Video Tampering Detection',
  '131331': 'Motion Detection',
  '131585': 'Line Crossing',
  '131586': 'Region Entrance',
  '131587': 'Region Exiting',
  '131588': 'Intrusion',
  '131590': 'Loitering',
  '131591': 'Parking',
  '131592': 'Fast Moving',
  '131593': 'People Gathering Alarm',
  '131594': 'Unattended Baggage',
  '131595': 'Object Removal',
  '131596': 'Violent Motion Detection',
  '131597': 'Climbing Detection',
  '131598': 'Getting Up Detection',
  '131600': 'Operation Timeout',
  '131601': 'Sticking Script',
  '131602': 'Install Card Reader',
  '131603': 'Absence Detection',
  '131604': 'Tailing',
  '131605': 'Falling Down',
  '131608': 'In-Toilet Overtime Detection',
  '131609': 'Yard Overstay Detection',
  '131610': 'Key Person Getting Up Detection',
  '131612': 'Scene Change Detection',
  '131613': 'Defocus Detection',
  '131622': 'License Plate Information Uploading',
  '131623': 'Audio Exception Detection',
  '131659': 'Face Picture Comparison Event',
  '131664': 'Abnormal Number of People',
  '131666': 'Standing Up Detection',
  '131667': 'Sitting Detection',
  '131669': 'Staying Overtime',
  '131672': 'People Density Analysis',
  '131673': 'Using Mobile Phone',
  '131677': 'Physical Conflict',
  '131678': 'Physical Conflict (Indoor)',
  '131679': 'Wrong-Way Driving',
  '131682': 'Police Absence',
  '131702': 'People Density',
  '131704': 'Abnormal Face',
  '131717': 'Sleep on Duty Detection',
  '131841': 'Vehicle Speeding',
  '196883': 'Multi-​Factor Authentication: Access',
  '196884': 'Multi-​Factor Authentication: Super',
  '196885': 'Access Granted by Card and Fingerprint',
  '196886': 'Access Granted by Card, Fingerprint, and',
  '196887': 'Access Granted by Fingerprint and PIN',
  '196888': 'Access Granted by Face and Fingerprint',
  '196889': 'Access Granted by Face and PIN',
  '196890': 'Access Granted by Face and Card',
  '196891': 'Access Granted by Face, PIN, and',
  '196892': 'Access Granted by Face, Card, and',
  '196893': 'Access Granted by Face',
  '196894': 'Access Granted by Employee ID and',
  '196895': 'Access Granted by Employee ID,',
  '196896': 'Access Granted by Employee ID and Face',
  '196897': 'Access Granted by Employee ID and PIN',
  '196898': 'Access Denied by Invalid M1 Card',
  '196899': 'Verifying CPU Card Encryption Failed',
  '196900': 'Access Denied (NFC Card Reading',
  '196901': 'EM Card Reading Not Enabled',
  '196902': 'M1 Card Reading Not Enabled',
  '196903': 'CPU Card Reading Disabled',
  '197107': 'Skin-Surface Temperature Measured',
  '197127': 'Access Granted by Fingerprint',
  '197128': 'Access Denied by Fingerprint',
  '197132': 'Access Timed Out by Card and PIN',
  '197133': 'Max. Card and Password Authentication',
  '197134': 'Access Denied by Card and Fingerprint',
  '197135': null,
  '197136': 'Access Denied by Card, Fingerprint, and',
  '197137': 'Access Timed Out by Card, Fingerprint,',
  '197138': 'Access Denied by Fingerprint and PIN',
  '197139': 'Access Timed Out by Fingerprint and PIN',
  '197140': 'Fingerprint Does Not Exist',
  '197141': 'Access Denied by Face and Fingerprint',
  '197142': null,
  '197143': 'Access Denied by Face and PIN',
  '197144': 'Access Timed Out by Face and PIN',
  '197145': 'Access Denied by Face and Card',
  '197146': 'Access Timed Out by Face and Card',
  '197147': 'Access Denied by Face, PIN, and',
  '197148': 'Access Timed Out by Face, PIN, and',
  '197149': 'Access Denied by Face, Card, and',
  '197150': 'Access Timed Out by Face, Card, and',
  '197151': 'Access Denied by Face',
  '197152': 'Access Denied by Employee ID and',
  '197153': 'Access Timed Out by Employee ID and',
  '197154': 'Access Denied by Employee ID,',
  '197155': 'Access Timed Out by Employee ID,',
  '197156': 'Access Denied by Employee ID and Face',
  '197157': 'Access Timed Out by Employee ID and',
  '197158': 'Access Denied by Employee ID and PIN',
  '197159': null,
  '197160': 'Facial Recognition Failed',
  '197161': 'Live Facial Detection Failed',
  '197382': 'Access Denied by Card and PIN',
  '197383': 'Anti-​Passback Violation',
  '197384': 'Invalid Time Period',
  '197391': 'Card Not in Multi-​Factor Authentication',
  '197392': 'Card Not in Multi-​Factor Authentication',
  '199708': 'Device Tampered',
  '199709': 'Device Tampering Alarm Restored',
  '199941': 'Door Unlocked (Door Lock)',
  '199942': 'Door Locked (Door Lock)',
  '589825': 'Alarm Input Triggered',
  '721678': 'Duress Alarm',
};
const DEFAULT_TYPES = Object.keys(TYPE_NAMES).filter((t) => !EXCLUDED_TYPES.includes(t));
const PAGE = 500;
const MAX_PAGES = 6;   // ต่อก้อนกล้อง = 3,000 แถว · กล้องตัวเดียวเคยมี 1,216 รายการใน 30 วัน

function batchCameras(indexCodes) {
  const out = [];
  let cur = [];
  for (const c of indexCodes) {
    if (cur.length && cur.join(',').length + String(c).length + 1 > SRC_BATCH_CHARS) {
      out.push(cur.join(',')); cur = [];
    }
    cur.push(String(c));
  }
  if (cur.length) out.push(cur.join(','));
  return out;
}

async function fetchHcpEvents({ since, until, types, limit = 500 } = {}) {
  const start = since ? new Date(since) : new Date(Date.now() - 7 * 86400000);
  const end = until ? new Date(until) : new Date();
  const typeList = (Array.isArray(types) && types.length ? types.map(String) : DEFAULT_TYPES)
    .filter((t) => !EXCLUDED_TYPES.includes(t));

  // รายชื่อกล้องมาจาก HCP เอง ไม่ใช่แมปของเรา — จุดประสงค์ของหน้านี้คือเห็นของที่
  // เรามองไม่เห็น ถ้าจำกัดแค่กล้องที่เราแมปไว้ก็จะเห็นแต่ของที่เห็นอยู่แล้ว
  const cams = [];
  const nameOf = {};
  await hcpPageAll('/artemis/api/resource/v1/cameras', {}, (c) => {
    cams.push(String(c.cameraIndexCode));
    nameOf[String(c.cameraIndexCode)] = c.cameraName || null;
  });
  const batches = batchCameras(cams);

  const rows = [];
  const byType = {};
  let calls = 0, failed = 0, matched = 0;
  for (const b of batches) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      calls++;
      let d;
      try {
        d = await hcpCall('/artemis/api/eventService/v1/eventRecords/page', {
          startTime: hcpTime(start), endTime: hcpTime(end),
          pageNo: page, pageSize: PAGE,
          eventTypes: typeList.join(','), srcType: 'camera', srcIndexs: b,
        });
      } catch (e) { failed++; console.warn('[hcp-events]', e.message); break; }
      if (page === 1) matched += Number(d.total) || 0;
      const list = d.list || [];
      for (const e of list) {
        byType[e.eventType] = (byType[e.eventType] || 0) + 1;
        rows.push({
          event_id: e.eventIndexCode, type: String(e.eventType),
          src_index: String(e.srcIndex || ''), src_name: nameOf[String(e.srcIndex)] || null,
          src_type: e.srcType || null,
          start_time: e.startTime, stop_time: e.stopTime || null,
          description: e.description || null,
          pic_uri: e.eventPicUri || null,
        });
      }
      if (list.length < PAGE) break;
    }
  }
  rows.sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));

  return {
    ok: true,
    // บอกขอบเขตที่ค้นจริงเสมอ — "ไม่พบ" กับ "ไม่ได้ค้นตรงนั้น" เป็นคนละเรื่อง
    scope: { cameras: cams.length, batches: batches.length, calls, failed_calls: failed,
             types: typeList.length, excluded: EXCLUDED_TYPES,
             since: hcpTime(start), until: hcpTime(end) },
    by_type: byType,
    type_names: Object.fromEntries(Object.keys(byType).filter((t) => TYPE_NAMES[t]).map((t) => [t, TYPE_NAMES[t]])),
    total: rows.length,
    // matched = ยอดที่ HCP รายงานเอง · มากกว่า total แปลว่าชนเพดานหน้า (เก่าสุดหลุด)
    matched, truncated: matched > rows.length,
    rows: rows.slice(0, limit),
  };
}

module.exports = { fetchHcpEvents, batchCameras, EXCLUDED_TYPES, DEFAULT_TYPES, TYPE_NAMES };
