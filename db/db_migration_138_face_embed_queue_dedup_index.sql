-- ============================================================
-- Vigil Platform — face_embed_queue camera+time index for enqueue-time dedup
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- 41.9% of FaceCapture events fire within 3s of the previous one on the same
-- camera (same person still in frame) — real, near-duplicate embedding work
-- that never meaningfully changes the blacklist-match result. mqtt-
-- subscriber.js now skips enqueueing a row if the same camera already has
-- one within a 3s window (see the INSERT change there) — needs this index
-- so that check stays a fast lookup instead of a scan, since it runs on
-- every single face capture in the hot MQTT ingest path.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_face_embed_queue_camera_time ON face_embed_queue (camera_id, event_time);
