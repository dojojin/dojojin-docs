// Vigil Platform — quick wins ชุด 1C (audit 2026-10-02): UI/บั๊กเล็ก
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('reports no longer fetch the unused coverage/evidence endpoints (D9)', () => {
  for (const f of ['dashboard/page-reports.js', 'dashboard/report-print.js']) {
    assert.doesNotMatch(rd(f), /\/api\/stats\/event-coverage|\/api\/stats\/evidence/, f);
  }
});

test('LPR: short substring search refused on server and page (D12)', () => {
  assert.match(rd('src/routes/lpr-list.js'), /return res\.status\(400\)\.json\(\{ error: 'query_too_short', min: 3 \}\)/);
  assert.match(rd('dashboard/page-lpr.js'), /_q\.length < 3 && params\.get\('exact'\) !== '1'/);
});

test('"to" date picker opens on the "from" month when empty or earlier (D13)', () => {
  const s = rd('dashboard/dashboard.js');
  const i = s.indexOf('function _adpToFollowsFrom(');
  const src = s.slice(i, s.indexOf('\n}\n', i) + 2);
  const from = new Date('2026-09-21T00:00:00');
  const views = [];
  const mk = (sel) => ({ _adp: { selectedDates: sel, setViewDate: (d) => views.push(d) } });
  const els = { lprFilterFrom: mk([from]), lprFilterTo: mk([]) };
  const ctx = { document: { getElementById: (id) => els[id] } };
  vm.runInNewContext(src + '\nthis.opts = _adpToFollowsFrom("lprFilterTo");', ctx);
  ctx.opts.onShow(false);
  assert.deepEqual(views, [from]);
  // เคสจริง: ช่องถึงถูกเติมเป็น "ตอนนี้" (01/10 23:59) — ต้องเปิดที่เดือนของ "ตั้งแต่" (ก.ย.)
  els.lprFilterTo = mk([new Date('2026-10-01T23:59:00')]);
  ctx.opts.onShow(false);
  assert.equal(views.length, 2, 'prefilled "to" in another month still opens on the "from" month');
  els.lprFilterTo = mk([new Date('2026-09-25T00:00:00')]);
  ctx.opts.onShow(false);
  assert.equal(views.length, 2, 'a "to" in the same month keeps its own view');
  assert.match(s, /\.\.\.\(id\.includes\('To'\) \? _adpToFollowsFrom\(id\) : \{\}\)/);
});

test('LPR feeds and face overview report load failures instead of empty results (D14)', () => {
  const lpr = rd('dashboard/page-lpr.js');
  assert.match(lpr, /function _lprJsonRows\(res\) \{\n  if \(!res\.ok\) throw/);
  assert.doesNotMatch(lpr, /\.then\(res => res\.json\(\)\.then\(rows => \(\{ rows, total/);
  assert.match(rd('dashboard/page-face-matches.js'), /\/api\/faces\/stats\?\$\{params\}`\)\.then\(r => \{ if \(!r\.ok\) throw/);
});

test('/api/events clamps limit/offset (D17)', () => {
  const ev = rd('src/routes/events.js');
  assert.match(ev, /const lim = Math\.min\(Math\.max\(parseInt\(limit, 10\) \|\| 100, 1\), 2000\);/);
  assert.doesNotMatch(ev, /params\.push\(parseInt\(limit\)/);
});
