-- ============================================================
-- Migration 164 — per-camera ONVIF metadata crop (Bosch only)
-- ============================================================
-- Replaces the META_CROP_CAMERAS env allow-list that shipped with
-- the feature (commit b727265). That gate lived in each edge's
-- gitignored src/.env, so enabling a second camera meant an SSH
-- session per box and the setting was invisible from the dashboard
-- — the same flag-drift class the security checklist calls out.
--
-- When on, the edge subscribes to that camera's ONVIF metadata
-- track over RTSP (the metadata track only; the video track is
-- never SETUP) and crops each event snapshot to the object that
-- triggered it, matched by ObjectId. Costs ~2.5 KB/s and ~0.2% of
-- one core per enabled camera.
--
-- Default FALSE on purpose: this reaches every site on the next
-- config push, and nothing should start tracking without someone
-- deciding it should. Bosch-only — the edge also checks vendor, so
-- flipping this on a Hikvision/Dahua row does nothing.
--
-- No CHECK constraint: a boolean already constrains itself.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS meta_crop BOOLEAN DEFAULT FALSE;

UPDATE cameras SET meta_crop = FALSE WHERE meta_crop IS NULL;

-- Carry over the one camera the feature was trialled on, so the
-- migration doesn't silently turn it off when the edge switches
-- from the env allow-list to this column.
UPDATE cameras SET meta_crop = TRUE WHERE id = 'BH5100i_RMUTR-V_01';
