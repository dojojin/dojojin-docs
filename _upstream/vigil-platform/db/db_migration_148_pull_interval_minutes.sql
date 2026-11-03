-- ============================================================
-- Vigil Platform — migration 148: รอบดึงข้อมูลโรสเตอร์คิดเป็นนาที
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- เจ้าของสั่ง 2026-08-13: ขอรอบถี่กว่าเดิม — เดิมตั้งไว้ 6 ชั่วโมง เปลี่ยนเป็น 1 ชั่วโมง
-- และเพิ่มตัวเลือก **30 นาที** เข้ามา
--
-- `pull_interval_hours` เป็น integer หน่วยชั่วโมง จึงใส่ 30 นาทีไม่ได้เลย
-- ⇒ เก็บเป็นนาทีแทน · ตัวจับเวลาเดินทุก 5 นาทีอยู่แล้ว รองรับ 30 นาทีได้ทันที
-- ไม่ต้องแตะ (SCHEDULE_TICK_MS ใน routes/blacklist-sources.js)
--
-- คงคอลัมน์เดิมไว้หนึ่งรุ่น ไม่ DROP ทันที: ถ้า deploy แล้วต้อง rollback โค้ด
-- ค่าที่ตั้งไว้จะยังอยู่ครบ ไม่ใช่กลายเป็น 0 แล้วหยุดดึงเงียบ ๆ ทุกแหล่ง

ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS pull_interval_minutes INTEGER NOT NULL DEFAULT 0;

-- ย้ายค่าเดิม · ทำครั้งเดียว (WHERE = 0) จึงรันซ้ำได้ไม่ทับค่าที่คนแก้ทีหลัง
UPDATE blacklist.sources
   SET pull_interval_minutes = COALESCE(pull_interval_hours, 0) * 60
 WHERE pull_interval_minutes = 0
   AND COALESCE(pull_interval_hours, 0) > 0;

-- เจ้าของสั่งให้ทุกโรสเตอร์ที่ดึงอัตโนมัติอยู่แล้ว เปลี่ยนเป็นทุก 1 ชั่วโมง
-- แตะเฉพาะแหล่งที่ "เปิดดึงอัตโนมัติอยู่" — แหล่งที่ปิดไว้ต้องไม่ถูกเปิดเอง
UPDATE blacklist.sources
   SET pull_interval_minutes = 60
 WHERE pull_interval_minutes > 60;

COMMENT ON COLUMN blacklist.sources.pull_interval_minutes IS
  'รอบดึงข้อมูลอัตโนมัติ (นาที) · 0 = ปิด · แทนที่ pull_interval_hours ซึ่งคงไว้ชั่วคราวเพื่อ rollback (migration 148)';
COMMENT ON COLUMN blacklist.sources.pull_interval_hours IS
  'เลิกใช้แล้ว — ใช้ pull_interval_minutes แทน · คงไว้หนึ่งรุ่นเผื่อ rollback (migration 148)';
