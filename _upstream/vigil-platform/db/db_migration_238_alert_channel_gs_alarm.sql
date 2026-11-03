-- ============================================================
-- Vigil Platform — Migration 238: เพิ่มช่องทาง gs_alarm ใน alert_rules_channel_chk
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-24: 17d14374 เพิ่มช่องทาง LINE "GuruSquare · Events Alarm"
-- (CHANNELS.gs_alarm ใน routes/alert-channels.js) แต่ไม่ได้ขยาย CHECK ของ
-- migration 146 ที่ล็อกค่า channel ไว้แค่ hcp_face/auraface/lpr — ทำซ้ำได้ตอนเปิดใช้
-- จริง: INSERT แถว channel='gs_alarm' โดน check violation · กดบันทึกจากหน้าตั้งค่า
-- ก็จะได้ 500 แบบเดียวกัน (เทสต์ทั้งหมดใช้ pool ปลอม จึงไม่มีตัวไหนเห็น)
--
-- ตารางเล็ก (แถวละช่องทาง/กฎ) · DROP + ADD ใหม่ทั้งก้อน ปลอดภัยและรันซ้ำได้
-- ============================================================

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_channel_chk;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_channel_chk
  CHECK (channel IS NULL OR channel IN ('hcp_face', 'auraface', 'lpr', 'gs_alarm'));
