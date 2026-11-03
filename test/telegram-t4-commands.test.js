// ============================================================
// Vigil Platform — Tests: telegramPoller command routing (T4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// src/helpers/lineCommandRun.js is a heavy DB-backed module (loadCommands,
// pending-ask table, cooldown log, etc.) — a full end-to-end test through the
// real handleLineText() belongs to lineCommandRun's own test suite, not here.
// This file isolates telegramPoller's OWN logic (link code flow, chat/operator
// gating, slash+@bot stripping, reply rendering) by substituting a stub for
// ../src/helpers/lineCommandRun in require.cache BEFORE telegramPoller is first
// required — the sanctioned "injection seam" for this layer. The real
// handleLineText/allowedHere/loadOperatorByTelegramId are covered unstubbed in
// test/telegram-t4-allowed-here.test.js (a separate process — node --test
// isolates one file per process, confirmed by the same require.cache pattern
// already used in telegram-t2a-lpr.test.js / line-webhook-command.test.js).
//
// ห้ามยิง api.telegram.org จริง — global.fetch ไม่ได้ถูกใช้ตรงนี้เลย (sender เป็น
// stub ล้วน) แต่ตั้ง guard ไว้เหมือนไฟล์อื่นเผื่อโค้ดที่ทดสอบหลุดไปเรียกจริง
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — this test file must never hit the network'); };
});
afterEach(() => { global.fetch = _origFetch; });

// ── stub lineCommandRun BEFORE telegramPoller's first require ──────────────
const _mock = {
  operator: null,
  allowed: true,
  handleLineTextResult: { action: 'ignore', status: 'no_match' },
  handleLineTextCalls: [],
  onAckText: null,   // ตั้งค่านี้เพื่อจำลอง handleLineText ที่เรียก deps.onAck() ก่อนคืนผล
};
const _lcrPath = require.resolve('../src/helpers/lineCommandRun');
require.cache[_lcrPath] = {
  id: _lcrPath, filename: _lcrPath, loaded: true,
  exports: {
    // อ่าน _mock สดทุกครั้งที่ถูกเรียก (ไม่ใช่ค่าที่ผูกไว้ตอน require) — เพราะ
    // telegramPoller.js destructure ฟังก์ชันนี้ออกไปเป็น const ตอนโหลดโมดูลครั้งแรก
    // reassign เมธอดบน exports object ทีหลังจะไม่มีผลกับ const ที่ผูกไปแล้ว
    handleLineText: async (deps, args) => {
      _mock.handleLineTextCalls.push({ deps, args });
      if (_mock.onAckText) await deps.onAck(_mock.onAckText);
      return _mock.handleLineTextResult;
    },
    loadOperatorByTelegramId: async () => _mock.operator,
    allowedHere: () => _mock.allowed,
  },
};

const poller = require('../src/helpers/telegramPoller');
const sender = require('../src/helpers/telegramSender');
const { hashLinkCode } = require('../src/helpers/telegramLinkCode');
const telegramCard = require('../src/helpers/telegramCard');

beforeEach(() => {
  _mock.operator = null;
  _mock.allowed = true;
  _mock.handleLineTextResult = { action: 'ignore', status: 'no_match' };
  _mock.handleLineTextCalls = [];
  _mock.onAckText = null;
  poller._resetLinkAttempts();
});

function makeSenderStub() {
  const calls = [];
  return {
    calls,
    escapeHtml: sender.escapeHtml,
    sendMessage: async (token, chatId, text) => { calls.push({ token, chatId, text }); return { success: true }; },
  };
}

// ============================================================
// Link flow — /link <รหัส>
// ============================================================
describe('telegramPoller._handleLinkAttempt', () => {
  const OP_ID = 'Ulinkoptest0000000000000000000000';
  const CODE = '123456';

  function makeLinkPool({ hit = true, updateThrows = null } = {}) {
    const queries = [];
    return {
      queries,
      async query(sql, args) {
        queries.push({ sql, args });
        if (/SELECT line_user_id FROM line_operators/.test(sql)) {
          return { rows: hit && args[0] === hashLinkCode(CODE) ? [{ line_user_id: OP_ID }] : [] };
        }
        if (/UPDATE line_operators SET telegram_user_id/.test(sql)) {
          if (updateThrows) throw updateThrows;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
  }

  it('รหัสถูกต้อง → ผูก telegram_user_id เข้ากับผู้สั่งแถวนั้น + ตอบสำเร็จ', async () => {
    const pool = makeLinkPool({ hit: true });
    const s = makeSenderStub();
    await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 1, from_id: 999, code: CODE });
    const upd = pool.queries.find((q) => /UPDATE line_operators SET telegram_user_id/.test(q.sql));
    assert.ok(upd, 'ต้อง UPDATE telegram_user_id');
    assert.deepEqual(upd.args, [OP_ID, 999]);
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].text, /สำเร็จ/);
  });

  it('รหัสผิด/หมดอายุ → ไม่ผูกอะไร + ตอบว่ารหัสไม่ถูกต้อง', async () => {
    const pool = makeLinkPool({ hit: false });
    const s = makeSenderStub();
    await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 1, from_id: 999, code: '000000' });
    assert.ok(!pool.queries.some((q) => /UPDATE line_operators SET telegram_user_id/.test(q.sql)));
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].text, /ไม่ถูกต้องหรือหมดอายุ/);
  });

  it('บัญชี Telegram นี้ผูกกับผู้สั่งอื่นอยู่แล้ว (unique violation) → ตอบข้อความนั้น ไม่ throw', async () => {
    const err = new Error('duplicate key'); err.code = '23505';
    const pool = makeLinkPool({ hit: true, updateThrows: err });
    const s = makeSenderStub();
    await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 1, from_id: 999, code: CODE });
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].text, /ผูกกับผู้สั่งคนอื่นอยู่แล้ว/);
  });

  it('เดารหัสผิดเกิน 5 ครั้งใน 10 นาที (from_id เดียวกัน) → ครั้งที่ 6 ไม่ query DB ต่อ', async () => {
    const pool = makeLinkPool({ hit: false });
    const s = makeSenderStub();
    for (let i = 0; i < 5; i++) {
      await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 1, from_id: 42, code: '000000' });
    }
    const queriesBefore = pool.queries.length;
    await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 1, from_id: 42, code: '000000' });
    assert.equal(pool.queries.length, queriesBefore, 'ครั้งที่ 6 ต้องไม่ query DB เพิ่ม');
    assert.match(s.calls.at(-1).text, /ถี่เกินไป/);
  });

  it('from_id อื่นไม่ถูกเหมาจำกัดร่วมกับคนที่โดน rate-limit', async () => {
    const pool = makeLinkPool({ hit: false });
    const s = makeSenderStub();
    for (let i = 0; i < 6; i++) {
      await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 1, from_id: 42, code: '000000' });
    }
    const before = s.calls.length;
    await poller._handleLinkAttempt(pool, s, 'TOKEN', { chat_id: 2, from_id: 777, code: '000000' });
    assert.equal(s.calls.length, before + 1);
    assert.match(s.calls.at(-1).text, /ไม่ถูกต้องหรือหมดอายุ/, 'from_id ใหม่ต้องยังตรวจรหัสได้ปกติ ไม่ใช่โดน rate-limit ไปด้วย');
  });
});

describe('telegramPoller.applyUpdate — /link ต้องเป็นแชทส่วนตัวเท่านั้น', () => {
  const BOT_ID = 123456789;
  it('/link ในกลุ่ม → link_wrong_place (ไม่ใช่ link_attempt)', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -1, type: 'group' }, text: '/link 123456', from: { id: 999 } },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'link_wrong_place', chat_id: -1 });
  });

  it('/link ในแชทส่วนตัว → link_attempt พร้อม code/from_id', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: 1, type: 'private' }, text: '/link 123456', from: { id: 999 } },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'link_attempt', chat_id: 1, from_id: 999, code: '123456' });
  });

  it('/link@botname 123456 ก็จับได้เหมือนกัน', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: 1, type: 'private' }, text: '/link@vssvision_bot 123456', from: { id: 999 } },
    }, BOT_ID);
    assert.equal(a.type, 'link_attempt');
    assert.equal(a.code, '123456');
  });

  it('ข้อความจากบอทอื่น (from.is_bot) → null ทุกกรณี รวมถึง /link', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: 1, type: 'private' }, text: '/link 123456', from: { id: 999, is_bot: true } },
    }, BOT_ID);
    assert.equal(a, null);
  });

  it('ข้อความทั่วไปที่ไม่ใช่ /start หรือ /link → command (T4 ต่อจาก T1)', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -100222, type: 'group' }, text: 'สวัสดี', from: { id: 5 } },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'command', chat_id: -100222, chat_type: 'group', from_id: 5, text: 'สวัสดี' });
  });
});

describe('_pollOnce → link_wrong_place ตอบกลับในแชทเดิม', () => {
  it('พิมพ์ /link ในกลุ่ม → ได้ข้อความบอกให้ทักส่วนตัว', async () => {
    const s = makeSenderStub();
    s.getUpdates = async () => ({
      success: true,
      result: [{ update_id: 1, message: { chat: { id: -1, type: 'group' }, text: '/link 123456', from: { id: 9 } } }],
    });
    const pool = { query: async () => ({ rows: [] }) };
    await poller._pollOnce(pool, s, '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 0);
    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].text, /ส่วนตัว/);
  });
});

// ============================================================
// Slash + @botusername stripping
// ============================================================
describe('telegramPoller._stripSlashMention', () => {
  it('ไม่มี / หรือ @ เลย → คืนค่าเดิม', () => {
    assert.equal(poller._stripSlashMention('ยอดวันนี้', 'vssvision_bot'), 'ยอดวันนี้');
  });
  it('"/ยอดวันนี้@vssvision_bot" → ตัดทั้ง / และ @bot', () => {
    assert.equal(poller._stripSlashMention('/ยอดวันนี้@vssvision_bot', 'vssvision_bot'), 'ยอดวันนี้');
  });
  it('มีคำต่อท้าย → คำต่อท้ายไม่ถูกแตะ', () => {
    assert.equal(poller._stripSlashMention('/ยอดวันนี้@vssvision_bot ภูเก็ต', 'vssvision_bot'), 'ยอดวันนี้ ภูเก็ต');
  });
  it('ไม่รู้ botUsername (ยังไม่เคย getMe) → ยังตัด @xxx ท้ายคำแรกได้แบบทั่วไป', () => {
    assert.equal(poller._stripSlashMention('/ยอดวันนี้@someone_bot', null), 'ยอดวันนี้');
  });
  it('@bot ผิดชื่อ (คนละบอท) → ไม่ตัดทิ้ง (แค่ตัด / นำหน้า)', () => {
    assert.equal(poller._stripSlashMention('/ยอดวันนี้@other_bot', 'vssvision_bot'), 'ยอดวันนี้@other_bot');
  });
});

// ============================================================
// _handleCommandMessage — routing (operator/chat gating + reply rendering)
// ============================================================
describe('telegramPoller._handleCommandMessage', () => {
  function makeChatsPool(chats) {
    return { query: async () => ({ rows: [{ chats }] }) };
  }

  it('operator ไม่พบ (ไม่ผูก Telegram) → ไม่เรียก handleLineText เลย ไม่ตอบอะไร', async () => {
    _mock.operator = null;
    const s = makeSenderStub();
    await poller._handleCommandMessage(makeChatsPool([]), s, 'TOKEN',
      { chat_id: -1, chat_type: 'group', from_id: 5, text: 'ยอดวันนี้' }, {});
    assert.equal(_mock.handleLineTextCalls.length, 0);
    assert.equal(s.calls.length, 0);
  });

  it('กลุ่มยังไม่อนุมัติ (ไม่อยู่ใน telegram_config.chats) → ไม่ตอบ แม้ operator ผูกแล้ว', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    const s = makeSenderStub();
    await poller._handleCommandMessage(makeChatsPool([]), s, 'TOKEN',
      { chat_id: -100777, chat_type: 'group', from_id: 5, text: 'ยอดวันนี้' }, {});
    assert.equal(_mock.handleLineTextCalls.length, 0);
    assert.equal(s.calls.length, 0);
  });

  it('กลุ่มที่อนุมัติแล้วแต่ enabled=false → ไม่ตอบ', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    const s = makeSenderStub();
    await poller._handleCommandMessage(
      makeChatsPool([{ chat_id: '-100777', enabled: false }]), s, 'TOKEN',
      { chat_id: -100777, chat_type: 'group', from_id: 5, text: 'ยอดวันนี้' }, {});
    assert.equal(_mock.handleLineTextCalls.length, 0);
  });

  it('allow_in ไม่อนุญาตห้องนี้ (allowedHere=false) → ไม่เรียก handleLineText', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: ['tg:-1'] };
    _mock.allowed = false;
    const s = makeSenderStub();
    await poller._handleCommandMessage(
      makeChatsPool([{ chat_id: '-100777', enabled: true }]), s, 'TOKEN',
      { chat_id: -100777, chat_type: 'group', from_id: 5, text: 'ยอดวันนี้' }, {});
    assert.equal(_mock.handleLineTextCalls.length, 0);
    assert.equal(s.calls.length, 0);
  });

  it('กลุ่มที่อนุมัติแล้ว + operator ผูกแล้ว + allowedHere=true → เรียก handleLineText ด้วย sourceType telegram และ sourceId tg:<chatId>', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    _mock.handleLineTextResult = { action: 'reply', status: 'ok', text: 'ยอด 12 ครั้ง' };
    const s = makeSenderStub();
    const ctx = { auth: { FAKE: true }, baseUrl: 'http://127.0.0.1:9', botUsername: 'vssvision_bot' };
    await poller._handleCommandMessage(
      makeChatsPool([{ chat_id: '-100777', enabled: true }]), s, 'TOKEN',
      { chat_id: -100777, chat_type: 'group', from_id: 5, text: '/ยอดวันนี้@vssvision_bot' }, ctx);

    assert.equal(_mock.handleLineTextCalls.length, 1);
    const call = _mock.handleLineTextCalls[0];
    assert.equal(call.args.text, 'ยอดวันนี้', 'ต้องตัด / และ @bot ออกก่อนส่งเข้า handleLineText');
    assert.equal(call.args.lineUserId, 'Uabc');
    assert.equal(call.args.sourceType, 'telegram');
    assert.equal(call.args.sourceId, 'tg:-100777');
    assert.equal(call.args.op, _mock.operator);
    assert.equal(call.deps.auth, ctx.auth);
    assert.equal(call.deps.baseUrl, ctx.baseUrl);
    assert.equal(typeof call.deps.onAck, 'function');

    assert.equal(s.calls.length, 1);
    assert.match(s.calls[0].text, /ยอด 12 ครั้ง/);
  });

  it('แชทส่วนตัว (private) ไม่ต้องเช็ค telegram_config.chats — operator ที่ผูกแล้วสั่งได้ทันที', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    _mock.handleLineTextResult = { action: 'reply', status: 'ok', text: 'ok' };
    let chatsQueried = false;
    const pool = { query: async () => { chatsQueried = true; return { rows: [] }; } };
    const s = makeSenderStub();
    await poller._handleCommandMessage(pool, s, 'TOKEN',
      { chat_id: 555, chat_type: 'private', from_id: 5, text: 'ยอดวันนี้' }, {});
    assert.equal(chatsQueried, false, 'private chat ไม่ต้อง query telegram_config.chats เลย');
    assert.equal(_mock.handleLineTextCalls.length, 1);
    assert.equal(_mock.handleLineTextCalls[0].args.sourceId, 'tg:555');
  });

  it('ตอบกลับที่มี r.card → แปลงผ่าน telegramCard.fromAnswerCard() ก่อนส่ง', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    const card = { title: 'ผู้ไม่สวมหมวกนิรภัย', big: 5, unit: 'ครั้ง' };
    _mock.handleLineTextResult = { action: 'reply', status: 'ok', card };
    const s = makeSenderStub();
    await poller._handleCommandMessage({ query: async () => ({ rows: [] }) }, s, 'TOKEN',
      { chat_id: 1, chat_type: 'private', from_id: 5, text: 'ยอดวันนี้' }, {});
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].text, telegramCard.fromAnswerCard(card).caption);
  });

  it('r.action = ignore (เช่น no_match) → ไม่ส่งข้อความใด ๆ', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    _mock.handleLineTextResult = { action: 'ignore', status: 'no_match' };
    const s = makeSenderStub();
    await poller._handleCommandMessage({ query: async () => ({ rows: [] }) }, s, 'TOKEN',
      { chat_id: 1, chat_type: 'private', from_id: 5, text: 'สวัสดี' }, {});
    assert.equal(s.calls.length, 0);
  });

  it('onAck ที่ handleLineText เรียก → ส่งข้อความ "กำลังค้นหา…" (หรือข้อความที่ให้มา) ทันที', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    _mock.handleLineTextResult = { action: 'reply', status: 'ok', text: 'เสร็จแล้ว' };
    _mock.onAckText = 'กำลังค้นหา…';   // จำลอง handleLineText แหล่งช้าที่เด้ง ack ก่อนคืนผล (ของจริง)
    const s = makeSenderStub();
    await poller._handleCommandMessage({ query: async () => ({ rows: [] }) }, s, 'TOKEN',
      { chat_id: 1, chat_type: 'private', from_id: 5, text: 'ค้นหาอัจฉริยะ คนถือร่ม' }, {});
    assert.equal(s.calls.length, 2, 'ต้องมีทั้งข้อความ ack และคำตอบจริง');
    assert.match(s.calls[0].text, /กำลังค้นหา/);
    assert.match(s.calls[1].text, /เสร็จแล้ว/);
  });
});

// เจ้าของถาม 2026-09-25 "มันไม่ส่งรูปกลับมาหรอครับ?" — คำตอบค้นหาใบหน้าได้แค่ข้อความ
describe('_handleCommandMessage — คำตอบที่มีรูปส่งอัลบั้มตามหลังข้อความ', () => {
  it('card.photos → sendMessage แล้ว sendMediaGroup ≤10 รูป พร้อม caption', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    const photos = Array.from({ length: 12 }, (_, i) => ({
      file: `nope/${i}.jpg`, url: `https://dash.test/pub/img/${i}.jpg`, title: `C${i}`, caption: '10:00' }));
    _mock.handleLineTextResult = { action: 'reply', card: { title: 'ค้นหาใบหน้า', big: 12, unit: 'ภาพ', photos } };
    const s = makeSenderStub();
    s.albums = [];
    s.sendMediaGroup = async (token, chatId, items) => { s.albums.push(items); return { success: true }; };
    await poller._handleCommandMessage({ query: async () => ({ rows: [{ chats: [] }] }) }, s, 'TOKEN',
      { chat_id: 42, chat_type: 'private', from_id: 42, text: 'ค้นหาใบหน้า' }, {});
    assert.equal(s.calls.length, 1, 'ข้อความหลักก่อน');
    assert.doesNotMatch(s.calls[0].text, /เปิดดูรูปได้ในระบบ/);
    assert.equal(s.albums.length, 1);
    assert.equal(s.albums[0].length, 10);
    assert.equal(s.albums[0][0].url, photos[0].url, 'ไฟล์ไม่อยู่บนเครื่อง → ใช้ลิงก์');
    assert.match(s.albums[0][0].captionHtml, /C0/);
  });

  it('ไม่มีรูป → ไม่เรียก sendMediaGroup', async () => {
    _mock.operator = { line_user_id: 'Uabc', enabled: true, user_id: 5, allow_in: null };
    _mock.handleLineTextResult = { action: 'reply', card: { title: 'ยอด', big: 3 } };
    const s = makeSenderStub();
    let called = false;
    s.sendMediaGroup = async () => { called = true; return { success: true }; };
    await poller._handleCommandMessage({ query: async () => ({ rows: [{ chats: [] }] }) }, s, 'TOKEN',
      { chat_id: 42, chat_type: 'private', from_id: 42, text: 'ยอด' }, {});
    assert.equal(called, false);
  });
});
