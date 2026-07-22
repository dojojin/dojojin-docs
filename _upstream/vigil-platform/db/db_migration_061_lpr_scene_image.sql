-- ============================================================
-- Vigil Platform — migration 061: LPR scene-image downscale settings
-- RF-IMG: store LPR scene frames at a capped resolution/quality instead of
-- the raw 5–9MP push. Defaults are the safety gate (resize-before-write in
-- lpr-core.js) so opening the data tap can't pile up full-size scenes.
-- The plate crop is left untouched (sharpest). Idempotent.
-- ============================================================
INSERT INTO system_settings (key, value, description) VALUES
  ('lpr_scene_resolution', '1080p', 'LPR scene image stored size cap: 720p | 1080p | 1440p (default 1080p)'),
  ('lpr_scene_quality',    '80',    'LPR scene JPEG quality 60–95 (default 80). Plate crop is not re-encoded.')
ON CONFLICT (key) DO NOTHING;
