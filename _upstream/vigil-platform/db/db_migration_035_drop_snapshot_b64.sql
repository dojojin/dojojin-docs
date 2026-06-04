-- Migration 035: drop appearances.snapshot_b64
-- The column is written by mqtt-subscriber but never read by any endpoint.
-- appearances/search and appearances/stats both use e.snapshot_filename (on events)
-- for thumbnail display. Keeping this TEXT column wastes disk at scale
-- (raw base64 image per detection row).
-- Decision: drop entirely (user confirmed 2026-06-01, 455 existing rows discarded).

ALTER TABLE appearances DROP COLUMN IF EXISTS snapshot_b64;
