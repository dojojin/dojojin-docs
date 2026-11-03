// ============================================================
// Vigil Platform — Tests: watch-list LINE banner
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The banner exists because on 2026-08-04 the group switch was on, the
// per-plate switch was on, line_config.enabled was off, and nothing on the
// watch-list page said so — found only when a real hit produced no LINE. These
// tests pin the states, including the two that must NOT read as "all good":
// a missing channel token, and a config the browser could not read at all.
// ============================================================
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SRC = path.join(__dirname, '../dashboard/page-lpr.js');

let cfgReply = null;
const el = {
  className: '', innerHTML: '', textContent: '',
  classList: {
    remove(c) { el.className = el.className.replace(c, '').trim(); },
    add(c) { el.className += ' ' + c; },
  },
};

// page-lpr.js is a browser script that touches a lot on load; stub only what it
// reaches for at parse time.
const ctx = {
  document: {
    getElementById: id => (id === 'wlLineBanner' ? el : null),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {} }, documentElement: { style: { setProperty() {} } },
  },
  addEventListener() {}, requestAnimationFrame: fn => setTimeout(fn, 0),
  ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  fetch: async () => ({ ok: cfgReply !== 'ERR', json: async () => cfgReply }),
  console, API: '', setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: () => null, setItem() {} },
  location: { origin: '', href: '' }, navigator: { language: 'th' },
  I18N: { t: (k, f) => f || k }, Chart: function () {}, ol: {},
};
ctx.window = ctx; ctx.globalThis = ctx;

let render, setGroups;
const settle = () => new Promise(r => setTimeout(r, 20));

before(() => {
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'page-lpr.js' });
  render = vm.runInContext('_renderWlLineBanner', ctx);
  setGroups = js => vm.runInContext(`_lprGroups = ${js}`, ctx);
});

describe('_renderWlLineBanner', () => {
  it('warns when the master switch is off — the state that hid a real miss', async () => {
    setGroups(`[{id:'suspect',name:'รถผู้ต้องสงสัย',notify_line:true}]`);
    cfgReply = { enabled: false, _hasToken: true };
    render(); await settle();
    assert.ok(el.className.includes('warn'), el.className);
    assert.ok(el.innerHTML.includes('wlGoLineConfig'), 'offers a way to go turn it on');
  });

  it('treats a missing channel token as off, not as on', async () => {
    cfgReply = { enabled: true, _hasToken: false };
    render(); await settle();
    assert.ok(el.className.includes('warn'), el.className);
  });

  it('warns when the master is on but no group is ticked', async () => {
    setGroups(`[{id:'vip',name:'รถ VIP',notify_line:false}]`);
    cfgReply = { enabled: true, _hasToken: true };
    render(); await settle();
    assert.ok(el.className.includes('warn'), el.className);
    assert.match(el.textContent, /ยังไม่มีกลุ่ม/);
  });

  it('names the sending groups when it is genuinely on', async () => {
    setGroups(`[{id:'suspect',name:'รถผู้ต้องสงสัย',notify_line:true},{id:'warrant',name:'รถตามหมายจับ',notify_line:true},{id:'vip',name:'รถ VIP',notify_line:false}]`);
    cfgReply = { enabled: true, _hasToken: true };
    render(); await settle();
    assert.ok(el.className.includes('ok'), el.className);
    assert.ok(el.textContent.includes('รถผู้ต้องสงสัย, รถตามหมายจับ'), el.textContent);
    assert.ok(!el.textContent.includes('รถ VIP'), 'a muted group is not listed as sending');
  });

  it('says nothing at all when the config cannot be read', async () => {
    cfgReply = 'ERR';
    render(); await settle();
    assert.ok(el.className.includes('hidden'), 'a wrong "all good" is worse than no banner');
  });
});
