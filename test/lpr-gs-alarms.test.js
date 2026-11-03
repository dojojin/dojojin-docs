// ============================================================
// Vigil Platform — Tests: LPR GuruSquare Alarms route (RBAC + param shape)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// blacklist.gs_alarms (migration 237) is not applied on the dev DB yet, so
// this cannot run against a real Postgres — it instead captures the SQL/args
// every handler builds and asserts the $n placeholders stay consistent with
// args.length, for the three RBAC shapes the route has to get right:
// unrestricted (allowedSites=null), site-restricted, and camera-restricted
// (fail-closed, since gs_alarms carries no camera_id to check per-row).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const routes = require('../src/routes/lpr-gs-alarms');

function makeApp() {
  const handlers = {};
  const postHandlers = {};
  return {
    app: { get: (p, fn) => { handlers[p] = fn; }, post: (p, fn) => { postHandlers[p] = fn; } },
    handlers, postHandlers,
  };
}
function makePool() {
  const calls = [];
  const pool = {
    query: (sql, args = []) => {
      calls.push({ sql, args });
      if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ count: '0' }] });
      if (/AS enabled/.test(sql))  return Promise.resolve({ rows: [{ enabled: false }] });
      if (/AS any/.test(sql))      return Promise.resolve({ rows: [{ any: false }] });
      if (/DISTINCT a\.owner/.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    },
  };
  return { pool, calls };
}
function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  return r;
}

// Highest $n actually referenced in the SQL text, vs. args.length — a mismatch
// means either a param nobody supplied (Postgres throws) or a pushed arg that
// never gets used (silently wrong query, worse: a security-relevant one here).
function maxPlaceholder(sql) {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

describe('lpr-gs-alarms — RBAC clause keeps $n in sync with args', () => {
  it('allowedSites=null (unrestricted) — no rbac clause, no extra param', async () => {
    const { app, handlers } = makeApp();
    const { pool, calls } = makePool();
    routes(app, pool);
    const req = { query: {}, user: { allowedSites: null } };
    await handlers['/api/lpr/gs-alarms'](req, fakeRes());
    for (const c of calls) {
      assert.equal(maxPlaceholder(c.sql), c.args.length,
        `placeholder/arg mismatch:\n${c.sql}\nargs=${JSON.stringify(c.args)}`);
      assert.ok(!/st\.id = ANY/.test(c.sql), 'unrestricted user must not get a site filter');
    }
  });

  it('site-restricted user with from/to/q/owner — rbac param lands last, everything lines up', async () => {
    const { app, handlers } = makeApp();
    const { pool, calls } = makePool();
    routes(app, pool);
    const req = {
      query: { from: '2026-09-01', to: '2026-09-24', q: 'กท 1234', owner: 'สภ.กะรน' },
      user: { allowedSites: [5] },
    };
    await handlers['/api/lpr/gs-alarms'](req, fakeRes());
    assert.ok(calls.length >= 2, 'expected the rows query and the count query');
    for (const c of calls) {
      assert.equal(maxPlaceholder(c.sql), c.args.length,
        `placeholder/arg mismatch:\n${c.sql}\nargs=${JSON.stringify(c.args)}`);
      assert.ok(/st\.id = ANY/.test(c.sql), 'site-restricted user must get a site filter');
    }
    // The rows query is the one with LIMIT/OFFSET — its last two args must be them.
    const rowsCall = calls.find(c => /LIMIT \$/.test(c.sql));
    assert.ok(rowsCall, 'rows query should carry LIMIT/OFFSET placeholders');
    assert.deepEqual(rowsCall.args.slice(-2), [15, 0]); // default limit/offset
    // Report case: paste this verbatim.
    console.log('[case 2] SQL:\n' + rowsCall.sql);
    console.log('[case 2] args: ' + JSON.stringify(rowsCall.args));
  });

  it('camera-restricted user (allowedSites.cameras set) — fails closed, no row can leak', async () => {
    const { app, handlers } = makeApp();
    const { pool, calls } = makePool();
    routes(app, pool);
    const scoped = Object.assign([5], { cameras: ['C1'] });
    const req = { query: {}, user: { allowedSites: scoped } };
    await handlers['/api/lpr/gs-alarms'](req, fakeRes());
    for (const c of calls) {
      assert.ok(/AND FALSE/.test(c.sql), `camera-restricted user must fail closed:\n${c.sql}`);
      assert.equal(maxPlaceholder(c.sql), c.args.length);
    }
  });

  it('meta — same three shapes, same invariant', async () => {
    for (const user of [
      { allowedSites: null },
      { allowedSites: [5] },
      { allowedSites: Object.assign([5], { cameras: ['C1'] }) },
    ]) {
      const { app, handlers } = makeApp();
      const { pool, calls } = makePool();
      routes(app, pool);
      const req = { query: {}, user };
      const res = fakeRes();
      await handlers['/api/lpr/gs-alarms/meta'](req, res);
      assert.equal(res.statusCode, 200);
      assert.ok('enabled' in res.body && 'owners' in res.body);
      for (const c of calls) {
        assert.equal(maxPlaceholder(c.sql), c.args.length,
          `placeholder/arg mismatch:\n${c.sql}\nargs=${JSON.stringify(c.args)}`);
      }
    }
  });
});
