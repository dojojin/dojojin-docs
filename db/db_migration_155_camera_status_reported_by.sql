-- ============================================================
-- Vigil Platform — แยกให้ออกว่า "ใครเป็นคนรายงาน" สถานะกล้อง
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ============================================================
-- `ingester_camera_status` เดิมมีผู้เขียนคนเดียวคือ central จึงไม่ต้องแยกว่าใครพูด
-- ตั้งแต่ 6cafb4c central เลิก poll กล้องของไซต์ที่มี edge ⇒ ตารางว่างเปล่าสำหรับ
-- กล้องเหล่านั้น (migration 154 ล้างของเก่าทิ้งแล้ว)
--
-- ขั้นต่อไปคือให้ **edge รายงานสถานะกล้องของตัวเอง** ขึ้นมาแทน · พอมีผู้เขียน 2 ฝ่าย
-- ก็ต้องแยกให้ออก เพราะความน่าเชื่อถือต่างกันคนละเรื่อง:
--   central = "เครื่องนี้ต่อกล้องตัวนั้นได้ไหม" — ไร้ความหมายถ้ากล้องอยู่หลัง edge
--   edge    = "สายของกล้องตัวนั้นยังมีข้อมูลไหลอยู่ไหม" — เป็นความจริงเรื่องกล้อง
--
-- `routes/devices.js` ทิ้งแถวของกล้อง edge ทั้งหมดมาตั้งแต่ 2026-07-27 เพราะตอนนั้น
-- แยกไม่ออกว่าใครพูด · มีคอลัมน์นี้แล้วจะทิ้งเฉพาะความเห็นของ central ได้
--
-- idempotent · ค่าเดิมทั้งหมดถือเป็น 'central' เพราะยังไม่มีทางอื่นที่เขียนได้
-- ============================================================

ALTER TABLE ingester_camera_status
  ADD COLUMN IF NOT EXISTS reported_by TEXT NOT NULL DEFAULT 'central';

COMMENT ON COLUMN ingester_camera_status.reported_by IS
  'ใครเป็นคนรายงานแถวนี้ — central (poll เอง) หรือ edge (ไซต์รายงานขึ้นมา) · '
  'ความเห็นของ central ใช้ไม่ได้กับกล้องที่อยู่หลัง edge ดู migration 155';

-- ดัชนีสำหรับ query ที่จะกรองตามผู้รายงาน (routes/devices.js, routes/health.js)
CREATE INDEX IF NOT EXISTS ingester_camera_status_reported_by_idx
  ON ingester_camera_status (reported_by);
