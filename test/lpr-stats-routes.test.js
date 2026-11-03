// Vigil Platform — /api/lpr/stats ผ่านตัวคุมคิว + pool สถิติแยก (route จริง, pool ปลอม)
// ไม่แตะ DB และไม่ออกเครือข่าย: listen เฉพาะ 127.0.0.1 พอร์ตสุ่ม · warm loop ถูกปิด
'use strict';
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('../src/node_modules/express');

process.env.LPR_STATS_QUEUE_WAIT_MS = '150';
process.env.LPR_WARM_FIRST_RUN_MS = '999999999';

// ไม่ปล่อยให้ warm loop ตั้ง timer จริงตอน mount
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = () => ({ unref() {} });
global.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); if (ms > 60000) t.unref(); return t; };
const lprQueryRoutes = require('../src/routes/lpr-query');

const row = new Proxy({}, { get: (_, k) => (k === 'then' || typeof k === 'symbol') ? undefined : '0' });
function fakePool(delayMs) {
  const p = { calls: 0, conns: 0, live: 0, peak: 0, sqls: [] };
  const q = async (sql) => {
    p.calls++; p.live++; p.peak = Math.max(p.peak, p.live); p.sqls.push(String(sql.text || sql));
    await new Promise((r) => realSetTimeout(r, delayMs));
    p.live--; return { rows: [row], rowCount: 1 };
  };
  p.query = q; p.on = () => {};
  p.connect = async () => { p.conns++; return { query: q, release() {} }; };
  return p;
}

async function boot(statsDelay = 10) {
  const main = fakePool(10), stats = fakePool(statsDelay);
  const app = express();
  lprQueryRoutes(app, main, stats);
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const get = (path) => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path, agent: false }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers }));
    }).on('error', rej);
  });
  return { main, stats, get, close: () => { srv.close(); srv.closeAllConnections(); } };
}
const P = '/api/lpr/stats?period=custom&from=2026-09-21T00:00:00.000Z&to=2026-09-22T00:00:00.000Z';

test('identical concurrent stats requests share one computation', async (t) => {
  const h = await boot(); t.after(h.close);
  await h.get(P + '&cameras=warmup');                 // รู้จำนวนคิวรีของหนึ่งคำขอ
  const one = h.stats.calls; h.stats.calls = 0;
  const rs = await Promise.all([h.get(P + '&cameras=A'), h.get(P + '&cameras=A'), h.get(P + '&cameras=A')]);
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.equal(h.stats.calls, one);
});

test('heavy stats never touch the main pool', async (t) => {
  const h = await boot(); t.after(h.close);
  await Promise.all([h.get(P + '&cameras=A'), h.get(P + '&cameras=A&part=kpi'), h.get(P + '&cameras=B&part=kpi')]);
  assert.equal(h.main.calls, 0);
  assert.equal(h.main.conns, 0);
  assert.ok(h.stats.calls > 0);
});

test('live stats run one at a time; a request waiting too long gets 503 busy', async (t) => {
  const h = await boot(120); t.after(h.close);        // คิวรีละ 120 ms > รอคิว 150 ms
  const rs = await Promise.all([h.get(P + '&cameras=A'), h.get(P + '&cameras=B'), h.get(P + '&cameras=C')]);
  assert.equal(rs.filter((r) => r.status === 200).length >= 1, true);
  const busy = rs.filter((r) => r.status === 503);
  assert.ok(busy.length >= 1);
  assert.equal(busy[0].headers['retry-after'], '15');
  assert.deepEqual(JSON.parse(busy[0].body), { error: 'busy' });
});

test('custom without from is bounded in the SQL actually sent', async (t) => {
  const h = await boot(); t.after(h.close);
  await h.get('/api/lpr/stats?period=custom&cameras=Z');
  assert.ok(h.stats.sqls.some((s) => /INTERVAL '31 days'/.test(s)));
});

test('rollup periods are not queued behind live ones', async (t) => {
  const h = await boot(120); t.after(h.close);
  const rs = await Promise.all([h.get(P + '&cameras=A'), h.get('/api/lpr/stats?period=month&cameras=A'), h.get('/api/lpr/stats?period=week&cameras=A')]);
  assert.equal(rs.find((r, i) => i > 0 && r.status !== 200), undefined);
});

test('Reports stats route: identical requests share one temp-table run, on the stats pool', async (t) => {
  const h = await boot(); t.after(h.close);
  const R = '/api/stats/lpr/report?period=month&site_id=1';
  const rs = await Promise.all([h.get(R), h.get(R), h.get(R)]);
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.equal(h.stats.conns, 1);       // pool.connect() ของ temp table ครั้งเดียว
  assert.equal(h.main.calls, 0);
  assert.equal(h.main.conns, 0);
});

test('Reports stats route: waiting too long for the single slot gives 503 busy', async (t) => {
  const h = await boot(120); t.after(h.close);
  const rs = await Promise.all([h.get('/api/stats/lpr/report?period=month&site_id=1'), h.get('/api/stats/lpr/report?period=month&site_id=2')]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 503]);
});

after(() => { global.setInterval = realSetInterval; global.setTimeout = realSetTimeout; });
