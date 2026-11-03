-- ============================================================
-- Vigil Platform — Migration 193: index ประกอบ (กล้อง, ประเภทรถ, เวลา)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- คู่กับการเขียน /api/lpr ใหม่ (ขับจาก license_plates + ด่าน probe, 2026-08-31):
-- ด่าน probe ยิง query ไม่เรียงลำดับที่กรอง camera_id + vehicle_type — bitmap บน
-- index นี้ทำให้เคส "ประเภทที่ไม่มีในไซต์นี้แต่มีมากไซต์อื่น" (hdy+buggy เคยกวาด
-- 23 วินาที) จบใน 0.4ms · บน central สร้างด้วยมือแบบ CONCURRENTLY แล้ว
-- (1.5 GB) — เหตุผลเดียวกับ migration 184/190: migrate.js ครอบ transaction
-- ไฟล์นี้ IF NOT EXISTS ให้เครื่องติดตั้งใหม่
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_plates_cam_vtype_time
  ON license_plates (camera_id, vehicle_type, detected_at DESC);
