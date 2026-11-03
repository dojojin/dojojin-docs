-- ============================================================
-- Vigil Platform — migration 122: retention for the partner API request log
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- api_request_log (migration 119) writes one row per /v1 request and had no
-- way to ever shrink. Every other growing table here is bounded by a
-- system_settings key and a nightly pass, so this follows that rather than
-- inventing a second mechanism.
--
-- Sizing: a partner polling once a minute writes ~1,440 rows a day, so ten
-- partners at that rate reach ~1.3 M rows over 90 days. The ceiling is the
-- rate limit — 60/min sustained is ~86,000 rows a day per partner, which is
-- what a runaway client looks like, and is precisely the case worth being able
-- to see in the log rather than having silently rotate away.
--
-- 90 days to match metrics_retention_days: both are operational telemetry
-- about how the system was used, not records of what the cameras saw.
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('api_log_retention_days', '90',
   'Days of partner API request log (api_request_log) to keep. Includes rejected requests — the audit trail of who tried what. Clamped 7..365.')
ON CONFLICT (key) DO NOTHING;

-- The nightly pass deletes by `at`, oldest first, in batches. idx_api_request_log_at
-- from migration 119 already orders by `at DESC`; a btree serves either
-- direction, so no new index is needed.
