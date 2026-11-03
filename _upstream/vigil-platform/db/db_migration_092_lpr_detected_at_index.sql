-- ============================================================
-- Vigil Platform — migration 092: index license_plates(detected_at)
-- Executive Summary page adds a "total plates today vs yesterday" KPI
-- (COUNT(*) FILTER WHERE detected_at >= ...) — license_plates had no index
-- on detected_at at all, forcing a full seq scan (1.93M rows, measured
-- 727ms via EXPLAIN ANALYZE on prod). With the index: ~200ms.
--
-- Applied live on prod already via CREATE INDEX CONCURRENTLY (non-blocking,
-- run manually outside the migration runner's transaction — CONCURRENTLY
-- cannot run inside BEGIN/COMMIT). This file is IF NOT EXISTS so the runner
-- no-ops there; it's what actually builds the index on fresh installs /
-- other environments where the runner's transaction-wrapped plain CREATE
-- INDEX cost is a one-time, acceptable, non-hot-path setup cost.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_plates_detected_at ON license_plates (detected_at);
