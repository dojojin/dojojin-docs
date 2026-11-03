// ============================================================
// Vigil Platform — อ่าน "ลักษณะคน" จากประโยคไทย → ตัวกรองของ /api/faces
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของสั่ง 2026-09-09 ให้สั่งค้นใบหน้าจากในแชทได้ เช่น
//   "ค้นหาใบหน้า ผู้หญิง ตอนเช้าช่วง ตีหนึ่ง ภูเก็ต กล้อง C38"
//   "ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง ตอนเช้า"
//   "ค้นหาใบหน้า คนใส่หน้ากาก ช่วงบ่าย"
//
// ค่าที่คืนต้องเป็น **ค่าเดียวกับที่หน้าเว็บส่ง** ทุกตัว (ดู dashboard/index.html แท็บค้นหา)
// ไม่งั้นเลขในแชทกับบนจอจะเป็นคนละชุดโดยไม่มีใครรู้:
//   gender male|female · mask/hat yes|no · glass yes|sunglasses|no
//   expression happy|sad|poker-faced|angry|surprised|disgusted|panic
//   top_color/bottom_color Black|White|Gray|Blue|Red|Green|Yellow|Orange|Purple|Pink|Brown|Beige
//   top_type ShortSleeve|LongSleeve|Sleeveless|Jacket|Coat|Vest
//
// 🔴 ปฏิเสธต้องตรวจก่อนยืนยันเสมอ — "ไม่สวมหน้ากาก" มีคำว่า "หน้ากาก" อยู่ในตัว
//    ถ้าตรวจฝั่งยืนยันก่อน จะได้ตัวกรองกลับหัวโดยที่การ์ดยังดูปกติทุกประการ
// ============================================================
'use strict';

const COLORS = {
  ดำ: 'Black', ขาว: 'White', เทา: 'Gray', 'น้ำเงิน': 'Blue', 'ฟ้า': 'Blue',
  แดง: 'Red', เขียว: 'Green', เหลือง: 'Yellow', 'ส้ม': 'Orange',
  'ม่วง': 'Purple', 'ชมพู': 'Pink', 'น้ำตาล': 'Brown', 'เบจ': 'Beige', 'ครีม': 'Beige',
};

const EXPR = {
  'ยิ้ม': 'happy', 'ยิ้มแย้ม': 'happy', 'เศร้า': 'sad', 'หน้านิ่ง': 'poker-faced',
  'โกรธ': 'angry', 'ประหลาดใจ': 'surprised', 'ตกใจ': 'panic', 'ไม่พอใจ': 'disgusted',
};

const TOP_TYPE = {
  'แขนสั้น': 'ShortSleeve', 'แขนยาว': 'LongSleeve', 'แขนกุด': 'Sleeveless',
  'แจ็คเก็ต': 'Jacket', 'เสื้อคลุม': 'Coat', 'เสื้อกั๊ก': 'Vest',
};

const AGE_BANDS = [
  [/0-12|เด็กเล็ก/, 0, 12], [/13-19|วัยรุ่น/, 13, 19], [/20-29/, 20, 29],
  [/30-39/, 30, 39], [/40-49/, 40, 49], [/50-59/, 50, 59], [/60\+|60-200|ผู้สูงอายุ|คนแก่/, 60, 200],
];

// ช่วงวัยที่กล้องส่งมา → คำไทย · ยึดตาม `ageGroup.*` ใน dashboard/i18n.js เพื่อให้
// คำในแชทกับบนจอเป็นคำเดียวกัน (ค่าที่พบจริงใน 12 ชม.: prime · middle · young ·
// middleAged · kid · child · old · infant · teenager)
const AGE_GROUP_TH = {
  infant: 'ทารก', kid: 'เด็ก', child: 'เด็ก', teenager: 'วัยรุ่น', teen: 'วัยรุ่น',
  young: 'วัยหนุ่มสาว', prime: 'วัยทำงาน', middle: 'วัยกลางคน', middleAged: 'วัยกลางคน',
  old: 'สูงอายุ',
};
const ageGroupTh = (g) => AGE_GROUP_TH[String(g || '')] || null;

/** คำที่อยู่ในประโยคแบบ "ไม่ …" — ใช้แยกสวม/ไม่สวม */
const _no = (t, word) => new RegExp(`(ไม่ได้|ไม่)\\s*(ใส่|สวม)?\\s*${word}`).test(t);

/**
 * อ่านลักษณะทั้งหมดที่พูดถึงในประโยค
 * @returns {object} ตัวกรองในรูปแบบเดียวกับ query string ของ /api/faces (ว่าง = ไม่ระบุ)
 */
function parseFaceAttrs(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = {};

  if (/ผู้หญิง|ผญ|สตรี|หญิง/.test(t)) out.gender = 'female';
  else if (/ผู้ชาย|ผช|บุรุษ|ชาย/.test(t)) out.gender = 'male';

  if (/หน้ากาก|แมส/.test(t)) out.mask = _no(t, '(หน้ากาก|แมส)') ? 'no' : 'yes';
  if (/หมวก/.test(t)) out.hat = _no(t, 'หมวก') ? 'no' : 'yes';
  if (/แว่นกันแดด|แว่นดำ/.test(t)) out.glass = 'sunglasses';
  else if (/แว่น/.test(t)) out.glass = _no(t, 'แว่น') ? 'no' : 'yes';

  for (const [th, en] of Object.entries(EXPR)) if (t.includes(th)) { out.expression = en; break; }

  // สีต้องผูกกับชิ้นเสื้อผ้า — "เสื้อสีแดง" กับ "กางเกงสีแดง" คนละช่องกัน
  // และ "สีแดง" ลอย ๆ ไม่ควรเดาว่าเป็นเสื้อ (เดาผิดแล้วผลหายไปทั้งชุดโดยไม่มีคำอธิบาย)
  for (const [th, en] of Object.entries(COLORS)) {
    if (new RegExp(`เสื้อ\\s*(สี)?\\s*${th}`).test(t)) out.top_color = en;
    if (new RegExp(`(กางเกง|กระโปรง)\\s*(สี)?\\s*${th}`).test(t)) out.bottom_color = en;
  }
  for (const [th, en] of Object.entries(TOP_TYPE)) if (t.includes(th)) { out.top_type = en; break; }

  for (const [re, lo, hi] of AGE_BANDS) {
    if (re.test(t)) { out.age_min = String(lo); out.age_max = String(hi); break; }
  }
  return out;
}

/** คำอธิบายไทยของตัวกรองที่ใช้จริง — ต้องพิมพ์กลับบนการ์ดเสมอ ให้คนค้านได้ */
function describeFaceAttrs(a = {}) {
  const rev = (map, v) => Object.keys(map).find((k) => map[k] === v) || v;
  const bits = [];
  if (a.gender) bits.push(a.gender === 'female' ? 'ผู้หญิง' : 'ผู้ชาย');
  if (a.age_min) bits.push(`อายุ ${a.age_min}-${a.age_max} ปี`);
  if (a.mask) bits.push(a.mask === 'yes' ? 'สวมหน้ากาก' : 'ไม่สวมหน้ากาก');
  if (a.hat) bits.push(a.hat === 'yes' ? 'สวมหมวก' : 'ไม่สวมหมวก');
  if (a.glass === 'sunglasses') bits.push('แว่นกันแดด');
  else if (a.glass) bits.push(a.glass === 'yes' ? 'สวมแว่น' : 'ไม่สวมแว่น');
  if (a.expression) bits.push(rev(EXPR, a.expression));
  if (a.top_type) bits.push(rev(TOP_TYPE, a.top_type));
  if (a.top_color) bits.push(`เสื้อสี${rev(COLORS, a.top_color)}`);
  if (a.bottom_color) bits.push(`กางเกงสี${rev(COLORS, a.bottom_color)}`);
  return bits;
}

module.exports = { parseFaceAttrs, describeFaceAttrs, ageGroupTh, COLORS, EXPR, TOP_TYPE };
