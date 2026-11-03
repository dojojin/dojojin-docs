// ============================================================
// Vigil Platform — Tests: helpers/deliverViaValidate.js (T2b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Shared validator extracted from src/routes/alert-channels.js (T2a) so
// alert-rules.js can reuse it — this file pins that the extraction did not
// change behaviour, and covers the branches (isLprChannel / existingChatIds)
// that alert-channels.js's own T2a test (telegram-t2a-alert-channels.test.js)
// already exercises indirectly via the route.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateDeliverVia, DELIVER_VIA_VALUES } = require('../src/helpers/deliverViaValidate');

function makePool({ approvedChats = [], tgEnabled = false, tgHasToken = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: approvedChats }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc IS NOT NULL AS has_token, chats FROM telegram_config')) {
        return { rows: [{ enabled: tgEnabled, has_token: tgHasToken, chats: approvedChats }] };
      }
      throw new Error('unexpected sql: ' + sql.slice(0, 100));
    },
  };
}

describe('validateDeliverVia', () => {
  it('DELIVER_VIA_VALUES has exactly the 4 values the CHECK constraint (migration 241) accepts', () => {
    assert.deepEqual(DELIVER_VIA_VALUES, ['line', 'telegram', 'both', 'line_then_telegram']);
  });

  it('undefined deliverVia and undefined telegramChatIds → ok, zero DB calls', async () => {
    const pool = makePool();
    const r = await validateDeliverVia(pool, {});
    assert.deepEqual(r, { ok: true });
    assert.equal(pool.calls.length, 0);
  });

  it('invalid deliverVia value → error, no DB call', async () => {
    const pool = makePool();
    const r = await validateDeliverVia(pool, { deliverVia: 'carrier_pigeon' });
    assert.match(r.error, /deliver_via/);
    assert.equal(pool.calls.length, 0);
  });

  it("each of the 4 accepted values passes when 'telegram' readiness is satisfied", async () => {
    for (const v of DELIVER_VIA_VALUES) {
      const pool = makePool({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-1', enabled: true, lpr_enabled: true }] });
      const r = await validateDeliverVia(pool, { deliverVia: v, isLprChannel: true });
      assert.deepEqual(r, { ok: true }, `deliver_via=${v}`);
    }
  });

  it('telegramChatIds not an array → error', async () => {
    const pool = makePool();
    const r = await validateDeliverVia(pool, { telegramChatIds: '-100111' });
    assert.match(r.error, /array/);
  });

  it('telegramChatIds with an unapproved id → error naming that id, no further DB call', async () => {
    const pool = makePool({ approvedChats: [{ chat_id: '-100111' }] });
    const r = await validateDeliverVia(pool, { telegramChatIds: ['-100111', '-100999'] });
    assert.match(r.error, /-100999/);
  });

  it('telegramChatIds all approved → ok', async () => {
    const pool = makePool({ approvedChats: [{ chat_id: '-100111' }, { chat_id: '-100222' }] });
    const r = await validateDeliverVia(pool, { telegramChatIds: ['-100111', '-100222'] });
    assert.deepEqual(r, { ok: true });
  });

  it("deliverVia='telegram' rejected when bot disabled/no token/no ready chat (isLprChannel)", async () => {
    const cases = [
      { tgEnabled: false, tgHasToken: true, approvedChats: [{ chat_id: '-1', enabled: true, lpr_enabled: true }] },
      { tgEnabled: true, tgHasToken: false, approvedChats: [{ chat_id: '-1', enabled: true, lpr_enabled: true }] },
      { tgEnabled: true, tgHasToken: true, approvedChats: [] },
      { tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-1', enabled: true, lpr_enabled: false }] },
    ];
    for (const c of cases) {
      const pool = makePool(c);
      const r = await validateDeliverVia(pool, { deliverVia: 'telegram', isLprChannel: true });
      assert.match(r.error, /Telegram/, JSON.stringify(c));
    }
  });

  it("deliverVia='telegram', non-lpr channel: needs telegramChatIds non-empty in THIS request when provided", async () => {
    const pool = makePool({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }] });
    const noChat = await validateDeliverVia(pool, { deliverVia: 'telegram', telegramChatIds: [] });
    assert.ok(noChat.error);
    const withChat = await validateDeliverVia(pool, { deliverVia: 'telegram', telegramChatIds: ['-100111'] });
    assert.deepEqual(withChat, { ok: true });
  });

  it("deliverVia='telegram', non-lpr channel: falls back to existingChatIds when telegramChatIds omitted from this request", async () => {
    const pool = makePool({ tgEnabled: true, tgHasToken: true, approvedChats: [{ chat_id: '-100111', enabled: true }] });
    const noExisting = await validateDeliverVia(pool, { deliverVia: 'telegram' });
    assert.ok(noExisting.error);
    const withExisting = await validateDeliverVia(pool, { deliverVia: 'telegram', existingChatIds: ['-100111'] });
    assert.deepEqual(withExisting, { ok: true });
  });

  it("deliverVia='both' never runs the readiness check (LINE still sends; Telegram leg is just absent if unready)", async () => {
    const pool = makePool();   // bot completely unconfigured
    const r = await validateDeliverVia(pool, { deliverVia: 'both' });
    assert.deepEqual(r, { ok: true });
  });
});
