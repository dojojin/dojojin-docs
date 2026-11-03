-- ============================================================
-- Vigil Platform — Migration 274: traffic_daily_stats (สรุปกวดขันรายวัน ตามวันไทย)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-10-22 (เจ้าของ: ทำหน้า Traffic ก่อน แล้วค่อย OpenAPI รายวัน)
--   อนุกรมรายวัน 120 วันของหน้า Traffic รวมจาก traffic_hourly_stats ทุกครั้งที่เปิด: ต่อกล้อง 1,280 ms · รวม 218 ms
--   ตารางนี้ = ผลรวมของตารางรายชั่วโมงต่อวันไทย (อ่านน้อยลง ~24 เท่า) · ตัวสรุปเขียนจากตารางรายชั่วโมง ไม่อ่านข้อมูลดิบ
-- key เท่ากับตารางรายชั่วโมงแต่หน่วยเป็นวัน · upsert อย่างเดียวพอ เพราะแถวรายชั่วโมงไม่เคยหาย (นอกจาก prune อายุ)
-- เติมข้อมูลด้วย scripts/backfill-traffic-daily.js หลัง migration · ตัวสรุปเขียนต่อทุก 15 นาที + reconcile ตี 5
-- ============================================================

CREATE TABLE IF NOT EXISTS traffic_daily_stats (
  day            DATE         NOT NULL,
  camera_id      VARCHAR(100) NOT NULL,
  vehicle_type   VARCHAR(50)  NOT NULL,
  n_total        INT          NOT NULL DEFAULT 0,
  n_no_helmet    INT          NOT NULL DEFAULT 0,
  n_no_helmet_ok INT          NOT NULL DEFAULT 0,
  n_no_seatbelt  INT          NOT NULL DEFAULT 0,
  n_riders3      INT          NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (day, camera_id, vehicle_type)
);

COMMENT ON TABLE traffic_daily_stats IS
  'Sum of traffic_hourly_stats per Asia/Bangkok day (migration 274). Written by traffic-stats-refresher.refreshTrafficDaily.';
