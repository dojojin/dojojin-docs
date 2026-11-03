-- ============================================================
-- Vigil Platform — Migration 243: รายงานผ่าน Telegram (T5)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T5) — เพิ่มผู้รับ Telegram
-- ต่อตารางส่งรายงาน (คู่กับ recipients ที่เป็น LINE เดิม) และคอลัมน์บันทึกผล
-- ฝั่ง Telegram ใน report_history โดยไม่แตะความหมายของคอลัมน์ LINE เดิมเลย —
-- sent_count/total_recipients/recipients_sent/image_source ยังหมายถึง LINE เท่านั้น
--
--   report_schedules.telegram_chat_ids : รายชื่อ chat_id (text) ของ
--     telegram_config.chats ที่ตารางนี้จะส่งถึง — ว่าง = ไม่ส่ง Telegram เลย
--     (พฤติกรรมเดิมเป๊ะ) ต้องเป็นแชทที่อนุมัติแล้วเท่านั้น (validate ที่ route)
--   report_history.telegram_sent_count / telegram_total_recipients /
--     telegram_error_message : ผลของขา Telegram แยกจากขา LINE โดยสิ้นเชิง — ว่าง/NULL
--     = ตารางนี้ไม่ได้ตั้ง Telegram ไว้เลย ไม่ใช่ "ส่งแล้วไม่มีใครได้"
-- ============================================================

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS telegram_chat_ids TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE report_history
  ADD COLUMN IF NOT EXISTS telegram_sent_count       INT,
  ADD COLUMN IF NOT EXISTS telegram_total_recipients INT,
  ADD COLUMN IF NOT EXISTS telegram_error_message    TEXT;
