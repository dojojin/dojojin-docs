// ============================================================
// Vigil Platform — Tests: alert-engine.js sendTestForRule() manualChannel='telegram'
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// New "ส่งเข้า Telegram · ระบุเอง" button on the Face Recognition detail modal
// calls sendTestForRule(..., { manualChannel: 'telegram' }). Must:
//   - never touch the LINE recipient-resolution block (a rule with only
//     telegram_chat_ids and NO recipient_ids must not throw)
//   - honor explicit telegramChatIds, or fall back to rule.telegram_chat_ids
//   - carry the manual label into the Telegram card
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/alert-engine');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function jsonRes(body, status = 200) { return { status, json: async () => body }; }

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — every test must stub global.fetch'); };
});
afterEach(() => { global.fetch = _origFetch; });

function fetchCounter() {
  const calls = [];
  global.fetch = (url, opts) => { calls.push({ url, opts }); return jsonRes({ ok: true, result: { message_id: 9 } }); };
  return calls;
}

function baseRule(over = {}) {
  return {
    id: 1, name: 'Test Rule', message_template: '', show_open_link: true, send_snapshot: false,
    telegram_chat_ids: [], deliver_via: 'line',
    ...over,
  };
}

// tgChats: what `SELECT chats FROM telegram_config` answers — the manual-send
// branch must read this LIVE (not telegramCache, which refreshCache() only ever
// populates when some rule already has deliver_via telegram/both/line_then_telegram
// — a plain 'line' HCP Face/AuraFace rule would leave it permanently empty).
function makePool(tgChats = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM events e LEFT JOIN cameras')) {
        return { rows: [{ event_id: 42, camera_id: 'C1', event_time: '2026-01-01T00:00:00Z',
                           rule_name: 'Motion', event_type: null, object_class: null, likelihood: null,
                           snapshot_filename: null, raw_json: null, camera_name: 'Cam1', location: 'Gate' }] };
      }
      if (sql.includes('INSERT INTO alert_logs')) return { rows: [] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) {
        return { rows: [{ enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) }] };
      }
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: tgChats }] };
      throw new Error('unexpected sql in fake pool: ' + sql.slice(0, 120));
    },
  };
}

describe('sendTestForRule — manualChannel="telegram"', () => {
  beforeEach(async () => {
    // configCache must be non-null so sendTestForRule skips the real refreshCache()
    // telegramCache is deliberately left EMPTY here — proves the manual branch
    // does not depend on it (see makePool's comment above).
    await engine._testInit({ pool: makePool(), config: {}, telegram: { chats: [] } });
  });

  it('reads telegram_config live — telegramCache staying empty (the api-server-realistic case) does not block the send', async () => {
    const tgChats = [{ chat_id: '-100333', name: 'ทีม A', type: 'group', enabled: true }];
    const pool = makePool(tgChats);
    await engine._testInit({ pool, config: {}, telegram: { chats: [] } }); // cache empty on purpose
    fetchCounter();
    const rule = baseRule({ telegram_chat_ids: ['-100333'] }); // recipient_ids intentionally absent
    const out = await engine.sendTestForRule(pool, rule, 42, null, { manualBy: 'somchai', manualChannel: 'telegram' });
    assert.equal(out.sent, true);
    assert.equal(out.recipients, 1);
  });

  it('throws a clear Thai error when there is no override and the rule has no telegram_chat_ids', async () => {
    const pool = makePool([]);
    await engine._testInit({ pool, config: {}, telegram: { chats: [] } });
    const rule = baseRule({ telegram_chat_ids: [] });
    await assert.rejects(
      () => engine.sendTestForRule(pool, rule, 42, null, { manualBy: 'somchai', manualChannel: 'telegram' }),
      /ยังไม่ได้เลือกแชท Telegram/);
  });

  it('explicit telegramChatIds overrides rule.telegram_chat_ids and the manual label reaches the card', async () => {
    const tgChats = [
      { chat_id: '-100333', name: 'ค่าเริ่มต้นของกฎ', type: 'group', enabled: true },
      { chat_id: '-100444', name: 'เลือกเอง', type: 'group', enabled: true },
    ];
    const pool = makePool(tgChats);
    await engine._testInit({ pool, config: {}, telegram: { chats: [] } });
    const fetchCalls = fetchCounter();
    const rule = baseRule({ telegram_chat_ids: ['-100333'] });
    await engine.sendTestForRule(pool, rule, 42, null,
      { manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100444'] });

    assert.equal(fetchCalls.length, 1, 'only the explicitly-picked chat must be reached');
    const body = JSON.parse(fetchCalls[0].opts.body);
    const sentText = body.text || body.caption;
    assert.ok(sentText.includes('ส่งด้วยตนเองโดย somchai'));
  });

  it('a disabled chat in the explicit pick is dropped — never sent to', async () => {
    const tgChats = [{ chat_id: '-100555', name: 'ปิดอยู่', type: 'group', enabled: false }];
    const pool = makePool(tgChats);
    await engine._testInit({ pool, config: {}, telegram: { chats: [] } });
    fetchCounter();
    const rule = baseRule();
    await assert.rejects(
      () => engine.sendTestForRule(pool, rule, 42, null,
        { manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100555'] }),
      /แชทที่เลือกใช้ไม่ได้/);
  });
});

describe('sendTestForRule — manualChannel absent (unchanged LINE path, manual send button)', () => {
  it('goes through the LINE sender exactly as before — Telegram is never touched', async () => {
    const pool = makePool();
    const lineCalls = [];
    const stubLineSender = {
      sendAlert: async (args) => {
        lineCalls.push(args);
        return { sentCount: args.recipients.length, imageSource: 'none', recipientsLog: [] };
      },
    };
    await engine._testInit({
      pool, lineSender: stubLineSender,
      config: { recipients: [{ id: 'r1', enabled: true, name: 'Somchai', type: 'user' }] },
      telegram: { chats: [] },
    });
    const fetchCalls = fetchCounter();
    const rule = baseRule({ recipient_ids: ['r1'], message_template: 'hi {camera}' });
    const out = await engine.sendTestForRule(pool, rule, 42, null, { manualBy: 'somchai' });

    assert.equal(lineCalls.length, 1, 'LINE sendAlert must still be called');
    assert.ok(lineCalls[0].rule.message_template.includes('ส่งด้วยตนเองโดย somchai'), 'prefix still applied to the LINE template');
    assert.equal(out.sent, true);
    assert.equal(fetchCalls.length, 0, 'Telegram (fetch) must never be touched on the plain LINE manual-send path');
  });
});
