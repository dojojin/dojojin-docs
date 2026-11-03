-- ============================================================
-- Migration 162 — one bridge-owned face_blacklist row per identity
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- lpr_watchlist gets this for free — plate_number is its primary key, so
-- ON CONFLICT (plate_number) is the whole upsert story. face_blacklist's PK
-- is a bare bigserial id, so without this, a re-sync would have no way to
-- find "the bridge row for this master" and would insert a duplicate every
-- time instead of updating. Partial: manual rows (origin<>'blacklist_bridge')
-- are untouched and may have NULL blacklist_master_id.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_blacklist_bridge_master
  ON face_blacklist(blacklist_master_id) WHERE origin = 'blacklist_bridge';
