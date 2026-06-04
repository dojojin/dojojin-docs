-- ============================================================
-- Migration 037 — cameras: add paused flag (maintenance mode)
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP/ADD constraint
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — only paused cameras; keeps watchdog skip-check fast
CREATE INDEX IF NOT EXISTS idx_cameras_paused ON cameras(id) WHERE paused = TRUE;

-- Extend camera_status_log CHECK to accept 'paused' and 'resumed'
ALTER TABLE camera_status_log
  DROP CONSTRAINT IF EXISTS camera_status_log_status_check;

ALTER TABLE camera_status_log
  ADD CONSTRAINT camera_status_log_status_check
    CHECK (status = ANY (ARRAY['online','offline','paused','resumed']));
