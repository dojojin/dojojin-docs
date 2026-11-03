// ============================================================
// Vigil Platform — Helper: siteStatus
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// ไซต์ที่ sites.status <> 'active' (maintenance/archived · migration 285) ต้องเงียบทุกแจ้งเตือน
// คืน Set ของ sites.code · cache 30 วิ · query ล้ม = Set ว่าง (แจ้งเตือนทำงานตามปกติ) + warn ครั้งเดียว — ห้ามโยน
const TTL_MS = 30_000;
let _cache = { at: 0, codes: new Set() };
let _warned = false;

async function quietSiteCodes(pool) {
  if (Date.now() - _cache.at < TTL_MS) return _cache.codes;
  try {
    const { rows } = await pool.query(`SELECT code FROM sites WHERE status <> 'active'`);
    _cache = { at: Date.now(), codes: new Set(rows.map(r => r.code)) };
    _warned = false;
  } catch (e) {
    if (!_warned) { _warned = true; console.warn('[site-status] quiet sites query:', e.message); }
    // cache Set ว่างไว้ 30 วิเหมือนกัน — DB ล่ม/ยังไม่มี column ไม่ถูกยิงซ้ำทุกรอบ
    _cache = { at: Date.now(), codes: new Set() };
  }
  return _cache.codes;
}

// เรียกหลังเปลี่ยนสถานะไซต์ เพื่อให้ process นี้เห็นทันที (process อื่นรอ TTL ≤ 30 วิ)
function invalidate() { _cache = { at: 0, codes: new Set() }; }

// id กล้องของไซต์ที่ archived — หน้าสด (สถานะกล้อง · Health · KPI) ใช้กรองออก (ค้นหา/รายงานยังเห็น)
// ไม่ cache: คิวรีเล็ก (join sites ที่มีไม่กี่แถว) · ล้ม = Set ว่าง (แสดงครบตามเดิม) ห้ามโยน
async function archivedCameraIds(pool) {
  try {
    const r = await pool.query(`SELECT c.id FROM cameras c JOIN sites s ON s.id = c.site_id WHERE s.status = 'archived'`);
    return new Set((r?.rows || []).map(x => x.id));
  } catch { return new Set(); }
}

module.exports = { quietSiteCodes, invalidate, archivedCameraIds };
