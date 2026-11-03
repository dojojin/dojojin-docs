-- ============================================================
-- Vigil Platform — Migration 183: event_categories.stat_group
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- กลุ่มของหมวดบนหน้า Event Statistics ใหม่ (stats redesign 2026-08):
--   NULL       = จัดกลุ่มอัตโนมัติ (kind → object class ใน rules → ชื่อหมวด)
--   vehicle / people / identify / watch = บังคับเข้ากลุ่มนั้น
--   standalone = "ไม่รวมกับหมวดพื้นฐาน (แยกนับ)" — ไม่ปนยอด 4 กลุ่มหลัก
--     (เคสลูกค้ามีกล้อง 2 ตัว recheck กันเอง จะนับซ้ำถ้ารวม)
-- ชื่อคอลัมน์จงใจไม่ใช้ "group" (reserved word ต้อง quote ทุกที่)
-- ============================================================
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS stat_group TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_categories_stat_group_chk') THEN
    ALTER TABLE event_categories ADD CONSTRAINT event_categories_stat_group_chk
      CHECK (stat_group IS NULL OR stat_group IN ('vehicle','people','identify','watch','standalone'));
  END IF;
END $$;
