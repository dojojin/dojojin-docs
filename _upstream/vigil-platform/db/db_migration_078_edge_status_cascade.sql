-- Migration 078: cascade-delete edge_status when its site is deleted
-- edge_status is pure heartbeat/monitoring telemetry (not an audit trail) —
-- once a site is gone there's nothing meaningful left to keep it for. Without
-- this, DELETE /api/sites/:id 500s on any site whose edge ever sent a
-- heartbeat (FK violation surfaced as a raw, unexplained error).
-- Idempotent: safe to run multiple times.

ALTER TABLE edge_status DROP CONSTRAINT IF EXISTS edge_status_site_id_fkey;

ALTER TABLE edge_status
  ADD CONSTRAINT edge_status_site_id_fkey
  FOREIGN KEY (site_id) REFERENCES sites(code) ON DELETE CASCADE;
