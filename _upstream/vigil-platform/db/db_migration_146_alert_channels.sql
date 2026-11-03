-- ============================================================
-- Vigil Platform — migration 146: กฎประจำระบบที่ลบไม่ได้ (alert channel)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- ปัญหาที่เจ้าของชี้ (2026-08-13): HCP Face · AuraFace · LPR เป็น**ส่วนหนึ่งของระบบ
-- ที่ใช้ประจำ** แต่ตอนนี้ไปอยู่ปนกับ Alert Rules ทั่วไปซึ่ง **ลบทิ้งได้**
-- ⇒ ถ้าใครเผลอลบแถว HCP ความสามารถหลักหายไปเงียบ ๆ ไม่มีอะไรเตือน
--
-- ทางแก้: ทำเครื่องหมายว่าแถวไหนเป็น "ช่องทางประจำระบบ" แล้วให้มีหน้า config ของ
-- ตัวเองแบบเดียวกับแท็บ Edge Offline (ซึ่งลบไม่ได้อยู่แล้วเพราะเป็นหน้าตายตัว)
--
-- ทำไมใช้คอลัมน์บน alert_rules ไม่สร้างตารางใหม่: เครื่องยนต์ส่ง · cooldown ·
-- ผู้รับ · template · หน้าตาการ์ด (migration 145) · alert_logs — ใช้ของเดิมได้ทั้งหมด
-- สร้างตารางใหม่จะต้องทำซ้ำทุกอย่าง แล้วมีสองระบบให้ดูแล ซึ่งเป็นปัญหาที่กำลังแก้อยู่พอดี

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20);

-- ช่องทางละหนึ่งแถวเท่านั้น · NULL = กฎทั่วไปที่สร้าง/ลบได้ตามปกติ (มีได้ไม่จำกัด)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_rules_channel
  ON alert_rules (channel) WHERE channel IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_rules_channel_chk') THEN
    ALTER TABLE alert_rules
      ADD CONSTRAINT alert_rules_channel_chk
      CHECK (channel IS NULL OR channel IN ('hcp_face', 'auraface', 'lpr'));
  END IF;
END $$;

-- ── ผูกแถวที่มีอยู่แล้วเข้ากับช่องทาง แทนการสร้างใหม่ ────────────────────
-- เจ้าของตั้งค่าไว้แล้ว (ผู้รับ · template · cooldown) การสร้างแถวใหม่แล้วทิ้งของเดิม
-- จะทำให้ตั้งค่าใหม่หมดและมีกฎซ้ำสองชุดยิงพร้อมกัน
UPDATE alert_rules SET channel = 'hcp_face'
 WHERE channel IS NULL AND rule_names @> ARRAY['Face Recognition Match']::text[]
   AND id = (SELECT MIN(id) FROM alert_rules WHERE rule_names @> ARRAY['Face Recognition Match']::text[]);

-- AuraFace: แถวที่ตั้ง list_types=blackList แต่ไม่เจาะจง rule_names
-- (แถว "LabTest FR" ที่สร้างไว้ตอนทดลอง — ดูหมายเหตุเรื่องยิงซ้ำใน DECISIONS)
UPDATE alert_rules SET channel = 'auraface',
       rule_names = ARRAY['AuraFace Blacklist Match']::text[]
 WHERE channel IS NULL AND (rule_names IS NULL OR cardinality(rule_names) = 0)
   AND list_types @> ARRAY['blackList']::text[]
   AND id = (SELECT MIN(id) FROM alert_rules
              WHERE (rule_names IS NULL OR cardinality(rule_names) = 0)
                AND list_types @> ARRAY['blackList']::text[]);

COMMENT ON COLUMN alert_rules.channel IS
  'ช่องทางประจำระบบ: hcp_face | auraface | lpr — ลบไม่ได้ มีหน้า config ของตัวเอง · NULL = กฎทั่วไป (migration 146)';
