// ============================================================
// Vigil Platform — คิว reconcile ตารางสรุป (ทำทีละตัวใน process เดียว)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// reconcile ทั้งสี่ตัวถึงเวลา 05:00 พร้อมกัน แย่ง IO กันเอง (27 ต.ค. lpr 316 วิ ทั้งที่รันเดี่ยว ~95 วิ บนเครื่อง RAM 15 GB)
// ต่อคิวใน process เดียว ไม่เปลี่ยนจำนวนวันหรือผล · งานที่รอคิวถือ connection ของ advisory lock ไว้เฉย ๆ
// และข้ามรอบ refresh ของตัวเองระหว่างรอ (เหมือนตอน reconcile ปกติ)
// ============================================================
'use strict';

let _tail = Promise.resolve();

/** รัน fn หลังงานก่อนหน้าจบ (สำเร็จหรือล้มก็ตาม) · คืนผล/ข้อผิดพลาดของ fn เอง */
function serial(fn) {
  const p = _tail.then(fn, fn);
  _tail = p.then(() => {}, () => {});
  return p;
}

module.exports = { serial };
