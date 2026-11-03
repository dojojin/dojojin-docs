// ============================================================
// Vigil Platform — Tests: per-recipient LPR scope (Settings › LINE)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Runs the real _lprScopeRow / rcpScopeToggle out of dashboard/page-alerts.js
// against the real selectRecipients out of src/helpers/lprLineAlert.js, so a
// change to either side breaks here rather than in production. The case that
// matters most is the empty list: three recipients were configured before this
// feature existed, and "no chips ticked" has to keep meaning "receives
// everything" or they all go silent the day it ships.
// ============================================================
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { selectRecipients } = require('../src/helpers/lprLineAlert');

// page-alerts.js is a browser script, not a module — load it into a context
// carrying just the globals it touches at parse time.
const ctx = {
  escapeHtml: s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  I18N: { t: (k, f) => f || k },
  document: { getElementById: () => null },
  fetch: async () => ({ ok: false }),
  console, API: '',
};
ctx.window = ctx;

let scopeRow, toggle, sitesOf;

before(() => {
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../dashboard/page-alerts.js'), 'utf8'),
    ctx, { filename: 'page-alerts.js' });
  vm.runInContext(`
    _rcpSites  = [{ code: 'hkt', name: 'ภูเก็ต' }, { code: 'hdy', name: 'หาดใหญ่' }, { code: 'vss', name: 'VSS' }];
    _rcpGroups = [{ id: 'g1', name: 'รถผู้ต้องสงสัย' }, { id: 'g2', name: 'Blacklist' }];
    lineConfigCache = { recipients: [{ id: 'U1', enabled: true }] };
    renderRecipients = () => {};
  `, ctx);
  scopeRow = (r, i = 0) => vm.runInContext('_lprScopeRow', ctx)(r, i);
  toggle   = (field, val, idx = 0) =>
    vm.runInContext('rcpScopeToggle', ctx)({ dataset: { idx: String(idx), field, val } });
  // Arrays built inside the vm are cross-realm; copy out before comparing.
  sitesOf  = () => [...vm.runInContext('lineConfigCache', ctx).recipients[0].lpr_sites];
});

// Which chips came back lit, by value, for one axis.
const lit = (html, field) =>
  [...html.matchAll(/<button class="rcp-chip on"[^>]*data-field="([^"]+)"[^>]*data-val="([^"]*)"/g)]
    .filter(m => m[1] === field).map(m => m[2]);

describe('_lprScopeRow — what the chips show', () => {
  it('a recipient with no scope keys lights "all" on both axes', () => {
    const h = scopeRow({ id: 'U1', enabled: true });
    assert.deepEqual(lit(h, 'lpr_sites'), ['']);
    assert.deepEqual(lit(h, 'lpr_groups'), ['']);
  });

  it('offers every known site and group', () => {
    const h = scopeRow({});
    assert.ok(h.includes('ภูเก็ต') && h.includes('Blacklist'));
  });

  it('an explicit list lights exactly those, and "all" goes dark', () => {
    const h = scopeRow({ lpr_sites: ['hdy'], lpr_groups: ['g2'] });
    assert.deepEqual(lit(h, 'lpr_sites'), ['hdy']);
    assert.deepEqual(lit(h, 'lpr_groups'), ['g2']);
  });

  it('escapes site names and codes', () => {
    vm.runInContext(`_rcpSites = [{ code: 'x"><img src=1>', name: '<b>hi</b>' }];`, ctx);
    const h = scopeRow({ lpr_sites: [] });
    assert.ok(!h.includes('<img src=1>'));
    assert.ok(!h.includes('<b>hi</b>'));
    vm.runInContext(`_rcpSites = [{ code: 'hkt' }, { code: 'hdy' }, { code: 'vss' }];`, ctx);
  });

  it('renders nothing at all when neither list has loaded', () => {
    vm.runInContext('_rcpSites = []; _rcpGroups = [];', ctx);
    assert.equal(scopeRow({ lpr_sites: ['hkt'] }), '');
    vm.runInContext(`
      _rcpSites  = [{ code: 'hkt' }, { code: 'hdy' }, { code: 'vss' }];
      _rcpGroups = [{ id: 'g1' }, { id: 'g2' }];`, ctx);
  });
});

describe('rcpScopeToggle — what a click writes', () => {
  it('adds, accumulates, and removes on a second click', () => {
    toggle('lpr_sites', 'hkt');
    assert.deepEqual(sitesOf(), ['hkt']);
    toggle('lpr_sites', 'vss');
    assert.deepEqual(sitesOf(), ['hkt', 'vss']);
    toggle('lpr_sites', 'hkt');
    assert.deepEqual(sitesOf(), ['vss']);
  });

  it('"all" clears the list rather than storing a magic member', () => {
    toggle('lpr_sites', '');
    assert.deepEqual(sitesOf(), []);
    assert.deepEqual(lit(scopeRow({ lpr_sites: sitesOf() }), 'lpr_sites'), ['']);
  });
});

describe('selectRecipients — an empty list still means everything', () => {
  const R = [
    { id: 'legacy',  enabled: true },                                 // configured before this feature
    { id: 'cleared', enabled: true, lpr_sites: [], lpr_groups: [] },  // ticked then unticked in the UI
    { id: 'scoped',  enabled: true, lpr_sites: ['hkt'], lpr_groups: ['g1'] },
  ];
  const ids = o => selectRecipients(R, o).map(r => r.id);

  it('a hit outside the scope still reaches everyone unscoped', () =>
    assert.deepEqual(ids({ siteCode: 'hdy', groupId: 'g2' }), ['legacy', 'cleared']));

  it('a hit inside the scope reaches the scoped recipient too', () =>
    assert.deepEqual(ids({ siteCode: 'hkt', groupId: 'g1' }), ['legacy', 'cleared', 'scoped']));

  it('both axes have to match — right site, wrong group is a no', () =>
    assert.deepEqual(ids({ siteCode: 'hkt', groupId: 'g2' }), ['legacy', 'cleared']));

  it('a camera with no site reaches only the unscoped', () =>
    assert.deepEqual(ids({ siteCode: null, groupId: 'g1' }), ['legacy', 'cleared']));
});

// ── Short-plate mute boundary ────────────────────────────────
// A plate of four characters or fewer cannot survive one OCR error. Live
// evidence, 2026-08-04: the roster's 'กร6' (Phuket) matched twice in a week — a
// white SUV and a black Ford — while the wanted vehicle is a black Alphard, and
// the plate+province rule could not catch either because the province matched
// too. 'ขจน3/6/8/9' are worse: one character apart, same province, split across
// two groups, so a misread alerts the WRONG group.
//
// The existing rows were muted with `length <= 4`; new bridge inserts use this.
// The two have to agree exactly, which is what this pins.
const { bridgeNotifyLine, SHORT_PLATE_MAX } = require('../src/helpers/blacklistBridge');

describe('bridgeNotifyLine — new roster plates arrive muted when too short', () => {
  it('mutes at and below the boundary', () => {
    assert.equal(SHORT_PLATE_MAX, 4, 'agrees with the one-time UPDATE (length <= 4)');
    for (const p of ['กร6', '736', 'ขจน3', 'ขจน9', '3กด']) {
      assert.equal(bridgeNotifyLine(p), false, `${p} (${p.length}) must arrive muted`);
    }
  });

  it('leaves normal plates alone', () => {
    for (const p of ['2กจ3194', 'กท3779', '1กข1234', 'ขจน31']) {
      assert.equal(bridgeNotifyLine(p), true, `${p} (${p.length}) must still alert`);
    }
  });

  it('does not throw on a missing plate', () => {
    assert.equal(bridgeNotifyLine(null), false);
    assert.equal(bridgeNotifyLine(''), false);
  });
});
