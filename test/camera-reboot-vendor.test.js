// ============================================================
// Vigil Platform — Test: camera reboot vendor dispatch
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const boschPath = require.resolve(path.join(__dirname, '..', 'src', 'helpers', 'boschRcp'));
const calls = [];
require.cache[boschPath] = { id: boschPath, filename: boschPath, loaded: true,
  exports: { rebootBosch: async (cam) => { calls.push(cam); return { ok: true }; } } };
const { supportsReboot, rebootCamera } = require('../src/helpers/cameraReboot');

test('supportsReboot: bosch/dahua/hikvision yes, empty and onvif no (NVR route relies on "" refused)', () => {
  assert.ok(supportsReboot('bosch') && supportsReboot('Dahua') && supportsReboot('hikvision'));
  assert.ok(!supportsReboot('') && !supportsReboot(undefined) && !supportsReboot('onvif'));
});

test('rebootCamera: bosch goes to boschRcp.rebootBosch with the camera creds', async () => {
  const r = await rebootCamera({ ip_address: '10.0.0.9', http_port: 80, username: 'service', password: 'x', vendor: 'bosch' });
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].ip_address, '10.0.0.9');
  assert.strictEqual(calls[0].username, 'service');
});
