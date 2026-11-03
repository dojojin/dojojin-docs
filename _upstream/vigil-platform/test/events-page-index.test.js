// Vigil Platform — partial index ของหน้าเหตุการณ์ใช้ได้ต่อเมื่อ WHERE มีเงื่อนไขตรงตัวอักษรกับ predicate ของ index
// ถ้าใครแก้รายการตัดออกที่ฝั่งใดฝั่งหนึ่ง planner จะกลับไปอ่านทั้งล้านแถวเงียบ ๆ (ผลยังถูก แต่ช้า 40 เท่า) — เทสต์นี้กันไว้
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EXCLUDED, pageIndexSql, coversPageIndex } = require('../src/helpers/eventsPageIndex');
const ROOT = path.join(__dirname, '..');

test('migration predicate == helper list', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/db_migration_264_events_page_partial_index.sql'), 'utf8');
  assert.ok(sql.includes(`'{${EXCLUDED.join(',')}}'::text[]`), 'รายการใน migration ต้องตรงกับ helpers/eventsPageIndex.js');
  assert.ok(sql.includes("NOT LIKE '%Aggregation%'"));
});

test('snapshot camera index (278) uses the same predicate as the page index', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/db_migration_278_events_snapshot_camera_index.sql'), 'utf8');
  assert.ok(sql.includes(`'{${EXCLUDED.join(',')}}'::text[]`), 'รายการใน migration 278 ต้องตรงกับ helpers/eventsPageIndex.js');
  assert.ok(sql.includes("NOT LIKE '%Aggregation%'"));
  assert.ok(sql.includes('has_snapshot = true'));
  assert.match(fs.readFileSync(path.join(ROOT, 'src/routes/events.js'), 'utf8'), /AND e\.has_snapshot = TRUE/);
});

test('page/face camera indexes (279) use the exact predicates the routes send', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/db_migration_279_events_page_face_camera_index.sql'), 'utf8');
  assert.ok(sql.includes(`'{${EXCLUDED.join(',')}}'::text[]`), 'idx_events_page_cam_time ต้องใช้รายการเดียวกับ helpers/eventsPageIndex.js');
  const faces = fs.readFileSync(path.join(ROOT, 'src/routes/faces.js'), 'utf8');
  const cap = /const CAPTURE_TYPES_SQL = `([^`]+)`/.exec(faces)[1], rec = /const RECOG_TYPES_SQL\s+= `([^`]+)`/.exec(faces)[1];
  assert.ok(sql.includes(`event_type IN (${cap},${rec})`), 'idx_events_face_cam_time ต้องครอบทุกประเภทที่ /api/faces ขอ');
});

test('face group-name index (280) uses the exact expression and types of routes/faces.js', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/db_migration_280_events_face_group_name_index.sql'), 'utf8');
  const faces = fs.readFileSync(path.join(ROOT, 'src/routes/faces.js'), 'utf8');
  const expr = /const _fdLibName\s+= \(c = 'raw_json'\) => `([^`]+)`/.exec(faces)[1].replace(/\$\{c\}/g, 'raw_json');
  const rec = /const RECOG_TYPES_SQL\s+= `([^`]+)`/.exec(faces)[1];
  assert.ok(sql.includes(`((${expr}), event_time)`), 'นิพจน์ใน index ต้องตรงกับ _fdLibName() ไม่งั้น planner ไม่ใช้');
  assert.ok(sql.includes(`event_type IN (${rec})`));
});

test('dashboard sends a superset of the indexed list (Events + Snapshots pages)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'dashboard/event-domains.js'), 'utf8');
  const reg = [...src.matchAll(/^\s*'?([A-Za-z/]+)'?\s*:\s*\{\s*domain:/gm)].map((m) => m[1]);
  assert.ok(coversPageIndex(reg), 'specializedEventTypes() ต้องครอบรายการของ index ไม่งั้นหน้าเหตุการณ์จะไม่ใช้ index');
});

test('helper output', () => {
  assert.equal(pageIndexSql('e'), "e.event_type <> ALL ('{anprAlarm,FaceRecognition,FaceCapture,FaceDetector/Recognized,FaceDetector/Comparison}'::text[])");
  assert.equal(coversPageIndex(['anprAlarm']), false);
});

test('events route applies the literal predicate', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/routes/events.js'), 'utf8');
  assert.match(src, /coversPageIndex\(ex\)\) sql \+= ` AND \$\{pageIndexSql\('e'\)\}`/);
});
