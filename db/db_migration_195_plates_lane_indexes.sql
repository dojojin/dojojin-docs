-- ============================================================
-- Vigil Platform — Migration 195: index ของเลนและคนซ้อนท้าย
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- คู่กับ migration 194 · บน central สร้างด้วยมือแบบ CONCURRENTLY หลัง backfill
-- 27.6 ล้านแถวเสร็จ (จงใจรอ — สร้างก่อนจะทำให้ backfill ช้าลงทั้งตาราง):
--   idx_plates_cam_lane_time  1,185 MB — ด่าน probe ของตัวกรองเลน
--   idx_plates_pillion_yes       53 MB — partial เฉพาะ 'yes' ซึ่งเป็นค่าเดียวที่กรอง
-- เหตุผล CONCURRENTLY-by-hand เดียวกับ migration 184/190/193 (migrate.js ครอบ
-- transaction) · ไฟล์นี้ IF NOT EXISTS ให้เครื่องติดตั้งใหม่
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_plates_cam_lane_time
  ON license_plates (camera_id, lane_no, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_plates_pillion_yes
  ON license_plates (camera_id, detected_at DESC) WHERE pillion = 'yes';
