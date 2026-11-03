-- ============================================================
-- Vigil Platform — migration 120: narrow v_cameras_public, add partner scoping
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Two problems found while building TP2a, both in things written earlier this
-- week and neither caught by any test, because both are about what a view
-- CONTAINS rather than whether it works.
--
-- 1. v_cameras_public hands out the internal network. Migration 027 excluded
--    http_user / http_password / rtsp_url and stopped there — credentials were
--    the threat model. But it still returns ip_address (real values today:
--    10.11.100.17, 10.4.100.76), mqtt_topic_prefix, serial_number and firmware.
--    A partner reading that gets a map of the camera VLANs and the topic
--    namespace, which is reconnaissance, not integration data. Also present
--    are our own operational toggles (enable_snapshot, clip_pre_sec, …) which
--    describe how WE run the fleet and mean nothing to anyone else.
--
-- 2. api_consumers.site_codes cannot be enforced. It was added in migration
--    119 to scope a partner to specific sites, but site_id exists only on
--    cameras and appears in no public view at all — so there was nothing to
--    filter against. A column that looks like an access control and enforces
--    nothing is worse than no column, because it reads as protection.
--
-- This is free to do right now and will not be later: there are zero active
-- consumers. Once a partner is reading a column, removing it is a breaking
-- change to someone else's software.
--
-- Note the ordering constraint below — a view's columns cannot be dropped by
-- CREATE OR REPLACE, so it has to be dropped and rebuilt, and DROP VIEW takes
-- the grants with it. Verified first that nothing else depends on it: no other
-- view references it and no file in src/ queries it.
-- ============================================================

-- ------------------------------------------------------------
-- 1. v_cameras_public — what a partner needs to make sense of a camera_id,
--    and nothing about how we reach it.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_cameras_public;

CREATE VIEW v_cameras_public AS
SELECT
  id,
  name,
  description,
  -- Added: the only way a partner can be scoped to a subset of the fleet, and
  -- the only way they can tell which site a camera belongs to.
  site_id,
  -- Kept: where it is and what it sees. This is the integration surface.
  latitude,
  longitude,
  location_label,
  group_id,
  model,
  enabled,
  last_seen_at,
  last_event_at,
  created_at,
  updated_at
FROM cameras;

-- Dropped, and why, so nobody restores them by reflex:
--   ip_address, http_port  — internal addressing; a partner cannot reach these
--                            and does not need to know they exist
--   mqtt_topic_prefix      — our broker namespace
--   serial_number, firmware— device inventory; useful to us, not to them
--   enable_snapshot, enable_vca_overlay, enable_clip_capture,
--   clip_pre_sec, clip_post_sec
--                          — how we operate the fleet, not what it observed

COMMENT ON VIEW v_cameras_public IS
  'Camera reference for 3rd parties. Location and identity only — no addressing, '
  'no credentials, no operational config. Narrowed in migration 120.';

-- DROP VIEW discarded the grant from migration 118, so it has to be restored
-- here or every partner silently loses access to cameras.
GRANT SELECT ON v_cameras_public TO third_party_readonly;

-- ------------------------------------------------------------
-- 2. How far back a partner may look.
--
-- Per-consumer rather than one global constant, because the honest answer
-- differs by partner and by data: we hold event rows for a year but LPR images
-- only six days, so "how far back" is a contract term, not a system property.
-- NULL means the system retention applies, whatever it is at the time.
-- ------------------------------------------------------------
ALTER TABLE api_consumers ADD COLUMN IF NOT EXISTS max_lookback_days INT;

COMMENT ON COLUMN api_consumers.max_lookback_days IS
  'Oldest data this partner may request, in days. NULL = system retention. '
  'Note images expire far sooner than rows (LPR ~6 days).';

-- Row scoping is applied by the API, in the query, using this column and
-- site_codes. It is NOT a Postgres-enforced boundary the way column access is —
-- stated plainly here so nobody reads site_codes as something it is not. Making
-- it enforced would mean row-level security policies keyed to the partner role,
-- which is a larger change and is not pretended at here.
