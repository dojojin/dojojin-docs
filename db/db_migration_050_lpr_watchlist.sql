-- Migration 050: LPR watchlist table
-- Idempotent: safe to re-run
CREATE TABLE IF NOT EXISTS lpr_watchlist (
  plate_number TEXT PRIMARY KEY,
  label        TEXT,
  notes        TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lpr_watchlist_active ON lpr_watchlist(active);
