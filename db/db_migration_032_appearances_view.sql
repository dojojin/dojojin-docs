-- ============================================================
-- Migration 032: v_appearances_public — เพิ่มคอลัมน์ IVA Pro
-- ============================================================
-- WHY: migration 031 เพิ่ม top_category/bottom_category/hair_length/glasses/
--      helmet_wear ให้ตาราง appearances แต่ v_appearances_public ยังอ้างแค่
--      schema ชุดเก่า (gender/age_group/upper_color/lower_color/vehicle_*)
--      3rd-party ที่ query view จะไม่เห็น attribute ใหม่เลย
--
-- APPROACH: CREATE OR REPLACE VIEW — append-only (PostgreSQL constraint):
--           คอลัมน์ใหม่ต้องมาหลัง detected_at เสมอ; ห้ามเรียงใหม่/ลบคอลัมน์เก่า
--           ไม่รวม: hair_color_xyz/top_color_xyz/bottom_color_xyz (raw),
--                   snapshot_b64 (filename ไม่เหมาะ expose), bag_category/
--                   helmet_subtype/vest_style (ข้อมูลน้อย — เพิ่มได้ใน Phase ถัดไป)
--
-- PDPA NOTE: view นี้ยังไม่มี GRANT ใดๆ (ยืนยัน \dp ก่อน migration 2026-06-01)
--            การขยาย column = เปลี่ยน scope ข้อมูลที่แชร์ → ต้องมี Data Sharing
--            Agreement ก่อน GRANT role ใดๆ — ห้ามใส่ GRANT ใน migration
--            (GRANT ที่นี่จะรันอัตโนมัติตอน boot และอาจ abort ถ้า role ไม่มี)
--
-- SAFETY: idempotent (CREATE OR REPLACE); ไม่เปลี่ยน data; ไม่มี GRANT
-- ============================================================

CREATE OR REPLACE VIEW v_appearances_public AS
SELECT
  id, event_id, camera_id, object_id, object_class,
  gender, age_group,
  upper_color, lower_color,
  vehicle_type, vehicle_color,
  confidence, attributes, detected_at,
  top_category, bottom_category, hair_length,
  glasses, helmet_wear
FROM appearances;
