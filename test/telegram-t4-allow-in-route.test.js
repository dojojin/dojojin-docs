// ============================================================
// Vigil Platform — Tests: PUT /api/line/operators/:id/telegram-allow-in (T4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Harness mirrors test/telegram-t4-operator-link-route.test.js — fake express
// app + fake pool, routes/line-commands.js required fresh and unstubbed.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const lineCommandRoutes = require('../src/routes/line-commands');

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

function makePool({ op, chats = [] }) {
  const saved = { value: undefined };
  return {
    saved,
    query: async (sql, args) => {
      if (/SELECT line_user_id, telegram_user_id FROM line_operators/.test(sql)) {
        return { rows: op && op.line_user_id === args[0] ? [op] : [] };
      }
      if (/SELECT chats FROM telegram_config/.test(sql)) {
        return { rows: [{ chats }] };
      }
      if (/UPDATE line_operators SET telegram_allow_in/.test(sql)) {
        saved.value = args[1] === null ? null : JSON.parse(args[1]);
        return { rows: [{ line_user_id: args[0], telegram_allow_in: saved.value }] };
      }
      throw new Error('unhandled SQL: ' + sql);
    },
  };
}

describe('PUT /api/line/operators/:id/telegram-allow-in', () => {
  it('ต้องผ่าน requireAdmin', () => {
    const { app, registry } = makeApp();
    lineCommandRoutes(app, {}, { auth: fakeAuth(), routeError: () => {} });
    const r = findRoute(registry, 'put', '/api/line/operators/:id/telegram-allow-in');
    assert.ok(r.mws.includes('SENTINEL'));
  });

  it('operator ไม่พบ → 404', async () => {
    const { app, registry } = makeApp();
    const pool = makePool({ op: null });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Unotfound' }, body: { telegram_allow_in: [] }, user: { id: 1 } });
    assert.equal(res.statusCode, 404);
  });

  it('chat id ที่ไม่รู้จัก (ไม่อยู่ใน telegram_config.chats และไม่ใช่แชทส่วนตัวของผู้สั่งคนนี้) → 400', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [{ chat_id: '-100777', enabled: true }] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: ['tg:-999999'] }, user: { id: 1 } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /-999999/);
    assert.equal(pool.saved.value, undefined, 'ต้องไม่เขียน DB เมื่อ validate ไม่ผ่าน');
  });

  it('รูปแบบผิด (ไม่ขึ้นต้นด้วย tg:) → 400', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [{ chat_id: '-100777', enabled: true }] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: ['Croom1'] }, user: { id: 1 } });
    assert.equal(res.statusCode, 400);
  });

  it('แชทที่อนุมัติแล้วแต่ enabled=false → 400 (เหมือนไม่รู้จัก)', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [{ chat_id: '-100777', enabled: false }] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: ['tg:-100777'] }, user: { id: 1 } });
    assert.equal(res.statusCode, 400);
  });

  it('แชทที่อนุมัติ+เปิดใช้แล้ว → 200 บันทึกได้', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [{ chat_id: '-100777', enabled: true }] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: ['tg:-100777'] }, user: { id: 1 } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(pool.saved.value, ['tg:-100777']);
  });

  it('tg:<telegram_user_id> ของตัวเอง (แชทส่วนตัว) → ผ่านแม้ไม่อยู่ใน telegram_config.chats', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: ['tg:111'] }, user: { id: 1 } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(pool.saved.value, ['tg:111']);
  });

  it('tg:<telegram_user_id> ของ "คนอื่น" (ไม่ใช่เจ้าของแถวนี้) → 400', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: ['tg:222'] }, user: { id: 1 } });
    assert.equal(res.statusCode, 400);
  });

  it('array ว่าง → บันทึกเป็น NULL (สั่งได้ทุกห้อง)', async () => {
    const { app, registry } = makeApp();
    const op = { line_user_id: 'Uabc', telegram_user_id: 111 };
    const pool = makePool({ op, chats: [] });
    lineCommandRoutes(app, pool, { auth: fakeAuth(), routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/line/operators/:id/telegram-allow-in',
      { params: { id: 'Uabc' }, body: { telegram_allow_in: [] }, user: { id: 1 } });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.saved.value, null);
  });
});
