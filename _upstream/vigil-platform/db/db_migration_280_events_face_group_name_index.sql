-- ============================================================
-- Vigil Platform — Migration 280: index ชื่อกลุ่มใบหน้า (fdLibName) ของ event การจดจำ
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- เหตุ (ตรวจคิวรีทุกหน้า 2026-10-25 ข้อ 5): รายชื่อกลุ่มใบหน้าสำหรับ dropdown / รายงาน = SELECT DISTINCT ชื่อกลุ่มจาก
--   raw_json ของ event การจดจำ 90 วัน — 352,243 แถวเพื่อได้ 18 ชื่อ · ต้องเปิด raw_json ทุกแถว 26–49 วิ ตอน cache เย็น
--   (รายงาน LPR เดือน 84.5 วิ เพราะรอตัวนี้ · อุ่นตอนบูต 40 วิ)
-- index เก็บค่านิพจน์ชื่อกลุ่ม → อ่านจาก index ได้เลย ไม่ต้องเปิดแถวจริง · ตัวกรอง "กลุ่ม" ของรายงานใบหน้าใช้ได้ด้วย
-- นิพจน์ต้องตรงตัวอักษรกับ _fdLibName() ใน routes/faces.js และประเภทตรงกับ RECOG_TYPES_SQL (test/events-page-index.test.js)
-- central สร้างแบบ CONCURRENTLY ทีละ partition + ATTACH ด้วยมือ · ไฟล์นี้ให้เครื่องติดตั้งใหม่ได้ชุดเดียวกัน
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_face_group_name ON events ((COALESCE(raw_json->>'fdLibName', raw_json->>'hcp_group_name')), event_time)
  WHERE event_type IN ('FaceRecognition','FaceDetector/Comparison');
