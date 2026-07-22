#!/usr/bin/env node
// ============================================================
// Vigil Platform — One-time camera model fill (edge-run)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Runs ON AN EDGE (which can reach the cameras' LAN). Iterates every camera in
// that edge's cameras-config.json, detects its model over the network
// (detectModel routes by vendor: Dahua / Hikvision / Bosch-ONVIF), and prints
// the results. Read-only — no camera or DB write. Decrypts creds in-memory
// (never printed). Apply the emitted JSON to the central DB separately:
//   UPDATE cameras SET model = $1, firmware = $2, serial_number = $3 WHERE id = $4
//
// Usage (on edge):
//   cd ~/vigil-platform/src && set -a && . ./.env && cd .. && node scripts/fill-model.js
// Emits a machine-readable line `MODEL_JSON:[…]` plus a human summary on stderr.
'use strict';
const fs = require('fs');
const path = require('path');
const { detectModel } = require('../src/model-detect');
const { decryptCamCreds } = require('../src/crypto-creds');

const CFG = path.join(__dirname, '..', 'cameras-config.json');

(async () => {
  const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const cams = Array.isArray(c) ? c : (c.cameras || []);
  const out = [];
  for (const cam of cams) {
    let pass = '';
    try { const d = decryptCamCreds(cam); pass = d.password || d.pass || ''; } catch { /* keep '' */ }
    const info = await detectModel(cam, pass);
    const row = { camera_id: cam.camera_id, vendor: cam.vendor || null, ip: cam.ip_address || null,
                  model: info && info.model ? info.model : null,
                  firmware: info ? info.firmware : null,
                  serial: info ? info.serial : null };
    out.push(row);
    process.stderr.write(`  ${(cam.camera_id || '').padEnd(18)} ${(cam.vendor || '').padEnd(8)} ${(cam.ip_address || '').padEnd(15)} -> ${row.model || '(no model)'}\n`);
  }
  const ok = out.filter(r => r.model).length;
  process.stderr.write(`\n${ok}/${out.length} models detected\n`);
  process.stdout.write('MODEL_JSON:' + JSON.stringify(out) + '\n');
})().catch(e => { process.stderr.write('fill-model error: ' + e.message + '\n'); process.exit(1); });
