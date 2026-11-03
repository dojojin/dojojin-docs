#!/usr/bin/env node
// ============================================================
// Vigil Platform — ตั้งเส้นแบ่ง confidence ต่อกล้อง ครั้งเดียวแล้วตรึงไว้
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา: migration 234 · RCA docs/reports/2026-09-18_hkt-helmet-evidence-gap_TH.html
//
// เกณฑ์เดิมคิดเพดานสด ๆ ทุก 6 ชม. จาก max(confidence) 30 วันล่าสุดต่อกล้อง คูณ 0.93
// ซึ่งแปลว่าเพดานขยับเองได้ตลอดเวลา และขยับเมื่อไหร่ตัวเลขย้อนหลังเปลี่ยนตาม
// สคริปต์นี้ "หยุดเวลา" ของสูตรเดิมไว้ที่วันก่อนเกิดเหตุ แล้วเก็บผลเป็นค่าคงที่
// ต่อกล้องลง cameras.plate_conf_floor
//
// ทำไมถึงใช้ค่าที่มีผลอยู่ "ก่อนเกิดเหตุ" เป็นค่าตั้งต้น: มันคือเส้นที่ระบบใช้จริง
// มาตลอดทั้งเดือนที่ตัวเลขนิ่ง (ภูเก็ต 84-85% ทุกวัน) ไม่ต้องคิดค่าใหม่ขึ้นมาเอง
// และไซต์ที่ไม่ได้รับผลกระทบ (หาดใหญ่ RMUTR-V) จะได้ค่าเท่าเดิมเป๊ะ ตัวเลขไม่ขยับ
//
// 🔴 เส้นแบ่งเป็น **รายกล้อง** ไม่ใช่รายยี่ห้อ — วัดจริง 2026-09-18: hdy มีทั้ง
//    กล้องสเกล 0-36 และ 0-100 ปนกันในไซต์เดียวกันและยี่ห้อเดียวกัน
//
// กล้องที่ไม่มีแถว no_helmet ในหน้าต่างที่วัด จะไม่ถูกตั้งค่า (คง NULL = ไม่กรอง)
// ซึ่งเป็นพฤติกรรมเดิมของมันอยู่แล้ว (เกณฑ์เก่าให้ ELSE 0)
//
//   set -a; . ./src/.env; set +a
//   node scripts/seed-plate-conf-floor.js              # ดูค่าที่จะตั้ง (ไม่เขียน)
//   node scripts/seed-plate-conf-floor.js --apply      # เขียนเฉพาะกล้องที่ยังว่าง
//   node scripts/seed-plate-conf-floor.js --apply --force   # เขียนทับของเดิมด้วย
//   node scripts/seed-plate-conf-floor.js --before 2026-09-15   # เปลี่ยนวันตัด
//
// รันซ้ำได้เสมอ โหมดปกติจะไม่แตะกล้องที่ตั้งค่าไว้แล้ว
// ============================================================
'use strict';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env') });
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));
const helmet = require(path.join(SRC, 'helpers', 'helmetCriteria'));

const argv   = process.argv.slice(2);
const APPLY  = argv.includes('--apply');
const FORCE  = argv.includes('--force');
const beforeArg = argv.indexOf('--before');
// ค่าเริ่มต้น = เช้าวันที่กล้องภูเก็ตเปลี่ยนสเกล (ยืนยันจาก license_plates: ไม่มีแถว
// no_helmet ที่ confidence > 90 เลยตลอด 17 ส.ค. ถึง 14 ก.ย. แล้วมี 22,979 แถวในวันที่ 15)
const BEFORE = beforeArg >= 0 ? argv[beforeArg + 1] : '2026-09-15';
const WINDOW_DAYS = helmet.CEILING_DAYS;   // 30 วัน เท่าสูตรเดิม

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  const { rows } = await pool.query(
    `SELECT lp.camera_id,
            COALESCE(s.code, '-')                       AS site,
            max(lp.confidence)                          AS max_conf,
            round((max(lp.confidence) * $3)::numeric, 2) AS floor_new,
            c.plate_conf_floor                          AS floor_now,
            count(*)                                    AS sample_rows
       FROM license_plates lp
       JOIN cameras c  ON c.id = lp.camera_id
       LEFT JOIN sites s ON s.id = c.site_id
      WHERE lp.no_helmet
        AND lp.detected_at >= $1::timestamptz - ($2 || ' days')::interval
        AND lp.detected_at <  $1::timestamptz
      GROUP BY 1, 2, c.plate_conf_floor
      HAVING max(lp.confidence) > 0
      ORDER BY 2, 1`,
    [`${BEFORE} 00:00+07`, String(WINDOW_DAYS), helmet.CONF_RATIO]);

  if (!rows.length) {
    console.log(`ไม่พบแถว no_helmet ในหน้าต่าง ${WINDOW_DAYS} วันก่อน ${BEFORE} — ไม่มีอะไรให้ตั้ง`);
    await pool.end();
    return;
  }

  console.log(`เส้นแบ่งที่คำนวณได้ (max confidence ของ ${WINDOW_DAYS} วันก่อน ${BEFORE} x ${helmet.CONF_RATIO}):\n`);
  console.table(rows.map(r => ({
    camera_id: r.camera_id, site: r.site,
    max_conf: r.max_conf, floor_new: r.floor_new,
    floor_now: r.floor_now ?? '(ว่าง)',
    sample_rows: r.sample_rows,
  })));

  const targets = rows.filter(r => FORCE || r.floor_now === null);
  console.log(`\nกล้องที่จะถูกตั้งค่ารอบนี้: ${targets.length} จาก ${rows.length} ตัว`
    + (FORCE ? ' (โหมด --force เขียนทับของเดิมด้วย)' : ' (ข้ามตัวที่ตั้งไว้แล้ว)'));

  if (!APPLY) {
    console.log('\nโหมดดูอย่างเดียว ยังไม่ได้เขียนอะไร — ใส่ --apply เมื่อพร้อม');
    await pool.end();
    return;
  }
  if (!targets.length) {
    console.log('ไม่มีอะไรต้องเขียน');
    await pool.end();
    return;
  }

  let written = 0;
  for (const r of targets) {
    const res = await pool.query(
      `UPDATE cameras SET plate_conf_floor = $2 WHERE id = $1`,
      [r.camera_id, Number(r.floor_new)]);
    written += res.rowCount;
  }
  console.log(`เขียนแล้ว ${written} กล้อง`);
  await pool.end();
})().catch((e) => { console.error('ล้มเหลว:', e.message); process.exit(1); });
