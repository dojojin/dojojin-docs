-- Migration 082: backfill appearances rows for old FaceRecognition events
-- FaceRecognition never got an immediate appearances insert (only the
-- body-pairing path did, and only when the terminal sent a separate Body
-- message within 10s — some terminals never do, e.g. Hikvision_FaceReg_C01
-- stopped pairing after 2026-06-23, leaving Person Data permanently empty
-- for it despite every event carrying usable gender/glass attributes).
-- The ingest-side fix (hikvision-isapi.js's ingestFaceAlarmEvent) now does
-- an immediate insert for new events; this backfills the 882 pre-existing
-- rows the same way.
--
-- Mapping MUST match the ingest path exactly (gender/glasses stored
-- capitalized/boolean there, not the raw lowercase raw_json strings) or a
-- gender filter would silently fail to match these rows even though they
-- appear in the gallery. Idempotent: WHERE NOT EXISTS guards re-runs.

INSERT INTO appearances (event_id, camera_id, object_class, confidence, gender, glasses)
SELECT
  e.id, e.camera_id, 'Person',
  CASE WHEN e.raw_json->>'faceScore' ~ '^\d+(\.\d+)?$'
       THEN (e.raw_json->>'faceScore')::numeric / 100 ELSE NULL END,
  CASE e.raw_json->>'gender' WHEN 'male' THEN 'Male' WHEN 'female' THEN 'Female' ELSE NULL END,
  e.raw_json->>'glass' IN ('yes', 'sunglasses')
FROM events e
WHERE e.event_type = 'FaceRecognition'
  AND NOT EXISTS (SELECT 1 FROM appearances a WHERE a.event_id = e.id)
  AND (e.raw_json->>'gender' IN ('male', 'female') OR e.raw_json->>'glass' IN ('yes', 'sunglasses'));
