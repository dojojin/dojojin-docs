-- ============================================================
-- Migration 096 — blacklist -> lpr_watchlist bridge rules (B3)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- WHY A RULE AND NOT A LIST
-- blacklist.* is a reservoir; lpr_watchlist is what actually fires alerts. The
-- bridge has to keep them in step in BOTH directions: when a source drops a
-- vehicle (charges dropped, case closed) the alert must stop too, or we keep
-- flagging a cleared vehicle forever. A one-shot copy cannot express removal, so
-- what we store is the RULE that selects rows, re-evaluated on every sync.
--
-- Three presets fall out of one mechanism, so there is no second code path:
--   ทั้งหมด        source_id only
--   ตามความเสี่ยง   source_id + group_names   (DSS Pro only — GuruSquare sends
--                                              group_name NULL for all 1,080)
--   เลือกเอง        source_id + external_ids
--
-- Safety: rows the bridge creates carry origin='blacklist_bridge' (migration
-- 093). Every write and delete it performs is scoped by that value, so a plate
-- an operator typed by hand is never touched — see src/helpers/blacklistBridge.js.

CREATE TABLE IF NOT EXISTS blacklist.bridge_rules (
  id             BIGSERIAL PRIMARY KEY,
  source_id      BIGINT NOT NULL REFERENCES blacklist.sources(id) ON DELETE CASCADE,
  -- NULL/empty = every group from that source. Matched against
  -- source_records.raw_json->>'group_name'.
  group_names    TEXT[],
  -- NULL/empty = not an explicit pick. When set, ONLY these records qualify —
  -- this is the "เลือกเอง" preset, and it ANDs with group_names if both are set.
  external_ids   TEXT[],
  -- Where the plates land in the operator-facing watch list. FK is intentionally
  -- ON DELETE SET NULL, matching lpr_watchlist.group_id: deleting a group must
  -- not silently delete the rule that feeds it.
  target_group_id TEXT REFERENCES lpr_watchlist_groups(id) ON DELETE SET NULL,
  -- Off by default. Nothing about importing a roster implies anyone consented to
  -- being pushed a LINE message for every one of its plates.
  notify_line    BOOLEAN NOT NULL DEFAULT FALSE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  label          TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bl_bridge_rules_source
  ON blacklist.bridge_rules(source_id) WHERE active;

-- The bridge matches its own rows by master id, so this has to be quick and
-- unambiguous. Partial: manual rows have no blacklist_master_id at all.
CREATE INDEX IF NOT EXISTS idx_lpr_watchlist_bridge
  ON lpr_watchlist(blacklist_master_id) WHERE origin = 'blacklist_bridge';

-- Last successful sync, so the UI can say when the two sides were last in step
-- rather than implying they always are.
ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS last_bridge_sync_at TIMESTAMPTZ;
