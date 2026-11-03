// ============================================================
// Vigil Platform — Tests: telegramPoller group→supergroup migration (T2a)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Telegram sends a migrate_to_chat_id/migrate_from_chat_id service message
// when a group is upgraded to a supergroup — chat_id changes permanently.
// applyUpdate() must recognise it (pure), and _pollOnce()/_handleUpdate()
// must rewrite both telegram_config.chats and telegram_pending to the new id
// without resetting approve/ignore/block status back to pending.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const poller = require('../src/helpers/telegramPoller');

const BOT_ID = 123456789;
const FAKE_TOKEN = `${BOT_ID}:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

describe('telegramPoller.applyUpdate — group migration', () => {
  it('migrate_to_chat_id (message in the OLD group) => chat_migrated with old/new ids', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -100111, type: 'group' }, migrate_to_chat_id: -100999999111 },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'chat_migrated', old_chat_id: -100111, new_chat_id: -100999999111 });
  });

  it('migrate_from_chat_id (message in the NEW supergroup) => same pair, either order', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -100999999111, type: 'supergroup' }, migrate_from_chat_id: -100111 },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'chat_migrated', old_chat_id: -100111, new_chat_id: -100999999111 });
  });

  it('an ordinary message is unaffected (no migrate fields => normal handling still applies)', () => {
    const a = poller.applyUpdate({ message: { chat: { id: -1, type: 'group' }, text: '/start' } }, BOT_ID);
    assert.equal(a.type, 'upsert_pending');
  });
});

function makeMigratePool() {
  const calls = [];
  const state = {
    chats: [{ chat_id: '-100111', name: 'กลุ่มทดสอบ', enabled: true, lpr_enabled: true }],
    pending: new Map([['-100111', { chat_id: '-100111', title: 'กลุ่มทดสอบ', type: 'group', status: 'approved' }]]),
  };
  return {
    state, calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE telegram_config SET chats')) {
        const [oldId, newId] = params;
        state.chats = state.chats.map((c) => (c.chat_id === oldId ? { ...c, chat_id: newId } : c));
        return { rows: [] };
      }
      if (sql.includes('UPDATE telegram_pending SET chat_id')) {
        const [oldId, newId] = params;
        const row = state.pending.get(oldId);
        if (row) { state.pending.delete(oldId); state.pending.set(newId, { ...row, chat_id: newId }); }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe('telegramPoller._pollOnce — migration rewrites both tables', () => {
  it('migrate_to_chat_id updates telegram_config.chats and telegram_pending.chat_id, keeps status', async () => {
    const pool = makeMigratePool();
    const stubSender = {
      getUpdates: async () => ({
        success: true,
        result: [{ update_id: 1, message: { chat: { id: -100111, type: 'group' }, migrate_to_chat_id: -100999999111 } }],
      }),
    };
    const r = await poller._pollOnce(pool, stubSender, FAKE_TOKEN, 0);
    assert.equal(r.offset, 2);
    assert.equal(pool.state.chats[0].chat_id, '-100999999111', 'chats[].chat_id rewritten to the new id (as a string)');
    assert.equal(pool.state.chats[0].name, 'กลุ่มทดสอบ', 'other fields untouched');
    assert.ok(!pool.state.pending.has('-100111'));
    const moved = pool.state.pending.get('-100999999111');
    assert.ok(moved, 'pending row moved to the new chat_id');
    assert.equal(moved.status, 'approved', 'approve status must survive the migration, not reset to pending');
    assert.equal(moved.title, 'กลุ่มทดสอบ');
  });
});
