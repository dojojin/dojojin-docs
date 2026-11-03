-- ============================================================
-- Vigil Platform — migration 180: โหมดเลือกกล้องต่อผู้ใช้
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- user_cameras (migration 143) คุมว่า "เห็นกล้องตัวไหนได้บ้าง"
-- คอลัมน์นี้คุมคนละแกน: "ดูพร้อมกันได้กี่ตัว"
--   multi  = เลือกได้หลายตัวพร้อมกัน (ค่าเดิมของทุกคน — พฤติกรรมปัจจุบัน)
--   single = เลือกได้ทีละตัวเท่านั้น
--
-- เจ้าของสั่ง 2026-08-27: ผู้ใช้บางรายควรดูทีละกล้อง แม้จะมีสิทธิ์หลายกล้องก็ตาม
--
-- 🔴 DEFAULT ต้องเป็น 'multi' — ผู้ใช้ทุกคนที่มีอยู่ก่อนคอลัมน์นี้ต้องไม่เปลี่ยน
--    พฤติกรรม การตั้ง default เป็น single จะไปจำกัดคนที่ไม่มีใครสั่งให้จำกัด
--
-- ⚠️ นี่เป็น "สิทธิ์" ไม่ใช่ "ค่าตั้งการแสดงผล" — ฝั่ง server ต้องบังคับด้วย
--    (routes/traffic.js parseCams) ไม่ใช่แค่สลับ checkbox เป็น radio ที่หน้าจอ
--    ระบบนี้มีหนี้แบบนั้นอยู่แล้วในเรื่อง per-user view (กันได้แค่หน้าจอ 20/29 แท็บ)
--    เพิ่มอีกอันจะยิ่งแยกไม่ออกว่าอันไหนกันจริง
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS camera_select_mode TEXT NOT NULL DEFAULT 'multi';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_camera_select_mode_chk') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_camera_select_mode_chk
      CHECK (camera_select_mode IN ('single', 'multi'));
  END IF;
END $$;

COMMENT ON COLUMN users.camera_select_mode IS
  'เลือกกล้องพร้อมกันได้กี่ตัว: single = ทีละตัว · multi = หลายตัว (ค่าเริ่มต้น) — คนละแกนกับ user_cameras ที่คุมว่าเห็นตัวไหนได้';
