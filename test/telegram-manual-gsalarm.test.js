// ============================================================
// Vigil Platform — Tests: sendGsAlarm() manualChannel='telegram' (manual Telegram send)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Twin of telegram-t2a-gsalarm.test.js's fixtures, for the new "ส่งเข้า Telegram ·
// ระบุเอง" button on the GuruSquare Events Alarm modal.
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

function makePool({ cfg, chan = null, tgChats = [], tgConfig = { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) } } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [cfg] };
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: chan ? [chan] : [] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: tgChats }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [tgConfig] };
      if (sql.includes('FROM lpr_alert_cooldown')) return { rows: [{ remain: 0 }] };
      if (sql.includes('FROM lpr_alert_hourly')) return { rows: [{ sent: 0 }] };
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
  return { calls, sendAlert: async (opts) => { calls.push(opts); return { sentCount: opts.recipients.length, imageSource: 'none', recipientsLog: [] }; } };
}

function fetchCounter() {
  const calls = [];
  global.fetch = (url, opts) => { calls.push({ url, opts }); return jsonRes({ ok: true, result: { message_id: 7 } }); };
  return calls;
}

describe('sendGsAlarm — manualChannel="telegram" (manual Telegram send)', () => {
  it('LINE is skipped entirely, explicit chat gets the card with the manual label', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const tgChats = [{ chat_id: '-100555', name: 'สภ.กะรน', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan: null, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({
      pool, lineSender, alarm: baseAlarm(),
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100555'],
    });

    assert.equal(lineSender.calls.length, 0, 'LINE must never be called for a Telegram-only manual send');
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].opts.body);
    const sentText = body.text || body.caption;
    assert.ok(sentText.includes('ส่งด้วยตนเองโดย somchai'));
  });

  it('empty telegramChatIds falls back to the channel default (chan.telegram_chat_ids)', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] };
    const chan = { id: 4, enabled: true, deliver_via: 'line', telegram_chat_ids: ['-100777'] };
    const tgChats = [
      { chat_id: '-100777', name: 'ค่าเริ่มต้นของช่องทาง', type: 'group', enabled: true },
      { chat_id: '-100888', name: 'ไม่เกี่ยว', type: 'group', enabled: true },
    ];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({
      pool, lineSender, alarm: baseAlarm(),
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: null,
    });
    assert.equal(fetchCalls.length, 1, 'must reach only the channel-configured default chat');
  });

  it('does not overwrite gs_alarms.line_status on a manual Telegram send (success or failure)', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] };
    const tgChats = [{ chat_id: '-100555', name: 'สภ.กะรน', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan: null, tgChats });
    const lineSender = makeLineSender();
    fetchCounter();
    await sendGsAlarm({
      pool, lineSender, alarm: baseAlarm(),
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100555'],
    });
    const statusUpdates = pool.calls.filter((c) => c.sql.includes('UPDATE blacklist.gs_alarms'));
    assert.equal(statusUpdates.length, 0, 'line_status is a LINE-only column and must not be touched by a Telegram-only send');
    const logInserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs'));
    assert.equal(logInserts.length, 1, 'the send is still recorded in alert_logs');
  });

  it('a custom message_template (sections=null) does not duplicate the manual label in the card', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] };
    const chan = { id: 4, enabled: true, deliver_via: 'line', message_template: 'custom: {plate}', telegram_chat_ids: [] };
    const tgChats = [{ chat_id: '-100555', name: 'สภ.กะรน', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendGsAlarm({
      pool, lineSender, alarm: baseAlarm(),
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100555'],
    });
    const body = JSON.parse(fetchCalls[0].opts.body);
    const sentText = body.text || body.caption;
    const occurrences = (sentText.match(/ส่งด้วยตนเองโดย somchai/g) || []).length;
    assert.equal(occurrences, 1, 'the label must appear exactly once');
  });

  it('force=true bypasses cooldown/hourly-cap writes entirely', async () => {
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] };
    const tgChats = [{ chat_id: '-100555', name: 'สภ.กะรน', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan: null, tgChats });
    const lineSender = makeLineSender();
    fetchCounter();
    await sendGsAlarm({
      pool, lineSender, alarm: baseAlarm(),
      force: true, manualBy: 'somchai', manualChannel: 'telegram', telegramChatIds: ['-100555'],
    });
    const claims = pool.calls.filter(c => c.sql.includes('INSERT INTO lpr_alert_cooldown') || c.sql.includes('INSERT INTO lpr_alert_hourly'));
    assert.equal(claims.length, 0, 'force=true must skip both cooldown/hourly-cap claims');
  });
});
