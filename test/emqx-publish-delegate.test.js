// ============================================================
// Vigil Platform — Tests: emqxPublish.js delegates to brokerAdmin unchanged
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// 6 call sites (routes/cameras.js ×2, routes/storage.js ×2, routes/health.js
// ×3, routes/cameras-probe.js ×1) import this module by name and call it with
// (topic, payloadObj, {qos, retain}) — none of them may need to change.
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const emqxPublish = require('../src/helpers/emqxPublish');
const brokerAdmin = require('../src/helpers/brokerAdmin');

test('emqxPublish is still a function exported by that name/path', () => {
  assert.equal(typeof emqxPublish, 'function');
  assert.equal(emqxPublish.name, 'emqxPublish');
});

test('emqxPublish(topic, obj, opts) delegates to brokerAdmin.publish with the same arguments, defaults intact', async (t) => {
  const calls = [];
  t.mock.method(brokerAdmin, 'publish', async (topic, obj, opts) => { calls.push({ topic, obj, opts }); });

  await emqxPublish('projects/hdy/_config/scan-nvr', { at: 123 });
  assert.deepEqual(calls[0], { topic: 'projects/hdy/_config/scan-nvr', obj: { at: 123 }, opts: { qos: 1, retain: false } });

  await emqxPublish('projects/hdy/_config/cameras', { v: 1 }, { qos: 1, retain: true });
  assert.deepEqual(calls[1].opts, { qos: 1, retain: true });
});
