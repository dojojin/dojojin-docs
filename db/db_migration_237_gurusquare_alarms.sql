-- ============================================================
-- Vigil Platform — Migration 237: GuruSquare (HKT) blacklist ALARM feed
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- GuruSquare has a SEPARATE `/alert` endpoint (real-time hit on a blacklisted
-- plate, ~2/day at HKT) distinct from `/blacklist` (the whole roster, which
-- `blacklist.source_records`/`blacklist.gs_alarms` already covers via the
-- normal import path). This table is the alarm feed only — one row per
-- GuruSquare alert, plus whichever of our own camera reads (or GuruSquare's
-- own `/lprresult`) we could match to it for a real capture photo.
--
-- No FK to `events` — events is partitioned and huge; a cross-partition FK
-- would be an unbounded-cost constraint for a table this small. `matched_event_id`
-- is a plain reference the UI joins on demand instead.
--
-- Additive only, no backfill/UPDATE of existing rows — safe on a live DB.
-- ============================================================

ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS alarm_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS alarm_last_id      BIGINT,
  ADD COLUMN IF NOT EXISTS alarm_last_poll_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alarm_last_note    TEXT;

CREATE TABLE IF NOT EXISTS blacklist.gs_alarms (
  id                 BIGSERIAL PRIMARY KEY,
  source_id          BIGINT NOT NULL REFERENCES blacklist.sources(id) ON DELETE CASCADE,
  ext_id             BIGINT NOT NULL,             -- GuruSquare's own /alert `id`
  alarm_time         TIMESTAMPTZ NOT NULL,        -- rec.timestamp, parsed as Asia/Bangkok
  plate              TEXT NOT NULL,
  province           TEXT,
  cartype            TEXT,
  carcolor           TEXT,
  carbrand           TEXT,
  platetype          TEXT,
  owner              TEXT,
  detail             TEXT,                        -- owner_address_and_detail
  ref_photo_path     TEXT,                         -- the blacklist REFERENCE photo from /alert
  matched_event_id   BIGINT,                       -- our own events.id, when capture_source='ours'
  matched_event_time TIMESTAMPTZ,
  camera_name        TEXT,
  camera_ip          TEXT,
  capture_source      TEXT CHECK (capture_source IN ('ours', 'lprresult')),
  capture_photo_path  TEXT,                        -- an actual camera capture (either source)
  line_status         TEXT,
  line_sent_at        TIMESTAMPTZ,
  raw_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, ext_id)
);

CREATE INDEX IF NOT EXISTS idx_gs_alarms_time  ON blacklist.gs_alarms (alarm_time DESC);
CREATE INDEX IF NOT EXISTS idx_gs_alarms_plate ON blacklist.gs_alarms (plate);
