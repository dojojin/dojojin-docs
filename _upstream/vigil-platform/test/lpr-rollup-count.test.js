// ============================================================
// Vigil Platform — Tests: นับผลค้นหา LPR จากตารางสรุปรายชั่วโมง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตรวจกับข้อมูลจริง 2026-10-21 (snapshot เดียวกัน 5 แบบ ตรงทุกหลัก) — เทสต์นี้ล็อกกติกาที่ทำให้ตรง:
// ใช้ได้เฉพาะเงื่อนไข กล้อง/ไซต์/เวลา · ชั่วโมงแรก (retention ลบกลางชั่วโมง) และ 1 ชม.ล่าสุดต้องนับสด
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRollupCount } = require('../src/helpers/lprRollupCount');

const NOW = Date.parse('2026-10-21T14:37:00Z');
const PM = '2026-07-13T14:04:42.965Z';
const base = { platesMin: PM, now: NOW };

test('camera / site / time conditions use the rollup', () => {
  for (const where of [[], ['lp.camera_id = $1'], ['lp.camera_id = ANY($1)'],
    ['lp.camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($1))'],
    ['lp.camera_id IN (SELECT id FROM cameras WHERE site_id = ANY($1) AND id = ANY($2))'], ['FALSE'],
    ['lp.detected_at >= $1', 'lp.detected_at <= $2']]) {
    assert.ok(buildRollupCount({ ...base, where, args: where.map(() => 'x') }), where.join(' AND ') || '(none)');
  }
});

test('any other filter, or an events join, falls back to the live count', () => {
  for (const w of ['lp.plate_number ILIKE $1', 'lp.region = $1', 'lp.vehicle_type = ANY($1)', "lp.pillion = 'yes'",
                   'lp.rider_count >= 3', 'e.id = $1', 'lp.camera_id = $1 OR TRUE']) {
    assert.equal(buildRollupCount({ ...base, where: [w], args: ['x'] }), null, w);
  }
  assert.equal(buildRollupCount({ ...base, where: [], args: [], hasEventFilter: true }), null);
  assert.equal(buildRollupCount({ ...base, where: [], args: [], platesMin: null }), null);
});

test('the first (partly deleted) hour and the unsettled last hour are counted live', () => {
  const r = buildRollupCount({ ...base, where: [], args: [] });
  const [A, B] = r.args.slice(-2);
  assert.equal(A, '2026-07-13T15:00:00.000Z', 'starts at the hour AFTER the oldest surviving row');
  assert.equal(B, '2026-10-21T13:00:00.000Z', 'ends one hour before the current hour');
  assert.match(r.sql, /lp\.detected_at < \$1::timestamptz OR lp\.detected_at >= \$2::timestamptz/);
});

test('from / to inside hours: rollup covers only the whole hours between them', () => {
  const r = buildRollupCount({ ...base, where: ['lp.detected_at >= $1', 'lp.detected_at <= $2'],
    args: ['2026-10-20T10:25:00Z', '2026-10-21T05:40:00Z'], from: '2026-10-20T10:25:00Z', to: '2026-10-21T05:40:00Z' });
  assert.deepEqual(r.args.slice(-2), ['2026-10-20T11:00:00.000Z', '2026-10-21T05:00:00.000Z']);
  assert.match(r.sql, /lp\.detected_at >= \$1 AND lp\.detected_at <= \$2 AND \(lp\.detected_at < \$3/);
});

test('a range with no whole settled hour is left to the live count', () => {
  assert.equal(buildRollupCount({ ...base, where: ['lp.detected_at >= $1'], args: ['x'], from: '2026-10-21T13:10:00Z' }), null);
});

test('camera conditions are applied to the rollup as r.camera_id', () => {
  const r = buildRollupCount({ ...base, where: ['lp.camera_id = ANY($1)'], args: [['c1']] });
  assert.match(r.sql, /FROM lpr_hourly_stats r\s+WHERE r\.camera_id = ANY\(\$1\) AND r\.bucket_hour >= \$2/);
});
