// ============================================================
// Vigil Platform — Tests: telegramSender.sendReportToTelegram (T5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ห้ามยิง api.telegram.org จริง — global.fetch ถูกแทนด้วย stub ที่โยน error เสมอ
// เป็นค่าเริ่มต้น (beforeEach) เหมือน test/telegram-t1.test.js
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { sendReportToTelegram } = require('../src/helpers/telegramSender');

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — every test must stub global.fetch'); };
});
afterEach(() => { global.fetch = _origFetch; });

// อ่าน method ที่ tgCall เรียก (…/bot<token>/<method>) จาก url โดยไม่ต้อง parse token
function methodOf(url) {
  return String(url).split('/').pop();
}

async function formFields(body) {
  const out = {};
  for (const [k, v] of body.entries()) out[k] = v;
  return out;
}

function okJson(result = { message_id: 1 }) {
  return { ok: true, json: async () => ({ ok: true, result }) };
}
function failJson(description) {
  return { ok: true, json: async () => ({ ok: false, description }) };
}

describe('sendReportToTelegram — photo vs document by size', () => {
  it('PNG <= 10MB → sendPhoto', async () => {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return okJson(); };
    const png = Buffer.alloc(1024, 1);
    const r = await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111'], pngBuffer: png, caption: 'hi' });
    assert.equal(r.sentCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(methodOf(calls[0].url), 'sendPhoto');
  });

  it('PNG > 10MB, no PDF → sendDocument', async () => {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return okJson(); };
    const bigPng = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const r = await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111'], pngBuffer: bigPng, caption: 'hi' });
    assert.equal(r.sentCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(methodOf(calls[0].url), 'sendDocument');
  });

  it('pdfBuffer present → sendDocument even when PNG is small', async () => {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return okJson(); };
    const png = Buffer.alloc(100, 1);
    const pdf = Buffer.alloc(200, 2);
    const r = await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111'], pngBuffer: png, pdfBuffer: pdf, caption: 'hi' });
    assert.equal(r.sentCount, 1);
    assert.equal(methodOf(calls[0].url), 'sendDocument');
  });

  it('sendPhoto fails with a dimension error → retries as sendDocument', async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, opts });
      if (methodOf(url) === 'sendPhoto') return failJson('Bad Request: IMAGE_PROCESS_FAILED');
      return okJson();
    };
    const tallPng = Buffer.alloc(500, 1);
    const r = await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111'], pngBuffer: tallPng, caption: 'hi' });
    assert.equal(r.sentCount, 1);
    assert.equal(calls.length, 2);
    assert.equal(methodOf(calls[0].url), 'sendPhoto');
    assert.equal(methodOf(calls[1].url), 'sendDocument');
  });

  it('no token → per-chat error, zero fetch calls', async () => {
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return okJson(); };
    const r = await sendReportToTelegram({ token: null, chatIds: ['111', '222'], pngBuffer: Buffer.alloc(10), caption: 'x' });
    assert.equal(r.sentCount, 0);
    assert.equal(r.results.length, 2);
    assert.ok(r.results.every((x) => !x.ok));
    assert.equal(fetchCalled, false);
  });

  it('empty chatIds → no-op, no fetch calls', async () => {
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return okJson(); };
    const r = await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: [], pngBuffer: Buffer.alloc(10), caption: 'x' });
    assert.deepEqual(r, { sentCount: 0, results: [] });
    assert.equal(fetchCalled, false);
  });
});

describe('sendReportToTelegram — per-chat results', () => {
  it('one chat fails, one succeeds → mixed results, sentCount reflects only successes', async () => {
    let n = 0;
    global.fetch = async () => {
      n++;
      return n === 1 ? failJson('Forbidden: bot was blocked by the user') : okJson();
    };
    const r = await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111', '222'], pngBuffer: Buffer.alloc(10), caption: 'x' });
    assert.equal(r.sentCount, 1);
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].ok, false);
    assert.equal(r.results[1].ok, true);
    assert.equal(r.results[0].chat_id, '111');
    assert.equal(r.results[1].chat_id, '222');
  });
});

describe('sendReportToTelegram — caption escaping/length', () => {
  it('escapes HTML-significant characters', async () => {
    let seenCaption;
    global.fetch = async (url, opts) => {
      seenCaption = (await formFields(opts.body)).caption;
      return okJson();
    };
    await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111'], pngBuffer: Buffer.alloc(10), caption: '<b>A & B</b>' });
    assert.equal(seenCaption, '&lt;b&gt;A &amp; B&lt;/b&gt;');
  });

  it('caption longer than 1024 chars after escaping is trimmed to <= 1024 without a cut entity', async () => {
    let seenCaption;
    global.fetch = async (url, opts) => {
      seenCaption = (await formFields(opts.body)).caption;
      return okJson();
    };
    // '&' ทุกตัวยาวเป็น 5 ตัวหลัง escape ('&amp;') — ถ้าตัดสตริงที่ escape แล้วตรงๆ
    // จะมีโอกาสสูงที่ตัดกลาง entity พอดี ข้อความนี้จงใจให้เต็มไปด้วย '&' เพื่อชน edge case นั้น
    const raw = '&'.repeat(500);
    await sendReportToTelegram({ token: FAKE_TOKEN, chatIds: ['111'], pngBuffer: Buffer.alloc(10), caption: raw });
    assert.ok(seenCaption.length <= 1024);
    // ต้องประกอบด้วย "&amp;" เต็มหน่วยล้วนๆ — ไม่มีเศษ entity ที่ถูกตัดกลางคัน
    // (เช่น "&am" หรือ "&amp" ที่ไม่มี ";" ปิด)
    assert.match(seenCaption, /^(&amp;)*$/);
    assert.ok(seenCaption.length > 0);
  });
});
