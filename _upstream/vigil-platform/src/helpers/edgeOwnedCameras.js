// ============================================================
// Vigil Platform — กล้องที่มี edge box ดูแลอยู่แล้ว
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// `cameras-config.json` บน central เก็บกล้อง**ทุกไซต์** เพราะ central เป็นต้นทางที่
// push รายการลงไปให้ edge — ถูกต้องแล้ว · แต่ ingester ที่รันบน central เองก็อ่าน
// ไฟล์เดียวกันนี้ไปไล่ poll ด้วย โดยกรองแค่ vendor กับ paused ⇒ มันพยายามต่อกล้อง
// ที่อยู่หลัง edge box ต่างจังหวัดซึ่งไม่มีเส้นทางไปถึงเลย
//
// 🔴 ของจริงที่วัดได้ 2026-08-14: central ยิง `EHOSTUNREACH 172.17.22.x` (วง LAN
// กล้องหาดใหญ่) ทุก 2-3 วินาที · `ingester_camera_status.retry_count` ขึ้นไป 3,506
// · และเพราะ `dahua-cgi.js` เขียนตารางสถานะเฉพาะตอนไม่ใช่ EDGE_MODE ⇒ **ความเห็น
// ของ central กลายเป็นสถานะกล้องที่หน้า Health แสดง** ⇒ กล้องที่ส่ง event อยู่
// 155 ใบใน 10 นาที ถูกรายงานว่า `reconnecting` มาตั้งแต่ 2 ก.ค.
//
// 141 จาก 143 กล้องเข้าข่ายนี้ ⇒ งาน poll เกือบทั้งหมดของ central เป็นงานเปล่า
//
// ⚠️ ต้อง fail-open เสมอ: อ่าน DB ไม่ได้ = ไม่กรองอะไรเลย = พฤติกรรมเดิม
// การกรองพลาดฝั่ง "กรองเกิน" ทำให้กล้องหยุด ingest ซึ่งแย่กว่าการ poll เปล่า
'use strict';

let _owned = new Set();   // camera id ที่ edge เป็นเจ้าของ
let _sites = [];          // ไซต์ที่มี edge — เก็บไว้เพื่อ log ตอนค่าเปลี่ยน
let _timer = null;

/**
 * อ่านรายชื่อกล้องที่อยู่ในไซต์ซึ่งมี edge ส่ง heartbeat เข้ามา
 *
 * ⚠️ คีย์ของตาราง `cameras` คือคอลัมน์ **`id`** (varchar) ไม่ใช่ `camera_id`
 * — ชื่อ `camera_id` มีอยู่ใน `cameras-config.json` และตารางอื่น แต่ไม่ใช่ที่นี่
 * เขียนผิดแล้ว query จะ throw แล้วตัวนี้ fail-open เป็น "ไม่กรอง" แบบเงียบ ๆ
 */
async function refreshEdgeOwned(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT c.id AS camera_id, s.code AS site
        FROM cameras c
        JOIN sites s       ON s.id = c.site_id
        JOIN edge_status e ON e.site_id = s.code`);
    const next  = new Set(rows.map((r) => r.camera_id));
    const sites = [...new Set(rows.map((r) => r.site))].sort();
    // log เฉพาะตอนผลเปลี่ยน — ตัวนี้ถูกรีเฟรชทุก 5 นาที ถ้า log ทุกครั้งจะกลบล็อกจริง
    if (next.size !== _owned.size || sites.join() !== _sites.join()) {
      console.log(`  ⏭️  ${next.size} กล้องมี edge ดูแลอยู่แล้ว (${sites.join(', ') || '-'}) `
        + `— central ไม่ต้อง poll เอง`);
    }
    _owned = next;
    _sites = sites;
    return _owned;
  } catch (e) {
    // คงค่าเดิมไว้ ไม่ล้างทิ้ง — DB สะดุดชั่วคราวต้องไม่ทำให้ central กลับไป
    // poll กล้องที่ edge ดูแลอยู่ทั้งหมดพร้อมกัน
    console.warn('  ⚠️  อ่านรายชื่อกล้องที่ edge ดูแลไม่ได้ — ใช้ค่าเดิมต่อ:', e.message);
    return _owned;
  }
}

/** ตัวอ่านแบบ sync — ให้ loader ที่เป็น sync อยู่แล้วเรียกได้โดยไม่ต้องแก้ signature */
function edgeOwnedCameras() {
  return _owned;
}

/** รีเฟรชเป็นระยะ · unref เพื่อไม่ให้ timer นี้กันไม่ให้ process ปิดตัว */
function startEdgeOwnedRefresh(pool, intervalMs = 300_000) {
  if (_timer) return;
  _timer = setInterval(() => { refreshEdgeOwned(pool).catch(() => {}); }, intervalMs);
  _timer.unref?.();
}

/** ใช้ในเทสต์เท่านั้น */
function _reset() {
  _owned = new Set(); _sites = [];
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { refreshEdgeOwned, edgeOwnedCameras, startEdgeOwnedRefresh, _reset };
