-- ============================================================
-- Vigil Platform — Migration 273: ฟิลด์รายแถวเพิ่มใน view ของ partner (OpenAPI ระยะ 2 · ขั้น 2) + แก้ age_group ว่าง
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของสั่ง 2026-10-22: ทำรอไว้ให้พร้อมส่ง ถึงจะยังไม่มีใครขอ (ทดสอบกับ TEST) · ตาม DEMO OpenAPI
-- คอลัมน์ใหม่ไม่ GRANT ให้ใคร — ต้องติ๊กเองรายคอลัมน์ (migration 268) · ต่อท้ายเพราะ CREATE OR REPLACE VIEW เพิ่มได้แค่ท้าย
-- ชื่อคอลัมน์ = ชื่อฟิลด์ใน /v1 = สัญญา · ค่าเป็นรหัสดิบจากกล้อง (ต่างยี่ห้อใช้คำต่างกัน เช่น อายุ prime/middleAged)
--
-- age_group: ค่าเดิมว่าง 100% เพราะกล้องส่งอายุมาที่ rj_age_group (มี 76.7%) · หน้าจอเราใช้ COALESCE อยู่แล้ว
--   (routes/appearances.js) · ความหมายของฟิลด์ไม่เปลี่ยน แค่เติมค่าที่ควรมี ⇒ ไม่ผิดสัญญา /v1 (เจ้าของ OK 2026-10-22)
--   cast กลับเป็น varchar(20) เพราะ CREATE OR REPLACE VIEW เปลี่ยนชนิดคอลัมน์เดิมไม่ได้ (ค่ายาวสุดจริง 10 ตัว)
-- ============================================================

CREATE OR REPLACE VIEW v_license_plates_public AS
SELECT id, event_id, camera_id, plate_number, confidence, country, region,
       bbox_x, bbox_y, bbox_width, bbox_height, detected_at,
       vehicle_type, vehicle_color, vehicle_brand, plate_type, plate_color,
       no_helmet, rider_count, no_seatbelt,
       lane_no AS lane
  FROM license_plates;

CREATE OR REPLACE VIEW v_appearances_public AS
SELECT id, event_id, camera_id, object_id, object_class, gender,
       COALESCE(age_group, rj_age_group)::varchar(20) AS age_group,
       upper_color, lower_color, vehicle_type, vehicle_color, confidence, attributes, detected_at,
       top_category, bottom_category, hair_length, glasses, helmet_wear,
       rj_mask       AS mask,
       rj_hat        AS hat,
       rj_expression AS expression,
       bag_category,
       overall_color,
       hair_color
  FROM appearances;
