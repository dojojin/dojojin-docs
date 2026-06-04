-- ============================================================
-- Migration: add SD-card recording status columns to cameras
-- Source: polled via Bosch RCP+ command 0x0CB5 (recording profile list)
-- Phase 1: store raw payload + record count for "responding/healthy"
-- visibility. Field meanings TBD (Phase 2 — state diff testing).
-- Idempotent.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS sd_last_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sd_status        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sd_record_count  INT,
  ADD COLUMN IF NOT EXISTS sd_response_len  INT,
  ADD COLUMN IF NOT EXISTS sd_raw_hex       TEXT,
  ADD COLUMN IF NOT EXISTS sd_error         TEXT;
