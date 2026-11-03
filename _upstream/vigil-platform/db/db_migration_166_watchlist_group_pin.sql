-- ============================================================
-- Migration 166 — pin a bridged plate to the alert group a human chose
-- ============================================================
-- Plates that arrive from a Blacklist roster get their alert group
-- from the bridge rule that claimed them (blacklistBridge.js, the
-- rule's target_group_id). Every sync rewrites group_id from that
-- rule, so moving one plate to a different group by hand survived
-- only until the next roster refresh — reproduced 2026-08-20 on
-- 2กก5078: setting it to `warrant` put it straight into the sync's
-- "will be changed" list with gmsbgdhh2 going back in.
--
-- This is the same shape of problem notify_line already hit, and
-- gets the same answer: the bridge stops writing the field once a
-- person has made a decision about it. The difference is that
-- notify_line could simply be dropped from the bridge's writes,
-- while a group still has to follow the rule for every plate
-- nobody has touched — otherwise editing a rule would stop moving
-- the plates it owns, which is the whole point of a rule. So the
-- decision needs recording rather than inferring: this column is
-- the record.
--
-- FALSE for every existing row, which is the truthful answer —
-- nobody has pinned anything yet, and the bridge keeps full
-- control until somebody does.
--
-- alert_mode rides along with group_id when pinned. It is the
-- group's policy (lpr_watchlist_groups.default_alert_mode), so
-- leaving it pointing at the rule's group while group_id points
-- somewhere else would match plates by one group's rules and file
-- them under another's.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE lpr_watchlist
  ADD COLUMN IF NOT EXISTS group_pinned BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE lpr_watchlist SET group_pinned = FALSE WHERE group_pinned IS NULL;

-- Only bridge-owned rows can be pinned: a hand-added plate is already
-- exempt from the bridge (diff() skips rows whose origin is not
-- blacklist_bridge), so a pin there would mean nothing and reading one
-- later would suggest a protection that was never doing any work.
UPDATE lpr_watchlist SET group_pinned = FALSE
 WHERE group_pinned AND origin <> 'blacklist_bridge';
