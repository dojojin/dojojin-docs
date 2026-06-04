-- ============================================================
-- Migration: convert legacy TIMESTAMP columns to TIMESTAMPTZ
-- Reason: bare TIMESTAMP columns dropped UTC marker on insert,
--         causing pg to re-interpret values as server-local
--         timezone on read (7-hour drift on BKK hosts).
-- Idempotent + tolerates schema drift — only converts columns
-- that (a) still exist and (b) are still 'timestamp without
-- time zone'. Columns later renamed (last_seen → last_seen_at)
-- or dropped (events.created_at) are silently skipped.
-- Existing values are interpreted as UTC (matches what the
-- subscriber writes — ISO 'Z' strings).
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type   = 'timestamp without time zone'
       AND (table_name, column_name) IN (
         ('events',         'event_time'),
         ('events',         'created_at'),
         ('cameras',        'last_seen'),
         ('cameras',        'created_at'),
         ('appearances',    'created_at'),
         ('license_plates', 'created_at')
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
      r.table_name, r.column_name, r.column_name
    );
    RAISE NOTICE 'timestamptz: converted %.% → TIMESTAMPTZ', r.table_name, r.column_name;
  END LOOP;
END $$;
