-- ============================================================
-- Migration: Branding settings (white-label support)
-- ============================================================
-- 4 new keys in system_settings used by the dashboard sidebar,
-- login page, disclaimer, and PDF report header. Default values
-- preserve the existing "DojoJin Tech" look.
--
-- The footer "© DojoJin Tech · All Rights Reserved" is intentionally
-- locked in code (not a setting) so resold instances still credit
-- the original product.
--
-- Idempotent.
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('brand_name',          'DojoJin Tech Dashboard', 'Product name shown in sidebar, login, disclaimer and PDF report header.'),
  ('brand_tagline',       'CCTV Analytics Suite',   'Short subtitle under the brand name.'),
  ('brand_logo_path',     '',                       'Path under /branding/ (e.g. logo.png). Empty = fall back to default emoji.'),
  ('brand_primary_color', '#5b8def',                'Single accent colour applied across the dashboard.')
ON CONFLICT (key) DO NOTHING;
