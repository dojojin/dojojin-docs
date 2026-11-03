-- ============================================================
-- Vigil Platform — migration 178: นับ orphan ของภาพเหตุการณ์
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- 2026-08-24:
-- ไฟล์ภาพที่ event เจ้าของถูกลบไปแล้ว (ลบ rule หรือหมวดหมู่) ยังกินดิสก์อยู่จนครบ
-- อายุ retention และมองไม่เห็นเลยว่ามีเท่าไร วัดจริง: 31,536 จาก 112,451 ไฟล์ (28.0%)
-- ไม่มีแถวใน events อีกแล้ว
--
-- เก็บเป็นคอลัมน์แยกและมี timestamp ของตัวเอง เพราะการนับต้องส่งชื่อไฟล์ทั้งหมด
-- เข้า Postgres แล้ว anti-join กับตาราง events ที่ไม่มี index บน snapshot_filename
-- ใช้เวลา ~42 วินาที จึงทำถี่กว่ารอบวัดขนาด (825 ms) ไม่ได้
--
-- 🔴 ตัวเลขนี้ใช้ "ดู" ไม่ใช่ "ลบตามได้ทันที": ในช่วง 10 วันมี event 256,307 แถว (2.5%)
-- ที่ snapshot_filename เป็น NULL — เหตุการณ์เกิดจริงแต่ไม่ได้บันทึกชื่อไฟล์ ไฟล์ของมัน
-- จึงหน้าตาเหมือน orphan ทั้งที่เป็นหลักฐาน การลบตามตัวเลขนี้ตรง ๆ จะทำลายของจริง
-- ต้องมีด่านสองที่เทียบกล้อง+เวลาจากชื่อไฟล์ก่อน (event_mqtt_<epoch_ms>.jpg) ซึ่งยังไม่ทำ

ALTER TABLE storage_stats ADD COLUMN IF NOT EXISTS orphans BIGINT;
ALTER TABLE storage_stats ADD COLUMN IF NOT EXISTS orphans_bytes_disk BIGINT;
ALTER TABLE storage_stats ADD COLUMN IF NOT EXISTS orphans_at TIMESTAMPTZ;

COMMENT ON COLUMN storage_stats.orphans IS
  'จำนวนไฟล์ที่ไม่มีแถวใน events อ้างถึง · NULL = ยังไม่ได้ตรวจ หรือหมวดนี้ตรวจไม่ได้ · ตัวเลขนี้ใช้ดู ห้ามลบตามตรง ๆ (ดูหัวไฟล์ migration)';
COMMENT ON COLUMN storage_stats.orphans_at IS
  'เวลาที่นับ orphan ครั้งล่าสุด — แยกจาก measured_at เพราะการนับแพงกว่าการวัดขนาด ~50 เท่า';
