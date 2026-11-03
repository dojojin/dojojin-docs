-- ============================================================
-- Migration 160 — per-camera snapshot source mode
-- ============================================================
-- enable_snapshot (db_migration_clip_capture.sql) is the master
-- kill-switch — off means no image capture at all, MQTT or HTTP.
-- This adds a second, independent knob for WHEN it's on: which
-- source(s) to use. Motivated by high-frequency counting rules
-- (e.g. a Bosch "Vehicle Count" line-crossing rule firing every
-- 1-2s) where the per-event HTTP full-scene fetch — done
-- unconditionally today regardless of whether the event already
-- carries an MQTT-embedded crop — was the dominant cost (2.5GB/day
-- of edge disk + bandwidth for one camera on one site).
--
-- 'both'       — current behaviour, unchanged (default)
-- 'mqtt_only'  — never fetch the HTTP full-scene image; if the
--                camera didn't attach Appearance.Image to this
--                event, it simply has no snapshot
-- 'http_only'  — ignore an MQTT-embedded crop even if present,
--                always use the HTTP full-scene fetch
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS snapshot_mode VARCHAR(16) DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cameras_snapshot_mode_check'
  ) THEN
    ALTER TABLE cameras
      ADD CONSTRAINT cameras_snapshot_mode_check
      CHECK (snapshot_mode IN ('both', 'mqtt_only', 'http_only'));
  END IF;
END $$;

UPDATE cameras SET snapshot_mode = 'both' WHERE snapshot_mode IS NULL;
