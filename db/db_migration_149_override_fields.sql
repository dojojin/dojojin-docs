-- ============================================================
-- Vigil Platform — migration 149: แก้ไขข้อมูลโรสเตอร์ได้ครบทุกช่อง + รูป
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- เจ้าของชี้ 2026-08-13: หน้าเพิ่ม/แก้ไขข้อมูล blacklist ยังแก้ได้ไม่ครบ
-- อยากเพิ่มรูปได้ และแก้สีรถ/ยี่ห้อ/ฯลฯ ได้ทุกส่วน
--
-- สาเหตุที่หน้าแก้ไขมีแค่ 3 ช่อง ไม่ใช่ลืมใส่ — `blacklist.overrides` เก็บได้แค่
-- name / plate_numbers / case_note / excluded เท่านั้น **ไม่มีที่เก็บช่องอื่นเลย**
--
-- ทำไมเป็นคอลัมน์ ไม่ใช่ JSONB ก้อนเดียว (เจ้าของเลือก 2026-08-13):
-- ฟิลด์ชุดนี้นิ่งแล้ว (มาจากโรสเตอร์จริงที่นับแล้ว) และต้องเอาไปแปลงส่งกลับ HCP
-- ซึ่งรับชนิดที่แน่นอน (vehicleColor เป็นตัวเลข ฯลฯ) — คอลัมน์บังคับชนิดให้ได้
-- ตั้งแต่ชั้น DB ส่วน JSONB ต้องไปตรวจเอาเองทุกจุดที่อ่าน
--
-- ⚠️ NULL = "ไม่ได้แก้" ไม่ใช่ "ตั้งเป็นค่าว่าง" — ทุกตัวอ่านต้อง COALESCE ทับค่าดิบ
-- ถ้าตีความ NULL เป็นค่าว่าง การแก้ช่องเดียวจะล้างช่องอื่นทิ้งหมด

ALTER TABLE blacklist.overrides
  ADD COLUMN IF NOT EXISTS brand         TEXT,   -- ยี่ห้อ/รุ่น (raw_json.carbrand)
  ADD COLUMN IF NOT EXISTS vehicle_type  TEXT,   -- ประเภทรถ  (raw_json.cartype)
  ADD COLUMN IF NOT EXISTS vehicle_color TEXT,   -- สีรถ      (raw_json.carcolor)
  ADD COLUMN IF NOT EXISTS plate_type    TEXT,   -- สี/ชนิดป้าย (raw_json.platetype)
  ADD COLUMN IF NOT EXISTS case_kind     TEXT,   -- ประเภทคดี  (raw_json.owner_detail)
  -- จังหวัดเป็นตัวตัดสินว่าป้ายเข้าเฝ้าระวังได้หรือไม่ (bridge บังคับต้องมี)
  -- แก้ได้จึงสำคัญ: ระเบียนจาก HCP ไม่มีจังหวัด คนกรอกเองแล้วใช้งานได้ทันที
  ADD COLUMN IF NOT EXISTS province      TEXT,
  -- รูปที่คนอัปเอง · เก็บ path ใต้ PHOTO_DIR แบบเดียวกับ source_records.photo_path
  -- เพื่อให้ตัวอ่านและตัวคัดลอกไฟล์ของ bridge ใช้เส้นทางเดียวกัน ไม่ต้องแยกกรณี
  ADD COLUMN IF NOT EXISTS photo_path    TEXT;

COMMENT ON COLUMN blacklist.overrides.province IS
  'จังหวัดที่คนแก้เอง — ทับ raw_json.province · มีค่านี้แล้วป้ายที่ต้นทางไม่ส่งจังหวัดมา (เช่น HCP) เข้าเฝ้าระวังได้ (migration 149)';
COMMENT ON COLUMN blacklist.overrides.photo_path IS
  'รูปที่คนอัปเอง เก็บใต้ PHOTO_DIR เหมือน source_records.photo_path · ทับรูปจากต้นทาง (migration 149)';
