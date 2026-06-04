-- ============================================================
-- Migration 024: Camera-targeted audit log
-- Adds a camera target column so camera lifecycle/config changes can be
-- filtered and exported without parsing details JSON.
-- ============================================================

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS target_camera_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_target_camera
  ON audit_log(target_camera_id);
