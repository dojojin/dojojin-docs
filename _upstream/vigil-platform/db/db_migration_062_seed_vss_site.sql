-- ============================================================
-- Vigil Platform — Migration 062: Seed VSS site
-- Adds VSS (office ingester) to the sites lookup table.
-- ============================================================

INSERT INTO sites (code, name, color)
VALUES ('vss', 'VSS', '#8b5cf6')
ON CONFLICT (code) DO NOTHING;
