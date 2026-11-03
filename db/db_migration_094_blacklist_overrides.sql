-- ============================================================
-- Vigil Platform — migration 094: local corrections + push gate
-- Spec: docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md
--
-- WHY THIS EXISTS
-- The roster comes from third-party systems we have no authority to edit
-- (DSS Pro / GuruSquare are owned by the police units, not by us). So bad data
-- has to be corrected on OUR side — but `blacklist.source_records` is a faithful
-- mirror that every import upserts over, so editing it in place would be undone
-- on the next run.
--
-- blacklist.overrides is a separate layer keyed the same way the import is
-- (source_id, external_id), so a correction survives any number of re-imports.
-- NULL in a column means "no override — use whatever the source said".
--
-- `excluded` doubles as the tombstone: the raw row keeps being refreshed (we
-- never lose the evidence of what the source actually sent) but it stays out of
-- blacklist.master, so deleted junk cannot resurrect itself on re-import. That
-- is one mechanism instead of two, and it is reversible — a hard DELETE is not.
-- ============================================================

CREATE TABLE IF NOT EXISTS blacklist.overrides (
  source_id     BIGINT NOT NULL REFERENCES blacklist.sources(id) ON DELETE CASCADE,
  external_id   TEXT   NOT NULL,
  -- NULL = defer to the source. Non-NULL = our corrected value wins.
  name          TEXT,
  plate_numbers TEXT[],
  case_note     TEXT,
  -- TRUE = keep the raw record, keep it OUT of master, never resurrect.
  excluded      BOOLEAN NOT NULL DEFAULT FALSE,
  exclude_reason TEXT,
  note          TEXT,                       -- free-text why the correction was made
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_bl_overrides_excluded
  ON blacklist.overrides(source_id) WHERE excluded;

-- ---------- LPR match key ----------
-- For a vehicle the plate IS the identity, the way a national ID is for a
-- person. Normalised (strip spaces/punctuation, upper-case) so "1กฉ 8966" and
-- "1กฉ8966" — both present in the live GuruSquare roster — resolve to one
-- vehicle instead of two masters.
ALTER TABLE blacklist.source_records
  ADD COLUMN IF NOT EXISTS plate_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_bl_source_records_platehash
  ON blacklist.source_records(plate_hash) WHERE plate_hash IS NOT NULL;

-- master gains the same key so the dedup lookup is symmetric with id_hash.
ALTER TABLE blacklist.master
  ADD COLUMN IF NOT EXISTS plate_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_master_platehash
  ON blacklist.master(plate_hash) WHERE plate_hash IS NOT NULL;

-- ---------- push-back gate (spec §6.1) ----------
-- Writing into a third party's system of record is an authority question, not a
-- technical one. These columns exist so the capability can never be "on by
-- accident": it is off unless someone explicitly enabled it AND acknowledged the
-- warning, and we keep who did that and when.
ALTER TABLE blacklist.sources
  ADD COLUMN IF NOT EXISTS push_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS push_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_confirmed_by TEXT;
