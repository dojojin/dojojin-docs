-- ============================================================
-- Vigil Platform — migration 090: LPR rider_count column (pillion overload)
-- Dahua ITC431 ANPR events (TrafficJunction) carry NonMotor.NumOfCycling — the
-- number of people on a detected motorcycle (1/2/3+, live-verified 2026-07-21
-- against the camera's own OSD burn-in text on 3 separate samples). Stored as
-- its own indexed column rather than raw_json, same perf reasoning as
-- no_helmet/plate_color (#085): the overview KPI's COUNT(*) FILTER needs a
-- narrow column, not a raw_json->> detoast.
--
-- Hikvision has no equivalent field (its ITC XML only carries the binary
-- nonMotorManned yes/no, already read from raw_json — unchanged by this
-- migration) — rider_count stays NULL for those rows. Dahua ITC237 (older
-- model) has no NonMotor field at all — also NULL. NULL means unknown, not 0
-- or 1 — never inferred from silence.
--
-- Additive + nullable → instant metadata-only migration, safe at api-server
-- boot. No backfill: NumOfCycling was never stored in raw_json.data
-- historically for any vendor, so existing rows can't be retroactively
-- classified — the KPI/filter/badge below only see new rows going forward.
-- ============================================================

ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS rider_count smallint;

-- Partial index — only the (few) 3+ rows, keyed by event_id (mirrors
-- idx_plates_no_helmet from #085). Serves both the search filter
-- (passenger=3plus) and the KPI FILTER count.
CREATE INDEX IF NOT EXISTS idx_plates_rider_count_3plus ON license_plates (event_id) WHERE rider_count >= 3;
