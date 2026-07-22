-- ============================================================
-- Vigil Platform — migration 072: edge snapshot inventory
-- Edge bridge heartbeat now reports snapshot retention state (oldest date-dir
-- + date-dir count) so central can see whether edge-side pruning is working.
-- Idempotent.
-- ============================================================

ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS snapshot_oldest date;
ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS snapshot_dirs    int;
