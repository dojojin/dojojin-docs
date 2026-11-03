// ============================================================
// Vigil Platform — Tests: reconcile ตัดขอบตรงต้นวันไทย (lpr_dim_daily / appearance_dim_daily · 2026-10-22)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// repro บน prod (transaction ที่ ROLLBACK): ขอบ now−24h ⇒ รอบที่ until ตกกลางวันลบทั้งวันแล้วเขียนกลับครึ่งวัน
// ถ้ารอบถัดไปล้ม ยอดจังหวัดเมื่อวานค้างที่ 467,684 จากจริง 823,854 · ขอบตรงต้นวัน = ครบ
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../src/traffic-stats-refresher.js');

test('windows are whole Thai days back to back, ending open at now', () => {
  const now = Date.parse('2026-10-22T22:05:00Z');          // 05:05 ของ 23 ต.ค. เวลาไทย (รอบ reconcile)
  const w = R.thaiDayWindows(3, now);
  assert.equal(w.length, 4);
  assert.deepEqual(w.map(([s]) => s.toISOString()),
    ['2026-10-19T17:00:00.000Z', '2026-10-20T17:00:00.000Z', '2026-10-21T17:00:00.000Z', '2026-10-22T17:00:00.000Z']);
  for (let i = 0; i < w.length - 1; i++) assert.equal(w[i][1].getTime(), w[i + 1][0].getTime(), 'no gap, no overlap');
  assert.equal(w.at(-1)[1], null, 'today runs to now');
  assert.ok(w[0][0].getTime() <= now - 72 * 3600_000, 'covers at least RECONCILE_HOURS');
});

test('just after Thai midnight the windows still start on Thai day boundaries', () => {
  const w = R.thaiDayWindows(1, Date.parse('2026-10-22T17:00:30Z'));   // 00:00:30 ของ 23 ต.ค.
  assert.deepEqual(w.map(([s, u]) => [s.toISOString(), u && u.toISOString()]),
    [['2026-10-21T17:00:00.000Z', '2026-10-22T17:00:00.000Z'], ['2026-10-22T17:00:00.000Z', null]]);
});

test('both reconcile loops use the shared Thai-day windows (no more now − 24h bounds)', () => {
  const src = fs.readFileSync(__dirname + '/../src/traffic-stats-refresher.js', 'utf8');
  assert.match(src, /const windows = thaiDayWindows\(Math\.ceil\(RECONCILE_HOURS \/ 24\)\);/);
  assert.match(src, /for \(const \[since, until, d\] of windows\) \{\s*try \{\s*const one = await refreshLprWindow\(_pool, since, until\);/);
  assert.doesNotMatch(src, /new Date\(Date\.now\(\) - \(d - 1\) \* 24 \* 3600_000\)/);
});
