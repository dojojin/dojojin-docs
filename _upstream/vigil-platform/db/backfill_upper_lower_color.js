// ============================================================
// DojoJin Tech Dashboard — Backfill upper_color / lower_color (one-off)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================
// PURPOSE: เติม upper_color / lower_color ใน rows ที่มี top_color_xyz /
//          bottom_color_xyz แต่ยังไม่มีชื่อสี (ก่อน Phase 5 deploy)
//
// SAFETY:  idempotent — WHERE upper_color IS NULL กัน overwrite ที่มีค่าแล้ว
//          ใช้ xyzToColorName เดียวกับ extractAppearance() ผลตรงกัน
//
// RUN:     node db/backfill_upper_lower_color.js
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
  const { rows } = await pool.query(`
    SELECT id, top_color_xyz, bottom_color_xyz
    FROM appearances
    WHERE (top_color_xyz IS NOT NULL OR bottom_color_xyz IS NOT NULL)
      AND upper_color IS NULL AND lower_color IS NULL
  `);

  console.log(`Found ${rows.length} rows to backfill`);
  if (!rows.length) { await pool.end(); return; }

  let ok = 0, fail = 0;
  for (const row of rows) {
    const upper = xyzToColorName(row.top_color_xyz);
    const lower = xyzToColorName(row.bottom_color_xyz);
    try {
      await pool.query(
        'UPDATE appearances SET upper_color = $1, lower_color = $2 WHERE id = $3',
        [upper, lower, row.id]
      );
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
