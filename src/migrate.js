// ============================================================
// Vigil Platform — Schema Migration Runner
// CCTV Analytics & Management Suite
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
//
// Why this exists:
//   /docker-entrypoint-initdb.d/init.sql only runs ONCE — on the
//   very first boot of an empty postgres data volume. After that,
//   every edit to init.sql is invisible to the live DB. Before
//   this runner, the only way to apply new schema was the nuclear
//   `docker compose down -v` (lost all events + users).
//
// What this does:
//   On api-server boot, scan db/db_migration_*.sql, skip files
//   already recorded in schema_migrations, run pending ones in
//   alphabetical order inside transactions, record success.
//
// Migration files MUST be idempotent (IF NOT EXISTS / ON CONFLICT)
// — they run on fresh DBs (where init.sql already created the
// schema) AND on legacy DBs (where init.sql was older).
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATION_DIR = path.join(__dirname, '..', 'db');
const FILE_PATTERN = /^db_migration_.*\.sql$/;

async function runMigrations(pool, opts = {}) {
  const log = opts.log || console.log;
  const err = opts.err || console.error;

  // 1. Bootstrap: ensure schema_migrations table exists before we
  //    can record anything. This duplicates db_migration_000_*.sql
  //    intentionally — the runner has to be able to track itself.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename     TEXT PRIMARY KEY,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms  INT,
      checksum     TEXT
    )
  `);

  // 2. List migration files on disk (alphabetical order matters).
  let files;
  try {
    files = fs.readdirSync(MIGRATION_DIR)
      .filter(f => FILE_PATTERN.test(f))
      .sort();
  } catch (e) {
    err(`  ❌ Cannot read migration dir ${MIGRATION_DIR}:`, e.message);
    throw e;
  }

  // 3. Already-applied set.
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  // 4. Run pending in transactions.
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const fullPath = path.join(MIGRATION_DIR, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
    const t0 = Date.now();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 🔴 migration ต้องไม่โดนนาฬิกาจับตาย — เพดานที่ล้อมอยู่รอบตัวมันทุกชั้น
      // เล็กกว่างานที่มันต้องทำ: pool ของ api-server (ผู้เรียกจริงตอน boot)
      // ตั้ง statement_timeout ไว้ 120s และ role ตั้งไว้ 15 นาที (migration 181)
      // ⇒ migration ที่แตะตารางใหญ่ (events หลักล้านแถว) จะถูกฆ่ากลางคัน แล้ว
      // startup abort ทั้งระบบตามดีไซน์ (STUBBORN_FACT #81) ทั้งที่ตัว SQL ไม่ได้ผิด
      // ปลดเฉพาะใน transaction นี้ — จบ transaction ก็กลับไปใช้ค่าของ pool เดิม
      // (LOCAL = ผูกกับ transaction ไม่รั่วไปหา query อื่นที่ยืม connection ต่อ)
      await client.query('SET LOCAL statement_timeout = 0');
      await client.query('SET LOCAL idle_in_transaction_session_timeout = 0');
      // ...แต่ปลดเพดานเฉย ๆ ก็แลกปัญหาเดิมกับปัญหาใหม่ที่แย่กว่า: migration ที่
      // ติด lock จะรอ "ตลอดไป" และ api-server ค้างตอน boot แบบไม่มี error ให้ดู
      // (ของเดิมอย่างน้อยตายที่ 120s พร้อมข้อความ) · lock_timeout แยกสองเรื่องนี้
      // ออกจากกัน — จำกัดเฉพาะ "เวลารอ lock" ไม่จำกัดเวลาทำงานจริงบนตารางใหญ่
      await client.query("SET LOCAL lock_timeout = '30s'");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename, duration_ms, checksum)
         VALUES ($1, $2, $3)
         ON CONFLICT (filename) DO NOTHING`,
        [file, Date.now() - t0, checksum]
      );
      await client.query('COMMIT');
      ran++;
      log(`  ✅ migration applied: ${file} (${Date.now() - t0}ms)`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      err(`  ❌ migration FAILED: ${file}\n     ${e.message}`);
      throw e;
    } finally {
      client.release();
    }
  }

  if (ran === 0) {
    log(`  ✓ schema up-to-date (${applied.size + ran} migration(s) on record)`);
  } else {
    log(`  ✓ applied ${ran} new migration(s)`);
  }

  return { ran, total: files.length };
}

// Standalone CLI: `node migrate.js` for ad-hoc runs (CI, manual ops).
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const env = require('./config');
  const { Pool } = require('pg');
  const pool = new Pool({
    ...env.db(),
    max: 2,
    application_name: 'migrate',
  });

  (async () => {
    console.log('▶ Running schema migrations...');
    try {
      await runMigrations(pool);
      await pool.end();
      process.exit(0);
    } catch (e) {
      await pool.end().catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { runMigrations };
