-- ============================================================
-- Vigil Platform — migration 230: เปิด send_snapshot ให้กล้อง LPR ทั้งหมดที่ HKT
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ที่มา 2026-09-15: เจ้าของสั่งเปิดการ์ดแจ้งเตือนกล้องดับแบบมีภาพประกอบ
-- (send_snapshot, migration 229) ให้ "ทุกกล้องใน Site HKT"
--
-- ตรวจก่อนเขียน: ไซต์ HKT (site_id=18) มีกล้องทั้งหมด 86 ตัว แต่มีแค่ 18 ตัว
-- (cam_role='lpr') ที่เปิดแจ้งเตือนออฟไลน์อยู่จริง (migration 227) — อีก 68 ตัว
-- เป็นกล้องใบหน้า (cam_role='face') ที่ไม่เคยเปิดแจ้งเตือนออฟไลน์เลย จึงตีความว่า
-- "ทุกกล้อง" หมายถึงกล้อง 18 ตัวที่อยู่ในขอบเขตแจ้งเตือนอยู่แล้ว ไม่ใช่เปิดแจ้งเตือน
-- ออฟไลน์ใหม่ให้กล้อง 68 ตัวที่ไม่เคยเปิดมาก่อน (เป็นการขยายขอบเขตคนละเรื่อง
-- ไม่ได้ถูกสั่งมาตรง ๆ)
-- ============================================================

UPDATE camera_offline_alerts o
   SET send_snapshot = TRUE,
       updated_at = NOW()
  FROM cameras c
 WHERE c.id = o.camera_id
   AND c.site_id = 18
   AND c.cam_role = 'lpr'
   AND o.enabled = TRUE;
