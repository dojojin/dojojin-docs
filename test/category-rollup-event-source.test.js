// ============================================================
// Vigil Platform — Tests: helpers/categoryRollup.eventSource (รายงานอ่านตารางสรุป + เศษหัว/ท้ายดิบ)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cr = require('../src/helpers/categoryRollup');

test('full 30-minute buckets come from the rollup, the ragged head and tail from raw events', () => {
  const params = ['x'];
  const sql = cr.sourceSql(params, new Date('2026-10-23T00:13:27Z'), new Date('2026-10-23T05:47:05Z'), new Date('2026-10-23T00:30:00Z'), new Date('2026-10-23T05:30:00Z'));
  assert.deepEqual(params.slice(1), ['2026-10-23T00:13:27.000Z', '2026-10-23T05:47:05.000Z', '2026-10-23T00:30:00.000Z', '2026-10-23T05:30:00.000Z']);
  assert.match(sql, /FROM event_dim_bucket d WHERE d\.bucket >= \$4::timestamptz AND d\.bucket < \$5::timestamptz/);
  assert.match(sql, /ev\.event_time >= \$2::timestamptz AND ev\.event_time < \$3::timestamptz AND \(ev\.event_time < \$4::timestamptz OR ev\.event_time >= \$5::timestamptz\)/);
  assert.match(sql, /NULLIF\(d\.rule_name, ''\) AS rule_name/, "'' in the rollup goes back to NULL so category rules match like raw events");
  assert.match(sql, /\) e$/);
});

test('report routes count SUM(e.n) over the source when the range is long enough, raw otherwise', () => {
  const fs = require('fs');
  const rep = fs.readFileSync(require.resolve('../src/routes/stats-report.js'), 'utf8');
  const st = fs.readFileSync(require.resolve('../src/routes/stats.js'), 'utf8');
  assert.match(rep, /ruBD \? 'SUM\(e\.n\)' : 'COUNT\(\*\)'/);
  assert.match(rep, /SUM\(\$\{nEV\}\)::int\s+AS count/);
  assert.match(st, /ruHM \? 'SUM\(e\.n\)' : 'COUNT\(DISTINCT e\.id\)'/);
  assert.match(rep, /ORDER BY count DESC, 1, 2, 3\s+LIMIT 30/, 'ties at the 30th row are decided, not random');
  assert.equal(cr.canUseRollup(0, 2 * 3600e3 - 1), false);
});

test('rollup part never reaches before the oldest event still kept, nor into the last hour', async () => {
  const pool = { query: async () => ({ rows: [{ oldest: '2026-07-17T18:18:46.311Z' }] }) };
  let p = [];
  await cr.eventSource(pool, p, new Date('2026-06-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'), Date.parse('2026-10-26T03:00:00Z'));
  assert.equal(p[2], '2026-07-17T18:30:00.000Z', 'starts at the first full bucket after the oldest event (old path counted 0 before it)');
  p = [];
  await cr.eventSource(pool, p, new Date('2026-10-25T17:00:00Z'), new Date('2026-10-26T03:10:00Z'), Date.parse('2026-10-26T03:10:00Z'));
  assert.equal(p[3], '2026-10-26T02:00:00.000Z', 'the last hour is counted raw');
  p = [];
  await cr.eventSource({ query: async () => ({ rows: [{ oldest: null }] }) }, p, new Date('2026-10-25T00:00:00Z'), new Date('2026-10-25T12:00:00Z'));
  assert.ok(p[2] >= p[3], 'no events at all → no rollup part');
});
