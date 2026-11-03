#!/usr/bin/env node
// ============================================================
// Vigil Platform — เติม traffic_hourly_stats ย้อนหลังครั้งแรก
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
//   NODE_PATH=src/node_modules node scripts/backfill-traffic-stats.js [จำนวนวัน]
//   (ค่าเริ่มต้น 120 วัน)
//
// ⚠️ ต้องมี NODE_PATH — node หา node_modules จากตำแหน่ง "ไฟล์สคริปต์" ไม่ใช่ cwd
// และโปรเจกต์นี้ติดตั้ง dependency ไว้ที่ src/node_modules ไม่ใช่ราก
// เลย cd เข้า src ก่อนก็ยังไม่ช่วย ต้องบอก NODE_PATH ตรง ๆ
//
// เดินทีละก้อน (ครั้งละ 24 ชั่วโมง) ไม่ใช่ยิงทีเดียวทั้ง 120 วัน เพราะ
// query เดียวบน license_plates 12.6 ล้านแถวกินเวลาหลายวินาทีและถือ lock นาน
// การแบ่งก้อนทำให้ ingest ที่วิ่งอยู่ไม่สะดุด และหยุดกลางคันแล้วรันต่อได้
// (idempotent — ON CONFLICT DO UPDATE)
// ============================================================
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'src', '.env'), quiet: true });
const { Pool } = require('pg');

const DAYS = Math.max(1, Math.min(400, Number(process.argv[2]) || 120));

const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionTimeoutMillis: 15000, query_timeout: 600000,
});

// ก้อนละ 1 วัน โดยระบุขอบเขตชัดเจนทั้งสองด้าน — ไม่ใช้ "ย้อนหลัง N ชั่วโมง"
// แบบตัว refresher เพราะที่นี่ต้องเดินถอยหลังไปเรื่อย ๆ ทีละช่วง
const SQL = `
  INSERT INTO traffic_hourly_stats
    (camera_id, bucket_hour, vehicle_type, n_total, n_no_helmet, n_no_seatbelt, n_riders3, updated_at)
  SELECT camera_id,
         date_trunc('hour', detected_at),
         coalesce(vehicle_type, 'unknown'),
         count(*),
         count(*) FILTER (WHERE no_helmet),
         count(*) FILTER (WHERE no_seatbelt),
         count(*) FILTER (WHERE rider_count >= 3),
         NOW()
    FROM license_plates
   WHERE detected_at >= $1 AND detected_at < $2
     AND camera_id IS NOT NULL
   GROUP BY 1, 2, 3
  ON CONFLICT (camera_id, bucket_hour, vehicle_type) DO UPDATE
     SET n_total = EXCLUDED.n_total, n_no_helmet = EXCLUDED.n_no_helmet,
         n_no_seatbelt = EXCLUDED.n_no_seatbelt, n_riders3 = EXCLUDED.n_riders3,
         updated_at = NOW()`;

(async () => {
  console.log(`[backfill] เริ่มเติมย้อนหลัง ${DAYS} วัน (ทีละ 1 วัน)`);
  const t0 = Date.now();
  let totalRows = 0;
  for (let d = 0; d < DAYS; d++) {
    // 🔴 ขอบก้อนต้องตรงหัวชั่วโมงเสมอ — ใช้ NOW() ดิบ (เช่น 02:37) จะทำให้
    // ชั่วโมงที่คาบเกี่ยวสองก้อนถูกคำนวณสองรอบ รอบละ "ครึ่งชั่วโมง" แล้ว
    // ON CONFLICT DO UPDATE เอาค่าหลังทับค่าแรก ⇒ ชั่วโมงนั้นเหลือแค่ครึ่งเดียว
    // เจอจริงตอน audit: ยอดหาย 9,727 แถว (0.2%) จาก 29 รอยต่อวัน
    const from = `date_trunc('hour', NOW()) - INTERVAL '${d + 1} days'`;
    const to   = `date_trunc('hour', NOW()) - INTERVAL '${d} days'`;
    const { rows: bounds } = await pool.query(`SELECT ${from} AS f, ${to} AS t`);
    const t1 = Date.now();
    const r = await pool.query(SQL, [bounds[0].f, bounds[0].t]);
    totalRows += r.rowCount;
    // เงียบเมื่อไม่มีข้อมูล — วันเก่า ๆ ที่ยังไม่มีระบบจะได้ไม่รก log
    if (r.rowCount) {
      console.log(`  วันที่ -${d + 1}: ${String(r.rowCount).padStart(6)} แถว (${Date.now() - t1}ms)`);
    }
  }
  const { rows: tot } = await pool.query(
    `SELECT count(*) AS n, pg_size_pretty(pg_total_relation_size('traffic_hourly_stats')) AS size,
            min(bucket_hour) AS oldest, max(bucket_hour) AS newest FROM traffic_hourly_stats`);
  console.log(`[backfill] เสร็จใน ${((Date.now() - t0) / 1000).toFixed(1)}s · upsert ${totalRows} แถว`);
  console.log(`[backfill] ตารางตอนนี้: ${tot[0].n} แถว · ${tot[0].size} · ${tot[0].oldest} → ${tot[0].newest}`);
  await pool.end();
})().catch((e) => { console.error('[backfill] ล้มเหลว:', e.message); process.exit(1); });
