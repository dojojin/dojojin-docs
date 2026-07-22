-- ============================================================
-- Vigil Platform — migration 091: camera model-detect status (OPT5-EDGE-004)
-- Trigger-on-save model detect (replaces the one-time fill-model.js script —
-- Save in Camera Settings now fires a detect for that camera automatically,
-- edge-relayed for edge-site cameras). These 2 columns give the audit trail
-- the finding asked for: when detect last ran and why it failed, so a stale/
-- missing model is diagnosable instead of silent.
--
-- Additive + nullable → instant metadata-only migration, safe at api-server
-- boot. No backfill: existing cameras keep their current model/firmware/
-- serial_number values (from the 2026-07-17 one-time fill) untouched; these
-- columns just start populating from the next Save/detect onward.
-- ============================================================

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS model_detected_at TIMESTAMPTZ;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS model_detect_error TEXT;
