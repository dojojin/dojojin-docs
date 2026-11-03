-- ============================================================
-- Vigil Platform — Migration 244: คำสั่งผ่าน Telegram ใช้ทะเบียนร่วมกับ LINE
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของเลือก: ทะเบียนคำสั่ง/ผู้สั่งใช้ร่วมกันตัวเดียว (line_commands, line_operators)
-- ไม่ clone ตาราง/ตัวรัน — เพิ่มแค่สองคอลัมน์ให้ "มองเห็นเฉพาะฝั่ง Telegram" ต่างจาก LINE ได้:
--
--   line_commands.telegram_enabled : เปิด/ปิดคำสั่งนี้บนฝั่ง Telegram โดยเฉพาะ — ปิดแล้ว
--     คำสั่งนั้น "ไม่มีตัวตน" บน Telegram เลย (ไม่จับคำเรียก ไม่ขึ้นใน help) แต่ยังทำงาน
--     บน LINE ตามปกติทุกประการ — ตรวจ/กรองใน handleLineText() (src/helpers/lineCommandRun.js)
--
--   line_operators.telegram_allow_in : รายชื่อห้อง Telegram (รูป tg:<chat_id>) ที่ผู้สั่งคนนี้
--     สั่งได้ — คนละคอลัมน์กับ allow_in เดิมที่เป็นของฝั่ง LINE ล้วน (เหตุผล: ผู้สั่งคนเดียวกัน
--     อาจอนุญาตห้อง LINE ชุดหนึ่ง กับห้อง Telegram อีกชุดหนึ่งที่ไม่ใช่รายการเดียวกันเป๊ะ)
--     NULL/ว่าง = สั่งได้ทุกห้อง Telegram ที่อนุมัติแล้ว + แชทส่วนตัวของตัวเอง (พฤติกรรมเดียวกับ
--     allow_in ว่างของฝั่ง LINE)
--
-- ── ปิด forward_police บน Telegram ครั้งเดียวตอน migration นี้รันครั้งแรก ──────
-- คำสั่ง key='forward_police' (action_key='forward_alert', fixed_params.to ชี้เข้ากลุ่ม
-- ตำรวจ LINE จริง) เจ้าของขอให้ปิดไว้ก่อนบนฝั่ง Telegram ตอนเปิดใช้งานฟีเจอร์นี้ — เพราะ
-- ยังไม่มีใครทดสอบเส้นทาง Telegram→ส่งเข้ากลุ่มตำรวจมาก่อน แต่ถ้าแอดมินเปิดกลับเองทีหลัง
-- (ผ่านหน้าตั้งค่า) ต้อง**ไม่ถูก migration นี้ปิดซ้ำ** เมื่อรันไฟล์นี้อีกรอบ (idempotent
-- ตามกติกา init.sql/migration ของโปรเจกต์) ⇒ เช็คก่อน ALTER ว่าคอลัมน์นี้เคยมีอยู่แล้วหรือไม่
-- มีแล้ว = ไม่ใช่การรันครั้งแรก ข้าม UPDATE ไปเลย ปล่อยค่าปัจจุบันไว้ตามที่แอดมินตั้ง
-- ============================================================

DO $$
DECLARE
  _existed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'line_commands' AND column_name = 'telegram_enabled'
  ) INTO _existed;

  ALTER TABLE line_commands ADD COLUMN IF NOT EXISTS telegram_enabled BOOLEAN NOT NULL DEFAULT TRUE;

  IF NOT _existed THEN
    UPDATE line_commands SET telegram_enabled = FALSE, updated_at = now()
     WHERE key = 'forward_police';
  END IF;
END $$;

ALTER TABLE line_operators ADD COLUMN IF NOT EXISTS telegram_allow_in JSONB;
