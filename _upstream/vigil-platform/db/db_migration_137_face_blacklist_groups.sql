-- ============================================================
-- Vigil Platform — Face Blacklist groups + per-entry LINE toggle + manual add
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- Owner asked (2026-08-10) for the Lab Test roster to match LPR Watchlist's
-- "Add / Manage Groups" tab: named/colored groups, a per-group LINE master
-- switch, and a manual add-entry form. face_blacklist had none of this — it
-- only ever came from the one-time HCP bulk enrollment script. Mirrors
-- lpr_watchlist_groups/lpr_watchlist (group_id, notify_line) minus
-- default_alert_mode (LPR-only concept, plate vs plate+region — nothing
-- equivalent for a face match).
--
-- ref_image is separate from the enrolled_ref → blacklist.source_records
-- path added in migration 136: that path only resolves for HCP-sourced rows
-- with a unique label; a manually-added row's photo has nowhere else to
-- live, so it gets its own column, same as lpr_watchlist.ref_image.
-- ============================================================

CREATE TABLE IF NOT EXISTS face_blacklist_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#5b8def',
  notify_line BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE face_blacklist ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES face_blacklist_groups(id) ON DELETE SET NULL;
ALTER TABLE face_blacklist ADD COLUMN IF NOT EXISTS notify_line BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE face_blacklist ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE face_blacklist ADD COLUMN IF NOT EXISTS ref_image TEXT;

CREATE INDEX IF NOT EXISTS idx_face_blacklist_group ON face_blacklist (group_id);
