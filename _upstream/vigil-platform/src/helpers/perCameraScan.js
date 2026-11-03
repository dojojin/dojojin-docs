// ============================================================
// Vigil Platform — ไล่ทีละกล้อง (LATERAL) สำหรับคิวรีที่กรอง camera_id = ANY($k)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ปัญหา (GOTCHAS #235/#236): เลือกกล้องเป็นชุด (ไซต์ / กลุ่ม) + ช่วงยาว แล้ว planner ประเมินว่ามีของหลายหมื่นแถว
// จึงเดิน index เวลาทั้งช่วงแล้วเปิดแถวจริงเช็คกล้องทีละแถว — ไซต์ที่ไม่มีข้อมูลประเภทนั้นเลย (ภูเก็ตไม่มี event
// หน้าเหตุการณ์ · นราธิวาสไม่มีใบหน้า) เดินจนสุดช่วง 23 วิ – ชนเพดาน 120 วิ เพื่อคืน 0 แถว
// แก้: unnest(รายชื่อกล้อง) CROSS JOIN LATERAL (คิวรีเดิมที่ camera_id = กล้องเดียว) — ใช้ index (camera_id, event_time)
// ตรง ๆ ทีละกล้อง · ไซต์ที่ไม่มีของ = probe index ว่างไม่กี่ครั้ง
// ผลเหมือนเดิมทุกแถว: เงื่อนไขอื่นไม่เปลี่ยน แค่แยก ANY ออกเป็นทีละค่า (ตรวจใน snapshot เดียวกัน ดูเทสต์/GOTCHAS)
// ============================================================
'use strict';

/**
 * คืนส่วน FROM ที่ไล่ทีละกล้อง หรือ null ถ้าเขียนใหม่ไม่ได้ (ไม่มี/มีหลายจุด) — ผู้เรียกใช้คิวรีเดิมต่อ
 * @param {string} inner      คิวรีเต็มที่มี anyClause อยู่ "ครั้งเดียว"
 * @param {string} anyClause  ข้อความเงื่อนไขตรงตัว เช่น "e.camera_id = ANY($3)"
 * @param {number} idx        เลข param ของรายชื่อกล้อง
 * @param {string} camCol     คอลัมน์กล้องในคิวรี เช่น "e.camera_id" / "camera_id"
 * @param {string} alias      ชื่อผลของ LATERAL
 */
function perCameraFrom(inner, anyClause, idx, camCol, alias = 'x') {
  if (!idx || inner.split(anyClause).length !== 2) return null;
  return `unnest($${idx}::text[]) AS cam(id)
    CROSS JOIN LATERAL (${inner.replace(anyClause, `${camCol} = cam.id`)}) ${alias}`;
}

module.exports = { perCameraFrom };
