-- ============================================================
-- Vigil Platform — migration 231: เปิดแจ้งเตือนออฟไลน์+ภาพประกอบให้กล้องใบหน้าที่ HKT
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-15: ต่อจาก migration 227/230 (เปิดให้กล้อง LPR 18 ตัวที่ HKT
-- แล้ว) — เจ้าของยืนยันให้เปิดกล้องที่เหลือทั้งหมดด้วย (cam_role='face' 68 ตัว)
-- ทั้งแจ้งเตือนออฟไลน์ (เดิมปิดอยู่ทั้งหมด) และภาพประกอบ (send_snapshot)
--
-- ใช้เงื่อนไขเดียวกับ migration 227 ทุกประการ (notify/escalate/ผู้รับ) เพื่อให้
-- พฤติกรรมสม่ำเสมอกันทั้งไซต์ — ตรวจก่อนเขียน: มีแถวใน camera_offline_alerts
-- ครบ 68/68 อยู่แล้ว (upsert จาก checkOfflineCameras ตอน enabled=false) จึงเป็น
-- UPDATE ล้วน ไม่ต้อง INSERT แต่ใส่ไว้กันเหตุเช่นเดียวกับ 227
-- ============================================================

UPDATE camera_offline_alerts o
   SET enabled = TRUE,
       notify_after_sec = 300,
       escalate_interval_min = 120,
       escalate_once = FALSE,
       send_snapshot = TRUE,
       recipient_ids = 'C407b15147bc1e6043491792d04362ddd,U0ee506e05ee15d8c6ab29c72340c1304',
       updated_at = NOW()
  FROM cameras c
 WHERE c.id = o.camera_id
   AND c.site_id = 18
   AND c.cam_role = 'face';

INSERT INTO camera_offline_alerts
  (camera_id, enabled, notify_after_sec, escalate_interval_min, escalate_once, send_snapshot, recipient_ids, updated_at)
SELECT c.id, TRUE, 300, 120, FALSE, TRUE,
       'C407b15147bc1e6043491792d04362ddd,U0ee506e05ee15d8c6ab29c72340c1304', NOW()
  FROM cameras c
 WHERE c.site_id = 18 AND c.cam_role = 'face'
   AND NOT EXISTS (SELECT 1 FROM camera_offline_alerts o WHERE o.camera_id = c.id);
