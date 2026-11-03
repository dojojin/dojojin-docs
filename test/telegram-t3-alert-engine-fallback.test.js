// ============================================================
// Vigil Platform — Tests: alert-engine.js deliver_via='line_then_telegram' (T3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Stubs only — monkey-patches lineSender.sendAlert/notifier.sendTelegramLeg
// the same way test/telegram-t2b-alert-engine.test.js does. Covers onEvent()
// and checkDwellRules() ("alert-engine paths 1 and 2" per the T3 spec).
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/alert-engine');
const lineSender = require('../src/line-sender');
const notifier = require('../src/helpers/notifier');

function makePool(extra = {}) {
  const logInserts = [];
  return {
    logInserts,
    async query(sql, params) {
      if (sql.includes('INSERT INTO alert_logs')) { logInserts.push(params); return { rows: [] }; }
      if (sql.includes('UPDATE alert_rules SET last_triggered_at')) return { rows: [] };
      if (typeof extra.query === 'function') return extra.query(sql, params);
      throw new Error('unexpected sql in test pool: ' + sql.slice(0, 120));
    },
  };
}

function baseRule(over = {}) {
  return {
    id: 1, name: 'Test Rule', dwell_threshold_sec: 0,
    camera_ids: [], rule_names: [], list_types: null,
    recipient_ids: ['r1'], min_likelihood: null,
    active_from: null, active_to: null, cooldown_seconds: 0, last_triggered_at: null,
    message_template: 'hello {camera}', show_open_link: true,
    deliver_via: 'line_then_telegram', telegram_chat_ids: [],
    ...over,
  };
}

function baseEvent(over = {}) {
  return {
    event_id: 5, id: 5, camera_id: 'C1', camera_name: 'Cam1',
    rule_name: 'Motion', event_time: '2026-01-01T00:00:00Z',
    snapshot_filename: 'x.jpg',
    ...over,
  };
}

const CONFIG_LINE_READY = {
  enabled: true, channel_access_token: 'tok', imgbb_api_key: null,
  recipients: [{ id: 'r1', enabled: true, name: 'Somchai', type: 'user' }],
};

describe("alert-engine T3 — deliver_via='line_then_telegram' (onEvent)", () => {
  let origSendAlert, origSendTelegramLeg;
  beforeEach(() => {
    origSendAlert = lineSender.sendAlert;
    origSendTelegramLeg = notifier.sendTelegramLeg;
  });
  afterEach(() => {
    lineSender.sendAlert = origSendAlert;
    notifier.sendTelegramLeg = origSendTelegramLeg;
  });

  it('LINE ok → Telegram never touched', async () => {
    let tgCalled = false;
    notifier.sendTelegramLeg = async () => { tgCalled = true; return []; };
    lineSender.sendAlert = async () => ({
      success: true, sentCount: 1, totalRecipients: 1, error: null,
      messageText: 'hello Cam1', imageSource: 'signed',
      recipientsLog: [{ name: 'Somchai', type: 'user', id_tail: '0001', ok: true, error: null, line_request_id: 'req-1' }],
    });
    const pool = makePool();
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Police Backup', mirror_of_line_id: 'r1' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [baseRule()], telegram });
    await engine.onEvent(baseEvent());

    assert.equal(tgCalled, false, 'LINE succeeded — no fallback should fire');
    assert.equal(pool.logInserts.length, 1);
    assert.equal(pool.logInserts[0][6], 'success');
    assert.equal(pool.logInserts[0][8], 1);
  });

  it('LINE hits monthly limit + a mirror chat exists → Telegram gets the same card, merged into one alert_logs row', async () => {
    lineSender.sendAlert = async () => ({
      success: false, sentCount: 0, totalRecipients: 1, error: '[Somchai] You have reached your monthly limit.',
      messageText: 'hello Cam1', imageSource: 'signed',
      recipientsLog: [{ name: 'Somchai', type: 'user', id_tail: '0001', ok: false, error: 'You have reached your monthly limit.', line_request_id: null }],
    });
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => {
      tgArgs = args;
      return [{ name: 'Police Backup', type: 'group', id_tail: '0111', ok: true, error: null, channel: 'telegram', message_id: 9 }];
    };
    const pool = makePool();
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Police Backup', mirror_of_line_id: 'r1' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [baseRule()], telegram });
    await engine.onEvent(baseEvent());

    assert.ok(tgArgs, 'sendTelegramLeg must have been called for the fallback');
    assert.deepEqual(tgArgs.chats.map((c) => c.chat_id), ['-100111']);

    assert.equal(pool.logInserts.length, 1);
    const row = pool.logInserts[0];
    assert.equal(row[6], 'success', 'fallback success counts toward status=success');
    assert.equal(row[8], 1);          // totalSent — the Telegram fallback send
    const log = JSON.parse(row[12]);
    const fb = log.find((r) => r.channel === 'telegram');
    assert.ok(fb, 'combined recipients_json must include the Telegram leg');
    assert.equal(fb.fallback, true);
    assert.equal(fb.ok, true);
  });

  it('LINE hits monthly limit but no chat mirrors this recipient → no Telegram call, status stays failed', async () => {
    lineSender.sendAlert = async () => ({
      success: false, sentCount: 0, totalRecipients: 1, error: '[Somchai] You have reached your monthly limit.',
      messageText: 'hello Cam1', imageSource: 'signed',
      recipientsLog: [{ name: 'Somchai', type: 'user', id_tail: '0001', ok: false, error: 'You have reached your monthly limit.', line_request_id: null }],
    });
    let tgCalled = false;
    notifier.sendTelegramLeg = async () => { tgCalled = true; return []; };
    const pool = makePool();
    // chat exists but mirrors a DIFFERENT LINE recipient
    const telegram = { chats: [{ chat_id: '-1', enabled: true, mirror_of_line_id: 'someone_else' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [baseRule()], telegram });
    await engine.onEvent(baseEvent());

    assert.equal(tgCalled, false);
    assert.equal(pool.logInserts[0][6], 'failed');
  });

  it("deliver_via='line' with a monthly-limit error never triggers fallback (unchanged from T2)", async () => {
    lineSender.sendAlert = async () => ({
      success: false, sentCount: 0, totalRecipients: 1, error: '[Somchai] You have reached your monthly limit.',
      messageText: 'hello Cam1', imageSource: 'signed',
      recipientsLog: [{ name: 'Somchai', type: 'user', id_tail: '0001', ok: false, error: 'You have reached your monthly limit.', line_request_id: null }],
    });
    let tgCalled = false;
    notifier.sendTelegramLeg = async () => { tgCalled = true; return []; };
    const pool = makePool();
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'r1' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [baseRule({ deliver_via: 'line' })], telegram });
    await engine.onEvent(baseEvent());
    assert.equal(tgCalled, false, "deliver_via='line' must never touch Telegram, even on a limit error");
    assert.equal(pool.logInserts[0][6], 'failed');
  });

  it("_telegramLegFor: 'line_then_telegram' now carries usesFallback=true (usesTelegram stays false)", () => {
    const r = engine._telegramLegFor({ deliver_via: 'line_then_telegram' });
    assert.equal(r.usesLine, true);
    assert.equal(r.usesTelegram, false);
    assert.equal(r.usesFallback, true);
    assert.deepEqual(r.telegramChats, []);
  });

  describe('_sendTelegramFallback (pure-ish helper, DB-free)', () => {
    it('returns [] when usesFallback is false', async () => {
      const r = await engine._sendTelegramFallback(baseRule(), baseEvent(), false, { recipientsLog: [{ ok: false, error: 'monthly limit' }] }, [{ id: 'r1' }]);
      assert.deepEqual(r, []);
    });
    it('returns [] when there is no LINE result to inspect', async () => {
      const r = await engine._sendTelegramFallback(baseRule(), baseEvent(), true, null, [{ id: 'r1' }]);
      assert.deepEqual(r, []);
    });
  });
});

describe("alert-engine T3 — deliver_via='line_then_telegram' (checkDwellRules, path 2)", () => {
  let origSendAlert, origSendTelegramLeg;
  beforeEach(() => {
    origSendAlert = lineSender.sendAlert;
    origSendTelegramLeg = notifier.sendTelegramLeg;
  });
  afterEach(() => {
    lineSender.sendAlert = origSendAlert;
    notifier.sendTelegramLeg = origSendTelegramLeg;
  });

  function makeDwellPool(episodes) {
    const logInserts = [];
    return {
      logInserts,
      async query(sql, params) {
        if (sql.includes('WITH latest AS')) return { rows: episodes };
        if (sql.includes('INSERT INTO alert_logs')) { logInserts.push(params); return { rows: [] }; }
        if (sql.includes('UPDATE alert_rules SET last_triggered_at')) return { rows: [] };
        throw new Error('unexpected sql in dwell test pool: ' + sql.slice(0, 120));
      },
    };
  }
  const episode = { id: 9, camera_id: 'C2', rule_name: 'Zone', event_state: 'true',
    event_time: '2026-01-01T00:00:00Z', snapshot_filename: 'z.jpg',
    camera_name: 'Cam2', location: 'Gate', open_sec: 999 };

  it('LINE hits monthly limit on a dwell episode + a mirror chat exists → Telegram fallback fires', async () => {
    lineSender.sendAlert = async () => ({
      success: false, sentCount: 0, totalRecipients: 1, error: '[Somchai] You have reached your monthly limit.',
      messageText: 't', recipientsLog: [{ name: 'Somchai', ok: false, error: 'You have reached your monthly limit.' }],
    });
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => { tgArgs = args; return [{ ok: true, channel: 'telegram' }]; };
    const pool = makeDwellPool([episode]);
    const rule = baseRule({ dwell_threshold_sec: 60 });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, mirror_of_line_id: 'r1' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
    await engine.checkDwellRules();
    assert.ok(tgArgs, 'fallback must have fired');
    assert.deepEqual(tgArgs.chats.map((c) => c.chat_id), ['-100111']);
    assert.equal(pool.logInserts[0][6], 'success');
    const log = JSON.parse(pool.logInserts[0][12]);
    assert.ok(log.find((r) => r.fallback === true));
  });
});

describe("alert-engine T3 — refreshCache() must fetch telegram_config for 'line_then_telegram' rules too", () => {
  it("a rule set to 'line_then_telegram' (no 'telegram'/'both' rule) still queries telegram_config, so mirror chats are available", async () => {
    const tgCalls = [];
    const pool = {
      async query(sql, params) {
        if (sql.includes('FROM alert_rules') && sql.includes('WHERE enabled = true')) return { rows: [baseRule()] };
        if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [{ enabled: true, channel_access_token: 'tok', recipients: [] }] };
        if (sql.includes('FROM system_settings')) return { rows: [] };
        if (sql.startsWith('SELECT chats FROM telegram_config')) {
          tgCalls.push(1);
          return { rows: [{ chats: [{ chat_id: '-1', enabled: true, mirror_of_line_id: 'r1' }] }] };
        }
        throw new Error('unexpected sql: ' + sql.slice(0, 100));
      },
    };
    await engine._testInit({ pool, config: null, rules: [], telegram: { chats: [] } });
    await engine.invalidateCache();
    assert.equal(tgCalls.length, 1, "refreshCache must query telegram_config when a rule uses 'line_then_telegram'");
  });
});
