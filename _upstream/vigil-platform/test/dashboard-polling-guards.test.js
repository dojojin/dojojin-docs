// Vigil Platform — poll ของหน้าจอต้องหยุดเมื่อไม่มีคนดู (audit 2026-10-02 · O1 / O8 / D10)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const fnSrc = (src, name) => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf('\n}\n', i) + 2); };

test('today-counts poll fires only on a visible, active Camera page', () => {
  const calls = [];
  let tick = null;
  const doc = { hidden: false, active: true,
    getElementById: () => ({ classList: { contains: () => doc.active } }) };
  const ctx = { document: doc, setInterval: (fn) => { tick = fn; return 1; }, refreshTodayCounts: () => calls.push(1),
    _todayCountsTimer: null };
  vm.runInNewContext(`var _todayCountsTimer = null;\n${fnSrc(rd('dashboard/page-cameras.js'), 'startTodayCountsAutoRefresh')}\nstartTodayCountsAutoRefresh();`, ctx);
  tick(); assert.equal(calls.length, 1);
  doc.hidden = true; tick(); assert.equal(calls.length, 1, 'hidden tab');
  doc.hidden = false; doc.active = false; tick(); assert.equal(calls.length, 1, 'another page');
});

test('leaving Health stops the perf and devices timers; returning restarts the open tab', () => {
  const ev = [];
  const ctx = { setInterval: () => 1, clearInterval: () => {},
    startPerfRefresh: () => ev.push('perf+'), stopPerfRefresh: () => ev.push('perf-'),
    startDevRefresh: () => ev.push('dev+'), stopDevRefresh: () => ev.push('dev-'), loadHealth() {} };
  const s = rd('dashboard/page-health.js');
  vm.runInNewContext(`var _healthTimer = null; var _healthTab = 'perf'; var _perfTimer = null; var _devTimer = null;\n${fnSrc(s, 'startHealthAutoRefresh')}\n${fnSrc(s, 'stopHealthAutoRefresh')}\nstartHealthAutoRefresh(); stopHealthAutoRefresh();`, ctx);
  assert.deepEqual(ev, ['perf+', 'perf-', 'dev-']);
});

test('Camera Status 10-second refresh skips hidden tabs', () => {
  const s = rd('dashboard/dashboard.js');
  const i = s.indexOf("if (document.getElementById('page-cameras')?.classList.contains('active')) await loadCameras();");
  assert.ok(i > 0);
  assert.match(s.slice(i - 200, i), /if \(document\.hidden\) return;/);
});
