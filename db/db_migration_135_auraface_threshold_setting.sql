-- ============================================================
-- Vigil Platform — AuraFace-v1 match threshold as a system_settings row
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- Was AURAFACE_MATCH_THRESHOLD in .env only — required a restart to change
-- and had no UI. Owner asked for a UI-adjustable %, default 60 (owner,
-- 2026-08-10) — supersedes the 0.52 calibrated via labeled pairs
-- (face-embed-worker.js header, 2026-08-10): 60% is the new effective
-- default once face-embed-worker reads this row, more conservative than the
-- calibrated FP=0 point, adjustable from the Lab Test tab going forward.
-- Stored as an integer percentage (1-99), same convention as the existing
-- face_similarity_min setting — src/routes/settings.js divides by 100.
-- ============================================================

INSERT INTO system_settings (key, value, description)
VALUES ('auraface_match_threshold', '60', 'AuraFace-v1 blacklist match threshold (%, Internal Test & Development)')
ON CONFLICT (key) DO NOTHING;
