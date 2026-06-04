-- ============================================================
-- Migration: schema_migrations tracking table
-- Source of truth for "which db_migration_*.sql files have been
-- applied to this database". Owned by src/migrate.js.
--
-- Numeric prefix '000' guarantees this runs FIRST in alphabetical
-- order — every other migration is recorded against this table.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename     TEXT PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms  INT,
  checksum     TEXT
);
