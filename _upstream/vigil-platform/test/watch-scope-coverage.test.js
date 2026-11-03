// Vigil Platform — ทุกจุดที่จับคู่ lpr_watchlist กับการอ่านป้าย (w.plate_number = UPPER(lp.plate_number))
// ต้องใส่ watchSiteOk() ของกลุ่มเฉพาะ Site (migration 261) ไว้ในเงื่อนไขเดียวกัน — ไม่งั้น LINE แจ้งแต่ตัวเลข
// "ตรงเฝ้าระวัง" ในสถิติไม่นับ (หรือกลับกัน) แล้วสองหน้าจอไม่ตรงกัน
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { watchSiteOk, bodySiteId } = require('../src/helpers/watchScope');

test('every watch-list ⨝ plate-read match applies watchSiteOk()', () => {
  const bad = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); return; }
    if (!p.endsWith('.js')) return;
    const L = fs.readFileSync(p, 'utf8').split('\n');
    L.forEach((l, i) => {
      if (!/w\.plate_number\s*=\s*UPPER\(lp\.plate_number\)/.test(l) || /^\s*\/\//.test(l)) return;
      if (!/watchSiteOk\(/.test(L.slice(i, i + 12).join('\n'))) bad.push(`${path.relative(path.join(__dirname, '..'), p)}:${i + 1}`);
    });
  });
  walk(path.join(__dirname, '../src'));
  assert.deepEqual(bad, [], 'จับคู่รายการเฝ้าระวังโดยไม่มีขอบเขต Site:\n' + bad.join('\n'));
});

test('watchSiteOk: global group / no group pass, other-site group fails (shape)', () => {
  const sql = watchSiteOk('w', 'e.camera_id');
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /wsg\.id = w\.group_id/);
  assert.match(sql, /site_id IS NOT NULL/);
  assert.match(sql, /WHERE id = e\.camera_id/);
});

test('bodySiteId', () => {
  assert.deepEqual(bodySiteId({}), { present: false });
  assert.deepEqual(bodySiteId({ site_id: null }), { present: true, value: null });
  assert.deepEqual(bodySiteId({ site_id: '14' }), { present: true, value: 14 });
  assert.ok(bodySiteId({ site_id: 'x' }).error);
  assert.ok(bodySiteId({ site_id: -1 }).error);
});
