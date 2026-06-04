-- Phase 8.0 (2026-05-19) — License system support.
-- Stores the customer-facing license JWT + trial-tracking timestamps in
-- system_settings (key/value blob). No separate table — the surface is
-- small enough that piggybacking on the existing settings store keeps
-- migrations and backups simple.
--
-- Keys added (all default empty string = "not set yet"):
--   license_key       — the signed JWT string the customer pastes via the
--                       Settings → License UI. Verified at boot against
--                       LICENSE_PUBLIC_KEY embedded in src/license.js.
--   first_login_at    — ISO timestamp of the FIRST successful user login
--                       on this deployment. Trial period (7 days) is
--                       measured from this point — not from process boot,
--                       which would let an attacker reset the trial by
--                       restarting the service.
--   eula_accepted_at  — ISO timestamp when an admin accepted the EULA.
--                       Recorded once; blocks first-time launch until set.
--   eula_accepted_by  — username that accepted, for the audit trail.

INSERT INTO system_settings (key, value) VALUES
  ('license_key',      ''),
  ('first_login_at',   ''),
  ('eula_accepted_at', ''),
  ('eula_accepted_by', '')
ON CONFLICT (key) DO NOTHING;
