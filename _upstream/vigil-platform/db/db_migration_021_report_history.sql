-- ============================================================
-- Migration 021: report_history — Ph.2 Report History
-- ============================================================
-- Logs every scheduled (and manual) report send attempt.
-- schedule_id ON DELETE SET NULL so history survives schedule deletion.
-- file_path stores only the filename; served via /api/report-history/:id/image.
-- ============================================================

CREATE TABLE IF NOT EXISTS report_history (
  id               SERIAL PRIMARY KEY,
  schedule_id      INT REFERENCES report_schedules(id) ON DELETE SET NULL,
  report_type      VARCHAR(16) NOT NULL,
  range_from       TIMESTAMPTZ,
  range_to         TIMESTAMPTZ,
  image_layout     VARCHAR(12),
  file_path        TEXT,
  recipients_sent  TEXT,
  sent_count       INT DEFAULT 0,
  total_recipients INT DEFAULT 0,
  status           VARCHAR(24) NOT NULL,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_history_created ON report_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_history_schedule ON report_history(schedule_id);
