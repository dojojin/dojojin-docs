-- ============================================================
-- Vigil Platform — migration 113: give lpr_watchlist.notify_line a meaning
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- The column has existed for months with no reader, and every one of the 482
-- active rows holds FALSE — written by the blacklist bridge from bridge rules
-- whose own notify_line was never turned on. So the value records nothing anyone
-- decided. Migration 112 gave the group a switch and made this the per-plate
-- "mute this one car" override; reading the existing FALSE as an intentional
-- mute would silence every plate on the platform on day one (caught in a dry run
-- against the week's real hits, 2026-08-03 — all 32 came back plate_muted).
--
-- So: FALSE now means a human unticked it, and the default for anything new is
-- TRUE. Existing rows are reset to TRUE because none of them were a decision.
--
-- Paired with a change in blacklistBridge.js: the bridge no longer writes this
-- column at all, on insert or update. It used to, on every sync — which would
-- have quietly undone an operator's mute the next time the roster refreshed.
-- bridge_rules.notify_line therefore has no reader left; its control in the
-- bridge modal comes out with the UI pass.
-- ============================================================

ALTER TABLE lpr_watchlist ALTER COLUMN notify_line SET DEFAULT true;

-- Scoped to bridge-managed rows: a manually added plate could, in principle,
-- have been set deliberately, and this migration has no way to tell. All 482
-- current rows are origin='blacklist_bridge', so in practice this is all of
-- them — but the clause is what makes re-running it safe if that stops being
-- true.
UPDATE lpr_watchlist
   SET notify_line = true
 WHERE origin = 'blacklist_bridge' AND notify_line IS DISTINCT FROM true;

COMMENT ON COLUMN lpr_watchlist.notify_line IS
  'อนุญาตให้ป้ายนี้แจ้งเตือน LINE — false = คนกดปิดเฉพาะคันนี้; สวิตช์หลักอยู่ที่ lpr_watchlist_groups.notify_line';
