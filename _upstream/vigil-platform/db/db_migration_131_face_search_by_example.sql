-- ============================================================
-- Vigil Platform — Phase 5 (Face search-by-example on AuraFace-v1)
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- Wires /api/hcp/face-search's "our own engine" path off the retired
-- buffalo_l pilot index (deleted Phase 3, 2026-08-10) onto face_embeddings.
--
-- camera_id is denormalized onto face_embed_queue/face_embeddings at write
-- time (mirrors how the old buffalo_l .npz shards stored cams[] alongside
-- vecs[]) so a camera-filtered search never has to join back to `events` —
-- hcp.js:139-144 already documents why joining events for this kind of
-- query timed out in production (49s unbounded, 2min+ even at 7 days,
-- 13M rows / 25 partitions). Driving entirely off face_embeddings (small,
-- purpose-built, indexed here) avoids that failure mode by construction.
--
-- vec_dot() is a plain SQL aggregate-free dot product — valid as cosine
-- similarity only because AuraFace-v1's normed_embedding is already unit
-- length (same reasoning as face-embed-worker.js's JS dot()).
-- ============================================================

ALTER TABLE face_embed_queue  ADD COLUMN IF NOT EXISTS camera_id VARCHAR(100);
ALTER TABLE face_embeddings   ADD COLUMN IF NOT EXISTS camera_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_face_embeddings_event_time ON face_embeddings (event_time);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_camera_id  ON face_embeddings (camera_id);

CREATE OR REPLACE FUNCTION vec_dot(a real[], b real[]) RETURNS real AS $$
  SELECT sum(a[i] * b[i]) FROM generate_subscripts(a, 1) AS i
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
