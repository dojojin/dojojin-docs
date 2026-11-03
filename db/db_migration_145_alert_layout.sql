-- ============================================================
-- Vigil Platform — migration 145: ปรับหน้าตาการ์ดแจ้งเตือน LINE ได้ต่อ rule
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- เดิมการ์ด LINE เรียงตายตัวในโค้ด (line-sender.js buildCompareFlexAlert):
--   ชื่อบัญชี (ส้ม) → ชื่อคน → ภาพคู่ → ข้อความจาก message_template → ปุ่มเปิดในระบบ
-- แก้ได้เฉพาะบล็อกข้อความล่างสุด · หัวเรื่องสองบรรทัดบนถูกประกอบจากโค้ดโดยตรง
-- และปุ่ม "เปิดในระบบ" โผล่เสมอเมื่อมี DASHBOARD_PUBLIC_URL ปิดไม่ได้
--
-- เจ้าของขอให้ปรับได้ทั้งหัวเรื่องและลำดับ (2026-08-13)
--
-- ทำไมเก็บที่ `alert_rules` ไม่ใช่ `system_settings`: หน้าตาการ์ดควรต่างกันได้ต่อกฎ
-- (กฎบัญชีดำอยากได้ชื่อคนตัวใหญ่ · กฎ IVA ทั่วไปไม่มีชื่อคนให้แสดง) — แบบเดียวกับ
-- `send_snapshot` และ `message_template` ที่เป็นค่าต่อกฎอยู่แล้ว
--
-- ⚠️ ค่าเริ่มต้นตั้งให้ **เหมือนพฤติกรรมเดิมเป๊ะ** เพื่อไม่ให้การแจ้งเตือนที่ใช้งานอยู่
-- เปลี่ยนหน้าตาเองโดยไม่มีใครสั่ง — NULL = ใช้ของเดิมที่โค้ดประกอบให้

ALTER TABLE alert_rules
  -- ปุ่ม "เปิดในระบบ" · true = เหมือนเดิม (ยังต้องมี DASHBOARD_PUBLIC_URL ด้วย)
  ADD COLUMN IF NOT EXISTS show_open_link BOOLEAN NOT NULL DEFAULT TRUE,
  -- หัวเรื่องบรรทัดบน (สีส้มตัวเล็ก) · NULL = ใช้ชื่อบัญชีเฝ้าระวังเหมือนเดิม
  ADD COLUMN IF NOT EXISTS title_template VARCHAR(200),
  -- บรรทัดรอง (ตัวหนาใหญ่) · NULL = ใช้ชื่อบุคคลเหมือนเดิม
  ADD COLUMN IF NOT EXISTS subtitle_template VARCHAR(200),
  -- ข้อความรายละเอียดอยู่เหนือหรือใต้ภาพคู่ · 'below' = เหมือนเดิม
  ADD COLUMN IF NOT EXISTS text_position VARCHAR(10) NOT NULL DEFAULT 'below';

-- กันค่าแปลกปลอมหลุดเข้ามาจาก API — มีแค่สองค่าที่ตัวสร้างการ์ดรู้จัก
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_rules_text_position_chk') THEN
    ALTER TABLE alert_rules
      ADD CONSTRAINT alert_rules_text_position_chk CHECK (text_position IN ('above', 'below'));
  END IF;
END $$;

COMMENT ON COLUMN alert_rules.show_open_link IS
  'แสดงปุ่ม "เปิดในระบบ" ท้ายการ์ด LINE หรือไม่ (migration 145)';
COMMENT ON COLUMN alert_rules.title_template IS
  'หัวเรื่องบรรทัดบนของการ์ด · ใช้ตัวแปรแบบเดียวกับ message_template · NULL = ชื่อบัญชีเฝ้าระวัง (migration 145)';
COMMENT ON COLUMN alert_rules.subtitle_template IS
  'บรรทัดรองของการ์ด · NULL = ชื่อบุคคลที่จับคู่ได้ (migration 145)';
COMMENT ON COLUMN alert_rules.text_position IS
  'ตำแหน่งบล็อกข้อความเทียบกับภาพคู่: above | below (migration 145)';
