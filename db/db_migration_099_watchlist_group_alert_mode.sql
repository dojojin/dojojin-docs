-- ============================================================
-- Migration 099 — alert match mode moves to group level
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- lpr_watchlist.alert_mode already existed per PLATE, set from a form field on
-- the add-plate dialog. Two problems with that, found together 2026-07-27:
--
--   1. It was never enforced. Every join that turns a plate match into an
--      alert (lpr-alerts.js, 4 places in lpr-query.js) only ever compared
--      plate_number — alert_mode and region were stored and displayed, never
--      read by the matching logic. Choosing "Plate + Province" changed nothing
--      about whether an alert fired.
--   2. Per-plate control is the wrong level anyway (owner's call): the
--      decision "does this WATCHLIST GROUP require province agreement" is a
--      policy for the group, not something someone re-picks per plate. Groups
--      already carry name/color; this adds the one thing they were missing.
--
-- lpr_watchlist.alert_mode is KEPT — the enforcement query still needs a
-- per-row value to compare against (two plates in the same group can still
-- have different regions) — but it is now DERIVED from the plate's group at
-- write time, never chosen by the operator directly.
ALTER TABLE lpr_watchlist_groups
  ADD COLUMN IF NOT EXISTS default_alert_mode TEXT NOT NULL DEFAULT 'plate';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lpr_watchlist_groups_alert_mode_check'
  ) THEN
    ALTER TABLE lpr_watchlist_groups
      ADD CONSTRAINT lpr_watchlist_groups_alert_mode_check
      CHECK (default_alert_mode IN ('plate', 'plate_region'));
  END IF;
END $$;
