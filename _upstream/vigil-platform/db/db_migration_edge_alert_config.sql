-- ============================================================
-- Migration: Edge-offline LINE alert settings on line_config
-- Adds one JSONB column holding the configurable settings for the
-- "Edge [SITE] ขาดการติดต่อ" alert produced by alert-engine.checkEdgeStale().
-- Defaults reproduce the previous hard-coded behaviour exactly:
--   enabled=true, threshold=180s (3m), cooldown=4h, all sites on,
--   all enabled recipients (recipient_ids=null).
-- Idempotent.
-- ============================================================

ALTER TABLE line_config
  ADD COLUMN IF NOT EXISTS edge_alert JSONB NOT NULL
    DEFAULT '{"enabled":true,"threshold_sec":180,"cooldown_hours":4,"disabled_sites":[],"recipient_ids":null}'::jsonb;
