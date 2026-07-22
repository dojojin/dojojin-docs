-- ============================================================
-- Vigil Platform — Migration 053: Multi-Site — site_id FK
-- Adds site_id foreign key to cameras and camera_groups.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id) ON DELETE SET NULL;

ALTER TABLE camera_groups
  ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cameras_site      ON cameras(site_id);
CREATE INDEX IF NOT EXISTS idx_cam_groups_site   ON camera_groups(site_id);
