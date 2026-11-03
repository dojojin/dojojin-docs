-- ============================================================
-- Migration 102 — camera httpHost config backups
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- Backing store for "capture the camera's push target before repointing it".
-- Repointing an ANPR camera's httpHost moves a live government feed (the HKT
-- cameras had 700k+ successful uploads to CIB before we touched anything), so
-- the exact bytes that were on the device must survive the change.
--
-- APPEND-ONLY BY DESIGN — one row per capture, never an UPSERT keyed on
-- camera_id. If Backup overwrote a single row per camera, clicking it a second
-- time AFTER cutover would save the Vigil-pointing config over the original
-- CIB-pointing one, and Restore would silently become a no-op forever. The
-- oldest row for a camera is the one that matters; the API refuses to capture
-- again unless the caller explicitly asks for it.
--
-- raw_xml holds the PLURAL document (GET /ISAPI/Event/notification/httpHosts —
-- every slot), not a single slot: UVSS cameras carry two httpHosts, and a
-- backup that captured only slot 1 would restore an incomplete device.
CREATE TABLE IF NOT EXISTS camera_httphost_backups (
  id          BIGSERIAL PRIMARY KEY,
  camera_id   VARCHAR(120) NOT NULL,
  raw_xml     TEXT         NOT NULL,
  note        VARCHAR(200),
  captured_by VARCHAR(100),
  captured_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Reads are always "the backups for this camera, oldest first" (Restore wants
-- the original; the UI lists them newest-first for display).
CREATE INDEX IF NOT EXISTS idx_httphost_backups_cam
  ON camera_httphost_backups (camera_id, captured_at);
