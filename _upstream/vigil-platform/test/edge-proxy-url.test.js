// ============================================================
// Vigil Platform — Tests: helpers/edgeProxyBaseUrl
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { edgeProxyBaseUrl } = require('../src/helpers/edgeProxyBaseUrl');

describe('edgeProxyBaseUrl', () => {
  it('builds the per-site tunnel URL from site code + domain', () => {
    assert.equal(edgeProxyBaseUrl('hdy', 'dojojin.tech'), 'https://hdy.dojojin.tech');
  });

  it('produces a different URL for a different site code (no cross-site leakage)', () => {
    const vss = edgeProxyBaseUrl('vss', 'dojojin.tech');
    const hdy = edgeProxyBaseUrl('hdy', 'dojojin.tech');
    assert.notEqual(vss, hdy);
    assert.equal(vss, 'https://vss.dojojin.tech');
  });

  it('respects a custom base domain (white-label)', () => {
    assert.equal(edgeProxyBaseUrl('hdy', 'example.com'), 'https://hdy.example.com');
  });
});
