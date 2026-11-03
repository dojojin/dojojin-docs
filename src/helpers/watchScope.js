// ============================================================
// Vigil Platform — ขอบเขต Site ของรายการเฝ้าระวังป้ายทะเบียน
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// กลุ่มที่ site_id IS NULL = Global (จับคู่ทุกกล้อง — พฤติกรรมเดิม) · มีค่า = จับคู่เฉพาะกล้องของ Site นั้น
// (migration 261) · ป้ายที่ไม่มีกลุ่ม = Global
//
// 🔴 ใช้ fragment นี้ "ทุกจุด" ที่จับคู่ lpr_watchlist กับการอ่านป้าย — ทั้ง LINE, หน้าแจ้งเตือน และตัวเลข
// "ตรงเฝ้าระวัง" ในสถิติ ไม่งั้นสองหน้าจอจะนับไม่ตรงกัน (test/watch-scope-coverage.test.js ล็อกไว้)
// 🔴 ใส่ใน ON ของ LEFT JOIN ไม่ใช่ WHERE — ไม่งั้นแถวการอ่านป้ายทั้งแถวหายจากยอดรวม (เหลือแค่ w เป็น NULL ที่ถูก)
// subquery กล้องรันเฉพาะแถวที่ป้ายตรงแล้ว (หลัง plate_number match) จึงไม่แตะ 2.9M แถวทั้งตาราง
function watchSiteOk(w = 'w', camExpr = 'lp.camera_id') {
  return `NOT EXISTS (SELECT 1 FROM lpr_watchlist_groups wsg
                       WHERE wsg.id = ${w}.group_id AND wsg.site_id IS NOT NULL
                         AND wsg.site_id IS DISTINCT FROM (SELECT site_id FROM cameras WHERE id = ${camExpr}))`;
}

// ── ฝั่งจัดการรายการ (routes) ──
// ผู้ใช้ที่ถูกจำกัด Site เห็นกลุ่ม Global + กลุ่มของ Site ตัวเอง · null = ไม่จำกัด (admin/auditor)
// ใช้คู่กับ SQL: ($n::int[] IS NULL OR g.site_id IS NULL OR g.site_id = ANY($n))
function visibleSites(req) {
  const s = req.user?.allowedSites ?? null;
  return s === null ? null : Array.from(s, Number);
}
// site_id ใน body: ไม่ส่ง = ไม่เปลี่ยน (undefined) · null/'' = Global · ตัวเลข = Site นั้น · อย่างอื่น = ผิด
function bodySiteId(body) {
  if (!body || !('site_id' in body)) return { present: false };
  const v = body.site_id;
  if (v === null || v === '') return { present: true, value: null };
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? { present: true, value: n } : { present: true, error: 'site_id must be a site id or null' };
}

module.exports = { watchSiteOk, visibleSites, bodySiteId };
