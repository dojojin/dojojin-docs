-- ============================================================
-- Vigil Platform — CH1 · ประวัติการแก้ไขที่ต้นทางทำกับระเบียน
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-08-13: "ต้นทางแก้ไข → เราอัพเดทตาม พร้อม remark ว่าแก้วันไหน
-- เดิมลงไว้วันไหน และบันทึกละเอียดว่าแก้กี่ครั้ง วันไหนบ้าง"
--
-- ทำไมต้องมีตารางแยก: `source_records.updated_at` ใช้เป็นสัญญาณ "แก้จริง" ไม่ได้
-- เพราะ upsert เขียน NOW() ทุกรอบ import ไม่ว่าค่าจะเปลี่ยนหรือไม่ (13 ส.ค. ขึ้น
-- 2,672 แถว ทั้งที่ต้นทางแทบไม่ได้แก้อะไร) ⇒ ตารางนี้เป็น**ที่เดียว**ที่รู้ว่าแก้จริง
--
-- ปริมาณที่วัดจริง (ไม่ใช่ประมาณ): GuruSquare 786 แถว มีการแก้จากต้นทางเดือนละ
-- ~10–36 ระเบียน ⇒ ตารางนี้โตหลักสิบแถวต่อเดือน ไม่ใช่หลักหมื่น
--
-- คีย์เป็น (source_id, external_id) แบบเดียวกับ `blacklist.overrides` ไม่ใช่
-- source_records.id — ประวัติต้องรอดจากการที่ระเบียนถูกลบแล้ว import กลับมาใหม่
-- ============================================================

CREATE TABLE IF NOT EXISTS blacklist.record_changes (
  id           BIGSERIAL PRIMARY KEY,
  source_id    INT  NOT NULL REFERENCES blacklist.sources(id) ON DELETE CASCADE,
  external_id  TEXT NOT NULL,
  field        TEXT NOT NULL,          -- ชื่อคอลัมน์ของเรา หรือคีย์ใน raw_json
  old_value    TEXT,
  new_value    TEXT,
  -- เวลาที่ **ต้นทาง** บอกว่าแก้ (GuruSquare ส่ง raw_json.last_update มาให้)
  -- แยกจาก detected_at ซึ่งคือเวลาที่ **เรา** เห็น — เจ้าของขอทั้งสองอย่าง
  source_time  TIMESTAMPTZ,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS record_changes_rec_idx
  ON blacklist.record_changes (source_id, external_id, detected_at DESC);
