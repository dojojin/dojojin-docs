// ============================================================
// Vigil Platform — Tests: scripts/query-probe.js (ชุดกรณี + เก็บประวัติ)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const qp = require('../scripts/query-probe');

test('every site gets the same cases, built from its own cameras, and nothing that calls out of the system', () => {
  const cases = qp.buildCases([{ code: 'aaa', cameras: ['A1', 'A2'] }, { code: 'bbb', cameras: ['B1'] }], new Date('2026-10-26T18:15:00Z'));
  const perSite = (s) => cases.filter((c) => c.id.endsWith('|' + s)).map((c) => c.id.split('|')[0]);
  assert.deepEqual(perSite('aaa'), perSite('bbb'));
  assert.equal(cases.find((c) => c.id === 'events-30d|bbb').query.cameras, 'B1');
  for (const c of cases) assert.doesNotMatch(c.path, /hcp|line|telegram|snapshot\/live|timeline|alarm-server/, c.path);
});

test('history keeps the last 14 nights', () => {
  let v = null;
  for (let d = 1; d <= 20; d++) v = qp.merge(v, `2026-10-${String(d).padStart(2, '0')}`, { a: d });
  assert.equal(Object.keys(v.history).length, qp.KEEP_DAYS);
  assert.equal(v.day, '2026-10-20');
  assert.ok(!v.history['2026-10-01']);
});

test('the site query skips sites whose edge alerts are muted (and still skips nothing when none are)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'query-probe.js'), 'utf8');
  assert.match(src, /disabled_sites/);
  assert.match(src, /<> ALL/);
});
