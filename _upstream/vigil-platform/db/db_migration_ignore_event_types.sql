-- ============================================================
-- Vigil Platform — Migration: per-camera event-type suppress
-- ============================================================
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS ignore_event_types TEXT[] DEFAULT '{}';
