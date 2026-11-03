-- ============================================================
-- Migration 224: ชื่อหัวข้อรายงานที่ตั้งเองได้ (report_section_titles)
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-09-10 — แก้ชื่อหัวข้อในรายงานได้จากหน้า Report Builder
-- และหน้ารายงานอัตโนมัติ · ค่าเป็นค่ากลางทั้งระบบ (ไม่ใช่รายผู้ใช้/รายตาราง)
--
-- รูปแบบค่า: JSON object · key = section key ทั้ง 9 ตัวใน
-- dashboard/report-template.js (SECTION_KEYS) · value = ชื่อที่ตั้งเอง
-- ไม่มี key = ใช้ชื่อเริ่มต้นตามภาษาที่เลือก
--   { "trend": "แนวโน้มเหตุการณ์ประจำสัปดาห์", "quiet": "กล้องเงียบ" }
--
-- ⚠️ ต้อง seed แถวนี้ให้มีจริง — PUT /api/settings/:key เป็น UPDATE อย่างเดียว
--    ไม่มีแถว = ตอบ 404 "setting row missing" แล้วผู้ใช้บันทึกไม่ได้เลย
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('report_section_titles', '{}',
   'JSON object: report section key -> custom heading. Empty {} = use default per-language titles.')
ON CONFLICT (key) DO NOTHING;
