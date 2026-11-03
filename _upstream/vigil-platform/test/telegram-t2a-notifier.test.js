// ============================================================
// Vigil Platform — Tests: helpers/notifier.js (T2a — sendTelegramLeg)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// sendTelegramLeg() takes an injectable `sender`, but resolves image paths
// through the real signedImage.usableSignedUrl() (not injectable, by design —
// see notifier.js). We monkey-patch signedImage.usableSignedUrl on the
// required module object (notifier.js reads it as `signedImage.usableSignedUrl`
// rather than destructuring at require time, precisely so this works) to keep
// these tests network-free and deterministic instead of depending on
// DASHBOARD_PUBLIC_URL/SNAPSHOT_PROXY_SECRET env + a real HEAD preflight.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const signedImage = require('../src/helpers/signedImage');
const { sendTelegramLeg } = require('../src/helpers/notifier');

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let _origUsableSignedUrl;
beforeEach(() => {
  _origUsableSignedUrl = signedImage.usableSignedUrl;
  // ค่าเริ่มต้น: ทุก path ที่ไม่ว่างได้ URL ปลอมกลับมา — เทสต์ที่ต้องการ "ไม่มีรูป"
  // override ทับเป็น null เฉพาะจุด
  signedImage.usableSignedUrl = async (file) => (file ? { url: `https://dashboard.test/pub/img/${file}` } : { url: null });
});
afterEach(() => { signedImage.usableSignedUrl = _origUsableSignedUrl; });

function makePool(cfg) {
  return { query: async (sql) => {
    if (sql.includes('FROM telegram_config WHERE id = 1')) return { rows: [cfg] };
    throw new Error('unexpected sql: ' + sql);
  } };
}

function stubSender(over = {}) {
  const calls = { sendMessage: [], sendPhoto: [], sendMediaGroup: [] };
  return {
    calls,
    sendMessage: async (token, chatId, text) => { calls.sendMessage.push({ token, chatId, text }); return over.sendMessage ? over.sendMessage(token, chatId, text) : { success: true, message_id: 1 }; },
    sendPhoto: async (token, chatId, photo, caption) => { calls.sendPhoto.push({ token, chatId, photo, caption }); return over.sendPhoto ? over.sendPhoto(token, chatId, photo, caption) : { success: true, message_id: 2 }; },
    sendMediaGroup: async (token, chatId, items) => { calls.sendMediaGroup.push({ token, chatId, items }); return over.sendMediaGroup ? over.sendMediaGroup(token, chatId, items) : { success: true, message_id: 3 }; },
  };
}

const card = { caption: '<b>เฝ้าระวัง</b>', overflow: null };
const chats = [{ chat_id: '-100111', name: 'กลุ่มทดสอบ', type: 'group' }];

describe('sendTelegramLeg — gating', () => {
  it('telegram_config.enabled = false => no calls, returns []', async () => {
    const pool = makePool({ enabled: false, bot_token_enc: encryptPii(FAKE_TOKEN) });
    const sender = stubSender();
    const r = await sendTelegramLeg({ pool, sender, chats, card, images: {} });
    assert.deepEqual(r, []);
    assert.equal(sender.calls.sendMessage.length, 0);
  });

  it('no bot_token_enc => no calls, returns []', async () => {
    const pool = makePool({ enabled: true, bot_token_enc: null });
    const sender = stubSender();
    const r = await sendTelegramLeg({ pool, sender, chats, card, images: {} });
    assert.deepEqual(r, []);
  });

  it('no chats => no calls, returns [] (no DB query needed)', async () => {
    const sender = stubSender();
    const r = await sendTelegramLeg({ pool: makePool({ enabled: true }), sender, chats: [], card, images: {} });
    assert.deepEqual(r, []);
    assert.equal(sender.calls.sendMessage.length, 0);
  });
});

describe('sendTelegramLeg — image count picks the right Bot API call', () => {
  const cfg = { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) };

  it('0 images => sendMessage(caption)', async () => {
    const pool = makePool(cfg);
    const sender = stubSender();
    const r = await sendTelegramLeg({ pool, sender, chats, card, images: {} });
    assert.equal(sender.calls.sendMessage.length, 1);
    assert.equal(sender.calls.sendPhoto.length, 0);
    assert.equal(sender.calls.sendMediaGroup.length, 0);
    assert.equal(sender.calls.sendMessage[0].text, card.caption);
    assert.equal(r.length, 1);
    assert.equal(r[0].ok, true);
    assert.equal(r[0].channel, 'telegram');
    assert.equal(r[0].id_tail, '0111');
  });

  it('1 image => sendPhoto with a URL', async () => {
    const pool = makePool(cfg);
    const sender = stubSender();
    await sendTelegramLeg({ pool, sender, chats, card, images: { plate: 'lp/abc.jpg' } });
    assert.equal(sender.calls.sendPhoto.length, 1);
    assert.equal(sender.calls.sendPhoto[0].photo.url, 'https://dashboard.test/pub/img/lp/abc.jpg');
    assert.equal(sender.calls.sendMediaGroup.length, 0);
  });

  it('3 images => sendMediaGroup in plate/scene/ref order, caption on the first item', async () => {
    const pool = makePool(cfg);
    const sender = stubSender();
    await sendTelegramLeg({
      pool, sender, chats, card,
      images: { plate: 'lp/plate.jpg', scene: 'ev/scene.jpg', ref: 'wl/ref.jpg' },
    });
    assert.equal(sender.calls.sendMediaGroup.length, 1);
    const items = sender.calls.sendMediaGroup[0].items;
    assert.equal(items.length, 3);
    assert.ok(items[0].url.endsWith('plate.jpg'));
    assert.ok(items[1].url.endsWith('scene.jpg'));
    assert.ok(items[2].url.endsWith('ref.jpg'));
    assert.equal(items[0].captionHtml, card.caption);
    assert.equal(items[1].captionHtml, undefined);
  });

  it('images whose signed URL is null are skipped (2 of 3 available => still an album if 2 remain)', async () => {
    signedImage.usableSignedUrl = async (file) => (file === 'ev/scene.jpg' ? { url: null } : { url: `https://dashboard.test/pub/img/${file}` });
    const pool = makePool(cfg);
    const sender = stubSender();
    await sendTelegramLeg({ pool, sender, chats, card, images: { plate: 'lp/plate.jpg', scene: 'ev/scene.jpg', ref: 'wl/ref.jpg' } });
    assert.equal(sender.calls.sendMediaGroup.length, 1);
    assert.equal(sender.calls.sendMediaGroup[0].items.length, 2);
  });
});

describe('sendTelegramLeg — URL fetch failure retries once as a buffer', () => {
  const cfg = { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) };

  it('sendPhoto fails with a URL-content error => downloads and retries once as a buffer', async () => {
    let fetchCalls = 0;
    const _origFetch = global.fetch;
    global.fetch = async () => { fetchCalls++; return { ok: true, arrayBuffer: async () => Buffer.from('fake-jpg-bytes') }; };
    try {
      const pool = makePool(cfg);
      let photoCalls = 0;
      const sender = stubSender({
        sendPhoto: async (token, chatId, photo) => {
          photoCalls++;
          if (photo.url) return { success: false, error: '[sendPhoto] Bad Request: failed to get HTTP URL content' };
          assert.ok(Buffer.isBuffer(photo.buffer), 'retry must send a buffer, not a url');
          return { success: true, message_id: 9 };
        },
      });
      const r = await sendTelegramLeg({ pool, sender, chats, card, images: { plate: 'lp/plate.jpg' } });
      assert.equal(photoCalls, 2, 'first attempt (url) + one retry (buffer)');
      assert.equal(fetchCalls, 1, 'downloads the image exactly once');
      assert.equal(r[0].ok, true);
    } finally { global.fetch = _origFetch; }
  });

  // เหตุจริง 2026-09-25: การ์ดใบหน้า 3 รูป รูปที่ 3 (ภาพอ้างอิง) ได้ WEBPAGE_CURL_FAILED
  // ไม่ถูกจับเป็น URL error → ไม่ลองอัปโหลดเอง → การ์ดหายทุกแชท
  it('sendMediaGroup WEBPAGE_CURL_FAILED => retries the album as buffers', async () => {
    const _origFetch = global.fetch;
    global.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('fake-jpg-bytes') });
    try {
      const pool = makePool(cfg);
      const sender = stubSender({
        sendMediaGroup: async (token, chatId, items) => (items[0].url
          ? { success: false, error: '[sendMediaGroup] Bad Request: failed to send message #3 with the error message "WEBPAGE_CURL_FAILED"' }
          : { success: true, message_id: 7 }),
      });
      const r = await sendTelegramLeg({ pool, sender, chats, card,
        images: { plate: 'a.jpg', scene: 'b.jpg', ref: { path: 'c.jpg', kind: 'ref' } } });
      assert.equal(sender.calls.sendMediaGroup.length, 2, 'url album + one buffer retry');
      assert.ok(Buffer.isBuffer(sender.calls.sendMediaGroup[1].items[2].buffer));
      assert.equal(r[0].ok, true);
    } finally { global.fetch = _origFetch; }
  });

  it('an unrelated send error does not trigger a buffer retry', async () => {
    const _origFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls++; throw new Error('must not be called'); };
    try {
      const pool = makePool(cfg);
      const sender = stubSender({ sendPhoto: async () => ({ success: false, error: '[sendPhoto] Forbidden: bot was blocked by the user' }) });
      const r = await sendTelegramLeg({ pool, sender, chats, card, images: { plate: 'lp/plate.jpg' } });
      assert.equal(fetchCalls, 0);
      assert.equal(r[0].ok, false);
      assert.match(r[0].error, /blocked/);
    } finally { global.fetch = _origFetch; }
  });
});

describe('sendTelegramLeg — overflow + per-chat result shape', () => {
  const cfg = { enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) };

  it('overflow is sent as a follow-up message only when the first send succeeded', async () => {
    const pool = makePool(cfg);
    const sender = stubSender();
    const withOverflow = { caption: 'หัว', overflow: 'ส่วนที่เกิน 1024' };
    await sendTelegramLeg({ pool, sender, chats, card: withOverflow, images: {} });
    assert.equal(sender.calls.sendMessage.length, 2, 'caption message + overflow message');
    assert.equal(sender.calls.sendMessage[1].text, 'ส่วนที่เกิน 1024');
  });

  it('overflow is NOT sent when the primary send failed', async () => {
    const pool = makePool(cfg);
    const sender = stubSender({ sendMessage: async () => ({ success: false, error: 'boom' }) });
    const withOverflow = { caption: 'หัว', overflow: 'ส่วนที่เกิน' };
    await sendTelegramLeg({ pool, sender, chats, card: withOverflow, images: {} });
    assert.equal(sender.calls.sendMessage.length, 1);
  });

  it('per-chat result carries name/type/id_tail/ok/error/channel/message_id', async () => {
    const pool = makePool(cfg);
    const sender = stubSender();
    const r = await sendTelegramLeg({ pool, sender, chats, card, images: {} });
    assert.deepEqual(Object.keys(r[0]).sort(), ['channel', 'error', 'id_tail', 'message_id', 'name', 'ok', 'type'].sort());
    assert.equal(r[0].name, 'กลุ่มทดสอบ');
    assert.equal(r[0].type, 'group');
    assert.equal(r[0].message_id, 1);
  });

  it('multiple chats each get their own send + result', async () => {
    const pool = makePool(cfg);
    const sender = stubSender();
    const twoChats = [{ chat_id: '1' }, { chat_id: '2' }];
    const r = await sendTelegramLeg({ pool, sender, chats: twoChats, card, images: {} });
    assert.equal(sender.calls.sendMessage.length, 2);
    assert.equal(r.length, 2);
  });
});
