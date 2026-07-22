-- Migration 077: manual sort order for the Camera Status grid
-- No backfill needed — NULL sort_order falls back to the camera's current
-- position in cameras-config.json at merge time (src/routes/cameras.js),
-- so this deploy is invisible until an admin actually reorders cameras.
-- Idempotent: safe to run multiple times.

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS sort_order INT;
