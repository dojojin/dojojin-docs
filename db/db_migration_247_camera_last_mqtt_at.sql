-- ============================================================
-- Vigil Platform — Migration 247: cameras.last_mqtt_at
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Broker-neutral "camera MQTT message seen" timestamp — replaces the
-- EMQX-only connected-client check in checkMqttSilent (which has logged
-- 904,783 false "online but MQTT not connected" lines: every Bosch camera
-- connects to its EDGE broker, never to Central, so Central's connected-
-- client list never contains them — src/api-server.js checkMqttSilent,
-- docs/reports/2026-09-27_mosquitto-migration-plan.md §8 A1).
--
-- mqtt-subscriber.js sets this from an in-memory per-camera Map, flushed
-- every 60s in one batched UPDATE, on any <cam>/onvif-ej/... message
-- (site-prefix stripped) — not on every message, and not a per-message
-- DB write.
-- ============================================================

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS last_mqtt_at TIMESTAMPTZ;
