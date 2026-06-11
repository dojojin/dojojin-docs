-- ============================================================
-- Vigil Platform — Migration: Event Categories & Settings
-- ============================================================
-- Phase 1 (Stats v2 foundation):
--   • event_categories       — display-level grouping (user-defined + 2 builtin)
--   • event_category_rules   — many-to-many mapping (camera, rule, event_type, object_class) → category
--   • system_settings        — generic key/value (retention, timezone, dedup mode, ...)
--
-- Built-in categories (locked): "People Counting", "Vehicle Counting"
-- Default settings: retention=365 days, timezone=Asia/Bangkok, dedup=state
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── Ensure shared trigger function exists ───────────────────
-- (canonical in init.sql but live DB may pre-date it)
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── event_categories ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  icon        VARCHAR(20)  DEFAULT '🚨',
  color       VARCHAR(20)  DEFAULT '#5b8def',
  kind        VARCHAR(20)  NOT NULL DEFAULT 'event',
  is_builtin  BOOLEAN      NOT NULL DEFAULT false,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT event_categories_kind_chk
    CHECK (kind IN ('event', 'people_counter', 'vehicle_counter'))
);

CREATE INDEX IF NOT EXISTS idx_event_categories_sort
  ON event_categories (sort_order, id);

DROP TRIGGER IF EXISTS trg_event_categories_updated ON event_categories;
CREATE TRIGGER trg_event_categories_updated
  BEFORE UPDATE ON event_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── event_category_rules ────────────────────────────────────
-- All-match semantics: 1 event can match multiple categories.
-- Any column set to NULL acts as a wildcard.
CREATE TABLE IF NOT EXISTS event_category_rules (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES event_categories(id) ON DELETE CASCADE,
  camera_id     VARCHAR(80),
  rule_name     VARCHAR(200),
  event_type    VARCHAR(80),
  object_class  VARCHAR(40),
  match_state   VARCHAR(10) DEFAULT 'true',
  priority      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecr_category
  ON event_category_rules (category_id);
CREATE INDEX IF NOT EXISTS idx_ecr_camera
  ON event_category_rules (camera_id);

-- ── system_settings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(80) PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_system_settings_updated ON system_settings;
CREATE TRIGGER trg_system_settings_updated
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── Built-in categories (locked) ────────────────────────────
INSERT INTO event_categories (name, icon, color, kind, is_builtin, sort_order)
VALUES
  ('People Counting',  '🚶', '#22c55e', 'people_counter',  true, 1),
  ('Vehicle Counting', '🚗', '#5b8def', 'vehicle_counter', true, 2)
ON CONFLICT (name) DO NOTHING;

-- ── Default settings ────────────────────────────────────────
INSERT INTO system_settings (key, value, description) VALUES
  ('data_retention_days',  '365',           'Days of events to keep (max 730).'),
  ('display_timezone',     'Asia/Bangkok',  'Timezone for date boundaries / midnight reset.'),
  ('counter_dedup_mode',   'state',         'state | object_window | none'),
  ('comparison_mode',      'rolling',       'rolling | calendar — used by stats period comparison.'),
  ('custom_range_max_days', '365',          'Max span (days) for custom date range picker.')
ON CONFLICT (key) DO NOTHING;
