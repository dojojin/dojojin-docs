// ============================================================
// Vigil Platform — Camera Credential Encryption
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// AES-256-GCM symmetric encryption for camera credentials stored in
// cameras-config.json. Key lives in src/.env as CAMERA_SECRET_KEY.
//
// Format: enc:v1:<base64(iv[12] || tag[16] || ciphertext)>
// Plaintext passthrough: if value does not start with "enc:v1:" it is
// returned as-is so the file can be migrated incrementally without
// breaking running services.
//
// Usage:
//   const { encryptCred, decryptCred } = require('./crypto-creds');
//   const cipher = encryptCred('MyPassword123');  // "enc:v1:..."
//   const plain  = decryptCred(cipher);           // "MyPassword123"

'use strict';

const crypto = require('crypto');

const PREFIX    = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 12;
const TAG_LEN   = 16;

function _getKey() {
  const hex = process.env.CAMERA_SECRET_KEY;
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    console.error('[crypto-creds] CAMERA_SECRET_KEY must be 32 bytes (64 hex chars)');
    return null;
  }
  return buf;
}

// Returns "enc:v1:<base64>" or original value on error / missing key.
function encryptCred(value) {
  if (!value || typeof value !== 'string') return value;
  if (value.startsWith(PREFIX)) return value; // already encrypted
  if (value === '***') return value;           // never encrypt redacted mask

  const key = _getKey();
  if (!key) {
    console.warn('[crypto-creds] CAMERA_SECRET_KEY not set — storing credential as plaintext');
    return value;
  }

  try {
    const iv     = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ct     = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag    = cipher.getAuthTag();
    const blob   = Buffer.concat([iv, tag, ct]);
    return PREFIX + blob.toString('base64');
  } catch (e) {
    console.error('[crypto-creds] encrypt error:', e.message);
    return value;
  }
}

// Returns plaintext or original value on error / missing key / plain input.
function decryptCred(value) {
  if (!value || typeof value !== 'string') return value;
  if (!value.startsWith(PREFIX)) return value; // plaintext passthrough

  const key = _getKey();
  if (!key) {
    console.error('[crypto-creds] CAMERA_SECRET_KEY not set — cannot decrypt credential');
    return value; // return ciphertext; ingester will fail to auth (logged, not crashed)
  }

  try {
    const blob    = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv      = blob.subarray(0, IV_LEN);
    const tag     = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct      = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct) + decipher.final('utf8');
  } catch (e) {
    console.error('[crypto-creds] decrypt error (wrong key or corrupt data):', e.message);
    return value;
  }
}

// Decrypt password + mqtt_password fields on a camera object in-place.
// Returns the same object (mutated) for convenience.
function decryptCamCreds(cam) {
  if (!cam) return cam;
  if (cam.password)      cam.password      = decryptCred(cam.password);
  if (cam.mqtt_password) cam.mqtt_password = decryptCred(cam.mqtt_password);
  return cam;
}

// Encrypt password + mqtt_password on a camera object, returning a new object
// (does NOT mutate — safe for in-memory config that must stay decrypted).
function encryptCamCreds(cam) {
  if (!cam) return cam;
  const out = { ...cam };
  if (out.password)      out.password      = encryptCred(out.password);
  if (out.mqtt_password) out.mqtt_password = encryptCred(out.mqtt_password);
  return out;
}

module.exports = { encryptCred, decryptCred, decryptCamCreds, encryptCamCreds };
