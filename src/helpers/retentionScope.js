// ============================================================
// Vigil Platform — Helper: retentionScope (site freeze)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ไซต์ที่ sites.status <> 'active' (migration 285) = "แช่แข็ง" — งาน retention/purge
// ทุกตัวห้ามลบหรือเขียนทับข้อมูลของมัน (แถวใน DB และไฟล์ภาพ)
//
// ต่างจาก siteStatus.quietSiteCodes โดยตั้งใจ: ตัวนั้น cache 30 วิ และ query ล้ม = Set ว่าง
// (แจ้งเตือนทำงานต่อ) ซึ่งถ้าใช้กับงานลบ = "ไม่รู้ว่าใครแช่แข็ง ก็ลบทุกคน"
// ตัวนี้อ่านสดทุกครั้ง และ query ล้ม = โยน → ผู้เรียกต้องไม่ลบอะไรเลย (fail closed)
// ============================================================
'use strict';

/**
 * @returns {Promise<{ frozenCams: string[], frozenSiteCodes: string[], liveCams: string[] }>}
 *   liveCams = กล้องของไซต์ active หรือไม่มีไซต์ (site_id NULL)
 */
async function frozenScope(pool) {
  try {
    const sites = await pool.query(`SELECT code FROM sites WHERE status <> 'active'`);
    const cams = await pool.query(
      `SELECT c.id, (s.status IS NOT NULL AND s.status <> 'active') AS frozen
         FROM cameras c LEFT JOIN sites s ON s.id = c.site_id`);
    const frozenCams = [], liveCams = [];
    for (const r of cams.rows) (r.frozen ? frozenCams : liveCams).push(String(r.id));
    return { frozenCams, frozenSiteCodes: sites.rows.map(r => r.code), liveCams };
  } catch (e) {
    console.error('[retention-scope] 🔴 อ่านสถานะไซต์ไม่ได้ — งานลบรอบนี้หยุด (ไม่รู้ว่าไซต์ไหนปิดปรับปรุง):', e.message);
    throw e;
  }
}

// โหมดรายกล้อง (ใช้เฉพาะตอนมีไซต์แช่แข็ง) — ไซต์ที่แช่แข็งอาจถือแถวที่เก่าที่สุดเป็นล้าน
// (RMUTR-V 6.2M events) ถ้าใช้ `ORDER BY event_time LIMIT n AND camera_id <> ALL(frozen)`
// ทุก batch จะต้องไล่ข้ามหัวตารางของไซต์นั้นใหม่ทั้งก้อน (heap fetch ทีละแถว) ⇒ วนทีละกล้อง
// ที่ยังเปิดอยู่ให้ index (camera_id, event_time) ทำงาน + รอบ camera_id IS NULL (cam = null)
// select(cam) → id[] · apply(ids) → จำนวนที่ลบ/แก้ · หน่วง 100 ms ระหว่าง batch เหมือนลูปเดิม
async function eachCameraBatch(cams, { batch, select, apply, includeNull = true }) {
  let total = 0;
  for (const cam of includeNull ? [...cams, null] : cams) {
    let n;
    do {
      const ids = await select(cam);
      n = ids.length;
      if (!n) break;
      total += await apply(ids);
      if (n === batch) await new Promise(r => setTimeout(r, 100));
    } while (n === batch);
  }
  return total;
}

// `camera_id = $k` หรือ `camera_id IS NULL` (รอบท้ายของ eachCameraBatch) — คืน [where, params]
function camClause(cam, params, col = 'camera_id') {
  if (cam == null) return [`${col} IS NULL`, params];
  return [`${col} = $${params.length + 1}`, [...params, cam]];
}

module.exports = { frozenScope, eachCameraBatch, camClause };
