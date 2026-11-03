// ============================================================
// Vigil Platform — สั่งรันงาน rollup ด้วยมือ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ปุ่ม "รันเดี๋ยวนี้" ของงานใน src/jobs/rollups.js — คู่กับสถานะที่อ่านได้จาก
// /api/health/details (คีย์ `jobs`) · แยกไฟล์เพราะ routes/health.js ยาว 932 บรรทัดแล้ว
//
// admin เท่านั้น: งานพวกนี้เขียนตารางสรุปและกินเวลา DB เป็นนาที (traffic reconcile)
// การปฏิเสธเมื่อรอบเดิมยังไม่จบอยู่ใน rollups.runOnce() ไม่ใช่ที่นี่ — เพื่อให้
// timer กับปุ่มใช้กติกาเดียวกัน
// ============================================================
'use strict';

const rollups = require('../jobs/rollups');

module.exports = function jobRoutes(app, pool, { auth, routeError }) {
  app.post('/api/jobs/:name/run', auth.requireAdmin, async (req, res) => {
    try {
      const r = await rollups.runOnce(req.params.name);
      // 409 = "มีเจ้าของอยู่แล้ว" (รันอยู่ที่นี่ หรือ process อื่นถือ advisory lock)
      // ไม่ใช่ 500 — ระบบทำงานถูกต้อง แค่ไม่ใช่ตอนนี้
      if (!r.ok) return res.status(r.skipped ? 409 : 400).json(r);
      res.json(r);
    } catch (e) { routeError(res, e, 'job run'); }
  });
};
