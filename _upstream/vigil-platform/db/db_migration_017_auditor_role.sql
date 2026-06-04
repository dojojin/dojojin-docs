-- ============================================================
-- DojoJin Tech Dashboard — Migration 017: Auditor role
-- ------------------------------------------------------------
-- Adds a 3rd user role 'auditor' (ผู้ตรวจสอบระบบ): can VIEW every
-- page incl. Settings, but cannot write anything (enforced server-
-- side). Widens the users.role CHECK constraint admin/viewer →
-- admin/viewer/auditor. Idempotent — finds the existing role CHECK
-- by definition rather than a hard-coded name.
-- ============================================================

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'users'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
       AND pg_get_constraintdef(oid) ILIKE '%viewer%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'viewer', 'auditor'));
END $$;
