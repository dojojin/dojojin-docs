#!/usr/bin/env node
// ============================================================
// Vigil Platform — เติมผล "พร้อมข้อมูลทะเบียน" ให้แถวเก่า (migration 234)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// migration 234 เพิ่มคอลัมน์แบบ NULL ได้โดยตั้งใจ (ADD COLUMN ที่ไม่มี default เป็น
// metadata-only จึงจบใน 18 ms แม้ตารางจะ 26 GB) แถวเก่าจึงยังไม่ถูกตัดสิน
// สคริปต์นี้ตัดสินให้ครบด้วย **เส้นแบ่งของกล้องตัวนั้น** ที่ seed ไว้แล้ว
//
// 🔴 ต้องรันให้จบก่อนเปลี่ยนเส้นทางอ่านมาใช้คอลัมน์นี้ ไม่งั้นแถวที่ยังเป็น NULL
//    จะถูกนับเป็น "ไม่ผ่าน" ทั้งที่แค่ยังไม่ได้ตัดสิน (ตัวเลขจะหายไปทั้งก้อน)
//
// แตะเฉพาะแถว no_helmet เท่านั้น (3.27 ล้านจาก 41.7 ล้านแถว = 8% ของตาราง)
// เพราะทุกจุดที่ใช้เกณฑ์นี้ในระบบอยู่ใน FILTER ที่มี no_helmet อยู่แล้วทั้งหมด
// (ตรวจแล้วทั้ง 6 จุด: traffic.js, traffic-report-pdf.js, lpr-query.js x3, lpr-list.js)
//
// ซอยเป็นรายวันเพื่อไม่ให้มีคำสั่งไหนยาวจนชน statement_timeout ของ pool
// idempotent — แตะเฉพาะแถวที่ plate_identified ยังเป็น NULL รันซ้ำได้เสมอ
//
//   set -a; . ./src/.env; set +a
//   node scripts/backfill-plate-identified.js             # ทั้ง retention (100 วัน)
//   node scripts/backfill-plate-identified.js --days 30
//   node scripts/backfill-plate-identified.js --dry-run   # นับว่าเหลือกี่แถว
// ============================================================
'use strict';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env') });
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));
const helmet = require(path.join(SRC, 'helpers', 'helmetCriteria'));

const argv = process.argv.slice(2);
const DRY  = argv.includes('--dry-run');
const dIdx = argv.indexOf('--days');
const DAYS = dIdx >= 0 ? Number(argv[dIdx + 1]) : 100;   // = lpr_retention_days

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  const left = await pool.query(
    `SELECT count(*)::bigint AS n FROM license_plates
      WHERE no_helmet AND plate_identified IS NULL
        AND detected_at > now() - ($1 || ' days')::interval`, [String(DAYS)]);
  console.log(`แถวที่ยังไม่ถูกตัดสินในช่วง ${DAYS} วัน: ${Number(left.rows[0].n).toLocaleString()}`);
  if (DRY) { await pool.end(); return; }

  let total = 0;
  const t0 = Date.now();
  // 🔴 หมุดเวลาต้องคิดครั้งเดียวแล้วส่งเข้าไป ห้ามเรียก now() ในแต่ละ chunk —
  // now() ขยับไปข้างหน้าระหว่างที่ลูปวิ่ง (รันจริง 100 chunk ใน 276 วินาที) ทำให้
  // ขอบบนของ chunk ก่อนหน้ามาก่อนขอบล่างของ chunk ถัดไป เปิดรูราว 2.8 วินาทีทุก
  // รอยต่อ รอบแรกจึงเหลือแถว no_helmet ที่ไม่ถูกตัดสิน 40 แถวกระจายวันละ 1-3 แถว
  const anchor = new Date().toISOString();
  for (let d = DAYS; d > 0; d--) {
    const tDay = Date.now();
    const r = await pool.query(
      `UPDATE license_plates lp
          SET plate_identified =
                (lp.plate_number ~ $1)
                AND COALESCE(lp.confidence >= (SELECT c.plate_conf_floor
                                                 FROM cameras c WHERE c.id = lp.camera_id), TRUE)
        WHERE lp.no_helmet
          AND lp.plate_identified IS NULL
          AND lp.detected_at >= $2::timestamptz - ($3 || ' days')::interval
          ${d > 1 ? `AND lp.detected_at < $2::timestamptz - ($4 || ' days')::interval` : ''}`,
      d > 1 ? [helmet.PLATE_OK, anchor, String(d), String(d - 1)]
            : [helmet.PLATE_OK, anchor, String(d)]);
    total += r.rowCount;
    if (r.rowCount) {
      console.log(`  -${d} วัน: ${r.rowCount.toLocaleString()} แถว (${Date.now() - tDay} ms)`);
    }
  }
  console.log(`เสร็จ: ${total.toLocaleString()} แถว ใน ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`);

  const after = await pool.query(
    `SELECT count(*) FILTER (WHERE plate_identified) AS pass,
            count(*) FILTER (WHERE NOT plate_identified) AS fail,
            count(*) FILTER (WHERE plate_identified IS NULL) AS undecided
       FROM license_plates
      WHERE no_helmet AND detected_at > now() - ($1 || ' days')::interval`, [String(DAYS)]);
  console.table(after.rows);
  await pool.end();
})().catch((e) => { console.error('ล้มเหลว:', e.message); process.exit(1); });
