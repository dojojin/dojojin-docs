-- ============================================================
-- Vigil Platform — migration 125: บอกให้ชัดว่า snapshot_retention_days คุมแค่ central
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- คำอธิบายเดิมเขียนว่า "Days of snapshot images to keep on disk" ซึ่งไม่ได้บอกว่า
-- ดิสก์ของเครื่องไหน · อ่านแล้วเข้าใจได้ว่าคุมทั้งระบบรวม edge ด้วย ซึ่งไม่จริง
--
-- ตรวจโค้ดจริงแล้ว 2026-08-08 ยืนยันว่าคุมแค่ central:
--   • enforceSnapshotRetention() ใน api-server.js อ่านค่านี้แล้วเดินบน SNAPSHOT_DIR
--     ของ central เองเท่านั้น
--   • helpers/publishSiteRetention.js ที่ส่ง policy ลง edge ผ่าน MQTT
--     (projects/{site}/_config/retention) อ่านจากคอลัมน์ใน `sites` ล้วน —
--     retention_events_days / retention_lpr_days / retention_face_days /
--     retention_min_free_gb — ไม่แตะ system_settings เลย
--   • ไม่มีเส้นทางไหนในโค้ดที่ส่ง system_settings ลง edge
--
-- ค่าที่คุมรูปบน edge จริงคือคอลัมน์ราย site ตั้งได้ที่หน้า ตั้งค่า › ระบบ
-- หัวข้อ "อายุการเก็บรูปที่ edge ของไซต์นี้" (page-system.js) ซึ่งมีถ้อยคำถูกอยู่แล้ว
--
-- ไม่มีโค้ดไหนอ่าน system_settings.description — เป็นข้อความสำหรับคนที่มาดู DB
-- โดยตรง การแก้จึงไม่กระทบพฤติกรรมใด ๆ ส่วนข้อความบนหน้าจอแก้ที่ i18n คู่กัน
-- ============================================================

UPDATE system_settings
   SET description = 'Days of snapshot images to keep on CENTRAL''s own disk (max 365). '
                  || 'Applies only to ingesters that write into central''s SNAPSHOT_DIR. '
                  || 'It does NOT reach edge nodes — edge image retention is per site in '
                  || 'sites.retention_events_days / retention_lpr_days / retention_face_days, '
                  || 'published over MQTT by helpers/publishSiteRetention.js.'
 WHERE key = 'snapshot_retention_days';
