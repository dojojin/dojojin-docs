// ============================================================
// Vigil Platform — test: UI ลบไซต์ (S5) — source-level
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rd = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SYS = rd('dashboard', 'page-system.js');
const I18N = rd('dashboard', 'i18n.js');
const BIND = rd('dashboard', 'page-nav-bindings.js');
const fnSrc = (name) => { const i = SYS.indexOf(`function ${name}(`); return SYS.slice(i, SYS.indexOf('\n}\n', i) + 2); };

describe('page-system.js — site purge', () => {
  it('every sys.purge* key used exists in both th and en', () => {
    const keys = [...new Set(SYS.match(/'sys\.purge\w+'/g).map((k) => k.slice(1, -1)))];
    assert.ok(keys.length >= 30);
    for (const k of keys) assert.equal(I18N.split(`'${k}':`).length - 1, 2, `${k} ต้องมี 2 ที่ (th+en)`);
  });
  it('wired through data-action / data-input, no inline handlers', () => {
    assert.doesNotMatch(SYS, /on(click|input)\s*=/i);
    for (const a of ['sitePurgeOpen', 'sitePurgeConfirm', 'sitePurgeClose']) {
      assert.ok(SYS.includes(`data-action="${a}"`), `ไม่มีปุ่ม ${a}`);
      assert.match(BIND, new RegExp(`${a}:\\s+\\(`), `ไม่ได้ bind ${a}`);
    }
    assert.ok(SYS.includes('data-input="sitePurgeInput"'));
    assert.match(BIND, /sitePurgeInput:\s+\(/);
  });
  it('purge button only for non-main sites in maintenance/archived; plain delete stays for empty active sites', () => {
    assert.match(SYS, /s\.code !== 'main' && inMaint\s*\n?\s*\? `<button class="btn btn-danger"[^`]*sitePurgeOpen/);
    assert.match(SYS, /: canDelete \? `<button[^`]*data-action="deleteSite"/);
  });
  it('calls the purge endpoints', () => {
    assert.match(SYS, /\/api\/sites\/\$\{el\.dataset\.id\}\/purge-plan/);
    assert.match(SYS, /\/api\/sites\/\$\{el\.dataset\.id\}\/purge`/);
    assert.match(SYS, /\/api\/sites\/purge-job/);
    assert.match(SYS, /setInterval\(_sitePurgePoll, 3000\)/);
  });
  it('confirm button enabled only on exact code match', () => {
    const btn = { disabled: true };
    const ctx = { document: { getElementById: () => btn }, _sitePurgeCode: 'rmv' };
    vm.runInNewContext(`var _sitePurgeCode = 'rmv';\n${fnSrc('sitePurgeInput')}\nthis.f = sitePurgeInput;`, ctx);
    for (const [v, en] of [['rm', false], ['RMV', false], ['rmv ', false], ['rmv', true]]) {
      ctx.f({ value: v });
      assert.equal(btn.disabled, !en, `"${v}"`);
    }
  });
  it('poll stops when the modal is closed', () => {
    const src = fnSrc('_sitePurgePoll');
    assert.match(src, /classList\.contains\('hidden'\)\) \{ clearInterval\(_sitePurgeTimer\)/);
    assert.match(src, /if \(document\.hidden\) return;/);
    assert.match(fnSrc('sitePurgeClose'), /clearInterval\(_sitePurgeTimer\)/);
  });
});
