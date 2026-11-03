// ============================================================
// Vigil Platform — Tests: POST/DELETE /api/line/operators/:id/telegram-link (T4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Harness mirrors test/telegram-t1.test.js's routes/telegram.js section
// (fake express app + fake pool) — routes/line-commands.js is required fresh
// and unstubbed here, so this exercises the real genLinkCode/hashLinkCode
// round trip.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const lineCommandRoutes = require('../src/routes/line-commands');
const { hashLinkCode } = require('../src/helpers/telegramLinkCode');

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
  return { requireAdmin: 'SENTINEL', requireAdminOrAuditor: 'SENTINEL2', logAudit: async () => {} };
}

function makePool(state) {
  return {
    query: async (sql, args) => {
      if (/UPDATE line_operators SET telegram_link_code = \$2/.test(sql)) {
        const [id, codeHash] = args;
        if (!state.ops[id]) return { rows: [] };
        state.ops[id].telegram_link_code = codeHash;
        state.ops[id].telegram_link_expires = 'future';
        return { rows: [{ line_user_id: id }] };
      }
      if (/UPDATE line_operators\s+SET telegram_user_id = NULL/.test(sql)) {
        const [id] = args;
        if (!state.ops[id]) return { rows: [] };
        state.ops[id].telegram_user_id = null;
        state.ops[id].telegram_link_code = null;
        state.ops[id].telegram_link_expires = null;
        return { rows: [{ line_user_id: id }] };
      }
      throw new Error('unhandled SQL: ' + sql);
    },
  };
}

describe('POST /api/line/operators/:id/telegram-link', () => {
  it('ต้องผ่าน requireAdmin', () => {
    const { app, registry } = makeApp();
    lineCommandRoutes(app, {}, { auth: fakeAuth(), routeError: () => {} });
    const r = findRoute(registry, 'post', '/api/line/operators/:id/telegram-link');
    assert.ok(r.mws.includes('SENTINEL'));
  });

  it('operator ไม่พบ → 404', async () => {
    const { app, registry } = makeApp();
    const pool = makePool({ ops: {} });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/line/operators/:id/telegram-link',
      { params: { id: 'Unotfound' }, user: { id: 1, username: 'admin' } });
    assert.equal(res.statusCode, 404);
  });

  it('ออกรหัส 6 หลัก อายุ 600 วิ + เก็บ hash ลง DB ไม่ใช่ plaintext', async () => {
    const { app, registry } = makeApp();
    const state = { ops: { Uabc: { line_user_id: 'Uabc' } } };
    const pool = makePool(state);
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/line/operators/:id/telegram-link',
      { params: { id: 'Uabc' }, user: { id: 1, username: 'admin' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.code, /^\d{6}$/);
    assert.equal(res.body.expires_in_sec, 600);
    assert.equal(state.ops.Uabc.telegram_link_code, hashLinkCode(res.body.code), 'DB ต้องเก็บ hash ตรงกับรหัสที่ออกให้');
    assert.notEqual(state.ops.Uabc.telegram_link_code, res.body.code, 'ห้ามเก็บรหัสดิบ');
  });

  it('ออกรหัสซ้ำสองครั้ง → รหัสก่อนหน้าใช้ไม่ได้อีก (ทับด้วยรหัสใหม่)', async () => {
    const { app, registry } = makeApp();
    const state = { ops: { Uabc: { line_user_id: 'Uabc' } } };
    const pool = makePool(state);
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const first = await call(registry, 'post', '/api/line/operators/:id/telegram-link',
      { params: { id: 'Uabc' }, user: { id: 1, username: 'admin' } });
    const second = await call(registry, 'post', '/api/line/operators/:id/telegram-link',
      { params: { id: 'Uabc' }, user: { id: 1, username: 'admin' } });
    assert.notEqual(first.body.code, second.body.code, 'สองครั้งควรได้รหัสคนละชุด (สุ่มใหม่)');
    assert.equal(state.ops.Uabc.telegram_link_code, hashLinkCode(second.body.code),
      'DB ต้องเหลือ hash ของรหัสล่าสุดเท่านั้น — รหัสแรกใช้ไม่ได้อีก');
  });
});

describe('DELETE /api/line/operators/:id/telegram-link', () => {
  it('ต้องผ่าน requireAdmin', () => {
    const { app, registry } = makeApp();
    lineCommandRoutes(app, {}, { auth: fakeAuth(), routeError: () => {} });
    const r = findRoute(registry, 'delete', '/api/line/operators/:id/telegram-link');
    assert.ok(r.mws.includes('SENTINEL'));
  });

  it('operator ไม่พบ → 404', async () => {
    const { app, registry } = makeApp();
    const pool = makePool({ ops: {} });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'delete', '/api/line/operators/:id/telegram-link',
      { params: { id: 'Unotfound' }, user: { id: 1, username: 'admin' } });
    assert.equal(res.statusCode, 404);
  });

  it('ล้าง telegram_user_id/link_code/link_expires ทั้งหมด', async () => {
    const { app, registry } = makeApp();
    const state = { ops: { Uabc: { line_user_id: 'Uabc', telegram_user_id: 999, telegram_link_code: 'x', telegram_link_expires: 'y' } } };
    const pool = makePool(state);
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'delete', '/api/line/operators/:id/telegram-link',
      { params: { id: 'Uabc' }, user: { id: 1, username: 'admin' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(state.ops.Uabc.telegram_user_id, null);
    assert.equal(state.ops.Uabc.telegram_link_code, null);
    assert.equal(state.ops.Uabc.telegram_link_expires, null);
  });
});
