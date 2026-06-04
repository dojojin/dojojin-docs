-- ============================================================
-- Migration: alert rule active-window / quiet hours (Phase 7.2)
-- ============================================================
-- Per-rule time-of-day window for LINE alerts. Both columns NULL
-- (the default) = the rule is active 24/7 — existing rules are
-- unaffected. When set, the alert-engine only fires the rule if the
-- current time (in display_timezone) falls inside [active_from,
-- active_to). Windows that cross midnight (from > to, e.g.
-- 22:00–06:00) are supported by the engine.
--
-- alert_logs.status gets a new value 'quiet_hours_skip' — no schema
-- change needed there, it's a free-text VARCHAR(20).
--
-- Idempotent — ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS active_from TIME,
  ADD COLUMN IF NOT EXISTS active_to   TIME;
