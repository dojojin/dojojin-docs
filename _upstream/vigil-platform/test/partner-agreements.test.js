// ============================================================
// Vigil Platform — Tests: ทะเบียนข้อตกลงข้อมูลของ partner (migration 269)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('../src/node_modules/express');

const store = [];
const pool = {
  async query(sql) {
    if (/FROM api_consumers/.test(sql)) return { rows: [{ id: 1, db_role: 'p1_ro' }] };
    if (/information_schema\.columns/.test(sql)) return { rows: [{ table_name: 'v_cameras_public', column_name: 'id' }] };
    if (/FROM api_consumer_agreements/.test(sql)) return { rows: store.slice().reverse() };
    throw new Error('unexpected: ' + sql.slice(0, 50));
  },
  async connect() {
    return { async query(sql, p) {
      if (/FROM api_consumers/.test(sql)) return { rows: [{ id: 1, db_role: 'p1_ro' }] };
      if (/information_schema\.columns/.test(sql)) return { rows: [{ table_name: 'v_cameras_public', column_name: 'id' }] };
      if (/INSERT INTO api_consumer_agreements/.test(sql)) { store.push({ version: store.length + 1, grants: JSON.parse(p[7]), purpose: p[1] }); return { rows: [{ version: store.length }] }; }
      return { rows: [] };
    }, release() {} };
  },
};
async function call(method, body) {
  const app = express(); app.use(express.json());
  const audits = [];
  require('../src/routes/integrations')(app, pool, { auth: { requireAdmin: (q, r, n) => { q.user = { id: 1, username: 'u' }; n(); }, logAudit: (...a) => audits.push(a) }, getIP: () => '' });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/integrations/p1/agreements`,
      { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json(), audits };
  } finally { srv.close(); }
}
const OK = { purpose: 'ติดตามรถเข้าออก', legalBasis: 'contract', approvedBy: 'Dojo-mAn' };

test('rejects a record without purpose, approver or a known legal basis', async () => {
  assert.equal((await call('POST', { ...OK, purpose: ' ' })).status, 400);
  assert.equal((await call('POST', { ...OK, approvedBy: '' })).status, 400);
  assert.equal((await call('POST', { ...OK, legalBasis: 'because' })).status, 400);
  assert.equal((await call('POST', { ...OK, validUntil: '31/12/2026' })).status, 400);
});

test('saving appends a version with a grants snapshot and writes an audit row; reading shows no drift', async () => {
  const r = await call('POST', OK);
  assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  assert.deepEqual(store[0].grants, { v_cameras_public: ['id'] });
  assert.equal(r.audits[0][2], 'integration_agreement');
  const g = await call('GET');
  assert.equal(g.body.drift, false);
  assert.equal(g.body.agreements.length, 1);
});

test('migration 269 creates the table, versions uniquely, and strips the group role', () => {
  const sql = fs.readFileSync(__dirname + '/../db/db_migration_269_partner_agreements.sql', 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS api_consumer_agreements/);
  assert.match(sql, /UNIQUE \(consumer_id, version\)/);
  assert.match(sql, /REVOKE ALL ON %I FROM third_party_readonly/);
  assert.doesNotMatch(sql, /GRANT SELECT/);
});
