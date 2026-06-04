-- ============================================================
-- Migration: ONVIF-based recording status columns on cameras
-- Source: ONVIF Search service GetRecordingSummary (Profile G)
-- "recording active" = (NOW() - recording_data_until) < ~90s
-- Idempotent.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS recording_data_from  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recording_data_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recording_count      INT;
