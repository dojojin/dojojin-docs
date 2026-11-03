-- ============================================================
-- Vigil Platform — migration 177: อายุไฟล์รายงาน PNG เป็น setting
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- 2026-08-24:
-- อายุไฟล์รายงาน PNG เป็นเลขตายตัว 30 วันในโค้ด (api-server.js) ขณะที่อีก 4 หมวด
-- ตั้งค่าได้จาก system_settings มาตลอด หน้าจัดการพื้นที่จัดเก็บ (migration 176)
-- บอกว่า "ตั้งอายุแยกอิสระได้ทุกหมวด" ซึ่งจะไม่จริงถ้าเหลือหมวดหนึ่งที่แก้ไม่ได้
--
-- ค่าเริ่มต้น 30 = ค่าเดิมที่ hardcode ไว้ ผู้ใช้ที่ไม่แตะอะไรจึงได้พฤติกรรมเดิมเป๊ะ

INSERT INTO system_settings (key, value, description)
VALUES ('report_retention_days', '30', 'จำนวนวันที่เก็บไฟล์รายงาน PNG บนดิสก์ (1-365)')
ON CONFLICT (key) DO NOTHING;
