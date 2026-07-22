-- ============================================================
-- Vigil Platform — migration 065: backfill helmet into LPR raw_json
-- The Hikvision ITC camera already sends a <helmet> analytic (yes|no|unknown)
-- in the ANPR XML; lpr-core now parses it into raw_json.helmet going forward.
-- This backfills existing anprAlarm events from the stored rawXml so the
-- no-helmet badge/filter works on historical data too. Idempotent: skips rows
-- that already have a helmet key. One-shot UPDATE (no schema change).
-- ============================================================
UPDATE events
   SET raw_json = jsonb_set(raw_json, '{helmet}',
                            to_jsonb(substring(raw_json->>'rawXml' from '<helmet>([^<]*)</helmet>')))
 WHERE event_type = 'anprAlarm'
   AND raw_json ? 'rawXml'
   AND NOT (raw_json ? 'helmet')
   AND substring(raw_json->>'rawXml' from '<helmet>([^<]*)</helmet>') IS NOT NULL;
