// ============================================================
// Vigil Platform — Helper: แปลข้อมูลดิบของรายการเฝ้าระวังเป็นคำที่คนอ่านออก
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เจ้าของชี้ 2026-08-13: การ์ดแจ้งเตือน LINE ส่งค่าดิบจากโรสเตอร์ออกไปตรง ๆ —
// "ชนิดป้าย normal-white-black · ประเภท Motorcycle · สี White" — ซึ่งเป็นคำของ
// ระบบต้นทาง ไม่ใช่คำที่เจ้าหน้าที่หน้างานอ่านแล้วใช้ได้ทันที
//
// ตารางแปลข้างล่างสร้างจาก **ค่าที่มีอยู่จริงในโรสเตอร์** (นับเมื่อ 2026-08-13)
// ไม่ใช่เดา — ตัวเลขในคอมเมนต์คือจำนวนแถวจริง เพื่อให้คนอ่านทีหลังแยกออกว่า
// อันไหนเป็นหมวดจริง อันไหนเป็นค่าหลงเข้ามา
//
// ⚠️ ตารางชุดนี้ **ซ้ำกับฝั่งหน้าจอโดยตั้งใจ** (dashboard/page-blacklist.js) —
// ฝั่งนั้นรันในเบราว์เซอร์ ฝั่งนี้รันตอนประกอบข้อความ LINE บนเซิร์ฟเวอร์
// เอามาแชร์กันไม่ได้โดยไม่ยกไฟล์ออกเป็น shared bundle ซึ่งใหญ่กว่าปัญหา
// ถ้าแก้ที่ไหน ให้แก้ทั้งสองที่ (คอมเมนต์นี้อยู่ทั้งสองฝั่ง)
'use strict';

// cartype → คำไทย · จากค่าจริง 786 แถว
const TYPE_TH = {
  motorcycle: 'จักรยานยนต์',   // 619
  car:        'รถยนต์',        // 156
  pickup:     'รถกระบะ',       // 7
  truck:      'รถบรรทุก',      // 2
  van:        'รถตู้',          // 1
  bus:        'รถบัส',
  other:      'อื่น ๆ',         // 1
};

// carcolor → คำไทย · จากค่าจริง 786 แถว (โรสเตอร์เขียนเป็นอังกฤษเสมอ)
const COLOR_TH = {
  black: 'ดำ',          // 207
  white: 'ขาว',         // 145
  blue: 'น้ำเงิน',       // 131
  red: 'แดง',           // 118
  gray: 'เทา', grey: 'เทา',   // 87
  green: 'เขียว',        // 38
  brown: 'น้ำตาล',       // 24
  purple: 'ม่วง',        // 10
  pink: 'ชมพู',          // 6
  darkorange: 'ส้มเข้ม', // 5
  orange: 'ส้ม',
  yellow: 'เหลือง',      // 4
  gold: 'ทอง',          // 3
  silver: 'เงิน',        // 3
  beige: 'ครีม',
  unknown: '',          // 5 — ไม่ใช่ "ไม่มีสี" แต่ "ไม่ได้บันทึกไว้" → ไม่ต้องพิมพ์
};

// platetype → ป้ายทะเบียนไทยนิยามด้วย **พื้นป้าย + สีตัวอักษร** ทั้งคู่
// normal-white-black (778) = ส่วนบุคคล · normal-white-green (2) = บรรทุกส่วนบุคคล
// พื้นเดียวกันแต่คนละความหมาย จึงห้ามยุบสีตัวอักษรทิ้ง
const PLATE_TH = {
  'white-black':   'ป้ายขาว ตัวดำ (ส่วนบุคคล)',
  'white-green':   'ป้ายขาว ตัวเขียว (บรรทุกส่วนบุคคล)',
  'white-blue':    'ป้ายขาว ตัวน้ำเงิน (บรรทุก)',
  'yellow-black':  'ป้ายเหลือง ตัวดำ (รับจ้าง)',
  'red-black':     'ป้ายแดง (รถใหม่ ยังไม่จดทะเบียน)',
  'graphic-black': 'ป้ายประมูล/กราฟิก',   // 1
};

// blacklisttype → ระดับของรายการ · เป็นสิ่งที่เปลี่ยน "ต้องทำอะไรต่อ" จึงต้องอ่านออก
const TIER_TH = {
  blacklist: 'บัญชีดำ',   // 629
  watchlist: 'เฝ้าระวัง', // 152
  whitelist: 'บัญชีขาว',  // 2
  test:      'ทดสอบระบบ', // 3
};

const _k = (v) => String(v ?? '').trim().toLowerCase();

function typeTh(v)  { return TYPE_TH[_k(v)]  || (v ? String(v) : ''); }
function colorTh(v) { const k = _k(v); return k in COLOR_TH ? COLOR_TH[k] : (v ? String(v) : ''); }
function tierTh(v)  { return TIER_TH[_k(v)]  || (v ? String(v) : ''); }

/** normal-<พื้น>-<ตัวอักษร> หรือคำสีเดี่ยว ("White" 119 แถว — ระบุแค่พื้นป้าย) */
function plateTh(v) {
  const s = _k(v);
  if (!s || s === '-') return '';
  const m = s.match(/^normal-([a-z]+)-([a-z]+)$/);
  if (m) return PLATE_TH[`${m[1]}-${m[2]}`] || `ป้าย${colorTh(m[1]) || m[1]} ตัว${colorTh(m[2]) || m[2]}`;
  return PLATE_TH[`${s}-black`] || (colorTh(s) ? `ป้าย${colorTh(s)}` : String(v));
}

/**
 * ประกอบชุดข้อมูลอ้างอิงจากโรสเตอร์ให้พร้อมวางลงการ์ด
 *
 * แยกจาก "สิ่งที่กล้องเห็น" โดยตั้งใจ — รถที่กล้องเห็นกับรถที่โรสเตอร์บันทึกไว้
 * ไม่ตรงกันเป็นเรื่องที่เจ้าหน้าที่ต้องเห็น ไม่ใช่เรื่องที่ระบบควรกลบให้เนียน
 * (เช่น กล้องเห็นสีดำ แต่โรสเตอร์ว่าสีขาว = อาจพ่นสีใหม่ หรืออาจอ่านป้ายผิด)
 *
 * ⚠️ ไม่รวม "แหล่งข้อมูล" (ชื่อระบบต้นทาง) — เจ้าของสั่งไม่ให้แจ้งใน LINE
 */
function refFields(rawJson, name = null, caseRef = null, extra = {}) {
  const rj = rawJson || {};
  const brand = (rj.carbrand || '').trim();
  const type  = typeTh(rj.cartype);
  // carcolor = โรสเตอร์ GuruSquare · vehicle_color = ระเบียน HCP (13 แถว) คนละคีย์
  const color = colorTh(rj.carcolor || rj.vehicle_color);
  // ⚠️ owner_detail กับ remark **ไม่ใช่ของเดียวกัน** — วัดจริง 462 จาก 799 แถวต่างกัน
  //   owner_detail = "ลักทรัพย์"                        → ประเภทคดี
  //   remark       = "พบเห็นแจ้ง ภ.จว.สงขลาหรือกลุ่มม่วง" → รายละเอียด/สิ่งที่ต้องทำ
  // เดิมใช้ owner_detail || remark ทำให้ "สิ่งที่ต้องทำ" หายไปเงียบ ๆ เมื่อมีคดี
  const kase   = (rj.owner_detail || '').trim();
  const detail = (rj.remark || '').trim();
  // หน่วยที่แจ้ง (sr.name) กับหน่วยงานเจ้าของคดี (sr.case_ref) คนละอย่างกัน
  const unit  = [name, caseRef].map(v => (v || '').trim()).filter(Boolean).join(' · ');
  return {
    brand,
    type,
    color,
    // ยี่ห้อ · ประเภท · สี — เรียงจากสิ่งที่ชี้ตัวรถได้แม่นที่สุดไปหาน้อยที่สุด
    vehicle: [brand, type, color ? `สี${color}` : ''].filter(Boolean).join(' · '),
    plate: plateTh(rj.platetype),
    // เลขป้ายตามที่ฐานข้อมูลบันทึกไว้ — คนละตัวกับที่กล้องเพิ่งอ่านได้ ({plate})
    // ต่างกันเมื่อไหร่แปลว่าอ่านผิดหรือสลับป้าย ซึ่งเป็นเรื่องที่ต้องเห็น
    plateNumber: (extra.plateNumber || (Array.isArray(rj.plate_numbers) ? rj.plate_numbers[0] : '') || '').trim(),
    // จังหวัดที่จดทะเบียน — คนละอย่างกับจังหวัดที่กล้องอ่านได้จากป้าย
    province: (rj.province || rj.plate_area || '').trim(),
    tier: tierTh(rj.blacklisttype || rj.group_name),
    case: kase,
    detail: detail && detail !== kase ? detail : '',   // ซ้ำกันก็ไม่ต้องพิมพ์สองรอบ
    unit,
    // ครั้งล่าสุดที่ข้อมูลชุดนี้เปลี่ยน — บอกได้ว่าที่กำลังอ่านอยู่เก่าแค่ไหน
    // ผู้เรียกที่รู้เวลาจากหลายทาง (ต้นทางแก้ / คนแก้ผ่านหน้าจอเรา / ตอนนำเข้า)
    // เลือกตัวใหม่สุดมาให้ทาง extra · ไม่ได้ส่งมาก็ตกกลับไปใช้ค่าของต้นทางเหมือนเดิม
    updated: fmtUpdated(extra.updatedAt || rj.last_update),
  };
}

/** ISO ของต้นทาง → วันเวลาไทยแบบสั้น · รูปแบบพัง = คืนค่าเดิม ดีกว่ากลืนหาย */
function fmtUpdated(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

module.exports = { refFields, fmtUpdated, typeTh, colorTh, plateTh, tierTh, TYPE_TH, COLOR_TH, PLATE_TH, TIER_TH };

// ── self-check: node src/helpers/lprRefLabels.js ────────────
if (require.main === module) {
  const assert = require('assert');

  // แถวจริงจากโรสเตอร์ (คษธ703) — ค่าที่เคยหลุดออก LINE เป็นภาษาอังกฤษดิบ
  const r = refFields({
    remark: 'ลักทรัพย์', cartype: 'Motorcycle', carbrand: 'ฮอนด้า เวฟ110ไอ',
    carcolor: 'White', province: 'สงขลา', platetype: 'normal-white-black',
    owner_detail: 'ลักทรัพย์', blacklisttype: 'blacklist',
    last_update: '2024-10-18T18:13:02', plate_numbers: ['คษธ703'],
  }, 'สภ.นราธิวาส', null);
  assert.strictEqual(r.vehicle, 'ฮอนด้า เวฟ110ไอ · จักรยานยนต์ · สีขาว');
  assert.strictEqual(r.plate, 'ป้ายขาว ตัวดำ (ส่วนบุคคล)');
  assert.strictEqual(r.tier, 'บัญชีดำ');
  assert.strictEqual(r.unit, 'สภ.นราธิวาส');
  assert.ok(!/Motorcycle|White|normal-/.test(JSON.stringify(r)), 'ต้องไม่มีคำดิบหลงเหลือ');

  assert.strictEqual(r.plateNumber, 'คษธ703');
  assert.ok(r.updated.length > 0, 'last_update ต้องแปลงเป็นวันเวลาไทย: ' + r.updated);
  // owner_detail กับ remark เท่ากันในแถวนี้ → รายละเอียดต้องไม่พิมพ์ซ้ำ
  assert.strictEqual(r.detail, '');

  // แถวที่สองช่องต่างกันจริง (462/799 แถว) — ต้องได้ทั้งคู่ ไม่ใช่เลือกข้าง
  const two = refFields({ owner_detail: 'ลักทรัพย์', remark: 'พบเห็นแจ้ง ภ.จว.สงขลา' });
  assert.strictEqual(two.case, 'ลักทรัพย์');
  assert.strictEqual(two.detail, 'พบเห็นแจ้ง ภ.จว.สงขลา');

  // เลขป้ายจากฐานข้อมูล — รับจาก extra ก่อน แล้วค่อยดูใน raw_json
  assert.strictEqual(refFields({}, null, null, { plateNumber: 'กก1234' }).plateNumber, 'กก1234');
  assert.strictEqual(refFields({}).plateNumber, '', 'ไม่มีข้อมูลเลยต้องว่าง ไม่ใช่ undefined');
  assert.strictEqual(refFields({ plate_numbers: ['ขข9999'] }).plateNumber, 'ขข9999');

  // ระเบียน HCP ใช้คนละคีย์ (13 แถว) — ต้องอ่านได้ด้วย
  assert.strictEqual(refFields({ vehicle_color: 'Red' }).color, 'แดง');
  assert.strictEqual(refFields({ plate_area: 'ภูเก็ต' }).province, 'ภูเก็ต');
  assert.strictEqual(refFields({ group_name: 'watchlist' }).tier, 'เฝ้าระวัง');

  // วันที่พัง = คืนค่าเดิม ไม่ใช่ Invalid Date
  assert.strictEqual(fmtUpdated('ไม่ใช่วันที่'), 'ไม่ใช่วันที่');
  assert.strictEqual(fmtUpdated(null), '');

  // พื้นป้ายเดียวกัน สีตัวอักษรต่างกัน = คนละความหมาย ห้ามยุบทิ้ง
  assert.notStrictEqual(plateTh('normal-white-black'), plateTh('normal-white-green'));
  assert.ok(plateTh('normal-white-green').includes('บรรทุก'));

  // ค่าที่ไม่รู้จักต้องผ่านออกไปตามเดิม ดีกว่ากลืนหายจนอ่านไม่ออกว่ามีข้อมูลอยู่
  assert.strictEqual(typeTh('Spaceship'), 'Spaceship');
  assert.strictEqual(plateTh('normal-pink-black'), 'ป้ายชมพู ตัวดำ');

  // Unknown = "ไม่ได้บันทึก" ไม่ใช่สีชื่อ Unknown — ต้องไม่โผล่บนการ์ด
  assert.strictEqual(colorTh('Unknown'), '');
  assert.strictEqual(refFields({ cartype: 'Car', carcolor: 'Unknown' }).vehicle, 'รถยนต์');

  // ว่างทั้งก้อนต้องไม่พ่น undefined/'-' ออกมา
  const e = refFields(null);
  assert.ok(Object.values(e).every(v => v === ''), JSON.stringify(e));

  // หน่วยที่แจ้ง + หน่วยงาน คนละช่อง ต่อกันเมื่อมีทั้งคู่
  assert.strictEqual(refFields({}, 'สภ.หาดใหญ่', 'ศปจร.').unit, 'สภ.หาดใหญ่ · ศปจร.');

  console.log('lprRefLabels self-check: all assertions passed');
}
