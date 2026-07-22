-- Migration 051: LPR watchlist groups + per-entry alert config (Phase F)
-- Idempotent: safe to re-run.
--   - groups table (suspect/warrant/vip seeded) for colour-coded watchlist categories
--   - lpr_watchlist gains: group_id, alert_mode, region, ref_image, notify_line
-- NOTE (Phase F1): these columns STORE alert config only. The watchlist→LINE
-- matching engine is Phase F3 (notify_line is read by that future worker).

CREATE TABLE IF NOT EXISTS lpr_watchlist_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#5b8def',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lpr_watchlist_groups (id, name, color) VALUES
  ('suspect', 'รถผู้ต้องสงสัย', '#f59e0b'),
  ('warrant', 'รถตามหมายจับ',  '#ef4444'),
  ('vip',     'รถ VIP',         '#22c55e')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE lpr_watchlist
  ADD COLUMN IF NOT EXISTS group_id    TEXT REFERENCES lpr_watchlist_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alert_mode  TEXT NOT NULL DEFAULT 'plate',  -- 'plate' | 'plate_region'
  ADD COLUMN IF NOT EXISTS region      TEXT,
  ADD COLUMN IF NOT EXISTS ref_image   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS notify_line BOOLEAN NOT NULL DEFAULT TRUE;
