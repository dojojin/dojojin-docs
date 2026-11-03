-- ============================================================
-- Vigil Platform — Migration 257: ลบ idx_face_embeddings_event_id (ซ้ำซ้อนโดยโครงสร้าง)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- unique (event_id, model_name) ขึ้นต้นด้วย event_id อยู่แล้ว · index เดี่ยวนี้ idx_scan = 0 และไม่มี
-- คิวรีในโค้ดที่ค้นด้วย event_id อย่างเดียว (ON CONFLICT ใช้ unique) · 114 MB
-- ลบบน central แบบ CONCURRENTLY แล้ว 2026-10-06 · ไฟล์นี้ให้เครื่องติดตั้งใหม่ได้ชุดเดียวกัน
-- ============================================================

DROP INDEX IF EXISTS idx_face_embeddings_event_id;
