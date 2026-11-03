// ============================================================
// Vigil Platform — Tests: PUT /api/telegram-config mirror_of_line_id validation (T3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Minimal standalone harness (same shape as test/telegram-t1.test.js's
// makeApp/findRoute/call, duplicated here rather than imported since test
// files don't export their helpers). Covers only the new T3 behaviour: a
// chat's mirror_of_line_id must be a known line_config.recipients id, or null.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const telegramRoutes = require('../src/routes/telegram');

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — every test must stub global.fetch'); };
});
afterEach(() => { global.fetch = _origFetch; });

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
function fakeAuth() {
  return { requireAdmin: 'ADMIN', requireAdminOrAuditor: 'ADMIN_OR_AUDITOR', logAudit: async () => {} };
}

function makeDbPool({ approvedChatIds = [], lineRecipients = [] } = {}) {
  const cfg = { enabled: false, bot_token_enc: null, bot_username: null, chats: [] };
  return {
    cfg,
    async query(sql, args = []) {
      if (/SELECT chat_id FROM telegram_pending WHERE status = 'approved'/.test(sql)) {
        return { rows: approvedChatIds.map((id) => ({ chat_id: id })) };
      }
      if (/SELECT recipients FROM line_config WHERE id = 1/.test(sql)) {
        return { rows: [{ recipients: lineRecipients }] };
      }
      if (/SELECT chats FROM telegram_config WHERE id = 1/.test(sql)) {
        return { rows: [{ chats: cfg.chats }] };
      }
      if (/UPDATE telegram_config SET/.test(sql)) {
        let i = 0;
        if (/chats = \$/.test(sql)) cfg.chats = JSON.parse(args[i++]);
        return { rows: [] };
      }
      if (/UPDATE telegram_pending SET status = 'ignored' WHERE chat_id = ANY/.test(sql)) return { rows: [] };
      throw new Error('unhandled SQL in test pool: ' + sql);
    },
  };
}

describe('PUT /api/telegram-config — mirror_of_line_id validation (T3)', () => {
  it('mirror_of_line_id pointing at a real LINE recipient → accepted, stored as-is', async () => {
    const { app, registry } = makeApp();
    const pool = makeDbPool({ approvedChatIds: ['-100111'], lineRecipients: [{ id: 'U1', name: 'Owner' }] });
    telegramRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config', {
      body: { chats: [{ chat_id: '-100111', name: 'Backup', mirror_of_line_id: 'U1' }] },
      user: { role: 'admin' }, headers: {},
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.cfg.chats[0].mirror_of_line_id, 'U1');
  });

  it('mirror_of_line_id = null (not linked) → accepted', async () => {
    const { app, registry } = makeApp();
    const pool = makeDbPool({ approvedChatIds: ['-100111'], lineRecipients: [{ id: 'U1', name: 'Owner' }] });
    telegramRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config', {
      body: { chats: [{ chat_id: '-100111', name: 'Backup', mirror_of_line_id: null }] },
      user: { role: 'admin' }, headers: {},
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.cfg.chats[0].mirror_of_line_id, null);
  });

  it('mirror_of_line_id pointing at an unknown/deleted LINE recipient → 400, nothing stored', async () => {
    const { app, registry } = makeApp();
    const pool = makeDbPool({ approvedChatIds: ['-100111'], lineRecipients: [{ id: 'U1', name: 'Owner' }] });
    telegramRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config', {
      body: { chats: [{ chat_id: '-100111', name: 'Backup', mirror_of_line_id: 'U-DOES-NOT-EXIST' }] },
      user: { role: 'admin' }, headers: {},
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /mirror_of_line_id/);
    assert.deepEqual(pool.cfg.chats, [], 'no partial write on rejection');
  });

  it('mirror_of_line_id omitted entirely on the chat object → treated as null, accepted', async () => {
    const { app, registry } = makeApp();
    const pool = makeDbPool({ approvedChatIds: ['-100111'], lineRecipients: [] });
    telegramRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config', {
      body: { chats: [{ chat_id: '-100111', name: 'Backup' }] },
      user: { role: 'admin' }, headers: {},
    });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.cfg.chats[0].mirror_of_line_id, null);
  });
});
