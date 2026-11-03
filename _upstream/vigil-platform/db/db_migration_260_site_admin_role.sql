-- ============================================================
-- Vigil Platform — Migration 260: Site Admin role
-- ------------------------------------------------------------
-- 4th user role 'site_admin' (Admin เฉพาะไซต์): แก้ได้เฉพาะข้อมูลของ Site ที่ผูกไว้
-- ใน user_sites (กล้อง / กลุ่มกล้อง / หมวดเหตุการณ์) · ไม่ใช่ 'admin' จึงโดนปฏิเสธ
-- ทุกจุดที่เช็ค role === 'admin' โดยปริยาย (fail-closed) — สิทธิ์ที่เปิดให้อยู่ใน
-- src/helpers/siteAdminGate.js ที่เดียว
-- Idempotent — หา CHECK ของ role จากนิยาม ไม่ผูกชื่อ (เหมือน migration 017)
-- ตาราง users เล็ก → ไม่ต้อง guard ขนาด (feedback_migration_must_be_fast)
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
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'viewer', 'auditor', 'site_admin'));
END $$;
