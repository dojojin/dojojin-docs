-- Migration 034: appearances_retention_days setting
-- Adds the missing system_settings row for appearance attribute data retention.
-- The validator in api-server.js (SETTINGS_VALIDATORS) and the UI widget both
-- existed but the seed row was never added, causing "setting row missing" on save.

INSERT INTO system_settings (key, value, description) VALUES
  ('appearances_retention_days', '30',
   'Days of appearance attribute data (gender/colour/clothing) to keep before anonymisation (max 730). Must be <= data_retention_days.')
ON CONFLICT (key) DO NOTHING;
