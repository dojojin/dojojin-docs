-- ============================================================
-- Migration 031: IVA Pro Appearance attributes
-- ============================================================
-- WHY: extractAppearance() (src/mqtt-subscriber.js:712) tries to INSERT
--      columns that never existed in init.sql (hair_length, top_category,
--      etc.) → every INSERT fails silently since :735 was `catch (e) { }`.
--      SELECT count(*) FROM appearances = 0 despite 17 real events arriving.
--      Also adds object_class (present in init.sql but not always in live
--      volumes created before that column was added) + forensic-search indexes.
--      See BOSCH_IVA_Appearance.MD §2.3–§2.4 for full root-cause analysis.
--
-- APPROACH: additive ADD COLUMN IF NOT EXISTS — zero risk to existing data.
--           object_class already in current init.sql but may be absent on
--           live volumes; idempotent guard covers both cases.
--           Regular CREATE INDEX (not CONCURRENTLY) — migrate.js runs
--           inside BEGIN...COMMIT, CONCURRENTLY is disallowed in transactions.
--
-- SAFETY: fully idempotent (IF NOT EXISTS throughout); no column type changes;
--         no backfill here (optional Phase 3 handles existing raw_json).
-- ============================================================

-- IVA Pro Appearance — raw attributes from extractAppearance()
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS hair_length       VARCHAR(20);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS hair_color_xyz    VARCHAR(30);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS top_category      VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS top_color_xyz     VARCHAR(30);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS bottom_category   VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS bottom_color_xyz  VARCHAR(30);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS glasses           BOOLEAN;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS bag_category      VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS helmet_wear       BOOLEAN;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS helmet_subtype    VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS vest_style        VARCHAR(40);
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS snapshot_b64      TEXT;

-- object_class: present in current init.sql but absent on some live volumes
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS object_class      VARCHAR(30);

-- Indexes for forensic search queries (Phase 4) and 3rd-party view filtering
CREATE INDEX IF NOT EXISTS idx_appearances_class          ON appearances(object_class);
CREATE INDEX IF NOT EXISTS idx_appearances_gender         ON appearances(gender);
CREATE INDEX IF NOT EXISTS idx_appearances_top_category   ON appearances(top_category);
CREATE INDEX IF NOT EXISTS idx_appearances_bot_category   ON appearances(bottom_category);
