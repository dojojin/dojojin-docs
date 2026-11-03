// ============================================================
// Vigil Platform — Tests: helpers/notifier.js images[key] = {path, kind} (T2b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// T2a's sendTelegramLeg only ever resolved SNAPSHOT_DIR paths (kind='img',
// the signedImage.js default) — true for LPR/GuruSquare, but a face-match
// reference image usually lives under PHOTO_DIR (kind='ref'; see
// line-sender.js _faceRefInfo). Sending kind='img' for a PHOTO_DIR file signs
// the wrong directory and 404s silently. T2b extends the `images` value to
// accept `{path, kind}` in addition to a plain string (which still defaults
// to 'img', unchanged for every T2a caller).
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const signedImage = require('../src/helpers/signedImage');
const { sendTelegramLeg } = require('../src/helpers/notifier');

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let _origUsableSignedUrl;
let calls;
beforeEach(() => {
  calls = [];
  _origUsableSignedUrl = signedImage.usableSignedUrl;
  signedImage.usableSignedUrl = async (file, ttl, kind) => {
    calls.push({ file, kind });
    return { url: `https://dashboard.test/pub/${kind}/${file}` };
  };
});
afterEach(() => { signedImage.usableSignedUrl = _origUsableSignedUrl; });

function makePool(cfg) {
  return { query: async (sql) => {
    if (sql.includes('FROM telegram_config WHERE id = 1')) return { rows: [cfg] };
    throw new Error('unexpected sql: ' + sql);
  } };
}
function stubSender() {
  return {
    sendMessage: async () => ({ success: true, message_id: 1 }),
    sendPhoto: async () => ({ success: true, message_id: 2 }),
    sendMediaGroup: async () => ({ success: true, message_id: 3 }),
  };
}
const card = { caption: 'x', overflow: null };
const chats = [{ chat_id: '-100111', name: 'G', type: 'group' }];
const pool = () => makePool({ enabled: true, bot_token_enc: encryptPii(FAKE_TOKEN) });

describe('sendTelegramLeg — images[key] as {path, kind}', () => {
  it('a plain string still defaults to kind=img (T2a behaviour unchanged)', async () => {
    await sendTelegramLeg({ pool: pool(), sender: stubSender(), chats, card,
      images: { scene: 'events/e1.jpg' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, 'events/e1.jpg');
    assert.equal(calls[0].kind, 'img');
  });

  it('{path, kind} resolves with the given kind (e.g. ref = PHOTO_DIR)', async () => {
    await sendTelegramLeg({ pool: pool(), sender: stubSender(), chats, card,
      images: { ref: { path: 'roster/person.jpg', kind: 'ref' } } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, 'roster/person.jpg');
    assert.equal(calls[0].kind, 'ref');
  });

  it('{path} with no kind falls back to img, same as a plain string', async () => {
    await sendTelegramLeg({ pool: pool(), sender: stubSender(), chats, card,
      images: { plate: { path: 'lpr/plate.jpg' } } });
    assert.equal(calls[0].kind, 'img');
  });

  it('a null/absent {path} skips that image entirely (no call)', async () => {
    await sendTelegramLeg({ pool: pool(), sender: stubSender(), chats, card,
      images: { ref: { path: null, kind: 'ref' } } });
    assert.equal(calls.length, 0);
  });

  it('mixed string + {path,kind} in one album resolves each with its own kind, in plate→scene→ref order', async () => {
    await sendTelegramLeg({ pool: pool(), sender: stubSender(), chats, card,
      images: {
        plate: 'lpr/plate.jpg',
        scene: 'events/e1.jpg',
        ref: { path: 'roster/person.jpg', kind: 'ref' },
      } });
    assert.deepEqual(calls.map((c) => c.kind), ['img', 'img', 'ref']);
    assert.deepEqual(calls.map((c) => c.file), ['lpr/plate.jpg', 'events/e1.jpg', 'roster/person.jpg']);
  });
});
