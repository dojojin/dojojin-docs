// Vigil Platform — PUT /api/alert-channels/:channel ต้องเป็น admin และบันทึก audit (GOTCHAS #218)
// route จริง + pool ปลอม · ไม่มีทางส่ง LINE/Telegram (route นี้ไม่ส่งอะไร และ pool ไม่ใช่ DB จริง)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('../src/node_modules/express');
const auth = require('../src/auth');
const alertChannelRoutes = require('../src/routes/alert-channels');

async function boot() {
  const sql = [];
  const pool = { query: async (q) => {
    sql.push(String(q).replace(/\s+/g, ' ').trim());
    return { rows: [{ id: 1, channel: 'gs_alarm', enabled: true, recipient_ids: [], telegram_chat_ids: [] }], rowCount: 1 };
  } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const r = req.headers['x-role']; if (r) req.user = { id: 9, username: 'tester', role: r }; next(); });
  alertChannelRoutes(app, pool, { auth, routeError: (res, e) => res.status(500).json({ error: e.message }) });
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const put = (role, body) => new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/alert-channels/gs_alarm', method: 'PUT', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-role': role } },
    (r) => { r.resume(); r.on('end', () => res(r.statusCode)); });
    rq.on('error', rej); rq.end(data);
  });
  return { sql, put, close: () => { srv.close(); srv.closeAllConnections(); } };
}

test('viewer cannot change a built-in alert channel; nothing is written', async (t) => {
  const h = await boot(); t.after(h.close);
  assert.equal(await h.put('viewer', { enabled: false }), 403);
  assert.equal(h.sql.filter((s) => /^UPDATE alert_rules/.test(s)).length, 0);
});

test('admin change is written and audited with field names only', async (t) => {
  const h = await boot(); t.after(h.close);
  await h.put('admin', { enabled: false });
  assert.ok(h.sql.some((s) => /^UPDATE alert_rules SET enabled = \$1/.test(s)), h.sql.join('\n'));
  assert.ok(h.sql.some((s) => /INSERT INTO audit_log .*'alert_channel_update'/.test(s)));
});
