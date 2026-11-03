-- ============================================================
-- Migration: Edge host spec (CPU, RAM, OS info)
-- Adds host_spec_json column to edge_status to persist static
-- host information (CPU model, cores, RAM, OS) from the edge
-- heartbeat. Idempotent.
-- ============================================================

ALTER TABLE edge_status
  ADD COLUMN IF NOT EXISTS host_spec_json jsonb;
