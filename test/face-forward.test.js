// ============================================================
// Vigil Platform — Tests: face push → CIB relay (F2)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Faces go to CIB on a per-camera /v2/<UUID> that CIB issued — unlike ANPR,
// where every camera shares one path. So the failure this file exists to catch
// is a crossed mapping: camera A's faces arriving under camera B's UUID would
// file a person at the wrong place, which is worse than not sending at all.
//
// The other case pinned here is ordering. Once a camera is repointed at us we
// are CIB's only feed from it, so the relay must run before anything of OURS can
// fail — before the pause check, before parsing, before ingest.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const facePushRoutes = require('../src/routes/face-push');

// Two cameras with different CIB UUIDs, plus one nobody has copied a URL across
// for yet, plus one paused for maintenance.
const CAMS = [
  { camera_id: 'C10-TCC-SB-04', face_push_token: 'tok-A',
    face_forward_url: 'http://202.124.201.105:10001/v2/019e49ed-3e00-7b96-961b-8668c5d9e95e' },
  { camera_id: 'C19-PT-SB-09', face_push_token: 'tok-B',
    face_forward_url: 'http://202.124.201.105:10001/v2/019e49e4-5213-7615-85d8-5e62b9f9daf2' },
  { camera_id: 'C80-PT-SB-33', face_push_token: 'tok-C' },              // no target
  { camera_id: 'C30-CTL-SB-12', face_push_token: 'tok-D', paused: true,
    face_forward_url: 'http://202.124.201.105:10001/v2/019e49ec-8464-7310-8df9-961b853ff87f' },
];

// Record what the relay would send instead of opening a socket. Patched before
// the route is mounted so the forwarder picks up the stub.
const posted = [];
require('node:http').request = (opts) => {
  posted.push({ host: opts.hostname, port: String(opts.port), path: opts.path });
  return { on() { return this; }, write() {}, end() {}, destroy() {}, setTimeout() {} };
};

let gate, handler;
const app = {
  post(p, ...h) { if (p === '/face-push/:token') { gate = h[0]; handler = h[h.length - 1]; } },
  get() {}, use() {},
};
facePushRoutes(app, { query: async () => ({ rows: [] }) }, {
  SNAPSHOT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'facefwd-')),
  loadCameraConfig: () => ({ cameras: CAMS }),
});

// Drive the route the way express would: the gate resolves the camera, then the
// handler runs. An unknown token never reaches the handler at all.
async function push(token, body, contentType = 'multipart/form-data; boundary=abc') {
  posted.length = 0;
  const req = { params: { token }, headers: { 'content-type': contentType },
                body: Buffer.from(body), resume() {} };
  const res = { status() { return this; }, end() {} };
  let next = false;
  gate(req, res, () => { next = true; });
  if (next) await handler(req, res);
}

describe('face → CIB relay', () => {
  it('sends a camera to ITS OWN CIB path, not another camera\'s', async () => {
    await push('tok-A', 'x');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].host, '202.124.201.105');
    assert.equal(posted[0].port, '10001');
    assert.equal(posted[0].path, '/v2/019e49ed-3e00-7b96-961b-8668c5d9e95e');
  });

  it('a different camera goes to a different UUID — no crossing', async () => {
    await push('tok-B', 'x');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].path, '/v2/019e49e4-5213-7615-85d8-5e62b9f9daf2');
    assert.notEqual(posted[0].path, '/v2/019e49ed-3e00-7b96-961b-8668c5d9e95e');
  });

  it('relays a body it cannot parse — that is CIB\'s to judge, not ours', async () => {
    await push('tok-A', 'not multipart at all', 'text/plain');
    assert.equal(posted.length, 1, 'a missing boundary stops OUR ingest, never the relay');
  });

  it('relays even when the camera is paused for maintenance', async () => {
    await push('tok-D', 'x');
    assert.equal(posted.length, 1, 'pausing is our maintenance, not a reason to cut CIB off');
  });

  it('sends nothing when no CIB URL has been copied across yet', async () => {
    await push('tok-C', 'x');
    assert.equal(posted.length, 0, 'opt-in: never guess a destination for faces');
  });

  it('an unknown token reaches neither ingest nor relay', async () => {
    await push('tok-NOPE', 'x');
    assert.equal(posted.length, 0);
  });
});
