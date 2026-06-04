-- ============================================================
-- Migration: analytics_event_display setting (Phase 7.1)
-- ============================================================
-- Camera-side automatic analytics events (ImageTooBright/Blurry/Dark,
-- GlobalSceneChange, Trigger/DigitalInput, Trigger/Relay) are NOT IVA
-- rules — they fire automatically and carry no rule_name. They are
-- always stored, but this CSV setting controls which types appear in
-- the Events Live feed (Option B: store-everything, filter-on-display).
--
-- Default: image-quality + scene-change ON; digital I/O OFF (operator-
-- specific — depends what's physically wired to each input/relay).
--
-- The PUT /api/settings/:key handler does an UPDATE (not upsert), so the
-- row must exist for the Settings UI to be able to save it.
--
-- Idempotent — ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('analytics_event_display',
   'ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange',
   'CSV of camera-automation analytics event types shown in the Events feed. Valid keys: ImageTooBright, ImageTooBlurry, ImageTooDark, GlobalSceneChange, Trigger/DigitalInput/&Input_1, Trigger/DigitalInput/&Input_2, Trigger/Relay/&Output_1, Trigger/Relay/&Output_2.')
ON CONFLICT (key) DO NOTHING;
