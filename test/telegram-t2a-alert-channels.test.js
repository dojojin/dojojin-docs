// ============================================================
// Vigil Platform — Tests: routes/alert-channels.js PUT deliver_via (T2a)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Only exercises the new deliver_via / telegram_chat_ids validation added for
// T2a — not a full re-test of the pre-existing alert-channels route surface
// (rule_names locking, list_types, etc. were already covered by hand and are
// unchanged by this phase).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const alertChannelRoutes = require('../src/routes/alert-channels');

function makeApp() {
  const registry = [];
  const app = {};
  for (const m of ['get', 'put', 'post']) app[m] = (p, ...fns) => registry.push({ method: m, path: p, mws: fns });
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

function makePool({ approvedChats = [], existingRuleId = 42, ruleRow = {}, tgEnabled = false, tgHasToken = false } = {}) {
  const calls = [];
  const updates = [];
  return {
    calls,
    updates,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: approvedChats }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc IS NOT NULL AS has_token, chats FROM telegram_config')) {
        return { rows: [{ enabled: tgEnabled, has_token: tgHasToken, chats: approvedChats }] };
      }
      if (sql.includes('SELECT id FROM alert_rules WHERE channel')) return { rows: [{ id: existingRuleId }] };
      if (sql.startsWith('SELECT telegram_chat_ids FROM alert_rules')) return { rows: [{ telegram_chat_ids: ruleRow.telegram_chat_ids || [] }] };
      if (sql.startsWith('UPDATE alert_rules SET')) { updates.push(params); return { rows: [] }; }
      if (sql.includes(`SELECT pg_notify`)) return { rows: [] };
      if (sql.includes('SELECT * FROM alert_rules WHERE id')) return { rows: [{ id: existingRuleId, channel: 'lpr', ...ruleRow }] };
      if (sql.includes('FROM alert_logs')) return { rows: [{ n_24h: 0, n_failed: 0, n_skipped: 0, n_imgbb: 0, n_noimg: 0, last_sent: null }] };
      throw new Error('unexpected sql: ' + sql.slice(0, 100));
    },
  };
}

function setup(poolOpts) {
  const { app, registry } = makeApp();
  const pool = makePool(poolOpts);
  const routeError = (res, e) => { throw e; };
  alertChannelRoutes(app, pool, { auth: { requireAdmin: (req, res, next) => next && next() }, routeError });
  return { registry, pool };
}

describe('PUT /api/alert-channels/:channel — deliver_via validation', () => {
  it('invalid deliver_via value => 400, no DB write', async () => {
    const { registry, pool } = setup();
    const res = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'lpr' }, body: { deliver_via: 'carrier_pigeon' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /deliver_via/);
    assert.equal(pool.updates.length, 0);
  });

  it("each of the 4 accepted values passes validation ('line','telegram','both','line_then_telegram')", async () => {
    for (const v of ['line', 'telegram', 'both', 'line_then_telegram']) {
      // 'telegram' ต้องมีบอทพร้อม + แชทรับจริง (ดูเทสต์ถัดไป) — ที่นี่ตั้งให้พร้อม
      const { registry } = setup({ tgEnabled: true, tgHasToken: true,
        approvedChats: [{ chat_id: '-100111', enabled: true, lpr_enabled: true }] });
      const res = await call(registry, 'put', '/api/alert-channels/:channel',
        { params: { channel: 'lpr' }, body: { deliver_via: v } });
      assert.equal(res.statusCode, 200, `deliver_via=${v} should be accepted`);
    }
  });

  // audit T2 2026-09-24: "Telegram อย่างเดียว" ตอนบอทไม่พร้อม = แจ้งเตือนหยุดเงียบ ๆ
  it("deliver_via='telegram' is rejected when the bot is off, has no token, or has no chat", async () => {
    const cases = [
      { tgEnabled: false, tgHasToken: true,  approvedChats: [{ chat_id: '-1', enabled: true }] },
      { tgEnabled: true,  tgHasToken: false, approvedChats: [{ chat_id: '-1', enabled: true }] },
      { tgEnabled: true,  tgHasToken: true,  approvedChats: [] },
      { tgEnabled: true,  tgHasToken: true,  approvedChats: [{ chat_id: '-1', enabled: true, lpr_enabled: false }] },
    ];
    for (const c of cases) {
      const { registry, pool } = setup(c);
      const res = await call(registry, 'put', '/api/alert-channels/:channel',
        { params: { channel: 'lpr' }, body: { deliver_via: 'telegram' } });
      assert.equal(res.statusCode, 400, JSON.stringify(c));
      assert.equal(pool.updates.length, 0);
    }
    // gs_alarm: ต้องเลือกแชทมาด้วย
    const { registry } = setup({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }] });
    const noChat = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'gs_alarm' }, body: { deliver_via: 'telegram' } });
    assert.equal(noChat.statusCode, 400);
    const withChat = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'gs_alarm' }, body: { deliver_via: 'telegram', telegram_chat_ids: ['-100111'] } });
    assert.equal(withChat.statusCode, 200);
    // เคยบันทึกแชทไว้แล้ว เปลี่ยนแค่ช่องทาง → ต้องผ่าน
    const saved = setup({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }],
      ruleRow: { telegram_chat_ids: ['-100111'] } });
    const onlyVia = await call(saved.registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'gs_alarm' }, body: { deliver_via: 'telegram' } });
    assert.equal(onlyVia.statusCode, 200);
  });

  it('telegram_chat_ids must be an array', async () => {
    const { registry } = setup();
    const res = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'gs_alarm' }, body: { telegram_chat_ids: '-100111' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /array/);
  });

  it('telegram_chat_ids with a chat_id that is not approved => 400', async () => {
    const { registry, pool } = setup({ approvedChats: [{ chat_id: '-100111' }] });
    const res = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'gs_alarm' }, body: { telegram_chat_ids: ['-100111', '-100999'] } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /-100999/);
    assert.equal(pool.updates.length, 0);
  });

  it('telegram_chat_ids all approved => saved, and shows up in the UPDATE params', async () => {
    const { registry, pool } = setup({ approvedChats: [{ chat_id: '-100111' }, { chat_id: '-100222' }] });
    const res = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'gs_alarm' }, body: { telegram_chat_ids: ['-100111', '-100222'], deliver_via: 'both' } });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.updates.length, 1);
    assert.ok(pool.updates[0].some((v) => Array.isArray(v) && v.includes('-100111') && v.includes('-100222')));
    assert.ok(pool.updates[0].includes('both'));
  });

  it('unknown channel => 404 before any validation runs', async () => {
    const { registry } = setup();
    const res = await call(registry, 'put', '/api/alert-channels/:channel',
      { params: { channel: 'nope' }, body: { deliver_via: 'telegram' } });
    assert.equal(res.statusCode, 404);
  });

  // audit T2 2026-09-24: GET ไม่คืน deliver_via → หน้าจอขึ้น LINE เสมอ แล้วบันทึกทับกลับ
  it('GET returns deliver_via and telegram_chat_ids so the form does not reset them', async () => {
    const { app, registry } = makeApp();
    const pool = { async query(sql) {
      if (sql.includes('FROM alert_rules WHERE channel IS NOT NULL')) {
        return { rows: [{ id: 7, channel: 'gs_alarm', enabled: true, deliver_via: 'both', telegram_chat_ids: ['-100111'] }] };
      }
      if (sql.includes('FROM alert_logs')) return { rows: [{}] };
      if (sql.includes('FROM line_config')) return { rows: [{ edge_alert: {} }] };
      return { rows: [] };
    } };
    require('../src/routes/alert-channels')(app, pool, { auth: { requireAdmin: (q, r, n) => n() }, routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/alert-channels', {});
    const gs = res.body.find((x) => x.channel === 'gs_alarm');
    assert.equal(gs.rule.deliver_via, 'both');
    assert.deepEqual(gs.rule.telegram_chat_ids, ['-100111']);
  });
});
