-- ============================================================
-- Vigil Platform — migration 088: event_category_rules.vehicle_type
-- Lets a Mapping Rule target an LPR vehicle sub-type (license_plates.vehicle_type,
-- e.g. threeWheelVehicle) in addition to the coarse events.object_class. NULL =
-- wildcard (same convention as the rule's other columns). No backfill — existing
-- rules stay wildcard. See docs/superpowers/plans/2026-07-19-lpr-vehicle-type-category-rules.md
-- ============================================================
ALTER TABLE event_category_rules ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30);
