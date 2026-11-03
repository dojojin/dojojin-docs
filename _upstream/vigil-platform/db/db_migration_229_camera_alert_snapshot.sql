-- ============================================================
-- Vigil Platform — migration 229: opt-in ภาพประกอบการ์ดแจ้งเตือนกล้องดับ
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-15: เจ้าของสั่งปรับการ์ดแจ้งเตือนกล้องดับ/กลับมาออนไลน์
-- จากข้อความเปล่าเป็น Flex card แบบเดียวกับการ์ด LPR/ใบหน้า (มีภาพประกอบ
-- จาก event ล่าสุดของกล้องนั้น) — ตกลงให้เป็น opt-in ต่อกล้อง (DEFAULT
-- FALSE) ไม่ใช่เปิดทีเดียวทุกกล้อง เพื่อไม่กระทบของเดิมสักกล้องเดียว
-- จนกว่าจะเปิดเอง ชื่อคอลัมน์ใช้ซ้ำกับ lprLineAlert.js (send_snapshot)
-- เพื่อความสม่ำเสมอของชื่อในระบบ
-- ============================================================

ALTER TABLE camera_offline_alerts
  ADD COLUMN IF NOT EXISTS send_snapshot BOOLEAN NOT NULL DEFAULT FALSE;
