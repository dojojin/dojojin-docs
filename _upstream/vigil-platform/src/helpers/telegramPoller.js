// ============================================================
// Vigil Platform — Telegram long-poll (getUpdates) → telegram_pending + คำสั่งแชท
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ที่มา: docs/reports/2026-09-24_telegram-plan.md — T1 (my_chat_member/start →
// telegram_pending) + T4 (ผูกผู้สั่งผ่าน /link <รหัส> แล้วรันคำสั่งผ่าน handleLineText
// ตัวเดียวกับ LINE — ดู src/helpers/lineCommandRun.js)
//
// รันเป็น "ตัวเดียว" ต่อ deployment (api-server เป็น pm2 fork เดียวอยู่แล้ว) —
// ถ้ามีสองตัว getUpdates ตัวที่สองจะได้ HTTP 409 Conflict จาก Telegram
'use strict';

const { decryptPii } = require('./blacklist-crypto');
const { hashLinkCode } = require('./telegramLinkCode');
const { handleLineText, loadOperatorByTelegramId, allowedHere } = require('./lineCommandRun');
const telegramCard = require('./telegramCard');
const fs = require('fs');
const path = require('path');
const { _looksLikeUrlFetchError } = require('./notifier');

const IDLE_MS = 30_000;   // ไม่ได้เปิด/ไม่มี token — เช็คซ้ำทุก 30s (เปิดจากหน้าเว็บแล้วเริ่ม poll ได้โดยไม่ต้อง restart)
const ERROR_MS = 10_000;  // error ทั่วไป
const CONFLICT_MS = 60_000; // 409 = มีอีกตัวกำลัง poll อยู่

// ── /link <รหัส>: กันเดารหัส — จำกัดครั้งต่อ Telegram user id (ไม่ใช่ต่อรหัส
// เพราะรหัสจริงมีแค่ชุดเดียวต่อผู้สั่ง ณ เวลาหนึ่ง) ในหน่วยความจำพอ — poller
// เป็น process เดียวอยู่แล้ว (ไม่ผ่าน restart จนกว่า 10 นาทีจะผ่านไปเองด้วย)
const LINK_MAX_ATTEMPTS = 5;
const LINK_WINDOW_MS = 10 * 60 * 1000;
const _linkAttempts = new Map();   // from_id -> { count, resetAt }
function _tooManyLinkAttempts(fromId) {
  const e = _linkAttempts.get(fromId);
  if (!e || e.resetAt < Date.now()) return false;
  return e.count >= LINK_MAX_ATTEMPTS;
}
function _recordLinkAttempt(fromId) {
  const now = Date.now();
  const e = _linkAttempts.get(fromId);
  if (!e || e.resetAt < now) { _linkAttempts.set(fromId, { count: 1, resetAt: now + LINK_WINDOW_MS }); return; }
  e.count++;
}
function _resetLinkAttempts() { _linkAttempts.clear(); }   // เทสต์เท่านั้น

// สถานะให้ GET /api/telegram-config อ่านไปแสดงผล (ไม่ผ่าน DB — กันหน้าตั้งค่า
// ต้องรอ round-trip อีกรอบแค่จะบอกว่า poller ทำงานอยู่ไหม)
const state = { running: false, last_ok_at: null, last_error: null, conflict: false };

// ── ตัวช่วยล้วน — ไม่แตะ DB/network เลยแม้แต่นิดเดียว จึงเทสต์ตรงๆ ได้ ──
// คืน action object ให้ caller ไปตัดสินใจเขียน DB เอง — ไม่มี side effect ในนี้
function _who(user) {
  if (!user) return null;
  return user.username ? '@' + user.username : [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
}

function applyUpdate(update, botId) {
  if (update.my_chat_member) {
    const cm = update.my_chat_member;
    if (!cm.new_chat_member || cm.new_chat_member.user?.id !== botId) return null; // ไม่เกี่ยวกับบอทนี้
    const chat = cm.chat;
    const status = cm.new_chat_member.status;
    if (status === 'member' || status === 'administrator') {
      return {
        type: 'upsert_pending', chat_id: chat.id,
        title: chat.title || chat.username || String(chat.id), chat_type: chat.type,
        added_by: _who(cm.from),
      };
    }
    if (status === 'left' || status === 'kicked') {
      return { type: 'bot_removed', chat_id: chat.id };
    }
    return null;
  }
  if (update.message) {
    const msg = update.message;
    const chat = msg.chat;
    // กลุ่มถูกอัปเกรดเป็น supergroup — Telegram ส่ง service message สองใบ: ใบแรกใน
    // กลุ่มเดิม (chat.id เก่า + migrate_to_chat_id = id ใหม่) ใบที่สองในกลุ่มใหม่
    // (chat.id ใหม่ + migrate_from_chat_id = id เก่า) ใบไหนมาถึงก่อนก็ได้ครบคู่เหมือนกัน
    // ต้องเช็คก่อนกรอง chat.type ข้างล่าง — ไม่ต้องพึ่งว่า type ตอนนั้นเป็นอะไร
    if (msg.migrate_to_chat_id) {
      return { type: 'chat_migrated', old_chat_id: chat.id, new_chat_id: msg.migrate_to_chat_id };
    }
    if (msg.migrate_from_chat_id) {
      return { type: 'chat_migrated', old_chat_id: msg.migrate_from_chat_id, new_chat_id: chat.id };
    }
    if (!['group', 'supergroup', 'private'].includes(chat.type)) return null;
    // บอทอื่นพิมพ์ในกลุ่ม (เช่น บอทสรุปข้อความ) ต้องไม่ถูกตีความเป็นคำสั่ง/ความพยายาม
    // ผูกบัญชีเด็ดขาด — เงื่อนไขนี้มาก่อนทุกอย่างข้างล่าง (T4)
    if (msg.from?.is_bot) return null;
    if (typeof msg.text === 'string' && msg.text.startsWith('/start')) {
      const title = chat.title
        || [chat.first_name, chat.last_name].filter(Boolean).join(' ')
        || chat.username || String(chat.id);
      return { type: 'upsert_pending', chat_id: chat.id, title, chat_type: chat.type, added_by: _who(msg.from) };
    }
    // T4 — ผูกบัญชี: "/link 123456" (รับ "/link@botname 123456" ด้วย) ต้องเป็น
    // แชทส่วนตัวเท่านั้น — พิมพ์รหัสในกลุ่มคือให้คนอื่นในกลุ่มเห็นรหัสไปด้วย
    if (typeof msg.text === 'string') {
      const linkMatch = msg.text.trim().match(/^\/link(?:@\S+)?\s+(\d{4,8})\b/i);
      if (linkMatch) {
        if (chat.type !== 'private') return { type: 'link_wrong_place', chat_id: chat.id };
        return { type: 'link_attempt', chat_id: chat.id, from_id: msg.from?.id, code: linkMatch[1] };
      }
      // T4 — คำสั่งทั่วไป: ตัวจับ/ตัวกรองสิทธิ์อยู่ใน handleLineText (lineCommandRun.js)
      // อยู่แล้ว ที่นี่แค่ส่งรูปดิบต่อไป — ไม่ query DB ในฟังก์ชันบริสุทธิ์นี้เด็ดขาด
      return { type: 'command', chat_id: chat.id, chat_type: chat.type, from_id: msg.from?.id, text: msg.text };
    }
    return { type: 'message_ignored', chat_id: chat.id };
  }
  return null;
}

// สถานะ 'approved'/'blocked' เดิมต้องไม่ถูกเขียนทับกลับเป็น 'pending' เมื่อบอทถูก
// เพิ่มซ้ำหรือมีคนพิมพ์ /start ซ้ำ (เหมือน webhook ของ LINE — pending_recipients)
async function _upsertPending(pool, action) {
  await pool.query(
    `INSERT INTO telegram_pending (chat_id, title, type, added_by, status, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, 'pending', NOW(), NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       title = EXCLUDED.title,
       type = EXCLUDED.type,
       added_by = COALESCE(EXCLUDED.added_by, telegram_pending.added_by),
       last_seen = NOW(),
       status = CASE WHEN telegram_pending.status IN ('approved', 'blocked')
                     THEN telegram_pending.status ELSE 'pending' END`,
    [String(action.chat_id), action.title, action.chat_type, action.added_by || null]
  );
}

// group → supergroup อัปเกรด: chat_id เปลี่ยนแบบถาวร (ไม่ใช่แค่ rename) — ต้องแก้
// ทั้ง telegram_config.chats (ถ้าแชทนี้ถูกอนุมัติ/ตั้งไว้แล้ว) และ telegram_pending
// (สถานะ approve/ignore/block เดิมต้องติดไปกับ id ใหม่ ไม่ใช่กลับไปเป็น pending)
async function _migrateChatId(pool, oldChatId, newChatId) {
  const oldStr = String(oldChatId), newStr = String(newChatId);
  console.log(`[telegram-poller] group migrated to supergroup: ${oldStr} → ${newStr}`);
  await pool.query(
    `UPDATE telegram_config SET chats = (
       SELECT COALESCE(jsonb_agg(
         CASE WHEN elem->>'chat_id' = $1
              THEN jsonb_set(elem, '{chat_id}', to_jsonb($2::text))
              ELSE elem END), '[]'::jsonb)
         FROM jsonb_array_elements(chats) elem
     ), updated_at = NOW()
     WHERE id = 1`,
    [oldStr, newStr]
  );
  await pool.query(
    `UPDATE telegram_pending SET chat_id = $2::bigint, last_seen = NOW() WHERE chat_id = $1::bigint`,
    [oldStr, newStr]
  );
}

// ── T4: /link <รหัส> — ค้นรหัส (hash) ที่ยังไม่หมดอายุ แล้วผูก telegram_user_id
// เข้ากับผู้สั่งแถวนั้น · รหัสใช้ได้ครั้งเดียว (ล้างทิ้งทันทีไม่ว่าผลจะเป็นอย่างไร
// ยกเว้นกรณีเดารหัสผิด ซึ่งไม่ล้าง — รหัสจริงต้องยังพิมพ์ถูกได้จนกว่าจะหมดอายุ)
async function _handleLinkAttempt(pool, sender, token, action) {
  if (!sender?.sendMessage || !token || !action.from_id) return;
  const say = (text) => sender.sendMessage(token, action.chat_id, sender.escapeHtml(text)).catch(() => {});
  if (_tooManyLinkAttempts(action.from_id)) {
    await say('ลองรหัสผิดถี่เกินไป รอสักครู่แล้วลองใหม่');
    return;
  }
  _recordLinkAttempt(action.from_id);
  const hash = hashLinkCode(action.code);
  const { rows } = await pool.query(
    `SELECT line_user_id FROM line_operators
      WHERE telegram_link_code = $1 AND telegram_link_expires > NOW()`, [hash]);
  if (!rows[0]) {
    await say('รหัสไม่ถูกต้องหรือหมดอายุแล้ว ขอรหัสใหม่จากผู้ดูแลระบบ');
    return;
  }
  try {
    await pool.query(
      `UPDATE line_operators SET telegram_user_id = $2, telegram_link_code = NULL, telegram_link_expires = NULL
        WHERE line_user_id = $1`, [rows[0].line_user_id, action.from_id]);
  } catch (e) {
    // unique(telegram_user_id) ชน — บัญชี Telegram นี้ผูกกับผู้สั่งอื่นอยู่แล้ว
    if (e.code === '23505') { await say('บัญชี Telegram นี้ผูกกับผู้สั่งคนอื่นอยู่แล้ว ติดต่อผู้ดูแลระบบ'); return; }
    throw e;
  }
  await say('ผูกบัญชี Telegram สำเร็จแล้ว พิมพ์คำสั่งได้เลย');
}

// ตัด "/" นำหน้าและ "@<botusername>" ท้ายคำแรกออก — ทำให้ทั้ง "ยอดวันนี้" และ
// "/ยอดวันนี้@vssvision_bot" (รูปแบบที่ Telegram ต่อท้ายให้เองเวลากดจากเมนูคำสั่งใน
// กลุ่ม privacy mode) จับคำสั่งได้เหมือนกัน — ไม่แตะคำที่เหลือของประโยค
function _stripSlashMention(text, botUsername) {
  const t = String(text == null ? '' : text);
  const sp = t.search(/\s/);
  let first = sp === -1 ? t : t.slice(0, sp);
  const rest = sp === -1 ? '' : t.slice(sp);
  if (first.startsWith('/')) first = first.slice(1);
  if (botUsername) {
    const suffix = '@' + String(botUsername);
    if (first.toLowerCase().endsWith(suffix.toLowerCase())) first = first.slice(0, first.length - suffix.length);
  } else {
    first = first.replace(/@\S+$/, '');   // ไม่รู้ชื่อบอท (ยังไม่เคย getMe) — ตัดรูปแบบทั่วไปแทน
  }
  return (first + rest).trim();
}

// ── T4: คำสั่งทั่วไป — หา operator จาก telegram_user_id → ตรวจห้อง/สิทธิ์ →
// รัน handleLineText ตัวเดียวกับ LINE (deps ชุดเดียวกัน: pool/auth/baseUrl/onAck)
async function _handleCommandMessage(pool, sender, token, action, ctx = {}) {
  if (!sender?.sendMessage || !token) return;
  const op = await loadOperatorByTelegramId(pool, action.from_id);
  if (!op) return;   // ไม่ใช่ผู้สั่งที่ผูกไว้ — เงียบเหมือน LINE (เห็นบทสนทนาปกติในกลุ่มตลอด)

  const sourceId = `tg:${action.chat_id}`;
  if (action.chat_type !== 'private') {
    // กลุ่ม/supergroup ต้องเป็นแชทที่แอดมินอนุมัติแล้วเท่านั้น (telegram_config.chats)
    // — ผูกบัญชีสำเร็จไม่ได้แปลว่าสั่งได้ทุกกลุ่มที่บอทอยู่
    const { rows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
    const chats = Array.isArray(rows[0]?.chats) ? rows[0].chats : [];
    const chat = chats.find((c) => String(c.chat_id) === String(action.chat_id));
    if (!chat || chat.enabled === false) return;
  }
  // allow_in ของผู้สั่งใช้ชุดเดียวกับ LINE (list ของ sourceId ที่สั่งได้) — handleLineText
  // เช็คซ้ำอีกชั้นอยู่แล้วและ log 'denied' ให้ แต่เช็คที่นี่ก่อนกันไม่ต้องเรียก handleLineText
  // เปล่า ๆ เมื่อรู้ผลได้จากข้อมูลที่มีอยู่แล้ว
  if (!allowedHere(op, sourceId)) return;

  const text = _stripSlashMention(action.text, ctx.botUsername);
  if (!text) return;

  const deps = {
    pool, auth: ctx.auth, baseUrl: ctx.baseUrl,
    onAck: async (ackText) => {
      await sender.sendMessage(token, action.chat_id, sender.escapeHtml(ackText || 'กำลังค้นหา…')).catch(() => {});
    },
  };
  let r;
  try {
    r = await handleLineText(deps, { text, lineUserId: op.line_user_id, sourceType: 'telegram', sourceId, op });
  } catch (e) {
    console.error('[telegram-poller] handleLineText error:', e.message);
    return;
  }
  if (r.action !== 'reply') return;
  if (r.card) {
    const { caption } = telegramCard.fromAnswerCard(r.card);
    await sender.sendMessage(token, action.chat_id, caption).catch(() => {});
    // คำตอบที่มีรูป (ค้นหาใบหน้า / รูปรถ ฯลฯ) — LINE ได้ carousel ≤11 ใบ Telegram ส่ง
    // เป็นอัลบั้มตามหลังข้อความ (Bot API รับ ≤10 ต่ออัลบั้ม)
    if (Array.isArray(r.card.photos) && r.card.photos.length) {
      await _sendAnswerPhotos(sender, token, action.chat_id, r.card.photos);
    }
  } else if (r.text) {
    await sender.sendMessage(token, action.chat_id, sender.escapeHtml(String(r.text))).catch(() => {});
  }
}

// รูปอยู่บนเครื่องนี้ = อัปโหลดไฟล์ตรง (ไม่พึ่งให้ Telegram มาดึงลิงก์ซึ่งเคยล้ม
// WEBPAGE_CURL_FAILED) · อยู่ที่ edge = ใช้ลิงก์เซ็นชื่อ แล้วถ้า Telegram ดึงไม่ได้
// ค่อยดาวน์โหลดมาอัปโหลดเอง · ล้มก็แค่ log ข้อความหลักส่งไปแล้ว
async function _sendAnswerPhotos(sender, token, chatId, photos) {
  if (!sender?.sendMediaGroup) return;
  const base = require('./snapshotDir').snapshotDir();
  const items = photos.slice(0, 10).map((p) => {
    const cap = [p.title, p.caption].filter(Boolean).join('\n');
    const item = cap ? { captionHtml: sender.escapeHtml(cap) } : {};
    const abs = p.file ? path.join(base, String(p.file).replace(/^\/+/, '')) : null;
    if (abs && abs.startsWith(base) && fs.existsSync(abs)) item.path = abs;
    else if (p.url) item.url = p.url;
    return item;
  }).filter((i) => i.path || i.url);
  if (!items.length) return;
  let r = await sender.sendMediaGroup(token, chatId, items).catch((e) => ({ success: false, error: e.message }));
  if (!r.success && _looksLikeUrlFetchError(r.error)) {
    const retry = [];
    for (const it of items) {
      if (!it.url) { retry.push(it); continue; }
      try {
        const res = await fetch(it.url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        retry.push({ captionHtml: it.captionHtml, buffer: Buffer.from(await res.arrayBuffer()), filename: 'photo.jpg' });
      } catch { /* ข้ามรูปที่ดาวน์โหลดไม่ได้ */ }
    }
    if (retry.length) r = await sender.sendMediaGroup(token, chatId, retry).catch((e) => ({ success: false, error: e.message }));
  }
  if (!r.success) console.warn('[telegram-poller] ส่งรูปคำตอบไม่สำเร็จ:', r.error);
}

async function _handleUpdate(pool, update, botId, sender, token, ctx = {}) {
  const action = applyUpdate(update, botId);
  if (!action) return;
  if (action.type === 'upsert_pending') await _upsertPending(pool, action);
  else if (action.type === 'bot_removed') console.log(`[telegram-poller] bot removed from chat ${action.chat_id}`);
  else if (action.type === 'chat_migrated') await _migrateChatId(pool, action.old_chat_id, action.new_chat_id);
  else if (action.type === 'link_attempt') await _handleLinkAttempt(pool, sender, token, action);
  else if (action.type === 'link_wrong_place') {
    if (sender?.sendMessage && token) {
      await sender.sendMessage(token, action.chat_id,
        sender.escapeHtml('ผูกบัญชีต้องทักบอทเป็นการส่วนตัวเท่านั้น (แชทเดี่ยว ไม่ใช่ในกลุ่ม)')).catch(() => {});
    }
  } else if (action.type === 'command') {
    await _handleCommandMessage(pool, sender, token, action, ctx).catch((e) =>
      console.error('[telegram-poller] command error:', e.message));
  }
  // 'message_ignored' → ไม่ทำอะไร
}

function _botIdFromToken(token) {
  const n = parseInt(String(token).split(':')[0], 10);
  return Number.isFinite(n) ? n : null;
}

// หนึ่งรอบ getUpdates + เขียน telegram_pending + เลื่อน offset — แยกออกมาเพื่อ
// เทสต์ได้โดยไม่ต้องพึ่ง setTimeout loop จริง
// ctx (T4, optional — ไม่ใส่ก็ยังทำงานเหมือน T1/T2/T3 เป๊ะ): { auth, baseUrl, botUsername }
// auth/baseUrl ส่งต่อให้ handleLineText() ยิง endpoint ในนามผู้สั่งจริง (เหมือน LINE)
async function _pollOnce(pool, sender, token, offset, ctx = {}) {
  // ครอบทั้งก้อนด้วย try — ถ้า DB ล้มกลางทาง (upsert/UPDATE offset) ต้อง backoff
  // แล้ววนต่อ ไม่ใช่ throw ออกไปให้ loop ข้างนอกตายค้างจนกว่าจะ restart process
  // (การ upsert ซ้ำ batch เดิมปลอดภัยอยู่แล้ว — ON CONFLICT DO UPDATE เป็น idempotent)
  try {
    const botId = _botIdFromToken(token);
    const res = await sender.getUpdates(token, offset, 25);
    if (!res.success) {
      if (res.http_status === 409) {
        if (!state.conflict) console.warn('[telegram-poller] HTTP 409 — poller อีกตัวกำลังทำงานอยู่');
        state.conflict = true;
      } else {
        state.last_error = res.error || 'getUpdates failed';
        console.error('[telegram-poller]', state.last_error);
      }
      return { offset, ms: res.http_status === 409 ? CONFLICT_MS : ERROR_MS };
    }
    state.conflict = false;
    state.last_error = null;
    state.last_ok_at = new Date().toISOString();
    const updates = res.result || [];
    for (const u of updates) await _handleUpdate(pool, u, botId, sender, token, ctx);
    const nextOffset = updates.length ? updates[updates.length - 1].update_id + 1 : offset;
    if (nextOffset !== offset) {
      await pool.query('UPDATE telegram_config SET poll_offset = $1 WHERE id = 1', [nextOffset]);
    }
    return { offset: nextOffset, ms: 0 };
  } catch (e) {
    state.last_error = e.message;
    console.error('[telegram-poller] pollOnce error:', e.message);
    return { offset, ms: ERROR_MS };
  }
}

// auth/baseUrl (T4): ส่งต่อให้ handleLineText() ยิง endpoint loopback ในนามผู้สั่งจริง
// เหมือนที่ routes/line.js ทำให้ webhook ของ LINE — ไม่ใส่มาก็ยัง poll ได้ปกติ (T1-T3)
// แค่คำสั่งแชทจะหา operator ไม่เจอ deps.auth แล้ว handleLineText โยน error ซึ่ง
// _handleCommandMessage ดักไว้แล้ว (เงียบ + log อย่างเดียว ไม่ทำ process ตาย)
function startTelegramPoller(pool, { sender = require('./telegramSender'), auth, baseUrl } = {}) {
  let stopped = false;
  state.running = true;

  (async () => {
    let offset = 0;
    while (!stopped) {
      let token = null;
      let botUsername = null;
      try {
        const { rows } = await pool.query(
          'SELECT enabled, bot_token_enc, bot_username, poll_offset FROM telegram_config WHERE id = 1');
        const cfg = rows[0];
        if (cfg?.enabled && cfg.bot_token_enc) {
          token = decryptPii(cfg.bot_token_enc);
          botUsername = cfg.bot_username || null;
          // `|| offset` เดิมทำให้ poll_offset=0 (รีเซ็ตจริง) ถูกมองว่า falsy แล้ว
          // ใช้ offset ที่ค้างในหน่วยความจำแทน — reset ที่ตั้งใจให้ย้อนอ่านใหม่
          // จะไม่มีผลจนกว่า process จะ restart
          const n = Number(cfg.poll_offset);
          offset = Number.isFinite(n) ? n : offset;
        }
      } catch (e) {
        console.error('[telegram-poller] อ่านค่าตั้งไม่สำเร็จ:', e.message);
      }

      if (!token) {
        await _sleep(IDLE_MS);
        continue;
      }

      const { offset: next, ms } = await _pollOnce(pool, sender, token, offset, { auth, baseUrl, botUsername });
      offset = next;
      if (ms) await _sleep(ms);
    }
    state.running = false;
  })().catch((e) => { console.error('[telegram-poller] loop crashed:', e.message); state.running = false; });

  return () => { stopped = true; };
}

// unref'd — ไม่ยึด event loop ให้ process ค้างตอน shutdown/เทสต์
function _sleep(ms) {
  return new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });
}

module.exports = {
  startTelegramPoller, applyUpdate, _pollOnce, state,
  _stripSlashMention, _handleLinkAttempt, _handleCommandMessage, _resetLinkAttempts,
};
