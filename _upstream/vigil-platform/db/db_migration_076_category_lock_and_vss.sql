-- Migration 076: category lock column + move all categories to VSS
-- is_builtin → is_locked (user-controlled); all existing categories → site_id=4 (VSS)
-- Idempotent: safe to run multiple times

-- Step 1: add is_locked (idempotent)
ALTER TABLE event_categories
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: copy is_builtin → is_locked only if is_builtin still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='event_categories' AND column_name='is_builtin'
  ) THEN
    UPDATE event_categories SET is_locked = is_builtin;
  END IF;
END $$;

-- Step 3: move all categories to VSS (site_id=4)
UPDATE event_categories SET site_id = 4;

-- Step 4: drop view (depends on is_builtin), drop column, recreate view with is_locked
DROP VIEW IF EXISTS v_event_categories_public;

ALTER TABLE event_categories DROP COLUMN IF EXISTS is_builtin;

CREATE OR REPLACE VIEW v_event_categories_public AS
  SELECT id, name, icon, color, kind, is_locked, sort_order, created_at, updated_at
  FROM event_categories;
