-- ============================================================
-- Vigil Platform — MANUAL Migration: Partition events table (Option A)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- Strategy: Option A — drop FK on appearances/license_plates,
--   convert events to PARTITION BY RANGE(event_time), monthly partitions.
--   Retention code in api-server.js already updated to explicit-delete
--   children before events (no cascade required after migration).
-- ============================================================
-- ⚠️  MANUAL_ prefix intentional — migrate.js does NOT auto-run this file.
-- ⚠️  PREREQUISITE: Take a full backup before running:
--       pg_dump -Fc vigil_platform > vigil_platform_$(date +%Y%m%d_%H%M).dump
-- ⚠️  DOWNTIME: Step 4 holds EXCLUSIVE LOCK on events while copying data
--     and swapping tables.  At ~63K rows / 42 MB this is typically 3-15s.
--     Stop api-server + mqtt-ingesters + media-recorder first to minimise
--     the lock window (services can be restarted immediately after COMMIT).
-- ⚠️  AFTER RUNNING: add one new monthly partition before each new month
--     (Step 7 template). events_default catches any rows if you miss a month.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Step 0: Safety guard
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'events'     AND relkind = 'p') THEN
    RAISE EXCEPTION 'events is already partitioned — migration already applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'events_new' AND relkind IN ('r','p')) THEN
    RAISE EXCEPTION 'events_new already exists — prior run may have stalled; inspect and clean up manually';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Step 1: Create partitioned parent (borrows existing events_id_seq)
--   Composite PK (id, event_time) required by PG declarative partitioning.
--   No lock on events yet.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE events_new (
  id                  BIGINT         NOT NULL DEFAULT nextval('events_id_seq'::regclass),
  camera_id           VARCHAR(100)   NOT NULL,
  event_time          TIMESTAMPTZ    NOT NULL,
  received_at         TIMESTAMPTZ             DEFAULT NOW(),
  event_type          VARCHAR(50),
  event_category      VARCHAR(50),
  event_state         VARCHAR(20),
  rule_name           VARCHAR(150),
  object_id           VARCHAR(50),
  object_class        VARCHAR(30),
  likelihood          REAL,
  snapshot_filename   VARCHAR(255),
  has_snapshot        BOOLEAN                 DEFAULT false,
  clip_file           TEXT,
  clip_status         VARCHAR(16),
  clip_duration_sec   REAL,
  raw_json            JSONB
) PARTITION BY RANGE (event_time);

ALTER TABLE events_new ADD PRIMARY KEY (id, event_time);

-- ─────────────────────────────────────────────────────────────
-- Step 2: Create monthly child partitions (2026-01 → 2027-12)
--   + DEFAULT partition catches out-of-range rows.
--   Add new months monthly (Step 7 template) before each month starts.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE events_y2026m01 PARTITION OF events_new FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE events_y2026m02 PARTITION OF events_new FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE events_y2026m03 PARTITION OF events_new FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE events_y2026m04 PARTITION OF events_new FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE events_y2026m05 PARTITION OF events_new FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE events_y2026m06 PARTITION OF events_new FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE events_y2026m07 PARTITION OF events_new FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE events_y2026m08 PARTITION OF events_new FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE events_y2026m09 PARTITION OF events_new FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE events_y2026m10 PARTITION OF events_new FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE events_y2026m11 PARTITION OF events_new FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE events_y2026m12 PARTITION OF events_new FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE events_y2027m01 PARTITION OF events_new FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE events_y2027m02 PARTITION OF events_new FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE events_y2027m03 PARTITION OF events_new FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE events_y2027m04 PARTITION OF events_new FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE events_y2027m05 PARTITION OF events_new FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE events_y2027m06 PARTITION OF events_new FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE events_y2027m07 PARTITION OF events_new FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE events_y2027m08 PARTITION OF events_new FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE events_y2027m09 PARTITION OF events_new FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE events_y2027m10 PARTITION OF events_new FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE events_y2027m11 PARTITION OF events_new FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE events_y2027m12 PARTITION OF events_new FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE events_default   PARTITION OF events_new DEFAULT;

-- ─────────────────────────────────────────────────────────────
-- Step 3: Create indexes on events_new using TEMPORARY names (idx_enew_*)
--   Must use different names from events' existing indexes, which are still
--   active at this point (events is still the live table until Step 4).
--   PG 12+ propagates parent indexes to existing + future child partitions.
-- ─────────────────────────────────────────────────────────────
CREATE INDEX idx_enew_camera               ON events_new(camera_id);
CREATE INDEX idx_enew_time                 ON events_new(event_time DESC);
CREATE INDEX idx_enew_type                 ON events_new(event_type);
CREATE INDEX idx_enew_rule                 ON events_new(rule_name);
CREATE INDEX idx_enew_class                ON events_new(object_class);
CREATE INDEX idx_enew_camera_time          ON events_new(camera_id, event_time DESC);
CREATE INDEX idx_enew_has_snapshot_time    ON events_new(event_time DESC)              WHERE has_snapshot = true;
CREATE INDEX idx_enew_camera_snapshot_time ON events_new(camera_id, event_time DESC)   WHERE has_snapshot = true;
CREATE INDEX idx_enew_clip_status          ON events_new(clip_status)                  WHERE clip_status IS NOT NULL;
CREATE INDEX idx_enew_has_clip             ON events_new(event_time DESC)              WHERE clip_file IS NOT NULL;
CREATE INDEX idx_enew_type_trgm            ON events_new USING gin(event_type gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- Step 4: Atomic swap under EXCLUSIVE lock (~3-15s downtime)
--   Copy happens inside the lock to capture UPDATE side-effects
--   (clip_status pending→done, has_snapshot, snapshot_filename set by
--   media-recorder and ingester code after initial INSERT).
--   With services stopped before this step, the lock window is
--   just the copy + DDL (~3-15s for 63K rows / 42 MB).
-- ─────────────────────────────────────────────────────────────
BEGIN;

  LOCK TABLE events IN EXCLUSIVE MODE;

  -- Copy all rows (column-explicit to guard against column-order drift)
  INSERT INTO events_new (
    id, camera_id, event_time, received_at,
    event_type, event_category, event_state, rule_name,
    object_id, object_class, likelihood,
    snapshot_filename, has_snapshot,
    clip_file, clip_status, clip_duration_sec,
    raw_json
  )
  SELECT
    id, camera_id, event_time, received_at,
    event_type, event_category, event_state, rule_name,
    object_id, object_class, likelihood,
    snapshot_filename, has_snapshot,
    clip_file, clip_status, clip_duration_sec,
    raw_json
  FROM events;

  -- Drop FK constraints (Option A: referential integrity no longer maintained;
  --   retention + camera-delete code handle explicit child deletes)
  ALTER TABLE appearances    DROP CONSTRAINT appearances_event_id_fkey;
  ALTER TABLE license_plates DROP CONSTRAINT license_plates_event_id_fkey;

  -- Rename: live plain table → events_old; partitioned table → events
  ALTER TABLE events     RENAME TO events_old;
  ALTER TABLE events_new RENAME TO events;

  -- Transfer sequence ownership so DROP TABLE events_old does not drop events_id_seq
  ALTER SEQUENCE events_id_seq OWNED BY events.id;

  -- Drop v_events_public (it now references events_old after the rename above;
  --   recreated in Step 5 pointing at the new partitioned events)
  DROP VIEW v_events_public;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- Step 5: Drop original table (sequence safely re-owned); recreate view
-- ─────────────────────────────────────────────────────────────
DROP TABLE events_old;

CREATE VIEW v_events_public AS
  SELECT id, camera_id, event_time, received_at,
         event_type, event_category, event_state, rule_name,
         object_id, object_class, likelihood,
         snapshot_filename, has_snapshot,
         clip_file, clip_status, clip_duration_sec
  FROM events;

-- ─────────────────────────────────────────────────────────────
-- Step 6: Rename parent indexes to canonical names
--   (Child partition indexes are auto-named by PG and unchanged)
-- ─────────────────────────────────────────────────────────────
ALTER INDEX events_new_pkey               RENAME TO events_pkey;
ALTER INDEX idx_enew_camera               RENAME TO idx_events_camera;
ALTER INDEX idx_enew_time                 RENAME TO idx_events_time;
ALTER INDEX idx_enew_type                 RENAME TO idx_events_type;
ALTER INDEX idx_enew_rule                 RENAME TO idx_events_rule;
ALTER INDEX idx_enew_class                RENAME TO idx_events_class;
ALTER INDEX idx_enew_camera_time          RENAME TO idx_events_camera_time;
ALTER INDEX idx_enew_has_snapshot_time    RENAME TO idx_events_has_snapshot_time;
ALTER INDEX idx_enew_camera_snapshot_time RENAME TO idx_events_camera_snapshot_time;
ALTER INDEX idx_enew_clip_status          RENAME TO idx_events_clip_status;
ALTER INDEX idx_enew_has_clip             RENAME TO idx_events_has_clip;
ALTER INDEX idx_enew_type_trgm            RENAME TO idx_events_type_trgm;

-- ─────────────────────────────────────────────────────────────
-- Step 7: Verify
-- ─────────────────────────────────────────────────────────────
-- Run after applying:
--   \d+ events
--   SELECT relname, relkind FROM pg_class WHERE relname LIKE 'events%' ORDER BY 1;
--   SELECT COUNT(*) FROM events;                         -- must equal original count
--   SELECT tableoid::regclass, COUNT(*) FROM events GROUP BY 1 ORDER BY 1;
--   SELECT last_value FROM events_id_seq;                -- must be intact
--   SELECT indexname FROM pg_indexes WHERE tablename = 'events' ORDER BY 1;

-- ─────────────────────────────────────────────────────────────
-- Step 8: Monthly partition maintenance (add before each new month)
-- ─────────────────────────────────────────────────────────────
-- Template — replace YYYY-MM and upper bound:
--   CREATE TABLE events_yYYYYmMM PARTITION OF events
--     FOR VALUES FROM ('YYYY-MM-01') TO ('YYYY-nextMM-01');
--
-- Example for 2028-01 (run during December 2027):
--   CREATE TABLE events_y2028m01 PARTITION OF events
--     FOR VALUES FROM ('2028-01-01') TO ('2028-02-01');
--
-- The events_default partition catches rows if a month is missed.
-- Rows can be moved retroactively:
--   ALTER TABLE events DETACH PARTITION events_default;
--   -- (insert missing month partition, move rows, reattach default)
