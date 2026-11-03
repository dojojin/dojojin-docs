-- ============================================================
-- Vigil Platform — Migration 253: license_plates — ลบ index ที่ถูกตัวใหม่ครอบแล้ว (O11)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- บน central ลบด้วยมือแบบ CONCURRENTLY แล้ว (2026-10-06 · เจ้าของอนุมัติ) — ไฟล์นี้ให้เครื่อง
-- ติดตั้งใหม่ได้ชุด index เดียวกัน (migration 092 / init.sql ยังสร้างสองตัวนี้ก่อนถึงไฟล์นี้)
--
-- idx_plates_camera (camera_id) 564 MB — idx_scan = 0 · idx_plates_cam_time (migration 251)
--   ขึ้นต้นด้วย camera_id เหมือนกัน
-- idx_plates_detected_at (detected_at) 1.86 GB — idx_plates_time_plate_cover (migration 252)
--   ขึ้นต้นด้วย detected_at เหมือนกัน · ราคาที่จ่าย: นับแถว 2 วัน 72 ms → 108 ms (index ใหญ่กว่า 2.7 เท่า)
--   แลกกับพื้นที่ 1.86 GB และงานอัปเดต index หนึ่งตัวต่อทุกป้ายที่เขียน
-- ============================================================

DROP INDEX IF EXISTS idx_plates_camera;
DROP INDEX IF EXISTS idx_plates_detected_at;
