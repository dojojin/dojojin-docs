// ============================================================
// Vigil Platform — Tests: sendLprAlert() deliver_via (T2a — Telegram leg)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// lprChannel()/_sysSettings() cache their DB reads at module scope (30s/60s
// TTL) — real behaviour, not a test artifact. Each `it()` here re-requires
// helpers/lprLineAlert.js via a fresh require.cache entry so a different
// `chan.deliver_via` per test takes effect immediately instead of racing a
// TTL window. global.fetch is stubbed to throw by default (same convention as
// telegram-t1.test.js) so any accidental real Telegram call fails loudly.
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
  global.fetch = (url, opts) => { calls.push({ url, opts }); return jsonRes({ ok: true, result: { message_id: 42 } }); };
  return calls;
}

function lastAlertLogParams(pool) {
  const call = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs')).at(-1);
  return call ? call.params : null;
}

describe('sendLprAlert — deliver_via (T2a)', () => {
  it("deliver_via not set (no alert_rules row) => 'line' — Telegram never touched, output unchanged", async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const pool = makePool({ cfg, chan: null });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(lineSender.calls.length, 1, 'LINE must still be called on the default path');
    assert.equal(fetchCalls.length, 0, 'Telegram must never be touched when deliver_via defaults to line');
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'sent');
    assert.equal(params[7], 1, 'recipient_count = LINE-only');
    const log = JSON.parse(params[12]);
    assert.equal(log.length, 1);
    assert.equal(log[0].channel, undefined, 'LINE log entries carry no channel field');
  });

  it("deliver_via='telegram' — LINE never called, recipientCount counts chats (no no_recipients)", async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [] }; // no LINE recipients at all
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'telegram' };
    const tgChats = [{ chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(lineSender.calls.length, 0, 'LINE must not be called when deliver_via is telegram-only');
    assert.ok(fetchCalls.length >= 1, 'Telegram must be called');
    const params = lastAlertLogParams(pool);
    assert.notEqual(params[5], 'no_recipients', 'a telegram-only channel with 0 LINE recipients must not read as no_recipients');
    assert.equal(params[5], 'sent');
    assert.equal(params[7], 1, 'recipient_count = telegram chats only');
    const log = JSON.parse(params[12]);
    assert.equal(log.length, 1);
    assert.equal(log[0].channel, 'telegram');
    assert.equal(log[0].ok, true);
  });

  it("deliver_via='both' — both legs fire, one alert_logs row with merged recipients_json", async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'both' };
    const tgChats = [{ chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(lineSender.calls.length, 1);
    assert.ok(fetchCalls.length >= 1);
    const logInserts = pool.calls.filter((c) => c.sql.includes('INSERT INTO alert_logs'));
    assert.equal(logInserts.length, 1, 'both legs merge into exactly one alert_logs row');
    const params = logInserts[0].params;
    assert.equal(params[5], 'sent');
    assert.equal(params[7], 2, 'recipient_count = LINE (1) + telegram (1)');
    const log = JSON.parse(params[12]);
    assert.equal(log.length, 2);
    assert.ok(log.some((r) => r.channel === 'telegram'));
    assert.ok(log.some((r) => r.channel === undefined));
  });
});

describe('sendLprAlert — cooldown is shared across both channels', () => {
  it('a live cooldown suppresses the send entirely — neither LINE nor Telegram is touched', async () => {
    const { sendLprAlert } = freshLprLineAlert();
    const cfg = { enabled: true, channel_access_token: 'tok', recipients: [{ id: 'U1', name: 'Owner', enabled: true }] };
    const chan = { id: 9, enabled: true, cooldown_seconds: 300, deliver_via: 'both' };
    const tgChats = [{ chat_id: '-100111', name: 'ตำรวจภูเก็ต', type: 'group', enabled: true }];
    const pool = makePool({ cfg, chan, tgChats, cooldownRemain: 120 });
    const lineSender = makeLineSender();
    const fetchCalls = fetchCounter();
    await sendLprAlert({ pool, lineSender, event: baseEvent(), plate: 'กก1234', groupId: 'warrant' });

    assert.equal(lineSender.calls.length, 0);
    assert.equal(fetchCalls.length, 0);
    const params = lastAlertLogParams(pool);
    assert.equal(params[5], 'cooldown_skip');
  });
});
