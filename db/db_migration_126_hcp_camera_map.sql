-- ============================================================
-- Migration 126: HCP Camera IndexCode Map
-- ============================================================
-- Maps Hikvision HikCentral Professional (HCP) cameraIndexCode
-- to our internal camera_id. Used by HC1 (face match ingestion).
--
-- HCP identifies cameras by integer cameraIndexCode;
-- we identify by camera_id (e.g. "C44-SKU-...").
-- This table is the source of truth for the mapping.
--
-- site_id included for future multi-site support
-- (HC is HKT-only per scope, but table schema supports others).

CREATE TABLE IF NOT EXISTS hcp_camera_map (
  id          BIGSERIAL PRIMARY KEY,
  site_id     VARCHAR(50) DEFAULT 'hkt' NOT NULL,
  hcp_index   INT NOT NULL,              -- cameraIndexCode from HCP
  camera_id   VARCHAR(100) NOT NULL,     -- our camera.id (e.g. "C44-SKU-...")
  hcp_name    VARCHAR(255),              -- HCP camera name (for debug/audit)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(site_id, hcp_index)  -- one mapping per (site, HCP index)
);

CREATE INDEX IF NOT EXISTS idx_hcp_camera_map_site_id
  ON hcp_camera_map(site_id);
CREATE INDEX IF NOT EXISTS idx_hcp_camera_map_camera_id
  ON hcp_camera_map(camera_id);
