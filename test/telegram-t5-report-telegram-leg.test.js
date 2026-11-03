// ============================================================
// Vigil Platform — Tests: helpers/reportTelegramLeg.js (T5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// resolveTelegramTarget/sendTelegramReport/validateApprovedTelegramChatIds ทั้งหมด
// รับ pool + sender เป็นพารามิเตอร์ (DI) — stub ทั้งคู่ ไม่มีการต่อเน็ตจริง
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const {
  resolveTelegramTarget, sendTelegramReport, validateApprovedTelegramChatIds,
} = require('../src/helpers/reportTelegramLeg');

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function makePool(cfg) {
  return {
    calls: [],
    query(sql, params) {
      this.calls.push(sql);
      if (sql.includes('FROM telegram_config WHERE id = 1')) return Promise.resolve({ rows: cfg ? [cfg] : [] });
      throw new Error('unexpected sql: ' + sql);
    },
  };
}

function stubSender(impl) {
  const calls = [];
  return {
    calls,
    async sendReportToTelegram(args) {
      calls.push(args);
      return impl ? impl(args) : { sentCount: args.chatIds.length, results: args.chatIds.map((id) => ({ chat_id: id, ok: true, error: null })) };
    },
  };
}

describe('resolveTelegramTarget', () => {
  it('empty wanted list → never touches the pool', async () => {
    const pool = makePool(null);
    const r = await resolveTelegramTarget(pool, []);
    assert.deepEqual(r, { chatIds: [] });
    assert.equal(pool.calls.length, 0);
  });

  it('telegram disabled → error, empty chatIds', async () => {
    const pool = makePool({ enabled: false, bot_token_enc: encryptPii(FAKE_TOKEN), chats: [] });
    const r = await resolveTelegramTarget(pool, ['111']);
    assert.equal(r.chatIds.length, 0);
    assert.ok(r.error);
  });

  it('unapproved chat_id is ignored even if requested', async () => {
    const pool = makePool({
      enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN),
      chats: [{ chat_id: '111', enabled: true }],
    });
    const r = await resolveTelegramTarget(pool, ['111', '999']);
    assert.deepEqual(r.chatIds, ['111']);
  });

  it('disabled chat is ignored', async () => {
    const pool = makePool({
      enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN),
      chats: [{ chat_id: '111', enabled: false }, { chat_id: '222', enabled: true }],
    });
    const r = await resolveTelegramTarget(pool, ['111', '222']);
    assert.deepEqual(r.chatIds, ['222']);
  });

  it('no chat matched after filtering → error', async () => {
    const pool = makePool({
      enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN),
      chats: [{ chat_id: '111', enabled: false }],
    });
    const r = await resolveTelegramTarget(pool, ['111']);
    assert.equal(r.chatIds.length, 0);
    assert.ok(r.error);
  });
});

describe('sendTelegramReport', () => {
  it('no telegram_chat_ids on the schedule → returns null, no pool/sender calls', async () => {
    const pool = makePool(null);
    const sender = stubSender();
    const r = await sendTelegramReport({ pool, telegramChatIds: [], pngBuffer: Buffer.alloc(1), caption: 'x', sender });
    assert.equal(r, null);
    assert.equal(pool.calls.length, 0);
    assert.equal(sender.calls.length, 0);
  });

  it('configured but telegram not enabled → non-null result with error, sender never called', async () => {
    const pool = makePool({ enabled: false, bot_token_enc: null, chats: [] });
    const sender = stubSender();
    const r = await sendTelegramReport({ pool, telegramChatIds: ['111'], pngBuffer: Buffer.alloc(1), caption: 'x', sender });
    assert.ok(r);
    assert.equal(r.sentCount, 0);
    assert.ok(r.error);
    assert.equal(sender.calls.length, 0);
  });

  it('success → forwards resolved chatIds/buffer/caption to sender', async () => {
    const pool = makePool({
      enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN),
      chats: [{ chat_id: '111', enabled: true }],
    });
    const sender = stubSender();
    const png = Buffer.from('png');
    const r = await sendTelegramReport({ pool, telegramChatIds: ['111'], pngBuffer: png, caption: 'สวัสดี', sender });
    assert.equal(r.sentCount, 1);
    assert.equal(r.totalRecipients, 1);
    assert.equal(r.error, null);
    assert.equal(sender.calls.length, 1);
    assert.deepEqual(sender.calls[0].chatIds, ['111']);
    assert.equal(sender.calls[0].token, FAKE_TOKEN);
    assert.equal(sender.calls[0].pngBuffer, png);
    assert.equal(sender.calls[0].caption, 'สวัสดี');
  });

  it('partial failure → error summarizes the failing chats', async () => {
    const pool = makePool({
      enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN),
      chats: [{ chat_id: '111', enabled: true }, { chat_id: '222', enabled: true }],
    });
    const sender = stubSender(() => ({
      sentCount: 1,
      results: [{ chat_id: '111', ok: true, error: null }, { chat_id: '222', ok: false, error: 'blocked' }],
    }));
    const r = await sendTelegramReport({ pool, telegramChatIds: ['111', '222'], pngBuffer: Buffer.alloc(1), caption: 'x', sender });
    assert.equal(r.sentCount, 1);
    assert.equal(r.totalRecipients, 2);
    assert.match(r.error, /222.*blocked/);
  });
});

describe('validateApprovedTelegramChatIds', () => {
  it('undefined input → undefined output, no pool call', async () => {
    const pool = makePool(null);
    const r = await validateApprovedTelegramChatIds(pool, undefined);
    assert.equal(r, undefined);
    assert.equal(pool.calls.length, 0);
  });

  it('empty array → empty array, no pool call', async () => {
    const pool = makePool(null);
    const r = await validateApprovedTelegramChatIds(pool, []);
    assert.deepEqual(r, []);
    assert.equal(pool.calls.length, 0);
  });

  it('non-array input throws', async () => {
    const pool = makePool(null);
    await assert.rejects(() => validateApprovedTelegramChatIds(pool, 'not-an-array'));
  });

  it('malformed chat_id throws', async () => {
    const pool = makePool({ chats: [] });
    await assert.rejects(() => validateApprovedTelegramChatIds(pool, ['not-a-number']));
  });

  it('unapproved chat_id throws', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }] });
    await assert.rejects(() => validateApprovedTelegramChatIds(pool, ['111', '999']));
  });

  it('approved chat_ids pass through deduped as strings', async () => {
    const pool = makePool({ chats: [{ chat_id: '111' }, { chat_id: '-222' }] });
    const r = await validateApprovedTelegramChatIds(pool, ['111', '111', '-222']);
    assert.deepEqual(r, ['111', '-222']);
  });
});
