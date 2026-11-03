-- ============================================================
-- Vigil Platform — Migration 258: index ขึ้นต้นด้วยจังหวัดบน license_plates (นับ/ค้นป้ายตามจังหวัด)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-10-07: หน้า LPR › ค้นหา ไม่ระบุช่วงวันที่ = นับทั้งช่วงที่เก็บ (สูงสุด 100 วัน) · ไม่มี index
--   ที่ขึ้นต้นด้วย region ⇒ กรองจังหวัด 7.4 วิ · จังหวัด+กล้อง ชนเพดาน 12 วิ (จอโชว์ค่าประมาณ) ·
--   ขอบเขตไซต์+จังหวัด+กล้อง 73.5 วิ (nested loop ×86 อ่าน region จาก heap ทีละแถว)
-- หลังสร้าง (EXPLAIN จริง): 0.32 วิ / 0.12 วิ / 0.115 วิ · INCLUDE camera_id ให้กรองกล้องได้ใน index
-- central สร้างแบบ CONCURRENTLY ด้วยมือแล้ว 2026-10-07 (3.9 GB · 78 วิ) · ไฟล์นี้ให้เครื่องติดตั้งใหม่
-- ได้ชุดเดียวกัน (migrate.js ห่อแต่ละไฟล์ใน transaction จึงใช้ CONCURRENTLY ที่นี่ไม่ได้)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_region_time ON license_plates (region, detected_at) INCLUDE (camera_id);
