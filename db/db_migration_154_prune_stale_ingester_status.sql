-- ============================================================
-- Vigil Platform — ล้างสถานะกล้องที่ไม่มีใครดูแลแล้ว
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ============================================================
-- `ingester_camera_status` มี `dahua-cgi.js` เป็นผู้เขียนไฟล์เดียว และเขียนเฉพาะ
-- ตอน **ไม่ใช่** EDGE_MODE ⇒ ค่าในตารางคือ "ความเห็นของ central" ล้วน ๆ
--
-- หลัง 6cafb4c (2026-08-14) central เลิก poll กล้องของไซต์ที่มี edge ดูแลแล้ว
-- (141 จาก 143 ตัว) ⇒ แถวของกล้องเหล่านั้น **แช่แข็งอยู่ที่ค่าสุดท้ายตลอดไป**
-- ซึ่งเป็นค่าที่ผิดด้วย: `event_stream=reconnecting`, `retry_count` หลักพัน,
-- `last_error_code=EHOSTUNREACH` — ทั้งที่กล้องพวกนั้นส่ง event เข้ามาปกติผ่าน edge
--
-- วัดตอนเขียน migration นี้: 48 แถว hdy + 1 แถว vss (แช่แข็ง) + 5 แถวของกล้องที่
-- ถูกลบไปแล้วตั้งแต่ 16 ก.ค. = 54 แถว **ไม่มีแถวไหนที่ central ยังดูแลอยู่จริงเลย**
--
-- ⚠️ หน้าจอไม่ได้รับผลกระทบ — `routes/devices.js` กรองแถวของกล้อง edge ทิ้งอยู่แล้ว
-- ตั้งแต่ 2026-07-27 · ที่ล้างนี่คือกันไม่ให้หลอกคนที่ query DB ตรง ๆ ซึ่งหลอกมาแล้ว
-- จริง (2026-08-14 ตั้งโจทย์ผิดว่า "หน้า Health โชว์ค่าผิด" เพราะอ่านค่าดิบในตาราง)
--
-- idempotent: รันซ้ำแล้วไม่มีอะไรให้ลบเพิ่ม · บน install ใหม่ที่ยังไม่มี edge_status
-- เงื่อนไขที่สองจะไม่ตรงกับอะไรเลย เหลือแค่การเก็บกวาด orphan ตามปกติ
-- ============================================================

-- 🔴 เงื่อนไข (2) ต้องรู้จัก `reported_by` ด้วย ไม่งั้นมันจะลบของดี
--
-- ตอนเขียนครั้งแรก central เป็นผู้เขียนคนเดียว "แถวของกล้อง edge" จึงแปลว่า
-- "ความเห็นที่ใช้ไม่ได้" เสมอ · พอ migration 155 เปิดทางให้ **edge รายงานเอง**
-- ประโยคเดิมกลายเป็นตัวลบสถานะจริงที่ไซต์เพิ่งส่งขึ้นมา (จับได้ตอน audit
-- 2026-08-14: รันซ้ำแล้วแถวของ DAHUA_CAM01 ที่ vss เพิ่งรายงานหายไป)
--
-- 154 มาก่อน 155 จึงเช็คจาก information_schema แทนที่จะอ้างคอลัมน์ตรง ๆ —
-- ตอนรันครั้งแรกคอลัมน์ยังไม่มี (ทุกแถวเป็นของ central อยู่แล้ว) ตอนรันซ้ำมีแล้ว
DO $$
DECLARE has_reported_by boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'ingester_camera_status' AND column_name = 'reported_by'
  ) INTO has_reported_by;

  -- (1) กล้องถูกลบไปแล้ว แต่แถวสถานะยังค้าง — ไม่มี FK/CASCADE จึงไม่มีใครเก็บ
  --     (migration 156 ใส่ FK ให้แล้ว ข้อนี้จึงเป็นการเก็บกวาดของเก่าเท่านั้น)
  DELETE FROM ingester_camera_status i
   WHERE NOT EXISTS (SELECT 1 FROM cameras c WHERE c.id = i.camera_id);

  -- (2) กล้องอยู่ในไซต์ที่มี edge ⇒ ความเห็นของ **central** ใช้ไม่ได้ ค่าจะไม่มีวันสด
  --     แต่ถ้าแถวนั้น edge เป็นคนรายงาน = ของจริง ห้ามแตะ
  IF has_reported_by THEN
    DELETE FROM ingester_camera_status i
     WHERE i.reported_by = 'central'
       AND EXISTS (SELECT 1 FROM cameras c
                     JOIN sites s       ON s.id = c.site_id
                     JOIN edge_status e ON e.site_id = s.code
                    WHERE c.id = i.camera_id);
  ELSE
    DELETE FROM ingester_camera_status i
     WHERE EXISTS (SELECT 1 FROM cameras c
                     JOIN sites s       ON s.id = c.site_id
                     JOIN edge_status e ON e.site_id = s.code
                    WHERE c.id = i.camera_id);
  END IF;
END $$;

COMMENT ON TABLE ingester_camera_status IS
  'สถานะการเชื่อมต่อกล้องจากมุมของ central เท่านั้น (dahua-cgi.js เขียน, ข้ามเมื่อ EDGE_MODE) — '
  'กล้องที่มี edge ดูแลจะไม่มีแถวที่นี่ เพราะ central ไม่ได้ poll เอง ดู migration 154';
