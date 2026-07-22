-- Migration 049 — license_plates: add plate_image for crop filename
-- Idempotent: safe to re-run
ALTER TABLE license_plates
  ADD COLUMN IF NOT EXISTS plate_image VARCHAR(200);
