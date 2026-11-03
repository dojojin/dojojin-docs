// Vigil Platform — ตัวเลขระดับป้าย (unique/local/visitor/mismatch): helper เดียว · hash ได้ · โหลดแยกได้ (2026-10-06)
// เดิม 49 วิที่ custom 30 วัน: COUNT(DISTINCT) บังคับเรียง 25 ล้านแถวด้วย collation en_US ·
// part=kpi คำนวณซ้ำพร้อม JOIN events จน "ทางเร็ว" ช้ากว่าทางเต็ม
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PLATE_COUNTS_SQL } = require('../src/routes/lpr-query.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-query.js'), 'utf8');
const fn = (name, next) => src.slice(src.indexOf(`async function ${name}`), src.indexOf(next, src.indexOf(`async function ${name}`)));

test('plate counts never use COUNT(DISTINCT) (forces a sort of every row)', () => {
  assert.doesNotMatch(PLATE_COUNTS_SQL, /COUNT\(DISTINCT/i);
  // nt ยังกรองประเภทรถที่ไม่รู้จักเหมือน COUNT(DISTINCT ...) FILTER เดิม
  assert.match(PLATE_COUNTS_SQL, /vehicle_type IS NOT NULL AND vehicle_type <> 'unknown'/);
  assert.match(PLATE_COUNTS_SQL, /lpr_mismatch_dismissals/);
});

test('temp table compares plates byte-wise (COLLATE "C"), not by locale', () => {
  const i = src.indexOf('CREATE TEMP TABLE _lpr_pp');
  const sel = src.slice(i, src.indexOf('FROM license_plates lp', i));
  for (const c of ['plate_number', 'region', 'vehicle_type']) assert.match(sel, new RegExp(`lp\\.${c} COLLATE "C"`));
  assert.equal((src.match(/CREATE TEMP TABLE _lpr_pp/g) || []).length, 1);   // ที่เดียวในไฟล์
});

test('full path and ?part=plates share the one helper; noplates skips it', () => {
  assert.match(fn('_computeLprStats', 'async function _computeLprPlates'), /q\.noplates \? Promise\.resolve\(null\) : plateCounts\(/);
  assert.match(fn('_computeLprPlates', 'async function _computeLprKpiOnly'), /plateCounts\(sp, whereLp, args\)/);
});

test('?part=kpi has no plate-level counts and no events join', () => {
  const body = fn('_computeLprKpiOnly', '// ── keep the expensive windows warm');
  assert.doesNotMatch(body, /COUNT\(DISTINCT|plate_counts|plateCounts|JOIN license_plates lp ON lp\.event_id/);
  assert.match(body, /FROM license_plates lp\s+LEFT JOIN lpr_watchlist/);
});

test('each part has its own cache key', () => {
  assert.match(src, /_kpiOnly \? `kpi:\$\{_cacheKey\}` : _platesOnly \? `plates:\$\{_cacheKey\}`\s*: _noPlates \? `np:\$\{_cacheKey\}` : _cacheKey/);
});

test('noplates uses the light queue so it never waits behind part=plates', () => {
  assert.match(src, /const runner = _noPlates \? _kpiRunner\(period\) : _fullRunner\(period\);/);
});

test('part=kpi on summarised periods reuses the noplates full path (KPI-only scans every row)', () => {
  assert.match(src, /period === 'today' \|\| period === 'hour'\s*\? _computeLprKpiOnly\(period, q\)\s*: _computeLprStats\(period, \{ \.\.\.q, noplates: true \}\)/);
});

test('part=kpi total counts readable plates only, like the full path', () => {
  const body = fn('_computeLprKpiOnly', '// ── keep the expensive windows warm');
  assert.match(body, /COUNT\(\*\) FILTER \(WHERE lp\.plate_number <> 'unknown'\) AS total/);
});

test('part=kpi today reads helmet counts from the same rollup as the full path', () => {
  const body = fn('_computeLprKpiOnly', '// ── keep the expensive windows warm');
  assert.match(body, /period === 'today'[\s\S]*SUM\(r\.n_no_helmet\), 0\) FROM lpr_hourly_stats r WHERE \$\{ruWhere\}\) AS no_helmet/);
  assert.match(src, /const helmetRollup = period === 'today';/);   // ทางเต็มยังใช้เกณฑ์เดียวกัน
});
