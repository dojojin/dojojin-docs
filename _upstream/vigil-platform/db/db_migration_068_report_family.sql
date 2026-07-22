-- ============================================================
-- Migration 068: R4 — report_family (content-type axis) + section_config
-- ============================================================
-- Separates content type (report_family) from cadence (report_type).
-- report_family: analytics | health | face | lpr
-- report_type: daily | weekly | monthly | health (health legacy, now redundant when family=health)
-- section_config: JSONB for face/lpr-specific sections (generic, future use)
--
-- Backfills existing health rows: report_type='health' → report_family='health'
-- Also adds report_family to report_history for accurate history display

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS report_family VARCHAR(16) NOT NULL DEFAULT 'analytics'
    CHECK (report_family IN ('analytics','health','face','lpr'));

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS section_config JSONB;

-- Backfill: existing health schedules get family='health'
UPDATE report_schedules
  SET report_family = 'health'
  WHERE report_type = 'health' AND report_family = 'analytics';

-- report_history: add family column (null for historical rows pre-R4)
ALTER TABLE report_history
  ADD COLUMN IF NOT EXISTS report_family VARCHAR(16);
