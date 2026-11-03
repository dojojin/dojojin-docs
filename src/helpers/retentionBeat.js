// ============================================================
// Vigil Platform — ร่องรอยว่างาน retention ได้รันจริง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมต้องมี: งาน retention ทุกตัวเขียน log เฉพาะตอน "ลบได้จริง" (if total > 0)
// ⇒ "รันแล้วไม่มีอะไรต้องลบ" กับ "ไม่เคยรันเลยเพราะพัง" มีหน้าตาใน log เหมือนกัน
// เป๊ะ ๆ คือ **เงียบทั้งคู่**
//
// นี่คือบั๊กคลาสเดียวกับที่เพิ่งเจอ 2026-08-27: reconcile ของ traffic-stats
// ล้มทุกคืนติดต่อกันหลายเดือน (statement timeout) โดยไม่มีใครรู้ เพราะมันเงียบ
// เหมือนตอนสำเร็จ · กว่าจะรู้ก็ตอนที่ตัวเลขบนหน้าจอไม่ตรง
//
// 🔴 เรื่องนี้สำคัญเป็นพิเศษกับ retention เพราะมันเป็นงานที่ "ยังไม่ถึงเวลาทำงาน"
// อยู่นาน: ระบบมีข้อมูล 66 วัน ส่วน data_retention_days = 365 ⇒ เส้นทางลบจริง
// จะถูกใช้ครั้งแรกในอีกราว 10 เดือน ถ้ามันพัง เราจะไปรู้ตอนดิสก์ใกล้เต็ม
// ซึ่งเป็นเวลาที่แย่ที่สุดที่จะมาแก้
//
// ตั้งใจให้เป็น log บรรทัดเดียว ไม่ใช่ฟิลด์ใน /api/health/details — บทเรียน
// 2026-08-27 อีกข้อ: ฟิลด์ที่ไม่มีหน้าจอไหนเรนเดอร์ = ตัวเลขที่ไม่มีใครเห็น
// (db.long_running_queries อยู่ใน payload มาเป็นเดือนโดยไม่มีใครอ่านเลย)
// ============================================================
'use strict';

/** เวลาที่แต่ละงานรันสำเร็จล่าสุด — ให้ผู้เรียกอื่นถามได้โดยไม่ต้องไปงม log */
const lastRun = new Map();

/**
 * บอกว่างานนี้รันจบแล้ว ไม่ว่าจะได้ลบอะไรหรือไม่
 * @param {string} name   ชื่องาน เช่น 'rawXml'
 * @param {number} n      จำนวนแถว/ไฟล์ที่จัดการไป (0 ได้)
 * @param {string} detail ข้อความต่อท้าย เช่น 'older than 90 days'
 */
function beat(name, n, detail = '') {
  lastRun.set(name, { at: new Date(), n });
  const what = n > 0 ? `${n.toLocaleString()} รายการ` : 'ไม่มีอะไรถึงกำหนด';
  console.log(`🧹 retention[${name}]: ${what}${detail ? ' · ' + detail : ''}`);
}

/** งานล้มเหลว — ต้องดังกว่าตอนสำเร็จ */
function beatFail(name, err) {
  lastRun.set(name, { at: new Date(), error: err.message });
  console.warn(`🧹 retention[${name}]: 🔴 ล้มเหลว — ${err.message}`);
}

module.exports = { beat, beatFail, lastRun };
