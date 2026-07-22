-- Migration 046: normalize appearances casing and value mapping
-- BOSCH stores Title Case ("LongSleeve", "Gray"); Hikvision stored camelCase/lowercase
-- ("longSleeve", "gray") before ingestion fix. Hikvision also uses different bottom
-- category names ("longTrousers" vs BOSCH "Trousers") — map to canonical values.
-- Idempotent: WHERE guards skip already-normalized rows.

DO $$
BEGIN
  -- Normalize first-character casing for top_category (longSleeve→LongSleeve etc.)
  UPDATE appearances
    SET top_category = CONCAT(UPPER(LEFT(top_category, 1)), SUBSTRING(top_category, 2))
    WHERE top_category IS NOT NULL
      AND top_category != CONCAT(UPPER(LEFT(top_category, 1)), SUBSTRING(top_category, 2));

  -- Map Hikvision bottom category names to canonical BOSCH names
  UPDATE appearances SET bottom_category = 'Trousers' WHERE bottom_category IN ('longTrousers', 'LongTrousers');
  UPDATE appearances SET bottom_category = 'Shorts'   WHERE bottom_category IN ('shortTrousers', 'ShortTrousers');
  UPDATE appearances SET bottom_category = 'Skirt'    WHERE bottom_category = 'skirt';
  UPDATE appearances SET bottom_category = 'Dress'    WHERE bottom_category = 'dress';

  -- Normalize first-character casing for any remaining bottom_category
  UPDATE appearances
    SET bottom_category = CONCAT(UPPER(LEFT(bottom_category, 1)), SUBSTRING(bottom_category, 2))
    WHERE bottom_category IS NOT NULL
      AND bottom_category != CONCAT(UPPER(LEFT(bottom_category, 1)), SUBSTRING(bottom_category, 2));

  -- Normalize color casing (gray→Gray, black→Black etc.)
  UPDATE appearances
    SET upper_color = CONCAT(UPPER(LEFT(upper_color, 1)), SUBSTRING(upper_color, 2))
    WHERE upper_color IS NOT NULL
      AND upper_color != CONCAT(UPPER(LEFT(upper_color, 1)), SUBSTRING(upper_color, 2));

  -- Clear "Unknown" color values — Hikvision sends this when detection fails
  UPDATE appearances SET upper_color = NULL WHERE upper_color ILIKE 'unknown';
  UPDATE appearances SET lower_color = NULL WHERE lower_color ILIKE 'unknown';

  UPDATE appearances
    SET lower_color = CONCAT(UPPER(LEFT(lower_color, 1)), SUBSTRING(lower_color, 2))
    WHERE lower_color IS NOT NULL
      AND lower_color != CONCAT(UPPER(LEFT(lower_color, 1)), SUBSTRING(lower_color, 2));
END $$;
