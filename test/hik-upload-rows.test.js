// ============================================================
// Vigil Platform — Tests: camera push-destination rows
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// A Hikvision traffic camera keeps ten upload slots. An SDK client that
// reconnects every few days burns one per session, so C10-KAR-SB-04 shipped
// eight dead entries for the same 10.5.10.4 and the two destinations that
// actually matter — the old CIB feed and our edge — were buried in the pile.
//
// The fixture below is that camera's real slot table (2026-08-05). These tests
// pin the two properties the panel depends on: a host's finished sessions
// collapse into one honest line, and anything still uploading is listed first.
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// page-cameras.js is a browser script; give it just enough to parse.
const ctx = {
  console, escapeHtml: String, I18N: { t: (k, f) => f || k },
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], addEventListener() {} },
  fetch: async () => ({ ok: false }), API: '', cameras: [], VENDOR_LABEL_CD: {},
  setTimeout, setInterval, clearInterval, addEventListener() {},
  localStorage: { getItem: () => null, setItem() {} },
  Chart: function () {}, ol: {}, location: { origin: '' }, navigator: { language: 'th' },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dashboard/page-cameras.js'), 'utf8'),
  ctx, { filename: 'page-cameras.js' });
const groupUploads = vm.runInContext('groupUploads', ctx);

// Verbatim shape from cameras.sd_detail_json, trimmed to the fields used here.
const REAL = [
  { id: '1',  ip: '10.0.10.50',      port: '3003',  ok: 159851, total: 160612, rate: 99.53, avg_ms: 46,  status: 'Uploading' },
  { id: '2',  ip: '10.5.10.4',       port: '55998', ok: 8455,   total: 8455,   rate: 100,   avg_ms: 18,  status: 'Uploading' },
  { id: '3',  ip: '202.124.201.106', port: '10001', ok: 382478, total: 393864, rate: 97.11, avg_ms: 336, status: 'End' },
  { id: '4',  ip: '10.5.10.4',       port: '33126', ok: 22790,  total: 22791,  rate: 100,   avg_ms: 17,  status: 'End' },
  { id: '5',  ip: '10.5.10.4',       port: '46508', ok: 77993,  total: 77994,  rate: 100,   avg_ms: 20,  status: 'End' },
  { id: '6',  ip: '10.5.10.4',       port: '56278', ok: 104341, total: 104342, rate: 100,   avg_ms: 15,  status: 'End' },
  { id: '7',  ip: '10.5.10.4',       port: '60348', ok: 47097,  total: 47098,  rate: 100,   avg_ms: 14,  status: 'End' },
  { id: '8',  ip: '10.5.10.4',       port: '50314', ok: 82502,  total: 82503,  rate: 100,   avg_ms: 13,  status: 'End' },
  { id: '9',  ip: '10.5.10.4',       port: '45486', ok: 43428,  total: 43429,  rate: 100,   avg_ms: 13,  status: 'End' },
  { id: '10', ip: '10.5.10.4',       port: '49734', ok: 158915, total: 158916, rate: 100,   avg_ms: 16,  status: 'End' },
];

describe('groupUploads', () => {
  it('turns ten rows into four, keeping every delivery counted', () => {
    const g = groupUploads(REAL);
    assert.equal(g.length, 4, '2 live + CIB + one merged group for 10.5.10.4');
    assert.equal(g.reduce((n, u) => n + u.total, 0),
                 REAL.reduce((n, u) => n + u.total, 0),
                 'collapsing rows must not lose deliveries');
  });

  it('lists what is still uploading before what has stopped', () => {
    const g = groupUploads(REAL);
    assert.deepEqual([...g.slice(0, 2).map(u => u.ip)], ['10.0.10.50', '10.5.10.4']);
    assert.ok(g.slice(0, 2).every(u => !u.dead));
    assert.ok(g.slice(2).every(u => u.dead));
    // The live edge feed outranks a stopped destination with twice the volume:
    // "where does this camera send now" is the question being answered.
    assert.equal(g[0].ip, '10.0.10.50');
    // The dead half is ordered by volume too, and once merged the seven SDK
    // sessions (537,073) genuinely outweigh the retired CIB feed (393,864).
    assert.deepEqual([...g.slice(2).map(u => u.ip)], ['10.5.10.4', '202.124.201.106']);
  });

  it('merges only the dead sessions of a host, never the live one', () => {
    const g = groupUploads(REAL);
    const liveSdk = g.find(u => u.ip === '10.5.10.4' && !u.dead);
    const deadSdk = g.find(u => u.ip === '10.5.10.4' && u.dead);
    assert.equal(liveSdk.sessions, 1, 'a running session stands alone');
    assert.equal(liveSdk.port, '55998', 'and keeps its port');
    assert.equal(deadSdk.sessions, 7);
    assert.equal(deadSdk.total, 537073);
    assert.equal(deadSdk.port, null, 'one port cannot identify seven sessions');
    assert.equal(deadSdk.avg_ms, 20, 'worst of the merged latencies, not an average of averages');
  });

  it('recomputes the success rate over the merged total', () => {
    const g = groupUploads([
      { ip: '10.9.9.9', port: '1', ok: 50,  total: 100, rate: 50,  status: 'End' },
      { ip: '10.9.9.9', port: '2', ok: 900, total: 900, rate: 100, status: 'End' },
    ]);
    assert.equal(g.length, 1);
    // Not (50+100)/2 = 75. A big clean session must outweigh a small bad one.
    assert.equal(g[0].rate, 95);
  });

  it('leaves an already-clean list alone', () => {
    const one = [{ ip: '10.0.10.50', port: '3003', ok: 5, total: 5, rate: 100, avg_ms: 9, status: 'Uploading' }];
    assert.deepEqual([...groupUploads(one).map(u => u.ip)], ['10.0.10.50']);
    assert.equal(groupUploads([]).length, 0);
  });
});
