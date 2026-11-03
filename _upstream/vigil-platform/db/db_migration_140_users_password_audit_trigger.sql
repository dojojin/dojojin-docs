-- ============================================================
-- Vigil Platform — audit_log visibility for direct password_hash writes
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- 2026-08-08: a subagent overwrote admin's password_hash with a bcrypt hash
-- of an unknown plaintext by running UPDATE users SET password_hash = ...
-- directly against postgres. Because that bypassed /api/auth/change-password,
-- audit_log recorded nothing — the owner checked it and correctly saw
-- "nothing wrong" two days running while admin was actually locked out.
-- Full incident: GOTCHAS.md #150.
--
-- This trigger closes that blind spot at the layer the incident happened in:
-- ANY write to password_hash gets an audit_log row, app-mediated or not.
-- The app's own /api/auth/change-password and admin-reset paths
-- (src/auth.js:375, :396) keep writing their existing password_change /
-- password_reset rows — this trigger adds a second, independent row for the
-- same event. That duplication is the point: a password_hash_changed_db row
-- with no matching password_change/password_reset row for the same target
-- within a few seconds is exactly the signature of a direct write.
--
-- Deliberately log-only (Working Agreement #3, item 4 — non-throwing capture
-- can ship without waiting for approval; blocking the write would be a
-- control-flow change on the auth path and needs its own sign-off). The
-- INSERT is wrapped so a trigger bug can never break a legitimate password
-- change — see the EXCEPTION block below.
--
-- Never store the hash itself or raw query text in audit_log: it's readable
-- by the 'auditor' role. Store only:
--   - md5 fingerprints (first 8 chars) of OLD/NEW hash — enough to compare
--     against a pg_restore of a daily backup, useless to an attacker
--   - current_user / application_name / inet_client_addr() / backend pid —
--     psql (docker exec) shows application_name='psql',
--     inet_client_addr() NULL (unix socket); node-postgres shows
--     application_name='', addr=172.18.0.1 (docker bridge). Recorded as-is,
--     not turned into a "suspicious" verdict the trigger can't actually back.
--   - current_query(), capped at 300 chars, with any bcrypt hash regex-
--     scrubbed out first (current_query() inside a trigger returns the
--     original statement text, hash included — confirmed by direct test
--     before writing this).
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS/CREATE. Central DB
-- only — nothing here touches edge, no 3-site deploy needed for this change.
-- ============================================================

CREATE OR REPLACE FUNCTION audit_users_password_hash_change() RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO audit_log (user_id, username, action, target_user_id, target_username, details)
    VALUES (
      NULL,
      '(db-trigger)',
      'password_hash_changed_db',
      NEW.id,
      NEW.username,
      jsonb_build_object(
        'old_hash_fp', left(md5(coalesce(OLD.password_hash, '')), 8),
        'new_hash_fp', left(md5(coalesce(NEW.password_hash, '')), 8),
        'db_user', current_user,
        'application_name', current_setting('application_name', true),
        'client_addr', host(inet_client_addr()),
        'backend_pid', pg_backend_pid(),
        'query', left(regexp_replace(coalesce(current_query(), ''),
                       '\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}', '[REDACTED]', 'g'), 300)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let audit capture break the write it's watching.
    RAISE WARNING 'audit_users_password_hash_change: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_password_hash_audit ON users;
CREATE TRIGGER trg_users_password_hash_audit
  AFTER UPDATE OF password_hash ON users
  FOR EACH ROW
  WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
  EXECUTE FUNCTION audit_users_password_hash_change();
