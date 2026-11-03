// ============================================================
// Vigil Platform — LPR write guard (admin-only writes, operator allowlist)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// 🔴 /api/lpr: เขียนได้เฉพาะ admin ยกเว้นงานของเจ้าหน้าที่หน้าจอ (deny by default)
// เดิมไม่อยู่ในรายการนี้เลย ⇒ viewer (7 บัญชี) แก้/ลบ watchlist, เปลี่ยนตั้งค่าภาพ ingest ทั้งระบบ,
// ทิศกล้อง, gates และกดส่ง LINE ได้ (audit 2026-10-02 · GOTCHAS #217) · ตรวจ audit_log 60 วัน
// viewer ไม่เคยใช้เส้นเขียนเหล่านี้เลย · ที่ยกเว้น = ที่หน้าจอ/คำสั่ง LINE ของเจ้าหน้าที่เรียกจริง
// (line-actions.js: ack · notify · mute) — ปรับรายการได้ตามนโยบายเจ้าของ
const LPR_OPERATOR_WRITES = [
  /^\/alerts\/\d+\/(ack|notify|notify-telegram)$/,          // POST
  /^\/gs-alarms\/\d+\/(notify|notify-telegram)$/,           // POST
  /^\/watchlist\/[^/]+\/mute$/,                            // POST/DELETE หยุดแจ้งเตือนรายป้าย
];
function lprWriteGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.user?.role === 'admin') return next();
  // Admin เฉพาะไซต์ — ผ่านเฉพาะเมื่อ siteAdminGate (ใน api-server) ตรวจรายการของไซต์ตัวเองแล้ว
  if (req.user?.role === 'site_admin' && req.siteAdminWriteOk === true) return next();
  if (req.user && LPR_OPERATOR_WRITES.some((re) => re.test(req.path))) return next();
  return res.status(403).json({ error: 'Admin role required for this operation' });
}

module.exports = { lprWriteGuard, LPR_OPERATOR_WRITES };
