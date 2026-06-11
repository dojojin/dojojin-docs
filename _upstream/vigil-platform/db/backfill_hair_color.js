// ============================================================
// Vigil Platform — Backfill hair_color (one-off)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================
// PURPOSE: เติม hair_color (named) จาก hair_color_xyz ที่มีอยู่แล้ว
//          ใช้ xyzToColorName() เดียวกับ extractAppearance()
// SAFETY:  idempotent — WHERE hair_color IS NULL กัน overwrite
// RUN:     node db/backfill_hair_color.js
// ============================================================

const path = require('path');
require(path.join(__dirname, '..', 'src', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', 'src', '.env') });
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const { xyzToColorName } = require(path.join(__dirname, '..', 'src', 'color-utils'));

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
pool.on('connect', async c => { try { await c.query("SET TIME ZONE 'UTC'"); } catch (_) {} });

async function backfill() {
  const { rows } = await pool.query(
    `SELECT id, hair_color_xyz FROM appearances
     WHERE hair_color_xyz IS NOT NULL AND hair_color IS NULL`
  );
  console.log(`Found ${rows.length} rows to backfill`);
  if (!rows.length) { await pool.end(); return; }

  let ok = 0, fail = 0;
  for (const row of rows) {
    const color = xyzToColorName(row.hair_color_xyz);
    try {
      await pool.query('UPDATE appearances SET hair_color = $1 WHERE id = $2', [color, row.id]);
      ok++;
    } catch (e) {
      console.error(`  FAIL id=${row.id}: ${e.message}`);
      fail++;
    }
  }
  console.log(`Done — updated: ${ok}, failed: ${fail}`);
  await pool.end();
}

backfill().catch(e => { console.error(e); process.exit(1); });
