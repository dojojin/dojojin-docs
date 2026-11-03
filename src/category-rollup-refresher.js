// ============================================================
// Vigil Platform — event dimension rollup refresher
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เติม `event_dim_bucket` (migration 163) ให้ 3 endpoint ของหน้าสถิติ
// (categories / timeline-by-category / per-camera-counts) ไม่ต้อง join
// event ทุกแถวกับตารางกฎอีก — เหตุผลเต็มอยู่หัวไฟล์ migration 163
//
// วัดจริง 2026-08-19 ก่อนแก้: "รายเดือน" ค้างเกิน 5 นาทีจนกิน pool
// (15.0 ล้าน event × 20 กฎ ≈ 300 ล้านครั้ง)
//
// รูปแบบเดียวกับ `kpi-stats-refresher.js` (migration 144) และ
// `traffic-stats-refresher.js` (142) ที่ใช้ได้ผลแล้ว รวมถึงเหตุผลที่ต้อง
// ย้อนหลังหลายชั่วโมงทุกรอบ ไม่ใช่แค่ช่วงล่าสุด:
//   1. เหตุการณ์เข้าช้าได้จริง (คิว bridge เคยค้าง 4 วันแล้วปล่อยทีเดียว)
//   2. ถัง 30 นาทีปัจจุบันยังไม่จบ ต้องทับซ้ำอยู่แล้ว
// ทับด้วย ON CONFLICT DO UPDATE จึงรันซ้ำกี่รอบก็ได้ค่าเดิม (idempotent)
//
// ⚠️ ต่างจากอีก 2 ตัวตรงที่ **ไม่เก็บ category_id** — เก็บเฉพาะมิติดิบที่กฎใช้
// ตัดสิน แล้วให้ฝั่งอ่านเอาไปเทียบกฎเอง ⇒ เจ้าของแก้กฎหมวดหมู่เมื่อไหร่ ตัวเลข
// ย้อนหลังถูกต้องทันทีโดยไม่ต้อง rebuild (ถ้าเก็บ category_id จะต้อง rebuild
// ทั้งก้อน ~8 นาทีที่ 57 วัน และจะโตตามข้อมูล)
'use strict';

const env = require('./config');
const { serial } = require('./helpers/reconcileQueue');

const REFRESH_MS     = env.int('CAT_ROLLUP_REFRESH_MS');
// รอบแรกหลังบูต — เหลื่อมจาก kpi-stats (45s) ไม่ให้ชนกันที่ pool เดียวกัน
const FIRST_RUN_MS   = env.int('CAT_ROLLUP_FIRST_RUN_MS');
const LOOKBACK_HOURS = env.int('CAT_ROLLUP_LOOKBACK_HOURS');
// เก็บให้ครอบเท่าที่ events ยังอยู่ — ตารางเล็ก (~21k แถว/วัน) จึงไม่มีเหตุผลตัดสั้นกว่า
// ถ้าตัดสั้นกว่า events หน้าสถิติจะได้ 0 เงียบ ๆ ในช่วงที่ยังมี event จริงอยู่
const RETENTION_DAYS = env.int('CAT_ROLLUP_RETENTION_DAYS');
// เก็บตกของที่มาช้าเกิน LOOKBACK_HOURS — วันละครั้ง ทีละวันไทย 7 วันย้อนหลัง (แบบเดียวกับ kpi · GOTCHAS #237/#239)
// เดิมไม่มี: ข้อมูลที่ค้างคิวที่ edge แล้วมาถึงช้าหายจากหน้าสถิติและรายงานถาวร (ตารางนี้เก็บ 400 วัน)
const RECONCILE_HOUR = env.int('CAT_ROLLUP_RECONCILE_HOUR');
const RECONCILE_DAYS = 7;
const RECONCILED_KEY = 'cat_rollup_reconciled_day';

let _pool = null;
let _timer = null;
let _running = false;
let _reconciledDay = null;

// มิติทั้งหมดที่ event_category_rules ใช้ตัดสิน — ถ้าเพิ่มคอลัมน์กฎใหม่
// ต้องเพิ่มที่นี่ + migration + ฝั่งอ่าน (helpers/categoryRollup.js) ให้ครบทั้ง 3 จุด
const DIM_SELECT = `
         date_bin('30 minutes', event_time, TIMESTAMPTZ '2000-01-01') AS bucket,
         camera_id,
         coalesce(rule_name,    '') AS rule_name,
         coalesce(event_type,   '') AS event_type,
         coalesce(object_class, '') AS object_class,
         coalesce(vehicle_type, '') AS vehicle_type,
         coalesce(event_state,  '') AS event_state`;

const UPSERT_TAIL = `
    ON CONFLICT (bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state)
    DO UPDATE SET n = EXCLUDED.n, updated_at = NOW()`;

// รอบปกติ — ย้อนหลัง N ชั่วโมงจากตอนนี้
async function refreshWindow(pool, hoursBack) {
  const sql = `
    INSERT INTO event_dim_bucket
      (bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state, n, updated_at)
    SELECT ${DIM_SELECT}, count(*) AS n, NOW()
      FROM events
     WHERE event_time >= date_bin('30 minutes', NOW() - ($1 || ' hours')::interval, TIMESTAMPTZ '2000-01-01')
       AND camera_id IS NOT NULL
     GROUP BY 1,2,3,4,5,6,7
    ${UPSERT_TAIL}`;
  const t0 = Date.now();
  const r = await pool.query(sql, [String(hoursBack)]);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// เติมย้อนหลังทีละวัน — ใช้ตอนติดตั้งครั้งแรกและตอนกู้ข้อมูลที่ขาด
// แยกเป็นวัน ๆ เพราะยิงทีเดียวทั้งก้อนวัดได้ว่ากิน 8 วินาที/วัน — 57 วันรวดเดียว
// จะถือ connection ยาวเกินไปจนชน statement_timeout 120 วิ ที่เพิ่งตั้งไป
async function backfillDay(pool, dayOffset) {
  const sql = `
    INSERT INTO event_dim_bucket
      (bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state, n, updated_at)
    SELECT ${DIM_SELECT}, count(*) AS n, NOW()
      FROM events
     WHERE event_time >= date_trunc('day', NOW()) - ($1 || ' days')::interval
       AND event_time <  date_trunc('day', NOW()) - (($1::int - 1) || ' days')::interval
       AND camera_id IS NOT NULL
     GROUP BY 1,2,3,4,5,6,7
    ${UPSERT_TAIL}`;
  const t0 = Date.now();
  const r = await pool.query(sql, [String(dayOffset)]);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// ช่วง [since, until) ตรงต้นวันไทย · until = null = ถึงปัจจุบัน · ลบแถวที่รอบนี้ไม่ได้เขียนทับ (ไม่มี event รองรับแล้ว)
// เส้นแบ่งใช้ now() ของ Postgres — เวลาของ Node ใน transaction ทำให้ทุกแถวดูเป็นกำพร้า (บทเรียนจาก kpi 2026-10-25)
async function refreshRange(pool, since, until) {
  const t0 = Date.now();
  const { rows: [{ cut }] } = await pool.query('SELECT now() AS cut');
  const args = [since.toISOString(), until ? until.toISOString() : null];
  const r = await pool.query(`
    INSERT INTO event_dim_bucket
      (bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state, n, updated_at)
    SELECT ${DIM_SELECT}, count(*) AS n, NOW()
      FROM events
     WHERE event_time >= $1::timestamptz AND ($2::timestamptz IS NULL OR event_time < $2::timestamptz)
       AND camera_id IS NOT NULL
     GROUP BY 1,2,3,4,5,6,7
    ${UPSERT_TAIL}`, args);
  const d = await pool.query(`DELETE FROM event_dim_bucket
     WHERE bucket >= $1::timestamptz AND ($2::timestamptz IS NULL OR bucket < $2::timestamptz) AND updated_at < $3::timestamptz`,
    [...args, cut]);
  return { rows: r.rowCount, orphans: d.rowCount, ms: Date.now() - t0 };
}

async function reconcile(pool) {
  const { thaiDayWindows } = require('./traffic-stats-refresher');
  const out = { rows: 0, orphans: 0, ms: 0, failed: 0, days: 0 };
  for (const [since, until, d] of thaiDayWindows(RECONCILE_DAYS)) {
    out.days++;
    try { const r = await refreshRange(pool, since, until); out.rows += r.rows; out.orphans += r.orphans; out.ms += r.ms; }
    catch (e) { out.failed++; console.warn(`[cat-rollup] reconcile วันที่ -${d} ล้ม: ${e.message}`); }
  }
  return out;
}

async function loadReconciledDay(pool) {
  try {
    const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [RECONCILED_KEY]);
    if (rows[0]?.value) _reconciledDay = String(rows[0].value);
  } catch (e) { console.warn(`[cat-rollup] อ่าน ${RECONCILED_KEY} ไม่ได้: ${e.message}`); }
  return _reconciledDay;
}

async function saveReconciledDay(pool, day) {
  _reconciledDay = day;   // ก่อน await — upsert ล้มต้องไม่ลากงาน 7 วันมาทำซ้ำทุก 5 นาที
  try {
    await pool.query(`INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RECONCILED_KEY, day, 'วันที่ (เวลาไทย) ที่ reconcile ของ event_dim_bucket ทำไปแล้ว — กัน restart ลากงานซ้ำ']);
  } catch (e) { console.warn(`[cat-rollup] เขียน ${RECONCILED_KEY} ไม่ได้: ${e.message}`); }
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
    `DELETE FROM event_dim_bucket WHERE bucket < NOW() - ($1 || ' days')::interval`,
    [String(RETENTION_DAYS)]);
  return r.rowCount;
}

// pool ส่งเข้ามาได้ (ตัวจัดคิว src/jobs/rollups.js เป็นคนส่ง) — ถ้าไม่ส่งก็ใช้ตัวที่
// start() เก็บไว้เหมือนเดิม · คืนผลของรอบนี้ให้ผู้เรียกบันทึกสถานะได้ ไม่ใช่กลืนเงียบ
async function tick(pool) {
  if (pool) _pool = pool;
  if (_running) return { skipped: 'running' };   // รอบก่อนยังไม่จบ (เช่นตอน backfill) — ข้ามไป
  _running = true;
  try {
    const { rows, ms } = await refreshWindow(_pool, LOOKBACK_HOURS);
    let reconciled = null;
    const day = await dueForReconcile(_pool);
    if (day) {
      await saveReconciledDay(_pool, day);
      reconciled = await serial(() => reconcile(_pool));
      console.log(`[cat-rollup] reconcile ${reconciled.days} วัน: ${reconciled.rows} row(s) in ${reconciled.ms}ms`
        + (reconciled.orphans ? ` · swept ${reconciled.orphans}` : '')
        + (reconciled.failed ? ` · ⚠️ ${reconciled.failed}/${reconciled.days} วันล้ม` : ''));
      const y = require('./traffic-stats-refresher').thaiDayWindows(1).find((w) => w[2] === 1);
      if (y) await require('./helpers/rollupCheck').run(_pool, 'event_dim_bucket', y[0], y[1]);
    }
    const pruned = await prune(_pool);
    if (rows || pruned) {
      console.log(`[cat-rollup] refreshed ${rows} row(s) in ${ms}ms`
        + (pruned ? ` · pruned ${pruned} old row(s)` : ''));
    }
    return { rows, pruned, ms, reconciled };
  } catch (e) {
    // หน้าจอยังอ่านช่วงที่มีอยู่ได้ ไม่ต้องล้ม process เพราะ refresh รอบเดียวพลาด
    console.error('[cat-rollup] refresh failed:', e.message);
    return { error: e.message };
  } finally {
    _running = false;
  }
}

// ⚠️ ตั้งแต่ 2026-09-07 ตัวจัดคิวคือ `src/jobs/rollups.js` — api-server ไม่เรียก
// start() ตัวนี้แล้ว คงไว้เพื่อไม่ให้ public API เปลี่ยน · เรียกซ้ำ = ได้ timer คู่ที่สอง
function start(pool) {
  if (_timer) return;
  _pool = pool;
  setTimeout(tick, FIRST_RUN_MS).unref?.();   // เว้นจังหวะให้ api-server บูตเสร็จก่อน
  _timer = setInterval(tick, REFRESH_MS);
  _timer.unref?.();
  console.log(`[cat-rollup] refresher started (ทุก ${REFRESH_MS / 60000} นาที, ย้อนหลัง ${LOOKBACK_HOURS} ชม.)`);
}

module.exports = {
  start, tick, refreshWindow, refreshRange, reconcile, backfillDay, prune,
  loadReconciledDay, saveReconciledDay, dueForReconcile,
  REFRESH_MS, LOOKBACK_HOURS, RETENTION_DAYS, RECONCILE_HOUR, RECONCILE_DAYS, RECONCILED_KEY,
};
