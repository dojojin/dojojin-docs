// Vigil Platform — /api/stats/lpr/report: temp table ต้องมีทุกคอลัมน์ที่เงื่อนไข "พร้อมข้อมูลทะเบียน" อ่าน
// เหตุจริง: 798b6c53 (18 ก.ย.) เปลี่ยน evidenceSql ไปอ่าน plate_identified แต่ _lpr_report_base ไม่ได้ดึงมา
//   ⇒ รายงานป้ายทะเบียนตอบ 500 ทุกครั้ง และรูปรายงานออกมาเป็นศูนย์เงียบ ๆ จนถึง 6 ต.ค.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const helmet = require('../src/helpers/helmetCriteria');

test('_lpr_report_base selects every column evidenceSql("") reads', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-query.js'), 'utf8');
  const i = s.indexOf('CREATE TEMP TABLE _lpr_report_base');
  assert.ok(i > 0);
  const select = s.slice(i, s.indexOf('FROM license_plates lp', i));
  const cols = helmet.evidenceSql('').match(/[a-z_]+/g).filter((w) => w !== 'AND');
  assert.ok(cols.length > 0);
  for (const c of cols) assert.match(select, new RegExp(`lp\\.${c}\\b`), `temp table missing ${c}`);
});

test('report base is built from license_plates alone, unique comes from the per-plate counts', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-query.js'), 'utf8');
  const i = s.indexOf('CREATE TEMP TABLE _lpr_report_base');
  const build = s.slice(i, s.indexOf('[...rPcArgs, ...baseSiteArgs]', i));
  assert.match(build, /FROM license_plates lp\s+LEFT JOIN cameras c ON c\.id = lp\.camera_id/);
  assert.doesNotMatch(build, /FROM events e/);
  assert.match(build, /lp\.plate_number COLLATE "C" AS plate_number/);
  assert.match(build, /WHERE \$\{rPcSqlLp\}\$\{baseSiteClause\}/);
  assert.match(s, /unique: local \+ visitor/);
});
