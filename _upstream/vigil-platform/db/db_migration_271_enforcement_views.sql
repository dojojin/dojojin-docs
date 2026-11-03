-- ============================================================
-- Vigil Platform — Migration 271: view Traffic Enforcement สำหรับ partner API (OpenAPI ระยะ 2 · S2)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เจ้าของตัดสิน 2026-10-22: ตัวนับดิบ + ตัวหาร ไม่ส่งอัตรา · ส่ง no_helmet_with_plate (= ตัวเลขบนหน้าจอ
-- "ไม่สวมหมวก · พร้อมข้อมูลทะเบียน") · ไม่ส่งผู้ทำผิดซ้ำรายป้าย · ไม่มีรายวัน (partner รวมรายชั่วโมงเองได้ตรงทุกตัว)
-- ชื่อคอลัมน์ของ view = ชื่อฟิลด์ใน /v1 = สัญญา · ไม่ GRANT ให้ใคร (ติ๊กเองรายคอลัมน์ ตาม migration 268)
--
-- ความครอบคลุม: ช่อง no_helmet ใน DB เป็น false ไม่ใช่ NULL เมื่อกล้องตรวจไม่ได้ ⇒ 0 แยก "ไม่มีคนผิด" กับ
-- "กล้องตรวจไม่ได้" ไม่ออก · รุ่นเดียวกันยังต่างกันตามการตั้งค่า (Dahua ITC431 ตรวจหมวก 7 จาก 13 ตัว)
-- จึงใช้ "เคยรายงานในข้อมูลที่เก็บไว้ (120 วัน)" — ไม่ขึ้นกับช่วงที่ partner ขอ ไม่แกว่งแบบเกณฑ์บนหน้าจอ
-- ============================================================

-- ความผิดต่อกล้องต่อชั่วโมง พร้อมตัวหารแยกประเภทรถ (รหัสดิบจากกล้อง · ไม่ใส่ค่า 0 ใน by_type)
CREATE OR REPLACE VIEW v_enforcement_hourly_public AS
SELECT bucket_hour                     AS hour_start,
       camera_id,
       sum(n_no_helmet)::int           AS no_helmet,
       sum(n_no_helmet_ok)::int        AS no_helmet_with_plate,
       sum(n_no_seatbelt)::int         AS no_seatbelt,
       sum(n_riders3)::int             AS riders3,
       jsonb_object_agg(vehicle_type, jsonb_strip_nulls(jsonb_build_object(
         'vehicles',             n_total,
         'no_helmet',            nullif(n_no_helmet, 0),
         'no_helmet_with_plate', nullif(n_no_helmet_ok, 0),
         'no_seatbelt',          nullif(n_no_seatbelt, 0),
         'riders3',              nullif(n_riders3, 0)))) AS by_type,
       max(updated_at)                 AS updated_at
  FROM traffic_hourly_stats
 GROUP BY bucket_hour, camera_id;

-- กล้องตัวไหนเคยรายงานความผิดแต่ละแบบ (false = ไม่เคยรายงาน ไม่ใช่ "ไม่มีคนผิด")
CREATE OR REPLACE VIEW v_enforcement_cameras_public AS
SELECT camera_id,
       bool_or(n_no_helmet > 0)   AS reports_no_helmet,
       bool_or(n_no_seatbelt > 0) AS reports_no_seatbelt,
       bool_or(n_riders3 > 0)     AS reports_riders3,
       min(bucket_hour)           AS first_hour,
       max(bucket_hour)           AS last_hour
  FROM traffic_hourly_stats
 GROUP BY camera_id;

COMMENT ON VIEW v_enforcement_hourly_public  IS 'Partner API /v1/enforcement/hourly (migration 271). Raw counts only. Column names are the /v1 contract.';
COMMENT ON VIEW v_enforcement_cameras_public IS 'Partner API /v1/enforcement/cameras (migration 271). false = never reported in retained data, not "no offenders".';
