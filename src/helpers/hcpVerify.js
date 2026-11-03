// ============================================================
// Vigil Platform — Helper: AK/SK request verification (Phase TP1b)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The server side of ./hcpSign.js. A partner signs a request the way we sign
// requests to HikCentral; this rebuilds the same string and checks the HMAC.
//
// It does NOT reimplement the string layout — it calls signRequest() with the
// nonce and timestamp the caller sent plus the secret we hold, and compares
// the two signatures. That is deliberate. The layout is positional and every
// empty field still contributes a newline; a second implementation of it would
// agree on the happy path and drift on exactly the cases nobody tests. One
// function means signer and verifier cannot disagree, and the self-test at the
// bottom is a real cross-check rather than two copies of one mistake.
//
// Scope: this answers "is this request from who it claims, and is it fresh".
// It says nothing about what the partner may read — that is the Postgres
// grants on their db_role (GOTCHAS #145).
// ============================================================
'use strict';

const crypto = require('crypto');
const { signRequest } = require('./hcpSign');

// How far a caller's clock may be off. Wide enough for an unsynced server,
// narrow enough that a captured request stops working quickly. It also bounds
// how long a nonce has to be remembered.
const SKEW_MS = 5 * 60 * 1000;

/**
 * Nonces already spent, so a valid request cannot be replayed inside the skew
 * window. Entries older than the window are dropped on write — a captured
 * request that old already fails the timestamp check, so keeping the nonce
 * buys nothing.
 *
 * In memory because api-server runs as a single fork_mode process (verified
 * via `pm2 jlist`, 2026-08-07), matching the rate-limit map in
 * src/routes/users.js:79.
 *
 * ponytail: in-process store. If api-server ever moves to cluster_mode this
 * FAILS OPEN AND SILENTLY — a replay landing on a different worker sees an
 * empty set and is accepted. Move to a Postgres table with a TTL sweep before
 * changing exec_mode, not after.
 */
function createNonceStore(ttlMs = SKEW_MS) {
  const seen = new Map();   // nonce -> expiry ms
  return {
    /** @returns {boolean} true if this nonce is fresh (and now spent) */
    use(nonce, now) {
      // Sweep before the lookup so an expired entry never reads as a replay.
      if (seen.size > 64) for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
      if (seen.has(nonce) && seen.get(nonce) > now) return false;
      seen.set(nonce, now + ttlMs);
      return true;
    },
    get size() { return seen.size; },
  };
}

/**
 * @param {object} o
 * @param {string} o.method        req.method
 * @param {string} o.path          req.path — path only, no query
 * @param {object} [o.query]       req.query, as express parsed it
 * @param {string} [o.body]        raw body if any, exactly as received
 * @param {object} o.headers       req.headers (lowercased keys, as Node gives them)
 * @param {string} o.appSecret     the secret we hold for the claimed app_key
 * @param {object} o.nonceStore    from createNonceStore()
 * @param {number} [o.now]         injectable for tests
 * @returns {{ok: true} | {ok: false, reason: string, status: number}}
 */
function verifyRequest(o) {
  const h = o.headers || {};
  const key = h['x-ca-key'];
  const nonce = h['x-ca-nonce'];
  const ts = h['x-ca-timestamp'];
  const sig = h['x-ca-signature'];

  if (!key || !nonce || !ts || !sig) {
    return { ok: false, reason: 'missing-headers', status: 401 };
  }

  // Express turns a repeated param into an array, and signRequest would
  // stringify that into something the caller never signed. Rejecting is
  // honest; silently signing "a=1,2" would fail with a confusing
  // bad-signature instead of saying what was wrong.
  for (const [k, v] of Object.entries(o.query || {})) {
    if (typeof v !== 'string') {
      return { ok: false, reason: 'repeated-query-param', status: 400 };
    }
    // Non-ASCII cannot be signed unambiguously: it travels percent-encoded and
    // arrives here decoded, so the caller's string and ours never match. Left
    // alone it surfaces as bad-signature, which reads as "wrong secret" and
    // sends the partner hunting in the wrong place. This matters immediately
    // rather than eventually — /v1/lpr/events takes plate text, and Thai plates
    // are the most likely query value in this system.
    if (!/^[\x20-\x7E]*$/.test(v) || !/^[\x20-\x7E]*$/.test(k)) {
      return { ok: false, reason: 'non-ascii-query', status: 400 };
    }
  }

  const now = o.now || Date.now();
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > SKEW_MS) {
    return { ok: false, reason: 'stale-timestamp', status: 401 };
  }

  // Signature BEFORE nonce, and the order is load-bearing. Checking the nonce
  // first would let anyone without the secret fill the store with junk just by
  // sending requests. Only a request that already proved it holds the secret
  // is allowed to consume an entry.
  const expected = signRequest({
    method: o.method,
    path: o.path,
    query: o.query,
    body: o.body,
    appKey: key,
    appSecret: o.appSecret,
    nonce,
    timestamp: tsNum,
  }).headers['X-Ca-Signature'];

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, so guard first — and compare
  // even when lengths differ is pointless, a wrong length is already a no.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature', status: 401 };
  }

  if (!o.nonceStore.use(nonce, now)) {
    return { ok: false, reason: 'nonce-replay', status: 401 };
  }

  return { ok: true };
}

// Note on storage, because the obvious instinct is wrong here: the secret
// cannot be stored as a hash. Verifying an HMAC means recomputing it, which
// needs the secret itself. A hash would only work if the partner sent the
// secret for us to compare — i.e. a bearer token, which is the thing signing
// replaces. Migration 119 stores it encrypted (crypto-creds.js) for that
// reason, and this file receives the decrypted value as o.appSecret.

module.exports = { verifyRequest, createNonceStore, SKEW_MS };

if (require.main === module) {
  const assert = require('assert');
  const SECRET = 'partner-secret';
  const KEY = 'partner-key';
  const NOW = 1700000000000;

  // Build a request the way a partner would, using the signer we ship.
  const make = (over = {}) => {
    const s = signRequest({
      method: over.method || 'GET',
      path: over.path || '/v1/cameras',
      query: over.query,
      body: over.body,
      appKey: KEY,
      appSecret: over.secret || SECRET,
      nonce: over.nonce || 'nonce-1',
      timestamp: over.timestamp || NOW,
    });
    const headers = {};
    for (const [k, v] of Object.entries(s.headers)) headers[k.toLowerCase()] = v;
    return {
      method: over.method || 'GET',
      path: over.path || '/v1/cameras',
      query: over.query,
      body: over.body,
      headers,
    };
  };

  const run = (req, store, now = NOW) =>
    verifyRequest({ ...req, appSecret: SECRET, nonceStore: store, now });

  // A request signed with the right secret verifies.
  assert.strictEqual(run(make(), createNonceStore()).ok, true, 'good signature must pass');

  // ...including one with a body and one with query params.
  assert.strictEqual(run(make({ method: 'POST', body: '{"a":1}' }), createNonceStore()).ok, true);
  assert.strictEqual(run(make({ query: { since: '2026-08-01', pageSize: '100' } }), createNonceStore()).ok, true);

  // Query order must not matter — the signer sorts, so the verifier must agree.
  const q = make({ query: { b: '2', a: '1' } });
  assert.strictEqual(verifyRequest({
    ...q, query: { a: '1', b: '2' }, appSecret: SECRET, nonceStore: createNonceStore(), now: NOW,
  }).ok, true, 'query order must not change the outcome');

  // The whole point: a wrong secret must not verify.
  assert.strictEqual(run(make({ secret: 'partner-secre7' }), createNonceStore()).reason, 'bad-signature');

  // One flipped character in the signature must not verify.
  const tampered = make();
  const s0 = tampered.headers['x-ca-signature'];
  tampered.headers['x-ca-signature'] = (s0[0] === 'A' ? 'B' : 'A') + s0.slice(1);
  assert.strictEqual(run(tampered, createNonceStore()).reason, 'bad-signature');

  // Changing the path after signing must not verify — otherwise a signature
  // for /v1/cameras would work on /v1/lpr/events.
  const moved = make();
  moved.path = '/v1/lpr/events';
  assert.strictEqual(run(moved, createNonceStore()).reason, 'bad-signature');

  // Changing a query value after signing must not verify.
  const requeried = make({ query: { pageSize: '100' } });
  requeried.query = { pageSize: '1000' };
  assert.strictEqual(run(requeried, createNonceStore()).reason, 'bad-signature');

  // Changing the body after signing must not verify.
  const rebodied = make({ method: 'POST', body: '{"a":1}' });
  rebodied.body = '{"a":2}';
  assert.strictEqual(run(rebodied, createNonceStore()).reason, 'bad-signature');

  // Too old, and too far in the future, are both refused.
  assert.strictEqual(run(make(), createNonceStore(), NOW + SKEW_MS + 1000).reason, 'stale-timestamp');
  assert.strictEqual(run(make(), createNonceStore(), NOW - SKEW_MS - 1000).reason, 'stale-timestamp');

  // Inside the window still works.
  assert.strictEqual(run(make(), createNonceStore(), NOW + SKEW_MS - 1000).ok, true);

  // Replay: the same signed request twice. First passes, second does not.
  const store = createNonceStore();
  const replayed = make({ nonce: 'nonce-replay' });
  assert.strictEqual(run(replayed, store).ok, true);
  assert.strictEqual(run(replayed, store).reason, 'nonce-replay');

  // A different nonce from the same partner is fine.
  assert.strictEqual(run(make({ nonce: 'nonce-2' }), store).ok, true);

  // An expired nonce must not read as a replay — the timestamp check owns
  // freshness past that point, and holding nonces forever is a memory leak.
  const shortStore = createNonceStore(1000);
  assert.strictEqual(shortStore.use('n', NOW), true);
  assert.strictEqual(shortStore.use('n', NOW + 500), false, 'still inside TTL');
  assert.strictEqual(shortStore.use('n', NOW + 2000), true, 'past TTL, reusable');

  // A bad signature must not consume a nonce — otherwise anyone could burn a
  // partner's nonce by guessing.
  const guardStore = createNonceStore();
  run(make({ secret: 'wrong', nonce: 'not-spent' }), guardStore);
  assert.strictEqual(guardStore.size, 0, 'a rejected request must not touch the nonce store');

  // Missing headers are named as such, not reported as a bad signature.
  for (const drop of ['x-ca-key', 'x-ca-nonce', 'x-ca-timestamp', 'x-ca-signature']) {
    const r = make();
    delete r.headers[drop];
    assert.strictEqual(run(r, createNonceStore()).reason, 'missing-headers', `${drop} missing`);
  }

  // A repeated query param is rejected explicitly rather than mis-signed.
  const dup = make();
  dup.query = { a: ['1', '2'] };
  assert.strictEqual(run(dup, createNonceStore()).reason, 'repeated-query-param');

  // A Thai plate as a query value is refused by name, not left to surface as
  // a confusing bad-signature. This is the /v1/lpr/events case, not a corner.
  const thai = make();
  thai.query = { plate: '1\u0e01\u0e02 1234' };
  assert.strictEqual(run(thai, createNonceStore()).reason, 'non-ascii-query');
  assert.strictEqual(run(thai, createNonceStore()).status, 400, 'client error, not auth failure');

  // ASCII values are unaffected.
  assert.strictEqual(run(make({ query: { plate: 'ABC1234' } }), createNonceStore()).ok, true);

  // The verifier must reject a request signed for a different method — a
  // signature captured from a GET must not be replayable as a DELETE.
  const remethoded = make({ method: 'GET' });
  remethoded.method = 'DELETE';
  assert.strictEqual(run(remethoded, createNonceStore()).reason, 'bad-signature');

  console.log('hcpVerify self-check: all assertions passed');
}
