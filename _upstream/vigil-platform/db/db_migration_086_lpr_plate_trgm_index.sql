-- ============================================================
-- Vigil Platform — migration 086: trigram index for LPR plate search
-- GET /api/lpr's `q` filter does `plate_number ILIKE '%text%'` (wildcard
-- prefix), which the existing btree (idx_plates_number) can't use — a wide
-- date range + rare/no-match plate forces a Parallel Seq Scan of the whole
-- license_plates table (measured: 106ms / 18k buffer reads at ~427k rows).
-- A trigram GIN index lets Postgres use an index scan for '%text%' patterns
-- (>=3 chars). Prod already had this index applied out-of-band via
-- CREATE INDEX CONCURRENTLY (see below) to avoid locking the live table —
-- this migration is a no-op there (IF NOT EXISTS) and only does real work on
-- fresh/other installs, where a brief ACCESS EXCLUSIVE lock on an empty/small
-- table is harmless.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_plates_number_trgm
  ON license_plates USING gin (plate_number gin_trgm_ops);
