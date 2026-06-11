#!/usr/bin/env node
// ============================================================
// Vigil Platform — Camera Credential Encryption Migration
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// One-shot migration: encrypt plaintext password + mqtt_password in
// cameras-config.json using CAMERA_SECRET_KEY from src/.env
//
// Safe to re-run (idempotent) — already-encrypted values (enc:v1:…) are skipped.
// Creates a timestamped backup before writing.
//
// ⚠️  STOP ALL SERVICES BEFORE RUNNING THIS SCRIPT
//     Running while old services (without crypto-creds decrypt) are active will
//     cause ingesters to read ciphertext as password → auth failure → cameras
//     marked offline. (Incident 2026-06-02, GOTCHAS #72)
//
//     # Stop first:
//     ./scripts/services.sh stop
//
//     # Then run:
//     node scripts/migrate-creds-encrypt.js
//
//     # Then restart with new code:
//     ./scripts/services.sh start
//
// Usage:
//   node scripts/migrate-creds-encrypt.js
//   node scripts/migrate-creds-encrypt.js --dry-run   (preview only, no write)

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'cameras-config.json');
const ENV_FILE    = path.join(ROOT, 'src', '.env');

// Load src/.env manually so CAMERA_SECRET_KEY is available
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { encryptCred } = require(path.join(ROOT, 'src', 'crypto-creds'));

const DRY_RUN = process.argv.includes('--dry-run');

// ── Validate prerequisites ────────────────────────────────────
if (!process.env.CAMERA_SECRET_KEY) {
  console.error('\n❌  CAMERA_SECRET_KEY is not set in src/.env');
  console.error('    Generate one with:');
  console.error('    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('    Then add to src/.env:  CAMERA_SECRET_KEY=<value>\n');
  process.exit(1);
}

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('❌  cameras-config.json not found at', CONFIG_FILE);
  process.exit(1);
}

// ── Load config ───────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const cameras = config.cameras || [];

// ── Encrypt ───────────────────────────────────────────────────
const PREFIX = 'enc:v1:';
let encryptedCount = 0;
let skippedCount   = 0;

const updatedCameras = cameras.map(cam => {
  const out = { ...cam };
  let changed = false;

  for (const field of ['password', 'mqtt_password']) {
    const val = cam[field];
    if (!val || typeof val !== 'string') continue;
    if (val.startsWith(PREFIX)) { skippedCount++; continue; }
    out[field] = encryptCred(val);
    encryptedCount++;
    changed = true;
  }

  if (changed) {
    console.log(`  ${DRY_RUN ? '[dry-run] would encrypt' : '✅ encrypted'} ${cam.camera_id} (${cam.vendor || 'bosch'})`);
  }
  return out;
});

console.log(`\nSummary: ${encryptedCount} field(s) to encrypt · ${skippedCount} already encrypted`);

if (DRY_RUN) {
  console.log('\n[dry-run] No changes written.\n');
  process.exit(0);
}

if (encryptedCount === 0) {
  console.log('Nothing to do — all credentials already encrypted.\n');
  process.exit(0);
}

// ── Backup ────────────────────────────────────────────────────
const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = CONFIG_FILE.replace('.json', `.backup-${ts}.json`);
fs.copyFileSync(CONFIG_FILE, backup);
console.log(`\nBackup saved: ${path.basename(backup)}`);

// ── Write ─────────────────────────────────────────────────────
const updated = { ...config, cameras: updatedCameras };
fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
console.log('cameras-config.json updated with encrypted credentials.\n');

// ── Key backup reminder ───────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  ⚠️  IMPORTANT — BACK UP YOUR ENCRYPTION KEY             ║');
console.log('║                                                          ║');
console.log('║  CAMERA_SECRET_KEY is in src/.env                       ║');
console.log('║  If this file is lost, credentials CANNOT be recovered. ║');
console.log('║                                                          ║');
console.log('║  → Save the key in a password manager or secure note    ║');
console.log('║  → Keep the .backup-*.json file until cameras verified  ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');
