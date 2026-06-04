-- ============================================================
-- Migration: alert_rules.push_user_ids — mobile push dispatch
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- Idempotent. เก็บ vigil user id (รายคน) ที่จะได้รับ push มือถือ
-- ของ rule นี้ — ว่าง = ไม่ส่ง push (สมมาตรกับ recipient_ids ของ LINE).
-- ปุ่มลัด "เลือกทั้ง role" บน UI แค่ติ๊ก user ใน role นั้นให้ (เก็บเป็น user id เสมอ).
-- ============================================================

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS push_user_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[];
