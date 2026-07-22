// ============================================================
// Vigil Platform — Tests: Hikvision FAS push_only camera resolution (IM3)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { _matchPushCam } = require('../src/ingesters/hikvision-isapi');

const CAMS = [
  { camera_id: 'PULL01', ip_address: '192.168.10.55',  vendor: 'hikvision' },                 // pull (no push_only)
  { camera_id: 'HKT01',  ip_address: '10.4.100.51',    vendor: 'hikvision', push_only: true },// push, cross-site
  { camera_id: 'PAUSED', ip_address: '10.4.100.52',    vendor: 'hikvision', push_only: true, paused: true },
  { camera_id: 'DAHUA',  ip_address: '10.4.100.53',    vendor: 'dahua',     push_only: true },
];

describe('IM3 _matchPushCam', () => {
  it('resolves a push_only Hikvision cam by IP (the cross-site case)', () => {
    assert.equal(_matchPushCam(CAMS, '10.4.100.51')?.camera_id, 'HKT01');
  });
  it('does NOT match a pull cam (those resolve via _activeCams, not here)', () => {
    assert.equal(_matchPushCam(CAMS, '192.168.10.55'), null);
  });
  it('ignores a paused push_only cam', () => {
    assert.equal(_matchPushCam(CAMS, '10.4.100.52'), null);
  });
  it('ignores a non-Hikvision push_only cam', () => {
    assert.equal(_matchPushCam(CAMS, '10.4.100.53'), null);
  });
  it('returns null on unknown IP and tolerates empty/missing list', () => {
    assert.equal(_matchPushCam(CAMS, '1.2.3.4'), null);
    assert.equal(_matchPushCam(undefined, '10.4.100.51'), null);
  });
});
