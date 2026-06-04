-- ============================================================
-- Migration 022: add 'health' report type + health_sections (Ph.3)
-- ============================================================
-- Extends report_schedules to support System Health Reports:
--   report_type: adds 'health' to the CHECK constraint
--   health_sections: JSONB array of enabled section keys
--     e.g. ["camera_status","camera_uptime","alerts","storage","system"]
--     legacy ["cameras"] is expanded by the renderer for backward compat
--     NULL = all sections enabled (backward compat for existing rows)
-- ============================================================

ALTER TABLE report_schedules
  DROP CONSTRAINT IF EXISTS report_schedules_report_type_check;

ALTER TABLE report_schedules
  ADD CONSTRAINT report_schedules_report_type_check
  CHECK (report_type IN ('daily', 'weekly', 'monthly', 'health'));

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS health_sections JSONB;
