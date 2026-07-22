-- Migration 084 — LPR plate registration type (from the plate's colour).
-- Dahua ANPR reports the plate background colour; in Thailand that colour is the
-- registration category (white=private, yellow=public, red=temporary, black=
-- foreign/government, blue=diplomatic, green=rental). Derived at ingest by
-- helpers/plateType.js and backfilled from raw_json for history. Idempotent.
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS plate_type VARCHAR(60);
CREATE INDEX IF NOT EXISTS idx_lpr_plate_type ON license_plates (plate_type);
