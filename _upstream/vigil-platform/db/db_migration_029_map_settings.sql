-- ============================================================
-- Vigil Platform — Migration 029: Map Settings
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- decision #171 — Map Settings page: Mapbox token moved from .env to DB
-- idempotent: ON CONFLICT DO NOTHING

INSERT INTO system_settings (key, value, description)
VALUES ('mapbox_token', '', 'Mapbox public token (pk.) for detailed tile layers. Set via Settings → Map.')
ON CONFLICT (key) DO NOTHING;
