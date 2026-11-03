-- ============================================================
-- Vigil Platform — Migration 196: login lockout knobs in system_settings
-- (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ------------------------------------------------------------
-- Owner ask 2026-09-03: expose the login lockout policy (previously the
-- hardcoded constants MAX_FAILED_ATTEMPTS=5 / LOCKOUT_MINUTES=15 in
-- src/auth.js) as admin-editable settings. auth.js falls back to the same
-- defaults when the rows are missing, so this migration only seeds the rows
-- for PUT /api/settings/:key to update (that route 404s on a missing row
-- by design). Idempotent: ON CONFLICT DO NOTHING.
-- ============================================================
INSERT INTO system_settings (key, value)
VALUES ('login_max_failed', '5'), ('login_lockout_minutes', '15')
ON CONFLICT (key) DO NOTHING;
