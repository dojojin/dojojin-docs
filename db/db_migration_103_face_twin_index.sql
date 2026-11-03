-- ============================================================
-- Vigil Platform — migration 103: index the Dahua face-twin lookup
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Four routes (faces, appearances, events, stats) suppress the Dahua NVR's
-- FaceDetector/Recognized twin by asking, per candidate row, whether a
-- FaceDetector/Comparison sibling exists on the same camera with the same
-- NVR ObjectID inside a 60s bracket. Nothing indexed that lookup, so each of
-- the ~33k Recognized rows drove a scan with a JSON extraction per candidate:
-- ~2ms each, and /api/appearances/search took 66.5s — long enough that the
-- browser gave up and the page looked empty rather than slow.
--
-- The Comparison side is tiny (27,017 rows against 5.3M events), so a partial
-- expression index over just those rows turns each probe into an index lookup.
-- Measured on events_y2026m07: 66.45s -> 5.55s for the same count, index 1.3MB,
-- built in 1.0s. What remains is the appearances x events join itself, which
-- cannot prune partitions because it joins on id alone — a separate problem.
--
-- Partitioned-table mechanics: the index is created ON ONLY the parent (empty,
-- invalid) and each partition's index is attached to it. That is what makes
-- future partitions inherit it automatically — without it, August's data would
-- have landed unindexed two days from now and the 66s would have come straight
-- back. events_y2026m07 already carries this index, built earlier with
-- CONCURRENTLY so live ingest was never blocked; it is attached here rather
-- than rebuilt. The migration runner wraps every file in a transaction, so
-- CONCURRENTLY cannot be used here — every remaining partition is empty
-- (104 kB) and builds instantly, so it does not need to be.
-- ============================================================

-- Parent index: no data of its own, becomes valid once every partition attaches.
CREATE INDEX IF NOT EXISTS idx_events_facecmp_oid
  ON ONLY events (camera_id, ((raw_json->'data'->'Face'->>'ObjectID')), event_time)
  WHERE event_type = 'FaceDetector/Comparison';

DO $$
DECLARE
  part   text;
  child  text;
BEGIN
  FOR part IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c  ON c.oid = i.inhrelid
      JOIN pg_class pc ON pc.oid = i.inhparent
     WHERE pc.relname = 'events'
     ORDER BY c.relname
  LOOP
    child := 'idx_events_facecmp_oid_' || substring(part from 'events_(.*)');

    -- events_y2026m07's index was already built CONCURRENTLY under a different
    -- name; reuse it instead of building a second copy of the same thing.
    IF part = 'events_y2026m07'
       AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_events_facecmp_oid_y2026m07') THEN
      child := 'idx_events_facecmp_oid_y2026m07';
    ELSIF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = child) THEN
      EXECUTE format(
        'CREATE INDEX %I ON %I (camera_id, ((raw_json->''data''->''Face''->>''ObjectID'')), event_time)'
        || ' WHERE event_type = ''FaceDetector/Comparison''', child, part);
    END IF;

    -- Attaching an index that is already attached raises; skip those so the
    -- file stays idempotent (the runner may replay it on a fresh volume).
    IF NOT EXISTS (
      SELECT 1 FROM pg_inherits ii
        JOIN pg_class ic ON ic.oid = ii.inhrelid
        JOIN pg_class pi ON pi.oid = ii.inhparent
       WHERE ic.relname = child AND pi.relname = 'idx_events_facecmp_oid'
    ) THEN
      EXECUTE format('ALTER INDEX idx_events_facecmp_oid ATTACH PARTITION %I', child);
    END IF;
  END LOOP;
END $$;
