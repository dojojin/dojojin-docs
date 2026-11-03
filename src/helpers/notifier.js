// ============================================================
// Vigil Platform — Telegram delivery leg (shared by LPR / GuruSquare alerts)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T2) — เพิ่มขาส่งเข้า
// Telegram ให้ sendLprAlert()/sendGsAlarm() เรียกใช้เพิ่มจากขา LINE เดิม (ไม่แตะ)
//
// รับ chats ที่คัดกรองมาแล้ว (selectRecipients ของ lprLineAlert.js ใช้ตัวกรองเดียว
// กับ LINE — ชี้ที่ไหนเลือกจึงอยู่ที่ผู้เรียก ไม่ใช่ที่นี่) แปลง images (path สัมพัทธ์
// กับ SNAPSHOT_DIR แบบเดียวกับที่ LINE ใช้) เป็นลิงก์เซ็นชื่อสาธารณะ แล้วส่ง
//
// ไม่ throw เด็ดขาด — เดินคู่กับ sendAlert()/pushLineMessage ของ LINE ซึ่งไม่ throw
// เหมือนกัน (ผู้เรียกไม่ต้องมี try/catch รอบการส่งจริง)
'use strict';

const path = require('path');
const { decryptPii } = require('./blacklist-crypto');
// require เป็น object (ไม่ destructure) — ให้เทสต์ monkey-patch
// signedImage.usableSignedUrl ได้โดยไม่ต้องเพิ่มพารามิเตอร์ฉีดเข้ามาที่ sendTelegramLeg
// (สัญญาของ signature ยึดตาม spec เป๊ะ ไม่มี usableSignedUrl ให้ฉีด)
const signedImage = require('./signedImage');

const DOWNLOAD_TIMEOUT_MS = 15_000;

// ข้อความ error ที่บอกว่า Telegram ดึง URL ไม่สำเร็จ (ต่างจาก error อื่น เช่น
// chat ไม่ถูกต้อง/บอทถูกเตะออก ซึ่ง retry ด้วยไฟล์ก็ไม่ช่วย)
function _looksLikeUrlFetchError(msg) {
  // WEBPAGE_CURL_FAILED / WEBPAGE_MEDIA_EMPTY = Telegram ดึงลิงก์รูปไม่สำเร็จฝั่งมัน
  // (เจอจริง 2026-09-25 ภาพอ้างอิงใบหน้า รูปที่ 3 ของอัลบั้ม ทั้งที่ลิงก์ตอบ 200) —
  // ไม่จับตัวนี้ = ไม่ลองอัปโหลดไฟล์เอง การ์ดทั้งใบหายไปทุกแชท
  return /http url content|wrong file identifier|wrong remote file identifier|webpage_curl_failed|webpage_media_empty/i.test(String(msg || ''));
}

async function _downloadAsBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  let filename = 'image.jpg';
  try { filename = path.basename(new URL(url).pathname) || filename; } catch { /* keep default */ }
  return { buffer, filename };
}

// ดาวน์โหลดครั้งเดียว ใช้ซ้ำได้ทุกแชท (URL ชุดเดียวกันทุกคนในการแจ้งเตือนใบเดียว)
function _bufferCache(urls) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = Promise.all(urls.map((u) => _downloadAsBuffer(u))).catch((e) => {
        console.error('[notifier] ดาวน์โหลดรูปมาส่งเป็นไฟล์ไม่สำเร็จ:', e.message);
        return null;
      });
    }
    return promise;
  };
}

async function _sendToOneChat({ sender, token, chatId, photoUrls, card, getBuffers }) {
  let r;
  if (!photoUrls.length) {
    r = await sender.sendMessage(token, chatId, card.caption);
  } else if (photoUrls.length === 1) {
    r = await sender.sendPhoto(token, chatId, { url: photoUrls[0] }, card.caption);
  } else {
    const items = photoUrls.map((url, i) => ({ url, captionHtml: i === 0 ? card.caption : undefined }));
    r = await sender.sendMediaGroup(token, chatId, items);
  }

  if (!r.success && _looksLikeUrlFetchError(r.error)) {
    const buffers = await getBuffers();
    if (buffers) {
      if (buffers.length === 1) {
        r = await sender.sendPhoto(token, chatId, buffers[0], card.caption);
      } else {
        const items = buffers.map((b, i) => ({ ...b, captionHtml: i === 0 ? card.caption : undefined }));
        r = await sender.sendMediaGroup(token, chatId, items);
      }
    }
  }
  return r;
}

/**
 * sendTelegramLeg — ส่งการ์ดหนึ่งใบเข้าหลายแชท Telegram
 *
 * images = { plate, scene, ref } — path สัมพัทธ์กับ SNAPSHOT_DIR (สตริงเดียวกับที่
 * LINE ใช้: lp.plate_image / event.snapshot_filename / refImage) ลำดับภาพในอัลบั้ม
 * = ป้าย → ฉาก → อ้างอิง (ตรงกับ LINE) — ไม่มีไฟล์/เซ็นไม่สำเร็จ = ข้ามภาพนั้นไปเงียบ ๆ
 *
 * แต่ละค่าเป็นสตริง (kind='img' / SNAPSHOT_DIR ค่าเริ่มต้น — LPR/GuruSquare ใช้แบบนี้
 * ทั้งหมด) หรือ `{ path, kind }` เมื่อไฟล์อยู่คนละโฟลเดอร์ (T2b: ภาพอ้างอิงใบหน้าจาก
 * บัญชีดำอยู่ใต้ PHOTO_DIR = kind 'ref' — ส่ง kind ผิดได้ลิงก์ 404 เงียบ ๆ เพราะลายเซ็น
 * ผูกกับ kind ด้วย ดู helpers/signedImage.js)
 */
async function sendTelegramLeg({ pool, sender = require('./telegramSender'), chats, card, images, signedTtlSec }) {
  if (!Array.isArray(chats) || !chats.length) return [];

  let cfg;
  try {
    const { rows } = await pool.query('SELECT enabled, bot_token_enc FROM telegram_config WHERE id = 1');
    cfg = rows[0];
  } catch (e) { console.error('[notifier] อ่านค่าตั้ง telegram_config ไม่สำเร็จ:', e.message); return []; }
  if (!cfg?.enabled || !cfg.bot_token_enc) return [];

  let token;
  try { token = decryptPii(cfg.bot_token_enc); }
  catch (e) { console.error('[notifier] ถอดรหัส telegram token ไม่สำเร็จ:', e.message); return []; }
  if (!token) return [];

  // ป้าย → ฉาก → อ้างอิง เสมอ (ลำดับเดียวกับที่ LINE ใช้) — ไม่มีไฟล์/preflight ไม่ผ่าน
  // = ข้ามรูปนั้น ไม่ใช่ข้ามทั้งใบ
  const photoUrls = [];
  for (const key of ['plate', 'scene', 'ref']) {
    const spec = images?.[key];
    if (!spec) continue;
    const rel = typeof spec === 'string' ? spec : spec.path;
    const kind = typeof spec === 'string' ? 'img' : (spec.kind || 'img');
    if (!rel) continue;
    try {
      const { url } = await signedImage.usableSignedUrl(rel, signedTtlSec, kind);
      if (url) photoUrls.push(url);
    } catch (e) { console.warn(`[notifier] สร้างลิงก์รูป ${key} ไม่สำเร็จ:`, e.message); }
  }
  const getBuffers = _bufferCache(photoUrls);

  const results = [];
  for (const chat of chats) {
    const chatId = chat.chat_id;
    let r;
    try {
      r = await _sendToOneChat({ sender, token, chatId, photoUrls, card, getBuffers });
    } catch (e) { r = { success: false, error: e.message }; }

    if (r.success && card.overflow) {
      await sender.sendMessage(token, chatId, card.overflow).catch((e) => e);
    }

    results.push({
      name: chat.name || String(chatId),
      type: chat.type || null,
      id_tail: String(chatId).slice(-4),
      ok: !!r.success,
      error: r.success ? null : (r.error || null),
      channel: 'telegram',
      message_id: r.message_id ?? null,
    });
  }
  return results;
}

// ── T3: หา chat Telegram ที่ต้องสำรองให้ เมื่อ LINE ปฏิเสธด้วย "monthly limit" ──
// lineResults ต้องเป็น recipientsLog ที่มาจาก recipients ชุดเดียวกัน (sendAlert()/
// _pushToAll() สร้าง log ทีละรายการต่อผู้รับ **ตามลำดับเดิมเป๊ะ** เสมอ — ดู
// line-sender.js sendAlert() และ alert-engine.js _pushToAll()) จึงจับคู่ด้วย index
// ได้โดยไม่ต้องพึ่งฟิลด์ id ใน log (ซึ่งมีแค่ name/id_tail ไม่มี id เต็ม)
//
// ไม่พบ mirror ของผู้รับที่โดน limit = ข้ามเงียบ ๆ ไม่ได้ — log ให้เห็นว่ามีคนโดน
// แล้วไม่มีใครมารับต่อ ไม่งั้นดีบักไม่ออกว่าทำไมไม่มีการ์ด Telegram โผล่มา
function pickFallbackChats(lineResults, recipients, chats) {
  const out = [];
  const seen = new Set();
  const n = Math.min((lineResults || []).length, (recipients || []).length);
  for (let i = 0; i < n; i++) {
    const r = lineResults[i];
    if (!r || r.ok || !/monthly limit/i.test(r.error || '')) continue;
    const recipient = recipients[i];
    const recipientId = recipient && recipient.id != null ? String(recipient.id) : null;
    if (!recipientId) continue;
    const mirrors = (chats || []).filter((c) =>
      c && c.enabled !== false && c.mirror_of_line_id != null && String(c.mirror_of_line_id) === recipientId);
    if (!mirrors.length) {
      console.warn(`[notifier] T3: ${recipient.name || recipientId} โดนโควตา LINE เต็ม แต่ไม่มีแชท Telegram ผูกไว้ (mirror_of_line_id)`);
      continue;
    }
    for (const c of mirrors) {
      if (seen.has(c.chat_id)) continue;
      seen.add(c.chat_id);
      out.push(c);
    }
  }
  return out;
}

module.exports = { sendTelegramLeg, pickFallbackChats, _looksLikeUrlFetchError };
