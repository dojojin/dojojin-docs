-- Migration 069: add tile_snap_file / tile_snap_ts to cameras
-- Stores the most recent periodic full-scene preview captured by edge-config-agent.
-- serveLatestSnapshot() checks this first so face/LPR tiles show a scene, not a crop.
ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS tile_snap_file TEXT,
  ADD COLUMN IF NOT EXISTS tile_snap_ts   TIMESTAMPTZ;
