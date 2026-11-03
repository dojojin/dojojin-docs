// ============================================================
// Vigil Platform — Tests: sendLprAlert() manualChannel='telegram' (manual Telegram send)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Twin of telegram-t2a-lpr.test.js's fixtures, for the new "ส่งเข้า Telegram ·
// ระบุเอง" button path — manualChannel='telegram' must:
//   - never call LINE, regardless of deliver_via
//   - honor explicit telegramChatIds, or fall back to the site/group-scoped
//     chats (selectRecipients) when empty, same rule as recipientIds on LINE
//   - carry the "📣 ส่งด้วยตนเองโดย <name>" label into the Telegram caption
//     (not just the log text)
// global.fetch stubbed to throw by default — any accidental real Telegram
// call fails loudly (same convention as telegram-t2a-lpr.test.js).
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const { encryptPii } = require('../src/helpers/blacklist-crypto');

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — every test must stub global.fetch'); };
});
afterEach(() => { global.fetch = _origFetch; });

function freshLprLineAlert() {
  delete require.cache[require.resolve('../src/helpers/lprLineAlert')];
  return require('../src/helpers/lprLineAlert');
}

function jsonRes(body, status = 200) { return { status, json: async () => body }; }

function baseEvent(over = {}) {
  return { id: 55, camera_id: 3, event_time: new Date().toISOString(),
           snapshot_filename: null, plate_image: null, camera_name: 'Cam1', ...over };
}

function makePool({ cfg, chan = null, tgChats = [], tgConfig = { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) },
                     cooldownRemain = 0, hourlySent = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [cfg] };
      if (sql.includes('FROM lpr_watchlist_groups WHERE id')) return { rows: [{ name: 'เฝ้าระวัง', notify_line: true }] };
      if (sql.includes('blacklist_master_id FROM lpr_watchlist')) return { rows: [{ notes: null, notify_line: true, blacklist_master_id: null }] };
      if (sql.includes('FROM cameras c')) return { rows: [{ camera_name: 'C1', site_code: 'hkt', site_name: 'ภูเก็ต', vehicle_type: null, vehicle_color: null, plate_image: null }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: tgChats }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [tgConfig] };
      if (sql.includes(`FROM alert_rules WHERE channel = 'lpr'`)) return { rows: chan ? [chan] : [] };
      if (sql.includes('FROM lpr_alert_cooldown WHERE plate_number')) return { rows: [{ remain: cooldownRemain }] };
      if (sql.includes('FROM lpr_alert_hourly')) return { rows: [{ sent: hourlySent }] };
      if (sql.includes('FROM lpr_plate_mutes')) return { rows: [] };
      if (sql.includes('INSERT INTO lpr_alert_cooldown')) return { rows: [] };
      if (sql.includes('INSERT INTO lpr_alert_hourly')) return { rows: [] };
      if (sql.includes('ref_image FROM lpr_watchlist')) return { rows: [] };
      if (sql.includes('INSERT INTO alert_logs')) return { rows: [] };
      if (sql.includes('FROM system_settings')) return { rows: [] };
      throw new Error('unexpected sql in fake pool: ' + sql.slice(0, 100));
    },
  };
}

function makeLineSender() {
  const calls = [];
  return { calls, sendAlert: async (opts) => { calls.push(opts); return { sentCount: opts.recipients.length, imageSource: 'none', recipientsLog: [] }; } };
}

function fetchCounter() {
  const calls = [];
  global.fetch = (url, opts) => { calls.push({ url, opts }); return jsonRes({ ok: true, result: { message_id: 42 } }); };
  return calls;
}

function lastAlertLogParams(pool) {
  const call = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs')).at(-1);
  return call ? call.params : null;
}

describe('sendLprAlert — manualChannel="telegram" (manual Telegram send)', () => {
  it('deliver_via="line" (default) — LINE is skipped entirely, explicit chat gets the card', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const tgChats = [
      { chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true },
      { chat_id: '-100222', name: 'อื่น', type: 'group', enabled: true },
    ];
    const pool = makePool({ cfg, chan: null, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    const out = await sendLprAlert({
      pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant',
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100111'],
    });

    assert.equal(lineSender.calls.length, 0, 'LINE must never be called for a Telegram-only manual send');
    assert.equal(fetchCalls.length, 1, 'only the explicitly-picked chat is sent to');
    // no images on this event → sendMessage (key `text`), not sendPhoto (key `caption`)
    const body = JSON.parse(fetchCalls[0].opts.body);
    const sentText = body.text || body.caption;
    assert.ok(sentText.includes('ส่งด้วยตนเองโดย somchai'), 'the manual label must reach the Telegram card, not just the log');
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'sent_manual');
    void out; // sendLprAlert returns the pg INSERT result, not a status object (pre-existing, same as the LINE twin)
  });

  it('empty telegramChatIds falls back to the site/group-scoped chats (selectRecipients), same as the LINE twin', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const tgChats = [
      { chat_id: '-100111', name: 'ทุกไซต์', type: 'group', enabled: true },
      { chat_id: '-100999', name: 'หาดใหญ่เท่านั้น', type: 'group', enabled: true, lpr_sites: ['hdy'] },
    ];
    const pool = makePool({ cfg, chan: null, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({
      pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant',
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: null,
    });
    // camera site_code stubbed to 'hkt' — only the un-scoped chat matches
    assert.equal(fetchCalls.length, 1, 'must reach only the site-scoped default chat, not the hdy-only one');
  });

  it('an unrelated recipientIds pick never suppresses the manual Telegram leg', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const tgChats = [{ chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan: null, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({
      pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant',
      force: true, manualBy: 'somchai', recipientIds: ['U1'],
      manualChannel: 'telegram', telegramChatIds: ['-100111'],
    });
    assert.equal(fetchCalls.length, 1, 'the LINE-only skipTelegram flag must not apply to manualChannel=telegram');
  });

  it('a custom message_template (sections=null) does not duplicate the manual label in the card', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line', message_template: 'custom: {plate}' };
    const tgChats = [{ chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({
      pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant',
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100111'],
    });
    const body = JSON.parse(fetchCalls[0].opts.body);
    const sentText = body.text || body.caption;
    const occurrences = (sentText.match(/ส่งด้วยตนเองโดย somchai/g) || []).length;
    assert.equal(occurrences, 1, 'the label must appear exactly once, not once from `text` and again from the card label');
  });

  it('force=true bypasses cooldown/hourly-cap writes entirely for a manual Telegram send', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] };
    const tgChats = [{ chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan: null, tgChats, cooldownRemain: 120 });
    const lineSender = makeLineSender();
    fetchCounter();
    await sendLprAlert({
      pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant',
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100111'],
    });
    const claims = pool.calls.filter(c => c.sql.includes('INSERT INTO lpr_alert_cooldown') || c.sql.includes('INSERT INTO lpr_alert_hourly'));
    assert.equal(claims.length, 0, 'force=true must skip both cooldown/hourly-cap claims');
  });
});
