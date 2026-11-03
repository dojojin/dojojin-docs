// ============================================================
// Vigil Platform — Telegram leg for scheduled/manual reports (T5)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T5) — แยกออกมาจาก
// report-worker.js เพื่อให้เทสต์ได้โดยไม่ต้อง require ไฟล์นั้นตรงๆ (report-worker.js
// สร้าง pg Pool จริง + เปิด HTTP server + setInterval เป็น side effect ตอน require —
// ไม่ปลอดภัยที่จะ require ในเทสต์)
//
// ไม่ throw เด็ดขาด (สัญญาเดียวกับ line-sender.js/telegramSender.js) · รับ pool +
// sender เป็นพารามิเตอร์เพื่อ inject ได้ในเทสต์
'use strict';

const { decryptPii } = require('./blacklist-crypto');

// หา token + chat_id ที่ "อนุมัติแล้ว" (มีอยู่ใน telegram_config.chats) และยังเปิดใช้
// (enabled !== false) จากรายชื่อที่ตารางรายงานตั้งไว้ (schedule.telegram_chat_ids /
// request body ของการส่งด้วยมือ) — ไม่แตะ DB เลยถ้ารายชื่อที่ขอมาว่างอยู่แล้ว
// (ตารางที่ไม่ได้ใช้ Telegram ต้องไม่มีผลข้างเคียงใดๆ เพิ่มจากเดิม)
async function resolveTelegramTarget(pool, telegramChatIds) {
  const wanted = Array.isArray(telegramChatIds) ? telegramChatIds.map(String).filter(Boolean) : [];
  if (!wanted.length) return { chatIds: [] };

  let cfg;
  try {
    const { rows } = await pool.query('SELECT enabled, bot_token_enc, chats FROM telegram_config WHERE id = 1');
    cfg = rows[0];
  } catch (e) { return { chatIds: [], error: `อ่าน telegram_config ไม่สำเร็จ: ${e.message}` }; }
  if (!cfg?.enabled || !cfg.bot_token_enc) return { chatIds: [], error: 'Telegram is not enabled / no bot token' };

  let token;
  try { token = decryptPii(cfg.bot_token_enc); }
  catch (e) { return { chatIds: [], error: `ถอดรหัส telegram token ไม่สำเร็จ: ${e.message}` }; }
  if (!token) return { chatIds: [], error: 'no telegram token' };

  const approved = Array.isArray(cfg.chats) ? cfg.chats : [];
  const chatIds = approved
    .filter((c) => c && c.enabled !== false && wanted.includes(String(c.chat_id)))
    .map((c) => String(c.chat_id));
  if (!chatIds.length) return { chatIds: [], error: 'no enabled/approved telegram chat matched' };
  return { token, chatIds };
}

/**
 * sendTelegramReport — ส่งรายงานหนึ่งใบเข้าทุกแชทที่ตารางนี้ตั้งไว้
 *
 * คืน `null` เมื่อตารางนี้ไม่ได้ตั้ง telegram_chat_ids ไว้เลย (ไม่แตะระบบ) —
 * ต่างจาก `{ sentCount: 0, ... , error }` ซึ่งแปลว่า "ตั้งไว้แต่ส่งไม่ได้"
 */
async function sendTelegramReport({ pool, telegramChatIds, pngBuffer, pdfBuffer, caption,
                                     sender = require('./telegramSender') }) {
  const tg = await resolveTelegramTarget(pool, telegramChatIds);
  if (!tg.chatIds.length) {
    if (tg.error) return { sentCount: 0, totalRecipients: 0, chatIds: [], error: tg.error };
    return null;
  }
  const r = await sender.sendReportToTelegram({ token: tg.token, chatIds: tg.chatIds, pngBuffer, pdfBuffer, caption });
  const failed = r.results.filter((x) => !x.ok);
  return {
    sentCount: r.sentCount,
    totalRecipients: tg.chatIds.length,
    chatIds: tg.chatIds,
    error: failed.length ? failed.map((x) => `${x.chat_id}: ${x.error}`).join('; ').slice(0, 500) : null,
  };
}

// ตรวจ chat_id ที่ส่งมาจาก route (ตารางส่งรายงาน/ส่งด้วยมือ) — ต้องเป็นแชทที่
// "อนุมัติแล้ว" เท่านั้น (มีอยู่จริงใน telegram_config.chats) ใช้ร่วมกันทั้ง 3
// route (report-schedules.js, reports.js, health-reporting.js) กันแต่ละที่เขียน
// กฎเดียวกันซ้ำแล้วเพี้ยนกันเอง · v===undefined = ไม่ได้ส่งมาเลย (คืน undefined
// ไม่ใช่ [] — ผู้เรียกใช้แยกแยะ "ไม่แตะค่าที่บันทึกไว้" ออกจาก "ล้างค่า")
const CHAT_ID_RE = /^-?\d+$/;
async function validateApprovedTelegramChatIds(pool, v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new Error('telegram_chat_ids must be an array');
  const ids = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) return [];
  for (const id of ids) {
    if (!CHAT_ID_RE.test(id)) throw new Error(`chat_id ไม่ถูกต้อง: ${id}`);
  }
  const { rows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
  const approved = new Set((Array.isArray(rows[0]?.chats) ? rows[0].chats : []).map((c) => String(c.chat_id)));
  const unknown = ids.filter((id) => !approved.has(id));
  if (unknown.length) throw new Error(`chat_id ยังไม่ได้รับการอนุมัติ: ${unknown.join(', ')}`);
  return ids;
}

module.exports = { resolveTelegramTarget, sendTelegramReport, validateApprovedTelegramChatIds };
