-- ============================================================
-- Migration 161 — blacklist -> face_blacklist bridge rules (FB1)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- Face's equivalent of migration 096 (blacklist -> lpr_watchlist bridge
-- rules). A SEPARATE table rather than reusing blacklist.bridge_rules,
-- deliberately: that table's target_group_id FKs to lpr_watchlist_groups,
-- enrollment here needs an extra synchronous embedding step LPR never had
-- (edge /face-engine-embed-query), and blacklistBridge.js's LPR path is
-- proven and shipped today — a shared table would mean threading a
-- data_type branch through code that has no reason to change. Owner's
-- call, 2026-08-19.
--
-- face_blacklist has no link back to blacklist.master at all yet
-- (enrolled_ref/hcp_person_id are free-text leftovers from an earlier,
-- never-wired attempt — checked, nothing in the codebase reads them).
-- blacklist_master_id mirrors lpr_watchlist's own column exactly (bare
-- bigint, no FK — same as lpr_watchlist.blacklist_master_id) so the same
-- "richest wins" master resolution used for LPR can back this too.
--
-- origin mirrors lpr_watchlist.origin: every row enrolled by hand today is
-- implicitly 'manual' (backfilled below), so the bridge can own rows it
-- creates (origin='blacklist_bridge') without ever touching a hand-enrolled
-- one — the same invariant that makes the LPR bridge's sync() safe.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE face_blacklist
  ADD COLUMN IF NOT EXISTS blacklist_master_id BIGINT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_face_blacklist_bridge
  ON face_blacklist(blacklist_master_id) WHERE origin = 'blacklist_bridge';

CREATE TABLE IF NOT EXISTS blacklist.face_bridge_rules (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT NOT NULL REFERENCES blacklist.sources(id) ON DELETE CASCADE,
  -- NULL/empty = every group (คลัง) from that source. Matched against
  -- source_records.raw_json->>'group_name' (case_ref for HCP face records).
  group_names     TEXT[],
  -- NULL/empty = not an explicit pick. When set, ONLY these records qualify.
  external_ids    TEXT[],
  -- FK ON DELETE SET NULL, matching bridge_rules.target_group_id: deleting a
  -- group must not silently delete the rule that feeds it.
  target_group_id TEXT REFERENCES face_blacklist_groups(id) ON DELETE SET NULL,
  notify_line     BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  label           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bl_face_bridge_rules_source
  ON blacklist.face_bridge_rules(source_id) WHERE active;

-- Last successful sync, mirroring blacklist.sources.last_bridge_sync_at —
-- kept as its own column (not reused) since a source can be on a different
-- cadence for its LPR bridge vs its face bridge.
ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS last_face_bridge_sync_at TIMESTAMPTZ;
