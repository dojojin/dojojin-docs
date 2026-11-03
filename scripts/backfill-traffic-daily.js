#!/usr/bin/env node
// ============================================================
// Vigil Platform — backfill traffic_daily_stats (migration 274) จาก traffic_hourly_stats
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
//   set -a; . ./src/.env; set +a
//   PGOPTIONS='-c pg_stat_statements.track=none' node scripts/backfill-traffic-daily.js [--days 122] [--chunk 7]
// อ่านตารางรายชั่วโมงเท่านั้น (ไม่แตะข้อมูลดิบ) · ก้อนตัดตรงขอบวันไทย · รันซ้ำได้ (upsert ชุดเดียวกับตัวสรุป)
// ============================================================
'use strict';
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const refresher = require(path.join(__dirname, '..', 'src', 'traffic-stats-refresher.js'));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const DAYS = Number(arg('days', 122));
const CHUNK = Number(arg('chunk', 7));

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, max: 1, application_name: 'backfill-traffic-daily',
  });
  try {
    const { rows: [b] } = await pool.query(
      `SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok') AS today_start`);
    const today = new Date(b.today_start), D = 86400_000, t0 = Date.now();
    for (let d = DAYS; d > 0; d -= CHUNK) {
      const from = new Date(today.getTime() - d * D);
      const isLast = d - CHUNK <= 0;
      const r = await refresher.refreshTrafficDaily(pool, from, isLast ? null : new Date(from.getTime() + CHUNK * D));
      console.log(`  ${new Date(from.getTime() + 7 * 3600_000).toISOString().slice(0, 10)} +${Math.min(CHUNK, d)} วัน → ${r.rows} แถว · ${r.ms} ms`);
    }
    const { rows: [c] } = await pool.query('SELECT count(*)::int n, min(day)::text lo, max(day)::text hi FROM traffic_daily_stats');
    console.log(`รวม ${((Date.now() - t0) / 1000).toFixed(1)} วิ · traffic_daily_stats ${c.n} แถว (${c.lo} → ${c.hi})`);
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
