-- ============================================================
-- Vigil Platform — Migration 060: lpr_alert_acks (RF-ALERT)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- ============================================================
-- Operator acknowledgement of an LPR watch-list (lpr_watchlist) hit — an
-- anprAlarm event whose plate matches an active watch-list entry.
-- One ack per event — re-ack is last-writer-wins (acked_by/acked_at = LAST ack).
-- Mirrors face_event_acks (FP5) exactly so the two ack surfaces stay symmetric.
-- ON DELETE CASCADE: an ack never outlives its event (lpr_retention prune).
-- Idempotent.
CREATE TABLE IF NOT EXISTS lpr_alert_acks (
  event_id    BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  acked_by    TEXT,
  acked_by_id INTEGER,
  acked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
