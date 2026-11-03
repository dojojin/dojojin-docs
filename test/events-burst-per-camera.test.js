// ============================================================
// Vigil Platform — Tests: /api/events?group=burst ไล่ทีละกล้องเมื่อเลือกกล้องเป็นชุด (migration 278 · 2026-10-24)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

function burstSql(query) {
  const seen = [];
  const pool = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; }, connect: async () => { throw new Error('no'); } };
  let handler;
  const app = { get: (p, ...h) => { if (p === '/api/events') handler = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  require('../src/routes/events')(app, pool, { getDisplayTz: async () => 'Asia/Bangkok', getAnalyticsEnabledSet: () => new Set(),
    METRIC_EVENT_TYPE_PATTERN: '%Aggregation%', ANALYTICS_EVENT_KEYS: [], ANALYTICS_KEY_SQL: 'NULL' });
  const res = { set() { return res; }, status() { return res; }, json() { return res; }, setHeader() {} };
  return handler({ method: 'GET', user: { role: 'admin', allowedSites: null },
    query: { hasSnapshot: 'true', group: 'burst', limit: '20', offset: '0', from: '2026-10-01T00:00:00Z', to: '2026-10-24T00:00:00Z', ...query } }, res)
    .then(() => seen.find((q) => /WITH filtered AS/.test(q.sql)));
}

test('a camera set walks each camera on its own (LATERAL) instead of one time-ordered scan', async () => {
  const q = await burstSql({ cameras: 'A,B,C' });
  assert.match(q.sql, /FROM unnest\(\$\d+::text\[\]\) AS cam\(id\)\s+CROSS JOIN LATERAL/);
  assert.match(q.sql, /e\.camera_id = cam\.id/);
  assert.doesNotMatch(q.sql, /e\.camera_id = ANY/);
  const k = Number(/unnest\(\$(\d+)/.exec(q.sql)[1]);
  assert.deepEqual(q.params[k - 1], ['A', 'B', 'C']);
});

test('no camera set (all sites) keeps the original single scan', async () => {
  const q = await burstSql({});
  assert.doesNotMatch(q.sql, /LATERAL/);
});

test('representative card is chosen deterministically when times tie', async () => {
  const q = await burstSql({ cameras: 'A' });
  assert.match(q.sql, /ARRAY_AGG\(id ORDER BY event_time ASC, id ASC\)/);
});

test('events list walks each camera when a camera set is given (count stays plain), and the plain query is kept otherwise', async () => {
  const seen = [];
  const pool = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; }, connect: async () => { throw new Error('no'); } };
  let handler;
  const app = { get: (p, ...h) => { if (p === '/api/events') handler = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  delete require.cache[require.resolve('../src/routes/events')];
  require('../src/routes/events')(app, pool, { getDisplayTz: async () => 'Asia/Bangkok', getAnalyticsEnabledSet: () => new Set(),
    METRIC_EVENT_TYPE_PATTERN: '%Aggregation%', ANALYTICS_EVENT_KEYS: [], ANALYTICS_KEY_SQL: 'NULL' });
  const res = { set() { return res; }, status() { return res; }, json() { return res; }, setHeader() {} };
  await handler({ method: 'GET', user: { role: 'admin', allowedSites: null }, query: { cameras: 'A,B', limit: '20', offset: '40', from: '2026-10-01T00:00:00Z' } }, res);
  const [rows, count] = seen;
  assert.match(rows.sql, /CROSS JOIN LATERAL[\s\S]*e\.camera_id = cam\.id[\s\S]*ORDER BY e\.event_time DESC, e\.id DESC LIMIT 60\) x ORDER BY x\.event_time DESC, x\.id DESC LIMIT \$\d+ OFFSET \$\d+$/);
  assert.doesNotMatch(count.sql, /LATERAL/, 'count keeps the plain capped query — it was already fast on every site');
  seen.length = 0;
  await handler({ method: 'GET', user: { role: 'admin', allowedSites: null }, query: { limit: '20', from: '2026-10-01T00:00:00Z' } }, res);
  assert.doesNotMatch(seen.map((q) => q.sql).join('\n'), /LATERAL/);
});

test('faces list + counts walk each camera when a camera set is given', async () => {
  const seen = [];
  const client = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{ n: 0 }] }; }, release() {} };
  const pool = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; }, connect: async () => client };
  let handler;
  const app = { get: (p, ...h) => { if (p === '/api/faces') handler = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  require('../src/routes/faces')(app, pool, {});
  const res = { set() { return res; }, status() { return res; }, json() { return res; }, setHeader() {} };
  await handler({ method: 'GET', user: { role: 'admin', allowedSites: null }, query: { cameras: 'A,B', limit: '24', offset: '24', include_recog: '1', from: '2026-10-01T00:00:00Z' } }, res);
  const list = seen.find((q) => /SELECT x\.\* FROM unnest/.test(q.sql));
  assert.ok(list, 'list query walks each camera');
  assert.match(list.sql, /camera_id = cam\.id[\s\S]*ORDER BY event_time DESC, id DESC LIMIT 49\) x ORDER BY x\.event_time DESC, x\.id DESC LIMIT \$\d+ OFFSET \$\d+$/);
  const count = seen.find((q) => /SELECT count\(\*\)::int AS n FROM unnest/.test(q.sql));
  assert.ok(count, 'total count walks each camera');
  assert.doesNotMatch(count.sql, /camera_id = ANY/);
});

test('face badge counts find matched rows from the small partial index first, then filter cameras (OFFSET 0 barrier)', async () => {
  const seen = [];
  const pool = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{}] }; } };
  let handler;
  const app = { get: (p, ...h) => { if (p === '/api/faces/counts') handler = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  delete require.cache[require.resolve('../src/routes/faces')];
  require('../src/routes/faces')(app, pool, {});
  const res = { json() { return res; }, status() { return res; } };
  await handler({ query: { cameras: 'A,B' }, user: { role: 'admin', allowedSites: null } }, res);
  const q = seen.find((x) => /face_event_acks/.test(x.sql));
  assert.match(q.sql, /FROM \(SELECT id, camera_id, raw_json FROM events[\s\S]*IS NOT NULL\s+OFFSET 0\) e/);
  assert.match(q.sql, /WHERE TRUE\s+AND e\.camera_id = ANY\(\$\d+\)/, 'camera filter stays outside the barrier');
});

// 2026-10-27: เพดาน input ของการจัดกลุ่ม burst โตตามหน้าที่ขอ — เดิม 50,000 ตายตัว อ่าน ~650 MB เพื่อแสดง 20 การ์ด
test('burst input cap grows with the page asked for (page 1 ≈ 4,000 rows, never above 50,000)', async () => {
  const cap = (q) => Number(/LIMIT (\d+)\s*\),\s*gapped/.exec(q.sql)[1]);
  assert.equal(cap(await burstSql({ cameras: 'A,B' })), 4000);                      // 2000 + (0+20)*100
  assert.equal(cap(await burstSql({ cameras: 'A,B', offset: '200' })), 24000);      // 2000 + (200+20)*100
  assert.equal(cap(await burstSql({ cameras: 'A,B', offset: '2000' })), 50000);     // เพดานเดิม
  assert.equal(cap(await burstSql({})), 4000, 'ทางไม่เลือกกล้องใช้เพดานเดียวกัน');
});

test('burst total says "capped" only when the input hit the cap', async () => {
  const run = async (input) => {
    const headers = {};
    const pool = { query: async (sql) => ({ rows: /WITH filtered AS/.test(sql) ? [{ id: 1, _total: 37, _input: input }] : [] }), connect: async () => { throw new Error('no'); } };
    let handler;
    const app = { get: (p, ...h) => { if (p === '/api/events') handler = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    delete require.cache[require.resolve('../src/routes/events')];
    require('../src/routes/events')(app, pool, { getDisplayTz: async () => 'Asia/Bangkok', getAnalyticsEnabledSet: () => new Set(),
      METRIC_EVENT_TYPE_PATTERN: '%Aggregation%', ANALYTICS_EVENT_KEYS: [], ANALYTICS_KEY_SQL: 'NULL' });
    let body;
    const res = { set(k, v) { headers[k] = v; return res; }, status() { return res; }, json(b) { body = b; return res; }, setHeader() {} };
    await handler({ method: 'GET', user: { role: 'admin', allowedSites: null },
      query: { hasSnapshot: 'true', group: 'burst', limit: '20', offset: '0', from: '2026-10-01T00:00:00Z', cameras: 'A' } }, res);
    return { headers, body };
  };
  const hit = await run(4000);
  assert.equal(hit.headers['X-Total-Count'], '37');
  assert.equal(hit.headers['X-Total-Capped'], '1');
  assert.equal(hit.body[0]._input, undefined, 'คอลัมน์ภายในไม่หลุดไปถึงหน้าจอ');
  const under = await run(3999);
  assert.equal(under.headers['X-Total-Capped'], undefined);
});
