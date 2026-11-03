// Vigil Platform — นับผลค้นหา LPR ต้องไม่ JOIN events โดยไม่จำเป็น และไม่นับซ้ำตอนเปลี่ยนหน้า (O3 · 2026-10-03)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('count query joins events only when the WHERE references e', () => {
  const s = rd('src/routes/lpr-list.js');
  assert.match(s, /\$\{hasEventFilter \? 'JOIN events e ON e\.id = lp\.event_id' : ''\} \$\{wc\}/);
});

test('LPR page keeps the count when only the page number changes', () => {
  const s = rd('dashboard/page-lpr.js');
  assert.match(s, /if \(!\(_lprPage > 1 && countKey === _lprCountKey\)\)/);
});
