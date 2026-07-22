-- Migration: LPR gates (RF4) — operator-defined entry/exit points.
-- Each gate maps a camera's lanes to a direction (in/out/none) so plate events
-- can later be split by direction (RF5 chart) and filtered by gate. Small
-- operator config (a handful of rows). Idempotent (CREATE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS lpr_gates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  camera_id  TEXT,
  rules      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { "1":"in", "2":"out", "3":"none" }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
