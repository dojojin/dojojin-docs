-- ============================================================
-- Migration: report_schedules — scheduled report delivery (Phase 7.3)
-- ============================================================
-- Stores when to auto-generate + send a report (daily / weekly /
-- monthly) and to whom. This migration (Phase 7.3 commit 1) lands the
-- config layer + scheduler; the PDF generation (commit 2, Puppeteer)
-- and email delivery (commit 3, nodemailer) fill in runScheduledReport.
--
--   send_time    — time-of-day to fire, in display_timezone
--   recipients   — CSV of email addresses (consumed by commit 3)
--   last_run_at  — set by the scheduler each time it fires (prevents
--                  double-fire within the same day)
--   last_status  — 'success' | 'failed' | 'pending' (NULL = never run)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE TRIGGER
-- (Postgres 16). trigger_set_updated_at() is defined in init.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS report_schedules (
  id            SERIAL PRIMARY KEY,
  report_type   VARCHAR(16)  NOT NULL DEFAULT 'daily'
                  CHECK (report_type IN ('daily', 'weekly', 'monthly')),
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  send_time     TIME         NOT NULL DEFAULT '08:00',
  recipients    TEXT         NOT NULL DEFAULT '',
  last_run_at   TIMESTAMPTZ,
  last_status   VARCHAR(24),
  last_error    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_report_schedules_updated
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
