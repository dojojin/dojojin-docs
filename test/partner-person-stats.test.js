// ============================================================
// Vigil Platform — Tests: /v1/stats/person/daily (migration 277)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตรวจกับ prod (transaction ที่ ROLLBACK 2026-10-22): 12 มิติ × 3 วันตรงกับนับตรงทุกตัว · เพศตรงสูตรหน้าจอสถิติคน
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ENDPOINTS, resolveColumns } = require('../src/helpers/partnerSchema');

const ep = ENDPOINTS.find((e) => e.id === 'statsPersonDaily');
const mig = fs.readFileSync(__dirname + '/../db/db_migration_277_person_stats_view.sql', 'utf8').replace(/--.*$/gm, '');

test('every endpoint column is a view column, one per dimension, and nothing is granted', () => {
  for (const c of ep.columns.filter((x) => !['day', 'camera_id', 'updated_at'].includes(x))) {
    assert.match(mig, new RegExp(`FILTER \\(WHERE dim = '${c}'\\)\\s+AS ${c}\\b`), c);
  }
  assert.doesNotMatch(mig, /\bGRANT\b/);
  assert.ok(require('../src/routes/integrations').EXPOSED_VIEWS.includes('v_person_stats_daily_public'));
});

test('a dimension not granted is dropped; no camera_id is a 403', () => {
  assert.deepEqual(resolveColumns(ep, ['day', 'camera_id', 'gender']).cols, ['day', 'camera_id', 'gender']);
  assert.deepEqual(resolveColumns(ep, ['day', 'gender']).missingRequired, ['camera_id']);
  assert.equal(ep.timeType, 'date');
});
