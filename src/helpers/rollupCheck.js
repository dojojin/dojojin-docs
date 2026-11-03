// ============================================================
// Vigil Platform — ตารางสรุปเทียบกับนับดิบ (ตรวจหลัง reconcile ทุกเช้า · perfWatch เป็นคนเตือน)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา (GOTCHAS #237): event_kpi_hourly ขาดถาวร 26,301 แถวใน 23 ต.ค. (2.7% ของวัน) โดยไม่มีอะไรบอกเลย —
// เจอเพราะบังเอิญเทียบตอนแก้ heatmap · ตารางสรุปทุกตัวต้องมีตัวเทียบกับนับดิบ ไม่งั้นขาดเงียบไปจนหมดอายุตาราง
//
// ตรวจ "เมื่อวาน" ทันทีหลัง reconcile ของตารางนั้นจบ (ข้อมูลเพิ่งถูกอ่าน — cache อุ่น) · ถ้ายังต่างหลัง reconcile
// แปลว่าตัวเก็บตกไม่ทำงาน ไม่ใช่แค่ของมาช้า · ผลเก็บใน system_settings.rollup_check ให้ perfWatch 18:25 ตัดสิน
// นิยาม "นับดิบ" ต้องตรงกับ SQL ที่เติมตารางนั้นทุกตัวอักษร (kpi-stats-refresher / traffic-stats-refresher)
// ============================================================
'use strict';

const { METRIC_EVENT_FILTER } = require('../constants');

const KEY = 'rollup_check';
const CHECKS = {
  event_kpi_hourly: {
    raw: `SELECT count(*)::bigint AS n FROM events
           WHERE event_time >= $1 AND event_time < $2 AND camera_id IS NOT NULL AND ${METRIC_EVENT_FILTER}`,
    rollup: 'SELECT COALESCE(sum(n_total), 0)::bigint AS n FROM event_kpi_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2',
  },
  event_dim_bucket: {   // ทุกประเภทรวม Aggregation (ตารางนี้ไม่กรอง) · camera_id ไม่ว่าง — ตรงกับ category-rollup-refresher
    raw: 'SELECT count(*)::bigint AS n FROM events WHERE event_time >= $1 AND event_time < $2 AND camera_id IS NOT NULL',
    rollup: 'SELECT COALESCE(sum(n), 0)::bigint AS n FROM event_dim_bucket WHERE bucket >= $1 AND bucket < $2',
  },
  appearance_dim_hourly: {   // ทุกแถว appearances = dim 'all' หนึ่งครั้ง — ตรงกับ appearance-rollup-refresher
    raw: 'SELECT count(*)::bigint AS n FROM appearances WHERE event_time >= $1 AND event_time < $2',
    rollup: "SELECT COALESCE(sum(n), 0)::bigint AS n FROM appearance_dim_hourly WHERE dim = 'all' AND bucket_hour >= $1 AND bucket_hour < $2",
  },
  lpr_hourly_stats: {
    raw: 'SELECT count(*)::bigint AS n FROM license_plates WHERE detected_at >= $1 AND detected_at < $2',
    rollup: 'SELECT COALESCE(sum(n_total), 0)::bigint AS n FROM lpr_hourly_stats WHERE bucket_hour >= $1 AND bucket_hour < $2',
  },
};

/** นับดิบกับผลรวมของตารางสรุปช่วง [since, until) แล้วบันทึกลง rollup_check · ไม่ throw (ตัวตรวจล้มต้องไม่ทำให้งานหลักล้ม) */
async function run(pool, table, since, until) {
  const c = CHECKS[table];
  if (!c) throw new Error(`rollupCheck: ไม่รู้จักตาราง ${table}`);
  try {
    const args = [since.toISOString(), until.toISOString()];
    const raw = Number((await pool.query(c.raw, args)).rows[0].n);
    const rollup = Number((await pool.query(c.rollup, args)).rows[0].n);
    const day = new Date(since.getTime() + 7 * 3600_000).toISOString().slice(0, 10);   // วันไทยของช่วงนี้
    const result = { day, raw, rollup, checked_at: new Date().toISOString() };
    const prev = await pool.query('SELECT value FROM system_settings WHERE key = $1', [KEY]);
    let all = {}; try { all = JSON.parse(prev.rows[0]?.value || '{}'); } catch { /* ค่าเสีย = เริ่มใหม่ */ }
    all[table] = result;
    await pool.query(`INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(all), 'ตารางสรุปเทียบกับนับดิบของเมื่อวาน (helpers/rollupCheck.js) — perfWatch 18:25 อ่านไปตัดสิน']);
    if (raw !== rollup) console.warn(`[rollup-check] ${table} ${day}: นับดิบ ${raw} · ตารางสรุป ${rollup} (ต่าง ${raw - rollup})`);
    return result;
  } catch (e) {
    console.warn(`[rollup-check] ${table} ล้ม: ${e.message}`);
    return null;
  }
}

/**
 * event ที่ reconcile ของ event_kpi_hourly ต้องเติมเพิ่มต่อกล้อง (มาถึงช้าเกินรอบ refresh ปกติ) — เก็บเฉพาะที่เกิน minAdded
 * ไว้ใน rollup_check._late ให้ perfWatch เตือนรายกล้อง · ข้อมูลค้างที่ edge หลายชั่วโมงแล้วค่อยมา = กล้อง/สาย bridge มีปัญหา
 */
async function recordLate(pool, late, { minAdded = 1000 } = {}) {
  try {
    const items = (late || []).filter((x) => x.added >= minAdded).slice(0, 10);
    const prev = await pool.query('SELECT value FROM system_settings WHERE key = $1', [KEY]);
    let all = {}; try { all = JSON.parse(prev.rows[0]?.value || '{}'); } catch { /* ค่าเสีย = เริ่มใหม่ */ }
    all._late = { checked_at: new Date().toISOString(), items };
    await pool.query(`INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [KEY, JSON.stringify(all), 'ตารางสรุปเทียบกับนับดิบของเมื่อวาน (helpers/rollupCheck.js) — perfWatch 18:25 อ่านไปตัดสิน']);
    for (const x of items) console.warn(`[rollup-check] ${x.camera_id} ${x.day}: ข้อมูลมาถึงช้าเกิน 3 ชม. ${x.added} event`);
    return items;
  } catch (e) { console.warn(`[rollup-check] บันทึกข้อมูลมาช้าไม่ได้: ${e.message}`); return null; }
}

/**
 * สำหรับ perfWatch: ตารางไหนต่างเกินเกณฑ์ หรือไม่ได้ตรวจมานานเกิน (ตัวตรวจหยุด)
 * @param {object} all ค่าใน system_settings.rollup_check
 * @param {string} yesterday วันไทย YYYY-MM-DD ที่ควรถูกตรวจแล้ว
 */
function judge(all, yesterday, { minRows = 100, ratio = 0.001 } = {}) {
  const out = [];
  for (const [table, r] of Object.entries(all || {})) {
    if (table.startsWith('_') || !r || !r.day) continue;
    if (r.day < yesterday) { out.push({ table, why: 'stale', day: r.day }); continue; }
    const diff = r.raw - r.rollup;
    if (Math.abs(diff) > Math.max(minRows, r.raw * ratio)) out.push({ table, why: 'diff', day: r.day, raw: r.raw, rollup: r.rollup, diff });
  }
  return out;
}

/** สำหรับ perfWatch: กล้องที่ข้อมูลมาถึงช้า จากรอบเก็บตกล่าสุด (ไม่เกิน 2 วัน) */
function judgeLate(all, now = Date.now()) {
  const l = all && all._late;
  if (!l || !l.checked_at || now - Date.parse(l.checked_at) > 2 * 86400_000) return [];
  return l.items || [];
}

module.exports = { run, recordLate, judge, judgeLate, CHECKS, KEY };
