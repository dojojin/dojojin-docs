// ============================================================
// Vigil Platform — Tests: routes/alert-rules.js deliver_via (T2b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// User-created rules (channel IS NULL) reuse the same deliverViaValidate.js
// as alert-channels.js (T2a) — this only exercises the wiring in POST/PUT/GET,
// not the validator's own branches (see telegram-t2b-deliver-via-validate.test.js).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const alertRulesRoutes = require('../src/routes/alert-rules');

function makeApp() {
  const registry = [];
  const app = {};
  for (const m of ['get', 'put', 'post', 'delete']) app[m] = (p, ...fns) => registry.push({ method: m, path: p, mws: fns });
  return { app, registry };
}
function findRoute(registry, method, path) { return registry.find((r) => r.method === method && r.path === path); }
function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function call(registry, method, path, req) {
  const route = findRoute(registry, method, path);
  assert.ok(route, `route not registered: ${method} ${path}`);
  const res = fakeRes();
  await route.mws[route.mws.length - 1](req, res);
  return res;
}

function makePool({ approvedChats = [], tgEnabled = false, tgHasToken = false, existingChatIds = [] } = {}) {
  const inserts = [];
  const updates = [];
  return {
    inserts, updates,
    async query(sql, params) {
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: approvedChats }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc IS NOT NULL AS has_token, chats FROM telegram_config')) {
        return { rows: [{ enabled: tgEnabled, has_token: tgHasToken, chats: approvedChats }] };
      }
      if (sql.startsWith('SELECT telegram_chat_ids FROM alert_rules WHERE id')) {
        return { rows: [{ telegram_chat_ids: existingChatIds }] };
      }
      if (sql.startsWith('INSERT INTO alert_rules')) { inserts.push(params); return { rows: [{ id: 99, ...paramsToRow(params) }] }; }
      if (sql.startsWith('UPDATE alert_rules SET')) { updates.push(params); return { rows: [{ id: 42 }] }; }
      if (sql.includes('SELECT channel FROM alert_rules WHERE id')) return { rows: [{ channel: null }] };
      if (sql.includes(`SELECT pg_notify`)) return { rows: [] };
      // audit trail อ่านค่าก่อนแก้ (helpers/auditTrail.js — 2026-10-14)
      if (sql.startsWith('SELECT * FROM alert_rules WHERE id')) return { rows: [{ id: 42 }] };
      throw new Error('unexpected sql: ' + sql.slice(0, 100));
    },
  };
}
// Minimal echo so POST's res.json(rows[0]) has something recognisable to assert on.
function paramsToRow(params) { return { name: params[0], deliver_via: params[18], telegram_chat_ids: params[19] }; }

function setup(poolOpts) {
  const { app, registry } = makeApp();
  const pool = makePool(poolOpts);
  alertRulesRoutes(app, pool);
  return { registry, pool };
}

describe('POST /api/alert-rules — deliver_via / telegram_chat_ids', () => {
  it('omitted → defaults to line/[] and is accepted (identical to pre-T2b callers)', async () => {
    const { registry, pool } = setup();
    const res = await call(registry, 'post', '/api/alert-rules', { body: { name: 'R1' } });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.inserts.length, 1);
    assert.equal(pool.inserts[0][18], 'line');
    assert.deepEqual(pool.inserts[0][19], []);
  });

  it('invalid deliver_via → 400, no INSERT', async () => {
    const { registry, pool } = setup();
    const res = await call(registry, 'post', '/api/alert-rules', { body: { name: 'R1', deliver_via: 'carrier_pigeon' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /deliver_via/);
    assert.equal(pool.inserts.length, 0);
  });

  it("deliver_via='telegram' with no ready chat → 400 (same guard as alert-channels.js)", async () => {
    const { registry, pool } = setup({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-1', enabled: true }] });
    const res = await call(registry, 'post', '/api/alert-rules', { body: { name: 'R1', deliver_via: 'telegram' } });
    assert.equal(res.statusCode, 400);
    assert.equal(pool.inserts.length, 0);
  });

  it("deliver_via='telegram' with an approved chat selected → 201-ish ok, chat id stored", async () => {
    const { registry, pool } = setup({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }] });
    const res = await call(registry, 'post', '/api/alert-rules',
      { body: { name: 'R1', deliver_via: 'telegram', telegram_chat_ids: ['-100111'] } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(pool.inserts[0][19], ['-100111']);
  });

  it('telegram_chat_ids with an unapproved id → 400', async () => {
    const { registry, pool } = setup({ approvedChats: [{ chat_id: '-100111' }] });
    const res = await call(registry, 'post', '/api/alert-rules',
      { body: { name: 'R1', telegram_chat_ids: ['-100999'] } });
    assert.equal(res.statusCode, 400);
    assert.equal(pool.inserts.length, 0);
  });
});

describe('PUT /api/alert-rules/:id — deliver_via / telegram_chat_ids', () => {
  it('not sent → untouched (no telegram_config query, no rejection)', async () => {
    const { registry, pool } = setup();
    const res = await call(registry, 'put', '/api/alert-rules/:id', { params: { id: '42' }, body: { name: 'Renamed' } });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.updates.length, 1);
  });

  it("deliver_via='telegram' with telegram_chat_ids omitted falls back to the row's saved list", async () => {
    const { registry, pool } = setup({
      tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }],
      existingChatIds: ['-100111'],
    });
    const res = await call(registry, 'put', '/api/alert-rules/:id', { params: { id: '42' }, body: { deliver_via: 'telegram' } });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.updates.length, 1);
  });

  it("deliver_via='telegram' with no saved chats and none sent this request → 400, no UPDATE", async () => {
    const { registry, pool } = setup({
      tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }],
      existingChatIds: [],
    });
    const res = await call(registry, 'put', '/api/alert-rules/:id', { params: { id: '42' }, body: { deliver_via: 'telegram' } });
    assert.equal(res.statusCode, 400);
    assert.equal(pool.updates.length, 0);
  });

  it('invalid deliver_via → 400, no UPDATE', async () => {
    const { registry, pool } = setup();
    const res = await call(registry, 'put', '/api/alert-rules/:id', { params: { id: '42' }, body: { deliver_via: 'nope' } });
    assert.equal(res.statusCode, 400);
    assert.equal(pool.updates.length, 0);
  });
});

describe('GET /api/alert-rules', () => {
  it('returns deliver_via/telegram_chat_ids as part of SELECT * (no field-list to drift)', async () => {
    const { app, registry } = makeApp();
    const pool = { async query(sql) {
      assert.match(sql, /SELECT \* FROM alert_rules WHERE channel IS NULL/);
      return { rows: [{ id: 1, name: 'R1', deliver_via: 'both', telegram_chat_ids: ['-100111'] }] };
    } };
    alertRulesRoutes(app, pool);
    const res = await call(registry, 'get', '/api/alert-rules', {});
    assert.equal(res.body[0].deliver_via, 'both');
    assert.deepEqual(res.body[0].telegram_chat_ids, ['-100111']);
  });
});
