#!/usr/bin/env node
// ============================================================
// Vigil Platform — freeze ตารางใหญ่รายสัปดาห์ (cron ช่วงดึก ก่อน backup 03:04)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: อายุ xid ของระบบโต ~11–15M/วัน (วัด 29 ต.ค.) ⇒ ตารางใหญ่ถึงเพดาน 200M ทุก ~2 สัปดาห์ แล้ว autovacuum จะบังคับ
// freeze ในเวลาที่เลือกไม่ได้ · freeze ด้วยมือ 29 ต.ค. ใช้ตารางละ 1–52 วิ (events_y2026m08/m09, license_plates,
// face_embed_queue) ⇒ ทำให้เป็นงานรายสัปดาห์ ช่วงดึก
//
// 🔴 ต้อง PARALLEL 0 — parallel vacuum ขอ DSM เท่า maintenance_work_mem (1 GB) ชน /dev/shm 1 GB ของ container (ล้มจริง 29 ต.ค.)
// เลือกตาราง public ที่ใหญ่ ≥ 1 GiB (รวม toast/index) และอายุ ≥ 50M (นับ toast ของตัวเองด้วย) เรียงอายุมากสุดก่อน ·
// หยุดทันทีเมื่อเวลาไทยถึง 02:50 (ก่อน backup 03:04) · ตารางหนึ่งพัง log แล้วไปต่อ
// ใช้: node scripts/freeze-big-tables.js [--dry-run]   (dry-run = พิมพ์รายการตาราง ไม่ vacuum — แต่ยังต่อ DB)
// ============================================================
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const env = require(path.join(SRC, 'config'));
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));

const MIN_BYTES = 1073741824; // 1 GiB
const MIN_AGE = 50000000;
const STOP_AT = '02:50';
const AGE_SQL = 'greatest(age(c.relfrozenxid), coalesce(age(t.relfrozenxid), 0))::bigint';
const CANDIDATES_SQL = `SELECT c.oid::regclass::text AS rel,
       greatest(age(c.relfrozenxid), coalesce(age(t.relfrozenxid), 0))::bigint AS age,
       pg_total_relation_size(c.oid)::bigint AS bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
 WHERE c.relkind IN ('r', 'm') AND n.nspname = 'public'
   AND pg_total_relation_size(c.oid) >= $1
   AND greatest(age(c.relfrozenxid), coalesce(age(t.relfrozenxid), 0)) >= $2
 ORDER BY 2 DESC`;
const AGE_ONE_SQL = `SELECT ${AGE_SQL} AS age FROM pg_class c LEFT JOIN pg_class t ON t.oid = c.reltoastrelid WHERE c.oid = $1::regclass`;
const bkk = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000);
const hhmm = () => bkk().toISOString().slice(11, 16);
/** ถึงเวลาหยุดหรือยัง (ช่วงดึกเท่านั้น — ถ้ารันตอนบ่ายไม่ถือว่าเลยเวลา) */
const pastStop = (t = hhmm()) => t >= STOP_AT && t < '12:00';
const log = (...a) => console.log(`[${hhmm()}]`, ...a);

async function main() {
  const dry = process.argv.includes('--dry-run');
  const pool = new Pool({
    ...env.db(), max: 1, options: '-c pg_stat_statements.track=none -c application_name=maint_freeze -c statement_timeout=0 -c maintenance_work_mem=512MB',
  });
  try {
    let rows;
    try { ({ rows } = await pool.query(CANDIDATES_SQL, [MIN_BYTES, MIN_AGE])); }
    catch (e) { console.error('candidate query failed:', e.message); process.exitCode = 1; return; }
    log(`${rows.length} candidate(s)`);
    for (const r of rows) {
      if (dry) { log('dry-run', r.rel, `age=${r.age}`, `${(r.bytes / 2 ** 30).toFixed(1)} GiB`); continue; }
      if (pastStop()) { log(`ถึง ${STOP_AT} แล้ว หยุด (เหลือ ${r.rel} และตารางถัดไป)`); break; }
      if (!/^[a-z0-9_."]+$/i.test(r.rel)) { log('skip unsafe name', r.rel); continue; }
      const t0 = Date.now();
      try {
        await pool.query(`VACUUM (FREEZE, PARALLEL 0) ${r.rel}`);
        const { rows: [a] } = await pool.query(AGE_ONE_SQL, [r.rel]);
        log(r.rel, `age ${r.age} → ${a.age}`, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (e) { log(r.rel, 'ERROR', e.message); }
    }
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { CANDIDATES_SQL, MIN_BYTES, MIN_AGE };
