// ============================================================
// Vigil Platform — Tests: สถิติคนรายวัน (appearance_dim_daily · migration 276)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตรวจกับ prod (transaction ที่ ROLLBACK 2026-10-22): 12 มิติ × 3 วันตรงกับนับตรงทุกตัว · เพศตรงสูตรหน้าจอสถิติคน
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../src/traffic-stats-refresher.js');

const ref = fs.readFileSync(__dirname + '/../src/traffic-stats-refresher.js', 'utf8');

test('rollup counts by event_time Thai day, object_class over everything, person traits over Person only', async () => {
  let sql = '';
  await R.refreshAppearanceDims({ query: async (s) => { sql = s; return { rowCount: 0 }; } }, new Date());
  assert.match(sql, /\(event_time AT TIME ZONE 'Asia\/Bangkok'\)::date AS day/);
  assert.match(sql, /'object_class' AS dim, object_class AS value, count\(\*\)::int AS n FROM src GROUP BY/);
  for (const k of ['gender', 'age_group', 'hat', 'mask', 'expression', 'bag_category']) {
    assert.match(sql, new RegExp(`'${k}', ${k}, count\\(\\*\\)::int FROM src WHERE object_class = 'Person'`), k);
  }
  assert.match(sql, /COALESCE\(age_group, rj_age_group\)/, 'age as the dashboard reads it');
  assert.match(sql, /DELETE FROM appearance_dim_daily d USING touched t WHERE d\.day = t\.day/);
});

test('nightly reconcile walks whole Thai days, and the rollup is kept 365 days', () => {
  assert.match(ref, /for \(const \[since, until, d\] of windows\) \{\s*try \{ await refreshAppearanceDims\(_pool, since, until\); \}/);
  assert.match(ref, /DELETE FROM appearance_dim_daily WHERE day < \(NOW\(\) AT TIME ZONE 'Asia\/Bangkok'\)::date - 365/);
});
