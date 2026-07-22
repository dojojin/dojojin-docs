-- ============================================================
-- Vigil Platform — migration 087: recording_nvr_id (Phase A, plan
-- docs/superpowers/plans/2026-07-19-nvr-recording-mapping.md)
-- Some Dahua LPR cameras are added standalone (own IP) but their footage is
-- actually recorded on a separate physical NVR — confirmed live 2026-07-19
-- (storageDevice.cgi 400s on the standalone camera, 200s on its NVR).
-- recording_nvr_id = the camera_id whose ip/creds should be probed for this
-- camera's storage health. Every member of an NVR group — including the
-- NVR's own two channel rows — points at the same canonical reference row
-- (each NVR's -ch0 entry), so a later reader can just GROUP BY this column.
-- Seeded here with the exact 16-camera mapping the owner gave verbally
-- 2026-07-19 (same set already driving the hardcoded edge pilot, commit
-- 7d8590c) — idempotent, only fills rows that are still NULL.
-- ============================================================

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS recording_nvr_id VARCHAR(100);

UPDATE cameras SET recording_nvr_id = 'HDY-NVR-01-ch0'
  WHERE id IN ('HDY-NVR-01-ch0','HDY-NVR-01-ch1','hdy-anpr1','hdy-anpr-lotus2','hdy-motor-lotus1','hdy-motor-lotus2')
  AND recording_nvr_id IS NULL;

UPDATE cameras SET recording_nvr_id = 'HDY-NVR-02-ch0'
  WHERE id IN ('HDY-NVR-02-ch0','HDY-NVR-02-ch1','hdy-motor-bigc1','hdy-motor-bigc2','hdy-anpr-bigc1','hdy-anpr-bigc2')
  AND recording_nvr_id IS NULL;

UPDATE cameras SET recording_nvr_id = 'HDY-NVR-03-ch0'
  WHERE id IN ('HDY-NVR-03-ch0','HDY-NVR-03-ch1','hdy-anpr-r51','hdy-anpr-r52','hdy-motor-r51','hdy-motor-r52')
  AND recording_nvr_id IS NULL;

UPDATE cameras SET recording_nvr_id = 'HDY-NVR-04-ch0'
  WHERE id IN ('HDY-NVR-04-ch0','HDY-NVR-04-ch1','hdy-anpr-1081','hdy-anpr-1082','hdy-motor-1081','hdy-motor-1082')
  AND recording_nvr_id IS NULL;
