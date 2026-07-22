-- ============================================================
-- Vigil Platform — migration 066: backfill uphone + nonMotorManned into raw_json
-- Two more camera ITC analytics already present in the stored ANPR rawXml:
--   uphone          = driver using a phone (yes|no|unknown)
--   nonMotorManned  = motorcycle carrying a passenger (ซ้อนท้าย, yes|no|unknown)
-- lpr-core now parses both going forward; this backfills existing anprAlarm
-- events from rawXml. Idempotent (skips rows already carrying the key).
-- ============================================================
UPDATE events
   SET raw_json = jsonb_set(raw_json, '{uphone}',
                            to_jsonb(substring(raw_json->>'rawXml' from '<uphone>([^<]*)</uphone>')))
 WHERE event_type = 'anprAlarm'
   AND raw_json ? 'rawXml'
   AND NOT (raw_json ? 'uphone')
   AND substring(raw_json->>'rawXml' from '<uphone>([^<]*)</uphone>') IS NOT NULL;

UPDATE events
   SET raw_json = jsonb_set(raw_json, '{nonMotorManned}',
                            to_jsonb(substring(raw_json->>'rawXml' from '<nonMotorManned>([^<]*)</nonMotorManned>')))
 WHERE event_type = 'anprAlarm'
   AND raw_json ? 'rawXml'
   AND NOT (raw_json ? 'nonMotorManned')
   AND substring(raw_json->>'rawXml' from '<nonMotorManned>([^<]*)</nonMotorManned>') IS NOT NULL;
