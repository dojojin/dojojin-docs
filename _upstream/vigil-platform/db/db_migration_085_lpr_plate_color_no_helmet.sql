-- ============================================================
-- Vigil Platform — migration 085: LPR plate_color + no_helmet columns (perf)
-- /api/lpr/stats spent ~3.9s each on TWO of its 10 aggregations — kpi
-- (COUNT FILTER on raw_json->>'helmet') and pcolor (GROUP BY
-- raw_json->>'plateColor') — because both force a full Seq Scan + JSONB
-- detoast of events.raw_json (~250k rows/day). The other 8 aggregations run
-- 55–290ms via the event_time index. Promote both attributes to plain columns
-- on license_plates (mirrors no_seatbelt #073 and plate_type #084) so the
-- aggregations read a narrow column instead of detoasting raw_json.
--
-- Columns are additive + nullable → this migration is instant (metadata-only)
-- and safe to auto-run at api-server boot. The BACKFILL is deliberately NOT
-- here: a ~258k-row UPDATE that detoasts raw_json would lock license_plates and
-- delay boot. It lives in scripts/backfill_085_plate_color_no_helmet.js (batched,
-- run manually). New rows are populated at ingest. NULL reads as
-- not-flagged / excluded — matches the old `= 'no'` and
-- `NOT IN ('','unknown')` semantics exactly.
-- ============================================================

ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS plate_color varchar;
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS no_helmet   boolean;

-- Partial index — only the (few) flagged rows, keyed by event_id for the stats
-- join (mirrors idx_plates_no_seatbelt from #073). Helps the search filter
-- (helmet=no); the KPI FILTER count reads the boolean inline.
CREATE INDEX IF NOT EXISTS idx_plates_no_helmet ON license_plates (event_id) WHERE no_helmet;
