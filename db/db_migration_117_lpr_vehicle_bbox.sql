-- ============================================================
-- Vigil Platform — migration 117: vehicle-level bounding box + LPR bbox toggles
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- The camera's ANPR XML carries <vehicelRect> (yes, that's the camera
-- firmware's own spelling — not a typo introduced here) alongside
-- <PlateRect>: a second box on the same normalized 0-1000 grid, covering
-- the whole vehicle rather than just the plate. Verified live against
-- C28-KAT-SB-15 2026-08-06 (owner request — "corner bracket" frame around
-- the target vehicle, distinct color from the plate box).
--
-- Same column shape as the existing bbox_x/y/width/height (plate) so the
-- ingest/query code stays symmetric.
-- ============================================================

ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS vehicle_bbox_x      INT;
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS vehicle_bbox_y      INT;
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS vehicle_bbox_width  INT;
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS vehicle_bbox_height INT;

-- Three independent switches (owner request 2026-08-06) — the vehicle
-- corner-bracket frame ships on by default (opt-out); the plate box and
-- the burned-into-the-downloaded-image variant ship off (opt-in), since
-- those are newer/less-reviewed additions on top of the same data.
INSERT INTO system_settings (key, value, description) VALUES
  ('lpr_bbox_vehicle_enabled', '1',
   'แสดงกรอบมุม (corner bracket) รอบตัวรถใน LPR modal — ตั้งได้ที่ ตั้งค่า › ระบบ LPR (default เปิด)'),
  ('lpr_bbox_plate_enabled', '0',
   'แสดงกรอบรอบป้ายทะเบียนใน LPR modal — ตั้งได้ที่ ตั้งค่า › ระบบ LPR (default ปิด)'),
  ('lpr_bbox_full_image_enabled', '0',
   'ฝังกรอบ (รถ/ป้าย) ลงในรูปเต็มตอนดู/ดาวน์โหลด — ตั้งได้ที่ ตั้งค่า › ระบบ LPR (default ปิด)')
ON CONFLICT (key) DO NOTHING;
