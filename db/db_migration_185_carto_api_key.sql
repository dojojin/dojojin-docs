-- ============================================================
-- Vigil Platform — Migration 185: CARTO API Key
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- CARTO raster basemaps now require an API key for requests.
-- This migration adds the carto_api_key setting to system_settings.
-- idempotent: ON CONFLICT DO NOTHING

INSERT INTO system_settings (key, value, description)
VALUES ('carto_api_key', '', 'CARTO API key for raster basemaps. Get one at https://carto.com/basemaps/apikey/ — set via Settings → Map.')
ON CONFLICT (key) DO NOTHING;
