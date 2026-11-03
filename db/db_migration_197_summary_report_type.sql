-- ============================================================
-- Migration 197: CR.5 — add 'summary' report type
-- ============================================================
-- Extends report_schedules.report_type to support 'summary':
--   A summary report shows three time windows side-by-side:
--   1. Selected day (anchor)
--   2. 7 days ending on anchor (inclusive)
--   3. Calendar month containing anchor
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT
-- No table rewrite — CHECK constraint only.
-- ============================================================

DO $$
BEGIN
  ALTER TABLE report_schedules
    DROP CONSTRAINT IF EXISTS report_schedules_report_type_check;

  ALTER TABLE report_schedules
    ADD CONSTRAINT report_schedules_report_type_check
    CHECK (report_type IN ('daily', 'weekly', 'monthly', 'health', 'summary'));
END $$;
