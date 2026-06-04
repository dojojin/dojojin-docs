-- ============================================================
-- Migration: Phase 6.1 — Pre-alarm video clip capture
-- ============================================================
-- Adds per-camera config for media-recorder.js (server-side RTSP
-- rolling buffer) plus per-event clip metadata.
--
-- Pivot from FTP-RAM-buffer push (Phase 6.0 spike — proven dead-end
-- because Bosch Recording Profiles require local SD storage).
-- Instead, media-recorder.js subscribes to RTSP 24/7 per camera,
-- maintains a rolling buffer of MPEG-TS segments, and on alarm
-- dumps pre + post window to media/<event_id>.mp4.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── Per-camera toggles ──────────────────────────────────────
ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS enable_snapshot     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_vca_overlay  BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_clip_capture BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS clip_pre_sec        INT     DEFAULT 10,
  ADD COLUMN IF NOT EXISTS clip_post_sec       INT     DEFAULT 5;

-- ── Per-event clip metadata ─────────────────────────────────
-- clip_status: 'pending' (capture in progress), 'done' (file ready),
--              'failed' (ffmpeg/segments missing)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS clip_file         TEXT,
  ADD COLUMN IF NOT EXISTS clip_status       VARCHAR(16),
  ADD COLUMN IF NOT EXISTS clip_duration_sec REAL;

CREATE INDEX IF NOT EXISTS idx_events_clip_status ON events(clip_status)
  WHERE clip_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_has_clip    ON events(event_time DESC)
  WHERE clip_file IS NOT NULL;

-- ── Retention setting ───────────────────────────────────────
INSERT INTO system_settings (key, value, description) VALUES
  ('clip_retention_days', '30', 'Days of pre-alarm video clips to keep on disk (max 90).')
ON CONFLICT (key) DO NOTHING;
