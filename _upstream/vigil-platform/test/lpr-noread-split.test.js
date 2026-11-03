// Vigil Platform — noread ช่วง custom: ถังเต็มจาก lpr_hourly_stats + ขอบสด (ค-#6 · 2026-10-06)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { noreadSplit, noreadSplitSql, todaySplit, bkkDayStartIso } = require('../src/routes/lpr-query.js');
const H = 3600_000;
const NOW = Date.parse('2026-10-06T05:20:00Z');

test('split covers only whole hours inside the range, ending one hour before now', () => {
  const s = noreadSplit('2026-09-28T00:30:00+07:00', '2026-10-02T23:45:00+07:00', NOW);
  assert.equal(s.A.toISOString(), '2026-09-27T18:00:00.000Z');   // 00:30 ไทย → ถังถัดไป 01:00
  assert.equal(s.B.toISOString(), '2026-10-02T16:00:00.000Z');   // 23:45 ไทย → ถัง 23:00 ยังสด
});

test('open-ended range stops one full hour before now', () => {
  const s = noreadSplit('2026-10-05T00:00:00Z', null, NOW);
  assert.equal(s.B.getTime(), Math.floor(NOW / H) * H - H);
});

test('no from = 31-day default lower bound, like periodClause', () => {
  const s = noreadSplit(null, null, NOW);
  assert.equal(s.A.getTime(), Math.ceil((NOW - 31 * 86_400_000) / H) * H);
});

test('range shorter than a whole bucket falls back to fully live', () => {
  assert.equal(noreadSplit('2026-10-06T03:10:00Z', '2026-10-06T03:50:00Z', NOW), null);
  assert.equal(noreadSplit('2026-10-06T04:30:00Z', null, NOW), null);   // ขอบสด 1 ชม. กินหมด
  assert.equal(noreadSplit('garbage', null, NOW), null);
});

test('live part keeps the OR predicate the partial indexes need, and excludes the rollup span', () => {
  const sql = noreadSplitSql('X', 'Y', 7, 8);
  assert.match(sql, /OR e\.raw_json->>'plate' = 'unknown'/);
  assert.match(sql, /r\.bucket_hour >= \$7::timestamptz AND r\.bucket_hour < \$8::timestamptz/);
  // noread: ขอบเป็นถังชั่วโมง (แคบ < 2 ชม.) planner ใช้ BitmapOr ได้ — OR เร็วกว่าแยกสองขา (100 vs 259 ms)
  assert.match(sql, /e\.event_time < \$7::timestamptz OR e\.event_time >= \$8::timestamptz/);
});

test('license_plates / per-camera live edges never combine the two edges with OR (day edges → full-range scan)', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-query.js'), 'utf8');
  assert.doesNotMatch(s, /detected_at < \$\$\{iA\}::timestamptz OR /);
  const i = s.indexOf('async function _computeLprStats');
  const body = s.slice(i, s.indexOf('async function _computeLprKpiOnly'));
  assert.equal((body.match(/FROM \$\{lpLive\}/g) || []).length, 4);   // มิติ · KPI · รายชั่วโมง · ทิศ
  assert.equal((body.match(/FROM \$\{evLive\}/g) || []).length, 1);   // ต่อกล้อง
});

test('both stats paths use the split for custom and today — and pick the same source', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-query.js'), 'utf8');
  const n = (re) => (s.match(re) || []).length;
  // ทางเต็ม: custom ผ่าน nrSplit · today ผ่าน nrToday (ไม่ปนกับ hs ที่สลับ KPI ทั้งชุดของ custom)
  assert.equal(n(/const nrSplit = period === 'custom' \? noreadSplit\(q\.from, q\.to\) : null;/g), 1);
  assert.equal(n(/const nrToday = period === 'today' \? todaySplit\(\) : null;/g), 1);
  assert.equal(n(/\(nrSplit \|\| nrToday\) \? sp\.query\(noreadSplitSql\(/g), 1);
  // ทาง KPI: ต้องเลือกแหล่งเดียวกับทางเต็ม ไม่งั้นการ์ดกระพริบ
  assert.equal(n(/const nrSplit = period === 'custom' \? noreadSplit\(q\.from, q\.to\) : period === 'today' \? todaySplit\(\) : null;/g), 1);
  assert.equal(n(/nrSplit \? sp\.query\(noreadSplitSql\(/g), 1);
  // today ต้องไม่ไปเปิด hs (KPI/มิติ) ของ custom
  assert.equal(n(/const hs = nrSplit, ds = period === 'custom'/g), 1);
});

// ── รอบ ค #2ก: ส่วนที่บวกได้ของช่วง custom ใช้ตารางสรุป + ขอบสด ─────────────────
const { daySplit } = require('../src/routes/lpr-query.js');

test('daySplit covers whole Thai days only and never today', () => {
  const now = Date.parse('2026-10-06T05:20:00Z');                     // 12:20 ไทย
  const s = daySplit('2026-09-28T00:30:00+07:00', '2026-10-02T23:45:00+07:00', now);
  assert.equal(s.A.toISOString(), '2026-09-28T17:00:00.000Z');         // 29 ก.ย. 00:00 ไทย
  assert.equal(s.B.toISOString(), '2026-10-01T17:00:00.000Z');         // 2 ต.ค. ยังไม่เต็มวัน → สด
  const open = daySplit('2026-10-01T00:00:00+07:00', null, now);
  assert.equal(open.B.toISOString(), '2026-10-05T17:00:00.000Z');      // ขอบบน = เที่ยงคืนวันนี้ (ไทย)
  assert.equal(daySplit('2026-10-06T01:00:00+07:00', null, now), null);
});

test('custom stats: summable queries switch to the split, distinct plate counts stay live', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/lpr-query.js'), 'utf8');
  const i = s.indexOf('async function _computeLprStats');
  const body = s.slice(i, s.indexOf('async function _computeLprKpiOnly'));
  assert.equal((body.match(/hs \? sp\.query\(/g) || []).length, 3);   // KPI · รายชั่วโมง · ทิศ
  // ต่อกล้อง: today ก็ใช้ถังชั่วโมงเต็มด้วย (todaySplit) args = stArgs + A,B
  assert.equal((body.match(/\(hs \|\| nrToday\) \? sp\.query\(/g) || []).length, 1);
  assert.match(body, /hs \? hArgs : \[\.\.\.stArgs, nrToday\.A, nrToday\.B\]/);
  assert.equal((body.match(/ds \? sp\.query\(dimSplitQ\(/g) || []).length, 4); // จังหวัด · ประเภท · สี · ยี่ห้อ
  assert.match(body, /plateCounts\(sp, stSqlLp, stArgs\)/);              // ป้ายไม่ซ้ำยังสดทั้งช่วง (helper กลาง)
});

// period=today: ถังชั่วโมงเต็มเริ่มที่เที่ยงคืนไทย · ขอบสดไม่เกิน ~2 ชม.
const at = (iso) => Date.parse(iso);
test('today: day start is Bangkok midnight', () => {
  assert.equal(bkkDayStartIso(at('2026-10-10T11:00:00Z')), '2026-10-09T17:00:00.000Z');   // 18:00 ไทย
  assert.equal(bkkDayStartIso(at('2026-10-09T17:00:00Z')), '2026-10-09T17:00:00.000Z');   // 00:00 ไทยพอดี
  assert.equal(bkkDayStartIso(at('2026-10-09T16:59:59Z')), '2026-10-08T17:00:00.000Z');   // 23:59:59 ไทยของวันก่อน
});
test('today: no full bucket before 02:00 Bangkok → null (live count as before)', () => {
  assert.equal(todaySplit(at('2026-10-09T17:30:00Z')), null);   // 00:30 ไทย
  assert.equal(todaySplit(at('2026-10-09T18:30:00Z')), null);   // 01:30 ไทย (B = A)
});
test('today: from 02:00 Bangkok the full hours come from the rollup', () => {
  const a = todaySplit(at('2026-10-09T19:30:00Z'));             // 02:30 ไทย → ถัง 00:00–01:00 ไทยเดียว
  assert.equal(a.A.toISOString(), '2026-10-09T17:00:00.000Z');
  assert.equal(a.B.toISOString(), '2026-10-09T18:00:00.000Z');
  const b = todaySplit(at('2026-10-10T11:00:00Z'));             // 18:00 ไทย → ถัง 00:00–17:00 ไทย ขอบสด 17:00–18:00
  assert.equal(b.A.toISOString(), '2026-10-09T17:00:00.000Z');
  assert.equal(b.B.toISOString(), '2026-10-10T10:00:00.000Z');
  const c = todaySplit(at('2026-10-10T11:59:00Z'));             // 18:59 ไทย → ขอบสดยาวสุด ~2 ชม. (17:00–18:59)
  assert.equal(c.B.toISOString(), '2026-10-10T10:00:00.000Z');
});

