// ============================================================
// Vigil Platform — Tests: Traffic Enforcement ผ่าน partner API (OpenAPI ระยะ 2 · S2 · migration 271)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตัวเลขจริงตรวจด้วย route จริง + HMAC ใน transaction ที่ ROLLBACK (2026-10-22) · ไฟล์นี้กันรูปสัญญาเพี้ยน
// เจ้าของตัดสิน: ตัวนับดิบ ไม่ส่งอัตรา · ส่ง no_helmet_with_plate · ไม่ส่งผู้ทำผิดซ้ำรายป้าย · ไม่มีรายวัน
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ENDPOINTS, resolveColumns } = require('../src/helpers/partnerSchema');

const ep = (id) => ENDPOINTS.find((e) => e.id === id);
const sql = fs.readFileSync(__dirname + '/../db/db_migration_271_enforcement_views.sql', 'utf8').replace(/--.*$/gm, '');

test('enforcement endpoints: hourly feed keyed by (hour, camera) and a per-camera coverage list', () => {
  const h = ep('enforcementHourly'), c = ep('enforcementCameras');
  assert.equal(h.path, '/v1/enforcement/hourly');
  assert.deepEqual(h.requiredColumns, ['hour_start', 'camera_id']);
  assert.equal(c.timeColumn, null);
  assert.deepEqual(c.requiredColumns, ['camera_id']);
  // รายวันเพิ่มทีหลังบนตาราง traffic_daily_stats (migration 274/275) — ฟิลด์เดียวกับรายชั่วโมง key เป็นวันไทย
  const d = ENDPOINTS.find((e) => e.path === '/v1/enforcement/daily');
  assert.equal(d.timeType, 'date');
  assert.deepEqual(d.columns.slice(1), h.columns.slice(1), 'same fields as the hourly feed');
});

test('counts only: no rates, no plates, no personal data', () => {
  for (const id of ['enforcementHourly', 'enforcementCameras']) {
    const cols = ep(id).columns;
    assert.ok(!cols.some((x) => /rate|pct|percent|ratio/i.test(x)), `${id} publishes a rate`);
    assert.ok(!cols.some((x) => /plate_number|snapshot|image|face/i.test(x)), `${id} publishes personal data`);
  }
  assert.doesNotMatch(sql, /license_plates|plate_number/, 'views read the summary table only');
  assert.ok(ep('enforcementHourly').columns.includes('no_helmet_with_plate'), 'owner chose to publish the dashboard figure');
});

test('migration 271 creates both views with contract names and grants nothing', () => {
  for (const id of ['enforcementHourly', 'enforcementCameras']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE VIEW ${ep(id).view}\\b`));
    for (const col of ep(id).columns.filter((x) => x !== 'camera_id' && x !== 'updated_at')) assert.match(sql, new RegExp(`AS ${col}\\b`), col);
  }
  assert.doesNotMatch(sql, /\bGRANT\b/);
  const { EXPOSED_VIEWS } = require('../src/routes/integrations');
  assert.ok(EXPOSED_VIEWS.includes('v_enforcement_hourly_public') && EXPOSED_VIEWS.includes('v_enforcement_cameras_public'));
});

test('an offence column not granted is dropped; missing camera_id is a 403', () => {
  const r = resolveColumns(ep('enforcementHourly'), ['hour_start', 'camera_id', 'no_helmet']);
  assert.deepEqual(r.cols, ['hour_start', 'camera_id', 'no_helmet']);
  assert.deepEqual(resolveColumns(ep('enforcementCameras'), ['reports_no_helmet']).missingRequired, ['camera_id']);
});

test('the contract tells partners a zero is not compliance, and which figure the dashboard shows', () => {
  assert.match(ep('enforcementHourly').description, /zero is not proof of compliance/i);
  assert.match(ep('enforcementHourly').description, /twoWheelVehicle\.no_helmet_with_plate/);
  assert.match(ep('enforcementCameras').description, /false means it has never/);
});
