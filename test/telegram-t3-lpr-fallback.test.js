// ============================================================
// Vigil Platform — Tests: sendLprAlert() deliver_via='line_then_telegram' (T3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Same harness as test/telegram-t2a-lpr.test.js (fresh require, stubbed
// global.fetch, in-memory pool). Only difference: the injected lineSender can
// simulate a LINE "monthly limit" rejection per-recipient, and telegram_config
// chats carry mirror_of_line_id.
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

// Simulates LINE rejecting every recipient with the exact "monthly limit" wording.
function makeLimitLineSender() {
  const calls = [];
  return {
    calls,
    sendAlert: async (opts) => {
      calls.push(opts);
      return {
        success: false, sentCount: 0, imageSource: 'none',
        error: `[${opts.recipients[0]?.name}] You have reached your monthly limit.`,
        recipientsLog: opts.recipients.map((r) => ({
          name: r.name, type: r.type, id_tail: '0000',
          ok: false, error: 'You have reached your monthly limit.',
        })),
      };
    },
  };
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

describe("sendLprAlert — deliver_via='line_then_telegram' (T3)", () => {
  it('LINE ok → Telegram (and fetch) never touched', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', name: 'Police backup', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = { sendAlert: async (o) => ({ sentCount: o.recipients.length, imageSource: 'none',
      recipientsLog: o.recipients.map((r) => ({ name: r.name, ok: true, error: null })) }) };
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(fetchCalls.length, 0, 'LINE succeeded — no fallback call to Telegram');
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'sent');
    const log = JSON.parse(params[12]);
    assert.equal(log.length, 1);
    assert.equal(log[0].fallback, undefined);
  });

  it('LINE rejects with monthly limit + a mirror chat exists → Telegram gets the fallback card, one merged alert_logs row', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', name: 'Police backup', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(lineSender.calls.length, 1);
    assert.ok(fetchCalls.length >= 1, 'Telegram must be called for the fallback');
    const logInserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs'));
    assert.equal(logInserts.length, 1, 'fallback merges into the same alert_logs row, no extra row');
    const params = logInserts[0].params;
    assert.equal(params[5], 'sent', 'fallback success counts toward sent');
    const log = JSON.parse(params[12]);
    const fb = log.find((r) => r.channel === 'telegram');
    assert.ok(fb, 'recipients_json must include the Telegram fallback leg');
    assert.equal(fb.fallback, true);
    assert.equal(fb.ok, true);
  });

  it('LINE rejects with monthly limit but no chat mirrors this recipient → no fallback, status stays failed', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-1', enabled: true, mirror_of_line_id: 'someone_else' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(fetchCalls.length, 0, 'no mirror — must not call Telegram');
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'failed');
  });

  it('a non-quota LINE error never triggers fallback (unchanged from T2)', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = {
      sendAlert: async (o) => ({
        success: false, sentCount: 0, imageSource: 'none', error: '[Owner] Invalid reply token',
        recipientsLog: o.recipients.map((r) => ({ name: r.name, ok: false, error: 'Invalid reply token' })),
      }),
    };
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });
    assert.equal(fetchCalls.length, 0);
    assert.equal(lastAlertLogParams(pool)[5], 'failed');
  });

  it('force=true (test-send button) never triggers fallback even on a monthly-limit error', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant', force: true });
    assert.equal(fetchCalls.length, 0, 'force must never trigger fallback per spec');
  });

  it('recipientIds (test-send to specific people) never triggers fallback', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant', recipientIds: ['U1'] });
    assert.equal(fetchCalls.length, 0, 'recipientIds must never trigger fallback per spec');
  });
});
