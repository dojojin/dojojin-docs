-- Migration 079: normalize plateColor casing/tokens in events.raw_json
-- Different camera models/firmwares report plateColor inconsistently
-- (White vs white; Color vs colorful for the SAME real category — confirmed
-- 2026-07-03 by inspecting actual LPR snapshots, both are ป้ายประมูล).
-- This caused the same plate color to split into separate rows/bars in
-- /api/lpr/stats and to silently miss matches in the plate-color filters.
-- Backfills existing rows to match the ingest-side fix (lpr-core.js's
-- normalizePlateColor()). Idempotent: only touches rows whose value would
-- actually change, so re-running after normalization is a no-op.

UPDATE events
   SET raw_json = jsonb_set(raw_json, '{plateColor}', to_jsonb(
         CASE LOWER(raw_json->>'plateColor')
           WHEN 'color' THEN 'colorful'
           ELSE LOWER(raw_json->>'plateColor')
         END
       ))
 WHERE raw_json->>'plateColor' IS NOT NULL
   AND raw_json->>'plateColor' <> (
         CASE LOWER(raw_json->>'plateColor')
           WHEN 'color' THEN 'colorful'
           ELSE LOWER(raw_json->>'plateColor')
         END
       );
