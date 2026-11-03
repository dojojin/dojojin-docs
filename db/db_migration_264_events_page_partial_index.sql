-- ============================================================
-- Vigil Platform — Migration 264: partial index ของหน้าเหตุการณ์ (idx_events_page_time)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ 2026-10-16: perfWatch เตือน "ช้าลง 2.1 วิ (ปกติ 0.9)" — หน้าเหตุการณ์ของ Site Admin ภูเก็ตรอ 2–4.6 วิ
--   หน้านี้ตัดป้ายทะเบียน/ใบหน้าออก = 97.6% ของแถว (24 ชม.: 1,036,426 แถว แสดงจริง 24,728) · ตัวกรองแบบตัดออก
--   (<> ALL) ใช้ index ไม่ได้ จึงอ่านทั้งล้านแถวทุกครั้ง · hkt มีแต่ป้าย+ใบหน้า → อ่านล้านแถวเพื่อได้ 0
-- หลังสร้าง: Index Only Scan 24,556 แถว 47 ms (เดิม 414 ms อุ่น / 1.7 วิ เย็น) · API ของ hkt 0.04 วิ
-- predicate ต้องตรงตัวอักษรกับ helpers/eventsPageIndex.js (test/events-page-index.test.js ตรวจ)
-- central สร้างแบบ CONCURRENTLY ทีละ partition + ATTACH ด้วยมือแล้ว 2026-10-16 (รวม 199 MB) ·
-- ไฟล์นี้ให้เครื่องติดตั้งใหม่ได้ชุดเดียวกัน (migrate.js ห่อใน transaction จึงใช้ CONCURRENTLY ไม่ได้)
-- partition ใหม่ที่สร้างทีหลัง (PARTITION OF) ได้ index นี้อัตโนมัติจาก parent
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_page_time ON events (event_time DESC)
  INCLUDE (camera_id, event_type, event_state, has_snapshot)
  WHERE event_type NOT LIKE '%Aggregation%'
    AND event_type <> ALL ('{anprAlarm,FaceRecognition,FaceCapture,FaceDetector/Recognized,FaceDetector/Comparison}'::text[]);
