// ============================================================
// Vigil Platform — Blacklist PII crypto (enc:v1: + HMAC match key)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Same AES-256-GCM algorithm and enc:v1: wire format as src/crypto-creds.js,
// but keyed off BLACKLIST_SECRET_KEY — deliberately a DIFFERENT key (spec §4.3).
// A leaked camera credential key must not also decrypt national IDs, and vice
// versa. Do not "simplify" these two modules back into one shared key.
//
// Self-check: `node src/helpers/blacklist-crypto.js` (see bottom).
'use strict';

const crypto = require('crypto');
const env = require('../config');

const PREFIX    = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 12;
const TAG_LEN   = 16;

function _getKey() {
  const hex = env.str('BLACKLIST_SECRET_KEY');
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    console.error('[blacklist-crypto] BLACKLIST_SECRET_KEY must be 32 bytes (64 hex chars)');
    return null;
  }
  return buf;
}

// Unlike crypto-creds (which degrades to plaintext so a camera keeps working),
// this THROWS when the key is missing. Silently writing an unencrypted national
// ID into the DB is the exact failure this module exists to prevent — a blacklist
// import that can't encrypt must fail loudly, not half-succeed.
function encryptPii(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (s.startsWith(PREFIX)) return s; // already encrypted

  const key = _getKey();
  if (!key) throw new Error('BLACKLIST_SECRET_KEY not set — refusing to store PII unencrypted');

  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct     = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptPii(value) {
  if (!value || typeof value !== 'string') return value;
  if (!value.startsWith(PREFIX)) return value; // plaintext passthrough

  const key = _getKey();
  if (!key) throw new Error('BLACKLIST_SECRET_KEY not set — cannot decrypt PII');

  const blob     = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv       = blob.subarray(0, IV_LEN);
  const tag      = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct       = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct) + decipher.final('utf8');
}

// Normalization must be stable across sources or the same person hashes twice.
// Strip every non-alphanumeric (sources write 1-2345-67890-12-3 vs 1234567890123)
// and uppercase (passport letters).
function normalizeId(raw) {
  return String(raw || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

// Match key. Passport numbers are only unique per issuing country, so the country
// is part of the hashed input for passports — otherwise a Thai and a UK passport
// that share digits would collapse into one identity.
function idHash(idNumber, idType, idCountry) {
  const norm = normalizeId(idNumber);
  if (!norm) return null;
  const key = _getKey();
  if (!key) throw new Error('BLACKLIST_SECRET_KEY not set — cannot compute match key');
  const input = idType === 'passport'
    ? `passport:${String(idCountry || '').toUpperCase()}:${norm}`
    : `national_id:${norm}`;
  return crypto.createHmac('sha256', key).update(input, 'utf8').digest('hex');
}

// Thai national ID validity. 13 digits with a mod-11 check digit — the same
// rule ทะเบียนราษฎร์ uses. This matters beyond tidiness: id_hash is derived from
// this number, so a malformed ID silently breaks cross-source dedup (the same
// person imported from another system with the correct ID hashes differently
// and becomes a second master). Returns a reason so the UI can explain WHY.
function checkThaiNationalId(raw) {
  const s = String(raw || '').replace(/[^0-9]/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length !== 13) return { ok: false, reason: 'length', length: s.length };
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (13 - i);
  if (((11 - (sum % 11)) % 10) !== Number(s[12])) return { ok: false, reason: 'checksum', length: 13 };
  return { ok: true };
}

// Plate match key for LPR. A plate is a vehicle's identity the way a national ID
// is a person's, so it gets the same treatment: normalise, then HMAC. Normalising
// matters — the live GuruSquare roster writes the same vehicle as both
// "1กฉ 8966" and "1กฉ8966", which raw string comparison would never match.
// Thai letters must survive the strip, so this keeps ฀-๿.
function normalizePlate(raw) {
  return String(raw || '').replace(/[^0-9A-Za-z฀-๿]/g, '').toUpperCase();
}

function plateHash(plate) {
  const norm = normalizePlate(plate);
  if (!norm) return null;
  const key = _getKey();
  if (!key) throw new Error('BLACKLIST_SECRET_KEY not set — cannot compute plate key');
  return crypto.createHmac('sha256', key).update(`plate:${norm}`, 'utf8').digest('hex');
}

// Display masking (spec §4.2) — reveal-on-demand is a separate, audited action.
function maskId(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + 'x'.repeat(s.length - 4) + s.slice(-2);
}

module.exports = { encryptPii, decryptPii, idHash, normalizeId, maskId, checkThaiNationalId, normalizePlate, plateHash };

// ---------- self-check ----------
if (require.main === module) {
  const assert = require('assert');
  process.env.BLACKLIST_SECRET_KEY = crypto.randomBytes(32).toString('hex');

  // round-trip
  const id = '1234567890123';
  const enc = encryptPii(id);
  assert.ok(enc.startsWith(PREFIX), 'ciphertext must carry the enc:v1: prefix');
  assert.notStrictEqual(enc, id, 'ciphertext must not equal plaintext');
  assert.strictEqual(decryptPii(enc), id, 'round-trip must recover the original');

  // non-deterministic ciphertext (random IV) but deterministic match key
  assert.notStrictEqual(encryptPii(id), encryptPii(id), 'each encrypt must use a fresh IV');
  assert.strictEqual(idHash(id), idHash(id), 'match key must be deterministic');

  // normalization: formatting differences must collapse to the same match key
  assert.strictEqual(idHash('1-2345-67890-12-3'), idHash('1234567890123'),
    'dashed and undashed forms of the same ID must match');
  assert.strictEqual(idHash(' 1234567890123 '), idHash('1234567890123'),
    'surrounding whitespace must not change the match key');

  // passport scoping: same number, different country => different identity
  assert.notStrictEqual(idHash('AA123456', 'passport', 'TH'), idHash('AA123456', 'passport', 'GB'),
    'passport match key must be scoped by issuing country');

  // different IDs must not collide
  assert.notStrictEqual(idHash('1234567890123'), idHash('1234567890124'));

  // plateHash normalizes internally, which is what lets a hand-typed plate land
  // on the same master as the roster's copy (BM1a). The manual route stores
  // normalizePlate(input) as external_id and passes the raw plate to this — if
  // the two ever stopped agreeing, a typed "1กธ 4047" would mint a second
  // master beside the imported "1กธ4047" and the operator would see one plate
  // wearing two identities with no error anywhere.
  assert.strictEqual(plateHash('1กธ 4047'), plateHash('1กธ4047'),
    'spacing must not change the plate match key');
  assert.strictEqual(plateHash('1กธ-4047'), plateHash('1กธ4047'),
    'punctuation must not change the plate match key');
  assert.strictEqual(plateHash('ab1234'), plateHash('AB1234'),
    'case must not change the plate match key');
  assert.notStrictEqual(plateHash('1กธ4047'), plateHash('1กธ4048'),
    'different plates must not collide');
  assert.strictEqual(plateHash('  '), null, 'no plate => no match key');
  assert.strictEqual(plateHash(null), null);

  // empty / missing input
  assert.strictEqual(idHash(''), null, 'no ID => no match key (becomes its own master)');
  assert.strictEqual(encryptPii(''), null);
  assert.strictEqual(encryptPii(null), null);

  // tamper detection (GCM auth tag)
  const blob = Buffer.from(enc.slice(PREFIX.length), 'base64');
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => decryptPii(PREFIX + blob.toString('base64')), 'tampered ciphertext must throw');

  // wrong key must not silently return garbage
  const good = encryptPii(id);
  process.env.BLACKLIST_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  assert.throws(() => decryptPii(good), 'decrypting under the wrong key must throw');

  // missing key must throw, never fall back to plaintext
  delete process.env.BLACKLIST_SECRET_KEY;
  assert.throws(() => encryptPii(id), /refusing to store PII unencrypted/);

  assert.strictEqual(maskId('1234567890123'), '12xxxxxxxxx23');

  // ---- plate match key ----
  // The "missing key" assertions above deleted the env var, so restore one.
  process.env.BLACKLIST_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  // The two forms below are BOTH present in the live GuruSquare roster for the
  // same vehicle; the whole point of normalising is that they collapse.
  assert.strictEqual(plateHash('1กฉ 8966'), plateHash('1กฉ8966'), 'spacing must not split one vehicle in two');
  assert.strictEqual(plateHash('  กง-6453 '), plateHash('กง6453'), 'punctuation/whitespace must normalise away');
  assert.strictEqual(normalizePlate('1กฉ 8966'), '1กฉ8966', 'Thai letters must survive normalisation');
  assert.notStrictEqual(plateHash('1กฉ8966'), plateHash('1กฉ8967'), 'different plates must not collide');
  assert.strictEqual(plateHash(''), null, 'no plate => no key (own master)');
  assert.strictEqual(plateHash('   '), null, 'whitespace-only plate => no key');
  // plate key and ID key must live in separate namespaces
  assert.notStrictEqual(plateHash('1234567890123'), idHash('1234567890123'),
    'a plate and a national ID with the same digits must not hash alike');

  // ---- Thai national ID checksum ----
  // Verified against the two malformed IDs actually found in the live DSS Pro
  // roster (one 12-digit, one 9-digit) plus a known-good synthetic number.
  const validId = (() => { // build a valid 13-digit ID so the test carries no real PII
    const base = '110170006040';
    let sum = 0; for (let i = 0; i < 12; i++) sum += Number(base[i]) * (13 - i);
    return base + String((11 - (sum % 11)) % 10);
  })();
  assert.strictEqual(checkThaiNationalId(validId).ok, true, 'a correctly-formed ID must pass');
  assert.strictEqual(checkThaiNationalId(validId.slice(0, 12)).ok, false, '12 digits must fail');
  assert.strictEqual(checkThaiNationalId(validId.slice(0, 12)).reason, 'length');
  assert.strictEqual(checkThaiNationalId('123456789').reason, 'length', '9 digits must fail on length');
  // flip the check digit -> must fail on checksum, not length
  const flipped = validId.slice(0, 12) + String((Number(validId[12]) + 1) % 10);
  assert.strictEqual(checkThaiNationalId(flipped).ok, false);
  assert.strictEqual(checkThaiNationalId(flipped).reason, 'checksum');
  // formatting must not change the verdict
  assert.strictEqual(checkThaiNationalId(validId.replace(/^(.)(....)(.....)(..)(.)$/, '$1-$2-$3-$4-$5')).ok, true);
  assert.strictEqual(checkThaiNationalId('').reason, 'empty');
  assert.strictEqual(checkThaiNationalId(null).reason, 'empty');

  console.log('blacklist-crypto self-check: all assertions passed');
}
