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
-- ⚠️  DOWNTIME: Step 4 holds EXCLUSIVE LOCK on events while copying data,
--     verifying the copy, and swapping tables. The "3-15s" estimate below is
--     STALE — it was measured at ~63K rows / 42 MB when this script was
--     first written; the live table is ~1.7M rows / 1.4GB as of 2026-07-22
--     (27x larger) plus 11 index rebuilds under the same lock. MEASURE ACTUAL
--     DOWNTIME on a backup-restore rehearsal before scheduling a production
--     window — do not reuse the original estimate.
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
-- Step 0.5: Pre-flight schema-drift guard (2026-07-22)
--   This script was written against a snapshot of the `events` schema.
--   Columns added since (e.g. vehicle_type, migration 089) would be
--   silently dropped by Step 1/4's hardcoded column list otherwise —
--   found live during a re-check, see GOTCHAS/session notes 2026-07-22.
--   Compare the ACTUAL current column set against what this script
--   expects; abort loudly before touching any data if they differ.
--   Update EXPECTED_COLS below (and Step 1/4/5) whenever this fires.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected_cols text[] := ARRAY[
    'id','camera_id','event_time','received_at','event_type','event_category',
    'event_state','rule_name','object_id','object_class','likelihood',
    'snapshot_filename','has_snapshot','clip_file','clip_status',
    'clip_duration_sec','raw_json','vehicle_type'
  ];
  actual_cols text[];
  missing_from_script text[];
  missing_from_table  text[];
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO actual_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events';

  -- set difference via EXCEPT — clearer and less error-prone than nested
  -- array-containment checks (an earlier draft of this guard got this wrong).
  SELECT array_agg(c) INTO missing_from_script
    FROM (SELECT unnest(actual_cols) EXCEPT SELECT unnest(expected_cols)) AS d(c);
  SELECT array_agg(c) INTO missing_from_table
    FROM (SELECT unnest(expected_cols) EXCEPT SELECT unnest(actual_cols)) AS d(c);

  IF missing_from_script IS NOT NULL OR missing_from_table IS NOT NULL THEN
    RAISE EXCEPTION 'SCHEMA DRIFT — events columns changed since this script was written. % % — update EXPECTED_COLS + Step 1/4/5 before re-running.',
      CASE WHEN missing_from_script IS NOT NULL THEN 'events has columns this script does not know about: ' || array_to_string(missing_from_script, ', ') ELSE '' END,
      CASE WHEN missing_from_table  IS NOT NULL THEN 'script expects columns events no longer has: '      || array_to_string(missing_from_table,  ', ') ELSE '' END;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Step 0.6: Pre-flight FK-dependency guard (2026-07-22)
--   Same class of drift as Step 0.5, different object: found via rehearsal
--   that 3 FK constraints (face_event_notes, face_event_acks, lpr_alert_acks
--   — all added after this script was written) were not in Step 4's DROP
--   CONSTRAINT list. Undropped, they made Step 5's DROP TABLE events_old
--   fail AFTER Step 4 had already committed (stranded events_old + FKs
--   pointing at a table nothing else references). Compare live FK-children
--   of events against what Step 4 knows how to drop, before touching data.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  expected_fk_children text[] := ARRAY[
    'appearances','license_plates','face_event_notes','face_event_acks','lpr_alert_acks'
  ];
  actual_fk_children text[];
  unknown_children    text[];
BEGIN
  SELECT array_agg(DISTINCT conrelid::regclass::text) INTO actual_fk_children
    FROM pg_constraint WHERE confrelid = 'events'::regclass AND contype = 'f';

  SELECT array_agg(c) INTO unknown_children
    FROM (SELECT unnest(actual_fk_children) EXCEPT SELECT unnest(expected_fk_children)) AS d(c);

  IF unknown_children IS NOT NULL THEN
    RAISE EXCEPTION 'FK DEPENDENCY DRIFT — tables with a foreign key to events that Step 4 does not know how to drop: %. Add a DROP CONSTRAINT for each in Step 4 (and to expected_fk_children here, and to Step 7.5''s orphan checks) before re-running.',
      array_to_string(unknown_children, ', ');
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
  raw_json            JSONB,
  vehicle_type        VARCHAR(30)   -- added 2026-07-20 (migration 089); see Step 0.5 guard
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
CREATE INDEX idx_enew_time_id              ON events_new(event_time DESC, id DESC);   -- migration 071 / decision #211 (LPR keyset) — added after this script was first written
CREATE INDEX idx_enew_type                 ON events_new(event_type);
CREATE INDEX idx_enew_rule                 ON events_new(rule_name);
CREATE INDEX idx_enew_class                ON events_new(object_class);
CREATE INDEX idx_enew_camera_time          ON events_new(camera_id, event_time DESC);
CREATE INDEX idx_enew_has_snapshot_time    ON events_new(event_time DESC)              WHERE has_snapshot = true;
CREATE INDEX idx_enew_camera_snapshot_time ON events_new(camera_id, event_time DESC)   WHERE has_snapshot = true;
CREATE INDEX idx_enew_clip_status          ON events_new(clip_status)                  WHERE clip_status IS NOT NULL;
CREATE INDEX idx_enew_has_clip             ON events_new(event_time DESC)              WHERE clip_file IS NOT NULL;
-- idx_enew_type_trgm intentionally NOT recreated — migration 040 dropped the live
-- idx_events_type_trgm (1 lifetime scan, unused) before this script was fixed;
-- recreating it here would silently resurrect a deliberately-removed index.

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
    raw_json, vehicle_type
  )
  SELECT
    id, camera_id, event_time, received_at,
    event_type, event_category, event_state, rule_name,
    object_id, object_class, likelihood,
    snapshot_filename, has_snapshot,
    clip_file, clip_status, clip_duration_sec,
    raw_json, vehicle_type
  FROM events;

  -- Verify the copy INSIDE the transaction, before anything is renamed or
  -- dropped — a mismatch here RAISEs and rolls back this whole BEGIN block
  -- automatically (events_old is never created, events_new is dropped with
  -- the transaction, v_events_public is never touched). This is stronger
  -- than the original Step 7's post-commit COUNT(*) check, which could only
  -- discover a problem after events_old was already gone.
  DO $$
  DECLARE
    old_total bigint; new_total bigint;
    mismatch  text[];
    col       text;
  BEGIN
    SELECT COUNT(*) INTO old_total FROM events;
    SELECT COUNT(*) INTO new_total FROM events_new;
    IF old_total <> new_total THEN
      RAISE EXCEPTION 'row count mismatch: events=% events_new=%', old_total, new_total;
    END IF;

    FOREACH col IN ARRAY ARRAY[
      'camera_id','event_time','event_type','event_category','event_state','rule_name',
      'object_id','object_class','likelihood','snapshot_filename','has_snapshot',
      'clip_file','clip_status','clip_duration_sec','raw_json','vehicle_type'
    ] LOOP
      DECLARE
        old_notnull bigint; new_notnull bigint;
      BEGIN
        EXECUTE format('SELECT COUNT(*) FROM events WHERE %I IS NOT NULL', col) INTO old_notnull;
        EXECUTE format('SELECT COUNT(*) FROM events_new WHERE %I IS NOT NULL', col) INTO new_notnull;
        IF old_notnull <> new_notnull THEN
          mismatch := array_append(mismatch, format('%s (old=%s new=%s)', col, old_notnull, new_notnull));
        END IF;
      END;
    END LOOP;

    IF mismatch IS NOT NULL THEN
      RAISE EXCEPTION 'per-column NOT NULL count mismatch after copy: %', array_to_string(mismatch, '; ');
    END IF;

    RAISE NOTICE 'copy verified: % rows, all columns match (including vehicle_type)', new_total;
  END $$;

  -- Drop FK constraints (Option A: referential integrity no longer maintained;
  --   retention + camera-delete code handle explicit child deletes)
  ALTER TABLE appearances       DROP CONSTRAINT appearances_event_id_fkey;
  ALTER TABLE license_plates    DROP CONSTRAINT license_plates_event_id_fkey;
  -- Found via rehearsal (2026-07-22) — these 3 didn't exist when this script
  -- was first written; without dropping them, Step 5's DROP TABLE events_old
  -- fails ("other objects depend on it") AFTER Step 4 has already committed,
  -- leaving events_old stranded with FKs pointing at a table nothing else
  -- references any more. Step 0.6 guard below catches any *next* one of these.
  ALTER TABLE face_event_notes  DROP CONSTRAINT face_event_notes_event_id_fkey;
  ALTER TABLE face_event_acks   DROP CONSTRAINT face_event_acks_event_id_fkey;
  ALTER TABLE lpr_alert_acks    DROP CONSTRAINT lpr_alert_acks_event_id_fkey;

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
ALTER INDEX idx_enew_time_id              RENAME TO idx_events_time_id;
ALTER INDEX idx_enew_type                 RENAME TO idx_events_type;
ALTER INDEX idx_enew_rule                 RENAME TO idx_events_rule;
ALTER INDEX idx_enew_class                RENAME TO idx_events_class;
ALTER INDEX idx_enew_camera_time          RENAME TO idx_events_camera_time;
ALTER INDEX idx_enew_has_snapshot_time    RENAME TO idx_events_has_snapshot_time;
ALTER INDEX idx_enew_camera_snapshot_time RENAME TO idx_events_camera_snapshot_time;
ALTER INDEX idx_enew_clip_status          RENAME TO idx_events_clip_status;
ALTER INDEX idx_enew_has_clip             RENAME TO idx_events_has_clip;
-- idx_enew_type_trgm rename intentionally removed — see Step 3 note (migration 040 dropped it)

-- ─────────────────────────────────────────────────────────────
-- Step 7: Verify
--   Row count + per-column NOT NULL parity already ran INSIDE Step 4's
--   transaction (aborts automatically on mismatch, before anything is
--   renamed/dropped) — these are secondary structural checks, run after.
-- ─────────────────────────────────────────────────────────────
-- Run after applying:
--   \d+ events
--   SELECT relname, relkind FROM pg_class WHERE relname LIKE 'events%' ORDER BY 1;
--   SELECT COUNT(*) FROM events;                         -- must equal original count
--   SELECT tableoid::regclass, COUNT(*) FROM events GROUP BY 1 ORDER BY 1;
--   SELECT last_value FROM events_id_seq;                -- must be intact
--   SELECT indexname FROM pg_indexes WHERE tablename = 'events' ORDER BY 1;

-- ─────────────────────────────────────────────────────────────
-- Step 7.5: Orphan check (Option A dropped 5 FKs in Step 4 — nothing in the
--   DB enforces any of these .event_id -> events.id any longer). All 5 must
--   return 0 rows; expected to be 0 in THIS migration specifically because
--   ids are copied verbatim (1:1), but confirm rather than assume. Keep this
--   list in sync with Step 4's DROP CONSTRAINT list + Step 0.6's guard.
-- ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM appearances a
--   WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id);
-- SELECT COUNT(*) FROM license_plates lp
--   WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = lp.event_id);
-- SELECT COUNT(*) FROM face_event_notes n
--   WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = n.event_id);
-- SELECT COUNT(*) FROM face_event_acks a
--   WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id);
-- SELECT COUNT(*) FROM lpr_alert_acks a
--   WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id);

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
