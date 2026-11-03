// ============================================================
// Vigil Platform — Tests: partner เข้าถึง DB ได้ทางเดียว (helpers/asPartnerRole.js · รวมสำเนา 2026-10-22)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เดิม partner-api.partnerQuery() กับ preview ของแอดมินเป็นสำเนากัน · แก้ที่เดียวอีกที่เพี้ยนเงียบได้ (GOTCHAS #145)
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { asPartnerRole } = require('../src/helpers/asPartnerRole');

test('partner-api has no role-switching code of its own; it delegates to asPartnerRole', () => {
  const src = fs.readFileSync(__dirname + '/../src/routes/partner-api.js', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /require\('\.\.\/helpers\/asPartnerRole'\)/);
  assert.match(src, /const partnerQuery = \(dbRole\) => \(sql, params\) => asPartnerRole\(pool, dbRole, sql, params\);/);
  assert.doesNotMatch(src, /query\(\s*[`'"](SET (LOCAL )?ROLE|SELECT current_user|BEGIN)/, 'no second copy of the role switch');
  assert.doesNotMatch(src, /req\.partnerQuery = .*pool\.query/, 'partner queries never run on the bare pool');
});

function fakePool(whoami) {
  const log = []; let released = 0;
  return { log, get released() { return released; }, async connect() {
    return { async query(sql) { log.push(sql); if (/current_user/.test(sql)) return { rows: [{ u: whoami }] }; return { rows: [{ ok: 1 }] }; },
      release() { released++; } };
  } };
}

test('wears the role inside a transaction, with the 5 s ceiling, then commits', async () => {
  const pool = fakePool('p1_ro');
  const r = await asPartnerRole(pool, 'p1_ro', 'SELECT 1');
  assert.deepEqual(r.rows, [{ ok: 1 }]);
  assert.deepEqual(pool.log, ['BEGIN', "SET LOCAL statement_timeout = '5s'", 'SET LOCAL ROLE p1_ro', 'SELECT current_user AS u', 'SELECT 1', 'COMMIT']);
  assert.equal(pool.released, 1);
});

test('refuses to return data when the role was not actually assumed, and rolls back', async () => {
  const pool = fakePool('vigil_sql');
  await assert.rejects(asPartnerRole(pool, 'p1_ro', 'SELECT secret'), /role not assumed/);
  assert.ok(!pool.log.includes('SELECT secret'));
  assert.equal(pool.log.at(-1), 'ROLLBACK');
  assert.equal(pool.released, 1);
});

test('rejects a malformed role name before touching the database', async () => {
  const pool = fakePool('x');
  for (const bad of ['p1_ro; DROP TABLE x', 'P1', '', null, 'a']) await assert.rejects(asPartnerRole(pool, bad, 'SELECT 1'), /malformed role/);
  assert.equal(pool.log.length, 0);
});
