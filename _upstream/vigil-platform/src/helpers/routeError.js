// ============================================================
// Vigil Platform — Route Error Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

/**
 * Handles route catch-block errors: logs full detail server-side,
 * returns a generic response to the client (SEC-2T-004).
 *
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} context  - short label for server logs, e.g. 'GET /api/users'
 */
function routeError(res, err, context, req = null) {
  // ใครเป็นคนยิง — ไม่มีข้อมูลนี้ ตอนไล่บั๊กจะแยกไม่ออกว่า error มาจากผู้ใช้ที่ร้องเรียน
  // หรือจาก session อื่นที่บังเอิญยิงพร้อมกัน (เจอปัญหานี้จริง 2026-08-27: หน้าสถิติ
  // ว่างสำหรับ viewer คนหนึ่ง แต่ timeout ใน log เป็นของ admin ที่เปิดอยู่คนละแท็บ)
  // 🔒 ลง username เท่านั้น ไม่ลง token/cookie/query — log ไม่ใช่ที่เก็บความลับ
  const who = req?.user?.username ? ` [${req.user.username}/${req.user.role}]` : '';
  // ช่วงเวลา/ขอบเขตที่ขอมา — ตัวแปรที่ทำให้ query เดียวกันเร็ว 0.2 วิ หรือเกิน 120 วิ
  // 🔒 เฉพาะคีย์ที่เป็นตัวกรอง ไม่ใช่ทั้ง query string (กัน token/คีย์อื่นหลุดลง log)
  const SAFE = ['from', 'to', 'period', 'days', 'trunc', 'site_id', 'cameras', 'cats_hide'];
  const q = req?.query
    ? SAFE.filter((k) => req.query[k] != null)
        .map((k) => `${k}=${String(req.query[k]).slice(0, 60)}`).join('&')
    : '';
  console.error(`[routeError]${who} ${context}${q ? ` ?${q}` : ''}:`, err.message);
  // ข้อผิดพลาดที่ **ตั้งใจโยน** พร้อมระบุสถานะเอง (เช่น 400 = คำขอไม่ถูกต้อง)
  // ให้ส่งข้อความจริงกลับไป — ไม่งั้นผู้ใช้เห็น "Internal server error" ทั้งที่ต้นเหตุ
  // คือคำขอของเขาเอง แล้วไม่มีทางรู้ว่าต้องแก้อะไร (เพิ่ม 2026-08-27)
  //
  // 🔒 ยังไม่เปิดเผยรายละเอียดของ error ที่ไม่ได้ตั้งใจโยน — err.status ต้องถูก
  // เซ็ตอย่างจงใจในโค้ดเราเท่านั้น ไม่มีทางที่ error ของไลบรารีจะมีค่านี้ตรง ๆ
  // (SEC-2T-004 ยังคงมีผลกับทุกกรณีที่เหลือ)
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500
    ? err.status : 500;
  if (status !== 500) return res.status(status).json({ error: err.message });
  res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
}

module.exports = routeError;
