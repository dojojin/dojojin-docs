-- Migration 038: drop dead columns cameras.http_password + cameras.rtsp_url
-- Both columns have existed since initial schema design but have zero
-- INSERT / UPDATE / SELECT references in src/ or dashboard/ (grep confirmed).
-- v_cameras_public already excludes them. All existing rows hold NULL.
-- Decision #193 · GOTCHAS #70 · SEC-015.

ALTER TABLE cameras DROP COLUMN IF EXISTS http_password;
ALTER TABLE cameras DROP COLUMN IF EXISTS rtsp_url;

-- Update view comment — http_password and rtsp_url no longer exist
COMMENT ON VIEW v_cameras_public IS
  'Public camera view (excludes http_user).';
