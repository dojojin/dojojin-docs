// ============================================================
// Vigil Platform — Tests: manual "notify-telegram" route validation
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Route-level validation for the three new manual-Telegram endpoints
// (POST /api/lpr/alerts/:id/notify-telegram, /api/face-matches/:id/notify-telegram,
// /api/lpr/gs-alarms/:id/notify + /notify-telegram) — unknown chat id, Telegram
// not connected, empty config, and gs-alarms RBAC. Senders are monkey-patched
// (module-level, via require.cache — same convention as telegram-t2b-alert-engine.test.js)
// so this never reaches a real DB or the Telegram/LINE API.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function makeApp() {
  const handlers = {};
  return { app: { post: (p, ...fns) => { handlers[p] = fns[fns.length - 1]; }, get: () => {} }, handlers };
}

describe('POST /api/lpr/alerts/:id/notify-telegram', () => {
  const routes = require('../src/routes/lpr-alerts');
  const lprLineAlert = require('../src/helpers/lprLineAlert');
  let origSend;
  beforeEach(() => { origSend = lprLineAlert.sendLprAlert; });
  afterEach(() => { lprLineAlert.sendLprAlert = origSend; });

  function eventRow(over = {}) {
    return { id: 5, camera_id: 3, plate_number: 'กก1234', region: 'ภูเก็ต', group_id: 'warrant', ...over };
  }

  it('404 when the event/plate is not found', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (sql.includes('FROM events e')) return { rows: [] };
      throw new Error('unexpected: ' + sql.slice(0, 80));
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/alerts/:id/notify-telegram']({ params: { id: '5' }, body: {}, user: {} }, res);
    assert.equal(res.statusCode, 404);
  });

  it('400 "ยังไม่ได้เชื่อมต่อ Telegram" when telegram_config is not enabled', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (sql.includes('FROM events e')) return { rows: [eventRow()] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: false, bot_token_enc: null }] };
      throw new Error('unexpected: ' + sql.slice(0, 80));
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/alerts/:id/notify-telegram']({ params: { id: '5' }, body: {}, user: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /ยังไม่ได้เชื่อมต่อ Telegram/);
  });

  it('400 when an explicit chat id is unknown/disabled', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (sql.includes('FROM events e')) return { rows: [eventRow()] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [{ chat_id: '-1', enabled: true }] }] };
      throw new Error('unexpected: ' + sql.slice(0, 80));
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/alerts/:id/notify-telegram']({ params: { id: '5' }, body: { telegram_chat_ids: ['-999'] }, user: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /แชทที่เลือกใช้ไม่ได้/);
  });

  it('400 when the pick is empty and no chat is configured for this site/group', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (sql.includes('FROM events e')) return { rows: [eventRow()] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.includes('FROM cameras c LEFT JOIN sites')) return { rows: [{ site_code: 'hkt' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [] }] };
      throw new Error('unexpected: ' + sql.slice(0, 80));
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/alerts/:id/notify-telegram']({ params: { id: '5' }, body: {}, user: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /ยังไม่ได้ตั้งค่าแชท Telegram/);
  });

  it('200 on a valid explicit pick — sender is called with manualChannel="telegram"', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (sql.includes('FROM events e')) return { rows: [eventRow()] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [{ chat_id: '-100111', enabled: true }] }] };
      throw new Error('unexpected: ' + sql.slice(0, 80));
    } };
    routes(app, pool);
    let sentArgs = null;
    lprLineAlert.sendLprAlert = async (args) => { sentArgs = args; return { status: 'sent_manual', n: 1 }; };
    const res = fakeRes();
    await handlers['/api/lpr/alerts/:id/notify-telegram'](
      { params: { id: '5' }, body: { telegram_chat_ids: ['-100111'] }, user: { username: 'somchai' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sentArgs.manualChannel, 'telegram');
    assert.deepEqual(sentArgs.telegramChatIds, ['-100111']);
    assert.equal(sentArgs.force, true);
  });
});

describe('POST /api/face-matches/:id/notify-telegram', () => {
  const routes = require('../src/routes/faces');
  const alertEngine = require('../src/alert-engine');
  let origSend;
  beforeEach(() => { origSend = alertEngine.sendTestForRule; });
  afterEach(() => { alertEngine.sendTestForRule = origSend; });

  it('400 "ยังไม่ได้เชื่อมต่อ Telegram" when not configured', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (/FROM events WHERE id/.test(sql)) return { rows: [] }; // auraFaceExtra() lookups — none found → hcp_face
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: [{ id: 1, channel: 'hcp_face', telegram_chat_ids: [] }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: false, bot_token_enc: null }] };
      return { rows: [] };
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/face-matches/:id/notify-telegram']({ params: { id: '9' }, body: {}, user: { username: 'a' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /ยังไม่ได้เชื่อมต่อ Telegram/);
  });

  it('400 when the channel has no default chats and none were picked', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (/FROM events WHERE id/.test(sql)) return { rows: [] };
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: [{ id: 1, channel: 'hcp_face', telegram_chat_ids: [] }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      return { rows: [] };
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/face-matches/:id/notify-telegram']({ params: { id: '9' }, body: {}, user: { username: 'a' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /ยังไม่ได้เลือกแชท Telegram/);
  });

  it('400 (not 200-with-nothing-sent) when the channel default chat id no longer exists/is disabled', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (/FROM events WHERE id/.test(sql)) return { rows: [] };
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: [{ id: 1, channel: 'hcp_face', telegram_chat_ids: ['-999'] }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [] }] }; // -999 was removed
      return { rows: [] };
    } };
    routes(app, pool);
    let engineCalled = false;
    alertEngine.sendTestForRule = async () => { engineCalled = true; return { sent: true }; };
    const res = fakeRes();
    await handlers['/api/face-matches/:id/notify-telegram']({ params: { id: '9' }, body: {}, user: { username: 'a' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(engineCalled, false, 'must not report success for a channel whose only configured chat is gone');
  });

  it('200 with an explicit valid pick — engine called with manualChannel="telegram"', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (/FROM events WHERE id/.test(sql)) return { rows: [] };
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: [{ id: 1, channel: 'hcp_face', telegram_chat_ids: ['-1'] }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [{ chat_id: '-1', enabled: true }] }] };
      return { rows: [] };
    } };
    routes(app, pool);
    let sentOpts = null;
    alertEngine.sendTestForRule = async (db, rule, id, extra, opts) => { sentOpts = opts; return { sent: true, recipients: 1, sent_count: 1 }; };
    const res = fakeRes();
    await handlers['/api/face-matches/:id/notify-telegram'](
      { params: { id: '9' }, body: { telegram_chat_ids: ['-1'] }, user: { username: 'somchai' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sentOpts.manualChannel, 'telegram');
    assert.deepEqual(sentOpts.telegramChatIds, ['-1']);
  });

  // เหตุจริง 2026-09-25: Telegram ปฏิเสธทุกแชท แต่ route ตอบ 200 หน้าจอขึ้น "ส่งแล้ว"
  it('502 (not 200) when the engine reports nothing was delivered', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (sql.includes('FROM alert_rules WHERE channel')) return { rows: [{ id: 1, channel: 'hcp_face', telegram_chat_ids: ['-1'] }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [{ chat_id: '-1', enabled: true }] }] };
      return { rows: [] };
    } };
    routes(app, pool);
    alertEngine.sendTestForRule = async () => ({ sent: false, recipients: 1, sent_count: 0, error: 'WEBPAGE_CURL_FAILED' });
    const res = fakeRes();
    await handlers['/api/face-matches/:id/notify-telegram'](
      { params: { id: '9' }, body: { telegram_chat_ids: ['-1'] }, user: { username: 'somchai' } }, res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /WEBPAGE_CURL_FAILED/);
  });
});

describe('POST /api/lpr/gs-alarms/:id/notify and /notify-telegram', () => {
  const routes = require('../src/routes/lpr-gs-alarms');
  const gsAlarmLine = require('../src/helpers/gsAlarmLine');
  let origSend;
  beforeEach(() => { origSend = gsAlarmLine.sendGsAlarm; });
  afterEach(() => { gsAlarmLine.sendGsAlarm = origSend; });

  function alarmRowSql(sql) { return sql.includes('FROM blacklist.gs_alarms a'); }

  it('/notify → 404 when RBAC excludes the row (site-restricted user, different site)', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => { if (alarmRowSql(sql)) return { rows: [] }; return { rows: [] }; } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/gs-alarms/:id/notify'](
      { params: { id: '1' }, body: {}, user: { allowedSites: new Set([99]) } }, res);
    assert.equal(res.statusCode, 404);
  });

  // The 404 above proves nothing about rbacClause itself if the pool answers
  // "no rows" to everything — it would pass even with the RBAC clause missing.
  // Assert on the actual SQL/args the route builds instead, mirroring the
  // rbacClause coverage test/lpr-gs-alarms.test.js already has for the GET routes.
  it('/notify — site-restricted user: the alarm lookup carries "st.id = ANY($n)" with the site set in args', async () => {
    const { app, handlers } = makeApp();
    const calls = [];
    const pool = { query: async (sql, args) => {
      calls.push({ sql, args });
      if (alarmRowSql(sql)) return { rows: [{ id: 1, plate: '1กข1234' }] };
      return { rows: [{ recipient_ids: ['r1'] }] };
    } };
    routes(app, pool);
    await handlers['/api/lpr/gs-alarms/:id/notify'](
      { params: { id: '1' }, body: {}, user: { allowedSites: new Set([7]) } }, fakeRes());
    const lookup = calls.find(c => alarmRowSql(c.sql));
    assert.match(lookup.sql, /st\.id = ANY\(\$2\)/);
    assert.deepEqual(lookup.args[1], [7]);
  });

  it('/notify — camera-restricted user: the alarm lookup carries "AND FALSE" (gs_alarms has no per-camera RBAC)', async () => {
    const { app, handlers } = makeApp();
    const calls = [];
    const pool = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [] }; } };
    routes(app, pool);
    await handlers['/api/lpr/gs-alarms/:id/notify'](
      { params: { id: '1' }, body: {}, user: { allowedSites: { cameras: new Set([1]) } } }, fakeRes());
    const lookup = calls.find(c => alarmRowSql(c.sql));
    assert.match(lookup.sql, /AND FALSE/);
  });

  it('/notify → 400 when no recipient was picked and the channel has none configured', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (alarmRowSql(sql)) return { rows: [{ id: 1, plate: '1กข1234' }] };
      if (sql.includes(`FROM alert_rules WHERE channel = 'gs_alarm'`) && sql.includes('recipient_ids')) return { rows: [{ recipient_ids: [] }] };
      return { rows: [] };
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/gs-alarms/:id/notify']({ params: { id: '1' }, body: {}, user: { allowedSites: null } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /ยังไม่ได้เลือกผู้รับ/);
  });

  it('/notify-telegram → 400 "ยังไม่ได้เชื่อมต่อ Telegram"', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (alarmRowSql(sql)) return { rows: [{ id: 1, plate: '1กข1234' }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: false, bot_token_enc: null }] };
      return { rows: [] };
    } };
    routes(app, pool);
    const res = fakeRes();
    await handlers['/api/lpr/gs-alarms/:id/notify-telegram']({ params: { id: '1' }, body: {}, user: { allowedSites: null } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /ยังไม่ได้เชื่อมต่อ Telegram/);
  });

  it('/notify-telegram → 400 (not 200-with-nothing-sent) when the channel default chat id no longer exists/is disabled', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (alarmRowSql(sql)) return { rows: [{ id: 1, plate: '1กข1234' }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.includes('telegram_chat_ids')) return { rows: [{ telegram_chat_ids: ['-999'] }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [] }] }; // -999 was removed
      return { rows: [] };
    } };
    routes(app, pool);
    let sendCalled = false;
    gsAlarmLine.sendGsAlarm = async () => { sendCalled = true; return { status: 'sent_manual' }; };
    const res = fakeRes();
    await handlers['/api/lpr/gs-alarms/:id/notify-telegram']({ params: { id: '1' }, body: {}, user: { allowedSites: null } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(sendCalled, false);
  });

  it('/notify-telegram → 200 with an explicit pick, sender called with manualChannel="telegram"', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (alarmRowSql(sql)) return { rows: [{ id: 1, plate: '1กข1234' }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [{ chat_id: '-7', enabled: true }] }] };
      return { rows: [] };
    } };
    routes(app, pool);
    let sentArgs = null;
    gsAlarmLine.sendGsAlarm = async (args) => { sentArgs = args; return { status: 'sent_manual' }; };
    const res = fakeRes();
    await handlers['/api/lpr/gs-alarms/:id/notify-telegram'](
      { params: { id: '1' }, body: { telegram_chat_ids: ['-7'] }, user: { allowedSites: null, username: 'somchai' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sentArgs.manualChannel, 'telegram');
    assert.deepEqual(sentArgs.telegramChatIds, ['-7']);
  });

  it('/notify-telegram → 502 when sendGsAlarm reports failed', async () => {
    const { app, handlers } = makeApp();
    const pool = { query: async (sql) => {
      if (alarmRowSql(sql)) return { rows: [{ id: 1, plate: '1กข1234' }] };
      if (sql.startsWith('SELECT enabled, bot_token_enc FROM telegram_config')) return { rows: [{ enabled: true, bot_token_enc: 'x' }] };
      if (sql.startsWith('SELECT chats FROM telegram_config')) return { rows: [{ chats: [{ chat_id: '-7', enabled: true }] }] };
      return { rows: [] };
    } };
    routes(app, pool);
    gsAlarmLine.sendGsAlarm = async () => ({ status: 'failed', n: 0 });
    const res = fakeRes();
    await handlers['/api/lpr/gs-alarms/:id/notify-telegram'](
      { params: { id: '1' }, body: { telegram_chat_ids: ['-7'] }, user: { allowedSites: null, username: 'somchai' } }, res);
    assert.equal(res.statusCode, 502);
  });
});
