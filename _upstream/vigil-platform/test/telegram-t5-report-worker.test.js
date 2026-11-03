// ============================================================
// Vigil Platform — Tests: report-worker.js LINE + Telegram delivery (T5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// report-worker.js สร้าง pg Pool จริง + เปิด HTTP server + setInterval เป็น side
// effect ตอน require — ไม่ปลอดภัยที่จะ require ตรงๆ ในเทสต์ จึงปลอม pg.Pool +
// http.createServer ก่อน require ครั้งเดียว (คืนค่าจริงกลับทันทีหลัง require เสร็จ
// เพราะทั้งคู่ถูกใช้แบบ synchronous ตอน require เท่านั้น) แล้วดึง runScheduledReport
// ออกมาจาก module.exports ที่ต่อท้ายไฟล์ไว้ให้เทสต์นี้โดยเฉพาะ
//
// ครอบคลุมเฉพาะ 4 เคสที่ T5 spec ระบุไว้ตรงๆ โดยใช้ family='analytics' สำหรับ
// เคสทั่วไป (ไม่มี Telegram / มีทั้งคู่ / Telegram อย่างเดียว) และ family='lpr'
// สำหรับเคส switch ปิด — ไม่ได้ไล่ทุก family × ทุก combination (ดูรายงานท้ายงาน)
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');

process.env.INTERNAL_API_SECRET = 'x'.repeat(40);
process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');

// ── ปลอม pg.Pool + http.createServer เฉพาะช่วง require (ทั้งคู่ถูกเรียกตอน require
// แบบ synchronous — new Pool() ที่บรรทัดบนๆ ของไฟล์ และ http.createServer(...).listen()
// ที่ท้ายไฟล์) ─────────────────────────────────────────────────────────────
// pg อยู่ใต้ src/node_modules (ไม่ใช่ root node_modules) — ต้อง require ผ่าน path
// เดียวกับที่ src/report-worker.js เห็น ไม่งั้นได้โมดูลคนละตัว (คนละ cache entry)
// แล้วปลอม Pool ของอันที่ report-worker.js ไม่ได้ใช้
const pg = require('../src/node_modules/pg');
const _origPgPool = pg.Pool;
let _queryImpl = async (sql) => { throw new Error('unstubbed pool.query in test: ' + sql); };
class FakePool {
  query(sql, params) { return _queryImpl(sql, params); }
  on() {}
}
pg.Pool = FakePool;

const _origCreateServer = http.createServer;
http.createServer = () => ({ listen() {} });

// report-worker.js เรียก setInterval(checkReportSchedules, 60_000) ตอน require —
// ตัวจับเวลาเดินจริงจะกันโปรเซสเทสต์ไม่ให้จบ (event loop มีชีวิตอยู่ตลอด) ปลอมทิ้ง
// เฉพาะช่วง require เดียวกับ pg.Pool/http.createServer ข้างบน
const _origSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });

let workerMod;
try {
  workerMod = require('../src/report-worker');
} finally {
  pg.Pool = _origPgPool;
  http.createServer = _origCreateServer;
  global.setInterval = _origSetInterval;
}
const { runScheduledReport } = workerMod;
assert.equal(typeof runScheduledReport, 'function', 'report-worker.js must export runScheduledReport for this test');

const reportRenderer = require('../src/report-renderer');
const lineSender = require('../src/line-sender');
const telegramSender = require('../src/helpers/telegramSender');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const { invalidateSystemSetting } = require('../src/helpers/getSystemSetting');

// fs.promises.writeFile ของจริงเขียนไฟล์ PNG ลง reports/ — ปลอมทิ้งทั้งไฟล์นี้ กัน
// เทสต์สร้างขยะบนดิสก์จริง (advisor note: never touch disk from a report-worker test)
const _origWriteFile = fs.promises.writeFile;
before(() => { fs.promises.writeFile = async () => {}; });
after(() => { fs.promises.writeFile = _origWriteFile; });

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ── DB router ────────────────────────────────────────────────────────────
function makeState(overrides = {}) {
  return {
    lineConfig: null, telegramConfig: null, systemSettings: {},
    recordCalls: [], historyCalls: [], telegramConfigQueried: false,
    ...overrides,
  };
}
function installRouter(state) {
  _queryImpl = async (sql, params) => {
    if (sql.includes("key LIKE 'brand_%'")) return { rows: [] };
    if (sql.includes("key='display_timezone'")) return { rows: [] };
    if (sql.includes('FROM line_config WHERE id = 1')) return { rows: state.lineConfig ? [state.lineConfig] : [] };
    if (sql.includes('FROM telegram_config WHERE id = 1')) {
      state.telegramConfigQueried = true;
      return { rows: state.telegramConfig ? [state.telegramConfig] : [] };
    }
    if (sql.includes('SELECT value FROM system_settings WHERE key = $1')) {
      const key = params[0];
      const v = Object.prototype.hasOwnProperty.call(state.systemSettings, key) ? state.systemSettings[key] : null;
      return { rows: v == null ? [] : [{ value: v }] };
    }
    if (sql.includes('UPDATE report_schedules SET last_run_at')) {
      state.recordCalls.push(params);
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO report_history')) {
      state.historyCalls.push(params);
      state.historySql = (state.historySql || []).concat(sql);
      return { rows: [] };
    }
    throw new Error('unexpected sql in test: ' + sql);
  };
}

function stubRenderer({ withAnalytics = false, withLpr = false } = {}) {
  const calls = { renderReportImage: [], renderLprReportImage: [] };
  const orig = {
    computeScheduledRange: reportRenderer.computeScheduledRange,
    renderReportImage: reportRenderer.renderReportImage,
    renderLprReportImage: reportRenderer.renderLprReportImage,
  };
  reportRenderer.computeScheduledRange = () => ({ from: '2026-09-24T00:00:00.000Z', to: '2026-09-25T00:00:00.000Z', label: 'เมื่อวาน' });
  if (withAnalytics) {
    reportRenderer.renderReportImage = async (args) => { calls.renderReportImage.push(args); return Buffer.from('fake-analytics-png'); };
  }
  if (withLpr) {
    reportRenderer.renderLprReportImage = async (args) => { calls.renderLprReportImage.push(args); return Buffer.from('fake-lpr-png'); };
  }
  return { calls, restore: () => Object.assign(reportRenderer, orig) };
}

function stubLine(impl) {
  const calls = [];
  const orig = lineSender.sendReportToLine;
  lineSender.sendReportToLine = async (args) => { calls.push(args); return impl ? impl(args) : { success: true, sentCount: 1, totalRecipients: 1, imageSource: 'signed' }; };
  return { calls, restore: () => { lineSender.sendReportToLine = orig; } };
}

function stubTelegram(impl) {
  const calls = [];
  const orig = telegramSender.sendReportToTelegram;
  telegramSender.sendReportToTelegram = async (args) => {
    calls.push(args);
    return impl ? impl(args) : { sentCount: args.chatIds.length, results: args.chatIds.map((id) => ({ chat_id: id, ok: true, error: null })) };
  };
  return { calls, restore: () => { telegramSender.sendReportToTelegram = orig; } };
}

const baseSchedule = (over = {}) => ({
  id: 42, report_type: 'daily', report_family: 'analytics', recipients: 'U1',
  section_config: null, site_id: null, image_layout: 'compact', telegram_chat_ids: [],
  ...over,
});

describe('report-worker T5 — no telegram chats', () => {
  it('Telegram is never touched, LINE gets the same args as before T5', async () => {
    for (const k of ['line_default_recipient', 'imgbb_fallback_enabled', 'signed_image_expire_hours']) invalidateSystemSetting(k);
    const state = makeState({
      lineConfig: {
        enabled: true, channel_access_token: 'line-token', imgbb_api_key: 'imgbb-key',
        recipients: [{ id: 'U1', name: 'ทดสอบ', enabled: true }],
      },
      systemSettings: { imgbb_fallback_enabled: 'false' },
    });
    installRouter(state);
    const ren = stubRenderer({ withAnalytics: true });
    const line = stubLine();
    const tg = stubTelegram();
    try {
      await runScheduledReport(baseSchedule({ telegram_chat_ids: [] }));
    } finally { ren.restore(); line.restore(); tg.restore(); }

    assert.equal(tg.calls.length, 0, 'telegramSender.sendReportToTelegram must never be called');
    assert.equal(state.telegramConfigQueried, false, 'telegram_config must never be queried');

    assert.equal(line.calls.length, 1);
    const args = line.calls[0];
    // ปักหมุดชื่อ key ทั้งหมด — กันของใหม่หลุดเข้ามาเงียบๆ โดยเทสต์ค่าที่เช็คแยก
    // รายฟิลด์ข้างล่างยังผ่านอยู่ (เช่น พารามิเตอร์ใหม่ที่ไม่มีใครอ่านค่า)
    assert.deepEqual(Object.keys(args).sort(),
      ['allowImgbb', 'caption', 'imgbbKey', 'pngBuffer', 'recipients', 'reportFile', 'signedTtlSec', 'token'].sort());
    assert.equal(args.token, 'line-token');
    assert.equal(args.imgbbKey, 'imgbb-key');
    assert.deepEqual(args.recipients, ['U1']);
    assert.equal(args.pngBuffer.toString(), 'fake-analytics-png');
    assert.equal(args.caption, '📊 รายงานประจำวัน\nเมื่อวาน');
    assert.match(args.reportFile, /^report_analytics_.*\.png$/);
    assert.equal(args.allowImgbb, false);
    assert.equal(typeof args.signedTtlSec, 'number');

    assert.equal(state.recordCalls.length, 1);
    assert.equal(state.recordCalls[0][1], 'success');
    assert.equal(state.historyCalls.length, 1);
    // audit T5: ไม่มี Telegram = INSERT รูปเดิม 13 คอลัมน์ ไม่อ้าง telegram_* เลย
    // (กันประวัติรายงานทุกตารางหายเงียบถ้า report-worker บูตก่อน migration 243)
    assert.ok(!/telegram_/.test(state.historySql[0]), 'no telegram_* columns when no Telegram leg');
    assert.equal(state.historyCalls[0].length, 13);
  });
});

describe('report-worker T5 — telegram chats + LINE', () => {
  it('sends to both channels', async () => {
    for (const k of ['line_default_recipient', 'imgbb_fallback_enabled', 'signed_image_expire_hours']) invalidateSystemSetting(k);
    const state = makeState({
      lineConfig: {
        enabled: true, channel_access_token: 'line-token', imgbb_api_key: 'imgbb-key',
        recipients: [{ id: 'U1', name: 'ทดสอบ', enabled: true }],
      },
      telegramConfig: { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN), chats: [{ chat_id: '111', enabled: true }] },
      systemSettings: { imgbb_fallback_enabled: 'false' },
    });
    installRouter(state);
    const ren = stubRenderer({ withAnalytics: true });
    const line = stubLine();
    const tg = stubTelegram();
    try {
      await runScheduledReport(baseSchedule({ telegram_chat_ids: ['111'] }));
    } finally { ren.restore(); line.restore(); tg.restore(); }

    assert.equal(line.calls.length, 1);
    assert.equal(tg.calls.length, 1);
    assert.deepEqual(tg.calls[0].chatIds, ['111']);
    assert.equal(tg.calls[0].pngBuffer.toString(), 'fake-analytics-png');
    assert.equal(tg.calls[0].caption, '📊 รายงานประจำวัน\nเมื่อวาน');

    assert.equal(state.historyCalls.length, 1);
    // telegram_sent_count is param index 14 (1-based) in the 16-column INSERT
    assert.equal(state.historyCalls[0][13], 1);
  });
});

describe('report-worker T5 — Telegram only (no LINE recipients)', () => {
  it('LINE is skipped, Telegram still sends, schedule records success', async () => {
    for (const k of ['line_default_recipient', 'imgbb_fallback_enabled', 'signed_image_expire_hours']) invalidateSystemSetting(k);
    const state = makeState({
      lineConfig: { enabled: false, channel_access_token: null, recipients: [] }, // LINE not configured at all
      telegramConfig: { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN), chats: [{ chat_id: '111', enabled: true }] },
      systemSettings: {},
    });
    installRouter(state);
    const ren = stubRenderer({ withAnalytics: true });
    const line = stubLine();
    const tg = stubTelegram();
    try {
      await runScheduledReport(baseSchedule({ telegram_chat_ids: ['111'] }));
    } finally { ren.restore(); line.restore(); tg.restore(); }

    assert.equal(line.calls.length, 0, 'LINE must never be called when it is not configured');
    assert.equal(tg.calls.length, 1);
    assert.equal(tg.calls[0].chatIds.length, 1);

    assert.equal(state.recordCalls.length, 1);
    assert.equal(state.recordCalls[0][1], 'success');
    assert.equal(state.historyCalls.length, 1);
    assert.equal(state.historyCalls[0][9], 'success'); // status column
  });
});

describe('report-worker T5 — Telegram only, sensitive family (lpr)', () => {
  it('report_line_send_lpr=1, LINE not configured, telegram chats set → Telegram sends, LINE never called', async () => {
    invalidateSystemSetting('report_line_send_lpr');
    const state = makeState({
      lineConfig: { enabled: false, channel_access_token: null, recipients: [] },
      telegramConfig: { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN), chats: [{ chat_id: '111', enabled: true }] },
      systemSettings: { report_line_send_lpr: '1' },
    });
    installRouter(state);
    const ren = stubRenderer({ withLpr: true });
    const line = stubLine();
    const tg = stubTelegram();
    try {
      await runScheduledReport(baseSchedule({ report_family: 'lpr', telegram_chat_ids: ['111'] }));
    } finally { ren.restore(); line.restore(); tg.restore(); }

    assert.equal(line.calls.length, 0, 'LINE must never be called when it is not configured');
    assert.equal(tg.calls.length, 1);
    assert.deepEqual(tg.calls[0].chatIds, ['111']);

    assert.equal(state.recordCalls.length, 1);
    assert.equal(state.recordCalls[0][1], 'success');
    assert.equal(state.historyCalls.length, 1);
    assert.equal(state.historyCalls[0][9], 'success'); // status column
    assert.equal(state.historyCalls[0][13], 1); // telegram_sent_count
  });
});

describe('report-worker T5 — sensitive switch off', () => {
  it('report_line_send_lpr=0 blocks both LINE and Telegram, even with telegram chats configured', async () => {
    invalidateSystemSetting('report_line_send_lpr');
    const state = makeState({
      lineConfig: {
        enabled: true, channel_access_token: 'line-token', imgbb_api_key: 'imgbb-key',
        recipients: [{ id: 'U1', name: 'ทดสอบ', enabled: true }],
      },
      telegramConfig: { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN), chats: [{ chat_id: '111', enabled: true }] },
      systemSettings: { report_line_send_lpr: '0' },
    });
    installRouter(state);
    const ren = stubRenderer({ withLpr: true });
    const line = stubLine();
    const tg = stubTelegram();
    try {
      await runScheduledReport(baseSchedule({ report_family: 'lpr', telegram_chat_ids: ['111'] }));
    } finally { ren.restore(); line.restore(); tg.restore(); }

    assert.equal(line.calls.length, 0);
    assert.equal(tg.calls.length, 0);
    assert.equal(state.telegramConfigQueried, false, 'telegram_config must never be queried when the switch is off');
    assert.equal(state.recordCalls.length, 1);
    assert.equal(state.recordCalls[0][1], 'success'); // "generated, sending is just off" — unchanged from pre-T5 behaviour
  });
});
