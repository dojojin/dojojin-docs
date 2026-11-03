-- ============================================================
-- Vigil Platform — Migration 259: idx_plates_region_time เก็บ id ในตัวด้วย (INCLUDE camera_id, id)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-10-07: หน้า LPR › ค้นหา "กล้อง + จังหวัด" ด่าน probe ต้องได้ชุด lp.id · index ของ 258 ไม่มี id
--   ⇒ ต้องไปอ่าน heap ทุกแถวของจังหวัดนั้น (107 วิ) · มี id ในตัว ⇒ index-only 22 ms
--   ผู้ใช้จริงโดน timeout 3 ครั้ง (phuket 7 ต.ค. 09:24)
-- central ทำแล้วด้วยมือ: สร้างตัวใหม่ CONCURRENTLY (4.45 GB · 82 วิ) → DROP ตัวเก่า CONCURRENTLY → RENAME
--   ⇒ ไฟล์นี้ไม่ทำอะไรบน central (นิยามตรงแล้ว) · ใช้กับเครื่องที่ได้นิยามของ 258 ไปแล้วเท่านั้น
-- ⚠️ บนตารางที่มีข้อมูลมาก การสร้างใน migration (ไม่ CONCURRENTLY) จะล็อกการเขียนระหว่างสร้าง —
--    เครื่องติดตั้งใหม่ตารางว่าง ไม่มีปัญหา · เครื่องที่มีข้อมูลแล้วให้ทำมือแบบ central ก่อนบูต
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE tablename = 'license_plates' AND indexname = 'idx_plates_region_time'
                AND indexdef NOT LIKE '%INCLUDE (camera_id, id)%') THEN
    DROP INDEX idx_plates_region_time;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_plates_region_time ON license_plates (region, detected_at) INCLUDE (camera_id, id);
