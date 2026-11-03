// ============================================================
// Vigil Platform — KPI hourly stats refresher
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เติม `event_kpi_hourly` (migration 144) ให้หน้าสรุปไม่ต้องสแกน events ทุกครั้ง
// วัดจริง 2026-08-12: KPI query เดิมสแกน ~1.6 ล้านแถว ใช้ 3.3-6.1 วินาที และลากหน้าอื่นช้าตาม
//
// รูปแบบเดียวกับ `traffic-stats-refresher.js` (migration 142) ที่ใช้ได้ผลแล้ว —
// รวมถึงเหตุผลที่ต้องย้อนหลังหลายชั่วโมงทุกรอบ ไม่ใช่แค่ชั่วโมงล่าสุด:
//   1. เหตุการณ์เข้าช้าได้จริง (คิว bridge เคยค้าง 4 วันแล้วปล่อยทีเดียว)
//   2. ชั่วโมงปัจจุบันยังไม่จบ ต้องทับซ้ำอยู่แล้ว
// ทับด้วย ON CONFLICT DO UPDATE จึงรันซ้ำกี่รอบก็ได้ค่าเดิม (idempotent)
//
// ⚠️ เงื่อนไขการนับต้องตรงกับที่ `stats-summary-route.js` เคยใช้เป๊ะ ไม่งั้นตัวเลข KPI
// จะเปลี่ยนไปเงียบๆ ตอนสลับมาอ่านตารางนี้ — ชุดคำที่ใช้จึงคัดลอกมาตรงตัวและมีเทสต์เทียบ
'use strict';

const { METRIC_EVENT_FILTER } = require('./constants');
const env = require('./config');
const { serial } = require('./helpers/reconcileQueue');

const REFRESH_MS     = env.int('KPI_STATS_REFRESH_MS');
// รอบแรกหลังบูต — ทุก refresher ถูกจัดคิวเหลื่อมกันไม่ให้ชน (ดูตารางใน src/jobs/rollups.js):
// kpi 45s · cat-rollup 90s · traffic 135s · LPR warm 180s
const FIRST_RUN_MS   = env.int('KPI_STATS_FIRST_RUN_MS');
const LOOKBACK_HOURS = env.int('KPI_STATS_LOOKBACK_HOURS');
// เก็บสั้นได้ — หน้าสรุปใช้แค่ "วันนี้ vs เมื่อวาน" · เผื่อไว้ 7 วันสำหรับ backfill/ตรวจย้อนหลัง
const RETENTION_DAYS = env.int('KPI_STATS_RETENTION_DAYS');
// เก็บตกของที่มาช้าเกิน LOOKBACK_HOURS — วันละครั้ง ทีละวันไทยย้อนหลังเท่าอายุตาราง (GOTCHAS #237)
// เดิมไม่มีเลย: กล้อง C9-KAR-SB-04 ข้อมูลค้างที่ edge 22 ต.ค. 14:49 – 24 ต.ค. 14:00 แล้วค่อยถูกส่งมา
// ⇒ ตารางสรุปขาดถาวร 23 ต.ค. 26,301 (2.7% ของวัน) · 24 ต.ค. 15,959 · 22 ต.ค. 8,789 · 19 ต.ค. 7,749 (C40-THL-SB-18)
// ต้นทุนวัด 2026-10-25: วันละ ~22 วิ (ไม่ใกล้ statement_timeout 120 วิ) · 7 วัน ~2.5 นาที
// 05:00 ตามกฎ "งานหนักบน central เริ่มหลัง backup จบ" (GOTCHAS #191) แบบเดียวกับ traffic reconcile
const RECONCILE_HOUR = env.int('KPI_STATS_RECONCILE_HOUR');
const RECONCILED_KEY = 'kpi_stats_reconciled_day';

// ⚠️ เคยก๊อบรายชื่อไว้เองตรงนี้ แล้วตกคำว่า 'Pickup' ไป — n_traffic เลยนับรถขาด
//    ~7% ทุกชั่วโมง (Pickup มาจาก anprAlarm หลักแสนต่อ 2 วัน) คอมเมนต์เดิมเขียนว่า
//    "เทสต์จะจับให้" แต่ไม่เคยมีเทสต์นั้นอยู่จริง · ตอนนี้ดึงจากแหล่งเดียวแล้ว
const { VEHICLE_CLASSES, PERSON_CLASSES } = require('./helpers/objectClassGroup');
const TRAFFIC_CLASSES = VEHICLE_CLASSES;
const PEOPLE_CLASSES  = PERSON_CLASSES;
const FACE_TYPES      = ['FaceCapture', 'FaceDetector/Recognized'];

let _pool = null;
let _timer = null;
let _running = false;
let _reconciledDay = null;   // วันไทยที่ reconcile แล้ว · sync กับ system_settings กัน restart ลากงานซ้ำ

const upsertSql = (where) => `
    INSERT INTO event_kpi_hourly
      (camera_id, bucket_hour, event_type, n_total, n_alerts, n_traffic, n_people, n_faces, updated_at)
    SELECT camera_id,
           date_trunc('hour', event_time)                                   AS bucket_hour,
           coalesce(event_type, '')                                         AS event_type,
           count(*)                                                         AS n_total,
           count(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name <> '') AS n_alerts,
           count(*) FILTER (WHERE object_class = ANY($2))                   AS n_traffic,
           count(*) FILTER (WHERE object_class = ANY($3))                   AS n_people,
           count(*) FILTER (WHERE event_type   = ANY($4))                   AS n_faces,
           NOW()
      FROM events
     WHERE ${where}
       AND camera_id IS NOT NULL
       AND ${METRIC_EVENT_FILTER}
     GROUP BY 1, 2, 3
    ON CONFLICT (camera_id, bucket_hour, event_type) DO UPDATE
       SET n_total    = EXCLUDED.n_total,
           n_alerts   = EXCLUDED.n_alerts,
           n_traffic  = EXCLUDED.n_traffic,
           n_people   = EXCLUDED.n_people,
           n_faces    = EXCLUDED.n_faces,
           updated_at = NOW()`;

async function refreshWindow(pool, hoursBack) {
  const t0 = Date.now();
  const r = await pool.query(upsertSql(`event_time >= date_trunc('hour', NOW() - ($1 || ' hours')::interval)`),
    [String(hoursBack), TRAFFIC_CLASSES, PEOPLE_CLASSES, FACE_TYPES]);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// ช่วง [since, until) — ขอบตรงต้นชั่วโมง (ต้นวันไทย = 17:00 UTC) · until = null = ถึงปัจจุบัน
// แล้วลบแถวในช่วงเดียวกันที่รอบนี้ไม่ได้เขียนทับ (ไม่มี event รองรับแล้ว) — ตรรกะเดียวกับ sweepOrphans
async function refreshRange(pool, since, until) {
  const t0 = new Date();
  // เส้นแบ่ง "แถวที่รอบนี้เขียนทับ" ต้องเป็นนาฬิกาเดียวกับ updated_at = NOW() ของ Postgres — ใช้เวลาของ Node ไม่ได้:
  // ใน transaction NOW() คือเวลาเริ่ม transaction ซึ่งเก่ากว่า ⇒ ทุกแถวดูเป็นกำพร้าแล้วถูกลบหมด (เจอตอนทดสอบ 2026-10-25)
  const { rows: [{ cut }] } = await pool.query('SELECT now() AS cut');
  const r = await pool.query(upsertSql(`event_time >= $1::timestamptz AND ($5::timestamptz IS NULL OR event_time < $5::timestamptz)`),
    [since.toISOString(), TRAFFIC_CLASSES, PEOPLE_CLASSES, FACE_TYPES, until ? until.toISOString() : null]);
  const d = await pool.query(`DELETE FROM event_kpi_hourly
     WHERE bucket_hour >= $1::timestamptz AND ($2::timestamptz IS NULL OR bucket_hour < $2::timestamptz)
       AND updated_at < $3::timestamptz`, [since.toISOString(), until ? until.toISOString() : null, cut]);
  return { rows: r.rowCount, orphans: d.rowCount, ms: Date.now() - t0 };
}

async function loadReconciledDay(pool) {
  try {
    const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [RECONCILED_KEY]);
    if (rows[0]?.value) _reconciledDay = String(rows[0].value);
  } catch (e) { console.warn(`[kpi-stats] อ่าน ${RECONCILED_KEY} ไม่ได้: ${e.message}`); }
  return _reconciledDay;
}

// เขียนหน่วยความจำก่อน await — upsert ล้มแล้วต้องไม่ลากงาน 7 วันมาทำซ้ำทุก 5 นาที
async function saveReconciledDay(pool, day) {
  _reconciledDay = day;
  try {
    await pool.query(`INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RECONCILED_KEY, day, 'วันที่ (เวลาไทย) ที่ reconcile ของ event_kpi_hourly ทำไปแล้ว — กัน restart ลากงานซ้ำ']);
  } catch (e) { console.warn(`[kpi-stats] เขียน ${RECONCILED_KEY} ไม่ได้: ${e.message}`); }
}

async function dueForReconcile(pool) {
  const { rows } = await pool.query(
    `SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS d,
            extract(hour FROM now() AT TIME ZONE 'Asia/Bangkok')::int AS h`);
  if (!rows[0]) return null;   // ถามเวลาไม่ได้ = ยังไม่ถึงรอบ ไม่ใช่เหตุให้ refresh ปกติล้ม
  const { d, h } = rows[0];
  return h === RECONCILE_HOUR && _reconciledDay !== d ? d : null;
}

// ทีละวันไทยย้อนหลัง (อายุตาราง − 1) วันถึงวันนี้ · วันที่ล้มไม่ลากวันอื่น
// ยอดที่ reconcile "เติมเพิ่ม" ให้แต่ละกล้อง = event ที่มาถึงช้าเกิน LOOKBACK_HOURS (refresher ปกติไม่เคยเห็น)
// ⇒ สัญญาณของข้อมูลค้างคิวที่ edge แล้วค่อยถูกส่งมา (C9-KAR-SB-04 23 ต.ค. 26,301) · อ่านจากตารางสรุปล้วน ไม่สแกน events ซ้ำ
const camSums = async (pool, since, until) => new Map((await pool.query(
  `SELECT camera_id, sum(n_total)::bigint AS n FROM event_kpi_hourly
    WHERE bucket_hour >= $1::timestamptz AND ($2::timestamptz IS NULL OR bucket_hour < $2::timestamptz) GROUP BY 1`,
  [since.toISOString(), until ? until.toISOString() : null])).rows.map((r) => [r.camera_id, Number(r.n)]));

async function reconcile(pool) {
  const { thaiDayWindows } = require('./traffic-stats-refresher');
  const out = { rows: 0, orphans: 0, ms: 0, failed: 0, days: 0, late: [] };
  for (const [since, until, d] of thaiDayWindows(RETENTION_DAYS - 1)) {
    out.days++;
    try {
      const before = d ? await camSums(pool, since, until) : null;   // วันนี้ยังไม่จบ — ไม่นับเป็น "มาช้า"
      const r = await refreshRange(pool, since, until); out.rows += r.rows; out.orphans += r.orphans; out.ms += r.ms;
      if (before) {
        const day = new Date(since.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
        for (const [cam, n] of await camSums(pool, since, until)) {
          const added = n - (before.get(cam) || 0);
          if (added > 0) out.late.push({ day, camera_id: cam, added });
        }
      }
    } catch (e) { out.failed++; console.warn(`[kpi-stats] reconcile วันที่ -${d} ล้ม: ${e.message}`); }
  }
  out.late.sort((a, b) => b.added - a.added);
  return out;
}

// ตาข่ายชั้นสอง — ล้างแถวที่ event ต้นทางหายไปแล้ว
// ต้นตอจริงคือการลบกล้อง ซึ่งแก้ที่ routes/cameras.js แล้ว (ลบแถวสรุปของกล้องนั้นทันที)
// ที่นี่กันกรณีลบ event แบบอื่นที่ยังอยู่ในช่วง lookback
//
// ⚠️ ห้ามเช็คด้วย NOT EXISTS กับตาราง events — วัดจริง 2026-08-21: ทั้งตาราง 35 วินาที
//    เฉพาะช่วง 3 ชม. ก็ยัง 23 วินาที เพราะ event_type ไม่มีดัชนี ทุกแถวต้องไปงม
//    events 23 ล้านแถว · ถ้ารันทุก 5 นาทีคือเผา DB ทิ้งเปล่า ๆ
//
//    ใช้ updated_at แทน: refreshWindow() เพิ่งเขียนทับทุกแถวที่ "ยังมี event จริง"
//    ในช่วงนี้ด้วย NOW() ไปเมื่อกี้ ⇒ แถวไหนในช่วงเดียวกันที่ updated_at ยังเก่ากว่า
//    เวลาที่เริ่มรอบนี้ แปลว่าไม่มี event รองรับแล้ว · แตะแค่ตารางสรุปตารางเดียว
async function sweepOrphans(pool, hoursBack, runStartedAt) {
  const r = await pool.query(`
    DELETE FROM event_kpi_hourly
     WHERE bucket_hour >= date_trunc('hour', NOW() - ($1 || ' hours')::interval)
       AND updated_at < $2::timestamptz`, [String(hoursBack), runStartedAt.toISOString()]);
  return r.rowCount;
}

async function prune(pool) {
  const r = await pool.query(
    `DELETE FROM event_kpi_hourly WHERE bucket_hour < NOW() - ($1 || ' days')::interval`,
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
    // จับเวลาก่อนเริ่ม — ใช้เป็นเส้นแบ่งว่าแถวไหนถูกเขียนทับในรอบนี้บ้าง
    const runStartedAt = new Date();
    const { rows, ms } = await refreshWindow(_pool, LOOKBACK_HOURS);
    const orphans = await sweepOrphans(_pool, LOOKBACK_HOURS, runStartedAt);
    let reconciled = null;
    const day = await dueForReconcile(_pool);
    if (day) {
      await saveReconciledDay(_pool, day);
      reconciled = await serial(() => reconcile(_pool));
      // เทียบเมื่อวานกับนับดิบทันทีหลังเก็บตก — ยังต่าง = ตัวเก็บตกไม่ทำงาน (perfWatch เตือน · helpers/rollupCheck.js)
      const y = require('./traffic-stats-refresher').thaiDayWindows(1).find((w) => w[2] === 1);
      if (y) await require('./helpers/rollupCheck').run(_pool, 'event_kpi_hourly', y[0], y[1]);
      await require('./helpers/rollupCheck').recordLate(_pool, reconciled.late);
      console.log(`[kpi-stats] reconcile ${reconciled.days} วัน: ${reconciled.rows} row(s) in ${reconciled.ms}ms`
        + (reconciled.orphans ? ` · swept ${reconciled.orphans}` : '')
        + (reconciled.failed ? ` · ⚠️ ${reconciled.failed}/${reconciled.days} วันล้ม` : ''));
    }
    const pruned = await prune(_pool);
    if (rows || pruned || orphans) {
      console.log(`[kpi-stats] refreshed ${rows} row(s) in ${ms}ms`
        + (orphans ? ` · swept ${orphans} orphan row(s)` : '')
        + (pruned ? ` · pruned ${pruned} old row(s)` : ''));
    }
    return { rows, orphans, pruned, ms, reconciled };
  } catch (e) {
    // หน้าจอยังอ่านชั่วโมงที่มีอยู่ได้ ไม่ต้องล้ม process เพราะ refresh รอบเดียวพลาด
    console.error('[kpi-stats] refresh failed:', e.message);
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
  console.log(`[kpi-stats] refresher started (ทุก ${REFRESH_MS / 60000} นาที, ย้อนหลัง ${LOOKBACK_HOURS} ชม.)`);
}

module.exports = {
  start, tick, refreshWindow, refreshRange, reconcile, prune, sweepOrphans,
  loadReconciledDay, saveReconciledDay, dueForReconcile,
  REFRESH_MS, LOOKBACK_HOURS, RETENTION_DAYS, RECONCILE_HOUR, RECONCILED_KEY,
  TRAFFIC_CLASSES, PEOPLE_CLASSES, FACE_TYPES,
};
