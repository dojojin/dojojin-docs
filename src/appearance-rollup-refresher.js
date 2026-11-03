// ============================================================
// Vigil Platform — appearance dimension rollup refresher
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เติม `appearance_dim_hourly` (migration 282) ให้ /api/appearances/stats ไม่ต้องอ่าน appearances ทุกแถว
// เหตุผลเต็มอยู่หัวไฟล์ migration 282 (7 วันทุกไซต์ 3.9 วิ แม้ cache อุ่น · ต้นทุน = 1.37 ล้านแถวที่อ่าน)
//
// รูปแบบเดียวกับ `category-rollup-refresher.js`: ทุกรอบคำนวณ LOOKBACK ชั่วโมงล่าสุดซ้ำ (ของมาช้า + ชั่วโมงปัจจุบัน
// ยังไม่จบ) ด้วย ON CONFLICT DO UPDATE · วันละครั้งเก็บตก 7 วันไทยย้อนหลังทีละวัน (ลบแถวที่ไม่มีข้อมูลรองรับแล้ว)
// · ตรวจ "เมื่อวาน" กับนับดิบหลังเก็บตก (helpers/rollupCheck.js · perfWatch เตือน)
//
// ⚠️ ทุกมิติมาจากการอ่าน appearances **รอบเดียว** — แตกแถวเป็นมิติด้วย CROSS JOIN LATERAL (VALUES …) แล้วรวมครั้งเดียว
//    (ไม่ใช่ UNION ALL ทีละมิติ ซึ่งจะอ่านตารางซ้ำ 18 รอบ) · ค่า NULL ของมิติไหนถูกตัดทิ้งที่ WHERE ตามคิวรีเดิม
// ⚠️ เพิ่ม/แก้มิติ ต้องแก้ 3 จุดพร้อมกัน: DIM_VALUES ที่นี่ · หัว migration 282 · ฝั่งอ่านใน routes/appearances.js
'use strict';

const env = require('./config');
const { serial } = require('./helpers/reconcileQueue');

const REFRESH_MS     = env.int('APP_ROLLUP_REFRESH_MS');
const FIRST_RUN_MS   = env.int('APP_ROLLUP_FIRST_RUN_MS');
const LOOKBACK_HOURS = env.int('APP_ROLLUP_LOOKBACK_HOURS');
// หน้าสถิติเลือกได้ไม่เกิน 31 วัน (APP_STATS_MAX_DAYS) · ข้อมูลดิบเก็บ 40 วัน (appearances_retention_days) ⇒ 45 พอ
const RETENTION_DAYS = env.int('APP_ROLLUP_RETENTION_DAYS');
const RECONCILE_HOUR = env.int('APP_ROLLUP_RECONCILE_HOUR');
const RECONCILE_DAYS = 7;
const RECONCILED_KEY = 'app_rollup_reconciled_day';

let _pool = null;
let _timer = null;
let _running = false;
let _reconciledDay = null;

// มิติทั้งหมด — ต้องตรงกับคิวรีเดิมของ routes/appearances.js (เงื่อนไข flag ตรงกับ accessories ทุกตัว)
const DIM_VALUES = `
    ('all', ''),
    ('gender', a.gender),
    ('top', a.top_category),
    ('bottom', a.bottom_category),
    ('color', CASE WHEN a.upper_color IS NOT NULL OR a.lower_color IS NOT NULL
                   THEN json_build_array(a.upper_color, a.lower_color)::text END),
    ('hair_color', a.hair_color),
    ('hair_length', a.hair_length),
    ('age', COALESCE(a.age_group, a.rj_age_group)),
    ('expr', a.rj_expression),
    ('dir', a.attributes->>'direction'),
    ('flag', CASE WHEN a.bag_category IS NOT NULL THEN 'bag' END),
    ('flag', CASE WHEN a.bag_category = 'Backpack' THEN 'backpack' END),
    ('flag', CASE WHEN a.bag_category = 'ShoulderBag' THEN 'shoulder' END),
    ('flag', CASE WHEN a.glasses = true THEN 'glasses' END),
    ('flag', CASE WHEN a.helmet_wear = true THEN 'helmet' END),
    ('flag', CASE WHEN a.rj_mask = 'yes' THEN 'mask' END),
    ('flag', CASE WHEN a.rj_hat = 'yes' THEN 'hat' END)`;

// SELECT ส่วนกลาง — where คือเงื่อนไขบนแถว appearances a (ช่วงเวลา + ตัวกรองถ้ามี)
// withUpdatedAt=false = รูปเดียวกับแถวของตาราง (ไม่มีคอลัมน์ updated_at) — routes/appearances.js ใช้อ่านชั่วโมงหัว/ท้ายจากข้อมูลดิบ
const selectSql = (where, { withUpdatedAt = true } = {}) => `
    SELECT date_trunc('hour', a.event_time) AS bucket_hour,
           COALESCE(a.camera_id, '') AS camera_id,
           COALESCE(a.object_class, 'unknown') AS object_class,
           d.dim, d.value, count(*)::int AS n${withUpdatedAt ? ', NOW()' : ''}
      FROM appearances a
     CROSS JOIN LATERAL (VALUES ${DIM_VALUES}) AS d(dim, value)
     WHERE ${where} AND d.value IS NOT NULL
     GROUP BY 1, 2, 3, 4, 5`;

const UPSERT = (where) => `
    INSERT INTO appearance_dim_hourly (bucket_hour, camera_id, object_class, dim, value, n, updated_at)
    ${selectSql(where)}
    ON CONFLICT (bucket_hour, camera_id, object_class, dim, value)
    DO UPDATE SET n = EXCLUDED.n, updated_at = NOW()`;

// รอบปกติ — ย้อนหลัง N ชั่วโมงจากต้นชั่วโมงปัจจุบัน
async function refreshWindow(pool, hoursBack) {
  const t0 = Date.now();
  const r = await pool.query(UPSERT(`a.event_time >= date_trunc('hour', NOW()) - ($1 || ' hours')::interval`), [String(hoursBack)]);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// ช่วง [since, until) · until = null = ถึงปัจจุบัน · ลบแถวที่รอบนี้ไม่ได้เขียนทับ (ไม่มีข้อมูลรองรับแล้ว)
// เส้นแบ่งใช้ now() ของ Postgres — เวลาของ Node ทำให้ทุกแถวดูเป็นกำพร้า (บทเรียนจาก kpi 2026-10-25)
// ใช้ทั้งตอนเก็บตกและตอนเติมย้อนหลังครั้งแรก (ทีละวัน — ไม่ถือ transaction ยาว)
async function refreshRange(pool, since, until) {
  const t0 = Date.now();
  const { rows: [{ cut }] } = await pool.query('SELECT now() AS cut');
  const args = [since.toISOString(), until ? until.toISOString() : null];
  const r = await pool.query(UPSERT(`a.event_time >= $1::timestamptz AND ($2::timestamptz IS NULL OR a.event_time < $2::timestamptz)`), args);
  const d = await pool.query(`DELETE FROM appearance_dim_hourly
     WHERE bucket_hour >= $1::timestamptz AND ($2::timestamptz IS NULL OR bucket_hour < $2::timestamptz) AND updated_at < $3::timestamptz`,
    [...args, cut]);
  return { rows: r.rowCount, orphans: d.rowCount, ms: Date.now() - t0 };
}

async function reconcile(pool) {
  const { thaiDayWindows } = require('./traffic-stats-refresher');
  const out = { rows: 0, orphans: 0, ms: 0, failed: 0, days: 0 };
  for (const [since, until, d] of thaiDayWindows(RECONCILE_DAYS)) {
    out.days++;
    try { const r = await refreshRange(pool, since, until); out.rows += r.rows; out.orphans += r.orphans; out.ms += r.ms; }
    catch (e) { out.failed++; console.warn(`[app-rollup] reconcile วันที่ -${d} ล้ม: ${e.message}`); }
  }
  return out;
}

async function loadReconciledDay(pool) {
  try {
    const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [RECONCILED_KEY]);
    if (rows[0]?.value) _reconciledDay = String(rows[0].value);
  } catch (e) { console.warn(`[app-rollup] อ่าน ${RECONCILED_KEY} ไม่ได้: ${e.message}`); }
  return _reconciledDay;
}

async function saveReconciledDay(pool, day) {
  _reconciledDay = day;   // ก่อน await — upsert ล้มต้องไม่ลากงาน 7 วันมาทำซ้ำทุก 5 นาที
  try {
    await pool.query(`INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RECONCILED_KEY, day, 'วันที่ (เวลาไทย) ที่ reconcile ของ appearance_dim_hourly ทำไปแล้ว — กัน restart ลากงานซ้ำ']);
  } catch (e) { console.warn(`[app-rollup] เขียน ${RECONCILED_KEY} ไม่ได้: ${e.message}`); }
}

async function dueForReconcile(pool) {
  const { rows } = await pool.query(
    `SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS d,
            extract(hour FROM now() AT TIME ZONE 'Asia/Bangkok')::int AS h`);
  if (!rows[0]) return null;
  const { d, h } = rows[0];
  return h === RECONCILE_HOUR && _reconciledDay !== d ? d : null;
}

async function prune(pool) {
  const r = await pool.query(
    `DELETE FROM appearance_dim_hourly WHERE bucket_hour < NOW() - ($1 || ' days')::interval`, [String(RETENTION_DAYS)]);
  return r.rowCount;
}

// pool ส่งเข้ามาจากตัวจัดคิว src/jobs/rollups.js · คืนผลของรอบนี้ให้ผู้เรียกบันทึกสถานะ
async function tick(pool) {
  if (pool) _pool = pool;
  if (_running) return { skipped: 'running' };
  _running = true;
  try {
    const { rows, ms } = await refreshWindow(_pool, LOOKBACK_HOURS);
    let reconciled = null;
    const day = await dueForReconcile(_pool);
    if (day) {
      await saveReconciledDay(_pool, day);
      reconciled = await serial(() => reconcile(_pool));
      console.log(`[app-rollup] reconcile ${reconciled.days} วัน: ${reconciled.rows} row(s) in ${reconciled.ms}ms`
        + (reconciled.orphans ? ` · swept ${reconciled.orphans}` : '')
        + (reconciled.failed ? ` · ⚠️ ${reconciled.failed}/${reconciled.days} วันล้ม` : ''));
      const y = require('./traffic-stats-refresher').thaiDayWindows(1).find((w) => w[2] === 1);
      if (y) await require('./helpers/rollupCheck').run(_pool, 'appearance_dim_hourly', y[0], y[1]);
    }
    const pruned = await prune(_pool);
    if (rows || pruned) console.log(`[app-rollup] refreshed ${rows} row(s) in ${ms}ms` + (pruned ? ` · pruned ${pruned} old row(s)` : ''));
    return { rows, pruned, ms, reconciled };
  } catch (e) {
    console.error('[app-rollup] refresh failed:', e.message);
    return { error: e.message };
  } finally {
    _running = false;
  }
}

module.exports = {
  tick, refreshWindow, refreshRange, reconcile, prune, selectSql,
  loadReconciledDay, saveReconciledDay, dueForReconcile,
  REFRESH_MS, FIRST_RUN_MS, LOOKBACK_HOURS, RETENTION_DAYS, RECONCILE_HOUR, RECONCILE_DAYS, RECONCILED_KEY,
};
