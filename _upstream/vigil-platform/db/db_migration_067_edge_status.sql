-- ============================================================
-- Vigil Platform — migration 067: Edge status table
-- Stores last-seen heartbeat per edge site for Health dashboard.
-- FK → sites(code): code is UNIQUE; vss seeded in migration 062 (< 067).
-- ============================================================
CREATE TABLE IF NOT EXISTS edge_status (
  site_id          text PRIMARY KEY REFERENCES sites(code),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  disk_free_gb     numeric(6,1),
  disk_total_gb    numeric(6,1),
  bridge_forwarded bigint,
  bridge_dropped   bigint,
  bridge_remote    text,
  bridge_local     text,
  pm2_json         jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
