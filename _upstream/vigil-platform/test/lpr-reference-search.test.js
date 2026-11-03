// ============================================================
// Vigil Platform — ค้นหน้า LPR ด้วยเลขอ้างอิงรายงาน (events.id) ต้องไม่ถูกตัวกรองที่ค้างไว้กลบ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-lpr.js'), 'utf8');
const fn = src.slice(src.indexOf('function _lprFilterParams()'), src.indexOf('function loadLpr('));

test('reference number = digits only, 8+ (truck plates are 6-7 digits)', () => {
  assert.match(fn, /\/\^\\d\{8,\}\$\/\.test\(q\)/);
  assert.doesNotMatch(fn, /\\d\{6,\}/);
});

test('reference number returns ONLY event_id, before any other filter is read', () => {
  const ret = fn.indexOf("params.set('event_id', q);\n    return params;");
  assert.ok(ret > 0, 'early return after event_id');
  for (const k of ['lprFilterCam', 'lprFilterRegion', "'regions'", '_lprApplySiteParam', "'from'"]) {
    assert.ok(fn.indexOf(k) > ret, `${k} must come after the early return`);
  }
});
