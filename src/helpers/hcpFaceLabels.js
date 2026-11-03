// ============================================================
// Vigil Platform — Helper: HCP face attribute labels
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// รหัสคุณลักษณะใบหน้าของ HikCentral Professional (คู่มือ V3.0.1 ภาคผนวก A.1.45)
// แปลเป็นคำไทยสำหรับ **ฝั่งเซิร์ฟเวอร์** (การ์ด LINE) — หน้าเว็บมีตารางของตัวเอง
// อยู่ที่ `dashboard/page-hcp-face-search.js` (`_HCP_GENDER` ฯลฯ) เพราะไฟล์นั้นเป็น
// สคริปต์ของเบราว์เซอร์ require เข้ามาไม่ได้ · แก้ที่ไหนต้องแก้อีกที่ด้วย
// (รูปแบบเดียวกับ HR_LABELS ใน report-renderer.js ตาม CLAUDE.md ข้อ 4)
// ============================================================
'use strict';

const GENDER = { 1: 'ชาย', 2: 'หญิง', male: 'ชาย', female: 'หญิง' };

// 🔴 เจตนา: ประกาศเฉพาะค่าที่ "ยืนยันได้ว่าใช่" · รหัสของ HCP เป็น tri-state
// (0 = ไม่ทราบ / 1 = ใช่ / 2 = ไม่ใช่) การขึ้นว่า "ไม่สวมแว่น" จากค่า 2 ดูเหมือน
// ข้อมูล แต่ที่จริงคือการยืนยันสิ่งที่กล้องไม่ได้ยืนยัน — บนการ์ดตามจับคนนี่อันตราย
const GLASSES = { 1: 'สวมแว่น', 3: 'แว่นกันแดด' };
const MASK    = { 1: 'สวมหน้ากาก' };

// ⚠️ **ไม่แปลอายุโดยตั้งใจ** — ตรวจ HCP event ทั้งหมดที่มีในระบบ 14 ใบ (2026-08-26)
// `hcp_age_group` มีแค่สองค่าคือ 5 และ 7 บนทุกคน รวมผู้ใหญ่ทุกราย ขณะที่ตารางของ
// คู่มือบอกว่า 5 = ทารก และ 7 = วัยรุ่นตอนต้น · ไม่ว่าจะเป็นตารางผิดหรือ HCP
// ไม่ได้คำนวณจริง ผลที่ออกมาก็ผิดแน่ ๆ การขึ้น "ทารก" บนการ์ดตามจับผู้ต้องหา
// หญิงวัยผู้ใหญ่คือความผิดพลาดที่ทำให้ทั้งการ์ดหมดความน่าเชื่อถือ
// เปิดใช้ได้เมื่อยืนยันความหมายของรหัสกับ Hik ได้แล้วเท่านั้น
const _n = (v) => (v == null || v === '' ? null : Number(v));

// ── ฝั่งกล้อง Hikvision เอง (ISAPI) — คนละชุดกับ HCP ─────────────────────────
// กล้องที่ไซต์ vss (Hikvision_FaceReg_C01) ส่งข้อมูลมา **ละเอียดกว่า HCP มาก**
// และเป็นค่าที่อ่านออกเลยไม่ใช่รหัส: age = 35 (ตัวเลขจริง) · gender = "male"
// · hat/mask/glass = "yes"/"no" · faceExpression = "happy"
// ตรวจกับ event 29983948 (2026-08-26)
const HIK_YES = new Set(['yes', 'true', '1']);
const HIK_WEAR = { glass: 'สวมแว่น', mask: 'สวมหน้ากาก', hat: 'สวมหมวก' };
const HIK_EXPR = { happy: 'ยิ้มแย้ม', smile: 'ยิ้ม', angry: 'โกรธ', sad: 'เศร้า',
                   surprise: 'ประหลาดใจ', disgust: 'รังเกียจ', fear: 'หวาดกลัว',
                   calm: 'เรียบเฉย', neutral: 'เรียบเฉย' };

/**
 * ลักษณะบุคคลที่กล้อง/HCP ส่งมากับเหตุการณ์ คืนเป็นสตริงเดียวคั่นด้วย ·
 * รับได้ทั้งสองรูปแบบ payload เพราะการ์ดใบหน้าใบเดียวกันถูกใช้ทั้งสองเส้นทาง
 * คืน null เมื่อไม่มีอะไรยืนยันได้เลย (ผู้เรียกจะได้ไม่ขึ้นแถวเปล่า)
 */
function faceAppearanceTh(raw = {}) {
  const parts = [GENDER[raw.gender] || GENDER[_n(raw.hcp_gender)] || null];

  // อายุจากกล้อง Hik เป็นตัวเลขจริง ใช้ได้ · ต่างจาก hcp_age_group ที่ยังเชื่อไม่ได้
  // ใส่ "ประมาณ" ไว้เพราะเป็นค่าที่โมเดลประเมิน ไม่ใช่อายุตามบัตร
  const age = _n(raw.age);
  if (Number.isFinite(age) && age > 0 && age < 120) parts.push(`อายุประมาณ ${age} ปี`);

  // เฉพาะที่ "ใส่จริง" — "ไม่สวมหมวก · ไม่สวมแว่น · ไม่สวมหน้ากาก" คือสามบรรทัด
  // ที่ไม่ได้ช่วยให้ใครจำหน้าคนได้ มีแต่ทำให้บรรทัดที่มีความหมายจมหายไป
  for (const [k, label] of Object.entries(HIK_WEAR)) {
    if (HIK_YES.has(String(raw[k]).toLowerCase())) parts.push(label);
  }
  const gl = GLASSES[_n(raw.hcp_glasses)]; if (gl) parts.push(gl);
  const mk = MASK[_n(raw.hcp_mask)];       if (mk) parts.push(mk);

  const expr = HIK_EXPR[String(raw.faceExpression || '').toLowerCase()];
  if (expr) parts.push(expr);

  const out = parts.filter(Boolean);
  return out.length ? out.join(' · ') : null;
}

module.exports = { faceAppearanceTh, GENDER, GLASSES, MASK, HIK_WEAR, HIK_EXPR };
