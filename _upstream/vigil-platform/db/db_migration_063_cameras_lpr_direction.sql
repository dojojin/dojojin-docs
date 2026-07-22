-- ============================================================
-- Vigil Platform — migration 063: per-camera LPR direction (RF5 Tier-1)
-- (renumbered from 062 — collided with 062_seed_vss_site already on main; the
--  column first applied under the old 062 name, ALTER IF NOT EXISTS makes the
--  063 re-run a harmless skip on next boot.)
-- Adds cameras.lpr_direction ('in' | 'out' | NULL=none) so the LPR overview
-- can split traffic by direction. Per-camera is the chosen model (ROADMAP RF5);
-- the per-lane lpr_gates config (RF4) stays as latent advanced config — nothing
-- consumes it for direction, RF5 is the first direction consumer.
--
-- NO inference backfill: physical in/out is install knowledge, not derivable
-- from vendor/topic (cf. cam_role which IS inferable). Leave NULL; the operator
-- assigns direction in Settings › LPR. Idempotent.
-- ============================================================
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS lpr_direction TEXT
  CHECK (lpr_direction IN ('in', 'out'));
