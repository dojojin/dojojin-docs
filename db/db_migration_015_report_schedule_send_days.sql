-- Phase 7.4 (2026-05-18) — pick which day(s) the weekly / monthly report
-- actually fires. Without this, an enabled weekly or monthly schedule fired
-- EVERY DAY at send_time (i.e. 7× or 30× more often than an operator
-- actually wants), which was the live behaviour in production until this
-- migration landed.

-- Weekly: 0=Mon..6=Sun (matches the heatmap convention used elsewhere in
-- the dashboard). NULL = fire every day (preserves the pre-migration
-- behaviour for legacy rows that haven't been edited yet).
ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS send_day_of_week smallint;

DO $$ BEGIN
  ALTER TABLE report_schedules ADD CONSTRAINT chk_send_day_of_week_range
    CHECK (send_day_of_week IS NULL OR (send_day_of_week >= 0 AND send_day_of_week <= 6));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN report_schedules.send_day_of_week IS
  'Used when report_type=weekly. 0=Mon..6=Sun. NULL = fire every day.';

-- Monthly: CSV of day-of-month tokens. Each token is either an integer
-- 1-31 OR the literal string "L" meaning "last day of the month" (handles
-- short months: Feb 28/29, Apr/Jun/Sep/Nov 30 — so the operator who
-- writes "L" gets the actual last day regardless of which month it is).
-- Examples: "1" / "1,15" / "15,L" / "L". NULL = fire every day.
ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS send_days_of_month text;

COMMENT ON COLUMN report_schedules.send_days_of_month IS
  'Used when report_type=monthly. CSV of day-of-month (1-31) or "L" for last day. NULL = fire every day.';
