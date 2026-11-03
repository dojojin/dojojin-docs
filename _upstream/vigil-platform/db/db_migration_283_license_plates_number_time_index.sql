-- ============================================================
-- Vigil Platform — Migration 283: index (plate_number, detected_at) บน license_plates
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-10-28: รายงาน PDF ตารางหมวก (traffic-report-pdf.js) หาแถวของป้ายผู้เข้าชิงในช่วงวันที่เลือก
--   แต่ idx_plates_number มีแค่ plate_number ⇒ ต้องเดินประวัติทั้งหมดของป้ายก่อนกรองวัน (~31 ms/ป้าย ตอน cache เย็น)
--   หลังรวมเป็นรอบเดียว (570c9a9c) ยังเหลือ 12–14 วิ/วัน · index นี้ให้กรองวันในตัว index ได้
-- central สร้างแบบ CONCURRENTLY ด้วยมือแล้ว 2026-10-31 00:59 (2.8 GB · 174 วิ · ไม่ขนาน) · ไฟล์นี้ให้เครื่องติดตั้งใหม่ได้ชุดเดียวกัน
-- (migrate.js ห่อแต่ละไฟล์ใน transaction จึงใช้ CONCURRENTLY ที่นี่ไม่ได้ — เหมือน migration 258)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_number_time ON license_plates (plate_number, detected_at);
