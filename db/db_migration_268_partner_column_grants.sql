-- ============================================================
-- Vigil Platform — Migration 268: สิทธิ์ partner เป็นรายคอลัมน์เสมอ + v_system_settings_public แบบระบุชื่อที่อนุญาต
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ระยะ 2 ขั้น 0 ของ OpenAPI (เจ้าของสั่ง 2026-10-21 · แนวทาง "ให้ตามความจำเป็น" — partner ไม่เห็นว่าขออะไรได้
-- เรากำหนดชุดข้อมูลให้เอง)
--
-- 1) partner เดิมที่ได้สิทธิ์ผ่านกลุ่ม third_party_readonly หรือ GRANT ทั้ง view → แปลงเป็นรายคอลัมน์ชุดเดิมทุกตัว
--    เหตุ: GRANT ทั้ง view ครอบคลุมคอลัมน์ที่จะเพิ่มใน view ในอนาคตด้วย (ทดสอบจริงด้วย view+role ชั่วคราว 2026-10-21)
--    ⇒ เพิ่มฟิลด์ใหม่เมื่อไร partner ทุกรายได้ทันทีโดยไม่มีใครติ๊ก รวมถึงข้อมูลส่วนบุคคล
--    คำนวณคอลัมน์ที่เห็นอยู่ "ก่อน" ถอนอะไรทั้งนั้น ⇒ ผลลัพธ์เท่าเดิมทุกคอลัมน์ · รันซ้ำได้ผลเดิม
--    (ตอนนี้มี partner รายเดียว: test → 124 คอลัมน์)
-- 2) v_system_settings_public: เดิมกรองแบบ "ห้ามเฉพาะชื่อที่รู้" ⇒ ค่าตั้งใหม่หลุดเองทุกตัว · พบเปิดอยู่ 58 ค่า
--    รวม carto_api_key / perf_watch (ข้อความ SQL ภายใน) / eula_accepted_by · เปลี่ยนเป็นระบุชื่อที่อนุญาต
--    (วันนั้นยังไม่มีทางเข้าถึงจริง: ไม่มี endpoint อ่าน view นี้ และ role partner เป็น NOLOGIN)
-- ============================================================

DO $$
DECLARE
  r record; v text; cols text;
  views text[] := ARRAY['v_cameras_public','v_license_plates_public','v_appearances_public','v_events_public',
    'v_camera_groups_public','v_event_categories_public','v_event_category_rules_public','v_alert_rules_public',
    'v_alert_logs_public','v_system_settings_public','v_report_history_public'];
BEGIN
  IF to_regclass('public.api_consumers') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT c.db_role FROM api_consumers c JOIN pg_roles p ON p.rolname = c.db_role LOOP
    FOREACH v IN ARRAY views LOOP
      CONTINUE WHEN to_regclass('public.' || v) IS NULL;
      SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v
         AND has_column_privilege(r.db_role, quote_ident(v), column_name, 'SELECT');
      EXECUTE format('REVOKE ALL ON %I FROM %I', v, r.db_role);
      IF cols IS NOT NULL THEN
        EXECUTE format('GRANT SELECT (%s) ON %I TO %I', cols, v, r.db_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
                WHERE g.rolname = 'third_party_readonly' AND u.rolname = r.db_role) THEN
      EXECUTE format('REVOKE third_party_readonly FROM %I', r.db_role);
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r.db_role);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW v_system_settings_public AS
SELECT key, value, description, updated_at
FROM system_settings
WHERE key IN ('brand_name', 'display_timezone', 'data_retention_days', 'lpr_retention_days', 'appearances_retention_days');

COMMENT ON VIEW v_system_settings_public IS
  'Public settings view — allowlist only (migration 268). Add a key here deliberately; new settings are hidden by default.';
