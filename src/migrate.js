// ============================================================
// DojoJin Tech Dashboard — Schema Migration Runner
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
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
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
