// ============================================================
// Vigil Platform — Tests: สถิติผ่าน partner API (OpenAPI ระยะ 2 · S1 · migration 270)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตัวเลขจริงตรวจด้วย route จริง + HMAC ใน transaction ที่ ROLLBACK (2026-10-22) · ไฟล์นี้กันรูปสัญญาเพี้ยน
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ENDPOINTS, resolveColumns } = require('../src/helpers/partnerSchema');
const { buildSpec } = require('../src/openapi-gen');

const STATS = ['statsVehiclesHourly', 'statsLprHourly', 'statsLprDaily'];
const ep = (id) => ENDPOINTS.find((e) => e.id === id);

test('stats endpoints are keyed by (time, camera_id) and expose counts, never rates', () => {
  for (const id of STATS) {
    const e = ep(id);
    assert.equal(e.keyColumn, 'camera_id');
    assert.deepEqual(e.requiredColumns, [e.timeColumn, 'camera_id']);
    assert.ok(!e.columns.some((c) => /rate|pct|percent|ratio/i.test(c)), `${id} must not publish a rate`);
  }
  assert.equal(ep('statsLprDaily').timeType, 'date');
});

test('a daily dimension not granted is dropped, not a 403', () => {
  const e = ep('statsLprDaily');
  const r = resolveColumns(e, ['day', 'camera_id', 'region']);
  assert.deepEqual(r.cols, ['day', 'camera_id', 'region']);
  assert.deepEqual(r.missingRequired, []);
  assert.deepEqual(resolveColumns(e, ['day', 'region']).missingRequired, ['camera_id']);
});

test('migration 270 creates the three views with contract column names and grants nothing', () => {
  const sql = fs.readFileSync(__dirname + '/../db/db_migration_270_stats_views.sql', 'utf8').replace(/--.*$/gm, '');
  for (const id of STATS) assert.match(sql, new RegExp(`CREATE OR REPLACE VIEW ${ep(id).view}\\b`));
  for (const col of ['hour_start', 'vehicles', 'by_type', 'detections', 'no_plate', 'region', 'vehicle_brand', 'plate_color'])
    assert.match(sql, new RegExp(`AS ${col}\\b`));
  assert.doesNotMatch(sql, /\bGRANT\b/);
  assert.ok(require('../src/routes/integrations').EXPOSED_VIEWS.includes('v_lpr_stats_daily_public'), 'admin can tick the new views');
});

test('OpenAPI documents only the granted stats fields, with objects typed as objects', async () => {
  const granted = { v_vehicle_stats_hourly_public: ['hour_start', 'camera_id', 'vehicles', 'by_type'],
    v_lpr_stats_daily_public: ['day', 'camera_id', 'region'] };
  const types = { by_type: 'jsonb', region: 'jsonb', hour_start: 'timestamp with time zone', day: 'date', vehicles: 'integer', camera_id: 'character varying' };
  const client = { async query(sql, p) {
    if (/information_schema\.columns/.test(sql)) return { rows: (granted[p[0]] || []).map((c) => ({ column_name: c, data_type: types[c] })) };
    return { rows: [] };
  } };
  const spec = await buildSpec(client, { label: 'T', db_role: 'zz_t', rate_per_min: 60 }, 'https://x.test');
  assert.ok(spec.paths['/v1/stats/vehicles/hourly'] && spec.paths['/v1/stats/lpr/daily']);
  assert.ok(!spec.paths['/v1/stats/lpr/hourly'], 'nothing granted → not described');
  const daily = spec.components.schemas.statsLprDailyRow.properties;
  assert.deepEqual(Object.keys(daily), ['day', 'camera_id', 'region']);
  assert.deepEqual(daily.region.type, ['object', 'null']);
  assert.equal(daily.day.format, 'date');
});

test('daily rows go out as YYYY-MM-DD, not a midnight timestamp (found in the S1 audit)', () => {
  const src = fs.readFileSync(__dirname + '/../src/routes/partner-api.js', 'utf8');
  assert.match(src, /if \(isDay\) r\[timeCol\] = r\._cur_t/);
});

test('S3: vehicle colour is a daily dimension of its own, appended to the view and granted to nobody', () => {
  const m = fs.readFileSync(__dirname + '/../db/db_migration_272_stats_vehicle_color.sql', 'utf8').replace(/--.*$/gm, '');
  assert.match(m, /AS updated_at,\s*jsonb_object_agg\(value, n\) FILTER \(WHERE dim = 'vehicle_color'\)\s+AS vehicle_color/, 'appended after updated_at (CREATE OR REPLACE VIEW can only add at the end)');
  assert.doesNotMatch(m, /\bGRANT\b/);
  assert.ok(ep('statsLprDaily').columns.includes('vehicle_color'));
  const r = fs.readFileSync(__dirname + '/../src/traffic-stats-refresher.js', 'utf8');
  assert.match(r, /'vehicle_color', vehicle_color, count\(\*\)::int FROM src/);
  assert.match(r, /const c = await refreshLprDims\(pool, from, until\);/, 'the 15-minute refresh still writes every dimension');
});
