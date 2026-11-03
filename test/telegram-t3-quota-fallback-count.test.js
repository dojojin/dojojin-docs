// ============================================================
// Vigil Platform — Tests: GET /api/line-config/quota fallback_count_this_month (T3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Minimal standalone harness for routes/line.js's GET /api/line-config/quota —
// asserts the new fallback-count field is present and driven purely by the SQL
// this file's caller controls (no real Postgres). lineSender.getLineQuota is
// monkey-patched (routes/line.js requires it directly, no injection seam).
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const lineSender = require('../src/line-sender');
const lineRoutes = require('../src/routes/line');

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
  return { requireAuth: 'AUTH', requireAdmin: 'ADMIN', logAudit: async () => {} };
}

function makePool({ token = 'tok', fallbackCount = 0 } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [{ channel_access_token: token }] };
      if (sql.includes('FROM system_settings WHERE key = ANY')) return { rows: [] };
      if (sql.includes('FROM alert_logs') && sql.includes('monthly limit')) return { rows: [] };
      if (sql.includes('jsonb_array_elements') && sql.includes("'fallback'")) {
        return { rows: [{ n: String(fallbackCount) }] };
      }
      throw new Error('unexpected sql in fake pool: ' + sql.slice(0, 120));
    },
  };
}

let _origGetQuota;
beforeEach(() => { _origGetQuota = lineSender.getLineQuota; });
afterEach(() => { lineSender.getLineQuota = _origGetQuota; });

describe('GET /api/line-config/quota — fallback_count_this_month (T3)', () => {
  it('not connected (no token) still returns the fallback count', async () => {
    const { app, registry } = makeApp();
    const pool = makePool({ token: null, fallbackCount: 3 });
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/line-config/quota', {});
    assert.equal(res.body.connected, false);
    assert.equal(res.body.fallback_count_this_month, 3);
  });

  it('connected, quota fetched → fallback_count_this_month rides along', async () => {
    const { app, registry } = makeApp();
    const pool = makePool({ fallbackCount: 5 });
    lineSender.getLineQuota = async () => ({ type: 'limited', used: 100, limit: 1000 });
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/line-config/quota', {});
    assert.equal(res.body.connected, true);
    assert.equal(res.body.fallback_count_this_month, 5);
  });

  it('zero this month → 0, not omitted', async () => {
    const { app, registry } = makeApp();
    const pool = makePool({ fallbackCount: 0 });
    lineSender.getLineQuota = async () => ({ type: 'limited', used: 0, limit: 1000 });
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/line-config/quota', {});
    assert.equal(res.body.fallback_count_this_month, 0);
  });

  it('the counting query never throws the whole endpoint down (defensive: returns 0 on query failure)', async () => {
    const { app, registry } = makeApp();
    const pool = {
      async query(sql) {
        if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [{ channel_access_token: null }] };
        if (sql.includes('FROM system_settings WHERE key = ANY')) return { rows: [] };
        if (sql.includes('FROM alert_logs') && sql.includes('monthly limit')) return { rows: [] };
        if (sql.includes('jsonb_array_elements')) throw new Error('boom — simulated DB hiccup');
        throw new Error('unexpected sql: ' + sql.slice(0, 80));
      },
    };
    lineRoutes(app, pool, { auth: fakeAuth(), getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/line-config/quota', {});
    assert.equal(res.body.fallback_count_this_month, 0);
  });
});
