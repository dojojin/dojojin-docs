-- ============================================================
-- Vigil Platform — Migration 057: face_event_notes (FACE-UI FP4)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- ============================================================
-- Operator free-text note on a FaceRecognition event (the camera/FDLib feed
-- carries no note field). One editable note per event — last-writer-wins, so
-- `author` is the LAST editor (not original creator); `updated_at` is last save.
-- ON DELETE CASCADE: a note never outlives its event (data_retention prune).
-- Idempotent.
CREATE TABLE IF NOT EXISTS face_event_notes (
  event_id   BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  author     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
