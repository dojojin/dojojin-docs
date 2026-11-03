// ============================================================
// Vigil Platform — รหัสผูกผู้สั่ง LINE เข้ากับ Telegram (T4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ฟังก์ชันบริสุทธิ์ล้วน ใช้ร่วมกันระหว่าง routes/line-commands.js (ออกรหัส)
// กับ telegramPoller.js (ตรวจรหัสที่พิมพ์เข้ามา) — เก็บ hash ไม่ใช่ plaintext
// (รหัสอายุสั้น 10 นาที ไม่ใช่ PII ระยะยาว จึงไม่ใช้ encryptPii/blacklist-crypto)
// ============================================================
'use strict';

const crypto = require('crypto');

function genLinkCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashLinkCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

module.exports = { genLinkCode, hashLinkCode };
