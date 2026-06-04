-- ============================================================
-- Migration: report_schedules.image_layout (Phase 7.3 commit 3)
-- ============================================================
-- Scheduled reports are delivered to LINE as an image (LINE's
-- Messaging API can't attach a PDF). image_layout lets the operator
-- pick per-schedule:
--   'compact' — phone-friendly summary (key numbers + top items)
--   'full'    — the full report rendered as a tall image
-- Default 'compact' — readable on a phone without zooming.
--
-- The `recipients` column (added in migration 013) now holds a CSV of
-- LINE recipient IDs (was nominally email); same TEXT type, no change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK constraint.
-- ============================================================

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS image_layout VARCHAR(16) NOT NULL DEFAULT 'compact';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_schedules_image_layout_check'
  ) THEN
    ALTER TABLE report_schedules
      ADD CONSTRAINT report_schedules_image_layout_check
      CHECK (image_layout IN ('compact', 'full'));
  END IF;
END $$;
