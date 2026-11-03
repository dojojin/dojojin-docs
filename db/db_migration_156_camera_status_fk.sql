-- ============================================================
-- Vigil Platform — ผูกสถานะกล้องเข้ากับตารางกล้อง
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ============================================================
-- `ingester_camera_status.camera_id` ไม่เคยมี FK ⇒ ลบกล้องแล้วแถวสถานะค้างอยู่
-- ไม่มีใครเก็บ · migration 154 เก็บกวาดของเก่าไป 5 แถว (ค้างตั้งแต่ 16 ก.ค.)
-- แต่ไม่ได้กันไม่ให้เกิดใหม่
--
-- ⚠️ FK นี้เปลี่ยนพฤติกรรม ไม่ใช่แค่เก็บกวาด — insert ของ camera_id ที่ไม่มีใน
-- `cameras` จะ **throw** แทนที่จะเขียนแถวกำพร้า · ตรวจผู้เขียนทั้งสองทางแล้ว:
--   1. dahua-cgi.js upsertCamStatus() (central) — camera_id มาจาก cameras-config.json
--      ซึ่ง generate มาจากตาราง cameras เอง ⇒ มีอยู่จริงเสมอ · และมี .catch() ครอบอยู่
--   2. mqtt-subscriber.recordEdgeCameraStatus() — แก้ให้ **ต้องรู้จักกล้องก่อน**
--      จึงจะเขียน (เดิม fail-open เมื่อไม่รู้จัก) ⇒ ไม่มีทางไปชน FK
--
-- ON DELETE CASCADE: ลบกล้อง = ลบสถานะของกล้องนั้นด้วย ซึ่งเป็นสิ่งที่ควรเกิด
-- อยู่แล้ว · ไม่มี ON UPDATE เพราะ `cameras.id` เป็น natural key ที่ไม่เคยถูกแก้
--
-- idempotent: เช็คชื่อ constraint ก่อนสร้าง · และล้าง orphan ซ้ำก่อนผูก เผื่อมี
-- แถวเกิดใหม่ระหว่าง 154 กับ 156 (ไม่งั้น ADD CONSTRAINT จะล้มทั้ง migration
-- ซึ่งตาม STUBBORN_FACT #81 จะทำให้ api-server ไม่ยอม start — ตั้งใจให้เป็นแบบนั้น
-- แต่ในเคสนี้เราป้องกันได้ก่อน จึงไม่ควรปล่อยให้ไปล้มตรงนั้น)
-- ============================================================

-- กันไว้ก่อนผูก — orphan ที่เหลืออยู่จะทำให้ ADD CONSTRAINT ล้ม
DELETE FROM ingester_camera_status i
 WHERE NOT EXISTS (SELECT 1 FROM cameras c WHERE c.id = i.camera_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'ingester_camera_status'::regclass
       AND conname  = 'ingester_camera_status_camera_id_fkey'
  ) THEN
    ALTER TABLE ingester_camera_status
      ADD CONSTRAINT ingester_camera_status_camera_id_fkey
      FOREIGN KEY (camera_id) REFERENCES cameras (id) ON DELETE CASCADE;
  END IF;
END $$;
