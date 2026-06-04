-- Migration: snapshot retention setting
-- Adds snapshot_retention_days (default 30) so the api server can prune old
-- PNG/JPG files from /snapshots once a day.

INSERT INTO system_settings (key, value, description) VALUES
  ('snapshot_retention_days', '30', 'Days of snapshot images to keep on disk (max 365).')
ON CONFLICT (key) DO NOTHING;
