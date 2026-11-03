-- ============================================================
-- Vigil Platform — Migration 248: edge_status.camera_broker_url
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- The camera form's MQTT CREDENTIALS panel showed "Broker ? : 1883"
-- because the host came from Central's single MQTT_CAMERA_BROKER_HOST
-- env (unset) — but Bosch cameras actually connect to their SITE's EDGE
-- broker, whose LAN URL only exists in that edge's own .env
-- (EDGE_CAMERA_BROKER_URL). This column carries that URL to Central via
-- the existing edge heartbeat (src/edge/bridge.js → mqtt-subscriber.js
-- recordEdgeHeartbeat), so the camera form can show the real per-site
-- broker instead of a placeholder.
-- ============================================================

ALTER TABLE edge_status ADD COLUMN IF NOT EXISTS camera_broker_url TEXT;
