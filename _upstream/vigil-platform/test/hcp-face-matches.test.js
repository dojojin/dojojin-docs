// ============================================================
// Vigil Platform — Tests: hcp-face-matches live helpers (pure)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Only _dedupKey + _pruneSeen — both pure. The module's CLI/PM2 entry is
// guarded by `require.main === module`, so requiring it here runs no HCP init.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _dedupKey, _pruneSeen } = require('../src/ingesters/hcp-face-matches');

describe('_dedupKey', () => {
  it('matches the stored hcp_dedup_key tuple: faceTime|personId|cameraIndexCode', () => {
    const m = { faceTime: '2026-08-10T17:34:27+07:00',
      personInfo: { personId: 'P123' }, cameraInfo: { cameraIndexCode: 'C57' } };
    assert.equal(_dedupKey(m), '2026-08-10T17:34:27+07:00|P123|C57');
  });

  it('missing personId → placeholder "-"', () => {
    const m = { faceTime: 't1', personInfo: {}, cameraInfo: { cameraIndexCode: 'C1' } };
    assert.equal(_dedupKey(m), 't1|-|C1');
  });

  it('missing personInfo/cameraInfo objects do not throw', () => {
    assert.equal(_dedupKey({ faceTime: 't2' }), 't2|-|undefined');
  });
});

describe('_pruneSeen', () => {
  it('drops keys older than lookback (+60s slack), keeps recent', () => {
    const now = 10_000_000;
    const lookback = 15 * 60 * 1000; // 900s
    const seen = new Map([
      ['old',   now - lookback - 120_000], // beyond lookback+slack → drop
      ['edge',  now - lookback - 30_000],  // within the 60s slack → keep
      ['fresh', now - 5_000],              // recent → keep
    ]);
    _pruneSeen(seen, now, lookback);
    assert.equal(seen.has('old'), false);
    assert.equal(seen.has('edge'), true);
    assert.equal(seen.has('fresh'), true);
  });

  it('returns the same map instance (mutates in place)', () => {
    const seen = new Map([['a', 0]]);
    assert.equal(_pruneSeen(seen, 10_000_000, 1000), seen);
    assert.equal(seen.size, 0);
  });
});
