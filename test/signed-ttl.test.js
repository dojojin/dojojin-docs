// ============================================================
// Vigil Platform — ttlSecFromHours (signed image link TTL from settings)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ttlSecFromHours } = require('../src/helpers/signedImage');

test('numeric hours inside 1..720 convert to seconds', () => {
  assert.equal(ttlSecFromHours(48), 172800);
  assert.equal(ttlSecFromHours('168'), 604800);
  assert.equal(ttlSecFromHours('720'), 2592000);
  assert.equal(ttlSecFromHours(1), 3600);
});

test('out-of-range or non-numeric values fall back to 48 h', () => {
  for (const v of [0, 721, -5, 'abc', '', null, undefined, NaN]) {
    assert.equal(ttlSecFromHours(v), 172800, `value ${String(v)}`);
  }
});

test('custom fallback is honoured', () => {
  assert.equal(ttlSecFromHours('x', 3600), 3600);
  assert.equal(ttlSecFromHours(24, 3600), 86400);
});
