-- ============================================================
-- Migration 023: LINE pending recipients (self-service onboarding)
-- ============================================================
-- LINE user/group IDs are discovered from webhook events, then require
-- admin approval before being promoted into line_config.recipients.
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_recipients (
  line_id          TEXT PRIMARY KEY,
  source_type      TEXT NOT NULL CHECK (source_type IN ('user', 'group', 'room')),
  display_name     TEXT,
  avatar_url       TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_count    INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_pending_recipients_status_last
  ON pending_recipients (status, last_message_at DESC);
