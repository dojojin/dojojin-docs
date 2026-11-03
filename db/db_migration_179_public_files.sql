-- ============================================================
-- Vigil Platform — migration 179: Admin-uploadable file host
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- P5 File Service: admin-only file uploads for sharing documents/images
-- with customers via signed, expiring public URLs. No external service needed.
--
-- Files are stored on disk in files/ (outside repo); metadata goes to DB.
-- Signed URLs via SNAPSHOT_PROXY_SECRET + expiry timestamp (RFC 3339).
-- Serves via /pub/fil/ route with Content-Disposition:attachment.

CREATE TABLE IF NOT EXISTS public_files (
  id            SERIAL PRIMARY KEY,
  stored_name   TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  bytes         BIGINT NOT NULL,
  sha256        TEXT NOT NULL,
  uploaded_by   TEXT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  note          TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_files_uploaded_at ON public_files (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_files_revoked_at ON public_files (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_public_files_expires_at ON public_files (expires_at) WHERE expires_at IS NOT NULL;

INSERT INTO system_settings (key, value, description)
VALUES ('file_retention_days','90', 'Default retention days for uploaded public files (1–730).')
ON CONFLICT (key) DO NOTHING;
