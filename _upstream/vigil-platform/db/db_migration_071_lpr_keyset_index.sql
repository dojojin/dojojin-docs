-- ============================================================
-- Vigil Platform — migration 071: keyset pagination index (LPR search P1)
-- Stable seek + sort for keyset pagination on the LPR/event list:
--   ORDER BY event_time DESC, id DESC  +  WHERE (event_time, id) < (cursor)
-- Replaces OFFSET (O(offset) scan) with an index seek (O(log n)) — constant
-- time at any depth, the key change for ~10M rows/month at full deploy.
-- Idempotent. Plain CREATE INDEX (fast at current ~120k rows; use CONCURRENTLY
-- by hand if ever rebuilt on a large live table).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_time_id ON events (event_time DESC, id DESC);
