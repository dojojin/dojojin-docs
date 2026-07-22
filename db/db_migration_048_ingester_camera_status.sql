-- migration 048: live ingester connection state per camera (B2b diagnostics)
-- Written by dahua-cgi.js on state transitions; read by health.js.
CREATE TABLE IF NOT EXISTS ingester_camera_status (
  camera_id             TEXT        PRIMARY KEY,
  event_stream          TEXT,       -- 'connected' | 'reconnecting'
  snap_stream           TEXT,       -- 'connected' | 'reconnecting' | 'disabled'
  retry_count           INT         NOT NULL DEFAULT 0,
  last_event_http_status INT,
  last_snap_http_status  INT,
  last_error_code       TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
