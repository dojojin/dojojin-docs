-- ============================================================
-- Migration 206: คำสั่งชนิด "ลงมือทำ" — ส่งการแจ้งเตือนให้กลุ่มอื่น
-- ------------------------------------------------------------
-- งานจริงที่เป็นต้นเรื่อง (เจ้าของเล่า 2026-09-08):
--   ป้ายรถทดสอบ 1กอ88 อยู่กลุ่ม "รถทดสอบระบบ" (gmsbgdhh2) ส่วนกลุ่ม
--   Phuket Eyes Police-VSS ตั้งไว้รับเฉพาะ suspect/warrant ⇒ ตำรวจไม่ได้รับ
--   ซึ่ง**ถูกต้องแล้ว** ไม่งั้นตำรวจโดนรบกวนทุกครั้งที่ทดสอบระบบ
--   แต่พอเป็นเคสจริงที่ต้องแจ้ง เจ้าของต้องเปิดหน้าจอกดส่งเอง — หลายครั้งไม่ได้อยู่
--   หน้าจอและไม่ได้ล็อกอิน (ของจริงมี alert_logs สถานะ sent_manual 2 ครั้งใน 7 วัน)
--
-- โครงเดิมรองรับแค่คำสั่งที่ "ถาม" (source_key) ⇒ เปิดทางให้คำสั่งที่ "ทำ" (action_key)
-- ต้องมีอย่างใดอย่างหนึ่ง ไม่ใช่ทั้งคู่ และไม่ใช่ไม่มีเลย
-- ============================================================

ALTER TABLE line_commands ALTER COLUMN source_key DROP NOT NULL;
ALTER TABLE line_commands ADD COLUMN IF NOT EXISTS action_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'line_commands_kind_chk') THEN
    ALTER TABLE line_commands ADD CONSTRAINT line_commands_kind_chk
      CHECK ((source_key IS NOT NULL) <> (action_key IS NOT NULL));
  END IF;
END $$;

-- คำสั่ง "ส่งให้ตำรวจ" — ตั้งผู้รับปลายทางจากกลุ่มที่มีอยู่จริงในระบบ
-- ถ้ายังไม่มีกลุ่มนั้น (ลูกค้ารายอื่น / เครื่อง dev) ก็ไม่สร้างคำสั่ง — ดีกว่าสร้างคำสั่ง
-- ที่กดแล้วไม่รู้จะส่งไปไหน
INSERT INTO line_commands
  (key, label, action_key, triggers, require_all, exclude, fixed_params, slots, required_slots, reply_title)
SELECT
  'forward_police', 'ส่งการแจ้งเตือนให้กลุ่มตำรวจ', 'forward_alert',
  '["ส่งให้ตำรวจ","ส่งกลุ่มตำรวจ","แจ้งตำรวจ","ส่งให้กลุ่มตำรวจ","ส่งตำรวจ"]'::jsonb,
  '[]'::jsonb, '[]'::jsonb,
  jsonb_build_object('to', jsonb_build_array(r->>'id')),
  '["plate"]'::jsonb, '[]'::jsonb, 'ส่งให้กลุ่มตำรวจ'
  FROM line_config, jsonb_array_elements(recipients) r
 WHERE id = 1 AND r->>'name' = 'Phuket Eyes Police-VSS'
 LIMIT 1
ON CONFLICT (key) DO NOTHING;
