// ============================================================
// Vigil Platform — Helper: HikCentral Professional OpenAPI signer
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// AK/SK HMAC-SHA256 request signing for the Artemis gateway (HCP OpenAPI
// V3.0.1 §3.2). Not the ISAPI digest auth every other ingester uses — HCP's
// gateway signs each request individually and there is no session to hold.
//
// The string being signed is positional, and a field whose header is NOT sent
// contributes NO line — not an empty one. Getting that backwards yields a
// signature the gateway rejects as code 68 with no hint as to which field was
// off, which is exactly what happened here (see the note by the build below):
//
//   METHOD \n Accept \n [Content-MD5 \n] Content-Type \n [Date \n]
//   <each signed header, "lowercased-name:value\n", sorted by name>
//   <path, with query params sorted if any>
//
// Bracketed lines appear only when we actually send that header. We always send
// Accept and Content-Type; we send Content-MD5 only with a body; we never send
// Date. Vendor spec: Developer Guide V3.0.1 §3.2, p.28-29 —
// docs/vendor/hikvision/HCP_OpenAPI.pdf, which is in this repo. Read it before
// changing anything here.
//
// X-Ca-Signature-Headers tells the gateway which headers went into that block;
// it must list exactly the same names, lowercase and comma-joined in the same
// sorted order, or the gateway rebuilds a different string.
//
// Pure function, no I/O — src/hcp-client.js does the request.
// ============================================================
'use strict';

const crypto = require('crypto');

// Headers the gateway expects to be part of the signature. Kept as a constant
// because the list has to match X-Ca-Signature-Headers exactly; deriving one
// from the other by hand is how these drift.
const SIGNED = ['x-ca-key', 'x-ca-nonce', 'x-ca-timestamp'];

/**
 * @param {object} o
 * @param {string} o.method       'POST' | 'GET'
 * @param {string} o.path         '/artemis/api/...' — path only, no host
 * @param {object} [o.query]      query params; sorted into the path for signing
 * @param {string} [o.body]       raw request body, already serialised
 * @param {string} o.appKey       Integration Partner Key
 * @param {string} o.appSecret    Integration Partner Secret
 * @param {string} [o.nonce]      injectable for the self-test
 * @param {number} [o.timestamp]  injectable for the self-test (ms)
 * @returns {{headers: object, stringToSign: string, path: string}}
 */
function signRequest(o) {
  const method = String(o.method || 'POST').toUpperCase();
  const accept = 'application/json';
  const contentType = 'application/json';
  const body = o.body || '';
  // Content-MD5 is only signed when there is a body. An empty body must leave
  // the field empty rather than send the MD5 of the empty string — those are
  // different strings to sign and the gateway builds the former.
  const contentMD5 = body ? crypto.createHash('md5').update(body, 'utf8').digest('base64') : '';

  const nonce = o.nonce || crypto.randomUUID();
  const timestamp = String(o.timestamp || Date.now());

  // Query params are sorted by name, because the gateway sorts them before
  // rebuilding the string. Sending them unsorted signs a path the server
  // never reconstructs.
  const q = o.query && Object.keys(o.query).length
    ? '?' + Object.keys(o.query).sort().map(k => `${k}=${o.query[k]}`).join('&')
    : '';
  const path = o.path + q;

  const values = { 'x-ca-key': o.appKey, 'x-ca-nonce': nonce, 'x-ca-timestamp': timestamp };
  const headerBlock = SIGNED.map(h => `${h}:${values[h]}\n`).join('');

  // A header that is NOT sent contributes no line at all — not an empty one.
  // Developer Guide V3.0.1 §3.2, p.29: "Each header should end with \n, but if
  // the Accept, Content-MD5, Content-Type, or Date header does not exist, \n is
  // not required."
  //
  // The first version of this file read that as "empty fields still contribute
  // their newline" and emitted a blank line for Date, which we never send, plus
  // a blank line for Content-MD5 on a bodiless request. Against the real gateway
  // at 10.0.10.9 (HikCentral Professional V3.0.1.DZP20260313043.0) every request
  // came back {"code":"68","msg":"Signature authentication Failed"} — 96 layout
  // permutations of it, all identical, because the extra newline was in all of
  // them. Dropping the Date line returned {"code":"0"} on the first try.
  //
  // We do always send Accept and Content-Type, so those two lines are constant.
  const lines = [method, accept];
  if (contentMD5) lines.push(contentMD5);   // no body => no header => no line
  lines.push(contentType);
  // Date is never sent: X-Ca-Timestamp carries the time and is the field the
  // gateway checks for replay. So no Date line either.
  const stringToSign = `${lines.join('\n')}\n${headerBlock}${path}`;

  const signature = crypto.createHmac('sha256', o.appSecret)
    .update(stringToSign, 'utf8').digest('base64');

  const headers = {
    'Accept': accept,
    'Content-Type': contentType,
    'X-Ca-Key': o.appKey,
    'X-Ca-Nonce': nonce,
    'X-Ca-Timestamp': timestamp,
    'X-Ca-Signature': signature,
    'X-Ca-Signature-Headers': SIGNED.join(','),
  };
  if (contentMD5) headers['Content-MD5'] = contentMD5;

  return { headers, stringToSign, path };
}

module.exports = { signRequest };

if (require.main === module) {
  const assert = require('assert');
  const FIXED = { appKey: 'testkey', appSecret: 'testsecret', nonce: 'n-1', timestamp: 1700000000000 };

  // The layout is the whole point of this file, so assert the exact string.
  const a = signRequest({ method: 'POST', path: '/artemis/api/x', body: '{"a":1}', ...FIXED });
  assert.strictEqual(a.stringToSign,
    'POST\napplication/json\n' + crypto.createHash('md5').update('{"a":1}').digest('base64') +
    '\napplication/json\nx-ca-key:testkey\nx-ca-nonce:n-1\nx-ca-timestamp:1700000000000\n/artemis/api/x');

  // No body => no Content-MD5 header => no Content-MD5 LINE. §3.2 p.29 again:
  // a header that does not exist contributes nothing, not an empty line. This
  // is the assertion that would have caught the bug that cost 96 live probes.
  const b = signRequest({ method: 'POST', path: '/artemis/api/x', ...FIXED });
  assert.strictEqual(b.stringToSign,
    'POST\napplication/json\napplication/json\nx-ca-key:testkey\nx-ca-nonce:n-1\nx-ca-timestamp:1700000000000\n/artemis/api/x');
  assert.ok(!('Content-MD5' in b.headers));

  // And never a blank line anywhere — the shape the vendor rejects.
  assert.ok(!a.stringToSign.includes('\n\n'), 'no empty line may appear in the signed string');
  assert.ok(!b.stringToSign.includes('\n\n'));
  assert.notStrictEqual(a.headers['X-Ca-Signature'], b.headers['X-Ca-Signature']);

  // Query params are sorted, so the same set in a different order signs the same.
  const q1 = signRequest({ path: '/p', query: { b: 2, a: 1 }, ...FIXED });
  const q2 = signRequest({ path: '/p', query: { a: 1, b: 2 }, ...FIXED });
  assert.strictEqual(q1.stringToSign, q2.stringToSign);
  assert.strictEqual(q1.path, '/p?a=1&b=2');

  // Signature-Headers must name exactly what the block contains, in order.
  assert.strictEqual(a.headers['X-Ca-Signature-Headers'], 'x-ca-key,x-ca-nonce,x-ca-timestamp');
  for (const h of a.headers['X-Ca-Signature-Headers'].split(',')) {
    assert.ok(a.stringToSign.includes(`\n${h}:`), `${h} named but not signed`);
  }

  // A different secret must not produce the same signature for the same request.
  const other = signRequest({ method: 'POST', path: '/artemis/api/x', body: '{"a":1}',
    ...FIXED, appSecret: 'testsecre7' });
  assert.notStrictEqual(a.headers['X-Ca-Signature'], other.headers['X-Ca-Signature']);

  // Nonce must differ per call when not injected — it is the replay guard.
  assert.notStrictEqual(
    signRequest({ path: '/p', appKey: 'k', appSecret: 's' }).headers['X-Ca-Nonce'],
    signRequest({ path: '/p', appKey: 'k', appSecret: 's' }).headers['X-Ca-Nonce']);

  console.log('hcpSign self-check: all assertions passed');
}
