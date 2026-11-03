-- ============================================================
-- Vigil Platform — face_embed_queue dedup via a real unique constraint
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- Supersedes migration 138's plain (camera_id, event_time) index. That index
-- backed a "WHERE NOT EXISTS (... within 3s ...)" check-then-insert in
-- mqtt-subscriber.js — reproduced it racing under real concurrent MQTT
-- delivery: multiple captures for the same camera at the same event_time
-- (multiple faces in one frame) each ran their own NOT EXISTS check before
-- any of the others had committed, so all of them passed and got enqueued
-- anyway. Measured: 93/242 rows created in a 3-minute window still fell
-- within 3s of another new row on the same camera — the guard barely
-- suppressed anything in practice.
--
-- Fixed-width 3-second buckets (floor(epoch_ms/3000)) + a real UNIQUE
-- constraint make this atomic — the database rejects the second insert
-- outright, no window for two concurrent checks to both see "not exists".
-- Trade-off: fixed buckets aren't a rolling window, so two captures 0.2s
-- apart can straddle a bucket boundary and both get through, while two 2.8s
-- apart landing in the same bucket collide — less precise than the sliding
-- check, but correct under concurrency, which the sliding version wasn't.
-- ============================================================

ALTER TABLE face_embed_queue ADD COLUMN IF NOT EXISTS time_bucket BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_face_embed_queue_camera_bucket ON face_embed_queue (camera_id, time_bucket) WHERE time_bucket IS NOT NULL;
DROP INDEX IF EXISTS idx_face_embed_queue_camera_time;
