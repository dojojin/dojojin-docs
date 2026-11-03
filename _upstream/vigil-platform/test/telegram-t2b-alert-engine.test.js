// ============================================================
// Vigil Platform — Tests: alert-engine.js onEvent()/checkDwellRules() deliver_via (T2b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Stubs only — never calls the real LINE/Telegram API. Monkey-patches the
// exported functions of line-sender.js/helpers/notifier.js (both modules are
// required once and cached; alert-engine.js calls them as `lineSender.X(...)` /
// `notifier.X(...)`, a property lookup at call time, so overwriting the export
// here is visible to alert-engine.js without touching its source).
//
// Principle under test (CLAUDE.md-mandated): deliver_via='line' (the default
// for every rule created before T2b) must behave byte-identical to the
// pre-T2b engine — same lineSender.sendAlert call, same alert_logs row shape,
// Telegram never touched.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/alert-engine');
const lineSender = require('../src/line-sender');
const notifier = require('../src/helpers/notifier');

function makePool(extra = {}) {
  const logInserts = [];
  const triggerUpdates = [];
  return {
    logInserts, triggerUpdates,
    async query(sql, params) {
      if (sql.includes('INSERT INTO alert_logs')) { logInserts.push(params); return { rows: [] }; }
      if (sql.includes('UPDATE alert_rules SET last_triggered_at')) { triggerUpdates.push(params); return { rows: [] }; }
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
    deliver_via: 'line', telegram_chat_ids: [],
    ...over,
  };
}

function baseEvent(over = {}) {
  return {
    event_id: 5, id: 5, camera_id: 'C1', camera_name: 'Cam1',
    rule_name: 'Motion', event_time: '2026-01-01T00:00:00Z',
    // set so the Bosch-snapshot wait loop never triggers
    snapshot_filename: 'x.jpg',
    ...over,
  };
}

const CONFIG_LINE_READY = {
  enabled: true, channel_access_token: 'tok', imgbb_api_key: null,
  recipients: [{ id: 'r1', enabled: true, name: 'Somchai', type: 'user' }],
};

describe('alert-engine T2b — deliver_via dispatch (onEvent)', () => {
  let origSendAlert, origSendTelegramLeg;
  beforeEach(() => {
    origSendAlert = lineSender.sendAlert;
    origSendTelegramLeg = notifier.sendTelegramLeg;
  });
  afterEach(() => {
    lineSender.sendAlert = origSendAlert;
    notifier.sendTelegramLeg = origSendTelegramLeg;
  });

  it("deliver_via='line' (default) never touches Telegram and alert_logs row matches the pre-T2b shape exactly", async () => {
    let tgCalled = false;
    notifier.sendTelegramLeg = async () => { tgCalled = true; return []; };
    const sendAlertResult = {
      success: true, sentCount: 1, totalRecipients: 1, error: null,
      messageText: 'hello Cam1', imageSource: 'signed',
      recipientsLog: [{ name: 'Somchai', type: 'user', id_tail: '0001', ok: true, error: null, line_request_id: 'req-1' }],
    };
    let sendAlertArgs = null;
    lineSender.sendAlert = async (args) => { sendAlertArgs = args; return sendAlertResult; };

    const pool = makePool();
    const rule = baseRule();   // deliver_via omitted from override → 'line'
    const event = baseEvent();
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram: { chats: [] } });
    await engine.onEvent(event);

    assert.equal(tgCalled, false, 'telegram must never be called for deliver_via=line');
    assert.ok(sendAlertArgs, 'lineSender.sendAlert must have been called');
    assert.equal(sendAlertArgs.recipients.length, 1);
    assert.equal(sendAlertArgs.token, 'tok');

    assert.equal(pool.logInserts.length, 1);
    const p = pool.logInserts[0];
    // [rule.id, rule.name, event.event_id, event.camera_id, event.rule_name,
    //  event.event_time, status, messageText, recipientCount, errorMsg, durationMs,
    //  imageSource, recipientsJson] — exact pre-T2b shape (logAttempt signature unchanged)
    assert.equal(p[0], rule.id);
    assert.equal(p[1], rule.name);
    assert.equal(p[2], event.event_id);
    assert.equal(p[3], event.camera_id);
    assert.equal(p[4], event.rule_name);
    assert.equal(p[5], event.event_time);
    assert.equal(p[6], 'success');
    assert.equal(p[7], 'hello Cam1');
    assert.equal(p[8], 1);            // recipientCount
    assert.equal(p[9], null);         // errorMsg
    assert.equal(typeof p[10], 'number');
    assert.equal(p[11], 'signed');
    assert.deepEqual(JSON.parse(p[12]), sendAlertResult.recipientsLog);
    assert.equal(pool.triggerUpdates.length, 1);
  });

  it("deliver_via='line': partial LINE failure still reports status='failed' (pre-T2b semantics: ALL recipients must succeed)", async () => {
    notifier.sendTelegramLeg = async () => { throw new Error('must not be called'); };
    lineSender.sendAlert = async () => ({
      success: false, sentCount: 1, totalRecipients: 2, error: '[bob] boom',
      messageText: 'hello Cam1', imageSource: 'signed', recipientsLog: [],
    });
    const pool = makePool();
    const rule = baseRule({ recipient_ids: ['r1', 'r2'] });
    const config = { ...CONFIG_LINE_READY, recipients: [
      { id: 'r1', enabled: true, name: 'A', type: 'user' },
      { id: 'r2', enabled: true, name: 'B', type: 'user' },
    ] };
    await engine._testInit({ pool, config, rules: [rule], telegram: { chats: [] } });
    await engine.onEvent(baseEvent());
    assert.equal(pool.logInserts[0][6], 'failed');
    assert.equal(pool.logInserts[0][9], '[bob] boom');
  });

  it("deliver_via='telegram': LINE is never called, and chats existing means no 'no_recipients'", async () => {
    let lineCalled = false;
    lineSender.sendAlert = async () => { lineCalled = true; return { success: true, sentCount: 1 }; };
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => {
      tgArgs = args;
      return [{ name: 'Ops Group', type: 'group', id_tail: '0111', ok: true, error: null, channel: 'telegram', message_id: 42 }];
    };
    const pool = makePool();
    const rule = baseRule({ deliver_via: 'telegram', telegram_chat_ids: ['-100111'] });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Ops Group', type: 'group' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
    await engine.onEvent(baseEvent());

    assert.equal(lineCalled, false);
    assert.ok(tgArgs, 'sendTelegramLeg must have been called');
    assert.equal(tgArgs.chats.length, 1);
    assert.equal(tgArgs.chats[0].chat_id, '-100111');

    assert.equal(pool.logInserts.length, 1);
    const p = pool.logInserts[0];
    assert.notEqual(p[6], 'no_recipients');
    assert.equal(p[6], 'success');
    assert.equal(p[8], 1);   // recipientCount = telegram leg only
    const recips = JSON.parse(p[12]);
    assert.equal(recips.length, 1);
    assert.equal(recips[0].channel, 'telegram');
  });

  it("deliver_via='telegram' with no matching chat still logs 'no_recipients' (not silently dropped)", async () => {
    lineSender.sendAlert = async () => { throw new Error('must not be called'); };
    notifier.sendTelegramLeg = async () => { throw new Error('must not be called — no chats selected'); };
    const pool = makePool();
    const rule = baseRule({ deliver_via: 'telegram', telegram_chat_ids: ['-100999'] });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Other Group' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
    await engine.onEvent(baseEvent());
    assert.equal(pool.logInserts[0][6], 'no_recipients');
  });

  it("deliver_via='both': both channels fire and recipients_json merges LINE + Telegram entries", async () => {
    lineSender.sendAlert = async () => ({
      success: true, sentCount: 1, totalRecipients: 1, error: null,
      messageText: 'hello Cam1', imageSource: 'signed',
      recipientsLog: [{ name: 'Somchai', type: 'user', id_tail: '0001', ok: true, error: null, line_request_id: 'r1' }],
    });
    notifier.sendTelegramLeg = async () => ([
      { name: 'Ops Group', type: 'group', id_tail: '0111', ok: true, error: null, channel: 'telegram', message_id: 7 },
    ]);
    const pool = makePool();
    const rule = baseRule({ deliver_via: 'both', telegram_chat_ids: ['-100111'] });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Ops Group' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
    await engine.onEvent(baseEvent());

    const p = pool.logInserts[0];
    assert.equal(p[6], 'success');
    assert.equal(p[8], 2);   // 1 LINE + 1 Telegram
    const recips = JSON.parse(p[12]);
    assert.equal(recips.length, 2);
    assert.ok(recips.some((r) => r.channel === 'telegram'));
    assert.ok(recips.some((r) => r.line_request_id === 'r1'));
  });

  it("deliver_via='telegram' still works when LINE is globally disabled (recipients_json shows telegram-only)", async () => {
    lineSender.sendAlert = async () => { throw new Error('must not be called — usesLine is false'); };
    notifier.sendTelegramLeg = async () => ([
      { name: 'Ops Group', type: 'group', id_tail: '0111', ok: true, error: null, channel: 'telegram', message_id: 1 },
    ]);
    const pool = makePool();
    const rule = baseRule({ deliver_via: 'telegram', telegram_chat_ids: ['-100111'] });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Ops Group' }] };
    // LINE off entirely — pre-T2b onEvent would have returned before doing anything
    const configLineOff = { enabled: false, channel_access_token: null, recipients: [] };
    await engine._testInit({ pool, config: configLineOff, rules: [rule], telegram });
    await engine.onEvent(baseEvent());
    assert.equal(pool.logInserts.length, 1);
    assert.equal(pool.logInserts[0][6], 'success');
  });

  it("LINE off + a Telegram rule present: the 'line'-only rule stays completely silent (no alert_logs row at all) — matches pre-T2b behaviour exactly", async () => {
    lineSender.sendAlert = async () => { throw new Error('must not be called'); };
    notifier.sendTelegramLeg = async () => ([{ ok: true, channel: 'telegram' }]);
    const pool = makePool();
    const lineOnlyRule = baseRule({ id: 1, rule_names: ['Motion'] });   // deliver_via default 'line'
    const telegramRule = baseRule({ id: 2, rule_names: ['Motion'], deliver_via: 'telegram', telegram_chat_ids: ['-100111'] });
    const configLineOff = { enabled: false, channel_access_token: null, recipients: [] };
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'G' }] };
    await engine._testInit({ pool, config: configLineOff, rules: [lineOnlyRule, telegramRule], telegram });
    await engine.onEvent(baseEvent({ rule_name: 'Motion' }));

    // exactly one row — for rule id 2 (telegram), never for rule id 1 (line-only)
    assert.equal(pool.logInserts.length, 1);
    assert.equal(pool.logInserts[0][0], 2);
  });

  it("send_snapshot=false: Telegram card carries no images (PDPA) and skips the face-ref lookup entirely", async () => {
    lineSender.sendAlert = async () => { throw new Error('must not be called'); };
    let faceRefCalled = false;
    const origFaceRefInfo = lineSender._faceRefInfo;
    lineSender._faceRefInfo = async () => { faceRefCalled = true; return { ref_path: 'x', refKind: 'ref' }; };
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => { tgArgs = args; return [{ ok: true, channel: 'telegram' }]; };
    const pool = makePool();
    const rule = baseRule({
      rule_names: ['Face Recognition Match'], send_snapshot: false, message_template: null,
      deliver_via: 'telegram', telegram_chat_ids: ['-100111'],
    });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'G' }] };
    const event = baseEvent({
      rule_name: 'Face Recognition Match',
      _faceEnriched: true, person_name: 'สมชาย ใจดี', watchlist: 'TCC',
    });
    try {
      await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
      await engine.onEvent(event);
    } finally {
      lineSender._faceRefInfo = origFaceRefInfo;
    }
    assert.equal(faceRefCalled, false, '_faceRefInfo must not run when snapshots are off');
    assert.ok(tgArgs);
    assert.deepEqual(tgArgs.images, { plate: null, scene: null, ref: null });
  });

  it('face-match rule (HCP Face style, no custom template): Telegram card is built from _faceSections, not plain text', async () => {
    lineSender.sendAlert = async () => { throw new Error('must not be called'); };
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => { tgArgs = args; return [{ ok: true, channel: 'telegram' }]; };

    const pool = makePool();
    const rule = baseRule({
      id: 14, name: 'HCP Face', channel: 'hcp_face', rule_names: ['Face Recognition Match'],
      message_template: null,   // HCP Face/AuraFace rows always store NULL — see alert-channels.js
      deliver_via: 'telegram', telegram_chat_ids: ['-100111'],
    });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'Security' }] };
    const event = baseEvent({
      rule_name: 'Face Recognition Match',
      // pre-populated + _faceEnriched:true so enrichFaceFields() skips its own
      // DB query — this test is about the card, not about enrichment
      _faceEnriched: true, person_name: 'สมชาย ใจดี', watchlist: 'TCC Blacklist',
    });
    const origFaceRefInfo = lineSender._faceRefInfo;
    lineSender._faceRefInfo = async () => ({
      ref_path: 'roster/abc.jpg', refKind: 'ref', scene: 'edge/scene123.jpg',
    });
    try {
      await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
      await engine.onEvent(event);
    } finally {
      lineSender._faceRefInfo = origFaceRefInfo;
    }

    assert.ok(tgArgs, 'sendTelegramLeg must have been called');
    // fromSections() renders title (group) + plate-slot (person) as bold headline lines
    assert.match(tgArgs.card.caption, /TCC Blacklist/);
    assert.match(tgArgs.card.caption, /สมชาย ใจดี/);
    // camera line comes from _faceSections' "seen" block
    assert.match(tgArgs.card.caption, /Cam1/);
    // images: face crop = event snapshot, ref = raw path + kind (not a resolved URL)
    assert.equal(tgArgs.images.plate, 'x.jpg');
    assert.equal(tgArgs.images.scene, 'edge/scene123.jpg');
    assert.deepEqual(tgArgs.images.ref, { path: 'roster/abc.jpg', kind: 'ref' });
  });

  it('non-face rule Telegram card: caption is formatMessage(rule.message_template) + event snapshot', async () => {
    lineSender.sendAlert = async () => ({ success: true, sentCount: 0, recipientsLog: [] });
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => { tgArgs = args; return [{ ok: true, channel: 'telegram' }]; };
    const pool = makePool();
    const rule = baseRule({ deliver_via: 'both', telegram_chat_ids: ['-1'], message_template: 'Alert: {camera} / {rule}' });
    const telegram = { chats: [{ chat_id: '-1', enabled: true, name: 'G' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
    await engine.onEvent(baseEvent());
    assert.ok(tgArgs);
    assert.match(tgArgs.card.caption, /Alert: Cam1 \/ Motion/);
    assert.equal(tgArgs.images.scene, 'x.jpg');
    assert.equal(tgArgs.images.plate, null);
  });
});

describe('alert-engine T2b — checkDwellRules() (path 2)', () => {
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
    const triggerUpdates = [];
    return {
      logInserts, triggerUpdates,
      async query(sql, params) {
        if (sql.includes('WITH latest AS')) return { rows: episodes };
        if (sql.includes('INSERT INTO alert_logs')) { logInserts.push(params); return { rows: [] }; }
        if (sql.includes('UPDATE alert_rules SET last_triggered_at')) { triggerUpdates.push(params); return { rows: [] }; }
        throw new Error('unexpected sql in dwell test pool: ' + sql.slice(0, 120));
      },
    };
  }
  const episode = { id: 9, camera_id: 'C2', rule_name: 'Zone', event_state: 'true',
    event_time: '2026-01-01T00:00:00Z', snapshot_filename: 'z.jpg',
    camera_name: 'Cam2', location: 'Gate', open_sec: 999 };

  it("deliver_via='line': Telegram never called (dwell path unaffected)", async () => {
    let tgCalled = false;
    notifier.sendTelegramLeg = async () => { tgCalled = true; return []; };
    lineSender.sendAlert = async () => ({ success: true, sentCount: 1, messageText: 't', recipientsLog: [] });
    const pool = makeDwellPool([episode]);
    const rule = baseRule({ dwell_threshold_sec: 60 });
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram: { chats: [] } });
    await engine.checkDwellRules();
    assert.equal(tgCalled, false);
    assert.equal(pool.logInserts.length, 1);
    assert.equal(pool.logInserts[0][6], 'success');
  });

  it("deliver_via='telegram': fires the Telegram leg for a dwell episode", async () => {
    lineSender.sendAlert = async () => { throw new Error('must not be called'); };
    let tgArgs = null;
    notifier.sendTelegramLeg = async (args) => { tgArgs = args; return [{ ok: true, channel: 'telegram' }]; };
    const pool = makeDwellPool([episode]);
    const rule = baseRule({ dwell_threshold_sec: 60, deliver_via: 'telegram', telegram_chat_ids: ['-100111'] });
    const telegram = { chats: [{ chat_id: '-100111', enabled: true, name: 'G' }] };
    await engine._testInit({ pool, config: CONFIG_LINE_READY, rules: [rule], telegram });
    await engine.checkDwellRules();
    assert.ok(tgArgs);
    assert.equal(pool.logInserts[0][6], 'success');
    assert.match(tgArgs.card.caption, /Cam2/);
  });
});

describe('alert-engine T2b — refreshCache() / telegram_config decoupling', () => {
  function makeRefreshPool({ rules, tgFails = false, tgRows = [{ chats: [{ chat_id: '-1', enabled: true }] }] }) {
    const tgCalls = [];
    const logInserts = [];
    return {
      tgCalls, logInserts,
      async query(sql, params) {
        if (sql.includes('FROM alert_rules') && sql.includes('WHERE enabled = true')) return { rows: rules };
        if (sql.includes('FROM line_config WHERE id = 1')) return { rows: [{ enabled: true, channel_access_token: 'tok', recipients: [] }] };
        if (sql.includes('FROM system_settings')) return { rows: [] };
        if (sql.startsWith('SELECT chats FROM telegram_config')) {
          tgCalls.push(1);
          if (tgFails) throw new Error('telegram_config not migrated yet');
          return { rows: tgRows };
        }
        if (sql.includes('INSERT INTO alert_logs')) { logInserts.push(params); return { rows: [] }; }
        if (sql.includes('UPDATE alert_rules SET last_triggered_at')) return { rows: [] };
        throw new Error('unexpected sql in refresh test pool: ' + sql.slice(0, 100));
      },
    };
  }

  it("installs where every rule is 'line': refreshCache() never queries telegram_config (spec: no new query on the default path)", async () => {
    const pool = makeRefreshPool({ rules: [baseRule()] });
    await engine._testInit({ pool, config: null, rules: [], telegram: { chats: [] } });
    await engine.invalidateCache();
    assert.equal(pool.tgCalls.length, 0);
  });

  it('telegram_config query failing (e.g. not migrated yet) does not stop alert_rules/line_config from loading, and the previous chats keep working', async () => {
    const rules = [baseRule({ deliver_via: 'telegram', telegram_chat_ids: ['stale'] })];
    const pool = makeRefreshPool({ rules, tgFails: true });
    // seed a "previous" telegramCache — this is what must survive the failed query
    await engine._testInit({ pool, config: null, rules: [], telegram: { chats: [{ chat_id: 'stale', enabled: true }] } });
    await engine.invalidateCache();
    assert.equal(pool.tgCalls.length, 1, 'telegram_config was attempted (a rule needs it)');

    // rulesCache/configCache from the SAME refresh loaded fine despite the telegram
    // query throwing afterwards — proved by onEvent finding the rule and sending
    lineSender.sendAlert = async () => { throw new Error('must not be called — deliver_via=telegram'); };
    notifier.sendTelegramLeg = async (args) => {
      assert.deepEqual(args.chats, [{ chat_id: 'stale', enabled: true }], 'kept the pre-failure chats, not wiped to []');
      return [{ ok: true, channel: 'telegram' }];
    };
    await engine.onEvent(baseEvent({ rule_name: 'Motion' }));
    assert.equal(pool.logInserts.length, 1);
    assert.equal(pool.logInserts[0][6], 'success');
  });
});

describe('alert-engine T2b — pure helpers', () => {
  const { _telegramLegFor, _suppressedLog } = engine;

  it('_telegramLegFor: default (no deliver_via) behaves as line-only', () => {
    const r = _telegramLegFor({});
    assert.equal(r.deliverVia, 'line');
    assert.equal(r.usesLine, true);
    assert.equal(r.usesTelegram, false);
    assert.deepEqual(r.telegramChats, []);
  });

  it("_telegramLegFor: 'line_then_telegram' still behaves as line-only until T3", () => {
    const r = _telegramLegFor({ deliver_via: 'line_then_telegram' });
    assert.equal(r.usesLine, true);
    assert.equal(r.usesTelegram, false);
  });

  it('_suppressedLog merges LINE recipients + telegram chats with ok:null', () => {
    const log = _suppressedLog(
      [{ id: 'r1', name: 'A', type: 'user' }],
      [{ chat_id: '-100111', name: 'G', type: 'group' }],
    );
    assert.equal(log.length, 2);
    assert.equal(log[0].ok, null);
    assert.equal(log[1].channel, 'telegram');
    assert.equal(log[1].ok, null);
  });
});
