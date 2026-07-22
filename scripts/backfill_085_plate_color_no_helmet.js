#!/usr/bin/env node
// ============================================================
// Vigil Platform — Backfill #085: license_plates.plate_color + no_helmet
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// One-time backfill for migration 085. Copies the two attributes the LPR stats
// endpoint used to read from events.raw_json (a 3.8s Seq Scan + JSONB detoast)
// into the new plain columns on license_plates:
//   plate_color = raw_json->>'plateColor'
//   no_helmet   = (raw_json->>'helmet' = 'no')   -- NULL/false = not flagged
//
// SINGLE SOURCE: reads the SAME events.raw_json the old query read, so the
// column values are identical to what the KPI/pcolor produced before → the
// before/after audit is an exact match.
//
// Batched by id (autocommit per batch → short locks, no long lock on
// license_plates while ingest runs ~3 rows/s). Idempotent: re-run after the
// api-server restart to catch rows that arrived during the deploy gap.
//
// Usage (central, where src/.env has DB_*):
//   cd src && set -a && . ./.env && cd .. && node scripts/backfill_085_plate_color_no_helmet.js
// Options: BATCH (default 25000)
// ============================================================
'use strict';
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 2,
  application_name: 'backfill-085',
});

const BATCH = parseInt(process.env.BATCH, 10) || 25000;

(async () => {
  const { rows: [r] } = await pool.query('SELECT MIN(id) lo, MAX(id) hi FROM license_plates');
  if (r.lo == null) { console.log('empty table, nothing to do'); await pool.end(); return; }
  const lo = Number(r.lo), hi = Number(r.hi);
  let updated = 0;
  const t0 = Date.now();
  for (let a = lo; a <= hi; a += BATCH) {
    const b = a + BATCH - 1;
    // Only touch rows still missing plate_color → idempotent + cheap on re-run.
    // no_helmet rides along in the same UPDATE (same source row).
    const res = await pool.query(
      `UPDATE license_plates lp
          SET plate_color = e.raw_json->>'plateColor',
              no_helmet   = (e.raw_json->>'helmet' = 'no')
         FROM events e
        WHERE lp.event_id = e.id
          AND lp.id BETWEEN $1 AND $2
          AND lp.plate_color IS NULL`,
      [a, b]
    );
    updated += res.rowCount;
    process.stdout.write(`\r  id ${a}..${b}  updated=${updated}   `);
  }
  console.log(`\n✓ backfill done: ${updated} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
})().catch(e => { console.error('backfill error:', e.message); process.exit(1); });
