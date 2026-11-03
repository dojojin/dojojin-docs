#!/usr/bin/env node
// ============================================================
// Vigil Platform — backfill appearance_dim_daily (migration 276) จาก appearances
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
//   set -a; . ./src/.env; set +a
//   PGOPTIONS='-c pg_stat_statements.track=none' node scripts/backfill-appearance-dims.js [--days 41]
// ทีละวันไทย (ขอบตรงต้นวันทั้งสองฝั่ง — ตัวสรุปลบทั้งวันที่แตะ) · ข้อมูลดิบเก็บ 40 วัน ⇒ ย้อนได้เท่านั้น · รันซ้ำได้
// ============================================================
'use strict';
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const refresher = require(path.join(__dirname, '..', 'src', 'traffic-stats-refresher.js'));
const i = process.argv.indexOf('--days');
const DAYS = i > -1 ? Number(process.argv[i + 1]) : 41;

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, max: 1, application_name: 'backfill-appearance-dims',
  });
  try {
    const D = 86400_000, t0 = Date.now();
    const todayTh = Math.floor((Date.now() + 7 * 3600_000) / D) * D - 7 * 3600_000;   // ต้นวันไทยวันนี้
    for (let d = DAYS; d >= 0; d--) {
      const from = new Date(todayTh - d * D);
      const r = await refresher.refreshAppearanceDims(pool, from, d ? new Date(todayTh - (d - 1) * D) : null);
      console.log(`  ${new Date(from.getTime() + 7 * 3600_000).toISOString().slice(0, 10)} → ${r.rows} แถว · ${(r.ms / 1000).toFixed(1)} วิ`);
    }
    const { rows: [c] } = await pool.query('SELECT count(*)::int n, min(day)::text lo, max(day)::text hi FROM appearance_dim_daily');
    console.log(`รวม ${((Date.now() - t0) / 1000).toFixed(1)} วิ · appearance_dim_daily ${c.n} แถว (${c.lo} → ${c.hi})`);
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
