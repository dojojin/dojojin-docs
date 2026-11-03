// ============================================================
// Vigil Platform — Tests: preview "สิ่งที่ partner ได้รับ" + asPartnerRole
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ขาดคอลัมน์บังคับ (id/เวลา/camera_id) = 403 ทั้งเส้น · ขาดคอลัมน์อื่น = ตัดฟิลด์นั้นออก (resolveColumns)
// และทุก query ของ preview ต้องรันในนาม role ของ partner ห้ามรันเป็น superuser ของ pool
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('../src/node_modules/express');
const { asPartnerRole } = require('../src/helpers/asPartnerRole');

// pool ปลอม: ตอบตามรูป SQL · บันทึกทุก query ที่รันผ่าน connection (ฝั่ง asPartnerRole)
function fakePool({ consumer, roleExists = true, missing = [], cams = [1, 2], row = { id: 1 }, whoami }) {
  const clientLog = [];
  return {
    clientLog,
    async query(sql, params) {
      if (/FROM api_consumers/.test(sql)) return { rows: consumer ? [consumer] : [] };
      if (/FROM pg_roles/.test(sql)) return { rows: roleExists ? [{ '?column?': 1 }] : [] };
      if (/has_column_privilege/.test(sql)) return { rows: missing.filter((m) => params[2].includes(m)).map((column_name) => ({ column_name })) };
      if (/FROM cameras c JOIN sites/.test(sql)) return { rows: cams.map((id) => ({ id })) };
      throw new Error('unexpected pool query: ' + sql.slice(0, 60));
    },
    async connect() {
      return {
        async query(sql) {
          clientLog.push(sql);
          if (/current_user/.test(sql)) return { rows: [{ u: whoami ?? consumer.db_role }] };
          if (/^SELECT /.test(sql.trim())) return { rows: row ? [row] : [] };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}
async function preview(pool, slug = 'p1') {
  const app = express();
  require('../src/routes/integrations')(app, pool, { auth: { requireAdmin: (q, r, n) => n() }, getIP: () => '' });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/integrations/${slug}/preview`);
    return { status: r.status, body: await r.json() };
  } finally { srv.close(); }
}
const C = { slug: 'p1', db_role: 'p1_ro', site_codes: null };

test('a missing key column is reported as forbidden with its name, and no query runs as the partner', async () => {
  const pool = fakePool({ consumer: C, missing: ['camera_id'] });
  const { body } = await preview(pool);
  const lpr = body.endpoints.find((e) => e.path === '/v1/lpr/events');
  assert.equal(lpr.status, 'forbidden');
  assert.deepEqual(lpr.missing, ['camera_id']);
  assert.equal(body.endpoints.find((e) => e.path === '/v1/cameras').status, 'ok');
  assert.ok(!pool.clientLog.some((q) => /v_license_plates_public/.test(q)), 'never queried the view it cannot read');
});

test('a missing non-key column is dropped from the SELECT, not a 403', async () => {
  const pool = fakePool({ consumer: C, missing: ['plate_number'] });
  const { body } = await preview(pool);
  const ev = body.endpoints.find((e) => e.path === '/v1/lpr/events');
  assert.equal(ev.status, 'ok');
  assert.deepEqual(ev.dropped, ['plate_number']);
  assert.equal(body.endpoints.find((e) => e.path === '/v1/lpr/search').status, 'forbidden');   // ค้นหาต้องใช้ plate_number
  const q = pool.clientLog.find((x) => /FROM v_license_plates_public/.test(x));
  assert.ok(q && !/plate_number/.test(q), 'selected only granted columns');
});

test('every preview query wears the partner role inside a transaction', async () => {
  const pool = fakePool({ consumer: C });
  const { body } = await preview(pool);
  assert.ok(body.endpoints.every((e) => e.status === 'ok'));
  const log = pool.clientLog.join('\n');
  assert.match(log, /BEGIN\nSET LOCAL statement_timeout = '5s'\nSET LOCAL ROLE p1_ro\nSELECT current_user/);
});

test('if the role is not actually assumed, the preview fails instead of returning data', async () => {
  const { status } = await preview(fakePool({ consumer: C, whoami: 'vigil_sql' }));
  assert.equal(status, 500);
});

test('no role, empty site scope, no recent rows, unknown consumer', async () => {
  assert.ok((await preview(fakePool({ consumer: C, roleExists: false }))).body.endpoints.every((e) => e.status === 'no-role'));
  const scoped = await preview(fakePool({ consumer: { ...C, site_codes: ['hkt'] }, cams: [] }));
  assert.ok(scoped.body.endpoints.every((e) => e.status === 'no-scope'));
  assert.ok((await preview(fakePool({ consumer: C, row: null }))).body.endpoints.every((e) => e.status === 'empty'));
  assert.equal((await preview(fakePool({ consumer: null }))).status, 404);
});

test('asPartnerRole refuses a malformed role name before touching the database', async () => {
  let connected = false;
  await assert.rejects(asPartnerRole({ connect: () => { connected = true; } }, 'x; DROP ROLE y', 'SELECT 1'), /malformed role/);
  assert.equal(connected, false);
});

test('the grant screen warns before revoking only an endpoint key field, and gets those fields from the API', () => {
  const fs = require('node:fs');
  const route = fs.readFileSync(__dirname + '/../src/routes/integrations.js', 'utf8');
  assert.match(route, /required: e\.requiredColumns,/);
  const page = fs.readFileSync(__dirname + '/../dashboard/page-integrations.js', 'utf8');
  assert.match(page, /_integData\.endpoints\.filter\(e => e\.view === view && \(e\.required \|\| e\.columns\)\.includes\(col\)\)/);
  // ข้อความบนจอต้องไม่บอกว่าถอนฟิลด์ไหนก็ 403 อีก (เคยค้างจากก่อนระยะ 2 ขั้น 1)
  const i18n = fs.readFileSync(__dirname + '/../dashboard/i18n.js', 'utf8');
  assert.doesNotMatch(i18n, /ปลดคอลัมน์ที่ endpoint ใช้ = endpoint นั้นตอบ 403/);
  assert.doesNotMatch(i18n, /removing a column an endpoint uses makes that whole endpoint return 403/);
});
