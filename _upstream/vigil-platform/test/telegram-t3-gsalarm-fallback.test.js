// ============================================================
// Vigil Platform — Tests: sendGsAlarm() deliver_via='line_then_telegram' (T3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Same harness as test/telegram-t2a-gsalarm.test.js.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const { sendGsAlarm } = require('../src/helpers/gsAlarmLine');

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — every test must stub global.fetch'); };
});
afterEach(() => { global.fetch = _origFetch; });

function jsonRes(body, status = 200) { return { status, json: async () => body }; }

function baseAlarm(over = {}) {
  return {
    id: 1, ext_id: 981, source_id: 11, plate: '1กฐ1140',
    alarm_time: new Date().toISOString(),
    province: 'ภูเก็ต', cartype: 'Motorcycle', carcolor: 'Blue', carbrand: 'Honda',
    platetype: 'normal-white-black', owner: 'สภ.กะรน', detail: 'คดีลักทรัพย์',
    ref_photo_path: null, matched_event_id: null, matched_event_time: null,
    camera_name: 'ทางเข้าตลาด', camera_ip: '10.0.10.5',
    capture_source: null, capture_photo_path: null,
    ...over,
  };
}

function makePool({ cfg, chan = null, tgChats = [], tgConfig = { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) },
                     cooldownRemain = 0, hourlySent = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [cfg] };
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: chan ? [chan] : [] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: tgChats }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [tgConfig] };
      if (sql.includes('FROM lpr_alert_cooldown')) return { rows: [{ remain: cooldownRemain }] };
      if (sql.includes('FROM lpr_alert_hourly')) return { rows: [{ sent: hourlySent }] };
      if (sql.includes('FROM lpr_plate_mutes')) return { rows: [] };
      if (sql.includes('FROM events WHERE id')) return { rows: [] };
      if (sql.includes('FROM license_plates WHERE event_id')) return { rows: [] };
      if (sql.includes('FROM blacklist.sources')) return { rows: [{ name: 'ภูเก็ต' }] };
      if (sql.includes('FROM lpr_watchlist')) return { rows: [] };
      if (sql.includes('INSERT INTO lpr_alert_cooldown')) return { rows: [] };
      if (sql.includes('INSERT INTO lpr_alert_hourly')) return { rows: [] };
      if (sql.includes('INSERT INTO alert_logs')) return { rows: [] };
      if (sql.includes('UPDATE blacklist.gs_alarms')) return { rows: [] };
      if (sql.includes('FROM system_settings')) return { rows: [] };
      throw new Error(`unexpected sql in fake pool: ${sql.slice(0, 100)}`);
    },
  };
}

function makeLimitLineSender() {
  const calls = [];
  return {
    calls,
    sendAlert: async (opts) => {
      calls.push(opts);
      return {
        success: false, sentCount: 0, imageSource: 'none',
        error: `[${opts.recipients[0]?.name}] You have reached your monthly limit.`,
        recipientsLog: opts.recipients.map((r) => ({ name: r.name, ok: false, error: 'You have reached your monthly limit.' })),
      };
    },
  };
}

function fetchCounter() {
  const calls = [];
  global.fetch = (url) => { calls.push(url); return jsonRes({ ok: true, result: { message_id: 7 } }); };
  return calls;
}

function lastAlertLogParams(pool) {
  const call = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs')).at(-1);
  return call ? call.params : null;
}

describe("sendGsAlarm — deliver_via='line_then_telegram' (T3)", () => {
  it('LINE ok → Telegram never touched', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = { sendAlert: async (o) => ({ sentCount: o.recipients.length, imageSource: 'none',
      recipientsLog: o.recipients.map((r) => ({ name: r.name, ok: true, error: null })) }) };
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(fetchCalls.length, 0);
    assert.equal(lastAlertLogParams(pool)[5], 'sent');
  });

  it('LINE hits monthly limit + a mirror chat exists → Telegram fallback fires, one merged alert_logs row', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', name: 'Backup', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(lineSender.calls.length, 1);
    assert.ok(fetchCalls.length >= 1, 'Telegram must be called for the fallback');
    const logInserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs'));
    assert.equal(logInserts.length, 1, 'fallback merges into the same row');
    const params = logInserts[0].params;
    assert.equal(params[5], 'sent');
    const log = JSON.parse(params[12]);
    const fb = log.find((r) => r.channel === 'telegram');
    assert.ok(fb);
    assert.equal(fb.fallback, true);
    assert.equal(fb.ok, true);
  });

  it('LINE hits monthly limit but no chat mirrors this recipient → no fallback, status failed', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-1', enabled: true, mirror_of_line_id: 'someone_else' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(fetchCalls.length, 0);
    assert.equal(lastAlertLogParams(pool)[5], 'failed');
  });

  it('a non-quota LINE error never triggers fallback', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = {
      sendAlert: async (o) => ({
        success: false, sentCount: 0, imageSource: 'none', error: '[Owner] Invalid reply token',
        recipientsLog: o.recipients.map((r) => ({ name: r.name, ok: false, error: 'Invalid reply token' })),
      }),
    };
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });
    assert.equal(fetchCalls.length, 0);
    assert.equal(lastAlertLogParams(pool)[5], 'failed');
  });

  it('force=true never triggers fallback', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'line_then_telegram' };
    const tgChats = [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'U1' }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLimitLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm(), force: true });
    assert.equal(fetchCalls.length, 0);
  });
});
