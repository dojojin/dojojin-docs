// ============================================================
// Vigil Platform — Tests: event_kpi_hourly reconcile (เก็บตกของที่มาช้า · GOTCHAS #237)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const kpi = require('../src/kpi-stats-refresher');

function fakePool() {
  const seen = [];
  return { seen, query: async (sql, params) => {
    seen.push({ sql, params });
    if (/SELECT now\(\) AS cut/.test(sql)) return { rows: [{ cut: 'DB-NOW' }] };
    return { rows: [], rowCount: 1 };
  } };
}

test('refreshRange sweeps with the database clock, never the Node clock (inside a transaction NOW() is older)', async () => {
  const p = fakePool();
  await kpi.refreshRange(p, new Date('2026-10-22T17:00:00Z'), new Date('2026-10-23T17:00:00Z'));
  const del = p.seen.find((q) => /DELETE FROM event_kpi_hourly/.test(q.sql));
  assert.equal(del.params[2], 'DB-NOW');
  const ins = p.seen.find((q) => /INSERT INTO event_kpi_hourly/.test(q.sql));
  assert.match(ins.sql, /event_time >= \$1::timestamptz AND \(\$5::timestamptz IS NULL OR event_time < \$5::timestamptz\)/);
  assert.deepEqual([ins.params[0], ins.params[4]], ['2026-10-22T17:00:00.000Z', '2026-10-23T17:00:00.000Z']);
});

test('reconcile walks one Thai day at a time over the table lifetime, and a failed day does not stop the rest', async () => {
  const p = fakePool(); let calls = 0;
  const q = p.query;
  p.query = async (sql, params) => { if (/INSERT INTO event_kpi_hourly/.test(sql) && ++calls === 2) throw new Error('boom'); return q(sql, params); };
  const r = await kpi.reconcile(p);
  assert.equal(r.days, kpi.RETENTION_DAYS);
  assert.equal(r.failed, 1);
  const starts = p.seen.filter((x) => /INSERT INTO event_kpi_hourly/.test(x.sql)).map((x) => x.params[0]);
  for (const s of starts) assert.match(s, /T17:00:00\.000Z$/, 'every window starts at a Thai midnight');
});

test('reconcile reports, per camera and day, how many events it had to add (arrived later than the normal refresh)', async () => {
  let refreshed = 0;
  const pool = { query: async (sql) => {
    if (/SELECT now\(\) AS cut/.test(sql)) return { rows: [{ cut: 'DB-NOW' }] };
    if (/INSERT INTO event_kpi_hourly/.test(sql)) { refreshed++; return { rowCount: 1 }; }
    if (/sum\(n_total\)::bigint AS n FROM event_kpi_hourly/.test(sql))   // ก่อน/หลังของแต่ละวัน — วันที่ 3 ที่เรียก มีของมาช้า
      return { rows: refreshed === 3 ? [{ camera_id: 'C9-KAR-SB-04', n: '26301' }, { camera_id: 'X', n: '10' }] : [{ camera_id: 'X', n: '10' }] };
    return { rows: [], rowCount: 0 };
  } };
  const r = await kpi.reconcile(pool);
  assert.equal(r.late.length, 1);
  assert.equal(r.late[0].camera_id, 'C9-KAR-SB-04');
  assert.equal(r.late[0].added, 26301);
  assert.match(r.late[0].day, /^\d{4}-\d{2}-\d{2}$/);
});

test('event_dim_bucket reconcile: one Thai day at a time for 7 days, sweeping with the database clock', async () => {
  const cat = require('../src/category-rollup-refresher');
  const seen = [];
  const pool = { query: async (sql, params) => {
    seen.push({ sql, params });
    if (/SELECT now\(\) AS cut/.test(sql)) return { rows: [{ cut: 'DB-NOW' }] };
    return { rows: [], rowCount: 1 };
  } };
  const r = await cat.reconcile(pool);
  assert.equal(r.days, cat.RECONCILE_DAYS + 1, '7 past days + today');
  const ins = seen.filter((q) => /INSERT INTO event_dim_bucket/.test(q.sql));
  for (const q of ins) assert.match(q.params[0], /T17:00:00\.000Z$/);
  const del = seen.find((q) => /DELETE FROM event_dim_bucket/.test(q.sql));
  assert.equal(del.params[2], 'DB-NOW');
});
