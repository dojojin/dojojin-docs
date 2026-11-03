// ============================================================
// Vigil Platform — เติมตารางสรุป traffic_hourly_stats
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// อ่าน license_plates แล้วสรุปลง traffic_hourly_stats (ดู migration 142
// สำหรับเหตุผลว่าทำไมต้องมีตารางสรุป — สรุปสั้น ๆ คือ 6 วินาทีต่อ query
// บนตาราง 12.6 ล้านแถว ซึ่งใช้ทำหน้าจอไม่ได้)
//
// รันในตัว api-server เอง ไม่ตั้ง pm2 process ใหม่ — งานนี้เบามาก
// (upsert ไม่กี่พันแถวทุก 15 นาที) การเพิ่ม process ใหม่มีต้นทุนดูแลมากกว่าตัวงาน
//
// 🔴 refresh ย้อนหลัง 3 ชั่วโมงเสมอ ไม่ใช่แค่ชั่วโมงล่าสุด เพราะ:
//   1. เหตุการณ์เข้าช้าได้จริง — คิว bridge เคยค้าง 4 วันแล้วปล่อยทีเดียว
//      (ดู project_edge_bridge_queue) ชั่วโมงที่ปิดไปแล้วจึงยังโตได้อีก
//   2. ชั่วโมงปัจจุบันยังไม่จบ ต้องทับซ้ำอยู่แล้ว
// ทับด้วย ON CONFLICT DO UPDATE จึงรันซ้ำกี่รอบก็ได้ค่าเดิม (idempotent)
// ============================================================
'use strict';

const helmet = require('./helpers/helmetCriteria');
const env = require('./config');
const { serial } = require('./helpers/reconcileQueue');

const REFRESH_MS      = env.int('TRAFFIC_STATS_REFRESH_MS');
// รอบแรกหลังบูต — เหลื่อมจาก cat-rollup (90s) ไม่ให้ชนกันที่ pool เดียวกัน
const FIRST_RUN_MS    = env.int('TRAFFIC_STATS_FIRST_RUN_MS');
const LOOKBACK_HOURS  = env.int('TRAFFIC_STATS_LOOKBACK_HOURS');
const RETENTION_DAYS  = env.int('TRAFFIC_STATS_RETENTION_DAYS');

// 🔴 หน้าต่าง 3 ชม. ด้านบนปิดช่องไม่หมด และช่องที่เหลือ "หายถาวร"
// ชั่วโมงที่พ้น 3 ชม. ไปแล้วจะไม่ถูกคำนวณอีกเลย เหตุการณ์ที่มาช้ากว่านั้นจึงไม่มีวันถูกนับ
// วัดจริง 2026-08-22: วันที่ 08-21 ตารางสรุปมี 61,668 แต่ต้นทางมี 66,926 — หาย 5,258 (7.9%)
//   ทั้งหมดเป็นของภูเก็ตล้วน (hdy หาย 0) และ 10.3% ของแถว hkt วันนั้นถูกแทรกหลังเที่ยงคืน
//   ของวันถัดไป · ผลคือกราฟ 24 ชม. ทำให้ภูเก็ต "ดูดีกว่าจริง" ทุกวันโดยไม่มีใครรู้
// ⇒ วันละครั้งตอนตี 3 คำนวณย้อนหลังทั้งก้อนใหม่ · 7 วันเพราะเคสจริงที่แย่ที่สุดที่เคยเจอ
//   คือคิว bridge ค้าง 4 วันแล้วปล่อยทีเดียว (ดูหัวไฟล์ข้อ 1)
// ต้นทุนวัดแล้ว: 7 วัน = 58,874 bucket จาก 2.17M แถว ใช้ 2.7 วินาที (idx_plates_detected_at,
//   HashAggregate ไม่ spill) — ถูกพอที่จะไม่ต้องแบ่งทำทีละวัน
const RECONCILE_HOURS = env.int('TRAFFIC_STATS_RECONCILE_HOURS');

// 🔴 05:00 ไม่ใช่ 03:00 — ตี 3 ชนกับ backup กลางคืน
// `vigil-backup.timer` ยิง `pg_dump -Fc` ตอน 03:04 ทุกคืน จบราว 04:05 (DB ~100 GB,
// sequential IO หนัก) · reconcile ที่เคยตั้งไว้ตี 3 จึงวิ่งทับ dump เต็ม ๆ
// วัดจริงจาก slow log ของ Postgres 2026-09-06 (คำสั่ง INSERT INTO lpr_hourly_stats
// รายวันของ refreshLprWindow):
//   03:07–03:11 → 95.3 / 48.5 / 25.9 / 25.2 / 23.9 วินาที
//   03:51–03:54 → 59.6 / 43.0 / 25.5 วินาที   (api-server restart 03:48 ดูหมายเหตุ
//                                              ที่ _reconciledDay — รอบนี้คือรันซ้ำ)
// ประมาณการในไฟล์นี้คือ ~24 วินาที/วัน · ใต้ dump มันกลายเป็น 2–4 เท่า และก้อน 95.3
// วินาทีก็จ่อเพดาน statement_timeout 120 วินาทีของ pool อีกรอบ (ประวัติของบั๊กนี้
// อยู่ในหมายเหตุก้อนใหญ่ใน tick() — reconcile เคยล้มทุกคืนเพราะ timeout ตัวนี้)
// ⇒ ย้ายไป 05:00 เวลาไทย: หลัง dump จบ (~04:05) และก่อนรถเริ่มเยอะของวันใหม่
// ดู GOTCHAS #191 — กฎคือ "งานหนักบน central เริ่มหลัง backup จบ ~04:05 หรือก่อน 02:00"
const RECONCILE_HOUR  = env.int('TRAFFIC_STATS_RECONCILE_HOUR');

// system_settings key ที่จำ _reconciledDay ข้าม restart
const RECONCILED_KEY  = 'traffic_stats_reconciled_day';

let _pool = null;
let _timer = null;
let _running = false;
// วันที่ (เวลาไทย) ที่ reconcile ไปแล้ว — กัน tick อื่นในชั่วโมงเดียวกันรันซ้ำ
// ⚠️ เดิมอยู่ในหน่วยความจำล้วน "เพราะ upsert idempotent" ซึ่งจริงเรื่องความถูกต้อง
//    แต่ผิดเรื่องราคา: restart ในชั่วโมง reconcile = รันงานหนักที่สุดของวันซ้ำทั้งก้อน
//    (เกิดจริง 2026-09-06 restart 03:48 → reconcile รอบสองที่ 03:51 ทับ pg_dump อยู่ดี)
// ⇒ ตัวแปรนี้ยังเป็น fast path เหมือนเดิม แต่ sync กับ system_settings ตัว RECONCILED_KEY
let _reconciledDay = null;

// สรุปช่วงเวลาที่กำหนดลงตาราง — ใช้ทั้งตอน refresh ปกติและตอน backfill
// hoursBack ใหญ่ ๆ ใช้ backfill ครั้งแรก · ปกติใช้ค่าเล็ก
// untilHoursBack = ขอบบน (นับถอยหลังจากตอนนี้เหมือน hoursBack) · null = ถึงปัจจุบัน
// มีไว้ให้ backfill แบ่งงานเป็นก้อน — เรียก refreshWindow(720) รวดเดียววัดได้ 29 วินาที
// สแกน 20.5 ล้านแถวบนระบบที่วิ่งอยู่ · แบ่งก้อนละ 7 วันเหลือก้อนละ ~5 วินาที
// (เวลารวมไม่ได้ลดลง แต่ไม่กินบัฟเฟอร์ยาว ๆ ทีเดียว)
async function refreshWindow(pool, hoursBack, untilHoursBack = null) {
  // เกณฑ์อ่านจากผลที่ตรึงไว้ตอน INSERT (migration 234) จึงไม่ต้องอุ่นอะไรก่อนอีก
  // และคำนวณซ้ำกี่รอบก็ได้ค่าเดิมเสมอ ซึ่งคือเหตุผลที่เปลี่ยนมาทางนี้
  const evidence = helmet.evidenceSql('');

  const sql = `
    INSERT INTO traffic_hourly_stats
      (camera_id, bucket_hour, vehicle_type, n_total, n_no_helmet, n_no_helmet_ok,
       n_no_seatbelt, n_riders3, updated_at)
    SELECT camera_id,
           date_trunc('hour', detected_at)              AS bucket_hour,
           coalesce(vehicle_type, 'unknown')            AS vehicle_type,
           count(*)                                     AS n_total,
           count(*) FILTER (WHERE no_helmet)            AS n_no_helmet,
           -- ตัวเลขที่หน้าจอแสดง ("ไม่สวมหมวก · พร้อมข้อมูลทะเบียน")
           -- vehicle_type เป็น key ของ GROUP BY อยู่แล้ว จึงไม่ต้องกรองซ้ำในนี้
           count(*) FILTER (WHERE no_helmet ${evidence}) AS n_no_helmet_ok,
           count(*) FILTER (WHERE no_seatbelt)          AS n_no_seatbelt,
           count(*) FILTER (WHERE rider_count >= 3)     AS n_riders3,
           NOW()
      FROM license_plates
     WHERE detected_at >= date_trunc('hour', NOW() - ($1 || ' hours')::interval)
         ${untilHoursBack != null
           ? "AND detected_at < date_trunc('hour', NOW() - ($2 || ' hours')::interval)" : ''}
       AND camera_id IS NOT NULL
     GROUP BY 1, 2, 3
    ON CONFLICT (camera_id, bucket_hour, vehicle_type) DO UPDATE
       SET n_total        = EXCLUDED.n_total,
           n_no_helmet    = EXCLUDED.n_no_helmet,
           n_no_helmet_ok = EXCLUDED.n_no_helmet_ok,
           n_no_seatbelt  = EXCLUDED.n_no_seatbelt,
           n_riders3      = EXCLUDED.n_riders3,
           updated_at     = NOW()`;
  const t0 = Date.now();
  const r = await pool.query(sql, untilHoursBack != null ? [String(hoursBack), String(untilHoursBack)] : [String(hoursBack)]);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// ── สรุปกวดขันรายวัน (migration 274) ─────────────────────────────────
// รวม traffic_hourly_stats เป็นวันไทย ตั้งแต่ต้นวันไทยของ since — วันที่แตะต้องรวมใหม่ทั้งวัน
// ไม่งั้นได้ยอดแค่ส่วนที่อยู่ในหน้าต่าง · upsert อย่างเดียวพอ เพราะแถวรายชั่วโมงไม่เคยหาย (นอกจาก prune อายุ)
// อ่านจากตารางรายชั่วโมง ไม่ใช่ข้อมูลดิบ ⇒ วันเดียว ~2k แถว · ทั้ง 120 วัน ~1 ล้านแถว ครั้งเดียวตอน backfill
async function refreshTrafficDaily(pool, since, until = null) {
  const args = until ? [since, until] : [since];
  const t0 = Date.now();
  const r = await pool.query(`
    INSERT INTO traffic_daily_stats
      (day, camera_id, vehicle_type, n_total, n_no_helmet, n_no_helmet_ok, n_no_seatbelt, n_riders3, updated_at)
    SELECT (bucket_hour AT TIME ZONE 'Asia/Bangkok')::date, camera_id, vehicle_type,
           sum(n_total), sum(n_no_helmet), sum(n_no_helmet_ok), sum(n_no_seatbelt), sum(n_riders3), NOW()
      FROM traffic_hourly_stats
     WHERE bucket_hour >= (date_trunc('day', $1::timestamptz AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
       ${until ? 'AND bucket_hour < $2::timestamptz' : ''}
     GROUP BY 1, 2, 3
    ON CONFLICT (day, camera_id, vehicle_type) DO UPDATE
       SET n_total = EXCLUDED.n_total, n_no_helmet = EXCLUDED.n_no_helmet,
           n_no_helmet_ok = EXCLUDED.n_no_helmet_ok, n_no_seatbelt = EXCLUDED.n_no_seatbelt,
           n_riders3 = EXCLUDED.n_riders3, updated_at = NOW()`, args);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// ── สถิติคนรายวัน (migration 276) ─────────────────────────────────
// appearances → appearance_dim_daily · วันไทยตาม event_time (เหมือนหน้าจอสถิติคน) · ลบทั้งวันที่แตะแล้วเขียนใหม่
// (ค่าที่หายจากต้นทางต้องหายจากสรุปด้วย) · object_class นับทุกประเภท · ลักษณะคนนับเฉพาะ Person · ไม่นับค่าว่าง
// วันที่ข้อมูลดิบถูกลบแล้ว (40 วัน) ไม่ถูกแตะอีก จึงเก็บสถิติได้ถึง 365 วัน · วันเดียว ~0.5–0.8 วิ
const PERSON_DIMS = [
  ['gender', 'gender'], ['age_group', 'COALESCE(age_group, rj_age_group)'],
  ['upper_color', 'upper_color'], ['lower_color', 'lower_color'],
  ['top_category', 'top_category'], ['bottom_category', 'bottom_category'],
  ['glasses', 'glasses::text'], ['hat', 'rj_hat'], ['mask', 'rj_mask'],
  ['expression', 'rj_expression'], ['bag_category', 'bag_category'],
];
async function refreshAppearanceDims(pool, since, until = null) {
  const args = until ? [since, until] : [since];
  const t0 = Date.now();
  const r = await pool.query(`
    WITH src AS (
      SELECT (event_time AT TIME ZONE 'Asia/Bangkok')::date AS day, camera_id, object_class,
             ${PERSON_DIMS.map(([k, e]) => `(${e})::text AS ${k}`).join(', ')}
        FROM appearances
       WHERE event_time >= (date_trunc('day', $1::timestamptz AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')
         ${until ? 'AND event_time < $2::timestamptz' : ''}
         AND camera_id IS NOT NULL
    ),
    touched AS (SELECT DISTINCT day FROM src),
    del AS (DELETE FROM appearance_dim_daily d USING touched t WHERE d.day = t.day),
    agg AS (
      SELECT day, camera_id, 'object_class' AS dim, object_class AS value, count(*)::int AS n FROM src GROUP BY 1, 2, 3, 4
      ${PERSON_DIMS.map(([k]) => `UNION ALL
      SELECT day, camera_id, '${k}', ${k}, count(*)::int FROM src WHERE object_class = 'Person' GROUP BY 1, 2, 3, 4`).join('\n      ')}
    )
    INSERT INTO appearance_dim_daily (day, camera_id, dim, value, n, updated_at)
    SELECT day, camera_id, dim, value, n, NOW() FROM agg WHERE value IS NOT NULL AND value <> ''
    ON CONFLICT (day, camera_id, dim, value) DO UPDATE SET n = EXCLUDED.n, updated_at = NOW()`, args);
  return { rows: r.rowCount, ms: Date.now() - t0 };
}

// ── ตารางสรุปของหน้าป้ายทะเบียน (migration 171) ───────────────────────
// อยู่ในไฟล์เดียวกับของกวดขันโดยตั้งใจ — ใช้หน้าต่าง lookback + reconcile ตัวเดียวกัน
// ไม่ต้องมีตัวจับเวลาชุดที่สองที่พลาดบทเรียน "ของมาช้าเกิน 3 ชม. แล้วหายถาวร" ซ้ำ
//
// since/until เป็น Date จริง ไม่ใช่ "ย้อนหลังกี่ชั่วโมง" เพราะตัว backfill ต้องแบ่งงาน
// เป็นก้อนที่ตัดตรงขอบวัน · until = null คือ "ถึงปัจจุบัน" (เคสของ refresher ปกติ)
//
// 🔴 ขอบล่างต้องตรงหัวชั่วโมงเสมอ ไม่งั้น bucket แรกจะถูกเขียนทับด้วยยอดที่นับ
//    จากเศษชั่วโมง — ต่ำกว่าจริงแบบถาวร
// 🔴 และรอบมิติรายวันต้องขยายขอบล่างไปถึง "ต้นวันตามเวลาไทย" เพราะมันลบทั้งวัน
//    แล้วเขียนใหม่ ถ้าขอบล่างอยู่กลางวัน จะลบทั้งวันแล้วคืนมาแค่บางส่วน
//
// ⚠️ สองรอบแรกเขียนคนละคอลัมน์ของตารางเดียวกัน · แต่ละรอบ SET เฉพาะของตัวเอง
//    ถ้า SET ครบทุกคอลัมน์จะไปล้างงานของอีกรอบทิ้งทุกครั้งที่รัน
// รันคำสั่งเดียวโดยห้าม planner ใช้ sort (ดูเหตุผลที่จุดเรียก) · ถ้า pool ไม่มี connect() (เทสต์) ยิงตรง
async function withHashAgg(pool, fn) {
  if (typeof pool.connect !== 'function') return fn((sql, args) => pool.query(sql, args));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_sort = off');
    const r = await fn((sql, args) => client.query(sql, args));
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// มิติรายวันของป้าย (lpr_dim_daily) — ลบทั้งวันไทยที่แตะแล้วเขียนใหม่ทุกมิติพร้อมกัน
// ⚠️ since ถูกปัดลงเป็นต้นวันไทยในคำสั่งเอง · until ต้องตรงขอบวันไทย ไม่งั้นวันสุดท้ายถูกลบแล้วเขียนกลับแค่ครึ่งวัน
async function refreshLprDims(pool, since, until = null) {
  const args = until ? [since, until] : [since];
  const hi = (col) => (until ? ` AND ${col} < $2::timestamptz` : '');
  // มิติรายวัน — long format หนึ่งแถวต่อหนึ่งค่าของหนึ่งมิติ
  //    ลบทั้งวันก่อนเขียนใหม่ เพราะถ้าค่าหนึ่งหายไปจากต้นทาง (แก้ข้อมูลย้อนหลัง)
  //    UPSERT อย่างเดียวจะทิ้งแถวเก่าค้างไว้ตลอดกาล ⇒ ขอบล่างต้องเป็นต้นวันไทย
  return pool.query(`
    WITH src AS (
      SELECT (detected_at AT TIME ZONE 'Asia/Bangkok')::date AS day, camera_id,
             region, vehicle_type, plate_color, vehicle_brand, vehicle_color
        FROM license_plates
       WHERE detected_at >= (date_trunc('day', $1::timestamptz AT TIME ZONE 'Asia/Bangkok')
                             AT TIME ZONE 'Asia/Bangkok')${hi('detected_at')}
         AND camera_id IS NOT NULL
    ),
    touched AS (SELECT DISTINCT day FROM src),
    del AS (DELETE FROM lpr_dim_daily d USING touched t WHERE d.day = t.day),
    agg AS (
      SELECT day, camera_id, 'region'        AS dim, region        AS value, count(*)::int AS n FROM src GROUP BY 1,2,3,4
      UNION ALL
      SELECT day, camera_id, 'vehicle_type',  vehicle_type,  count(*)::int FROM src GROUP BY 1,2,3,4
      UNION ALL
      SELECT day, camera_id, 'plate_color',   plate_color,   count(*)::int FROM src GROUP BY 1,2,3,4
      UNION ALL
      SELECT day, camera_id, 'vehicle_brand', vehicle_brand, count(*)::int FROM src GROUP BY 1,2,3,4
      UNION ALL
      -- สีรถ (S3 · 2026-10-22) — partner API /v1/stats/lpr/daily · หน้าจอทุกจุดกรอง dim = '…' อยู่แล้ว ไม่กระทบยอดเดิม
      SELECT day, camera_id, 'vehicle_color', vehicle_color, count(*)::int FROM src GROUP BY 1,2,3,4
    )
    INSERT INTO lpr_dim_daily (day, camera_id, dim, value, n, updated_at)
    SELECT day, camera_id, dim, value, n, NOW() FROM agg WHERE value IS NOT NULL AND value <> ''
    ON CONFLICT (day, camera_id, dim, value) DO UPDATE SET n = EXCLUDED.n, updated_at = NOW()`, args);
}

async function refreshLprWindow(pool, since, until = null) {
  // อ่านผลที่ตรึงไว้ตอน INSERT — คำนวณซ้ำกี่รอบก็ได้ค่าเดิม (migration 234)
  const evidence = helmet.evidenceSql('');

  const from = new Date(since);
  from.setUTCMinutes(0, 0, 0);                       // ตรงหัวชั่วโมง (ไทยเป็น +07:00 เต็มชั่วโมง)
  const args = until ? [from, until] : [from];
  const hi = (col) => (until ? ` AND ${col} < $2::timestamptz` : '');
  const t0 = Date.now();

  // 1) จาก license_plates — ยอดอ่านป้ายและตัวชี้วัดที่ผูกกับป้าย
  const a = await pool.query(`
    INSERT INTO lpr_hourly_stats
      (camera_id, bucket_hour, n_total, n_noread, n_no_helmet, n_no_helmet_ok, n_riders3, updated_at)
    SELECT camera_id, date_trunc('hour', detected_at),
           count(*),
           count(*) FILTER (WHERE plate_number = 'unknown'),
           count(*) FILTER (WHERE no_helmet AND vehicle_type = 'twoWheelVehicle'),
           count(*) FILTER (WHERE no_helmet AND vehicle_type = 'twoWheelVehicle' ${evidence}),
           count(*) FILTER (WHERE rider_count >= 3),
           NOW()
      FROM license_plates
     WHERE detected_at >= $1::timestamptz${hi('detected_at')}
       AND camera_id IS NOT NULL
     GROUP BY 1, 2
    ON CONFLICT (camera_id, bucket_hour) DO UPDATE
       SET n_total = EXCLUDED.n_total, n_noread = EXCLUDED.n_noread,
           n_no_helmet = EXCLUDED.n_no_helmet, n_no_helmet_ok = EXCLUDED.n_no_helmet_ok,
           n_riders3 = EXCLUDED.n_riders3, updated_at = NOW()`, args);

  // 2) จาก events — กราฟ "จำนวนรถต่อกล้อง" นับรถที่อ่านป้ายไม่ออกด้วย จึงมาจาก
  //    license_plates ไม่ได้ · เงื่อนไขตรงกับที่ perCamera เคยใช้เป๊ะ
  //    กล้อง-ชั่วโมงที่มี event แต่ไม่มีป้ายเลย ถูก INSERT ที่รอบนี้เท่านั้น
  const b = await pool.query(`
    INSERT INTO lpr_hourly_stats (camera_id, bucket_hour, n_vehicle_events, updated_at)
    SELECT camera_id, date_trunc('hour', event_time), count(*), NOW()
      FROM events
     WHERE event_time >= $1::timestamptz${hi('event_time')}
       AND camera_id IS NOT NULL
       AND (object_class IN ('Car','Truck','Vehicle','Bicycle') OR event_type = 'anprAlarm')
     GROUP BY 1, 2
    ON CONFLICT (camera_id, bucket_hour) DO UPDATE
       SET n_vehicle_events = EXCLUDED.n_vehicle_events, updated_at = NOW()`, args);

  // 3) จาก events — "อ่านป้ายไม่ได้" ที่เห็นครบทั้งสองยี่ห้อ (migration 200)
  //    n_noread (รอบที่ 1) นับจาก license_plates จึงเห็นแต่ Hikvision ที่ส่ง
  //    plate='unknown' มา ส่วน Dahua ไม่สร้างแถวใน license_plates เลย
  //    ⚠️ ใช้ n_vehicle_events (รอบที่ 2) เป็นตัวหารไม่ได้ — รอบนั้นนับ
  //       object_class IN ('Car','Truck','Vehicle','Bicycle') รวมเข้ามาด้วย
  //       จึงใหญ่กว่ายอด anprAlarm จริง ⇒ รอบนี้เก็บ n_anpr_ev เป็นตัวหารของตัวเอง
  //       (สองคอลัมน์จากการสแกนก้อนเดียว ถูกกว่าไปนับสดตอนเปิดหน้า)
  // 🔴 predicate ต้องเป็น OR สองขา **ห้ามเขียนเป็น IN ('', 'unknown')** — มีดัชนี
  //    บางส่วนสองตัวรองรับคนละขา (idx_events_anpr_noread_time ·
  //    idx_events_anpr_unknown_time) เขียนเป็น OR planner ต่อ BitmapOr ใช้ได้ทั้งคู่
  //    เขียนเป็น IN planner เลิกใช้ทั้งคู่เงียบ ๆ · วัดจริง 24 ชม.: OR 98.9 ms
  //    · IN 2,439 ms — เหตุผลเดียวกับ migration 199 (จับคู่จาก expression tree)
  // ⚠️ ON CONFLICT SET เฉพาะคอลัมน์ของรอบนี้ — SET ครบทุกคอลัมน์เมื่อไหร่
  //    จะไปล้างงานของรอบที่ 1/2 ทิ้งทุกครั้งที่รัน (กติกาหัวข้อบนสุดของฟังก์ชัน)
  // 🔴 ช่วง 1 วัน (reconcile) planner คาดกลุ่ม ~200k (จริง ~2k) จึงเลือก Sort + GroupAggregate
  //    แล้วลาก raw_json (~1.27 KB/แถว) ทั้งก้อนเข้า sort → ล้นดิสก์ ~1.2 GB ต่อวัน (วัด 2026-10-02:
  //    temp 153k block) · บังคับ hash aggregate เฉพาะคำสั่งนี้ = temp 0 ผลเหมือนเดิมทุกแถว
  //    (เทียบ 1,923 แถวของ 30 ก.ย. ตรงกันทุกไบต์) · SET LOCAL ต้องอยู่ใน transaction ของ client เดียว
  const d = await withHashAgg(pool, (q) => q(`
    INSERT INTO lpr_hourly_stats (camera_id, bucket_hour, n_noread_ev, n_anpr_ev, updated_at)
    SELECT camera_id, date_trunc('hour', event_time),
           count(*) FILTER (WHERE COALESCE(raw_json->>'plate','') = ''
                               OR raw_json->>'plate' = 'unknown'),
           count(*),
           NOW()
      FROM events
     WHERE event_time >= $1::timestamptz${hi('event_time')}
       AND camera_id IS NOT NULL
       AND event_type = 'anprAlarm'
     GROUP BY 1, 2
    ON CONFLICT (camera_id, bucket_hour) DO UPDATE
       SET n_noread_ev = EXCLUDED.n_noread_ev, n_anpr_ev = EXCLUDED.n_anpr_ev,
           updated_at = NOW()`, args));

  // 4) มิติรายวัน — แยกเป็นฟังก์ชันให้ backfill เฉพาะส่วนนี้ได้ (S3 สีรถ · 2026-10-22)
  const c = await refreshLprDims(pool, from, until);

  return { plates: a.rowCount, events: b.rowCount, noread: d.rowCount, dims: c.rowCount,
           ms: Date.now() - t0 };
}

async function prune(pool) {
  const r = await pool.query(
    `DELETE FROM traffic_hourly_stats WHERE bucket_hour < NOW() - ($1 || ' days')::interval`,
    [String(RETENTION_DAYS)]);
  // รายวันอายุเท่ารายชั่วโมง + 1 วัน — หน้า Traffic เริ่มอนุกรมที่วันไทยของ "เที่ยงคืน UTC − 120 วัน"
  // ช่วง 00:00–07:00 ไทย วันนั้นคือ (วันนี้ไทย − 121) ถ้าตัดที่ 120 พอดี วันแรกของกราฟจะหายไปทุกเช้ามืด
  const d = await pool.query(
    `DELETE FROM traffic_daily_stats WHERE day < (NOW() AT TIME ZONE 'Asia/Bangkok')::date - $1::int - 1`,
    [RETENTION_DAYS]);
  // สถิติคนเก็บ 365 วัน (เจ้าของอนุมัติ 2026-10-22) — นานกว่าข้อมูลดิบ 40 วัน เพราะเป็นตัวนับรวม ไม่มีข้อมูลบุคคล
  const p = await pool.query(
    `DELETE FROM appearance_dim_daily WHERE day < (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 365`);
  return r.rowCount + d.rowCount + p.rowCount;
}

// อ่านวันที่ reconcile ล่าสุดกลับมาใส่ fast path ตอนบูต
// settings พังไม่ควรทำให้ refresher ไม่ทำงาน — แย่ที่สุดคือได้พฤติกรรมเดิม (รันซ้ำ)
async function loadReconciledDay(pool) {
  try {
    const { rows } = await pool.query('SELECT value FROM system_settings WHERE key = $1', [RECONCILED_KEY]);
    if (rows[0]?.value) _reconciledDay = String(rows[0].value);
  } catch (e) {
    console.warn(`[traffic-stats] อ่าน ${RECONCILED_KEY} ไม่ได้: ${e.message}`);
  }
  return _reconciledDay;
}

// 🔴 เขียนหน่วยความจำ "ก่อน" await เสมอ — ถ้า upsert ล้มแล้วปล่อยตัวแปรว่างไว้
//    tick อีก 15 นาทีถัดไปจะลากงาน 7 วันมาทำซ้ำ ซึ่งคือสิ่งที่ฟังก์ชันนี้มีไว้กัน
async function saveReconciledDay(pool, day) {
  _reconciledDay = day;
  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RECONCILED_KEY, day,
       'วันที่ (เวลาไทย) ที่ reconcile ของ traffic/lpr hourly stats ทำไปแล้ว — กัน api-server restart ในชั่วโมง reconcile ลากงานหนักมาทำซ้ำ']);
  } catch (e) {
    console.warn(`[traffic-stats] เขียน ${RECONCILED_KEY} ไม่ได้: ${e.message}`);
  }
}

// ถึงเวลา reconcile ประจำวันหรือยัง — ถามเวลาไทยจาก Postgres ตัวเดียวกับที่ทุก query
// ในโปรเจกต์ใช้ ไม่คำนวณ timezone เองใน Node (TZ ของเครื่องไม่ใช่ของที่เชื่อได้)
async function dueForReconcile(pool) {
  const { rows } = await pool.query(
    `SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS d,
            extract(hour FROM now() AT TIME ZONE 'Asia/Bangkok')::int AS h`);
  const { d, h } = rows[0];
  return h === RECONCILE_HOUR && _reconciledDay !== d ? d : null;
}

// pool ส่งเข้ามาได้ (ตัวจัดคิว src/jobs/rollups.js เป็นคนส่ง) — ถ้าไม่ส่งก็ใช้ตัวที่
// start() เก็บไว้เหมือนเดิม · คืนผลของรอบนี้ให้ผู้เรียกบันทึกสถานะได้ ไม่ใช่กลืนเงียบ
// ช่วงทีละวันไทย [ต้นวัน, ต้นวันถัดไป) จาก (วันนี้ − days) ถึงวันนี้ (วันสุดท้าย until = null = ถึงปัจจุบัน)
// ใช้กับ reconcile ทุกตัวที่ลบ "ทั้งวัน" ที่แตะ — ขอบต้องตรงต้นวันทั้งสองฝั่ง (ดูคอมเมนต์ใน tick)
function thaiDayWindows(days, now = Date.now()) {
  const dayMs = 24 * 3600_000;
  const todayTh = Math.floor((now + 7 * 3600_000) / dayMs) * dayMs - 7 * 3600_000;   // ไทย +07:00 ไม่มี DST
  const out = [];
  for (let d = days; d >= 0; d--) out.push([new Date(todayTh - d * dayMs), d ? new Date(todayTh - (d - 1) * dayMs) : null, d]);
  return out;
}

async function tick(pool) {
  if (pool) _pool = pool;
  // กันงานซ้อนกันเอง — ถ้ารอบก่อนยังไม่จบ (เช่นตอน backfill) ข้ามรอบนี้ไป
  if (_running) return { skipped: 'running' };
  _running = true;
  let _reconciled = null;
  try {
    const { rows, ms } = await refreshWindow(_pool, LOOKBACK_HOURS);
    const daily = await refreshTrafficDaily(_pool, new Date(Date.now() - LOOKBACK_HOURS * 3600_000));
    const person = await refreshAppearanceDims(_pool, new Date(Date.now() - LOOKBACK_HOURS * 3600_000));
    const lpr = await refreshLprWindow(_pool, new Date(Date.now() - LOOKBACK_HOURS * 3600_000));

    // เก็บตกของที่มาช้าเกินหน้าต่างปกติ — วันละครั้ง ดูเหตุผลที่ RECONCILE_HOURS
    const day = await dueForReconcile(_pool);
    if (day) {
      // 🔴 ต้องซอยเป็นวัน ไม่ใช่ยิง 7 วันรวดเดียว
      //
      // วัดจริง 2026-08-27: refreshLprWindow(7 วัน) ใช้ 167.6 วินาที ขณะที่ pool ของ
      // api-server ตั้ง statement_timeout ไว้ 120 วินาที ⇒ reconcile **ล้มทุกคืน**
      // มาตลอด (log 03:10 / 03:20 / 03:35 / 03:50 ล้วน "canceling statement due to
      // statement timeout") · แปลว่าตาข่ายที่รับ event มาช้าเกิน 3 ชม. ไม่เคยทำงานเลย
      // ซึ่งเป็นเหตุผลเดียวที่ reconcile มีอยู่ (ภูเก็ตส่งข้ามวัน 10.3%)
      //
      // ทางที่ **ไม่** เลือก: ยกเพดานของ pool — เป็น pool เดียวกับที่ผู้ใช้ใช้
      // คำสั่งยาว 3 นาทีจะไปกักหน้าจอ ซึ่งคือบั๊กที่เพิ่งแก้ไปวันนี้
      // ⇒ ซอยเป็นวันละคำสั่ง (~24 วินาที/วัน) ไม่มีคำสั่งไหนยาว และวันที่ล้ม
      //   ไม่ลากวันที่เหลือไปด้วย
      await serial(async () => {
        const r = await refreshWindow(_pool, RECONCILE_HOURS);
        await refreshTrafficDaily(_pool, new Date(Date.now() - RECONCILE_HOURS * 3600_000));
        // ⚠️ ขอบของทุกรอบต้องตรงต้นวันไทยทั้งสองฝั่ง — มิติรายวัน (lpr_dim_daily / appearance_dim_daily) ลบ "ทั้งวัน"
        // ที่แตะแล้วเขียนใหม่ ถ้า until ตกกลางวัน วันนั้นถูกลบแล้วเขียนกลับครึ่งวัน และถ้ารอบถัดไปล้ม จะค้างครึ่งวัน
        // ถึงคืนถัดไป (repro 2026-10-22: จังหวัดเมื่อวาน 823,854 → 467,684) · เริ่มที่ต้นวันของ (วันนี้ − days)
        // ซึ่งเก่ากว่า now − RECONCILE_HOURS เสมอ ⇒ ครอบคลุมเท่าเดิมหรือมากกว่า (แลกกับงานเพิ่มสูงสุดหนึ่งวัน)
        const windows = thaiDayWindows(Math.ceil(RECONCILE_HOURS / 24));
        const days = windows.length;
        const rl = { plates: 0, events: 0, dims: 0, ms: 0 };
        let failed = 0;
        for (const [since, until, d] of windows) {
          try {
            const one = await refreshLprWindow(_pool, since, until);
            rl.plates += one.plates; rl.events += one.events; rl.dims += one.dims; rl.ms += one.ms;
          } catch (e) {
            failed++;
            console.warn(`[traffic-stats] reconcile วันที่ -${d} ล้ม: ${e.message}`);
          }
        }
        // สถิติคน: ทีละวันไทยแบบเดียวกัน (วันละ ~0.5–0.8 วิ) · วันที่ล้มไม่ลากวันอื่น
        for (const [since, until, d] of windows) {
          try { await refreshAppearanceDims(_pool, since, until); }
          catch (e) { console.warn(`[traffic-stats] reconcile สถิติคน วันที่ -${d} ล้ม: ${e.message}`); }
        }
        // เทียบเมื่อวานของ lpr_hourly_stats กับนับดิบทันทีหลังเก็บตก (helpers/rollupCheck.js · perfWatch เตือน)
        const y = windows.find((w) => w[2] === 1);
        if (y) await require('./helpers/rollupCheck').run(_pool, 'lpr_hourly_stats', y[0], y[1]);
        await saveReconciledDay(_pool, day);
        _reconciled = { day, rows: r.rows, failedDays: failed, days };
        console.log(`[traffic-stats] reconcile ${RECONCILE_HOURS} ชม.: ${r.rows} row(s) in ${r.ms}ms`
          + ` · lpr ${rl.plates}/${rl.events}/${rl.dims} in ${rl.ms}ms`
          + (failed ? ` · ⚠️ ${failed}/${days} วันล้ม` : ''));
      });
    }

    const pruned = await prune(_pool);
    if (rows || pruned) {
      console.log(`[traffic-stats] refreshed ${rows} row(s) in ${ms}ms`
        + ` · lpr ${lpr.plates}/${lpr.events}/${lpr.dims} in ${lpr.ms}ms`
        + ` · daily ${daily.rows} in ${daily.ms}ms`
        + ` · person ${person.rows} in ${person.ms}ms`
        + (pruned ? ` · pruned ${pruned} old row(s)` : ''));
    }
    return { rows, pruned, ms, reconciled: _reconciled };
  } catch (e) {
    // หน้าจอยังอ่านข้อมูลเก่าได้ ไม่ต้องล้ม process ทั้งตัวเพราะ refresh รอบเดียวพลาด
    console.error('[traffic-stats] refresh failed:', e.message);
    return { error: e.message, reconciled: _reconciled };
  } finally {
    _running = false;
  }
}

// ⚠️ ตั้งแต่ 2026-09-07 ตัวจัดคิวคือ `src/jobs/rollups.js` — api-server ไม่เรียก
// start() ตัวนี้แล้ว คงไว้เพื่อไม่ให้ public API เปลี่ยน · เรียกซ้ำ = ได้ timer คู่ที่สอง
// (rollups.start() เรียก loadReconciledDay(pool) เองแทนบรรทัดใน start() นี้)
function start(pool) {
  if (_timer) return;
  _pool = pool;
  // ไม่ต้องรอ — tick แรกอีก 135 วินาที ส่วน SELECT ตัวนี้เป็น PK lookup แถวเดียว
  loadReconciledDay(pool);
  // รอรอบแรกตาม FIRST_RUN_MS — อย่าไปแย่ง CPU กับตอน api-server กำลังบูต
  setTimeout(tick, FIRST_RUN_MS).unref?.();
  _timer = setInterval(tick, REFRESH_MS);
  _timer.unref?.();
  console.log(`[traffic-stats] refresher started (ทุก ${REFRESH_MS / 60000} นาที, ย้อนหลัง ${LOOKBACK_HOURS} ชม.`
    + ` · reconcile ${RECONCILE_HOURS} ชม. ตอน ${String(RECONCILE_HOUR).padStart(2, '0')}:00 เวลาไทย)`);
}

module.exports = {
  start, tick, thaiDayWindows, refreshWindow, refreshTrafficDaily, refreshAppearanceDims, refreshLprWindow, refreshLprDims, prune, dueForReconcile,
  loadReconciledDay, saveReconciledDay,
  REFRESH_MS, LOOKBACK_HOURS, RECONCILE_HOURS, RECONCILE_HOUR, RECONCILED_KEY,
};
