-- ============================================================
-- Vigil Platform — index ครอบสำหรับตัวกรอง object_class ในหน้า Events
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-08-30: /api/events?object_classes=... ใช้เวลา 3-18 วินาที
-- (วัดจาก endpoint จริง) เพราะ COUNT(*) OVER () ต้องนับทุกแถวที่ผ่านตัวกรอง
-- แต่ตาราง events ไม่มี index บน object_class เลย ⇒ ต้องอ่าน heap ของ
-- ~980,000 แถว/24 ชม. เพื่อนับผลไม่กี่พันแถว
--
-- INCLUDE ครบทุกคอลัมน์ที่ predicate ของหน้านี้ใช้ (event_type / event_state /
-- has_snapshot / camera_id) เพื่อให้การนับเป็น Index Only Scan ไม่ต้องแตะ heap
-- — ตรวจแล้วว่าไม่มี predicate ไหนอ่าน raw_json (ANALYTICS_KEY_SQL ใช้แค่
-- event_type) ถ้าอนาคตมีเงื่อนไขใหม่ที่อ่าน raw_json การนับจะกลับไปแตะ heap
-- และช้าเหมือนเดิม โดยไม่มีอะไรเตือน
--
-- ⚠️ บนเครื่องที่มีข้อมูลอยู่แล้ว (central) index ถูกสร้างด้วยมือแบบ
--    CREATE INDEX CONCURRENTLY ทีละ partition แล้ว ATTACH เข้ากับ index ของ
--    ตารางแม่ — เพราะ:
--      1) migrate.js ครอบทุกไฟล์ด้วย transaction และ CONCURRENTLY รันใน
--         transaction ไม่ได้
--      2) CREATE INDEX ธรรมดาบน partition 41GB จะจับ ACCESS EXCLUSIVE นาน
--         หลายนาที = ingest ~1,000 event/นาที ค้างทั้งช่วงนั้น
--    ไฟล์นี้จึงเป็น IF NOT EXISTS: บน central จะข้ามเพราะมีชื่อนี้อยู่แล้ว
--    ส่วนเครื่องติดตั้งใหม่ (ตารางยังว่าง) สร้างได้ทันทีไม่มีผลกระทบ
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_class_time
  ON events (object_class, event_time DESC)
  INCLUDE (event_type, event_state, has_snapshot, camera_id);

-- Index Only Scan จะข้าม heap ได้ก็ต่อเมื่อ visibility map ของ block นั้น "ทั้ง
-- block มองเห็นได้หมด" ซึ่งมาจาก VACUUM เท่านั้น · วัดจริง 2026-08-30: ทันทีหลัง
-- สร้าง index ยังมี Heap Fetches 204,005 ⇒ endpoint ใช้เวลา 12-25 วินาที · พอ
-- VACUUM แล้วเหลือ 0.5-1.4 วินาที (จากเดิม 18.3 วินาที)
--
-- ตารางนี้รับ ~980,000 แถว/วัน ค่า default ของ autovacuum (scale_factor 0.2 =
-- รอจนกว่าจะเปลี่ยน 20% ของตาราง) แปลว่า partition เดือนที่มี 20 ล้านแถวต้องรอ
-- ถึง 4 ล้านแถวก่อนจะ vacuum รอบถัดไป — นานพอที่ visibility map จะเก่าและ
-- ประสิทธิภาพจะค่อย ๆ เสื่อมกลับไปโดยไม่มีอะไรเตือน
-- ⚠️ ตั้งที่ตารางแม่ไม่ได้ — PostgreSQL ปฏิเสธ storage parameter บน partitioned
--    table ("cannot specify storage parameters for a partitioned table") จึงต้อง
--    วนตั้งทีละ partition · partition ของเดือนถัดไปถูกสร้างล่วงหน้าไว้ถึงปี 2027
--    แล้ว (db/MANUAL_partition_events_option_a.sql) DO block นี้จึงครอบคลุมทั้งหมด
--    รวมของอนาคตด้วย · ถ้ามีการสร้าง partition เพิ่มหลังจากนี้ ต้องตั้งค่าเดียวกัน
--    ให้ด้วย ไม่งั้นเดือนนั้นจะช้ากลับไปเงียบ ๆ
DO $$
DECLARE part text;
BEGIN
  FOR part IN
    SELECT c.relname FROM pg_inherits i
      JOIN pg_class c  ON c.oid = i.inhrelid
      JOIN pg_class pc ON pc.oid = i.inhparent
     WHERE pc.relname = 'events'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02)',
      part);
  END LOOP;
END $$;
