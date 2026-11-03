#!/usr/bin/env node
// ============================================================
// Vigil Platform — คืนพื้นที่ตาราง cameras (VACUUM FULL แบบมีตัวกันล็อกค้าง)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมไม่อยู่ใน migration: migrate.js ห่อทุก migration ด้วย BEGIN/COMMIT และ
// VACUUM รันใน transaction block ไม่ได้ ("VACUUM cannot run inside a transaction
// block") · migration ที่ throw จะทำให้ api-server บูตไม่ขึ้น (STUBBORN_FACT #81)
// ⇒ ต้องเป็นขั้นตอนปฏิบัติการแยก รันตอนที่เลือกจังหวะได้
//
// 🔴 VACUUM FULL ถือ ACCESS EXCLUSIVE = บล็อกคนอ่านทุกคน และที่แย่กว่านั้นคือ
// คำขอล็อกที่ "กำลังรอ" จะทำให้คนอ่านที่มาทีหลังต่อคิวอยู่ข้างหลังด้วย ⇒ หยุด
// ingest ตั้งแต่ก่อนมันจะเริ่มทำงานจริง · ingester ตั้ง statement_timeout ไว้ 60
// วินาที ถ้ารอเกินนั้นจะกลายเป็นคิวรีตายและ event หาย ไม่ใช่แค่ช้า
// ⇒ ตั้ง lock_timeout ให้มัน "ยอมแพ้แล้วถอย" แทนการต่อคิว
//
// ⚠️ ต้องรันหลังจากตั้ง fillfactor แล้วเท่านั้น (migration 182) — ALTER TABLE
// ไม่เขียนหน้าเดิมใหม่ VACUUM FULL ต่างหากที่เขียน ถ้ารันสลับลำดับจะได้ตารางที่
// อัดแน่นจนไม่เหลือที่ให้ HOT update แล้วต้องมารันซ้ำอีกรอบ
//
// ใช้: set -a; . ./src/.env; set +a; node scripts/vacuum-cameras.js [ชื่อตาราง]
// ============================================================
'use strict';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env') });
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));

const TABLE = process.argv[2] || 'cameras';
if (!/^[a-z_][a-z0-9_]*$/i.test(TABLE)) { console.error('ชื่อตารางผิดรูป'); process.exit(1); }
const LOCK_TIMEOUT = process.env.VACUUM_LOCK_TIMEOUT || '3s';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, max: 2,
  // VACUUM FULL ต้องมีเวลาทำงาน — เพดาน statement ของ pool อื่นสั้นเกินไปสำหรับมัน
  options: '-c statement_timeout=600000',
});

const size = async () => (await pool.query(
  `SELECT pg_size_pretty(pg_total_relation_size($1)) tot,
          pg_size_pretty(pg_relation_size($1)) heap,
          pg_total_relation_size($1) bytes`, [TABLE])).rows[0];

const stat = async () => (await pool.query(
  `SELECT n_live_tup live, n_dead_tup dead,
          round(100.0*n_tup_hot_upd/NULLIF(n_tup_upd,0),2) hot_pct
     FROM pg_stat_user_tables WHERE relname = $1`, [TABLE])).rows[0];

const timeSelect = async () => {
  const t0 = Date.now();
  await pool.query(`SELECT * FROM ${TABLE}`);
  return Date.now() - t0;
};

(async () => {
  const before = await size(), sb = await stat(), msB = await timeSelect();
  console.log(`  ก่อน: ${before.tot} (heap ${before.heap}) · live ${sb.live} dead ${sb.dead} · HOT ${sb.hot_pct}% · SELECT * ${msB}ms`);

  const c = await pool.connect();
  const t0 = Date.now();
  try {
    // ยอมแพ้แทนการต่อคิว — คำขอ ACCESS EXCLUSIVE ที่รออยู่จะดันให้คนอ่านที่มา
    // ทีหลังติดคิวตามไปด้วย ซึ่งอันตรายกว่าตัวการ vacuum เอง
    await c.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await c.query(`VACUUM (FULL, ANALYZE) ${TABLE}`);
  } catch (e) {
    console.error(`  🔴 ไม่สำเร็จหลังรอ ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message}`);
    console.error('     (ล็อกไม่ว่าง — ลองใหม่ตอนที่ traffic น้อยลง ไม่มีอะไรเสียหาย)');
    c.release(); await pool.end(); process.exit(1);
  }
  const took = Date.now() - t0;
  c.release();

  const after = await size(), sa = await stat(), msA = await timeSelect();
  console.log(`  หลัง: ${after.tot} (heap ${after.heap}) · live ${sa.live} dead ${sa.dead} · SELECT * ${msA}ms`);
  console.log(`\n  ใช้เวลา ${(took / 1000).toFixed(1)}s (ตารางถูกล็อกช่วงนี้)`);
  console.log(`  คืนพื้นที่ ${((before.bytes - after.bytes) / 1024 / 1024).toFixed(0)} MB · SELECT เร็วขึ้น ${msB}ms → ${msA}ms`);
  console.log(`  HOT ratio จะไต่ขึ้นจาก ${sb.hot_pct}% ในชั่วโมงถัดไป (ตัวเลขนี้เป็นยอดสะสม จึงขยับช้า)`);
  await pool.end();
})().catch((e) => { console.error('ล้มเหลว:', e.message); process.exit(1); });
