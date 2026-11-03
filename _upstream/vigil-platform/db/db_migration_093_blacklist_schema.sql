-- ============================================================
-- Vigil Platform — migration 093: multi-source blacklist reservoir
-- Spec: docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md
--
-- Three-layer shape (§4.1):
--   blacklist.sources         -- one row per CONFIGURED CONNECTION (instance),
--                                not per source *type* — 'DSS Pro @ HDY' and
--                                'DSS Pro @ Pattani' are two rows (2026-07-25
--                                instance-based redesign).
--   blacklist.source_records  -- per-source raw mirror, 1:1 with what the source reports
--   blacklist.master          -- our canonical identity (the "reservoir")
--   blacklist.master_links    -- join: which source_records compose one master
--
-- PII handling: id_number_enc is enc:v1: AES-256-GCM under BLACKLIST_SECRET_KEY
-- (a DIFFERENT key from CAMERA_SECRET_KEY — a camera-key leak must not double as
-- a blacklist-PII leak, spec §4.3). id_hash is HMAC-SHA256 under the same key and
-- is the dedup match key — it is never reversible back to the ID.
--
-- This schema does NOT alert. LPR alerting stays on lpr_watchlist; the bridge
-- columns added at the bottom are what let a future sync job add AND remove only
-- the rows it created, never an operator's hand-added row (spec §4.4).
-- ============================================================

CREATE SCHEMA IF NOT EXISTS blacklist;

-- ---------- connection instances ----------
CREATE TABLE IF NOT EXISTS blacklist.sources (
  id                 BIGSERIAL PRIMARY KEY,
  source_type        TEXT NOT NULL,                        -- 'gurusquare' | 'dss_pro' | 'dahua_nvr' | 'hcp' | ...
  label              TEXT NOT NULL,                        -- operator-facing name, e.g. 'GuruSquare — Site HDY'
  site_code          TEXT,                                 -- which edge proxies the outbound call (NULL = central-direct)
  data_types         TEXT[] NOT NULL DEFAULT '{}',         -- {'lpr'} | {'face'} | {'face','lpr'}
  config             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- host/port/username; secret fields stored as enc:v1:
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_import_at     TIMESTAMPTZ,
  last_import_status TEXT,                                 -- 'ok' | 'error'
  last_import_note   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- per-source raw bucket ----------
CREATE TABLE IF NOT EXISTS blacklist.source_records (
  id            BIGSERIAL PRIMARY KEY,
  source_id     BIGINT NOT NULL REFERENCES blacklist.sources(id) ON DELETE CASCADE,
  data_type     TEXT NOT NULL,                 -- 'face' | 'lpr' — which page this record feeds
  external_id   TEXT NOT NULL,                 -- the source's own record id (idempotency key)
  id_type       TEXT,                          -- 'national_id' | 'passport' | NULL
  id_country    TEXT,                          -- required when id_type = 'passport'
  id_number_enc TEXT,                          -- enc:v1: encrypted display value
  id_hash       TEXT,                          -- HMAC-SHA256(normalized id) — match key
  name          TEXT,
  case_ref      TEXT,                          -- this source's case/file reference
  case_note     TEXT,
  photo_path    TEXT,
  plate_numbers TEXT[],                        -- raw plates as reported by this source
  raw_json      JSONB,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_bl_source_records_hash ON blacklist.source_records(id_hash);
CREATE INDEX IF NOT EXISTS idx_bl_source_records_type ON blacklist.source_records(data_type);
CREATE INDEX IF NOT EXISTS idx_bl_source_records_src  ON blacklist.source_records(source_id);

-- ---------- canonical identity ----------
CREATE TABLE IF NOT EXISTS blacklist.master (
  id            BIGSERIAL PRIMARY KEY,
  id_hash       TEXT,                          -- HMAC match key; NULL allowed (no-ID identities)
  id_type       TEXT,
  id_country    TEXT,
  id_number_enc TEXT,
  display_name  TEXT,
  photo_path    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Multiple NULLs coexist under a partial UNIQUE index in Postgres — exactly what
-- "several no-ID identities, each their own master, none auto-deduped" needs (§4.3).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_master_hash ON blacklist.master(id_hash) WHERE id_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS blacklist.master_links (
  id               BIGSERIAL PRIMARY KEY,
  master_id        BIGINT NOT NULL REFERENCES blacklist.master(id) ON DELETE CASCADE,
  source_record_id BIGINT NOT NULL REFERENCES blacklist.source_records(id) ON DELETE CASCADE,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (master_id, source_record_id)
);
-- One source_record belongs to exactly one master — makes re-import idempotent
-- (look up the existing link instead of minting a second master every run).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_links_srec ON blacklist.master_links(source_record_id);

-- ---------- bridge columns on the table that actually alerts (§4.4) ----------
-- Not used by this migration; added now so the bridge sync job can be written
-- without a second migration. 'manual' default keeps every existing operator-added
-- row untouched and un-deletable by the bridge.
ALTER TABLE lpr_watchlist
  ADD COLUMN IF NOT EXISTS origin              TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS blacklist_master_id BIGINT;
