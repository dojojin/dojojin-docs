-- ============================================================
-- Vigil Platform — Migration 241: alert_rules.deliver_via (T2a — Telegram leg)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา: docs/reports/2026-09-24_telegram-plan.md (phase T2) — เพิ่มขาส่งเข้า
-- Telegram ให้ช่องทางป้ายทะเบียนและ GuruSquare Alarm โดยยังไม่แตะพฤติกรรม LINE เดิม
--
--   deliver_via       : 'line' (ค่าเริ่มต้น = พฤติกรรมเดิมเป๊ะ) | 'telegram' |
--                        'both' | 'line_then_telegram' (สำรอง T3 — ตอนนี้ทำงาน
--                        เหมือน 'line' ทุกประการจนกว่า T3 จะต่อ fallback จริง)
--   telegram_chat_ids : รายชื่อ chat_id (text) ของ telegram_config.chats ที่ช่องทาง
--                        แบบ "เลือกผู้รับเป็นรายชื่อ" (เช่น GuruSquare) จะส่งถึง —
--                        ช่องทาง LPR ไม่ใช้คอลัมน์นี้ (เลือกจาก chats[].lpr_sites/
--                        lpr_groups รายแชทแทน เหมือนที่ผู้รับ LINE ของ LPR เลือกจาก
--                        line_config.recipients[].lpr_sites/lpr_groups รายคน)
-- ============================================================

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS deliver_via TEXT NOT NULL DEFAULT 'line';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_rules_deliver_via_chk') THEN
    ALTER TABLE alert_rules
      ADD CONSTRAINT alert_rules_deliver_via_chk
      CHECK (deliver_via IN ('line', 'telegram', 'both', 'line_then_telegram'));
  END IF;
END $$;

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS telegram_chat_ids TEXT[] NOT NULL DEFAULT '{}';
