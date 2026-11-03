-- ============================================================
-- Vigil Platform — migration 105: index hygiene + autovacuum for events
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- events takes ~370,000 inserts a day and every index is written on every one
-- of them. Two of them are never read.
--
-- idx_events_rule and idx_events_class were verified unused on the only
-- partition that holds data (events_y2026m07: 62MB and 57MB, 0 and 0 scans).
-- Not by trusting the counter alone — the counter resets per partition and does
-- not count constraint enforcement — but by running the exact queries they
-- exist for (a rule_name filter and an object_class filter, with and without a
-- time bound) and watching which counters moved: events_y2026m07_event_time_idx
-- went up, these two did not. With a time bound the time index is far more
-- selective, and without one these values are not selective enough to beat a
-- scan, so the planner never picks them.
--
-- This IS a trade, not free cleanup: /api/events still offers rule_name and
-- object_classes filters, and after this they are served by the time index plus
-- a filter step. That is what the planner already chose on real data, and since
-- 1A every query carries a 24h default, which is exactly the shape that makes
-- the time index the right one.
--
-- Left alone deliberately: camera_id_event_time_idx1 (332MB) and
-- event_time_idx1 (166MB) show 121 and 28 scans — low, but not zero, so they
-- are in use and dropping them needs its own evidence. license_plates is not
-- touched either: it has zero dead tuples (insert-only) and its large indexes
-- all show some use — idx_plates_number_trgm at 123MB/2 scans is the one worth
-- a decision later, but that decision is "does anyone use fuzzy plate search",
-- not a performance question.
--
-- Autovacuum: events_y2026m07 was sitting at 920,490 dead tuples (14.6%) with
-- the last autovacuum 39 hours earlier, because the default scale_factor of 0.2
-- means waiting for 20% of 5.3M rows — about 1.07M — before it even starts.
-- 0.02 starts it around 107k instead, and cost_limit 2000 lets it keep up with
-- the insert rate rather than being throttled to the default 200.
--
-- Postgres refuses storage parameters on a partitioned table ("cannot specify
-- storage parameters for a partitioned table"), so this has to be applied per
-- partition and NEW partitions will not inherit it — anything created beyond
-- the pre-built range through 2027-12 needs the same treatment. Setting these
-- globally in postgresql.conf instead would avoid that, but needs the restart
-- that Phase 3 is scheduled for.
--
-- Order matters: the ALTERs take SHARE UPDATE EXCLUSIVE and do not block
-- inserts, the DROPs take ACCESS EXCLUSIVE on events and do. The DROPs are last
-- so that lock is held for as little of the transaction as possible.
-- ============================================================

DO $$
DECLARE part text;
BEGIN
  FOR part IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c  ON c.oid = i.inhrelid
      JOIN pg_class pc ON pc.oid = i.inhparent
     WHERE pc.relname = 'events'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.02,'
      || ' autovacuum_analyze_scale_factor = 0.01,'
      || ' autovacuum_vacuum_cost_limit = 2000)', part);
  END LOOP;
END $$;

-- The two DROP INDEX statements that belonged here have been REMOVED from this
-- file, and what happened is worth recording rather than tidying away.
--
-- They ran once, on central, and they worked — but not before blocking ingest
-- for ~100 seconds. Dropping a partitioned index needs ACCESS EXCLUSIVE on
-- events; the nightly pg_dump happened to be holding ACCESS SHARE through
-- COPY public.license_plates, so the drop had to wait — and a waiting lock
-- request is not passive: every INSERT arriving behind it queued as well. The
-- drop completed as soon as pg_dump finished (18.1s total for the file) and
-- central's indexes are gone, so no further action is needed HERE.
--
-- It stays out of the file because a migration must not be able to do that.
-- A failure or a long stall here aborts api-server startup by design
-- (STUBBORN_FACT #81), and "blocks all writes for as long as a backup runs" is
-- not a property a boot-time step may have. Instead:
--   * fresh volumes: init.sql no longer creates these indexes at all
--   * any other volume that still has them: drop by hand, with lock_timeout so
--     it fails fast instead of queueing, and retry in a quiet window
--
--   SET lock_timeout = '5s';
--   DROP INDEX IF EXISTS idx_events_rule;
--   DROP INDEX IF EXISTS idx_events_class;
--
-- Everything above this line takes only SHARE UPDATE EXCLUSIVE, which does not
-- conflict with pg_dump and does not block writes.
