-- ============================================================
-- Vigil Platform — Migration 143: per-user view authorization
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- สิทธิ์ผู้ใช้ 2 แกนที่แยกจากกันชัดเจน (decision #249):
--   แกน "เห็นอะไร"  → users.allowed_views   (หน้า/แท็บ = ข้อมูลประเภทไหน)
--   แกน "ของใคร"    → user_sites (มีอยู่แล้ว) + user_cameras (ใหม่ในไฟล์นี้)
-- สองแกนคูณกัน เช่น "สมรักษ์เห็นแท็บสถิติหมวกนิรภัย เฉพาะกล้องด่าน A, B"
--
-- ⚠️ semantics ของ NULL vs [] — ห้ามปนกันเด็ดขาด:
--   allowed_views IS NULL  = ไม่จำกัด (ผู้ใช้เดิมทุกคน + admin) พฤติกรรมเดิม 100%
--   allowed_views = '[]'   = ไม่เห็นอะไรเลย (ตั้งใจล็อก)
-- ผู้ใช้เดิมทุกแถวได้ NULL อัตโนมัติ → migration นี้ไม่เปลี่ยนพฤติกรรมใครเลย
-- จนกว่าแอดมินจะไปตั้งค่าให้ทีละคน
--
-- Idempotent: ADD COLUMN IF NOT EXISTS · CREATE TABLE IF NOT EXISTS ·
--             ON CONFLICT DO NOTHING · CREATE OR REPLACE + DROP/CREATE TRIGGER
-- ============================================================

-- ── แกน 1: view (หน้า/แท็บ) ────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_views JSONB DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS landing_view  TEXT  DEFAULT NULL;

COMMENT ON COLUMN users.allowed_views IS
  'NULL = unrestricted (default, all existing users). JSON array of view keys '
  '("traffic", "traffic:helmet") = restricted to exactly these. [] = nothing visible.';
COMMENT ON COLUMN users.landing_view IS
  'View key to redirect to after login. NULL = platform default (summary).';

-- ── แกน 2: ขอบเขตกล้องรายตัว (ละเอียดกว่า user_sites) ──────
-- ไม่มีแถวสำหรับ user คนหนึ่ง = เห็นทุกกล้องใน Site ที่ตัวเองมีสิทธิ์ (พฤติกรรมเดิม)
-- มีแถว = เห็นเฉพาะกล้องเหล่านั้น ∩ Site ที่มีสิทธิ์ — intersect เสมอ กัน
-- ไม่ให้ใช้ user_cameras เป็นทางลัดแหกกรอบ user_sites
CREATE TABLE IF NOT EXISTS user_cameras (
  user_id   INT          NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  camera_id VARCHAR(100) NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, camera_id)
);
CREATE INDEX IF NOT EXISTS idx_user_cameras_user ON user_cameras(user_id);

-- ── ข้อความตอนถูกบล็อก (ชุดเดียวทั้งระบบ แก้ไขได้) ─────────
INSERT INTO system_settings (key, value, description)
VALUES ('restricted_view_message',
        'อยู่ระหว่างการปรับปรุงการให้บริการ',
        'ข้อความที่แสดงแทนเนื้อหา เมื่อผู้ใช้เปิดหน้า/แท็บที่ไม่มีสิทธิ์เข้าถึง')
ON CONFLICT (key) DO NOTHING;

-- ── Audit trail ของการเปลี่ยน "สิทธิ์" ─────────────────────
-- trigger เดิม (migration 140) ดักเฉพาะ password_hash — การให้/ถอนสิทธิ์การเข้าถึง
-- เป็น security control เหมือนกัน ต้องมีร่องรอยเสมอไม่ว่าจะแก้ผ่านทางไหน
-- (รวมถึงคนที่ UPDATE ตรงเข้า DB โดยไม่ผ่าน API — เคสจริงที่เคยเกิดกับ password_hash)
-- log-only ไม่ block การเขียน — ตามหลักเดียวกับ trigger เดิม
CREATE OR REPLACE FUNCTION audit_users_authz_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_log (user_id, username, action, target_user_id, target_username, details)
  VALUES (
    NEW.id,
    NEW.username,
    'user_authz_changed',
    NEW.id,
    NEW.username,
    jsonb_build_object(
      'old_allowed_views', OLD.allowed_views,
      'new_allowed_views', NEW.allowed_views,
      'old_landing_view',  OLD.landing_view,
      'new_landing_view',  NEW.landing_view,
      'note', 'fires on ANY write path incl. direct SQL'
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_authz_audit ON users;
CREATE TRIGGER trg_users_authz_audit
  AFTER UPDATE OF allowed_views, landing_view ON users
  FOR EACH ROW
  WHEN (OLD.allowed_views IS DISTINCT FROM NEW.allowed_views
     OR OLD.landing_view  IS DISTINCT FROM NEW.landing_view)
  EXECUTE FUNCTION audit_users_authz_change();
