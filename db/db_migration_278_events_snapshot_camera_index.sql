-- ============================================================
-- Vigil Platform — Migration 278: partial index ของหน้า Snapshots ตามกล้อง (idx_events_snap_cam_time)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-10-24: หน้า Snapshots เลือกไซต์ภูเก็ต + "This month" ค้าง "Loading…" 49 วิ (cache เย็น) / 8–14 วิ (อุ่น)
--   ผลลัพธ์จริง = 0 แถว (ภูเก็ตมี snapshot 12.5 ล้านแถวในเดือนนี้ แต่เป็นป้าย/ใบหน้าทั้งหมด ซึ่งหน้านี้ตัดออก)
--   planner เดิน idx_events_page_time (264) ทั้งเดือน แล้วเปิดแถวจริงทีละแถวเพื่อเช็ค camera_id/has_snapshot
--   (เป็นแค่ INCLUDE · PG 16 กรองก่อนเปิดแถวไม่ได้) → อ่านดิสก์ 368,063 block ≈ 2.9 GB เพื่อหาของที่ไม่มี
--   หน้า Events ไม่เจอเพราะนับได้แบบ Index Only · หน้า Snapshots ใช้ e.* ทั้งแถว
-- index นี้ใส่ camera_id เป็น key + เงื่อนไขเดียวกับ 264 + has_snapshot → ไซต์ที่ไม่มีของ = 0 รายการใน index
-- predicate ต้องตรงตัวอักษรกับ helpers/eventsPageIndex.js (test/events-page-index.test.js ตรวจ)
-- central สร้างแบบ CONCURRENTLY ทีละ partition + ATTACH ด้วยมือแล้ว 2026-10-24 ·
-- ไฟล์นี้ให้เครื่องติดตั้งใหม่ได้ชุดเดียวกัน (migrate.js ห่อใน transaction จึงใช้ CONCURRENTLY ไม่ได้)
-- partition ใหม่ที่สร้างทีหลัง (PARTITION OF) ได้ index นี้อัตโนมัติจาก parent
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_snap_cam_time ON events (camera_id, event_time DESC)
  WHERE has_snapshot = true
    AND event_type NOT LIKE '%Aggregation%'
    AND event_type <> ALL ('{anprAlarm,FaceRecognition,FaceCapture,FaceDetector/Recognized,FaceDetector/Comparison}'::text[]);
