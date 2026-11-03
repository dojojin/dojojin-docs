#!/usr/bin/env node
// ============================================================
// Vigil Platform — CLI: sync Mosquitto LAN auth files (edge)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// E2 (docs/reports/2026-09-27_mosquitto-migration-plan.md §11). One-shot
// version of what src/edge-config-agent.js's syncBrokerAuth() does on every
// camera-config change — reads this edge's own cameras-config.json (same
// decrypt path as _loadCameraMap()) plus MQTT_SUBSCRIBER_*/
// SNAPSHOT_PUBLISHER_* from src/.env, and writes
// ~/.config/vigil/mosquitto.{passwd,acl}.
//
// scripts/edge-render-mosquitto-conf.sh runs this BEFORE writing the new
// mosquitto.conf, unconditionally, and aborts the render if it fails — the
// new template's global password_file must never take effect without the
// loopback service accounts already in it (see mosquittoAuthFiles.js's
// header comment for why that specific failure mode matters).
//
// Never SIGHUPs mosquitto — that's the render script's --reload flag, kept
// as the one place that touches a running broker.
//
// Prints only counts and skip reasons (camera_id/local-user-label + why) —
// never a username's password, per this module's own contract.
//
// Usage: node scripts/edge-sync-broker-auth.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
// Loads src/.env as a side effect. Not `require('dotenv')` directly here —
// the `dotenv` package only lives in src/node_modules (src/package.json has
// its own dependency set), which is not on the resolution path from
// scripts/ — requiring it straight from this file throws MODULE_NOT_FOUND.
// src/config.js already does the real dotenv.config() call from inside
// src/, where it resolves; requiring it gets the same env loaded for free.
require('../src/config');

const { decryptCamCreds } = require('../src/crypto-creds');
const { writeAuthFiles, localBrokerUsersFromEnv, incompleteLocalUserKeys } = require('../src/helpers/mosquittoAuthFiles');

// Overridable for tests only (scripts/ is outside src/config.js's DEFS
// registry — see check-env.js — so these are plain process.env reads, same
// convention as EDGE_OVERSIZED_DIR in src/edge/publisher.js).
const CONFIG_PATH = process.env.EDGE_CAMERAS_CONFIG_PATH || path.join(__dirname, '..', 'cameras-config.json');
const AUTH_DIR = process.env.EDGE_MOSQUITTO_AUTH_DIR || path.join(os.homedir(), '.config', 'vigil');

// Same graceful fallback as edge-config-agent.js's _loadCameraMap() — a
// missing or unreadable file (e.g. brand-new edge, no camera pushed yet)
// means "no cameras", not a failure; the local service accounts still need
// writing so loopback keeps working.
function loadCameras() {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return (d.cameras || []).filter((c) => c.camera_id).map((c) => decryptCamCreds(c));
  } catch { return []; }
}

(async () => {
  try {
    const incomplete = incompleteLocalUserKeys(process.env);
    if (incomplete.length) {
      console.error(`[edge-sync-broker-auth] ⛔ ${incomplete.join(', ')} มีค่าแต่ไม่มีรหัสคู่กัน — client ที่ส่ง username นี้จะถูก Mosquitto ปฏิเสธแม้บน loopback · ตั้งรหัสให้ครบ หรือตั้ง user เป็นค่าว่าง (node scripts/edge-set-env.js <KEY>=) แล้ว restart service ที่ใช้`);
      process.exit(3);
    }
    const cameras = loadCameras();
    const localUsers = localBrokerUsersFromEnv(process.env);
    const r = await writeAuthFiles({ cameras, localUsers, dir: AUTH_DIR });
    const skippedDesc = r.skipped.map((s) => `${s.camera_id}: ${s.reason}`).join('; ');
    console.log(`[edge-sync-broker-auth] users=${r.users.length} changed=${r.changed}${skippedDesc ? ` skipped=[${skippedDesc}]` : ''}`);
  } catch (e) {
    console.error(`[edge-sync-broker-auth] failed: ${e.message}`);
    process.exit(1);
  }
})();
