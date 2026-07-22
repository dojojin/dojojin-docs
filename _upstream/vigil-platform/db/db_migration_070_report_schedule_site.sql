-- Migration 070: add site_id to report_schedules
-- null = all sites (admin schedules global reports); set = site-scoped
ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS site_id INT REFERENCES sites(id);
