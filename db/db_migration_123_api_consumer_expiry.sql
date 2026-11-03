-- ============================================================
-- Vigil Platform — migration 123: expiry date on partner credentials
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- docs/REF_third-party-integration.md §8 has said "document who, when, why,
-- expiry date" since it was written, and there has never been a place to put
-- the expiry. So access granted to a partner lasted until somebody remembered
-- to revoke it, which is the same as forever.
--
-- Enforced at the auth boundary rather than by a nightly job: a job that
-- deactivates expired rows leaves a window between the deadline and the next
-- run, and stops working entirely if the job does. Comparing a timestamp on
-- each request has no window and nothing to keep running.
--
-- NULL means no expiry, which is what every existing row gets — this is not
-- the migration's job to decide, and silently expiring credentials that were
-- issued without a term would be worse than the problem.
-- ============================================================

ALTER TABLE api_consumers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN api_consumers.expires_at IS
  'Credentials stop working at this moment. NULL = no expiry. Checked per '
  'request, not by a scheduled job.';

-- Partial index: the console asks "what expires soon" over the handful of
-- rows that have a term at all, and skips the ones that never expire.
CREATE INDEX IF NOT EXISTS idx_api_consumers_expiry
  ON api_consumers (expires_at) WHERE expires_at IS NOT NULL;
