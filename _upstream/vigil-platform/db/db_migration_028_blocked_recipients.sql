-- Migration 028: add 'blocked' status to pending_recipients
-- Blocked = permanent soft-block; user messages are silently ignored,
-- no auto-reply, never re-appears in pending list.
-- Unblock resets to 'ignored' (can re-register by messaging again).

DO $$
BEGIN
  -- Drop old CHECK, re-add with 'blocked' included
  ALTER TABLE pending_recipients DROP CONSTRAINT IF EXISTS pending_recipients_status_check;
  ALTER TABLE pending_recipients ADD CONSTRAINT pending_recipients_status_check
    CHECK (status = ANY (ARRAY['pending','approved','ignored','blocked']));
END $$;
