-- ============================================================
-- Vigil Platform — Migration 043: per-camera overlay display toggles
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- 2026-06-11: เปิด/ปิด client-side snapshot overlay แยกชนิดต่อกล้อง —
-- overlay_show_bbox = กรอบวัตถุ (Dahua BoundingBox / Hikvision faceRect),
-- overlay_show_zone = polygon โซนของ rule (Dahua DetectRegion).
-- คนละเรื่องกับ enable_vca_overlay (Bosch เผากรอบลงไฟล์รูปฝั่งกล้อง) —
-- ตัวนี้คุมเฉพาะ SVG ที่ dashboard วาดทับจาก raw_json. default เปิดทั้งคู่
-- (พฤติกรรมเดิมก่อน toggle). idempotent: ADD COLUMN IF NOT EXISTS

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS overlay_show_bbox BOOLEAN DEFAULT true;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS overlay_show_zone BOOLEAN DEFAULT true;
