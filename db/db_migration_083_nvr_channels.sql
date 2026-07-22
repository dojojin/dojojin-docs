-- ============================================================
-- Migration 083 — NVR multi-channel support (Phase 3)
-- ------------------------------------------------------------
-- Persist per-channel NVR config in the DB. Phase 1 (2026-07-15) kept these
-- fields in cameras-config.json only; Phase 3 adds the columns so the admin
-- UI can create/edit NVR channels and the /api/cameras merge returns them.
--   nvr_channel        — 0-based Dahua eventManager index (== the channel this
--                        logical camera maps to; NULL = single-channel device)
--   capture_categories — allow-list of event categories to ingest for this
--                        channel (e.g. {face,anpr}); NULL/empty = capture all
--   device_id          — groups the channels of one physical NVR so the ingester
--                        opens ONE shared stream per device (see LOGIC plan)
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS nvr_channel        INTEGER;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS capture_categories TEXT[];
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS device_id          VARCHAR(100);

-- index the grouping key — the ingester queries "all channels of device X"
CREATE INDEX IF NOT EXISTS idx_cameras_device ON cameras (device_id) WHERE device_id IS NOT NULL;
