-- ============================================================
-- Vigil Platform — migration 119: partner API consumers (Phase TP1a)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- One row per external partner allowed to call /v1. Identity only — what a
-- partner may READ is not here, it is the Postgres grants on db_role
-- (migration 118 created the third_party_readonly role those roles inherit).
-- Keeping the two apart is the point: a bug in our code can hand out the
-- wrong row from this table, and Postgres still refuses the columns that
-- partner was never granted.
--
-- Nothing in this file grants anything. Creating the login role per partner
-- is an ops step (spec §2.3) so that adding a row can never widen access on
-- its own.
--
-- The secret is stored ENCRYPTED, not hashed, and that is forced by the
-- scheme rather than chosen. AK/SK signing is HMAC: the partner never sends
-- the secret, they send a signature over the request, and the only way to
-- check it is to recompute the HMAC with the same secret. A hash cannot do
-- that. Storing a hash and asking the partner to send the secret so we could
-- compare would turn this into a bearer token with extra steps — the secret
-- would cross the wire on every call, which is precisely what signing exists
-- to avoid.
--
-- So: AES-256-GCM via src/crypto-creds.js, the same mechanism camera
-- passwords already use for the same reason (we must be able to present them
-- again). The key lives in src/.env as CAMERA_SECRET_KEY, outside the
-- database, so a dump of this table is not a set of working credentials.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_consumers (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,

  -- Sent in the clear as X-Ca-Key on every request; identifies, never authorises.
  app_key         TEXT NOT NULL UNIQUE,
  -- "enc:v1:<base64>" from crypto-creds.js. Reversible by necessity — see the
  -- note above. Never returned by any endpoint, and shown to a human exactly
  -- once, at creation.
  app_secret_enc  TEXT NOT NULL,

  -- The Postgres login role the request runs as. Deliberately free text and
  -- NOT a foreign key — pg_roles is cluster-wide and cannot be referenced, and
  -- migration 118 is the standing reminder that a role can vanish from under a
  -- database that still believes in it. Verified at request time instead.
  db_role         TEXT NOT NULL,

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  rate_per_min    INT NOT NULL DEFAULT 60,

  -- Which sites this partner may see, NULL = all. Applied on top of the
  -- Postgres grants, never instead of them: the grants decide which COLUMNS,
  -- this decides which ROWS, and neither can widen the other.
  site_codes      TEXT[],

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  -- Revoking sets active=false and stamps this. Rows are never deleted: the
  -- audit log references consumers that no longer serve traffic, and a dangling
  -- id there is worse than a dead row here.
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT,
  last_seen_at    TIMESTAMPTZ
);

-- Every request looks up by app_key, so this one is on the hot path. UNIQUE
-- already builds it; named here only to make that dependency explicit.
CREATE INDEX IF NOT EXISTS idx_api_consumers_key ON api_consumers(app_key) WHERE active;

COMMENT ON TABLE api_consumers IS
  'External partners permitted to call /v1. Identity and rate only — read '
  'permission lives in Postgres grants on db_role. See docs/SPEC_partner-api_2026-08-07.md';

-- ------------------------------------------------------------
-- Request log. Separate table because it grows per-request while the one
-- above grows per-partner, and because "who did we let in, and when" has to
-- survive the partner row being revoked.
--
-- Logged at the auth boundary, not per query: enough to answer "did this
-- partner call us, was it accepted, and how fast" without becoming a second
-- copy of the data they read.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_request_log (
  id           BIGSERIAL PRIMARY KEY,
  consumer_id  BIGINT REFERENCES api_consumers(id),
  -- Kept even when consumer_id is NULL (unknown key), which is exactly the
  -- case worth reading later: someone is guessing.
  app_key      TEXT,
  ip           TEXT,
  method       TEXT,
  path         TEXT,
  status       INT,
  -- Populated when status is 401/403 — 'bad-signature', 'stale-timestamp',
  -- 'nonce-replay', 'inactive', 'unknown-key'. Free text so a new rejection
  -- reason does not need a migration to be recordable.
  reason       TEXT,
  duration_ms  INT,
  at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_request_log_at ON api_request_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_consumer ON api_request_log(consumer_id, at DESC);
-- Partial index: rejections are the rows anyone actually goes looking for,
-- and they are a small fraction of the table once a partner is working.
CREATE INDEX IF NOT EXISTS idx_api_request_log_rejected ON api_request_log(at DESC) WHERE status >= 400;

COMMENT ON TABLE api_request_log IS
  'One row per /v1 request at the auth boundary. Retained for audit; not a copy of the payload.';
