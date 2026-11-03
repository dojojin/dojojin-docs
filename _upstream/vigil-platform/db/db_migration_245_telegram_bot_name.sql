-- ============================================================
-- Vigil Platform — Migration 245: ชื่อบอท Telegram (สำหรับแผง "วิธีเพิ่มบอท")
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- telegram_config.bot_name : ชื่อที่แสดง (getMe().result.first_name) — คนละคอลัมน์
-- กับ bot_username (ใช้สร้างลิงก์ t.me/<username> อยู่แล้ว) เพราะ Telegram มีทั้ง
-- "ชื่อที่แสดง" กับ "@username" แยกกัน และหน้าตั้งค่าต้องโชว์ทั้งคู่ — PUT
-- /api/telegram-config เขียนคอลัมน์นี้ตอนตั้ง token ใหม่ (เรียก getMe อยู่แล้ว)
-- ส่วนแถวเดิมที่ตั้ง token ไว้ก่อน migration นี้ backfill lazily ตอน GET ครั้งแรก
-- (in-memory flag กันยิง getMe ซ้ำทุก request — ดู src/routes/telegram.js)
-- ============================================================

ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS bot_name TEXT;
