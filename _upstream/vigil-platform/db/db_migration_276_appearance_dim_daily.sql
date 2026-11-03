-- ============================================================
-- Vigil Platform — Migration 276: appearance_dim_daily (สถิติคนรายวัน)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-10-22: สถิติคน (เพศ อายุ สีเสื้อ ฯลฯ) ผ่าน OpenAPI · เก็บ 365 วัน (ข้อมูลดิบ appearances เก็บแค่ 40)
-- รูปแบบเดียวกับ lpr_dim_daily: หนึ่งแถวต่อ วันไทย × กล้อง × มิติ × ค่า · ตัวสรุป refreshAppearanceDims() ทุก 15 นาที
--   วันไทยตาม event_time (เหมือนหน้าจอสถิติคน /api/appearances/stats · เจ้าของเลือก 2026-10-22)
--   มิติ object_class นับทุกประเภท (ใช้เป็นตัวหาร) · มิติลักษณะคนนับเฉพาะ object_class = 'Person' · ไม่นับค่าว่าง
-- view สำหรับ partner อยู่ใน migration 277
-- ============================================================

CREATE TABLE IF NOT EXISTS appearance_dim_daily (
  day        DATE         NOT NULL,
  camera_id  VARCHAR(100) NOT NULL,
  dim        TEXT         NOT NULL,
  value      TEXT         NOT NULL,
  n          INT          NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (day, camera_id, dim, value)
);

COMMENT ON TABLE appearance_dim_daily IS
  'Daily person-attribute counts per Asia/Bangkok day (event_time) per camera (migration 276). Kept 365 days; raw appearances only 40.';
