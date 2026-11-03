-- ============================================================
-- Vigil Platform — AuraFace-v1 blacklist hit log (Internal Test & Development)
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- face-embed-worker.js already fires pg_notify('alert_event', ...) on a
-- blacklist match, but that's fire-and-forget for LINE only — nothing
-- durable records the hit. The existing Face Recognition feed
-- (/api/face-matches in faces.js) can't show these either: it hard-filters
-- event_type IN ('FaceRecognition','FaceDetector/Comparison'), but every
-- AuraFace-v1 source event is event_type='FaceCapture' (a plain detection,
-- not a camera-native recognition event) — reproduced against the 5 real
-- matches fired 2026-08-10, all FaceCapture. Widening that shared filter
-- would touch ~8 query sites used by production HCP-native matching, for a
-- pipeline explicitly labeled Internal Test Only — decided against (owner,
-- 2026-08-10): keep this on its own table/page instead of mixing in.
--
-- event_id+event_time composite FK, not event_id alone — events is
-- range-partitioned by event_time with a composite PK; an FK on id alone
-- silently does not enforce (see face_embeddings, migration 129, for the
-- working pattern this copies).
-- ============================================================

CREATE TABLE IF NOT EXISTS face_blacklist_hits (
  id                BIGSERIAL PRIMARY KEY,
  event_id          BIGINT NOT NULL,
  event_time        TIMESTAMPTZ NOT NULL,
  camera_id         VARCHAR(100),
  camera_name       TEXT,
  blacklist_id      BIGINT REFERENCES face_blacklist(id) ON DELETE SET NULL,
  label             TEXT NOT NULL,
  similarity        REAL NOT NULL,
  snapshot_filename TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, event_time) REFERENCES events(id, event_time) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_face_blacklist_hits_time ON face_blacklist_hits (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_face_blacklist_hits_blacklist ON face_blacklist_hits (blacklist_id);
