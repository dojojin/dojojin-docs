-- ============================================================
-- Vigil Platform — Migration 052: Multi-Site — sites table
-- Creates the sites lookup table and seeds 3 initial sites.
-- ============================================================

CREATE TABLE IF NOT EXISTS sites (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  color       VARCHAR(7)  NOT NULL DEFAULT '#5B8DEF',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sites (code, name, color) VALUES
  ('main',   'Main Site', '#5b8def'),
  ('bma',    'BMA',       '#22c55e'),
  ('phuket', 'ภูเก็ต',   '#f59e0b')
ON CONFLICT (code) DO NOTHING;
