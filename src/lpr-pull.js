// ============================================================
// Vigil Platform — LPR Way 1: LAN pull (Hikvision subscribeEvent) — DORMANT
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CS7 Way 1 — a SECOND way to feed the same lpr-core, for the day we must
// REPLACE the on-site Python ANPR puller. That puller holds a long-lived
// POST /ISAPI/Event/notification/subscribeEvent stream on the LAN and gets a
// multipart stream of ANPR frames — each frame is the SAME multipart shape the
// HTTP push (/lpr) delivers. So Way 1's only real job is: open that stream,
// cut it into frames, and hand each frame to ingestLprPush() — the identical
// core Way 2 uses. No second parser, no second DB path.
//
// STATUS: DORMANT and INTENTIONALLY REFUSES TO RUN until verified. startLprPull
// throws unless called with { confirmUnverified: true } — so nobody wires it in
// thinking it works. We have NO pull-capable camera to verify against now: the
// ITC camera rejects our remote subscribeEvent (Device Error over VPN) and on the
// LAN the single subscribeEvent session is held by the existing Python.
//
// What IS verified (self-check below): the stream framer (makeFrameSplitter) and
// the digest header shape. What is NOT verified: the frame → ingestLprPush hop.
// A subscribeEvent stream frame is NOT identical to an HTTP push body — its
// per-frame Content-Type/inner-boundary must be derived from the proven on-site
// Python (hikvision_anpr4_v3_fixed2.2.py: see how it splits + parses each frame)
// and only then can ingestLprPush be fed correctly. Until that is done, onFrame
// passes contentType:'' which ingestLprPush drops (no boundary) — i.e. Way 1 is
// a wired skeleton, NOT a working ingest path. This is 🟡 (decision #146), not 🔵.
//
// ponytail: skeleton, not a port. The Python's reconnect/watchdog/per-camera
// threading is deliberately NOT reimplemented — unverifiable now, would bit-rot.
// Upgrade path when Way 1 goes live: (1) derive the per-frame Content-Type from
// the Python, fixture-test frame→ingestLprPush against a synthetic frame built to
// that structure; (2) port the watchdog/backoff loop around startLprPull; (3)
// verify on a LAN camera whose subscribeEvent slot is free.
// ============================================================
'use strict';

const http   = require('http');
const crypto = require('crypto');
const { ingestLprPush } = require('./lpr-core');

// Hikvision subscribeEvent body: ANPR events + heartbeat, list mode (matches the
// proven on-site Python). Kept here so the upgrade path has the exact payload.
const SUBSCRIBE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<SubscribeEvent version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">' +
  '<heartbeat>30</heartbeat><eventMode>list</eventMode>' +
  '<EventList><Event><type>ANPR</type></Event></EventList>' +
  '</SubscribeEvent>';

// --- pure: split a multipart/mixed STREAM into complete frames ---------------
// The subscribeEvent response is a never-ending multipart stream. We can only
// dispatch a frame once the NEXT boundary has arrived (that proves the frame is
// complete). Returns a sink: feed(chunk) buffers + emits onFrame(frameBuf) per
// complete frame; the trailing partial stays buffered. boundary = the stream's
// top-level multipart boundary (from the response Content-Type).
function makeFrameSplitter(boundary, onFrame) {
  const SEP = Buffer.from('--' + boundary);
  let buf = Buffer.alloc(0);
  return function feed(chunk) {
    buf = Buffer.concat([buf, chunk]);
    let start = buf.indexOf(SEP);
    if (start === -1) { if (buf.length > (1 << 22)) buf = Buffer.alloc(0); return; } // resync guard
    while (true) {
      const next = buf.indexOf(SEP, start + SEP.length);
      if (next === -1) break;                 // frame not yet complete
      let s = start + SEP.length;
      if (buf[s] === 0x0d && buf[s + 1] === 0x0a) s += 2; // skip CRLF after boundary
      let e = next;
      if (buf[e - 2] === 0x0d && buf[e - 1] === 0x0a) e -= 2;
      const frame = buf.slice(s, e);
      if (frame.length) { try { onFrame(frame); } catch (err) { console.error(`[lpr-pull] frame: ${err.message}`); } }
      start = next;
    }
    buf = buf.slice(start);                   // keep the incomplete tail
  };
}

// Minimal RFC2617 MD5 digest header (Hikvision uses qop="auth"). Compact on
// purpose — the heavy lifting (reconnect, multi-camera) is NOT here (see header).
function digestHeader({ user, pass, method, uri, wwwAuth }) {
  const g = (k) => (wwwAuth.match(new RegExp(`${k}="?([^",]+)"?`, 'i')) || [])[1] || '';
  const realm = g('realm'), nonce = g('nonce'), opaque = g('opaque');
  const qop = /auth/i.test(g('qop')) ? 'auth' : '';
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const cnonce = crypto.randomBytes(8).toString('hex'), nc = '00000001';
  const resp = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) h += `, opaque="${opaque}"`;
  return h;
}

// DORMANT entrypoint. Opens ONE subscribeEvent stream to `cam` on the LAN and
// pipes every ANPR frame into the shared core. Single attempt, no reconnect —
// the caller (future) owns the retry loop. Returns the http req (abortable).
function startLprPull({ cam, pool, SNAPSHOT_DIR, loadCameraConfig, forward, confirmUnverified = false }) {
  // Loud dormancy (advisor #1): the frame→ingest contract is unverified, so
  // refuse to run by default. A future caller must opt in explicitly AND first
  // do the frame-contract work described in the header.
  if (!confirmUnverified) {
    throw new Error('[lpr-pull] DORMANT: frame→ingestLprPush contract is UNVERIFIED ' +
      '(per-frame Content-Type/boundary not yet derived from the on-site Python). ' +
      'Derive + fixture-test that hop before enabling; pass { confirmUnverified: true } to override.');
  }
  console.warn(`[lpr-pull] ${cam.camera_id}: running UNVERIFIED — frames will be DROPPED until the per-frame contentType is derived (see file header).`);

  const uri = '/ISAPI/Event/notification/subscribeEvent';
  const onFrame = (frameBuf) => {
    // KNOWN-INCOMPLETE: contentType '' → ingestLprPush drops (no multipart
    // boundary). This is the exact hop to fix when Way 1 goes live — set the
    // real per-frame Content-Type derived from the Python (file header, step 1).
    ingestLprPush({ rawBody: frameBuf, contentType: '', pool, SNAPSHOT_DIR, loadCameraConfig, forward })
      .catch(e => console.error(`[lpr-pull] ingest: ${e.message}`));
  };

  const doRequest = (authHeader) => {
    const opts = {
      host: cam.ip_address, port: cam.http_port || 80, method: 'POST', path: uri,
      headers: { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(SUBSCRIBE_XML) },
    };
    if (authHeader) opts.headers.Authorization = authHeader;
    const req = http.request(opts, (res) => {
      if (res.statusCode === 401 && !authHeader && res.headers['www-authenticate']) {
        res.resume();
        return doRequest(digestHeader({
          user: cam.username, pass: cam.password, method: 'POST', uri,
          wwwAuth: res.headers['www-authenticate'],
        }));
      }
      if (res.statusCode !== 200) { console.error(`[lpr-pull] ${cam.camera_id}: HTTP ${res.statusCode}`); res.resume(); return; }
      const b = (res.headers['content-type'] || '').match(/boundary=([-\w]+)/i);
      if (!b) { console.error(`[lpr-pull] ${cam.camera_id}: no stream boundary`); res.resume(); return; }
      const feed = makeFrameSplitter(b[1], onFrame);
      res.on('data', feed);
      res.on('end', () => console.warn(`[lpr-pull] ${cam.camera_id}: stream ended`));
    });
    req.on('error', (e) => console.error(`[lpr-pull] ${cam.camera_id}: ${e.message}`));
    req.write(SUBSCRIBE_XML);
    req.end();
    return req;
  };

  return doRequest(null);
}

module.exports = { makeFrameSplitter, digestHeader, startLprPull, SUBSCRIBE_XML };

// ------------------------------------------------------------
// Self-check (node src/lpr-pull.js) — verifies the load-bearing piece: a
// multipart STREAM is cut into complete frames, emitted only once the next
// boundary proves completeness, with the partial tail held back.
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const B = 'boundary123';
  const frames = [];
  const feed = makeFrameSplitter(B, (f) => frames.push(f.toString()));

  // stream arrives in awkward chunks split mid-frame and mid-boundary
  feed(Buffer.from(`--${B}\r\nAAA\r\n--${B}\r\nBB`));
  assert.strictEqual(frames.length, 1, 'first frame emitted after 2nd boundary');
  assert.strictEqual(frames[0], 'AAA', 'frame body');
  feed(Buffer.from(`B\r\n--${B}\r\n`));
  assert.strictEqual(frames.length, 2, 'second frame completes across chunks');
  assert.strictEqual(frames[1], 'BBB', 'reassembled across chunk split');
  // last frame still open (no trailing boundary yet) → not emitted
  feed(Buffer.from('CCC'));
  assert.strictEqual(frames.length, 2, 'incomplete tail held back');

  // digest header shape (no live camera): builds a qop=auth response string
  const h = digestHeader({ user: 'admin', pass: 'pw', method: 'POST', uri: '/x',
    wwwAuth: 'Digest realm="r", nonce="n", qop="auth", opaque="o"' });
  assert.ok(/username="admin"/.test(h) && /qop=auth/.test(h) && /response="[a-f0-9]{32}"/.test(h), 'digest header');

  console.log('lpr-pull self-check OK');
}
