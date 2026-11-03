// ============================================================
// Vigil Platform — Tests: routes/report-schedules.js telegram_chat_ids (T5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Minimal standalone harness — same shape as test/telegram-t3-telegram-config-mirror
// .test.js's makeApp/findRoute/call (duplicated here rather than imported since
// test files don't export their helpers).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const reportSchedulesRoutes = require('../src/routes/report-schedules');

function makeApp() {
  const registry = [];
  const app = {};
  for (const m of ['get', 'put', 'post', 'delete', 'patch']) {
    app[m] = (p, ...fns) => registry.push({ method: m, path: p, mws: fns });
  }
  return { app, registry };
}
function findRoute(registry, method, path) {
  return registry.find((r) => r.method === method && r.path === path);
}
function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function call(registry, method, path, req) {
  const route = findRoute(registry, method, path);
  assert.ok(route, `route not registered: ${method} ${path}`);
  const handler = route.mws[route.mws.length - 1];
  const res = fakeRes();
  await handler(req, res);
  return res;
}

function makePool({ chats = [] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT chats FROM telegram_config WHERE id = 1')) {
        return Promise.resolve({ rows: [{ chats }] });
      }
      if (sql.startsWith('INSERT INTO report_schedules')) {
        return Promise.resolve({ rows: [{ id: 1, telegram_chat_ids: params[params.length - 1] }] });
      }
      // audit trail อ่านค่าก่อนแก้ (helpers/auditTrail.js — 2026-10-14)
      if (sql.startsWith('SELECT * FROM report_schedules WHERE id')) return Promise.resolve({ rows: [{ id: 1 }] });
      if (sql.startsWith('UPDATE report_schedules')) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      throw new Error('unexpected sql: ' + sql);
    },
  };
}

describe('POST /api/report-schedules — telegram_chat_ids', () => {
  it('rejects an unapproved chat_id', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'post', '/api/report-schedules', {
      body: { report_type: 'daily', send_time: '08:00', telegram_chat_ids: ['999'] },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /telegram_chat_ids/);
  });

  it('accepts an approved chat_id', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'post', '/api/report-schedules', {
      body: { report_type: 'daily', send_time: '08:00', telegram_chat_ids: ['111'] },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.telegram_chat_ids, ['111']);
  });

  it('malformed chat_id → 400', async () => {
    const pool = makePool({ chats: [] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'post', '/api/report-schedules', {
      body: { report_type: 'daily', send_time: '08:00', telegram_chat_ids: ['abc'] },
    });
    assert.equal(res.statusCode, 400);
  });

  it('omitted entirely → defaults to empty array, no telegram_config query', async () => {
    const pool = makePool({ chats: [] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'post', '/api/report-schedules', {
      body: { report_type: 'daily', send_time: '08:00' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.calls.some((c) => c.sql.includes('telegram_config')), false);
  });
});

describe('PUT /api/report-schedules/:id — telegram_chat_ids', () => {
  it('omitted → UPDATE statement never touches the column (existing value is preserved)', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'put', '/api/report-schedules/:id', {
      params: { id: '1' }, body: { enabled: true },
    });
    assert.equal(res.statusCode, 200);
    const updateCall = pool.calls.find((c) => c.sql.startsWith('UPDATE report_schedules'));
    assert.ok(updateCall);
    assert.equal(updateCall.sql.includes('telegram_chat_ids'), false);
  });

  it('provided with an approved chat_id → UPDATE includes telegram_chat_ids', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'put', '/api/report-schedules/:id', {
      params: { id: '1' }, body: { telegram_chat_ids: ['111'] },
    });
    assert.equal(res.statusCode, 200);
    const updateCall = pool.calls.find((c) => c.sql.startsWith('UPDATE report_schedules'));
    assert.ok(updateCall.sql.includes('telegram_chat_ids'));
  });

  it('provided with an unapproved chat_id → 400, no UPDATE sent', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }] });
    const { app, registry } = makeApp();
    reportSchedulesRoutes(app, pool, { WORKER_PORT: 1, INTERNAL_API_TOKEN: 'x' });
    const res = await call(registry, 'put', '/api/report-schedules/:id', {
      params: { id: '1' }, body: { telegram_chat_ids: ['999'] },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(pool.calls.some((c) => c.sql.startsWith('UPDATE report_schedules')), false);
  });
});
