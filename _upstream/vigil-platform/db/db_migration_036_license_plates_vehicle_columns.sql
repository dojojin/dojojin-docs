-- ============================================================
-- Migration 036 — license_plates: add vehicle_type/color/brand
-- Multi-vendor ANPR support (Hikvision/Dahua/PlateRecognizer)
-- Idempotent: ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE license_plates
  ADD COLUMN IF NOT EXISTS vehicle_type  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS vehicle_color VARCHAR(20),
  ADD COLUMN IF NOT EXISTS vehicle_brand VARCHAR(50);
