-- ============================================================
-- Vigil Platform — Migration 275: v_enforcement_daily_public (OpenAPI ระยะ 2 · Traffic Enforcement รายวัน)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ทับ traffic_daily_stats (migration 274) — เดิมตัดรายวันออกจาก S2 เพราะต้องรวมรายชั่วโมงสด (ช้า 10–20 เท่า)
-- ฟิลด์เดียวกับ v_enforcement_hourly_public แต่ key เป็นวันไทย · ตัวนับดิบ ไม่ส่งอัตรา · ไม่ GRANT ให้ใคร
-- ============================================================

CREATE OR REPLACE VIEW v_enforcement_daily_public AS
SELECT day,
       camera_id,
       sum(n_no_helmet)::int    AS no_helmet,
       sum(n_no_helmet_ok)::int AS no_helmet_with_plate,
       sum(n_no_seatbelt)::int  AS no_seatbelt,
       sum(n_riders3)::int      AS riders3,
       jsonb_object_agg(vehicle_type, jsonb_strip_nulls(jsonb_build_object(
         'vehicles',             n_total,
         'no_helmet',            nullif(n_no_helmet, 0),
         'no_helmet_with_plate', nullif(n_no_helmet_ok, 0),
         'no_seatbelt',          nullif(n_no_seatbelt, 0),
         'riders3',              nullif(n_riders3, 0)))) AS by_type,
       max(updated_at)          AS updated_at
  FROM traffic_daily_stats
 GROUP BY day, camera_id;

COMMENT ON VIEW v_enforcement_daily_public IS 'Partner API /v1/enforcement/daily (migration 275). Asia/Bangkok days. Raw counts only. Column names are the /v1 contract.';
