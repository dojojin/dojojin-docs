// ============================================================
// Vigil Platform — Tests: edge_status.camera_broker_url (migration 248)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// validCameraBrokerUrl lives in helpers/edgeCameraBrokerUrl.js (not inline in
// mqtt-subscriber.js) specifically so it's require-safe: mqtt-subscriber.js
// calls require('./singleton')('mqtt-subscriber') at module scope and opens
// a real pg.Pool, so it can't be require()'d directly in a test (same
// reasoning as test/mqtt-heartbeat-batching.test.js).
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validCameraBrokerUrl, brokerHostname } = require('../src/helpers/edgeCameraBrokerUrl');

describe('validCameraBrokerUrl', () => {
  it('accepts mqtt:// with host:port', () => {
    assert.equal(validCameraBrokerUrl('mqtt://172.29.51.52:1883'), 'mqtt://172.29.51.52:1883');
  });

  it('accepts mqtts:// with a hostname, no port', () => {
    assert.equal(validCameraBrokerUrl('mqtts://edge.local'), 'mqtts://edge.local');
  });

  it('rejects a non-mqtt scheme', () => {
    assert.equal(validCameraBrokerUrl('http://x'), null);
  });

  it('rejects a space in the host', () => {
    assert.equal(validCameraBrokerUrl('mqtt://a b'), null);
  });

  it('rejects a path (e.g. traversal)', () => {
    assert.equal(validCameraBrokerUrl('mqtt://x/../'), null);
  });

  it('rejects non-string input', () => {
    assert.equal(validCameraBrokerUrl(null), null);
    assert.equal(validCameraBrokerUrl(undefined), null);
    assert.equal(validCameraBrokerUrl(1883), null);
    assert.equal(validCameraBrokerUrl({ url: 'mqtt://x' }), null);
  });

  it('rejects a string over 200 chars', () => {
    const long = 'mqtt://' + 'a'.repeat(200) + '.local';
    assert.ok(long.length > 200);
    assert.equal(validCameraBrokerUrl(long), null);
  });
});

// routes/cameras.js _cameraBrokerHosts resolves a Map<site_id, hostname> via
// this same brokerHostname() — a row somehow past migration 248's validator
// (e.g. hand-edited in the DB) must be skipped, not thrown out of the request.
describe('brokerHostname', () => {
  it('extracts the host from a validated mqtt:// URL, dropping the port', () => {
    assert.equal(brokerHostname('mqtt://172.29.51.52:1883'), '172.29.51.52');
  });

  it('extracts the host from a validated mqtts:// URL with no port', () => {
    assert.equal(brokerHostname('mqtts://edge.local'), 'edge.local');
  });

  it('returns null instead of throwing on an unparseable value', () => {
    assert.equal(brokerHostname('not a url'), null);
    assert.equal(brokerHostname(''), null);
  });
});

// ── pin the real wiring — fails loudly if mqtt-subscriber.js drifts ──
describe('source-text pin (src/mqtt-subscriber.js recordEdgeHeartbeat)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'mqtt-subscriber.js'), 'utf8');

  it('validates camera_broker_url before it ever reaches the query', () => {
    assert.match(src, /const cameraBrokerUrl = validCameraBrokerUrl\(camera_broker_url\);/);
  });

  it('COALESCEs camera_broker_url so an older edge build cannot erase a known value', () => {
    assert.match(src, /camera_broker_url = COALESCE\(EXCLUDED\.camera_broker_url, edge_status\.camera_broker_url\)/);
  });
});
