-- ============================================================
-- Vigil Platform — migration 232: ยืดรอบแจ้งเตือนซ้ำ HKT จาก 2 ชม. เป็น 4 ชม.
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-15: เจ้าของเห็นการ์ดแจ้งเตือนซ้ำจริงแล้วบอกว่าถี่ไป (ทุก 2 ชม.)
-- ขอเป็นทุก 4 ชม. แทน — คู่กับที่แก้โค้ดให้นาฬิกาแจ้งซ้ำยึดตามกลุ่มผู้รับแทน
-- นาฬิกาของกล้องแต่ละตัว (กันแจ้งกระจายกันคนละเวลา)
-- ============================================================

UPDATE camera_offline_alerts o
   SET escalate_interval_min = 240,
       updated_at = NOW()
  FROM cameras c
 WHERE c.id = o.camera_id
   AND c.site_id = 18
   AND o.enabled = TRUE;
