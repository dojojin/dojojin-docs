-- ============================================================
-- Vigil Platform — extended statistics: no_helmet × vehicle_type
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
--
-- ทำไมต้องมี: สองคอลัมน์นี้สัมพันธ์กันแรงมาก — no_helmet เป็น true ได้เฉพาะรถ 2–3 ล้อ
-- เท่านั้น แต่ planner สมมติว่าเงื่อนไขเป็นอิสระต่อกัน แล้วเอา selectivity มาคูณกัน
-- ผลคือประเมินจำนวนแถวต่ำกว่าจริงหลายเท่า และหน้าค้นหาป้ายทะเบียน (ซึ่งโชว์
-- "ประมาณ N รายการ" จากค่าประมาณของ planner) แสดงตัวเลขที่ขัดกับการ์ดสรุปอย่างแรง
--
-- วัดจริง 2026-08-16 — no_helmet + twoWheelVehicle ของวันนี้:
--   ก่อนมี statistics : planner ว่า 22,806   (ของจริง 63,649 → ต่ำกว่าจริง 64%)
--   หลังมี statistics : planner ว่า 57,780   (ของจริง 63,649 → ต่ำกว่าจริง 9%)
--
-- ไม่ได้แก้ได้ทุกกรณี (ตัวกรองกล้องยังทำให้เพี้ยนอยู่) แต่เป็นการปรับที่ราคาถูกที่สุด
-- และไม่แตะข้อมูลเลย — เป็นแค่สถิติที่ planner ใช้ตัดสินใจ ลบทิ้งได้ทุกเมื่อ
--
-- ไม่ใส่ ANALYZE ไว้ในไฟล์นี้: runner ห่อ migration ด้วย BEGIN/COMMIT และ ANALYZE
-- ในทรานแซกชันบนตาราง 16 ล้านแถวจะถือ lock นานเกินจำเป็นตอน api-server บูต
-- autovacuum จะเก็บให้เองภายในรอบปกติ · ถ้าต้องการผลทันทีให้รัน `ANALYZE license_plates;`
-- ด้วยมือหลัง deploy (ใช้เวลาไม่ถึงวินาทีเมื่อสถิติเดิมยังใหม่อยู่)

CREATE STATISTICS IF NOT EXISTS lp_helmet_vtype_stat (dependencies, mcv)
  ON no_helmet, vehicle_type FROM license_plates;
