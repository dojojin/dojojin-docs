-- ============================================================
-- DojoJin Tech Dashboard — Migration 018
-- Ph.1 Camera Offline Alert + Status Log
-- Idempotent: safe to re-run on an existing schema.
-- ============================================================

-- Transition history — one row per online↔offline change.
CREATE TABLE IF NOT EXISTS camera_status_log (
  id          BIGSERIAL    PRIMARY KEY,
  camera_id   TEXT         NOT NULL,
  status      TEXT         NOT NULL CHECK (status IN ('online','offline')),
  changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reason      TEXT
);

CREATE INDEX IF NOT EXISTS camera_status_log_cam_time
  ON camera_status_log (camera_id, changed_at DESC);

-- Per-camera offline alert config.
-- offline_since / last_alert_at are server-maintained (not user-edited);
-- they persist across restarts so the alert schedule survives a process
-- bounce while a camera is down.
-- quiet_from / quiet_to follow the same "QUIET window" semantics as
-- alert_rules (decision #90, gotcha #24): LINE is SILENCED when
-- now ∈ [quiet_from, quiet_to). Named quiet_* (not active_*) to avoid
-- the historical naming confusion.
CREATE TABLE IF NOT EXISTS camera_offline_alerts (
  camera_id              TEXT        PRIMARY KEY,
  enabled                BOOLEAN     NOT NULL DEFAULT FALSE,
  notify_after_sec       INT         NOT NULL DEFAULT 300,
  escalate_interval_min  INT         NOT NULL DEFAULT 60,
  quiet_from             TIME,
  quiet_to               TIME,
  recipient_ids          TEXT        NOT NULL DEFAULT '',
  offline_since          TIMESTAMPTZ,
  last_alert_at          TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
