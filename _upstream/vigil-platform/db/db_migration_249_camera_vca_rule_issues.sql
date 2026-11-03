-- ============================================================
-- Vigil Platform — Migration 249: cameras.vca_rule_issues / vca_rules_checked_at
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- Bosch caps an IVA task (rule) name at 64 BYTES and cuts it mid-character
-- (RCP+ spec §2.785 CONF_VIPROC_RE_TASK_NAMES). The MQTT topic embeds the
-- name, so a name cut into invalid UTF-8 makes NanoMQ silently drop the
-- PUBLISH and makes Mosquitto 2.x disconnect the camera with "malformed
-- packet" — 60 days of one rule's events never reaching the DB was the
-- incident that found this (DINION 5100i, 172.29.51.53).
--
-- Read-only RCP+ probe (helpers/boschRcp.js readTaskNames), hourly, on both
-- the edge (edge-config-agent.js pollVcaRulesOnce, over MQTT Device/vca-rules)
-- and central (mqtt-subscriber.js pollAllVcaRules, direct write) for cameras
-- it can each reach — same split as sd_status/sd_last_check_at.
-- ============================================================

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS vca_rule_issues JSONB,
                     ADD COLUMN IF NOT EXISTS vca_rules_checked_at TIMESTAMPTZ;
