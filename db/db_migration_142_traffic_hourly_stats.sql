-- ============================================================
-- Vigil Platform — ตารางสรุปรายชั่วโมงสำหรับหน้ากวดขันวินัยจราจร
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- ทำไมต้องมี (วัดจริง 2026-08-11):
-- หน้ากวดขันวินัยจราจรต้องรวมยอดรายชั่วโมง × รายวันในสัปดาห์ ย้อนหลัง 28-90 วัน
-- ยิงตรงเข้า license_plates (12.6 ล้านแถว / 5.8 GB) ใช้เวลา **6.07 วินาทีต่อ query**
-- และหน้านี้ต้องใช้ 5 query ⇒ โหลดหน้าละ ~30 วินาที ซึ่งเปิดใช้จริงไม่ได้
-- index ที่มีอยู่ช่วยไม่ได้เพราะ aggregation ต้องอ่านทุกแถวในช่วงอยู่ดี
--
-- ⚠️ เก็บ vehicle_type **ดิบ** ไม่ใช่กลุ่มที่จัดไว้แล้ว — เพราะเจ้าของต้องการ
-- จัดกลุ่มประเภทรถเองได้จากหน้าตั้งค่า ถ้า pre-group ไว้ พอเปลี่ยนกลุ่มทีต้อง
-- backfill ใหม่ทั้งตาราง · เก็บดิบแล้วจัดกลุ่มตอน query แทน แลกกับแถวมากขึ้น
-- นิดหน่อยซึ่งยังเล็กมากอยู่ดี (ประมาณการ ≤ 1.5M แถว ที่ 90 วัน)
--
-- bucket_hour เก็บเป็น UTC (date_trunc บนค่า timestamptz ดิบ) — การแปลงเป็น
-- เวลาไทยทำตอน query เพราะ display_timezone เปลี่ยนได้จากหน้าตั้งค่า
-- ถ้า bucket ตามเวลาไทยไว้ตั้งแต่ตอนเก็บ วันที่เปลี่ยน timezone ข้อมูลเก่าจะผิดทันที
-- ============================================================

CREATE TABLE IF NOT EXISTS traffic_hourly_stats (
  camera_id      VARCHAR(100) NOT NULL,
  bucket_hour    TIMESTAMPTZ  NOT NULL,
  vehicle_type   VARCHAR(50)  NOT NULL,
  n_total        INTEGER      NOT NULL DEFAULT 0,
  n_no_helmet    INTEGER      NOT NULL DEFAULT 0,
  n_no_seatbelt  INTEGER      NOT NULL DEFAULT 0,
  n_riders3      INTEGER      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (camera_id, bucket_hour, vehicle_type)
);

-- หน้าจอกรองด้วยช่วงเวลาเสมอ (7/28/90 วัน) แล้วค่อยแตกตามกล้อง
CREATE INDEX IF NOT EXISTS idx_ths_bucket ON traffic_hourly_stats (bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_ths_camera_bucket ON traffic_hourly_stats (camera_id, bucket_hour DESC);

COMMENT ON TABLE traffic_hourly_stats IS
  'ยอดสรุปรายชั่วโมงจาก license_plates สำหรับหน้ากวดขันวินัยจราจร — เติมโดย src/traffic-stats-refresher.js';
