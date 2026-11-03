-- ============================================================
-- Vigil Platform — BS1 · จับว่าอะไร "หายไปจากต้นทาง"
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- `runImport()` เป็น upsert ล้วนมาตลอด — ต้นทางลบแถวไหนทิ้ง เราไม่มีทางรู้เลย
-- แถวนั้นค้างอยู่ในระบบเราตลอดไปและยังเฝ้าระวังต่อ ทั้งที่ต้นทางถอนออกแล้ว
--
-- `last_seen_at` คือหลักฐานว่า "รอบล่าสุดที่กวาดครบทั้งชุด ยังเจอแถวนี้อยู่"
-- ⇒ แถวที่ `last_seen_at` เก่ากว่าเวลาเริ่มรอบล่าสุด = ต้นทางไม่ส่งมาแล้ว
--
-- ทำไมไม่ใช้ `updated_at` ที่มีอยู่: มันขยับทุกครั้งที่ ON CONFLICT DO UPDATE ทำงาน
-- ก็จริง แต่มันขยับเพราะ "ค่าเปลี่ยน" ด้วย — สองความหมายปนกันในคอลัมน์เดียว
-- แล้ววันหนึ่งจะมีคนแก้ที่อื่นแล้วทำให้ตัวจับของหายพังโดยไม่รู้ตัว
--
-- 🔴 `last_seen_at` เป็น NULL โดยตั้งใจ ไม่ backfill เป็น NOW()
-- ถ้า backfill ทุกแถวจะดู "เพิ่งเห็นเมื่อกี้" แล้วรอบ import ถัดไปจะทำให้แถวที่
-- ไม่ได้อยู่ในรอบนั้นกลายเป็น vanished ยกชุด — คือความผิดพลาดชนิดที่เฟสนี้มีไว้กัน
-- NULL = "ยังไม่เคยถูกกวาดด้วยกลไกนี้" → ตัวสแกนข้ามไปเสมอ จนกว่าจะเห็นรอบแรก
-- ============================================================

ALTER TABLE blacklist.source_records
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vanished_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vanish_reason TEXT;

-- ตัวสแกนถามคำถามเดียว: แถวไหนของแหล่งนี้ที่ยังไม่ถูกทำเครื่องหมายและเก่ากว่ารอบล่าสุด
CREATE INDEX IF NOT EXISTS idx_bl_source_records_lastseen
  ON blacklist.source_records(source_id, data_type, last_seen_at)
  WHERE vanished_at IS NULL;

-- หน้าจอ BS4 (และการกู้คืน) ต้องหาแถวที่ถูกทำเครื่องหมายไว้ได้เร็ว
CREATE INDEX IF NOT EXISTS idx_bl_source_records_vanished
  ON blacklist.source_records(source_id, vanished_at)
  WHERE vanished_at IS NOT NULL;
