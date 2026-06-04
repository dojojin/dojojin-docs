// ============================================================
// DojoJin Tech Dashboard — EMQX MQTT Auth Provisioner
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// SEC-001 Phase 2: one-shot script that:
//   1. Creates password_based:built_in_database authenticator in EMQX
//   2. Creates dashboard-subscriber user (from .env)
//   3. Creates per-camera MQTT users for all Bosch cameras
//   4. Saves mqtt_username / mqtt_password back to cameras-config.json
//   5. Prints credential table for operator to enter in each camera's web UI
//
// Run AFTER docker compose up -d emqx (container must be running)
// Run from project root: node scripts/emqx-provision.js
// ============================================================

'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

require(path.join(__dirname, '..', 'src', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });

const EMQX_API = 'http://localhost:18083/api/v5';
const AUTHN_ID  = 'password_based%3Abuilt_in_database';
const CONFIG_FILE = path.join(__dirname, '..', 'cameras-config.json');

// ── helpers ────────────────────────────────────────────────

function genPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

async function apiReq(method, path, body, token) {
  const res = await fetch(`${EMQX_API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

async function login() {
  const pass = process.env.EMQX_DASHBOARD_PASSWORD;
  if (!pass) throw new Error('EMQX_DASHBOARD_PASSWORD not set in .env');
  const r = await apiReq('POST', '/login', { username: 'admin', password: pass });
  if (!r.ok) throw new Error(`EMQX login failed: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

async function ensureAuthenticator(token) {
  const list = await apiReq('GET', '/authentication', null, token);
  const exists = list.json?.some?.(a => a.id === 'password_based:built_in_database');
  if (exists) {
    console.log('  ✓ Authenticator already exists — skip create');
    return;
  }
  const r = await apiReq('POST', '/authentication', {
    mechanism: 'password_based',
    backend: 'built_in_database',
    password_hash_algorithm: { name: 'bcrypt', salt_rounds: 10 },
    user_id_type: 'username',
  }, token);
  if (!r.ok) throw new Error(`Create authenticator failed: ${JSON.stringify(r.json)}`);
  console.log('  ✓ Authenticator created (password_based:built_in_database)');
}

async function upsertUser(token, userId, password) {
  // Try create first; if 409 (exists) → update password via PUT
  const create = await apiReq('POST', `/authentication/${AUTHN_ID}/users`,
    { user_id: userId, password, is_superuser: false }, token);
  if (create.status === 409) {
    const upd = await apiReq('PUT', `/authentication/${AUTHN_ID}/users/${encodeURIComponent(userId)}`,
      { password, is_superuser: false }, token);
    if (!upd.ok) throw new Error(`Update user ${userId} failed: ${JSON.stringify(upd.json)}`);
    return 'updated';
  }
  if (!create.ok) throw new Error(`Create user ${userId} failed: ${JSON.stringify(create.json)}`);
  return 'created';
}

function camMqttUser(cameraId) {
  // cam-bosch-8100i, cam-b3100i-2, etc.
  return 'cam-' + cameraId.toLowerCase().replace(/_/g, '-');
}

// ── main ───────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  EMQX Provisioner — SEC-001 Phase 2');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Login
  process.stdout.write('Logging in to EMQX API... ');
  const token = await login();
  console.log('OK');

  // 2. Authenticator
  console.log('Ensuring built-in-database authenticator...');
  await ensureAuthenticator(token);

  // 3. Subscriber user
  const subUser = process.env.MQTT_SUBSCRIBER_USER;
  const subPass = process.env.MQTT_SUBSCRIBER_PASSWORD;
  if (!subUser || !subPass) throw new Error('MQTT_SUBSCRIBER_USER / MQTT_SUBSCRIBER_PASSWORD not set in .env');
  process.stdout.write(`Creating subscriber user "${subUser}"... `);
  const subAction = await upsertUser(token, subUser, subPass);
  console.log(subAction);

  // 4. Camera users
  if (!fs.existsSync(CONFIG_FILE)) throw new Error('cameras-config.json not found');
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const boschCams = (config.cameras || []).filter(c =>
    String(c.vendor || 'bosch').toLowerCase() === 'bosch'
  );

  console.log(`\nProvisioning ${boschCams.length} Bosch camera user(s)...`);
  const results = [];

  for (const cam of boschCams) {
    const mqttUser = camMqttUser(cam.camera_id);
    // Reuse existing password if already provisioned, else generate new
    const mqttPass = cam.mqtt_password || genPassword();
    process.stdout.write(`  ${cam.camera_id} → "${mqttUser}"... `);
    const action = await upsertUser(token, mqttUser, mqttPass);
    console.log(action);
    cam.mqtt_username = mqttUser;
    cam.mqtt_password = mqttPass;
    results.push({ camera_id: cam.camera_id, ip: cam.ip_address, user: mqttUser, pass: mqttPass, action });
  }

  // 5. Save credentials back to cameras-config.json
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log('\n✓ cameras-config.json updated with mqtt_username / mqtt_password');

  // 6. Print operator table
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  MQTT Credentials — enter these in each camera\'s Web UI / Config Manager   ║');
  console.log('╠══════════════════╦══════════════════╦══════════════════════════════════════╣');
  console.log('║ Camera           ║ MQTT Username    ║ MQTT Password                        ║');
  console.log('╠══════════════════╬══════════════════╬══════════════════════════════════════╣');
  for (const r of results) {
    const cid  = r.camera_id.padEnd(16).slice(0, 16);
    const user = r.user.padEnd(16).slice(0, 16);
    const pass = r.pass.padEnd(36).slice(0, 36);
    console.log(`║ ${cid} ║ ${user} ║ ${pass} ║`);
  }
  console.log('╚══════════════════╩══════════════════╩══════════════════════════════════════╝');
  console.log('');
  console.log('Broker host: 192.168.10.31   Port: 1883');
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Done. Restart services: ./scripts/services.sh start');
  console.log('═══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n✗ Provisioning failed:', err.message);
  process.exit(1);
});
