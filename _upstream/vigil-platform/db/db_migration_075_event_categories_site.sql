-- SC1: per-site event categories
-- Adds site_id to event_categories, drops global name unique,
-- adds per-site unique index + lookup index, backfills all existing
-- categories to main site (id=1, code='main') per D4 decision.
-- Idempotent: safe to re-run.

ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id);

ALTER TABLE event_categories DROP CONSTRAINT IF EXISTS event_categories_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_categories_site_name
  ON event_categories(site_id, name);

CREATE INDEX IF NOT EXISTS idx_event_categories_site
  ON event_categories(site_id, sort_order, id);

-- D4 backfill: assign all existing categories to main site
UPDATE event_categories
   SET site_id = (SELECT id FROM sites WHERE code = 'main')
 WHERE site_id IS NULL;
