-- ============================================================
-- Vigil Platform — Migration 056: Multi-Site — cam_role
-- Adds cam_role column to cameras for LPR/Face/Standard split.
-- Values: 'standard' (IVA/Event) | 'lpr' | 'face'
-- ============================================================

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS cam_role VARCHAR(20) NOT NULL DEFAULT 'standard';
