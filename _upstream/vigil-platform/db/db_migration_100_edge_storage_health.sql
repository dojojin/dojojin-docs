-- ============================================================
-- Migration 100 — storage/mdraid health on edge_status
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- Edge heartbeat has carried a `storage` field (mounts + mdraid array state,
-- src/helpers/storageHealth.js) since the 2026-07-29 hkt site work, but
-- mqtt-subscriber's recordEdgeHeartbeat() never stored it — central was
-- silently dropping it. This column is where it lands, one JSON blob per
-- site, same pattern as pm2_json/last_svc_result above.
ALTER TABLE edge_status
  ADD COLUMN IF NOT EXISTS storage_json JSONB;
