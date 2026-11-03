// ============================================================
// Vigil Platform — Tests: Telegram backup channel T1 (sender / poller / routes)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ห้ามยิง api.telegram.org จริง — global.fetch ถูกแทนด้วย stub ที่โยน error เสมอ
// เป็นค่าเริ่มต้นของทุกเทสต์ (beforeEach) ถ้าโค้ดที่ถูกทดสอบลืม stub เอง เทสต์จะ
// แดงทันทีแทนที่จะแอบยิงเน็ตออกไปจริงด้วย token ปลอม
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');

const sender = require('../src/helpers/telegramSender');
const poller = require('../src/helpers/telegramPoller');
const { encryptPii } = require('../src/helpers/blacklist-crypto');
const telegramRoutes = require('../src/routes/telegram');

let _origFetch;
beforeEach(() => {
  _origFetch = global.fetch;
  global.fetch = () => { throw new Error('unstubbed fetch — every test must stub global.fetch'); };
});
afterEach(() => { global.fetch = _origFetch; });

const FAKE_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 35 chars after ':'

function jsonRes(body, status = 200) {
  return { status, json: async () => body };
}

// ============================================================
// telegramSender
// ============================================================
describe('telegramSender.tgCall', () => {
  it('ส่ง JSON body ปกติเมื่อไม่มีไฟล์', async () => {
    let seen;
    global.fetch = (url, opts) => { seen = { url, opts }; return jsonRes({ ok: true, result: { id: 1 } }); };
    const r = await sender.tgCall(FAKE_TOKEN, 'getMe', {});
    assert.equal(r.success, true);
    assert.equal(seen.opts.headers['Content-Type'], 'application/json');
    assert.equal(typeof seen.opts.body, 'string');
    assert.ok(seen.url.includes('/getMe'));
  });

  it('ส่ง multipart (FormData) เมื่อมีไฟล์ — ไม่ตั้ง Content-Type เอง', async () => {
    let seen;
    global.fetch = (url, opts) => { seen = { url, opts }; return jsonRes({ ok: true, result: { message_id: 5 } }); };
    const r = await sender.tgCall(FAKE_TOKEN, 'sendPhoto',
      { chat_id: '1', caption: 'hi' },
      { files: { photo: { buffer: Buffer.from('x'), filename: 'a.jpg' } } });
    assert.equal(r.success, true);
    assert.ok(seen.opts.body instanceof FormData, 'body ต้องเป็น FormData');
    assert.equal(seen.opts.headers, undefined, 'ห้ามตั้ง Content-Type เอง — fetch ต้องใส่ boundary เอง');
    assert.equal(seen.opts.body.get('chat_id'), '1');
  });

  it('429 → รอ retry_after (เล็กมากในเทสต์) แล้วลองซ้ำ 1 ครั้ง', async () => {
    let calls = 0;
    global.fetch = () => {
      calls++;
      if (calls === 1) return jsonRes({ ok: false, description: 'too many', parameters: { retry_after: 0.01 } }, 429);
      return jsonRes({ ok: true, result: {} });
    };
    const r = await sender.sendMessage(FAKE_TOKEN, '1', 'hi');
    assert.equal(calls, 2, 'ต้องลองซ้ำเพียง 1 ครั้ง');
    assert.equal(r.success, true);
  });

  it('response ไม่ใช่ JSON → success:false ไม่ throw', async () => {
    global.fetch = () => ({ status: 502, json: async () => { throw new Error('not json'); } });
    const r = await sender.getMe(FAKE_TOKEN);
    assert.equal(r.success, false);
    assert.match(r.error, /non-JSON/);
  });

  it('timeout (AbortError) → success:false', async () => {
    global.fetch = () => { const e = new Error('aborted'); e.name = 'AbortError'; return Promise.reject(e); };
    const r = await sender.getMe(FAKE_TOKEN);
    assert.equal(r.success, false);
    assert.match(r.error, /timeout/);
  });

  it('error string ห้ามมี token ปนอยู่เลย ไม่ว่าจะมาจาก throw ไหน', async () => {
    global.fetch = () => Promise.reject(new Error(`fetch failed https://api.telegram.org/bot${FAKE_TOKEN}/getMe`));
    const r = await sender.getMe(FAKE_TOKEN);
    assert.equal(r.success, false);
    assert.ok(!r.error.includes(FAKE_TOKEN), `error ต้องไม่มี token: ${r.error}`);
  });

  it('sendMessage พร้อมปุ่ม → inline_keyboard ในตัว body', async () => {
    let seenBody;
    global.fetch = (url, opts) => { seenBody = JSON.parse(opts.body); return jsonRes({ ok: true, result: {} }); };
    await sender.sendMessage(FAKE_TOKEN, '1', 'hello', { buttons: [{ text: 'เปิด', url: 'https://x.test' }] });
    assert.deepEqual(seenBody.reply_markup, { inline_keyboard: [[{ text: 'เปิด', url: 'https://x.test' }]] });
  });

  it('sendPhoto (multipart) พร้อมปุ่ม → reply_markup แปลงกลับเป็น inline_keyboard ได้', async () => {
    let seenForm;
    global.fetch = (url, opts) => { seenForm = opts.body; return jsonRes({ ok: true, result: {} }); };
    await sender.sendPhoto(FAKE_TOKEN, '1', { buffer: Buffer.from('x'), filename: 'a.jpg' }, 'caption',
      { buttons: [{ text: 'ดู', url: 'https://x.test' }] });
    const parsed = JSON.parse(seenForm.get('reply_markup'));
    assert.deepEqual(parsed, { inline_keyboard: [[{ text: 'ดู', url: 'https://x.test' }]] });
  });

  it('escapeHtml กัน HTML injection ในข้อความ', () => {
    assert.equal(sender.escapeHtml('<b>a & b</b>'), '&lt;b&gt;a &amp; b&lt;/b&gt;');
  });

  it('sendMediaGroup: 1 รูปตกไปใช้ sendPhoto (Telegram ปฏิเสธ media group ที่มี 1 รูป)', async () => {
    let seenUrl;
    global.fetch = (url) => { seenUrl = url; return jsonRes({ ok: true, result: {} }); };
    await sender.sendMediaGroup(FAKE_TOKEN, '1', [{ buffer: Buffer.from('x'), filename: 'a.jpg' }]);
    assert.ok(seenUrl.includes('/sendPhoto'));
  });

  it('sendMediaGroup: 2+ รูป → attach://p0, attach://p1 ผูกกับไฟล์ที่แนบจริง', async () => {
    let seenForm;
    global.fetch = (url, opts) => { seenForm = opts.body; return jsonRes({ ok: true, result: [{}, {}] }); };
    await sender.sendMediaGroup(FAKE_TOKEN, '1', [
      { buffer: Buffer.from('x'), filename: 'a.jpg' },
      { buffer: Buffer.from('y'), filename: 'b.jpg' },
    ]);
    const media = JSON.parse(seenForm.get('media'));
    assert.equal(media.length, 2);
    assert.equal(media[0].media, 'attach://p0');
    assert.equal(media[1].media, 'attach://p1');
    assert.ok(seenForm.get('p0') instanceof Blob);
  });
});

// ============================================================
// telegramPoller — applyUpdate (pure) + _pollOnce
// ============================================================
describe('telegramPoller.applyUpdate', () => {
  const BOT_ID = 123456789;

  it('บอทถูกเพิ่มเข้ากลุ่ม (member) → upsert_pending', () => {
    const a = poller.applyUpdate({
      my_chat_member: {
        chat: { id: -100111, title: 'กลุ่มทดสอบ', type: 'supergroup' },
        new_chat_member: { user: { id: BOT_ID }, status: 'member' },
      },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'upsert_pending', chat_id: -100111, title: 'กลุ่มทดสอบ', chat_type: 'supergroup', added_by: null });
  });

  it('บอทถูกเลื่อนเป็น administrator → ยังนับเป็น upsert_pending', () => {
    const a = poller.applyUpdate({
      my_chat_member: {
        chat: { id: -100111, title: 'g', type: 'supergroup' },
        new_chat_member: { user: { id: BOT_ID }, status: 'administrator' },
      },
    }, BOT_ID);
    assert.equal(a.type, 'upsert_pending');
  });

  it('บอทถูกถอด (left/kicked) → bot_removed', () => {
    const a = poller.applyUpdate({
      my_chat_member: {
        chat: { id: -100111, type: 'supergroup' },
        new_chat_member: { user: { id: BOT_ID }, status: 'kicked' },
      },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'bot_removed', chat_id: -100111 });
  });

  it('my_chat_member ของ user อื่น (ไม่ใช่บอทนี้) → ไม่สนใจ', () => {
    const a = poller.applyUpdate({
      my_chat_member: {
        chat: { id: -100111, type: 'supergroup' },
        new_chat_member: { user: { id: 999 }, status: 'member' },
      },
    }, BOT_ID);
    assert.equal(a, null);
  });

  it('/start ในกลุ่ม → upsert_pending', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -100222, title: 'g2', type: 'group' }, text: '/start' },
    }, BOT_ID);
    assert.equal(a.type, 'upsert_pending');
    assert.equal(a.chat_id, -100222);
  });

  it('added_by ดึงจาก from.username ของคนที่เพิ่มบอท/พิมพ์ /start', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -100333, title: 'g3', type: 'group' }, text: '/start',
        from: { username: 'somchai_admin', first_name: 'Somchai' } },
    }, BOT_ID);
    assert.equal(a.added_by, '@somchai_admin');
  });

  it('/start ในแชทส่วนตัว → upsert_pending ใช้ชื่อจาก first_name', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: 555, type: 'private', first_name: 'Somchai' }, text: '/start' },
    }, BOT_ID);
    assert.equal(a.type, 'upsert_pending');
    assert.equal(a.title, 'Somchai');
  });

  it('ข้อความอื่นที่ไม่ใช่ /start → command (T4: ตัวจับ/สิทธิ์จริงอยู่ใน _handleCommandMessage, ดู telegram-t4-commands.test.js)', () => {
    const a = poller.applyUpdate({
      message: { chat: { id: -100222, type: 'group' }, text: 'สวัสดี' },
    }, BOT_ID);
    assert.deepEqual(a, { type: 'command', chat_id: -100222, chat_type: 'group', from_id: undefined, text: 'สวัสดี' });
  });

  it('ข้อความที่ chat.type ไม่รองรับ (channel_post ฯลฯ ไม่เข้าเงื่อนไขนี้อยู่แล้ว) ยังคง null เหมือนเดิม', () => {
    const a = poller.applyUpdate({ message: { chat: { id: 1, type: 'channel' }, text: 'x' } }, BOT_ID);
    assert.equal(a, null);
  });

  it('update ที่ไม่มี my_chat_member/message → null', () => {
    assert.equal(poller.applyUpdate({ channel_post: {} }, BOT_ID), null);
  });
});

function makePollerPool(initial = {}) {
  const pending = new Map(initial.pending || []);
  const calls = [];
  const pool = {
    query: async (sql, args = []) => {
      calls.push({ sql, args });
      if (/INSERT INTO telegram_pending/.test(sql)) {
        const [chatId, title, type] = args;
        const existing = pending.get(chatId);
        const status = existing && ['approved', 'blocked'].includes(existing.status) ? existing.status : 'pending';
        pending.set(chatId, { chat_id: chatId, title, type, status });
        return { rows: [] };
      }
      if (/UPDATE telegram_config SET poll_offset/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  return { pool, pending, calls };
}

describe('telegramPoller._pollOnce', () => {
  it('getUpdates สำเร็จ → upsert telegram_pending + เลื่อน offset ตาม update_id ล่าสุด', async () => {
    const { pool, pending } = makePollerPool();
    const stubSender = {
      getUpdates: async () => ({
        success: true,
        result: [
          { update_id: 10, message: { chat: { id: -1, type: 'group', title: 'g' }, text: '/start' } },
          { update_id: 11, message: { chat: { id: -1, type: 'group' }, text: 'hi' } },
        ],
      }),
    };
    const r = await poller._pollOnce(pool, stubSender, FAKE_TOKEN, 0);
    assert.equal(r.offset, 12);
    assert.equal(pending.get('-1').status, 'pending');
  });

  it('HTTP 409 → backoff ยาว ไม่แตะ offset', async () => {
    const { pool } = makePollerPool();
    const stubSender = { getUpdates: async () => ({ success: false, http_status: 409, error: 'conflict' }) };
    const r = await poller._pollOnce(pool, stubSender, FAKE_TOKEN, 5);
    assert.equal(r.offset, 5);
    assert.ok(r.ms >= 60000);
  });

  it('error อื่น → backoff สั้นกว่า', async () => {
    const { pool } = makePollerPool();
    const stubSender = { getUpdates: async () => ({ success: false, http_status: 500, error: '[getUpdates] boom' }) };
    const r = await poller._pollOnce(pool, stubSender, FAKE_TOKEN, 5);
    assert.equal(r.offset, 5);
    assert.ok(r.ms < 60000 && r.ms > 0);
  });

  it('DB ล้มกลางทาง (เช่น upsert พัง) → backoff ไม่ throw ออกไปให้ loop ตาย', async () => {
    const stubSender = {
      getUpdates: async () => ({
        success: true,
        result: [{ update_id: 1, message: { chat: { id: -1, type: 'group' }, text: '/start' } }],
      }),
    };
    const brokenPool = { query: async () => { throw new Error('connection terminated'); } };
    const r = await poller._pollOnce(brokenPool, stubSender, FAKE_TOKEN, 0);
    assert.equal(r.offset, 0, 'offset เดิมต้องไม่ขยับ — batch นี้ยังไม่ถูกล็อคว่าประมวลผลสำเร็จ');
    assert.ok(r.ms > 0 && r.ms < 60000);
  });
});

// ============================================================
// routes/telegram.js — full-request harness (no real express)
// ============================================================
function makeApp() {
  const registry = [];
  const app = {};
  for (const m of ['get', 'put', 'post', 'delete', 'patch']) {
    app[m] = (p, ...fns) => registry.push({ method: m, path: p, mws: fns });
  }
  return { app, registry };
}

function findRoute(registry, method, path) {
  return registry.find((r) => r.method === method && r.path === path);
}

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

async function call(registry, method, path, req) {
  const route = findRoute(registry, method, path);
  assert.ok(route, `route not registered: ${method} ${path}`);
  const handler = route.mws[route.mws.length - 1];
  const res = fakeRes();
  await handler(req, res);
  return res;
}

function makeDbState() {
  return {
    cfg: { enabled: false, bot_token_enc: null, bot_username: null, bot_name: null, chats: [] },
    pending: new Map(), // chat_id(string) -> row
    lineRecipients: [], // T3: mirror_of_line_id validation reads this
    alertLogsRows: [],  // last_failure query (GET /api/telegram-config)
  };
}

function makeDbPool(state) {
  const query = async (sql, args = []) => {
    if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) return { rows: [] };
    if (/SELECT enabled, bot_username, bot_name, bot_token_enc, chats FROM telegram_config/.test(sql)) {
      return { rows: [{ ...state.cfg }] };
    }
    // backfill lazy ของ bot_name (GET /api/telegram-config) — คนละ statement จาก PUT
    if (/UPDATE telegram_config SET bot_name = \$1 WHERE id = 1/.test(sql)) {
      state.cfg.bot_name = args[0];
      return { rows: [] };
    }
    // _findTelegramLastFailure() — bound ด้วย 200 แถวล่าสุดใน 24 ชม., filter ใน JS ไม่ใช่ SQL
    if (/FROM alert_logs/.test(sql)) {
      return { rows: state.alertLogsRows || [] };
    }
    if (/SELECT bot_username FROM telegram_config/.test(sql)) {
      return { rows: [{ bot_username: state.cfg.bot_username }] };
    }
    if (/SELECT bot_token_enc, chats FROM telegram_config/.test(sql)) {
      return { rows: [{ bot_token_enc: state.cfg.bot_token_enc, chats: state.cfg.chats }] };
    }
    if (/SELECT chats FROM telegram_config/.test(sql)) {
      return { rows: [{ chats: state.cfg.chats }] };
    }
    if (/UPDATE telegram_config SET/.test(sql)) {
      // Parse the column list order the route builds it in — mirror by keyword.
      let i = 0;
      if (/enabled = \$/.test(sql)) state.cfg.enabled = args[i++];
      if (/bot_token_enc = \$/.test(sql)) {
        state.cfg.bot_token_enc = args[i++]; state.cfg.bot_username = args[i++]; state.cfg.bot_name = args[i++];
      }
      if (/chats = \$/.test(sql)) state.cfg.chats = JSON.parse(args[i++]);
      return { rows: [] };
    }
    if (/SELECT chat_id FROM telegram_pending WHERE status = 'approved'/.test(sql)) {
      return { rows: [...state.pending.values()].filter((p) => p.status === 'approved').map((p) => ({ chat_id: p.chat_id }))};
    }
    // T3: mirror_of_line_id validation — PUT /api/telegram-config reads this
    if (/SELECT recipients FROM line_config WHERE id = 1/.test(sql)) {
      return { rows: [{ recipients: state.lineRecipients }] };
    }
    if (/SELECT \* FROM telegram_pending WHERE chat_id = \$1/.test(sql)) {
      const row = state.pending.get(args[0]);
      return { rows: row ? [row] : [] };
    }
    if (/UPDATE telegram_pending SET status = 'approved'/.test(sql)) {
      const row = state.pending.get(args[0]);
      if (row) { row.status = 'approved'; row.title = args[1]; }
      return { rows: [] };
    }
    if (/UPDATE telegram_pending SET status = 'ignored'\s+WHERE chat_id = \$1 AND status = 'pending'/.test(sql)) {
      const row = state.pending.get(args[0]);
      if (row && row.status === 'pending') { row.status = 'ignored'; return { rows: [{ ...row }] }; }
      return { rows: [] };
    }
    if (/UPDATE telegram_pending SET status = 'blocked'/.test(sql)) {
      const row = state.pending.get(args[0]);
      if (row && ['pending', 'ignored'].includes(row.status)) { row.status = 'blocked'; return { rows: [{ ...row }] }; }
      return { rows: [] };
    }
    if (/UPDATE telegram_pending SET status = 'ignored' WHERE chat_id = ANY/.test(sql)) {
      const removed = args[0] || [];
      for (const id of removed) {
        const row = state.pending.get(String(id));
        if (row && row.status === 'approved') row.status = 'ignored';
      }
      return { rows: [] };
    }
    if (/SELECT chat_id, title, type, first_seen, last_seen, status\s+FROM telegram_pending WHERE status = 'pending'/.test(sql)) {
      return { rows: [...state.pending.values()].filter((p) => p.status === 'pending') };
    }
    throw new Error('unhandled SQL in test pool: ' + sql);
  };
  const client = { query, release: () => {} };
  return { query, connect: async () => client };
}

function fakeAuth() {
  return {
    requireAdmin: 'SENTINEL_ADMIN',
    requireAdminOrAuditor: 'SENTINEL_ADMIN_OR_AUDITOR',
    requireAuth: 'SENTINEL_AUTH',
    logAudit: async () => {},
  };
}

describe('routes/telegram — auth wiring', () => {
  it('ทุก route ที่ไม่ใช่ GET config/QR ต้องผ่าน requireAdmin เสมอ', () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    telegramRoutes(app, {}, { auth, getIP: () => '127.0.0.1', routeError: () => {} });
    for (const r of registry) {
      if (r.method === 'get' && r.path === '/api/telegram-config') {
        assert.ok(r.mws.includes(auth.requireAdminOrAuditor), `${r.path} ต้องมี requireAdminOrAuditor`);
      } else if (r.method === 'get' && r.path === '/api/telegram-config/qr') {
        // เทียบเคียง GET /api/line-config/qr — ล็อกอินแล้วเปิดดู QR ได้ ไม่ต้อง admin
        assert.ok(r.mws.includes(auth.requireAuth), `${r.path} ต้องมี requireAuth`);
      } else {
        assert.ok(r.mws.includes(auth.requireAdmin), `${r.method} ${r.path} ต้องมี requireAdmin`);
      }
    }
  });
});

describe('routes/telegram — GET /api/telegram-config ไม่รั่ว token', () => {
  it('has_token=true แต่ไม่มี token/ciphertext/ชื่อคอลัมน์ token ในผลลัพธ์เลย', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    const plainToken = FAKE_TOKEN;
    state.cfg.bot_token_enc = encryptPii(plainToken);
    state.cfg.bot_username = 'vssvision_bot';
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });

    const res = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.has_token, true);
    const dump = JSON.stringify(res.body);
    assert.ok(!dump.includes(plainToken));
    assert.ok(!dump.includes(state.cfg.bot_token_enc));
    assert.ok(!dump.includes('bot_token_enc'));
  });
});

describe('routes/telegram — PUT validation', () => {
  it('รูปแบบ token ผิด → 400 ไม่เรียก fetch เลย (global.fetch โยน error ถ้าถูกเรียก)', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const pool = makeDbPool(makeDbState());
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config', { body: { bot_token: 'not-a-token' }, user: { role: 'admin' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /รูปแบบ/);
  });

  it('getMe ล้มเหลว → ไม่บันทึกอะไรเลย', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    global.fetch = () => jsonRes({ ok: false, description: 'Unauthorized' }, 401);
    const res = await call(registry, 'put', '/api/telegram-config',
      { body: { bot_token: FAKE_TOKEN }, user: { role: 'admin' } });
    assert.equal(res.statusCode, 400);
    assert.equal(state.cfg.bot_token_enc, null, 'ต้องไม่มีอะไรถูกเก็บลง DB');
    assert.equal(state.cfg.bot_username, null);
  });

  it('token ถูกต้อง + getMe สำเร็จ → เก็บแบบเข้ารหัส (enc:v1: prefix) ไม่ใช่ plaintext', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    global.fetch = () => jsonRes({ ok: true, result: { username: 'vssvision_bot' } });
    const res = await call(registry, 'put', '/api/telegram-config',
      { body: { bot_token: FAKE_TOKEN, enabled: true }, user: { role: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 200);
    assert.ok(state.cfg.bot_token_enc.startsWith('enc:v1:'));
    assert.notEqual(state.cfg.bot_token_enc, FAKE_TOKEN);
    assert.equal(state.cfg.bot_username, 'vssvision_bot');
    assert.equal(state.cfg.enabled, true);
  });

  it('chats: chat_id ที่ยังไม่ approved → 400', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const pool = makeDbPool(makeDbState());
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config',
      { body: { chats: [{ chat_id: '-100999', name: 'x' }] }, user: { role: 'admin' } });
    assert.equal(res.statusCode, 400);
  });

  it('chats: ถอดแชทออกจากรายการ → telegram_pending ของแชทนั้น reset เป็น ignored', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.pending.set('-100999', { chat_id: '-100999', title: 'g', type: 'group', status: 'approved' });
    state.cfg.chats = [{ chat_id: '-100999', name: 'g', type: 'group', enabled: true, lpr_enabled: true, lpr_sites: [], lpr_groups: [], mirror_of_line_id: null }];
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'put', '/api/telegram-config', { body: { chats: [] }, user: { role: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(state.pending.get('-100999').status, 'ignored');
  });
});

describe('routes/telegram — pending approve/ignore/block', () => {
  it('approve: ย้ายเข้า telegram_config.chats + telegram_pending.status = approved', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.pending.set('-100777', { chat_id: '-100777', title: 'หน่วยทดสอบ', type: 'group', status: 'pending' });
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/telegram/pending/:chatId/approve',
      { params: { chatId: '-100777' }, body: {}, user: { role: 'admin', id: 1, username: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(state.pending.get('-100777').status, 'approved');
    assert.equal(state.cfg.chats.length, 1);
    assert.equal(state.cfg.chats[0].chat_id, '-100777');
    assert.equal(state.cfg.chats[0].lpr_enabled, true);
  });

  it('ignore: pending → ignored', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.pending.set('1', { chat_id: '1', title: 'u', type: 'private', status: 'pending' });
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/telegram/pending/:chatId/ignore',
      { params: { chatId: '1' }, user: { role: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(state.pending.get('1').status, 'ignored');
  });

  it('block: จาก pending ได้, แต่จาก approved ไม่ได้ (ต้องถอดออกจาก chats ก่อน)', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.pending.set('1', { chat_id: '1', title: 'u', type: 'private', status: 'approved' });
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/telegram/pending/:chatId/block',
      { params: { chatId: '1' }, user: { role: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 404);
    assert.equal(state.pending.get('1').status, 'approved');
  });

  it('chat_id ที่ไม่ใช่ตัวเลข → 400', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const pool = makeDbPool(makeDbState());
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/telegram/pending/:chatId/ignore',
      { params: { chatId: 'not-a-number' }, user: { role: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 400);
  });

  it('approve: chat_id ผิดรูปแบบต้องไม่เรียก pool.connect() เลย (กัน client.release() ซ้ำสอง)', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const pool = { connect: async () => { throw new Error('pool.connect() ไม่ควรถูกเรียกเมื่อ chat_id ผิดรูปแบบ'); } };
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/telegram/pending/:chatId/approve',
      { params: { chatId: 'not-a-number' }, body: {}, user: { role: 'admin' }, headers: {} });
    assert.equal(res.statusCode, 400);
  });
});

describe('routes/telegram — POST test-send ยิงเฉพาะแชทที่อนุมัติแล้วเท่านั้น', () => {
  it('ไม่มี token ตั้งไว้ → 400', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const pool = makeDbPool(makeDbState());
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'post', '/api/telegram-config/test', { body: {}, user: { role: 'admin' } });
    assert.equal(res.statusCode, 400);
  });

  it('chat_id ที่ไม่ได้อยู่ใน chats (ยังไม่อนุมัติ) → 400 ไม่ส่ง', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_token_enc = encryptPii(FAKE_TOKEN);
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    let sendMessageCalled = false;
    global.fetch = (url) => {
      if (url.includes('/sendMessage')) sendMessageCalled = true;
      return jsonRes({ ok: true, result: { username: 'bot' } });
    };
    const res = await call(registry, 'post', '/api/telegram-config/test',
      { body: { chat_id: '-100777' }, user: { role: 'admin' } });
    assert.equal(res.statusCode, 400);
    assert.equal(sendMessageCalled, false, 'ห้ามยิง sendMessage ไปยังแชทที่ยังไม่อนุมัติ');
  });

  it('มี token + chat_id ที่อนุมัติแล้ว → เรียก getMe แล้ว sendMessage ไปยัง chat_id นั้น', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_token_enc = encryptPii(FAKE_TOKEN);
    state.cfg.chats = [{ chat_id: '-100777', name: 'g', type: 'group', enabled: true }];
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const seenUrls = [];
    global.fetch = (url) => { seenUrls.push(url); return jsonRes({ ok: true, result: { username: 'bot', message_id: 1 } }); };
    const res = await call(registry, 'post', '/api/telegram-config/test',
      { body: { chat_id: '-100777' }, user: { role: 'admin' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(seenUrls.some((u) => u.includes('/getMe')));
    assert.ok(seenUrls.some((u) => u.includes('/sendMessage')));
  });
});

// ============================================================
// GET /api/telegram-config/qr — เทียบเคียง GET /api/line-config/qr (migration 245)
// ============================================================
describe('routes/telegram — GET /api/telegram-config/qr', () => {
  it('ยังไม่ตั้ง bot_username → 404', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const pool = makeDbPool(makeDbState());
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/telegram-config/qr', {});
    assert.equal(res.statusCode, 404);
  });

  it('ตั้ง bot_username แล้ว → 200 ส่งภาพ PNG กลับ (Content-Type ตั้งผ่าน res.set)', async () => {
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_username = 'vssvision_bot';
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const route = findRoute(registry, 'get', '/api/telegram-config/qr');
    const handler = route.mws[route.mws.length - 1];
    const headers = {};
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      set(k, v) { headers[k] = v; return this; },
      send(buf) { this.body = buf; return this; },
      json(b) { this.body = b; return this; },
    };
    await handler({}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(headers['Content-Type'], 'image/png');
    assert.ok(Buffer.isBuffer(res.body) && res.body.length > 0);
  });
});

// ============================================================
// GET /api/telegram-config — bot_name backfill (lazy, ครั้งเดียวต่อ process) +
// last_failure (migration 245 + status parity กับหน้า LINE Config)
// ============================================================
describe('routes/telegram — GET /api/telegram-config: bot_name backfill + last_failure', () => {
  it('มี bot_name อยู่แล้ว → ไม่เรียก getMe เลย, คืน bot_name เดิมตรงๆ', async () => {
    telegramRoutes._resetBotNameBackfillFlag();
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_token_enc = encryptPii(FAKE_TOKEN);
    state.cfg.bot_name = 'VSS Vision Bot';
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    // fetch ยังโยน error เสมอ (default beforeEach) — ถ้าโค้ดเผลอเรียก getMe เทสต์นี้จะแดง
    const res = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.bot_name, 'VSS Vision Bot');
  });

  it('ไม่มี bot_name แต่มี token → backfill ครั้งแรกด้วย getMe สำเร็จ แล้วเก็บลง DB + คืนใน response', async () => {
    telegramRoutes._resetBotNameBackfillFlag();
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_token_enc = encryptPii(FAKE_TOKEN);
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    let fetchCalls = 0;
    global.fetch = () => { fetchCalls++; return jsonRes({ ok: true, result: { username: 'bot', first_name: 'VSS Vision Bot' } }); };

    const res1 = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.body.bot_name, 'VSS Vision Bot');
    assert.equal(state.cfg.bot_name, 'VSS Vision Bot', 'ต้อง backfill ลง DB ด้วย');
    assert.equal(fetchCalls, 1);

    // เรียกซ้ำรอบสอง — ต้อง "ไม่ยิง getMe อีก" (flag กันไว้แล้ว แม้ state.cfg.bot_name
    // จะมีค่าแล้วก็ตาม เส้นทางที่ป้องกันคือ flag ไม่ใช่แค่เช็คค่า)
    const res2 = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.bot_name, 'VSS Vision Bot');
    assert.equal(fetchCalls, 1, 'รอบสองต้องไม่เรียก getMe ซ้ำอีกเลย');
  });

  it('ไม่มี bot_name + getMe ล้มเหลว (เน็ตล่ม/token ผิด) → ไม่ throw, bot_name เป็น null, response ยังส่งได้ปกติ', async () => {
    telegramRoutes._resetBotNameBackfillFlag();
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_token_enc = encryptPii(FAKE_TOKEN);
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    global.fetch = () => { throw new Error('network down'); };   // จำลองเน็ตล่มระหว่าง backfill

    const res = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res.statusCode, 200, 'ต้องไม่ throw ออกมาเป็น 500 — backfill ล้มเหลวไม่บล็อก GET');
    assert.equal(res.body.bot_name, null);
    assert.equal(state.cfg.bot_name, null, 'ไม่มีอะไรถูกเขียนลง DB เมื่อ getMe ล้มเหลว');

    // รอบสอง — flag ถูกตั้งไปแล้วตั้งแต่ครั้งแรก (ไม่ว่าจะสำเร็จหรือไม่) ต้องไม่ลองซ้ำอีก
    global.fetch = () => { throw new Error('must not be called again'); };
    const res2 = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res2.statusCode, 200);
  });

  it('ไม่มีความล้มเหลว Telegram ใน 24 ชม.ล่าสุด → last_failure เป็น null', async () => {
    telegramRoutes._resetBotNameBackfillFlag();
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_name = 'x';   // ตัดขา backfill ออกไป ไม่เกี่ยวกับเทสต์นี้
    state.alertLogsRows = [
      { sent_at: new Date(), recipients_json: [{ channel: 'line', ok: false, name: 'สมชาย' }] },
      { sent_at: new Date(), recipients_json: [{ channel: 'telegram', ok: true, name: 'กลุ่มทดสอบ' }] },
    ];
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res.body.last_failure, null);
  });

  it('พบ recipients_json.channel=telegram, ok=false ล่าสุด → last_failure คืนเวลา+ชื่อแชท', async () => {
    telegramRoutes._resetBotNameBackfillFlag();
    const { app, registry } = makeApp();
    const auth = fakeAuth();
    const state = makeDbState();
    state.cfg.bot_name = 'x';
    const failAt = new Date('2026-09-25T06:26:00Z');
    state.alertLogsRows = [
      // แถวบนสุด = ใหม่สุด (ORDER BY id DESC) — ต้องได้แถวนี้ ไม่ใช่แถวเก่ากว่าข้างล่าง
      { sent_at: failAt, recipients_json: [{ channel: 'telegram', ok: false, name: 'กลุ่มทดสอบ รปภ.', error: 'blocked' }] },
      { sent_at: new Date('2026-09-25T05:00:00Z'), recipients_json: [{ channel: 'telegram', ok: false, name: 'กลุ่มเก่า', error: 'old' }] },
    ];
    const pool = makeDbPool(state);
    telegramRoutes(app, pool, { auth, getIP: () => '127.0.0.1', routeError: (res, e) => { throw e; } });
    const res = await call(registry, 'get', '/api/telegram-config', {});
    assert.equal(res.body.last_failure.name, 'กลุ่มทดสอบ รปภ.');
    assert.equal(new Date(res.body.last_failure.at).getTime(), failAt.getTime());
    assert.equal(res.body.last_failure.error, 'blocked');
  });
});
