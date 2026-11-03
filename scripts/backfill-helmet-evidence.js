#!/usr/bin/env node
// ============================================================
// Vigil Platform — backfill n_no_helmet_ok ย้อนหลัง (migration 170)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// migration 170 เพิ่มคอลัมน์แบบ NULL ได้ โดยตั้งใจ — bucket เก่าจึงยังว่างอยู่
// และหน้าจอจะแสดง "—" ไม่ใช่ "0 ครั้ง" (เลข 0 อ่านแล้วเหมือนผลลัพธ์จริง)
// สคริปต์นี้เติมย้อนหลังให้ครบทั้ง retention ครั้งเดียวจบ
//
//   set -a; . ./src/.env; set +a
//   node scripts/backfill-helmet-evidence.js            # 120 วัน (ค่า retention)
//   node scripts/backfill-helmet-evidence.js --days 30  # กำหนดเอง
//   node scripts/backfill-helmet-evidence.js --dry-run  # ดูว่าจะแตะกี่ bucket
//
// ปลอดภัยที่จะรันซ้ำ — เป็น upsert ตัวเดียวกับที่ตัว refresher ใช้ทุก 15 นาที
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
const DAYS = Number(arg('days', 120));
const DRY  = process.argv.includes('--dry-run');

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, max: 2, application_name: 'backfill-helmet-evidence',
  });
  try {
    console.log('เกณฑ์: อ่านผลที่ตรึงไว้ตอนบันทึก (license_plates.plate_identified)');

    const { rows: before } = await pool.query(
      `SELECT count(*) FILTER (WHERE n_no_helmet_ok IS NULL) AS ว่าง,
              count(*)                                       AS ทั้งหมด
         FROM traffic_hourly_stats
        WHERE bucket_hour >= now() - ($1 || ' days')::interval`, [String(DAYS)]);
    console.log(`bucket ในช่วง ${DAYS} วัน: ${before[0]['ทั้งหมด']} · ยังว่าง ${before[0]['ว่าง']}`);

    if (DRY) { console.log('--dry-run — ไม่เขียนอะไร'); return; }

    const t0 = Date.now();
    const r = await refresher.refreshWindow(pool, DAYS * 24);
    console.log(`เขียน/ทับ ${r.rows} bucket ใน ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`);

    const { rows: after } = await pool.query(
      `SELECT count(*) FILTER (WHERE n_no_helmet_ok IS NULL) AS ว่าง,
              sum(n_no_helmet)    AS รวมตรวจพบ,
              sum(n_no_helmet_ok) AS รวมหลักฐาน
         FROM traffic_hourly_stats
        WHERE bucket_hour >= now() - ($1 || ' days')::interval
          AND vehicle_type = 'twoWheelVehicle'`, [String(DAYS)]);
    const a = after[0];
    const pct = a['รวมตรวจพบ'] ? (100 * a['รวมหลักฐาน'] / a['รวมตรวจพบ']).toFixed(1) : '—';
    console.log(`เหลือว่าง ${a['ว่าง']} · ตรวจพบ ${Number(a['รวมตรวจพบ']).toLocaleString()}`
      + ` · ใช้เป็นหลักฐานได้ ${Number(a['รวมหลักฐาน']).toLocaleString()} (${pct}%)`);
  } catch (e) {
    console.error('ล้มเหลว:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
