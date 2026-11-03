-- ============================================================
-- Vigil Platform — Migration 270: view สถิติสำหรับ partner API (OpenAPI ระยะ 2 · S1)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของตัดสิน 2026-10-22: ส่งตัวนับดิบ ไม่ส่งอัตรา · ชื่อฟิลด์อ่านเข้าใจทันที · ประเภทรถ/สีป้ายเป็นรหัสดิบจากกล้อง
-- อ่านจากตารางสรุป (ไม่แตะตารางดิบ) · ชื่อคอลัมน์ของ view = ชื่อฟิลด์ใน /v1 = สัญญา เปลี่ยนไม่ได้โดยไม่ออก /v2
-- ไม่ GRANT ให้ใคร — partner ทุกรายเริ่มที่ 0 ต้องติ๊กเองรายคอลัมน์ (migration 268)
--
-- รายวัน: แต่ละมิติเป็นคอลัมน์ของตัวเอง เพื่อให้ "จังหวัด" แยกสิทธิ์จาก "ยี่ห้อ" ได้ด้วยสิทธิ์รายคอลัมน์
-- ทุก view รวมกลุ่มตาม (เวลา, camera_id) ซึ่งตรงกับ index ของตารางต้นทาง ⇒ อ่านทีละหน้าแล้วหยุด
-- (วัด 2026-10-22: 1,000 แถว = 12 / 5 / 90 ms)
-- ============================================================

-- จำนวนยานพาหนะต่อกล้องต่อชั่วโมง แยกประเภท (traffic_hourly_stats เก็บ 120 วัน)
CREATE OR REPLACE VIEW v_vehicle_stats_hourly_public AS
SELECT bucket_hour               AS hour_start,
       camera_id,
       sum(n_total)::int         AS vehicles,
       jsonb_object_agg(vehicle_type, n_total) AS by_type,
       max(updated_at)           AS updated_at
  FROM traffic_hourly_stats
 GROUP BY bucket_hour, camera_id;

-- การตรวจจับของกล้อง LPR ต่อกล้องต่อชั่วโมง (lpr_hourly_stats)
CREATE OR REPLACE VIEW v_lpr_stats_hourly_public AS
SELECT bucket_hour AS hour_start,
       camera_id,
       n_total     AS detections,
       n_noread    AS no_plate,
       updated_at
  FROM lpr_hourly_stats;

-- สถิติรายวัน (วันตามเวลาไทย) ต่อกล้อง แยกมิติเป็นคอลัมน์ (lpr_dim_daily)
CREATE OR REPLACE VIEW v_lpr_stats_daily_public AS
SELECT day,
       camera_id,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'region')        AS region,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'vehicle_type')  AS vehicle_type,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'vehicle_brand') AS vehicle_brand,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'plate_color')   AS plate_color,
       max(updated_at) AS updated_at
  FROM lpr_dim_daily
 GROUP BY day, camera_id;

COMMENT ON VIEW v_vehicle_stats_hourly_public IS 'Partner API /v1/stats/vehicles/hourly (migration 270). Column names are the /v1 contract.';
COMMENT ON VIEW v_lpr_stats_hourly_public     IS 'Partner API /v1/stats/lpr/hourly (migration 270). Column names are the /v1 contract.';
COMMENT ON VIEW v_lpr_stats_daily_public      IS 'Partner API /v1/stats/lpr/daily (migration 270). One column per dimension so each can be granted separately.';
