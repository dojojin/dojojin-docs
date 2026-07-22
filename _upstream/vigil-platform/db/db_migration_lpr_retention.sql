-- Migration: LPR retention settings (RF4)
-- LPR data is high-volume + PII, so it gets its own retention, decoupled:
--   lpr_image_retention_days (7)  — prune snapshots/lpr/ JPGs sooner (PII + disk)
--   lpr_retention_days       (30) — prune metadata rows (anprAlarm + license_plates) later
-- image-days is capped <= metadata-days at runtime (src/lpr-retention.js) so an
-- image never outlives its row. Enforced by api-server's _runLprRetention (daily).
-- Idempotent: ON CONFLICT DO NOTHING (re-runnable; safe on fresh + legacy DBs).

INSERT INTO system_settings (key, value, description) VALUES
  ('lpr_image_retention_days', '7',  'Days of LPR snapshot images (snapshots/lpr/) to keep on disk — PII (default 7, max 730).'),
  ('lpr_retention_days',       '30', 'Days of LPR plate metadata (anprAlarm events + license_plates) to keep (default 30, max 730).')
ON CONFLICT (key) DO NOTHING;
