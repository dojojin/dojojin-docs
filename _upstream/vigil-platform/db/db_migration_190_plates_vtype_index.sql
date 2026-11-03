-- ============================================================
-- Vigil Platform — Migration 190: index สำหรับตัวกรองประเภทรถในหน้า LPR
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-08-31 (เจ้าของแจ้ง "ค้นหาประเภทรถแล้วค้าง"): กรอง
-- VEHICLE TYPE = Bus (Large) ที่ HatYai แล้วหน้าค้างที่ Loading... ถาวร
--
-- วัดจริงด้วย EXPLAIN ANALYZE บนข้อมูลจริง:
--   Execution Time: 88,113 ms
--   Rows Removed by Filter: 27,189,224   (ตารางมี 27,260,408 แถว)
--   Buffers: shared hit=18,453,667 read=968,626
-- คือกวาดเกือบทั้งตารางเพื่อหา 60 แถว เพราะไม่มี index บน vehicle_type เลย
--
-- กับดักอยู่ที่ selectivity: largeBus มี 15,977 แถวใน 7 วัน เทียบกับ ~4.5 ล้านแถว
-- ในช่วงเดียวกัน · การเดิน idx_plates_detected_at ถอยหลังเพื่อเก็บให้ครบ 60 คัน
-- จึงต้องแตะเกือบทั้งตาราง · ประเภทที่พบบ่อยจะดูปกติดี ประเภทที่หายากจะค้าง
-- ซึ่งเป็นเหตุผลที่ไม่มีใครเจอมาก่อน — หน้า default ไม่ได้กรองประเภท
--
-- vehicle_type นำหน้าเพื่อให้ประเภทหายากกลายเป็น range scan เฉพาะประเภทนั้น
-- และเรียงตาม detected_at มาให้แล้วในตัว ไม่ต้อง sort
-- INCLUDE camera_id เพื่อให้กรอง site/กล้องได้จาก index ไม่ต้องแตะ heap ทีละแถว
-- (รูปทรงเดียวกับ idx_events_class_time ใน migration 184 ซึ่งลด /api/events
--  จาก 18.3 วินาทีเหลือ 0.5 วินาทีด้วยเหตุผลเดียวกัน)
--
-- ⚠️ บนเครื่องที่มีข้อมูลอยู่แล้ว (central) index ถูกสร้างด้วยมือแบบ
--    CREATE INDEX CONCURRENTLY เพราะ migrate.js ครอบทุกไฟล์ด้วย transaction และ
--    CONCURRENTLY รันใน transaction ไม่ได้ · CREATE INDEX ธรรมดาบนตาราง 27 ล้านแถว
--    จะจับ ACCESS EXCLUSIVE นานหลายนาที = LPR ingest ค้างทั้งช่วงนั้น
--    ไฟล์นี้จึงเป็น IF NOT EXISTS: central ข้ามเพราะมีอยู่แล้ว เครื่องติดตั้งใหม่
--    (ตารางว่าง) สร้างได้ทันทีไม่มีผลกระทบ
--
-- ⚠️ license_plates **ไม่ได้ partition** (ตรวจด้วย pg_inherits แล้วได้ 0 ลูก
--    ต่างจาก events) จึงเป็น index ตัวเดียว ไม่ต้องวนทีละ partition
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_vtype_time
  ON license_plates (vehicle_type, detected_at DESC)
  INCLUDE (camera_id, plate_number, confidence);
