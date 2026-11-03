-- ============================================================
-- Vigil Platform — Migration 251: license_plates — index สำหรับอันดับหมวก/นับตามกล้อง + vacuum ตาม insert
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- บน central สร้างด้วยมือแบบ CONCURRENTLY แล้ว (2026-10-05) — migrate.js ครอบ transaction
-- จึงใช้ CONCURRENTLY ในไฟล์นี้ไม่ได้ (เหตุผลเดียวกับ migration 184/190/193/195)
-- ไฟล์นี้ IF NOT EXISTS ไว้ให้เครื่องติดตั้งใหม่ (edge ไม่รัน api-server จึงไม่รัน migration)
--
-- idx_plates_nohelmet_moto_cover — /api/traffic/helmet-top ช่วง 7 วัน cold 22–27 วิ:
--   ขั้น hit ใช้ idx_plates_nohelmet_cover แต่ต้องกลับไปอ่าน heap 285k blocks (14.2 วิ)
--   เพราะ index เดิมไม่มี vehicle_type / plate_identified · partial ตามเงื่อนไขจริงของหน้า
--   (helmetCriteria: no_helmet AND twoWheelVehicle AND plate_identified) = index-only ได้
-- idx_plates_cam_time — นับผลค้นหา LPR ตามกล้อง (?count=only) 3 กล้อง 3 วัน 12.8–21 วิ (O3/O4)
--   index เดิมที่ขึ้นต้นด้วย camera_id มีคอลัมน์คั่นกลาง (lane_no / vehicle_type) จึงตัดช่วงเวลาไม่ได้
--
-- autovacuum_vacuum_insert_scale_factor 0.01: ตารางนี้ "ไม่เคยถูก vacuum เลย" (ตรวจ 2026-10-05)
--   ค่าเริ่มต้น 0.2 × 56 ล้านแถว = ~11 ล้าน insert ต่อครั้ง · visibility map จึงว่าง
--   ⇒ index-only scan ทุกตัวยังต้องอ่าน heap · 0.01 ≈ 560k แถว ≈ ทุก ~10 ชม.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_nohelmet_moto_cover
  ON license_plates (detected_at) INCLUDE (plate_number, camera_id, confidence)
  WHERE no_helmet AND vehicle_type = 'twoWheelVehicle' AND plate_identified;

CREATE INDEX IF NOT EXISTS idx_plates_cam_time
  ON license_plates (camera_id, detected_at DESC);

ALTER TABLE license_plates SET (autovacuum_vacuum_insert_scale_factor = 0.01);
