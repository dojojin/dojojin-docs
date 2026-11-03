-- ============================================================
-- Vigil Platform — Backfill face_blacklist.enrolled_ref for the first batch
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- Migration 133 added enrolled_ref but the first enrollment run (1,496 rows,
-- 2026-08-10) predated it — all NULL, so the Lab Test detail modal had no
-- way back to a reference photo (owner asked for one, 2026-08-10). Backfill
-- by matching label against blacklist.source_records' display name — safe
-- only where the label is unique (checked: 1,428/1,496 are; the remaining
-- 68 share a label with at least one other record and are left NULL rather
-- than guessed, same principle as the hits backfill in migration 134's
-- INSERT). Re-run safe: only touches rows still NULL.
-- ============================================================

WITH src AS (
  SELECT sr.id AS source_id, COALESCE(m.display_name, sr.name) AS label
    FROM blacklist.source_records sr
    JOIN blacklist.master_links ml ON ml.source_record_id = sr.id
    JOIN blacklist.master m ON m.id = ml.master_id
   WHERE sr.source_id = 14 AND sr.data_type = 'face' AND m.status = 'active' AND sr.photo_path IS NOT NULL
),
unique_src AS (
  SELECT label, min(source_id) AS source_id FROM src GROUP BY label HAVING count(*) = 1
)
UPDATE face_blacklist fb
   SET enrolled_ref = unique_src.source_id::text
  FROM unique_src
 WHERE fb.enrolled_ref IS NULL AND fb.label = unique_src.label;
