// ============================================================
// Vigil Platform — Tests: สิทธิ์ partner แบบ "ให้ตามความจำเป็น" (OpenAPI ระยะ 2 ขั้น 0)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// GRANT ทั้ง view ครอบคลุมคอลัมน์ที่จะเพิ่มในอนาคตด้วย (ทดสอบจริงกับ Postgres 2026-10-21) ⇒ ห้ามมีทางไหนให้สิทธิ์ทั้ง view
// partner ใหม่เริ่มที่ไม่มีอะไรเลย · audit ต้องบอกคอลัมน์ที่เพิ่ม/ถอนจริง · settings เปิดเฉพาะชื่อที่อนุญาต
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('../src/node_modules/express');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('a new partner starts with no data access and no third_party_readonly membership', () => {
  const s = rd('src/helpers/partnerAdmin.js');
  const create = s.slice(s.indexOf('async function createPartner'), s.indexOf('async function rotatePartner'))
    .replace(/^\s*\/\/.*$/gm, '');   // ตัด comment — ข้อความอธิบายของเดิมไม่ใช่โค้ด
  assert.doesNotMatch(create, /GRANT third_party_readonly/);
  assert.doesNotMatch(create, /GRANT SELECT/);
  assert.match(create, /GRANT USAGE ON SCHEMA public TO \$\{dbRole\}/);
});

// เส้นทางบันทึกสิทธิ์จริง ผ่าน pool ปลอมที่จด SQL ทุกบรรทัด
async function saveGrants(wanted, { before = [] } = {}) {
  const sql = [], audits = [];
  const cols = { v_cameras_public: ['id', 'name', 'latitude'], v_license_plates_public: ['id', 'plate_number', 'detected_at'] };
  // view อื่นทุกตัวที่แอดมินติ๊กได้ (ตามรายการจริง ไม่ฝังซ้ำ — view ใหม่เพิ่มเมื่อไรเทสต์ตามเอง)
  for (const v of require('../src/routes/integrations').EXPOSED_VIEWS) cols[v] ||= ['id'];
  const client = {
    async query(q, params) {
      sql.push(q);
      if (/FROM api_consumers .*FOR UPDATE/s.test(q)) return { rows: [{ id: 1, slug: 'p1', label: 'P1', db_role: 'p1_ro' }] };
      if (/FROM pg_roles/.test(q)) return { rows: [{ ok: 1 }] };
      if (/has_column_privilege/.test(q)) return { rows: before.map((k) => ({ table_name: k.split('.')[0], column_name: k.split('.')[1] })) };
      if (/FROM information_schema\.columns/.test(q)) return { rows: Object.entries(cols).flatMap(([t, cs]) => cs.map((c) => ({ table_name: t, column_name: c }))) };
      return { rows: [] };
    },
    release() {},
  };
  const app = express(); app.use(express.json());
  require('../src/routes/integrations')(app, { connect: async () => client, query: client.query },
    { auth: { requireAdmin: (q, r, n) => n(), logAudit: async (...a) => audits.push(a) }, getIP: () => '' });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/integrations/p1/grants`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grants: wanted }) });
    return { status: r.status, sql, audit: audits[0]?.[7] };
  } finally { srv.close(); }
}

test('ticking every column still grants column by column, never the whole view', async () => {
  const { status, sql } = await saveGrants({ v_cameras_public: { id: true, name: true, latitude: true } });
  assert.equal(status, 200);
  assert.ok(sql.includes('GRANT SELECT (id, name, latitude) ON v_cameras_public TO p1_ro'), sql.join('\n'));
  assert.ok(!sql.some((q) => /GRANT SELECT ON /.test(q)), 'no whole-view grant');
});

test('the audit row names the columns added and removed', async () => {
  const { audit } = await saveGrants(
    { v_license_plates_public: { id: true, detected_at: true } },
    { before: ['v_license_plates_public.id', 'v_license_plates_public.plate_number', 'v_cameras_public.name'] });
  assert.deepEqual(audit.added, ['v_license_plates_public.detected_at']);
  assert.deepEqual(audit.removed.sort(), ['v_cameras_public.name', 'v_license_plates_public.plate_number']);
});

test('migration 268: settings view is an allowlist, and partners are converted column by column', () => {
  const m = rd('db/db_migration_268_partner_column_grants.sql');
  assert.match(m, /WHERE key IN \('brand_name', 'display_timezone'/);
  const view = m.slice(m.indexOf('CREATE OR REPLACE VIEW v_system_settings_public'));
  assert.doesNotMatch(view, /NOT LIKE/);
  assert.match(m, /GRANT SELECT \(%s\) ON %I TO %I/);
  assert.doesNotMatch(m, /GRANT SELECT ON %I/);
  // คิดคอลัมน์ที่เห็นอยู่ก่อนถอนสิทธิ์ใด ๆ — ไม่งั้นสิทธิ์ที่มาจากกลุ่มจะหายไปก่อนถูกนับ
  assert.ok(m.indexOf('has_column_privilege') < m.indexOf("REVOKE ALL ON"));
  assert.ok(m.indexOf("REVOKE ALL ON") < m.indexOf("REVOKE third_party_readonly"));
});
