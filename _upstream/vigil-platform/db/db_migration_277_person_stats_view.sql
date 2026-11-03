-- ============================================================
-- Vigil Platform — Migration 277: v_person_stats_daily_public (OpenAPI · สถิติคนรายวัน)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ทับ appearance_dim_daily (migration 276) · แยกมิติเป็นคอลัมน์ ให้สิทธิ์แยกได้ · ไม่ GRANT ให้ใคร (migration 268)
-- ชื่อคอลัมน์ = ชื่อฟิลด์ใน /v1/stats/person/daily = สัญญา
-- ============================================================

CREATE OR REPLACE VIEW v_person_stats_daily_public AS
SELECT day,
       camera_id,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'object_class')    AS object_class,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'gender')          AS gender,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'age_group')       AS age_group,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'upper_color')     AS upper_color,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'lower_color')     AS lower_color,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'top_category')    AS top_category,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'bottom_category') AS bottom_category,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'glasses')         AS glasses,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'hat')             AS hat,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'mask')            AS mask,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'expression')      AS expression,
       jsonb_object_agg(value, n) FILTER (WHERE dim = 'bag_category')    AS bag_category,
       max(updated_at) AS updated_at
  FROM appearance_dim_daily
 GROUP BY day, camera_id;

COMMENT ON VIEW v_person_stats_daily_public IS
  'Partner API /v1/stats/person/daily (migration 276). One column per dimension so each can be granted separately.';
