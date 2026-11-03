// ============================================================
// Vigil Platform — Telegram Bot API sender
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T1) — Telegram เป็นช่องทาง
// สำรอง/เพิ่มเติมของ LINE ใช้ global fetch/FormData/Blob ของ Node 22 ไม่เพิ่ม
// dependency ใหม่ (ponytail: bot API เป็น REST ธรรมดา ไม่คุ้มลาก SDK)
//
// สัญญาเดียวกับ line-sender.js: **ไม่ throw** เสมอ คืน
// {success, error, http_status, retry_after, message_id, result}
//
// 🔒 token อยู่ใน path ของ Bot API (https://api.telegram.org/bot<token>/method) —
// ห้าม log หรือคืน URL เต็มเด็ดขาด ทุก error string ต้องประกอบจากชื่อ method +
// http_status + description ของ Telegram เท่านั้น ไม่ใช่ err.message ดิบ (ซึ่งบาง
// runtime ของ fetch ฝัง URL ที่ throw ไว้ในนั้น)
'use strict';

const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_SEC = 30;

// อ่านไฟล์จากดิสก์เป็น buffer — sendPhoto/sendDocument/sendMediaGroup รับ path ของ
// ไฟล์ในเครื่อง (เช่น SNAPSHOT_DIR) ไม่ใช่ URL สาธารณะ ส่ง path ดิบให้ Telegram ไป
// ตรงๆ จะกลายเป็น "ส่ง URL ที่ Telegram เข้าไม่ถึง" ไม่ใช่ไฟล์
async function _readFile(p, filename) {
  const buffer = await fs.promises.readFile(p);
  return { buffer, filename: filename || path.basename(p) };
}

// ปิดข้อความ error ที่อาจมี token หลุดมา (เผื่อ fetch ของ runtime ฝัง URL ไว้ใน
// err.message) — แทนที่ทุก occurrence ของ token ด้วย '***' ก่อนใช้ที่ไหนก็ตาม
function _scrub(msg, token) {
  const s = String(msg == null ? '' : msg);
  if (!token) return s;
  return s.split(token).join('***');
}

async function tgCall(token, method, params = {}, { files } = {}) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res;
    if (files && Object.keys(files).length) {
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      for (const [field, file] of Object.entries(files)) {
        const blob = Buffer.isBuffer(file.buffer) ? new Blob([file.buffer]) : file.buffer;
        form.append(field, blob, file.filename || field);
      }
      res = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    }
    let body;
    try { body = await res.json(); }
    catch { return { success: false, error: `[${method}] non-JSON response (HTTP ${res.status})`, http_status: res.status }; }

    if (body.ok) {
      return {
        success: true, http_status: res.status, result: body.result,
        message_id: body.result?.message_id ?? null,
      };
    }

    const retryAfter = body.parameters?.retry_after;
    return {
      success: false,
      error: `[${method}] ${body.description || 'request failed'}`,
      http_status: res.status,
      retry_after: Number.isFinite(retryAfter) ? retryAfter : undefined,
    };
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    return {
      success: false,
      error: `[${method}] ${_scrub(timedOut ? 'timeout' : e.message, token)}`,
      http_status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// 429 → รอ retry_after (เพดาน 30s กัน long-poll ค้างนานเกินไป) แล้วลองซ้ำ 1 ครั้ง
async function _callWithRetry(token, method, params, opts) {
  const first = await tgCall(token, method, params, opts);
  if (first.success || !first.retry_after) return first;
  const waitSec = Math.min(first.retry_after, MAX_RETRY_AFTER_SEC);
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  return tgCall(token, method, params, opts);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _buttons(buttons) {
  if (!Array.isArray(buttons) || !buttons.length) return undefined;
  return { inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))] };
}

async function getMe(token) {
  return _callWithRetry(token, 'getMe', {});
}

async function sendMessage(token, chatId, html, { buttons } = {}) {
  const params = { chat_id: chatId, text: html, parse_mode: 'HTML' };
  const kb = _buttons(buttons);
  if (kb) params.reply_markup = kb;
  return _callWithRetry(token, 'sendMessage', params);
}

async function sendPhoto(token, chatId, photo, captionHtml, { buttons } = {}) {
  const params = { chat_id: chatId, parse_mode: 'HTML' };
  if (captionHtml) params.caption = captionHtml;
  const kb = _buttons(buttons);
  if (kb) params.reply_markup = kb;
  // URL — Telegram ดึงเองจากโดเมนสาธารณะ ไม่ต้องอัปโหลดไฟล์เลย (ลิงก์เซ็นชื่อของเรา
  // เอง usableSignedUrl() แบบเดียวกับที่ LINE ใช้อยู่แล้ว) ไม่ใช่ multipart
  if (photo && photo.url) {
    params.photo = photo.url;
    return _callWithRetry(token, 'sendPhoto', params);
  }
  let file = photo.buffer ? { buffer: photo.buffer, filename: photo.filename || 'photo.jpg' } : null;
  if (!file && photo.path) {
    try { file = await _readFile(photo.path, photo.filename); }
    catch (e) { return { success: false, error: `[sendPhoto] อ่านไฟล์ไม่สำเร็จ: ${e.code || e.message}` }; }
  }
  if (!file) return { success: false, error: '[sendPhoto] ต้องมี photo.url, photo.buffer หรือ photo.path' };
  return _callWithRetry(token, 'sendPhoto', params, { files: { photo: file } });
}

// Telegram บังคับ 2–10 รายการต่ออัลบั้ม — 1 รูปให้ตกไปใช้ sendPhoto แทน (ponytail:
// ไม่ทำ media group ของ 1 รูป เพราะ Bot API ปฏิเสธเอง ไม่ใช่ข้อจำกัดที่เราคิดเอง)
//
// รายการที่มี p.url ไม่เข้า `files` เลย — ส่ง `media: <url>` ตรง ๆ (Telegram ดึงเอง)
// ผสมกับรายการที่เป็น buffer/path (attach://) ในอัลบั้มเดียวกันได้ปกติ — ถ้าทุกรายการ
// เป็น url ทั้งหมด `files` จะว่าง (`{}`) ⇒ tgCall ส่งเป็น JSON ธรรมดา ไม่ใช่ multipart
async function sendMediaGroup(token, chatId, photos) {
  if (!Array.isArray(photos) || !photos.length) {
    return { success: false, error: '[sendMediaGroup] photos required' };
  }
  if (photos.length === 1) {
    return sendPhoto(token, chatId, photos[0], photos[0].captionHtml);
  }
  const files = {};
  const media = [];
  for (const [i, p] of photos.slice(0, 10).entries()) {
    let mediaRef;
    if (p.url) {
      mediaRef = p.url;
    } else {
      const field = `p${i}`;
      let file = p.buffer ? { buffer: p.buffer, filename: p.filename || `${field}.jpg` } : null;
      if (!file && p.path) {
        try { file = await _readFile(p.path, p.filename); }
        catch (e) { return { success: false, error: `[sendMediaGroup] อ่านไฟล์ไม่สำเร็จ: ${e.code || e.message}` }; }
      }
      if (!file) return { success: false, error: '[sendMediaGroup] แต่ละรูปต้องมี url, buffer หรือ path' };
      files[field] = file;
      mediaRef = `attach://${field}`;
    }
    const item = { type: 'photo', media: mediaRef };
    if (p.captionHtml) { item.caption = p.captionHtml; item.parse_mode = 'HTML'; }
    media.push(item);
  }
  return _callWithRetry(token, 'sendMediaGroup', { chat_id: chatId, media }, { files });
}

async function sendDocument(token, chatId, doc, captionHtml) {
  const params = { chat_id: chatId };
  if (captionHtml) { params.caption = captionHtml; params.parse_mode = 'HTML'; }
  let file = doc.buffer ? { buffer: doc.buffer, filename: doc.filename || 'file' } : null;
  if (!file && doc.path) {
    try { file = await _readFile(doc.path, doc.filename); }
    catch (e) { return { success: false, error: `[sendDocument] อ่านไฟล์ไม่สำเร็จ: ${e.code || e.message}` }; }
  }
  if (!file) return { success: false, error: '[sendDocument] ต้องมี doc.buffer หรือ doc.path' };
  return _callWithRetry(token, 'sendDocument', params, { files: { document: file } });
}

// long polling — ไม่ retry เอง (poller เป็นคนคุม loop/backoff) แต่ timeout ต้อง
// นานกว่า timeoutSec ที่ขอ Telegram ไว้ ไม่งั้น AbortController ตัดก่อน Telegram ตอบ
async function getUpdates(token, offset, timeoutSec) {
  const params = { offset, timeout: timeoutSec, allowed_updates: ['message', 'my_chat_member'] };
  const url = `https://api.telegram.org/bot${token}/getUpdates`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (timeoutSec + 10) * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params), signal: controller.signal,
    });
    let body;
    try { body = await res.json(); }
    catch { return { success: false, error: `[getUpdates] non-JSON response (HTTP ${res.status})`, http_status: res.status }; }
    if (body.ok) return { success: true, http_status: res.status, result: body.result };
    return { success: false, error: `[getUpdates] ${body.description || 'request failed'}`, http_status: res.status };
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    return { success: false, error: `[getUpdates] ${_scrub(timedOut ? 'timeout' : e.message, token)}`, http_status: null };
  } finally {
    clearTimeout(timer);
  }
}

// ── ส่งรายงาน (PNG/PDF) เข้าหลายแชท — phase T5 ──────────────────────────────
// ไม่ throw เหมือนฟังก์ชันอื่นในไฟล์นี้ · caption ตัดให้เหลือ ≤1024 ตัวอักษร
// **หลัง** escape เท่านั้น (ตัดสตริงที่ escape แล้วเสี่ยงตัดกลาง entity เช่น
// "&amp;" จนกลายเป็น "&am" ซึ่ง Telegram ปฏิเสธทั้งข้อความว่า parse ไม่ได้ —
// จึงตัดข้อความดิบทีละตัวจนความยาวหลัง escape ไม่เกินเพดานแทน)
const TG_CAPTION_MAX = 1024;
function _reportCaptionHtml(caption) {
  let plain = String(caption == null ? '' : caption);
  let html = escapeHtml(plain);
  while (html.length > TG_CAPTION_MAX && plain.length) {
    plain = plain.slice(0, -1);
    html = escapeHtml(plain);
  }
  return html;
}

// ข้อความ error ของ Telegram เมื่อรูปใหญ่/สัดส่วนเกินที่ sendPhoto รับได้
// (กว้าง+สูง > 10000px หรือด้านยาว:สั้น > 20:1) — รายงานวิเคราะห์แนวตั้งยาวมาก
// (สูงสุดที่เจอจริงหลายพันพิกเซล) มีโอกาสชนเพดานนี้ ต่างจาก error อื่น (เช่น
// chat ไม่ถูกต้อง) ซึ่ง retry ด้วยไฟล์เดิมในรูปแบบเอกสารก็ไม่ช่วย
function _looksLikePhotoDimensionError(msg) {
  return /IMAGE_PROCESS_FAILED|PHOTO_INVALID_DIMENSIONS|photo dimensions|wrong file identifier/i.test(String(msg || ''));
}

/**
 * sendReportToTelegram — ส่งรายงานหนึ่งใบ (PNG หรือ PDF) เข้าหลายแชท
 *
 * ไม่มี pdfBuffer และ pngBuffer ≤ 10 MB → sendPhoto (แสดงเป็นรูปในแชท)
 * มี pdfBuffer → sendDocument เสมอ (ไม่ว่า pngBuffer จะใหญ่แค่ไหน)
 * ไม่มี pdfBuffer แต่ pngBuffer > 10 MB → sendDocument ด้วย PNG แทน sendPhoto
 * (Bot API ปฏิเสธรูป > 10 MB ที่ sendPhoto)
 *
 * คืน { sentCount, results: [{chat_id, ok, error}] } เสมอ ไม่ throw
 */
async function sendReportToTelegram({ token, chatIds, pngBuffer, pdfBuffer, caption }) {
  const results = [];
  if (!Array.isArray(chatIds) || !chatIds.length) return { sentCount: 0, results };
  if (!token) {
    for (const id of chatIds) results.push({ chat_id: id, ok: false, error: 'no telegram token' });
    return { sentCount: 0, results };
  }
  const captionHtml = _reportCaptionHtml(caption);
  const PNG_LIMIT = 10 * 1024 * 1024;
  const hasPng = Buffer.isBuffer(pngBuffer) && pngBuffer.length > 0;
  const hasPdf = Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 0;

  let sentCount = 0;
  for (const chatId of chatIds) {
    let r;
    try {
      if (hasPdf) {
        r = await sendDocument(token, chatId, { buffer: pdfBuffer, filename: 'report.pdf' }, captionHtml);
      } else if (hasPng && pngBuffer.length <= PNG_LIMIT) {
        r = await sendPhoto(token, chatId, { buffer: pngBuffer, filename: 'report.png' }, captionHtml);
        // sendPhoto ปฏิเสธเพราะสัดส่วน/ขนาดพิกเซล (ไม่ใช่ปัญหาขนาดไฟล์) → ลองส่ง
        // ไฟล์เดิมเป็นเอกสารแทน ผู้รับยังเปิดดูได้ แค่ไม่ขึ้นเป็นรูปในแชท
        if (!r.success && _looksLikePhotoDimensionError(r.error)) {
          r = await sendDocument(token, chatId, { buffer: pngBuffer, filename: 'report.png' }, captionHtml);
        }
      } else if (hasPng) {
        r = await sendDocument(token, chatId, { buffer: pngBuffer, filename: 'report.png' }, captionHtml);
      } else {
        r = { success: false, error: 'no image/document to send' };
      }
    } catch (e) { r = { success: false, error: e.message }; }
    if (r.success) sentCount++;
    results.push({ chat_id: chatId, ok: !!r.success, error: r.success ? null : (r.error || null) });
  }
  return { sentCount, results };
}

module.exports = {
  tgCall, getMe, sendMessage, sendPhoto, sendMediaGroup, sendDocument, getUpdates, escapeHtml,
  sendReportToTelegram,
};
