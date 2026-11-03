// ============================================================
// Vigil Platform — Tests: partner endpoints select only granted columns (OpenAPI phase 2 step 1)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ฟิลด์ที่ไม่ได้สิทธิ์ = หายจากแถว (และจาก OpenAPI) · ขาดคอลัมน์บังคับ = 403/ไม่แสดง endpoint
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ENDPOINTS, resolveColumns } = require('../src/helpers/partnerSchema');
const { buildSpec } = require('../src/openapi-gen');

const ep = (id) => ENDPOINTS.find((e) => e.id === id);

test('resolveColumns drops ungranted optional columns and reports required ones', () => {
  const e = ep('listLprEvents');
  const all = e.columns;
  assert.deepEqual(resolveColumns(e, all).dropped, []);
  const r = resolveColumns(e, all.filter((c) => c !== 'region' && c !== 'bbox_x'));
  assert.deepEqual(r.dropped, ['region', 'bbox_x']);
  assert.ok(!r.cols.includes('region') && r.cols.includes('plate_number') && r.missingRequired.length === 0);
  assert.deepEqual(resolveColumns(e, all.filter((c) => c !== 'camera_id')).missingRequired, ['camera_id']);
});

test('every endpoint requires its key columns, and search also needs plate_number', () => {
  for (const e of ENDPOINTS) {
    assert.ok(e.requiredColumns.includes(e.keyColumn || 'id'), `${e.id} key`);
    if (e.timeColumn) assert.ok(e.requiredColumns.includes(e.timeColumn) && e.requiredColumns.includes('camera_id'), `${e.id} time/camera`);
  }
  assert.ok(ep('searchLpr').requiredColumns.includes('plate_number'));
  assert.ok(!ep('listLprEvents').requiredColumns.includes('plate_number'));
});

// client ปลอมที่ตอบ catalogue ตามชุดคอลัมน์ที่ "ถือสิทธิ์"
function fakeClient(granted) {
  return {
    async query(sql, params) {
      if (/information_schema\.columns/.test(sql)) {
        const view = params[0];
        const all = ENDPOINTS.filter((e) => e.view === view).flatMap((e) => e.columns);
        return { rows: [...new Set(all)].filter((c) => granted.has(`${view}.${c}`)).map((column_name) => ({ column_name, data_type: 'text' })) };
      }
      return { rows: [] };
    },
  };
}
const grantAllExcept = (...drop) => new Set(ENDPOINTS.flatMap((e) => e.columns.map((c) => `${e.view}.${c}`)).filter((k) => !drop.includes(k)));

test('OpenAPI row schema lists only granted fields; an endpoint missing a key field disappears', async () => {
  const spec = await buildSpec(fakeClient(grantAllExcept('v_license_plates_public.region', 'v_appearances_public.camera_id')),
    { label: 'T', db_role: 'zz_t', rate_per_min: 60 }, 'https://x.test');
  const lprProps = Object.keys(spec.components.schemas.listLprEventsRow.properties);
  assert.ok(!lprProps.includes('region') && lprProps.includes('plate_number'));
  assert.ok(spec.paths['/v1/lpr/events'], 'events still described');
  assert.ok(!spec.paths['/v1/face/events'], 'face feed lacks camera_id → not described');
});
