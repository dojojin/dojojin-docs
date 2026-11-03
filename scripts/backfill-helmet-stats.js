#!/usr/bin/env node
// ============================================================
// Vigil Platform — คำนวณตารางสรุปหมวกนิรภัยย้อนหลังด้วยเกณฑ์ปัจจุบัน
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมต้องมี: เกณฑ์กลาง (helmetCriteria) เปลี่ยนไปแล้วสองครั้ง —
//   2026-08-22 เพดาน confidence ย้ายจาก 24 ชม. เป็น 30 วัน
//   2026-08-27 หน้าอันดับเลิกใช้เกณฑ์ของตัวเอง มาใช้เกณฑ์กลาง
// แต่ bucket ที่คำนวณไว้ก่อนหน้านั้นยังเป็นค่าที่คิดด้วยเกณฑ์เก่า และ refresher
// ปกติแตะย้อนหลังแค่ 3 ชม. (reconcile 7 วันตอนตี 3) ⇒ ข้อมูลเก่ากว่านั้นค้างเป็น
// เกณฑ์เดิมตลอดไป
//
// ⚠️ n_no_helmet_ok = NULL ใน lpr_hourly_stats **ไม่ใช่** ช่องว่างที่ต้อง backfill —
// ตรวจแล้ว 2026-08-27: NULL ทั้ง 1,205 แถวเป็น bucket ที่มี event แต่ไม่มีป้ายเลย
// (รอบที่อ่านจาก events เขียนเฉพาะ n_vehicle_events ปล่อยคอลัมน์ฝั่งป้ายเป็น NULL
// โดยตั้งใจ — ดูคอมเมนต์ "สองรอบแรกเขียนคนละคอลัมน์" ในตัว refresher)
// ช่องว่างจริงคือแถวที่ n_total ไม่ NULL แต่ n_no_helmet_ok NULL ซึ่งมี 0 แถว
//
// idempotent — ทั้งสองตารางใช้ ON CONFLICT DO UPDATE รันซ้ำกี่รอบก็ได้ค่าเดิม
//
// ใช้: node scripts/backfill-helmet-stats.js [จำนวนวัน]   (ค่าเริ่มต้น 30)
// ============================================================
'use strict';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env') });

const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));
const helmet = require(path.join(SRC, 'helpers', 'helmetCriteria'));
const refresher = require(path.join(SRC, 'traffic-stats-refresher'));

const DAYS  = Number(process.argv[2] || 30);
const CHUNK = 7;   // วัดแล้ว: 7 วัน ≈ 5 วิ · 30 วันรวดเดียว 29 วิ

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  // เกณฑ์อ่านจาก license_plates.plate_identified ที่ตัดสินไว้ตอน INSERT แล้ว
  // (migration 234) คำนวณซ้ำกี่รอบก็ได้ค่าเดิม ไม่มีอะไรต้องอุ่นก่อน
  console.log('เกณฑ์: อ่านผลที่ตรึงไว้ตอนบันทึก (license_plates.plate_identified)');
  console.log(`ย้อนหลัง ${DAYS} วัน · ก้อนละ ${CHUNK} วัน\n`);

  // ไล่จากเก่าไปใหม่ ให้ก้อนที่ใกล้ปัจจุบันที่สุดถูกเขียนท้ายสุด — ถ้าสคริปต์ถูกฆ่า
  // กลางทาง ข้อมูลล่าสุดจะยังเป็นของเดิมที่ refresher ปกติดูแลอยู่ ไม่ใช่ค่าครึ่ง ๆ
  const edges = [];
  for (let d = DAYS; d > 0; d -= CHUNK) edges.push([d, Math.max(0, d - CHUNK)]);

  let totalRows = 0;
  for (const [fromD, toD] of edges) {
    const label = `${fromD} → ${toD} วันก่อน`;
    const a = await refresher.refreshWindow(pool, fromD * 24, toD > 0 ? toD * 24 : null);
    const since = new Date(Date.now() - fromD * 86400000);
    const until = toD > 0 ? new Date(Date.now() - toD * 86400000) : null;
    // refreshLprWindow คืน { plates, events, dims, ms } ไม่ใช่ { rows } — คนละรูป
    // กับ refreshWindow · อ่านผิดแล้วรายงานเป็น 0 ทั้งที่เขียนจริง (พลาดมาแล้ว)
    const b = await refresher.refreshLprWindow(pool, since, until);
    totalRows += a.rows + b.plates;
    console.log(`  ${label.padEnd(20)} traffic ${String(a.rows).padStart(7)} (${(a.ms / 1000).toFixed(1)}s)` +
                ` · lpr ป้าย ${String(b.plates).padStart(6)} · มิติ ${String(b.dims).padStart(6)}` +
                ` (${(b.ms / 1000).toFixed(1)}s)`);
  }

  console.log(`\nรวม ${totalRows.toLocaleString()} bucket`);

  // ช่องว่างจริง = มีข้อมูลป้าย (n_total) แต่ไม่มีเลขหมวก · ต้องเป็น 0 เสมอ
  // (NULL ที่มาคู่กับ n_total NULL คือ bucket ที่ไม่มีป้ายเลย ซึ่งถูกต้องแล้ว)
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE n_no_helmet_ok IS NULL AND n_total IS NOT NULL)::int gap,
            count(*) FILTER (WHERE n_no_helmet_ok IS NULL AND n_total IS NULL)::int no_plate,
            count(*)::int n
       FROM lpr_hourly_stats WHERE bucket_hour > now() - ($1 || ' days')::interval`,
    [String(DAYS)]);
  const r = rows[0];
  console.log(`lpr_hourly_stats ${DAYS} วันล่าสุด: ${r.n} bucket · ` +
              `ช่องว่างจริง ${r.gap} · ไม่มีป้ายเลย ${r.no_plate}`);
  if (r.gap > 0) { console.error('🔴 ยังมีช่องว่างเหลือ — backfill ไม่ครบ'); process.exitCode = 1; }

  await pool.end();
})().catch((e) => { console.error('ล้มเหลว:', e.message); process.exit(1); });
