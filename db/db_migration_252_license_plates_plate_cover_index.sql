-- ============================================================
-- Vigil Platform — Migration 252: license_plates — covering index สำหรับนับป้ายไม่ซ้ำตามช่วงเวลา
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- บน central สร้างด้วยมือแบบ CONCURRENTLY แล้ว (2026-10-06 · 66 วิ · 5.1 GB) — migrate.js ครอบ
-- transaction จึงใช้ CONCURRENTLY ในไฟล์นี้ไม่ได้ (เหตุผลเดียวกับ 184/190/193/195/251)
-- ไฟล์นี้ IF NOT EXISTS ไว้ให้เครื่องติดตั้งใหม่ (edge ไม่รัน api-server จึงไม่รัน migration)
--
-- /api/lpr/stats ช่วง custom: ป้ายไม่ซ้ำ/ซ้ำ/สวมป้าย เป็น COUNT DISTINCT บวกข้ามช่วงไม่ได้
-- จึงต้องดึงป้ายทุกแถวของช่วง (ตารางชั่วคราว _lpr_pp) · idx_plates_detected_at ต้องอ่าน heap
-- 7 วัน = 5.96 ล้านแถว · 1.46 ล้าน block จากดิสก์ = 48.3 วิ
-- covering index → Index Only Scan 0.63 วิ · ทั้ง endpoint custom 7 วัน ชนเพดาน 120 วิ → 10.2 วิ
-- ไม่ทำตารางสรุประดับป้าย: แยกตามกล้องเหลือ 87% ของแถวดิบ (วัด 5 ต.ค. 755,543 / 869,639) ไม่คุ้ม
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_time_plate_cover
  ON license_plates (detected_at) INCLUDE (plate_number, region, vehicle_type, camera_id);
