-- ============================================================
-- Vigil Platform — Migration 242: ผูกผู้สั่งกับ Telegram (T4 — คำสั่งผ่าน Telegram)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T4) — ผู้สั่งคนเดียวกัน
-- ใช้ทั้ง LINE (line_user_id, PK เดิม) และ Telegram (telegram_user_id ใหม่) ได้พร้อมกัน
-- สิทธิ์ไซต์/ห้อง (user_id, allow_in) เป็นชุดเดียวกันไม่ต้องผูกซ้ำ
--
--   telegram_user_id      : from.id ของ Telegram — ผูกได้ผ่านรหัส 6 หลักเท่านั้น
--                            (ห้ามให้พิมพ์ id ดิบเอง กันคัดลอกผิด/เดา id คนอื่น)
--   telegram_link_code     : เก็บ **hash** ของรหัส ไม่ใช่ plaintext (sha256 ผ่าน
--                            helpers/telegramLinkCode.js) — รหัสอายุสั้น (10 นาที)
--                            ไม่ใช่ PII ระยะยาว จึงไม่ต้องใช้ encryptPii/blacklist-crypto
--   telegram_link_expires  : รหัสหมดอายุเมื่อเวลานี้ผ่านไป — ออกรหัสใหม่ทับของเดิมได้
--                            เสมอ (มีรหัสใช้งานอยู่ได้ครั้งละ 1 ชุดต่อผู้สั่ง)
-- ============================================================

ALTER TABLE line_operators
  ADD COLUMN IF NOT EXISTS telegram_user_id     BIGINT,
  ADD COLUMN IF NOT EXISTS telegram_link_code    TEXT,
  ADD COLUMN IF NOT EXISTS telegram_link_expires TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'line_operators_telegram_user_id_key'
  ) THEN
    ALTER TABLE line_operators
      ADD CONSTRAINT line_operators_telegram_user_id_key UNIQUE (telegram_user_id);
  END IF;
END $$;

-- ค้นรหัสที่ยังไม่หมดอายุตอนมีคนพิมพ์ /link — ทุกแถวมี telegram_link_expires เป็น NULL
-- เกือบตลอดเวลา (มีรหัสค้างอยู่แค่ตอน admin เพิ่งกดออกรหัสและยังไม่ 10 นาที) ดัชนีนี้
-- จึงเล็กมากเสมอ ไม่กระทบการ query ปกติของตาราง
CREATE INDEX IF NOT EXISTS idx_line_operators_telegram_link_code
  ON line_operators (telegram_link_code)
  WHERE telegram_link_code IS NOT NULL;
