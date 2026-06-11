// ============================================================
// Vigil Platform — Tests: crypto-creds
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// 64 hex chars = 32-byte AES-256-GCM key
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Set key before require so _getKey() sees it on first call
const _origKey = process.env.CAMERA_SECRET_KEY;
process.env.CAMERA_SECRET_KEY = TEST_KEY;

const { encryptCred, decryptCred, decryptCamCreds, encryptCamCreds } = require('../src/crypto-creds');

describe('encryptCred / decryptCred — with key', () => {
  it('round-trip: encrypt then decrypt returns original', () => {
    const plain = 'MyPassword123!';
    const cipher = encryptCred(plain);
    assert.ok(cipher.startsWith('enc:v1:'), 'ciphertext must start with enc:v1:');
    assert.notEqual(cipher, plain);
    assert.equal(decryptCred(cipher), plain);
  });

  it('two encryptions of the same value produce different ciphertexts (random IV)', () => {
    const a = encryptCred('same');
    const b = encryptCred('same');
    assert.notEqual(a, b);
  });

  it('encryptCred does not double-encrypt an already-encrypted value', () => {
    const cipher = encryptCred('hello');
    assert.equal(encryptCred(cipher), cipher);
  });

  it('decryptCred passes through plaintext (no enc:v1: prefix)', () => {
    assert.equal(decryptCred('plainpassword'), 'plainpassword');
  });

  it('decryptCred returns original on null/falsy input', () => {
    assert.equal(decryptCred(null), null);
    assert.equal(decryptCred(''), '');
  });

  it('encryptCred returns original for null/falsy input', () => {
    assert.equal(encryptCred(null), null);
    assert.equal(encryptCred(''), '');
  });

  it('encryptCred returns *** unchanged (redacted mask passthrough)', () => {
    assert.equal(encryptCred('***'), '***');
  });
});

describe('decryptCamCreds / encryptCamCreds', () => {
  it('decryptCamCreds decrypts password and mqtt_password in-place', () => {
    const cam = {
      id: 1,
      password:      encryptCred('campass'),
      mqtt_password: encryptCred('mqttpass'),
      host: '192.168.1.1',
    };
    const result = decryptCamCreds(cam);
    assert.equal(result, cam, 'should mutate and return same object');
    assert.equal(result.password,      'campass');
    assert.equal(result.mqtt_password, 'mqttpass');
    assert.equal(result.host, '192.168.1.1', 'non-credential fields untouched');
  });

  it('encryptCamCreds returns new object without mutating original', () => {
    const cam = { id: 2, password: 'plain', mqtt_password: 'mqttplain' };
    const enc = encryptCamCreds(cam);
    assert.notEqual(enc, cam, 'should be new object');
    assert.equal(cam.password, 'plain', 'original must not be mutated');
    assert.ok(enc.password.startsWith('enc:v1:'));
    assert.ok(enc.mqtt_password.startsWith('enc:v1:'));
  });

  it('decryptCamCreds handles null safely', () => {
    assert.equal(decryptCamCreds(null), null);
  });
});

describe('encryptCred — with no CAMERA_SECRET_KEY', () => {
  before(() => { delete process.env.CAMERA_SECRET_KEY; });
  after(() => { process.env.CAMERA_SECRET_KEY = TEST_KEY; });

  it('returns original value (plaintext passthrough + warn)', () => {
    assert.equal(encryptCred('secret'), 'secret');
  });
});

// Restore original env value after all tests in this file
after(() => {
  if (_origKey === undefined) delete process.env.CAMERA_SECRET_KEY;
  else process.env.CAMERA_SECRET_KEY = _origKey;
});
