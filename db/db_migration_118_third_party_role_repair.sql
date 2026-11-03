-- ============================================================
-- Vigil Platform — migration 118: repair the third_party_readonly role
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Migration 027 created this role on 2026-05-27 and is recorded as applied,
-- but on 2026-08-07 the role did not exist on the production cluster and none
-- of the eleven v_*_public views carried a single grant for it. vigil_sql is a
-- superuser, 027 has no exception handler, and migrate.js rolls back and skips
-- recording on failure — so 027 did create it, and something dropped it later.
-- No audit trail survives to say what.
--
-- 027 cannot repair this: it is already in schema_migrations and will never
-- run again. Hence a new migration rather than an edit to the old one.
--
-- Roles are CLUSTER-wide while migrations are per-database, which is the whole
-- reason this could go missing without leaving a mark in this database. That
-- also means this file must stay safe to run against a cluster where the role
-- already exists and is already granted — it is written to converge, not to
-- assume.
--
-- Nothing here grants anything to a LOGIN user. The role is NOLOGIN on
-- purpose: ops creates one login user per partner and grants them this role,
-- so revoking a partner is dropping one user, not editing grants
-- (docs/REF_third-party-integration.md §3.2).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'third_party_readonly') THEN
    CREATE ROLE third_party_readonly NOLOGIN;
    RAISE NOTICE 'third_party_readonly: created (was missing)';
  ELSE
    RAISE NOTICE 'third_party_readonly: already present';
  END IF;
END $$;

COMMENT ON ROLE third_party_readonly IS
  'Read-only access to v_*_public views for 3rd-party integrations. '
  'Granted to login users by ops. See docs/REF_third-party-integration.md.';

GRANT USAGE ON SCHEMA public TO third_party_readonly;

-- Listed one per line and not looped: a view that is added to the catalogue
-- later has to be added here deliberately, because "everything matching
-- v_%_public" would silently hand a partner whatever a future migration
-- happens to name that way.
GRANT SELECT ON
  v_camera_groups_public,
  v_cameras_public,
  v_events_public,
  v_appearances_public,
  v_license_plates_public,
  v_alert_rules_public,
  v_alert_logs_public,
  v_event_categories_public,
  v_event_category_rules_public,
  v_system_settings_public,
  v_report_history_public
TO third_party_readonly;

-- Table-level SELECT is the ceiling, not the grant a partner actually gets.
-- Per-partner column scoping is applied to their login user on top of this
-- (Phase TP2), and a column grant cannot widen what the role already allows.
