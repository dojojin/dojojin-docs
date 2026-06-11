-- ============================================================
-- Vigil Platform — Migration 033: hair_color (named)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- WHY: hair_color_xyz stores raw Bosch XYZ (e.g. "153,102,51") but
--      no human-readable named column exists, unlike top/bottom which
--      have upper_color/lower_color. This mirrors migration 031 approach:
--      raw XYZ stays for color swatch display; named column for filtering
--      and Thai UI labels.
-- APPROACH: ADD COLUMN IF NOT EXISTS (idempotent); extractAppearance()
--      already calls xyzToColorName() — add hair_color to INSERT in
--      mqtt-subscriber.js (same pattern as upper_color/lower_color).
-- NOTE: Bosch CM hair palette = 5 colors (Black/Brown/Gray/Blonde/Auburn).
--      Blonde=184,139,80 (confirmed); Auburn estimated until camera emits it.
-- ============================================================

ALTER TABLE appearances ADD COLUMN IF NOT EXISTS hair_color VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_appearances_hair_color ON appearances(hair_color);
