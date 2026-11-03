// ============================================================
// Vigil Platform — Helper: deliver_via / telegram_chat_ids validation (T2b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T2) — ย้าย validation ที่
// src/routes/alert-channels.js เขียนไว้ตอน T2a ออกมาเป็นฟังก์ชันกลาง ให้
// src/routes/alert-rules.js (กฎที่ผู้ใช้สร้างเอง) เรียกซ้ำได้ ไม่ต้องคัดลอกกฎ
//
// คืน { error } เมื่อไม่ผ่าน หรือ { ok: true } เมื่อผ่าน — ไม่เขียน DB, ไม่ throw
'use strict';

const DELIVER_VIA_VALUES = ['line', 'telegram', 'both', 'line_then_telegram'];

/**
 * @param {object} pool
 * @param {object} opts
 * @param {string|undefined} opts.deliverVia
 * @param {Array|undefined} opts.telegramChatIds — undefined = คำขอนี้ไม่ได้ส่งมา
 * @param {boolean} [opts.isLprChannel] — ช่องทาง lpr เลือกแชทจาก telegram_config.chats
 *   (lpr_enabled ต่อแชท) ไม่ใช่จาก telegram_chat_ids ของแถว — ดู lprLineAlert.js
 * @param {Array} [opts.existingChatIds] — telegram_chat_ids ที่บันทึกไว้แล้ว ใช้ตอน
 *   คำขอนี้เปลี่ยนแค่ deliver_via โดยไม่ได้ส่ง telegram_chat_ids มาด้วย
 */
async function validateDeliverVia(pool, {
  deliverVia, telegramChatIds, isLprChannel = false, existingChatIds = [],
} = {}) {
  if (deliverVia !== undefined && !DELIVER_VIA_VALUES.includes(deliverVia)) {
    return { error: `deliver_via ไม่ถูกต้อง (${DELIVER_VIA_VALUES.join('/')})` };
  }

  if (telegramChatIds !== undefined) {
    if (!Array.isArray(telegramChatIds)) {
      return { error: 'telegram_chat_ids ต้องเป็น array' };
    }
    const { rows: tgRows } = await pool.query('SELECT chats FROM telegram_config WHERE id = 1');
    const approved = new Set((tgRows[0]?.chats || []).map((c) => String(c?.chat_id)));
    for (const id of telegramChatIds) {
      if (!approved.has(String(id))) {
        return { error: `chat_id ยังไม่ได้รับการอนุมัติ: ${id}` };
      }
    }
  }

  // 🔴 "Telegram อย่างเดียว" = ข้าม LINE ทั้งหมด · ถ้าบอทยังไม่พร้อมหรือไม่มีแชทรับจริง
  // แจ้งเตือนของช่องทางนี้จะหยุดเงียบ ๆ — กันที่นี่แทนที่จะปล่อยให้หน้าจอเลือกได้เฉย ๆ
  // 'both' ไม่ต้องกัน: LINE ยังส่งตามเดิม Telegram ไม่พร้อมก็แค่ไม่มีขานั้น
  if (deliverVia === 'telegram') {
    const { rows: tg } = await pool.query(
      'SELECT enabled, bot_token_enc IS NOT NULL AS has_token, chats FROM telegram_config WHERE id = 1');
    const t = tg[0] || {};
    const enabledChats = (t.chats || []).filter((c) => c && c.enabled !== false);
    const ready = isLprChannel
      ? enabledChats.some((c) => c.lpr_enabled !== false)
      : (telegramChatIds !== undefined ? telegramChatIds.length > 0 : existingChatIds.length > 0);
    if (!t.enabled || !t.has_token || !ready) {
      return {
        error: 'ยังเลือก "Telegram อย่างเดียว" ไม่ได้: ต้องเปิดบอทใน Telegram Config และมีแชทที่จะรับแจ้งเตือนนี้ก่อน ไม่งั้นแจ้งเตือนจะหยุดส่ง',
      };
    }
  }

  return { ok: true };
}

module.exports = { validateDeliverVia, DELIVER_VIA_VALUES };
