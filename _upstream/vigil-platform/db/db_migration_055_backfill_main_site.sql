-- ============================================================
-- Vigil Platform — Migration 055: Multi-Site — backfill
-- Maps all existing cameras + groups to Main Site.
-- Uses code='main' subquery — never hardcodes id.
-- WHERE site_id IS NULL makes this idempotent on re-run.
-- ============================================================

UPDATE cameras
  SET site_id = (SELECT id FROM sites WHERE code = 'main')
  WHERE site_id IS NULL;

UPDATE camera_groups
  SET site_id = (SELECT id FROM sites WHERE code = 'main')
  WHERE site_id IS NULL;
