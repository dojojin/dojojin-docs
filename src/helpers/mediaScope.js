// ============================================================
// Vigil Platform — Media/stream scope guard
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Site-RBAC สำหรับ "ทางเข้าที่ไม่ใช่ /api" — `/snapshots/*`, `/media/*` และ
// WebSocket broadcast. สามทางนี้ไม่ผ่าน global `/api` middleware จึงไม่เคยถูก
// กรองด้วย allowedSites เลยตั้งแต่ต้น (พิสูจน์ 2026-08-12: viewer ที่ผูกกับ
// hkt ดึงภาพกล้อง hdy ได้ 101,634 bytes / HTTP 200 และรับ event สดข้ามสาขา
// ได้ 54 ข้อความใน 20 วินาที) — ดู GOTCHAS #163 / decision #248
//
// ⚠️ กับดักที่ต้องระวัง (บทเรียน GOTCHAS #162): `req.user` ของสามทางนี้มาจาก
// `getUserFromToken()` ตรงๆ ซึ่ง **ไม่มี** field `allowedSites` (global /api
// middleware เป็นคนเติมให้ และมันไม่ทำงานกับ path นอก /api) — จึงต้องเรียก
// `getAllowedSites()` เองทุกครั้งที่นี่ ห้ามสมมติว่าติดมากับ user object
// ============================================================
'use strict';

// camera_id → site_id · กล้องเปลี่ยนไม่บ่อยแต่ภาพถูกขอถี่มาก (แกลเลอรีเปิดที
// เดียว 50+ thumbnail) ถ้า query ต่อภาพจะกลายเป็นคอขวดทันที
let _map = null;
let _mapAt = 0;
const TTL_MS = 60_000;

async function cameraSiteMap(pool) {
  if (_map && Date.now() - _mapAt < TTL_MS) return _map;
  const { rows } = await pool.query('SELECT id, site_id FROM cameras');
  _map = new Map(rows.map(r => [r.id, r.site_id]));
  _mapAt = Date.now();
  return _map;
}

// เคลียร์ cache ทันทีเมื่อมีการแก้ไขกล้อง (เรียกจาก routes/cameras.js ตอน
// create/update/delete) — ไม่งั้นกล้องที่เพิ่งย้าย site จะยังถูกตัดสินด้วยของเก่า
// ได้นานสุด 60 วิ
function invalidateCameraSiteMap() { _map = null; _mapAt = 0; }

// หา camera_id เจ้าของไฟล์จาก path ของ snapshot
// คืน string  = ชื่อกล้อง (เอาไปเช็ค scope ต่อ)
//     null    = ไฟล์ที่ไม่มีกล้องเจ้าของโดยธรรมชาติ (รูป reference ของ roster)
//     undefined = รูปแบบที่ไม่รู้จัก → ผู้ใช้ที่ถูกจำกัดสิทธิ์ให้ปฏิเสธไว้ก่อน
//
// layout ที่มีจริงในระบบ (ยืนยันจาก DB 2026-08-12):
//   events|lpr|face / <date> / <camId> / <slot> / <file>   → segments[2]
//   preview / <camId>.jpg                                  → segments[1]
//   face / ref / <fdLibName> / <humanId>...                → ไม่มีกล้องเจ้าของ
//   <camId>_<seq>_<ts>.jpg  (legacy flat, ไม่มีโฟลเดอร์)    → ต้องเทียบกับรายชื่อกล้อง
function cameraIdFromSnapshotPath(segments, knownCamIds) {
  if (segments[0] === 'preview' && segments.length === 2) {
    return segments[1].replace(/\.(jpe?g|png)$/i, '');
  }
  // รูป reference ของ blacklist roster — เป็นรูปคน ไม่ได้ถ่ายจากกล้องตัวไหน
  // จึงไม่มี site เจ้าของให้เทียบ · การเข้าถึงถูกคุมด้วยสิทธิ์ "หน้าฐานข้อมูล"
  // อีกชั้นแทน (view allowlist) ไม่ใช่ชั้นนี้
  if (segments[0] === 'face' && segments[1] === 'ref') return null;
  if (segments.length >= 3) return segments[2];
  // legacy flat: ชื่อกล้องมี "_" อยู่ในตัวเอง (BOSCH_3100i_10002_...) แยกด้วย
  // split('_') ไม่ได้ ต้องเทียบ prefix กับรายชื่อกล้องจริงแทน
  if (segments.length === 1) {
    for (const id of knownCamIds) {
      if (segments[0].startsWith(id + '_')) return id;
    }
  }
  return undefined;
}

// ผู้ใช้คนนี้เข้าถึงกล้องตัวนี้ได้ไหม
// allowedSites === null → ไม่จำกัด (admin/auditor) ผ่านตลอด
function cameraInScope(allowedSites, camId, map) {
  if (allowedSites === null || allowedSites === undefined) return true;
  if (allowedSites.length === 0) return false;
  if (!camId) return false;
  // แกนที่ 2 — จำกัดรายกล้อง (decision #253) ติดมากับ allowedSites เป็น property
  // `cameras` · ไม่มี = ไม่จำกัด (พฤติกรรมเดิม) · มี = ต้องอยู่ในรายการนั้นด้วย
  const cams = allowedSites.cameras || null;
  if (cams && !cams.includes(camId)) return false;
  const siteId = map.get(camId);
  if (siteId == null) return false;   // กล้องที่ไม่รู้จัก/ไม่มี site = ปฏิเสธไว้ก่อน
  return allowedSites.includes(siteId);
}

// ด่านสำหรับ `/snapshots/*`
// คืน true = ให้ผ่าน · false = 403
async function snapshotInScope(pool, allowedSites, segments) {
  if (allowedSites === null || allowedSites === undefined) return true;
  const map = await cameraSiteMap(pool);
  const camId = cameraIdFromSnapshotPath(segments, map.keys());
  if (camId === null) return true;            // roster reference — ดูหมายเหตุด้านบน
  if (camId === undefined) {
    console.warn('[mediaScope] unresolved snapshot layout, denying for scoped user:', segments.join('/'));
    return false;                             // fail closed
  }
  return cameraInScope(allowedSites, camId, map);
}

module.exports = {
  cameraSiteMap,
  invalidateCameraSiteMap,
  cameraIdFromSnapshotPath,
  cameraInScope,
  snapshotInScope,
};
