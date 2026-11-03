// ============================================================
// Vigil Platform — Tests: ฟิลด์รายแถวเพิ่ม (OpenAPI ระยะ 2 · ขั้น 2 · migration 273)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ทำรอไว้ (เจ้าของสั่ง 2026-10-22) · คอลัมน์ใหม่ไม่มีใครได้จนกว่าจะติ๊ก · age_group เติมจาก rj_age_group (เดิมว่าง 100%)
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ENDPOINTS, resolveColumns } = require('../src/helpers/partnerSchema');

const sql = fs.readFileSync(__dirname + '/../db/db_migration_273_partner_row_fields.sql', 'utf8').replace(/--.*$/gm, '');
const ep = (id) => ENDPOINTS.find((e) => e.id === id);
const viewCols = (name) => {
  const body = sql.slice(sql.indexOf(`VIEW ${name} AS`)).split(';')[0];
  const list = body.slice(body.indexOf('SELECT') + 6, body.indexOf('FROM'));
  const parts = []; let depth = 0, cur = '';
  for (const ch of list) {                      // คอมมาในวงเล็บ (COALESCE(a, b)) ไม่ใช่ตัวคั่นคอลัมน์
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((c) => c.trim().split(/\s+AS\s+/i).pop().trim());
};

test('existing columns keep their names and order; new ones are appended (CREATE OR REPLACE VIEW rule)', () => {
  assert.deepEqual(viewCols('v_license_plates_public').slice(0, 12),
    ['id', 'event_id', 'camera_id', 'plate_number', 'confidence', 'country', 'region', 'bbox_x', 'bbox_y', 'bbox_width', 'bbox_height', 'detected_at']);
  assert.deepEqual(viewCols('v_appearances_public').slice(0, 19),
    ['id', 'event_id', 'camera_id', 'object_id', 'object_class', 'gender', 'age_group', 'upper_color', 'lower_color', 'vehicle_type',
     'vehicle_color', 'confidence', 'attributes', 'detected_at', 'top_category', 'bottom_category', 'hair_length', 'glasses', 'helmet_wear']);
  assert.doesNotMatch(sql, /\bGRANT\b/);
});

test('age_group falls back to the value cameras actually send, keeping its type', () => {
  assert.match(sql, /COALESCE\(age_group, rj_age_group\)::varchar\(20\) AS age_group/);
});

test('every endpoint selects only columns its view really has', () => {
  for (const id of ['listLprEvents', 'searchLpr']) for (const c of ep(id).columns) assert.ok(viewCols('v_license_plates_public').includes(c), `${id}.${c}`);
  for (const c of ep('listFaceEvents').columns) assert.ok(viewCols('v_appearances_public').includes(c), `listFaceEvents.${c}`);
});

test('a partner holding only the old columns keeps the old row shape (new fields are simply absent)', () => {
  const old = ['id', 'event_id', 'camera_id', 'plate_number', 'confidence', 'country', 'region', 'bbox_x', 'bbox_y', 'bbox_width', 'bbox_height', 'detected_at'];
  const r = resolveColumns(ep('listLprEvents'), old);
  assert.deepEqual(r.cols, old);
  assert.ok(r.dropped.includes('vehicle_brand') && r.missingRequired.length === 0);
});

test('the contract warns that false is not proof of compliance', () => {
  assert.match(ep('listLprEvents').description, /`false` in an offence field[\s\S]*not proof of compliance/);
});
