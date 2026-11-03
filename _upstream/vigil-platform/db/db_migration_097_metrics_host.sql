-- ============================================================
-- Migration 097 — host metrics time-series (central + edge)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- WHY A TABLE AND NOT LOG FILES
-- The obvious cheap answer to "graph CPU over time" is to append to a file and
-- let logrotate age it out. It loses here for reasons specific to this system:
--
--   * backup.sh dumps Postgres and a fixed list of config paths, nothing else.
--     Metrics in files sit outside both, so a restore would silently come back
--     with no history at all.
--   * The samples already cross machines: edge sends them inside the MQTT
--     heartbeat that mqtt-subscriber consumes. Files do not help the transport,
--     they only remove the index at the far end.
--   * mqtt-subscriber writes and api-server reads — two PM2 processes. Files
--     plus rotation means races; Postgres does not.
--   * Files on the edge would make the graph unreadable exactly when the edge
--     link is down, which is when someone wants to look at it.
--
-- WHY IT IS AFFORDABLE
-- Three sources (central + two edges) at one sample a minute is 1.58M rows a
-- year, roughly 158MB with the index — against a 13GB database and 851GB free.
-- That is why there is no rollup tier here: an earlier draft had raw/5m/1h and
-- it was over-engineered for this row count. Add rollups if someone actually
-- asks for multi-year graphs.
--
-- Per-camera metrics are a different question (59 sources, ~20x) and are NOT in
-- this table — they get their own, at coarser resolution, when that phase lands.

CREATE TABLE IF NOT EXISTS metrics_host (
  -- 'central' or the edge site_id. Text rather than an FK: edge sites come and
  -- go from config, and losing their history on removal would defeat the point.
  source        TEXT        NOT NULL,
  sampled_at    TIMESTAMPTZ NOT NULL,
  -- Normalised 0-100 so central (20 cores) and an edge N150 (4 cores) can share
  -- one Y axis. Raw loadavg would make the small box look permanently idle.
  cpu_pct       REAL,
  load_avg_1m   REAL,
  mem_used_mb   INTEGER,
  mem_total_mb  INTEGER,
  disk_free_gb  REAL,
  disk_total_gb REAL,
  -- Counters as reported by the OS, monotonic until reboot. Stored raw, NOT as
  -- a rate: the reader computes deltas, so a missed sample degrades one gap
  -- instead of corrupting the series, and a counter reset is detectable
  -- (next < prev) rather than showing up as a colossal spike.
  net_rx_bytes  BIGINT,
  net_tx_bytes  BIGINT,
  net_iface     TEXT,
  PRIMARY KEY (source, sampled_at)
);

-- Every read is "one source, one time range, ascending" — the PK covers it.
-- The extra index is for the pruner, which sweeps across all sources by age.
CREATE INDEX IF NOT EXISTS metrics_host_time ON metrics_host (sampled_at);

-- Retention lives in system_settings beside the eight that are already there
-- (snapshot_retention_days, lpr_retention_days, clip_retention_days, ...) so it
-- is edited in the same place, by the same UI, with the same semantics.
INSERT INTO system_settings (key, value, description)
VALUES ('metrics_retention_days', '90',
        'Days of host performance samples (CPU/RAM/disk/network of central + each edge) to keep for the graphs (default 90, max 730). One sample a minute per machine — roughly 0.45MB per machine per month.')
ON CONFLICT (key) DO NOTHING;
