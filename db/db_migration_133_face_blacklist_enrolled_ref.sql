-- ============================================================
-- Vigil Platform — face_blacklist re-run safety for HCP enrollment
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- scripts/enroll_face_blacklist_from_hcp.js needs to skip source_records it
-- already enrolled on a re-run (e.g. after an HCP re-sync brings new
-- identities) without re-embedding or duplicating the 1,496 rows from the
-- first run. face_blacklist had no column to check against — label alone
-- isn't unique (two different people can share a display name) and isn't
-- a safe re-run key.
-- ============================================================

ALTER TABLE face_blacklist ADD COLUMN IF NOT EXISTS enrolled_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_face_blacklist_enrolled_ref ON face_blacklist (enrolled_ref);
