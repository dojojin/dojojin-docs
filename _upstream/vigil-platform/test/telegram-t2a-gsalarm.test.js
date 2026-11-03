// ============================================================
// Vigil Platform — Tests: sendGsAlarm() deliver_via (T2a — Telegram leg)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Same matrix as telegram-t2a-lpr.test.js but for GuruSquare Events Alarm.
// gsAlarmLine's _channel() reads alert_rules fresh every call (no module-level
// cache like lprChannel()), so this file needs none of the require.cache
// gymnastics the LPR test file does.
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

function makeLineSender() {
  const calls = [];
  return {
    calls,
    sendAlert: async (opts) => {
      calls.push(opts);
      return {
        sentCount: opts.recipients.length, imageSource: 'none',
        recipientsLog: opts.recipients.map((r) => ({ name: r.name, type: r.type, id_tail: '0000', ok: true, error: null })),
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

describe('sendGsAlarm — deliver_via (T2a)', () => {
  it("deliver_via not set => 'line' (channel row exists but no deliver_via) — Telegram never touched", async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'] };
    const pool = makePool({ cfg, chan });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(lineSender.calls.length, 1);
    assert.equal(fetchCalls.length, 0);
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'sent');
    assert.equal(params[7], 1);
  });

  it("deliver_via='telegram' — LINE never called, recipientCount counts telegram_chat_ids ∩ approved chats", async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: [], deliver_via: 'telegram', telegram_chat_ids: ['-100111'] };
    const tgChats = [{ chat_id: '-100111', name: 'ทีมตรวจ', type: 'group', enabled: true },
                      { chat_id: '-100222', name: 'ไม่ถูกเลือก', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(lineSender.calls.length, 0);
    assert.ok(fetchCalls.length >= 1);
    const params = lastAlertLogParams(pool);
    assert.notEqual(params[5], 'no_recipients');
    assert.equal(params[5], 'sent');
    assert.equal(params[7], 1, 'only the chat_id listed on telegram_chat_ids counts');
    const log = JSON.parse(params[12]);
    assert.equal(log.length, 1);
    assert.equal(log[0].channel, 'telegram');
  });

  it("deliver_via='both' — both legs fire, one alert_logs row with merged recipients_json", async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'both', telegram_chat_ids: ['-100111'] };
    const tgChats = [{ chat_id: '-100111', name: 'ทีมตรวจ', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(lineSender.calls.length, 1);
    assert.ok(fetchCalls.length >= 1);
    const logInserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs'));
    assert.equal(logInserts.length, 1);
    const params = logInserts[0].params;
    assert.equal(params[5], 'sent');
    assert.equal(params[7], 2);
    const log = JSON.parse(params[12]);
    assert.equal(log.length, 2);
    assert.ok(log.some((r) => r.channel === 'telegram'));
    assert.ok(log.some((r) => r.channel === undefined));
  });
});

describe('sendGsAlarm — cooldown is shared across both channels', () => {
  it('a live cooldown suppresses the send entirely — neither LINE nor Telegram is touched', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 5, enabled: true, cooldown_seconds: 300, recipient_ids: ['U1'], deliver_via: 'both', telegram_chat_ids: ['-100111'] };
    const tgChats = [{ chat_id: '-100111', name: 'ทีมตรวจ', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats, cooldownRemain: 60 });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({ pool, lineSender, alarm: baseAlarm() });

    assert.equal(lineSender.calls.length, 0);
    assert.equal(fetchCalls.length, 0);
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'cooldown_skip');
  });
});
