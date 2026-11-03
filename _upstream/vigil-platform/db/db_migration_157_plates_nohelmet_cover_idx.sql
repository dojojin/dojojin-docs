-- ============================================================
-- Migration 157: covering index สำหรับหน้า "อันดับไม่สวมหมวกนิรภัย"
-- ------------------------------------------------------------
-- ปัญหา (วัดผ่าน API จริง 2026-08-15, license_plates 16 ล้านแถว):
--     รายวัน 1.1 วิ · รายสัปดาห์ 14.9 วิ · รายเดือน 19.6 วิ
--
-- query กรอง (detected_at ในช่วง) AND no_helmet AND confidence AND regex ป้าย
--   · idx_plates_detected_at → ช่วงเวลาได้ แต่ต้องคัด no_helmet ทีหลังจากแถวมหาศาล
--   · idx_plates_no_helmet   → เป็น (event_id) WHERE no_helmet ⇒ ใช้กับช่วงเวลาไม่ได้
--
-- ลองแล้ว 2 ขั้น (วัดจริงทั้งคู่):
--   1) partial index เฉย ๆ  (detected_at) WHERE no_helmet
--      → Index Scan ได้ แต่ยังต้องอ่าน heap 573,022 แถวเพื่อเช็ค confidence/regex
--      → รายเดือนยัง 14.8 วิ  ⇒ **ไม่พอ**
--   2) เติม INCLUDE ให้ครบทุกคอลัมน์ที่ query ใช้ → Index Only Scan
--      → heap fetch เหลือ 86,564 · รายเดือน **0.47 วิ** ⇒ ใช้ตัวนี้
--
-- ผลผ่าน API จริงหลังมี index:
--     รายวัน 153ms · รายสัปดาห์ 830ms · รายเดือน 1,557ms
-- ขนาด index 63 MB
--
-- ⚠️ ทำไมไม่ใส่ CONCURRENTLY ในไฟล์นี้:
--   migrate.js ห่อทุก migration ด้วย BEGIN/COMMIT (src/migrate.js:79-87)
--   แต่ CREATE INDEX CONCURRENTLY รันใน transaction block ไม่ได้ → จะ error
--   ⇒ ไฟล์นี้ใช้แบบธรรมดา สำหรับติดตั้งใหม่ที่ตารางยังเล็ก
--   ⇒ บน production ที่ตารางใหญ่แล้ว สร้างด้วยมือก่อน (ทำแล้วบน central 2026-08-16
--      ใช้เวลา ~6 วินาที ไม่ล็อก ingest) migration นี้จะ no-op เพราะ IF NOT EXISTS
--
--   คำสั่งสร้างด้วยมือ:
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plates_nohelmet_cover
--       ON license_plates (detected_at)
--       INCLUDE (plate_number, camera_id, confidence) WHERE no_helmet;
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_nohelmet_cover
  ON license_plates (detected_at)
  INCLUDE (plate_number, camera_id, confidence)
  WHERE no_helmet;

COMMENT ON INDEX idx_plates_nohelmet_cover IS
  'หน้าอันดับไม่สวมหมวกนิรภัย — Index Only Scan ตามช่วงเวลาเฉพาะแถว no_helmet (migration 157)';
