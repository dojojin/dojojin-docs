-- ============================================================
-- Vigil Platform — migration 115: room for the whole microSD picture
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- cameras already carries sd_status / sd_error / sd_last_check_at plus three
-- recording_* columns, and all of it was shaped around ONVIF GetRecordingSummary
-- — which is Bosch. It answers "is there footage and until when" and nothing
-- else, and 'ok' from it means only that the call returned.
--
-- Hikvision reports considerably more, over three documents: card health,
-- capacity, filesystem, encryption, install date, whether recording is even
-- SCHEDULED, the bitrate, and how many clips actually exist. Surveyed at Phuket
-- on 2026-08-04, all 34 face cameras answer 'ok' with plenty of free space and
-- have never recorded a single frame — the flat sd_status has no way to say
-- that, which is why nobody noticed for a month.
--
-- One jsonb column rather than a dozen typed ones. The shape is vendor-specific
-- and still moving (Dahua's storageDevice.cgi reports different fields again),
-- and a column per field would mean a migration every time a model exposes
-- something new. Nothing joins or filters on these — they are read whole, for
-- one camera, to draw one panel. sd_status stays as it is so every existing
-- reader keeps working untouched.
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS sd_detail_json jsonb;

COMMENT ON COLUMN cameras.sd_detail_json IS
  'รายละเอียด microSD จากกล้อง (Hikvision: ContentMgmt/Storage + record/tracks + search) — โครงสร้างตาม helpers/hikStorage.buildSdDetail; sd_status ยังใช้ได้เหมือนเดิม';

-- Only for "which cameras have a problem" sweeps on the Health page. A partial
-- index because the interesting rows are the few that are not idle, and there is
-- no point indexing 143 rows of the common case.
CREATE INDEX IF NOT EXISTS idx_cameras_sd_state
  ON cameras ((sd_detail_json->>'state'))
  WHERE sd_detail_json IS NOT NULL;
