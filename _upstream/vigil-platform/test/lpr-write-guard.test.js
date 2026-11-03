// Vigil Platform — /api/lpr เขียนได้เฉพาะ admin ยกเว้นงานของเจ้าหน้าที่ (GOTCHAS #217)
// ทดสอบ middleware ตัวเดียวกับที่ api-server mount · handler ปลายทางเป็นตัวปลอม (ไม่มีทางส่ง LINE/Telegram)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('../src/node_modules/express');
const { lprWriteGuard } = require('../src/helpers/lprWriteGuard');

async function boot() {
  const app = express();
  app.use((req, _res, next) => { const r = req.headers['x-role']; if (r) req.user = { role: r }; next(); });
  app.use('/api/lpr', lprWriteGuard);
  app.all(/^\/api\/lpr\/.*/, (_req, res) => res.status(200).json({ reached: true }));   // แทน handler จริง
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const call = (method, p, role) => new Promise((res, rej) => {
    const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, agent: false,
      headers: role ? { 'x-role': role } : {} }, (r) => { r.resume(); r.on('end', () => res(r.statusCode)); });
    rq.on('error', rej); rq.end();
  });
  return { call, close: () => { srv.close(); srv.closeAllConnections(); } };
}

test('viewer is refused on admin writes', async (t) => {
  const h = await boot(); t.after(h.close);
  for (const [m, p] of [['POST', '/api/lpr/watchlist'], ['PATCH', '/api/lpr/watchlist/AB1234'], ['DELETE', '/api/lpr/watchlist/AB1234'],
    ['POST', '/api/lpr/watchlist/groups'], ['POST', '/api/lpr/watchlist/bulk-delete'], ['PUT', '/api/lpr/scene-image'],
    ['PUT', '/api/lpr/vehicle-types'], ['PUT', '/api/lpr/camera-direction'], ['POST', '/api/lpr/gates'],
    ['DELETE', '/api/lpr/spool/clear'], ['POST', '/api/lpr/mismatch/AB1/dismiss'],
    ['POST', '/api/lpr/alerts/12/ack/../../../watchlist']]) {
    assert.equal(await h.call(m, p, 'viewer'), 403, `${m} ${p}`);
  }
});

test('viewer keeps operator actions; GET unaffected; admin unaffected', async (t) => {
  const h = await boot(); t.after(h.close);
  for (const [m, p] of [['POST', '/api/lpr/alerts/12/ack'], ['POST', '/api/lpr/alerts/12/notify'], ['POST', '/api/lpr/alerts/12/notify-telegram'],
    ['POST', '/api/lpr/gs-alarms/5/notify'], ['POST', '/api/lpr/watchlist/AB1234/mute'], ['DELETE', '/api/lpr/watchlist/AB1234/mute'],
    ['GET', '/api/lpr/watchlist']]) {
    assert.equal(await h.call(m, p, 'viewer'), 200, `${m} ${p}`);
  }
  assert.equal(await h.call('POST', '/api/lpr/watchlist', 'admin'), 200);
  assert.equal(await h.call('POST', '/api/lpr/alerts/12/ack'), 403, 'no user = no write');
});

test('api-server mounts the guard', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/api-server.js'), 'utf8');
  assert.match(s, /app\.use\('\/api\/lpr', require\('\.\/helpers\/lprWriteGuard'\)\.lprWriteGuard\)/);
});
