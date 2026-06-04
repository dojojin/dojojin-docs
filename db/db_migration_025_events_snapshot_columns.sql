-- ============================================================
-- Migration 025: Backfill and index event snapshot columns
-- The ingesters historically stored snapshot filenames in raw_json._snapshot.
-- Keep that metadata, but make the top-level columns useful for fast filters.
-- ============================================================

UPDATE events
   SET snapshot_filename = NULLIF(raw_json->>'_snapshot', ''),
       has_snapshot = TRUE
 WHERE NULLIF(raw_json->>'_snapshot', '') IS NOT NULL
   AND (
     snapshot_filename IS DISTINCT FROM NULLIF(raw_json->>'_snapshot', '')
     OR has_snapshot IS DISTINCT FROM TRUE
   );

UPDATE events
   SET has_snapshot = FALSE
 WHERE NULLIF(snapshot_filename, '') IS NULL
   AND has_snapshot IS DISTINCT FROM FALSE;

CREATE INDEX IF NOT EXISTS idx_events_has_snapshot_time
  ON events(event_time DESC)
  WHERE has_snapshot = TRUE;

CREATE INDEX IF NOT EXISTS idx_events_camera_snapshot_time
  ON events(camera_id, event_time DESC)
  WHERE has_snapshot = TRUE;
