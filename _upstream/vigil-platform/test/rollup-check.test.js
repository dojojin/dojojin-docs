// ============================================================
// Vigil Platform — Tests: helpers/rollupCheck.js (ตารางสรุปเทียบนับดิบ · GOTCHAS #237)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rc = require('../src/helpers/rollupCheck');
const kpi = require('../src/kpi-stats-refresher');

test('the raw count uses the exact filter the refresher uses to fill event_kpi_hourly', () => {
  const fs = require('fs'); const src = fs.readFileSync(require.resolve('../src/kpi-stats-refresher'), 'utf8');
  assert.match(src, /AND camera_id IS NOT NULL\s+AND \$\{METRIC_EVENT_FILTER\}/);
  assert.match(rc.CHECKS.event_kpi_hourly.raw, /camera_id IS NOT NULL AND event_type NOT LIKE '%Aggregation%'/);
  assert.ok(kpi);
});

test('run stores raw vs rollup per table under the Thai day, and never throws', async () => {
  const store = {};
  const pool = { query: async (sql, args) => {
    if (/FROM events/.test(sql)) return { rows: [{ n: '971324' }] };
    if (/FROM event_kpi_hourly/.test(sql)) return { rows: [{ n: '945023' }] };
    if (/SELECT value FROM system_settings/.test(sql)) return { rows: store.v ? [{ value: store.v }] : [] };
    if (/INSERT INTO system_settings/.test(sql)) { store.v = args[1]; return { rows: [] }; }
    throw new Error('unexpected');
  } };
  const r = await rc.run(pool, 'event_kpi_hourly', new Date('2026-10-22T17:00:00Z'), new Date('2026-10-23T17:00:00Z'));
  assert.deepEqual([r.day, r.raw, r.rollup], ['2026-10-23', 971324, 945023]);
  assert.equal(JSON.parse(store.v).event_kpi_hourly.raw, 971324);
  assert.equal(await rc.run({ query: async () => { throw new Error('db down'); } }, 'lpr_hourly_stats', new Date(), new Date()), null);
});

test('judge: flags a real gap, ignores tiny drift, and notices a check that stopped running', () => {
  const all = {
    event_kpi_hourly: { day: '2026-10-25', raw: 971324, rollup: 945023 },
    lpr_hourly_stats: { day: '2026-10-25', raw: 500000, rollup: 499990 },
  };
  const r = rc.judge(all, '2026-10-25');
  assert.equal(r.length, 1); assert.equal(r[0].table, 'event_kpi_hourly'); assert.equal(r[0].diff, 26301);
  assert.deepEqual(rc.judge({ lpr_hourly_stats: { day: '2026-10-22', raw: 1, rollup: 1 } }, '2026-10-25'), [{ table: 'lpr_hourly_stats', why: 'stale', day: '2026-10-22' }]);
  assert.deepEqual(rc.judge(null, '2026-10-25'), []);
});

test('late arrivals: only cameras over the floor are kept, and only a recent run is reported', async () => {
  const store = {};
  const pool = { query: async (sql, args) => {
    if (/SELECT value/.test(sql)) return { rows: store.v ? [{ value: store.v }] : [] };
    store.v = args[1]; return { rows: [] };
  } };
  await rc.recordLate(pool, [{ day: '2026-10-23', camera_id: 'C9-KAR-SB-04', added: 26301 }, { day: '2026-10-23', camera_id: 'Y', added: 12 }]);
  const all = JSON.parse(store.v);
  assert.deepEqual(rc.judgeLate(all).map((x) => x.camera_id), ['C9-KAR-SB-04']);
  assert.deepEqual(rc.judgeLate(all, Date.now() + 3 * 86400_000), [], 'stale run is not re-alerted');
  assert.deepEqual(rc.judge(all, '2026-10-25'), [], '_late is not a table');
});
