-- Migration: push_tokens sub-toggle columns
-- Adds notify_alert / notify_face to push_tokens for per-type push filtering.
-- Runs AFTER db_migration_push_tokens.sql (sort: "push_tokens." < "push_tokens_").
-- push_tokens table is NOT in init.sql — depends strictly on sort order.

ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS notify_alert BOOLEAN DEFAULT TRUE;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS notify_face  BOOLEAN DEFAULT TRUE;
