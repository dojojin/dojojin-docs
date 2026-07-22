-- ============================================================
-- Vigil Platform — Migration 058: face_event_acks (FACE-UI FP5)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- ============================================================
-- Operator acknowledgement of a watch-list (blackList) FaceRecognition match.
-- One ack per event — re-ack is last-writer-wins (acked_by/acked_at = LAST ack).
-- Mirrors the RF-ALERT lpr_alert_acks convention (acked_by/_id/_at).
-- ON DELETE CASCADE: an ack never outlives its event (data_retention prune).
-- Idempotent.
CREATE TABLE IF NOT EXISTS face_event_acks (
  event_id    BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  acked_by    TEXT,
  acked_by_id INTEGER,
  acked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
