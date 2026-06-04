-- ============================================================
-- Migration 026: LINE OA basicId for self-service onboarding guide
-- ============================================================
-- Stores the LINE Official Account's @basicId so the UI can
-- display a QR code / friend-add link for the onboarding guide.
-- ============================================================

ALTER TABLE line_config ADD COLUMN IF NOT EXISTS oa_basic_id TEXT;
