-- ============================================================
-- Vigil Platform — Migration 255: appearances.event_time + 4 ค่าจาก raw_json (D6 แก้ถาวร)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- /api/appearances/stats กรองช่วงด้วย events.event_time จึงต้อง JOIN events ทุกแถว
-- (1 วัน 6.8 วิ · 3 วัน 47 วิ · 7 วัน 76 วิ — ถึงต้องจำกัดไว้ 2 วัน · GOTCHAS #217)
-- appearances.detected_at ใช้แทนไม่ได้: เป็นเวลาที่บันทึกเข้าระบบ ต่างจาก event_time ทุกแถว
-- (ตรวจ 4 ต.ค. 184,436 แถว ต่างสูงสุด 74 นาที) — กรองด้วยมันตัวเลขจะเปลี่ยน
--
-- เพิ่มคอลัมน์ไม่มี default = แก้แค่ metadata ทันที · trigger เติมค่าตอน INSERT จากแถว events ของมัน
-- (จุดเดียวแทนคนเขียน 8 จุด: mqtt-subscriber ×3 · hikvision-isapi ×4 · dahua-cgi ×1)
-- แถวเก่าเติมด้วย scripts/backfill-appearances-event-time.js (เป็นชุด) · index สร้าง CONCURRENTLY แยก
-- ทุกคำสั่งรันซ้ำได้
-- ============================================================

ALTER TABLE appearances ADD COLUMN IF NOT EXISTS event_time    timestamptz;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS rj_mask       text;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS rj_hat        text;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS rj_age_group  text;
ALTER TABLE appearances ADD COLUMN IF NOT EXISTS rj_expression text;

-- ค้นด้วย id อย่างเดียว (ทุก partition) ไม่ใช้ detected_at เป็นขอบ — ข้อมูลที่ส่งย้อนหลังมาช้า
-- หลายวันจะหลุดขอบแล้วได้ NULL เงียบ ๆ · ราคาต่อแถวเล็กเมื่อเทียบอัตรา ~2 แถว/วินาที
CREATE OR REPLACE FUNCTION appearances_copy_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_time IS NULL AND NEW.event_id IS NOT NULL THEN
    SELECT e.event_time,
           e.raw_json->>'mask', e.raw_json->>'hat', e.raw_json->>'ageGroup', e.raw_json->>'faceExpression'
      INTO NEW.event_time, NEW.rj_mask, NEW.rj_hat, NEW.rj_age_group, NEW.rj_expression
      FROM events e WHERE e.id = NEW.event_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_appearances_copy_event ON appearances;
CREATE TRIGGER trg_appearances_copy_event
  BEFORE INSERT ON appearances
  FOR EACH ROW EXECUTE FUNCTION appearances_copy_event();
