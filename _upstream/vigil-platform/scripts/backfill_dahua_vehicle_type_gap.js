#!/usr/bin/env node
// ============================================================
// Vigil Platform — Backfill: Dahua vehicle_type gap (12 categories)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// One-time backfill for the DAHUA_CATEGORY_TO_HIK_VTYPE map extension
// (2026-07-18, dahua-protocol.js). Historical Dahua anprAlarm rows whose
// Vehicle.Category was one of the 12 newly-mapped categories were stored
// with vehicle_type=NULL (the old map didn't cover them) — this fills
// them in from the SAME raw_json.data.Vehicle.Category the live ingester
// now reads, using the identical mapping, so history matches new ingest.
//
// Idempotent: only touches rows where vehicle_type IS NULL. Re-run safe.
// Scoped to Dahua rows only (raw_json->>'vendor'='dahua') — Hikvision rows
// have no data.Vehicle.Category path and are structurally excluded anyway.
//
// Usage (central, where src/.env has DB_*):
//   cd src && set -a && . ./.env && cd .. && node scripts/backfill_dahua_vehicle_type_gap.js
// Options: BATCH (default 25000)
// ============================================================
'use strict';
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, max: 2,
  application_name: 'backfill-dahua-vtype-gap',
});

const BATCH = parseInt(process.env.BATCH, 10) || 25000;

// Mirrors the 12 new entries added to DAHUA_CATEGORY_TO_HIK_VTYPE
// (src/ingesters/dahua-protocol.js, 2026-07-18).
const CASE_SQL = `
  CASE e.raw_json->'data'->'Vehicle'->>'Category'
    WHEN 'Microbus'                     THEN 'van'
    WHEN 'MidPassengerCar'               THEN 'van'
    WHEN 'MPV'                           THEN 'SUVMPV'
    WHEN 'MicroTruck'                    THEN 'truck'
    WHEN 'MidTruck'                      THEN 'truck'
    WHEN 'PassengerCar'                  THEN 'vehicle'
    WHEN 'Bicycle'                       THEN 'twoWheelVehicle'
    WHEN 'Electricbike'                  THEN 'twoWheelVehicle'
    WHEN 'Tricycle'                      THEN 'threeWheelVehicle'
    WHEN 'VanTricycle'                   THEN 'threeWheelVehicle'
    WHEN 'MannedConvertibleTricycle'     THEN 'threeWheelVehicle'
    WHEN 'NoMannedConvertibleTricycle'   THEN 'threeWheelVehicle'
  END`;

(async () => {
  const { rows: [r] } = await pool.query('SELECT MIN(id) lo, MAX(id) hi FROM license_plates');
  if (r.lo == null) { console.log('empty table, nothing to do'); await pool.end(); return; }
  const lo = Number(r.lo), hi = Number(r.hi);
  let updated = 0;
  const t0 = Date.now();
  for (let a = lo; a <= hi; a += BATCH) {
    const b = a + BATCH - 1;
    const res = await pool.query(
      `UPDATE license_plates lp
          SET vehicle_type = ${CASE_SQL}
         FROM events e
        WHERE lp.event_id = e.id
          AND lp.id BETWEEN $1 AND $2
          AND lp.vehicle_type IS NULL
          AND e.raw_json->>'vendor' = 'dahua'
          AND e.raw_json->'data'->'Vehicle'->>'Category' IN (
            'Microbus','MidPassengerCar','MPV','MicroTruck','MidTruck','PassengerCar',
            'Bicycle','Electricbike','Tricycle','VanTricycle',
            'MannedConvertibleTricycle','NoMannedConvertibleTricycle')`,
      [a, b]
    );
    updated += res.rowCount;
    process.stdout.write(`\r  id ${a}..${b}  updated=${updated}   `);
  }
  console.log(`\n✓ backfill done: ${updated} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
})().catch(e => { console.error('backfill error:', e.message); process.exit(1); });
