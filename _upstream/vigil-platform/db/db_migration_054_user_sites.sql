-- ============================================================
-- Vigil Platform — Migration 054: Multi-Site — user_sites
-- Join table: one user can access multiple sites.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_sites (
  user_id INT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  site_id INT NOT NULL REFERENCES sites(id)  ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);
