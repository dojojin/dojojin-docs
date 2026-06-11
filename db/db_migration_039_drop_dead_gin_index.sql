-- ============================================================
-- Migration 039: Drop dead GIN index on events.raw_json
-- ============================================================
-- WHY: idx_events_raw_gin (GIN on raw_json) has 0 lifetime scans
--      and no code path uses GIN operators (@>, <@, ?, ?|, ?&)
--      on raw_json — access patterns are key extraction (->>),
--      jsonb concat (||), and JS-side field access, none of which
--      touch a GIN index.
--
--      Keeping it adds write overhead on every event INSERT
--      (the hot MQTT/Hikvision/Dahua ingestion path) for zero
--      query benefit.
--
-- SAFETY: plain DROP INDEX IF EXISTS — not CONCURRENTLY because
--         migrate.js runs inside BEGIN...COMMIT (CONCURRENTLY is
--         prohibited in a transaction block). Lock is instant on
--         boot before serving traffic.
-- ============================================================

DROP INDEX IF EXISTS idx_events_raw_gin;
