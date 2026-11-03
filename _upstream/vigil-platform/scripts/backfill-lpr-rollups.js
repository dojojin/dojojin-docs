#!/usr/bin/env node
// ============================================================
// Vigil Platform — backfill ตารางสรุปของหน้าป้ายทะเบียน (migration 171)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ต้องรันให้ครบก่อนต่อสายหน้าจอเข้าตารางสรุป ไม่งั้นบางช่วงเวลาจะอ่านตารางที่
// เติมไม่ครบแล้วได้ตัวเลขต่ำกว่าจริงโดยไม่มีใครรู้
//
//   set -a; . ./src/.env; set +a
//   node scripts/backfill-lpr-rollups.js              # 120 วัน (เท่า retention)
//   node scripts/backfill-lpr-rollups.js --days 7     # กำหนดเอง
//   node scripts/backfill-lpr-rollups.js --dry-run    # ดูขนาดงานก่อน
//   node scripts/backfill-lpr-rollups.js --dims-only --days 102   # เฉพาะมิติรายวัน (lpr_dim_daily) เช่นเพิ่มมิติใหม่ (S3 สีรถ 2026-10-22)
//
// ⚠️ ทำทีละก้อน (ค่าเริ่มต้น 7 วัน) ไม่ยิงรวดเดียว 120 วัน — งานก้อนใหญ่บนตาราง
//    20 ล้านแถวจะกินหน่วยความจำ sort/hash จนล้นลงดิสก์ และไปเบียด ingest ที่วิ่งอยู่
// ปลอดภัยที่จะรันซ้ำ — เป็น upsert ชุดเดียวกับที่ refresher ใช้ทุก 15 นาที
// ============================================================
'use strict';

const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const refresher = require(path.join(__dirname, '..', 'src', 'traffic-stats-refresher.js'));
const helmet = require(path.join(__dirname, '..', 'src', 'helpers', 'helmetCriteria.js'));

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const DAYS  = Number(arg('days', 45));   // preset ที่ยาวสุดคือ 'เดือนนี้' · custom ใช้เส้นทางสด
const CHUNK = Number(arg('chunk', 7));
const DRY   = process.argv.includes('--dry-run');
const DIMS_ONLY = process.argv.includes('--dims-only');

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, max: 2, application_name: 'backfill-lpr-rollups',
  });
  try {
    console.log('เกณฑ์: อ่านผลที่ตรึงไว้ตอนบันทึก (license_plates.plate_identified)');
    console.log(`จะเติมย้อนหลัง ${DAYS} วัน ทีละก้อน ${CHUNK} วัน${DIMS_ONLY ? ' (เฉพาะมิติรายวัน)' : ''}`);
    if (DRY) { console.log('--dry-run — ไม่เขียนอะไร'); return; }

    // ขอบวันตามเวลาไทยจาก Postgres — ไม่คำนวณ timezone เองใน Node
    const { rows: b } = await pool.query(
      `SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                 AT TIME ZONE 'Asia/Bangkok') AS today_start`);
    const todayStart = new Date(b[0].today_start);
    const DAY_MS = 86400_000;

    const t0 = Date.now();
    // เดินทีละก้อน จากเก่าไปใหม่ · ก้อนตัดตรงขอบวันเสมอ เพราะรอบมิติรายวัน
    // ลบทั้งวันแล้วเขียนใหม่ — ก้อนที่คร่อมกลางวันจะทำข้อมูลหายครึ่งวัน
    let done = 0;
    for (let d = DAYS; d > 0; d -= CHUNK) {
      const span  = Math.min(CHUNK, d);
      const from  = new Date(todayStart.getTime() - d * DAY_MS);
      const until = new Date(from.getTime() + span * DAY_MS);
      // ก้อนสุดท้ายต้องเปิดปลายไว้ ให้ครอบชั่วโมงที่ยังวิ่งอยู่ของวันนี้ด้วย
      const isLast = (d - CHUNK) <= 0;
      if (DIMS_ONLY) {
        const t1 = Date.now();
        const c = await refresher.refreshLprDims(pool, from, isLast ? null : until);
        done += span;
        console.log(`  ${new Date(from.getTime() + 7 * 3600_000).toISOString().slice(0, 10)} +${span} วัน → dims ${c.rowCount} · ${((Date.now() - t1) / 1000).toFixed(1)} วิ`);
        continue;
      }
      const r = await refresher.refreshLprWindow(pool, from, isLast ? null : until);
      done += span;
      const label = new Date(from.getTime() + 7 * 3600_000).toISOString().slice(0, 10);  // แสดงเป็นวันไทย
      console.log(`  ${label} +${span} วัน → plates ${r.plates}`
        + ` · events ${r.events} · dims ${r.dims} · ${(r.ms / 1000).toFixed(1)} วิ`);
    }
    console.log(`รวม ${done} วัน ใน ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`);

    const { rows } = await pool.query(`
      SELECT (SELECT count(*) FROM lpr_hourly_stats) AS hourly,
             (SELECT count(*) FROM lpr_dim_daily)    AS dims,
             (SELECT count(*) FROM lpr_hourly_stats WHERE n_vehicle_events IS NULL) AS ไม่มีฝั่ง_events,
             (SELECT count(*) FROM lpr_hourly_stats WHERE n_total IS NULL)          AS ไม่มีฝั่ง_plates`);
    const r = rows[0];
    console.log(`lpr_hourly_stats ${Number(r.hourly).toLocaleString()} แถว`
      + ` (ไม่มีฝั่ง events ${r['ไม่มีฝั่ง_events']} · ไม่มีฝั่ง plates ${r['ไม่มีฝั่ง_plates']})`);
    console.log(`lpr_dim_daily    ${Number(r.dims).toLocaleString()} แถว`);
  } catch (e) {
    console.error('ล้มเหลว:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
