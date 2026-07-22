// ============================================================
// Vigil Platform — CAMERA_SECRET_KEY rotation migration
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Re-encrypts cameras-config.json's password/mqtt_password fields from an
// OLD CAMERA_SECRET_KEY to a NEW one. Run this BEFORE updating any .env file
// or restarting any process — it needs both keys at once, which no running
// process ever holds simultaneously (each only knows its own current .env).
//
// Usage:
//   OLD_KEY=<64 hex chars> NEW_KEY=<64 hex chars> node scripts/rotate-camera-secret-key.js [path/to/cameras-config.json]
//
// Backs up the original file to <path>.bak-<timestamp> before writing.
// Safe to re-run: entries already encrypted with NEW_KEY are left untouched
// (decrypt-with-OLD-key on them will fail gracefully and get skipped, logged).
// ============================================================
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const PREFIX    = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 12;
const TAG_LEN   = 16;

function parseKey(hex, label) {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`${label} must be 64 hex chars (32 bytes) — got ${hex ? hex.length : 0} chars`);
  }
  return Buffer.from(hex, 'hex');
}

function encryptCred(value, key) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith(PREFIX)) {
    // Already re-encrypted (re-run safety) — leave as-is rather than double-encrypt.
    return value;
  }
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct     = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptCred(value, key) {
  if (!value || typeof value !== 'string') return { ok: true, value }; // plaintext/empty passthrough
  if (!value.startsWith(PREFIX)) return { ok: true, value };
  try {
    const blob = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv   = blob.subarray(0, IV_LEN);
    const tag  = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct   = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return { ok: true, value: decipher.update(ct) + decipher.final('utf8') };
  } catch (e) {
    return { ok: false, error: e.message, value };
  }
}

// Re-encrypts one field on a camera object in place. Returns 'rotated' |
// 'skipped-plaintext' | 'skipped-already-new' | 'failed-wrong-old-key'.
function rotateField(cam, field, oldKey, newKey) {
  const raw = cam[field];
  if (!raw || typeof raw !== 'string') return 'skipped-plaintext';
  if (!raw.startsWith(PREFIX)) return 'skipped-plaintext';

  // Try decrypting with the NEW key first — if that already works, this
  // entry was already migrated (re-run safety), leave it alone.
  const alreadyNew = decryptCred(raw, newKey);
  if (alreadyNew.ok) return 'skipped-already-new';

  const withOld = decryptCred(raw, oldKey);
  if (!withOld.ok) return 'failed-wrong-old-key';

  cam[field] = encryptCred(withOld.value, newKey);
  return 'rotated';
}

function migrate(configObj, oldKey, newKey) {
  const stats = { rotated: 0, skippedPlaintext: 0, skippedAlreadyNew: 0, failed: [] };
  for (const cam of configObj.cameras || []) {
    for (const field of ['password', 'mqtt_password']) {
      const result = rotateField(cam, field, oldKey, newKey);
      if (result === 'rotated') stats.rotated++;
      else if (result === 'skipped-plaintext') stats.skippedPlaintext++;
      else if (result === 'skipped-already-new') stats.skippedAlreadyNew++;
      else if (result === 'failed-wrong-old-key') stats.failed.push(`${cam.camera_id || '?'}.${field}`);
    }
  }
  return stats;
}

function main() {
  const oldKey = parseKey(process.env.OLD_KEY, 'OLD_KEY');
  const newKey = parseKey(process.env.NEW_KEY, 'NEW_KEY');
  const configPath = process.argv[2] || require('path').join(__dirname, '..', 'cameras-config.json');

  if (!fs.existsSync(configPath)) throw new Error(`Not found: ${configPath}`);
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);

  const backupPath = `${configPath}.bak-${Date.now()}`;
  fs.writeFileSync(backupPath, raw);
  console.log(`[rotate] backed up original to ${backupPath}`);

  const stats = migrate(config, oldKey, newKey);
  console.log(`[rotate] rotated=${stats.rotated} skipped-plaintext=${stats.skippedPlaintext} skipped-already-new=${stats.skippedAlreadyNew} failed=${stats.failed.length}`);
  if (stats.failed.length) {
    console.error('[rotate] FAILED fields (wrong OLD_KEY, or corrupt data) — nothing written, fix OLD_KEY and re-run:');
    stats.failed.forEach(f => console.error('  -', f));
    process.exit(1);
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`[rotate] wrote ${configPath} — ${stats.rotated} credential(s) now encrypted with NEW_KEY`);
  console.log('[rotate] next: update CAMERA_SECRET_KEY=<NEW_KEY> in src/.env on Central, restart api-server,');
  console.log('[rotate] then trigger publishSiteConfig for every site, then update+restart edge-config-agent on each edge.');
}

function assert(cond, msg) {
  if (!cond) { console.error('ASSERTION FAILED:', msg); process.exit(1); }
}

function selfTest() {
  // Round-trip proof using two throwaway random keys — touches no real
  // secrets or files. Run: SELF_TEST=1 node scripts/rotate-camera-secret-key.js
  const A = crypto.randomBytes(32);
  const B = crypto.randomBytes(32);
  const plain = 'S3cretPassw0rd!';
  const encA = encryptCred(plain, A);
  assert(encA.startsWith(PREFIX), 'encrypted value should carry enc:v1: prefix');

  const cam = { camera_id: 'TEST', password: encA, mqtt_password: 'plainpass', extra: 'untouched' };
  const stats = migrate({ cameras: [cam] }, A, B);
  assert(stats.rotated === 1, `expected 1 rotated, got ${stats.rotated}`);
  assert(stats.skippedPlaintext === 1, `expected 1 skipped-plaintext (mqtt_password), got ${stats.skippedPlaintext}`);
  assert(cam.password.startsWith(PREFIX), 'rotated field should still carry prefix');
  assert(cam.mqtt_password === 'plainpass', 'plaintext field must be untouched');
  assert(cam.extra === 'untouched', 'unrelated field must be untouched');

  const roundTrip = decryptCred(cam.password, B);
  assert(roundTrip.ok && roundTrip.value === plain, `round-trip decrypt with NEW key failed: ${JSON.stringify(roundTrip)}`);

  const wrongKeyStillA = decryptCred(cam.password, A);
  assert(!wrongKeyStillA.ok, 'decrypting NEW-key data with OLD key must fail, not silently succeed');

  // Re-run safety: running migrate() again with the same A->B should no-op (already new).
  const stats2 = migrate({ cameras: [cam] }, A, B);
  assert(stats2.skippedAlreadyNew === 1, `expected re-run to detect already-migrated field, got ${JSON.stringify(stats2)}`);

  // Wrong OLD_KEY must fail loudly, not corrupt data. Compare against the
  // ORIGINAL stored ciphertext (not a fresh encryptCred call — AES-GCM uses a
  // random IV per call, so two encryptions of the same plaintext/key never
  // match byte-for-byte; that's correct behavior, not a bug to assert against).
  const originalCipher = encryptCred(plain, A);
  const camBad = { camera_id: 'TEST2', password: originalCipher };
  const wrongOldKey = crypto.randomBytes(32);
  const statsBad = migrate({ cameras: [camBad] }, wrongOldKey, B);
  assert(statsBad.failed.length === 1, 'wrong OLD_KEY must be reported as failed, not silently corrupted');
  assert(camBad.password === originalCipher, 'field must be unmodified when OLD_KEY is wrong');

  console.log('[self-test] all assertions passed — round-trip, plaintext-preserved, wrong-key-detected, re-run-safe');
  process.exit(0);
}

if (require.main === module) {
  if (process.env.SELF_TEST === '1') selfTest();
  else main();
}

module.exports = { migrate, encryptCred, decryptCred, rotateField };
