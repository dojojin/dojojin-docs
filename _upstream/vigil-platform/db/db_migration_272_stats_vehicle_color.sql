-- ============================================================
-- Vigil Platform — Migration 272: สีรถใน v_lpr_stats_daily_public (OpenAPI ระยะ 2 · S3)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ตัวสรุปรายวัน (traffic-stats-refresher.refreshLprDims) เขียนมิติ 'vehicle_color' ลง lpr_dim_daily แล้ว
-- ย้อนหลังเติมด้วย scripts/backfill-lpr-rollups.js --dims-only
-- CREATE OR REPLACE VIEW ต่อคอลัมน์ใหม่ได้ที่ท้ายเท่านั้น จึงอยู่หลัง updated_at (ลำดับใน JSON มาจาก SELECT ของ partner-api ไม่ใช่ลำดับใน view)
-- คอลัมน์ใหม่ไม่ได้ GRANT ให้ใคร — partner ที่ได้มิติอื่นอยู่แล้วไม่ได้สีรถจนกว่าจะติ๊ก (migration 268)
-- ============================================================

CREATE OR REPLACE VIEW v_lpr_stats_daily_public AS
SELECT day,
       camera_id,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'region')        AS region,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'vehicle_type')  AS vehicle_type,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'vehicle_brand') AS vehicle_brand,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'plate_color')   AS plate_color,
       max(updated_at) AS updated_at,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'vehicle_color') AS vehicle_color
  FROM lpr_dim_daily
 GROUP BY day, camera_id;
