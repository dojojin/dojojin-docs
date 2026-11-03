// Vigil Platform — /api/appearances/stats ปฏิเสธช่วงที่ไม่มีทางจบ ก่อนแตะ DB (GOTCHAS #217)
// route จริง + pool ปลอม · listen 127.0.0.1 เท่านั้น
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('../src/node_modules/express');
const appearancesRoutes = require('../src/routes/appearances');

async function boot() {
  const used = { connect: 0, query: 0 };
  const row = new Proxy({}, { get: (_, k) => (k === 'then' || typeof k === 'symbol') ? undefined : null });
  const q = async () => { used.query++; return { rows: [row], rowCount: 0 }; };
  const pool = { query: q, connect: async () => { used.connect++; return { query: q, release() {} }; } };
  const app = express();
  appearancesRoutes(app, pool, { getDisplayTz: async () => 'Asia/Bangkok', getIP: () => '127.0.0.1' });
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const get = (path) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b }));
  }).on('error', rej));
  return { used, get, close: () => { srv.close(); srv.closeAllConnections(); } };
}
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

test('no "from" → 400 range_too_large, DB untouched', async (t) => {
  const h = await boot(); t.after(h.close);
  const r = await h.get('/api/appearances/stats');
  assert.equal(r.status, 400);
  assert.deepEqual(JSON.parse(r.body), { error: 'range_too_large', max_days: 31 });
  assert.deepEqual(h.used, { connect: 0, query: 0 });
});

test('32-day span → 400, DB untouched', async (t) => {
  const h = await boot(); t.after(h.close);
  const r = await h.get(`/api/appearances/stats?from=${encodeURIComponent(iso(32 * 86400_000))}`);
  assert.equal(r.status, 400);
  assert.equal(h.used.connect + h.used.query, 0);
});

test('7-day span reaches the DB (cap is 31 days since migration 255)', async (t) => {
  const h = await boot(); t.after(h.close);
  await h.get(`/api/appearances/stats?from=${encodeURIComponent(iso(7 * 86400_000))}`);
  assert.ok(h.used.connect + h.used.query > 0);
});

test('stats read event_time and rj_* from appearances — no JOIN to events (migration 255 · D6)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/routes/appearances.js'), 'utf8');
  const i = src.indexOf('CREATE TEMP TABLE _app_stats_filtered');
  const block = src.slice(i, src.indexOf('args);', i));
  assert.match(block, /a\.event_time,\s*\n[^\n]*\n\s*a\.rj_mask, a\.rj_hat, a\.rj_age_group, a\.rj_expression/);
  assert.doesNotMatch(block, /JOIN events/);
  const mig = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'db/db_migration_255_appearances_event_time.sql'), 'utf8');
  assert.match(mig, /BEFORE INSERT ON appearances/);
});
