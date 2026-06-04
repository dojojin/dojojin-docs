-- Migration 019: add escalate_once flag to camera_offline_alerts
-- escalate_once=TRUE → send LINE only on first offline event, never repeat

ALTER TABLE camera_offline_alerts
  ADD COLUMN IF NOT EXISTS escalate_once BOOLEAN NOT NULL DEFAULT FALSE;
