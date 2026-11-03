// ============================================================
// Vigil Platform — Tests: traffic_daily_stats (migration 274) และอนุกรมรายวันของหน้า Traffic
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตรวจกับ prod (transaction ที่ ROLLBACK 2026-10-22): ผลเท่า query เดิมทุกแถว · 1,308 → 48 ms / 209 → 28 ms
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../src/traffic-stats-refresher.js');

const ref = fs.readFileSync(__dirname + '/../src/traffic-stats-refresher.js', 'utf8');
const traffic = fs.readFileSync(__dirname + '/../src/routes/traffic.js', 'utf8');

test('the daily rollup is rebuilt from whole Thai days of the hourly table, never from raw rows', async () => {
  const seen = [];
  const pool = { query: async (sql, args) => { seen.push({ sql, args }); return { rowCount: 3 }; } };
  const r = await R.refreshTrafficDaily(pool, new Date('2026-10-22T05:00:00Z'));
  assert.equal(r.rows, 3);
  assert.match(seen[0].sql, /FROM traffic_hourly_stats/);
  assert.doesNotMatch(seen[0].sql, /license_plates/);
  assert.match(seen[0].sql, /date_trunc\('day', \$1::timestamptz AT TIME ZONE 'Asia\/Bangkok'\) AT TIME ZONE 'Asia\/Bangkok'/);
  assert.match(seen[0].sql, /ON CONFLICT \(day, camera_id, vehicle_type\) DO UPDATE/);
});

test('the 15-minute tick and the nightly reconcile both refresh it, and prune keeps one extra day', () => {
  assert.match(ref, /await refreshWindow\(_pool, LOOKBACK_HOURS\);\s*const daily = await refreshTrafficDaily\(_pool/);
  assert.match(ref, /await refreshWindow\(_pool, RECONCILE_HOURS\);\s*await refreshTrafficDaily\(_pool/);
  assert.match(ref, /DELETE FROM traffic_daily_stats WHERE day < \(NOW\(\) AT TIME ZONE 'Asia\/Bangkok'\)::date - \$1::int - 1/);
});

test('both 120-day series on the Traffic page read the daily table from the same first day as before', () => {
  const uses = traffic.match(/FROM traffic_daily_stats t/g) || [];
  assert.equal(uses.length, 2);
  const bound = /WHERE t\.day >= \(\(date_trunc\('day', now\(\)\) - interval '120 days'\) AT TIME ZONE '\$\{TZ\}'\)::date/g;
  assert.equal((traffic.match(bound) || []).length, 2);
  // heatmap ชั่วโมง×วันในสัปดาห์ และตารางรายกล้อง (มีช่วงกลางคืน) ต้องยังอ่านรายชั่วโมง
  assert.match(traffic, /extract\(isodow FROM t\.bucket_hour/);
});
