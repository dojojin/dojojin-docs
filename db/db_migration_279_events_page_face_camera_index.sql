-- ============================================================
-- Vigil Platform — Migration 279: partial index ตามกล้อง ของหน้าเหตุการณ์ และของใบหน้า
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ (ตรวจคิวรีทุกหน้า 2026-10-25 · GOTCHAS #236): เลือกไซต์ + ช่วงยาว แล้วไซต์นั้นไม่มีข้อมูลประเภทนั้นเลย
--   หน้าเหตุการณ์ ภูเก็ต เดือนนี้ 43.7 วิ (อ่าน 3.8 GB เพื่อคืน 0 แถว) · นราธิวาส 23 วิ
--   ใบหน้า นราธิวาส / RMUTR-V เดือนนี้ ชนเพดาน 120 วิ · ค้นใบหน้า VSS 15–38 วิ
-- route ไล่ทีละกล้องแล้ว (helpers/perCameraScan.js) — แต่ index (camera_id, event_time) ตัวเดิมเก็บทุกประเภท
--   ภูเก็ตจึงยังต้องเดินผ่านป้าย/ใบหน้า 3.5 ล้านแถวต่อเดือนที่หน้าเหตุการณ์ตัดทิ้ง · index ชุดนี้เก็บเฉพาะแถวที่หน้านั้นใช้
--   ไซต์ที่ไม่มีของ = 0 รายการ
-- idx_events_page_cam_time: เงื่อนไขเดียวกับ idx_events_page_time (264) ตรงตัวอักษร (helpers/eventsPageIndex.js)
-- idx_events_face_cam_time: 4 ประเภทของใบหน้าตรงกับ CAPTURE_TYPES_SQL + RECOG_TYPES_SQL ใน routes/faces.js
-- central สร้างแบบ CONCURRENTLY ทีละ partition + ATTACH ด้วยมือ · ไฟล์นี้ให้เครื่องติดตั้งใหม่ได้ชุดเดียวกัน
-- (migrate.js ห่อใน transaction จึงใช้ CONCURRENTLY ไม่ได้) · partition ใหม่ได้ index จาก parent อัตโนมัติ
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_page_cam_time ON events (camera_id, event_time DESC)
  WHERE event_type NOT LIKE '%Aggregation%'
    AND event_type <> ALL ('{anprAlarm,FaceRecognition,FaceCapture,FaceDetector/Recognized,FaceDetector/Comparison}'::text[]);

CREATE INDEX IF NOT EXISTS idx_events_face_cam_time ON events (camera_id, event_time DESC)
  WHERE event_type IN ('FaceCapture','FaceDetector/Recognized','FaceRecognition','FaceDetector/Comparison');
