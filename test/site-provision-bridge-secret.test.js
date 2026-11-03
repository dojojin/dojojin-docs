// ============================================================
// Vigil Platform — Tests: site-provision.js stores bridge_password_enc
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Owner decision #2 (2026-09-27): provisionSite() now also stores an
// encryptPii() copy of the freshly-generated bridge password in
// sites.bridge_password_enc, so a future broker swap doesn't need to ssh into
// every edge to read src/.env again.
//
// Two things must hold:
//   1. Encryption happens BEFORE any broker call — a missing
//      BLACKLIST_SECRET_KEY must abort with ZERO broker side effects, not
//      leave a broker holding a password nobody was shown.
//   2. The password is never logged in plaintext, anywhere in the flow.
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const MODULE = path.join(__dirname, '..', 'src', 'site-provision.js');
const brokerAdmin = require('../src/helpers/brokerAdmin');
const { decryptPii } = require('../src/helpers/blacklist-crypto');

function freshSiteProvision() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

function fakePool() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO sites/i.test(sql)) return { rows: [{ id: 7, code: params[0], name: params[1], color: params[2] }] };
      if (/UPDATE sites SET bridge_password_enc/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

function captureConsole() {
  const lines = [];
  const prevLog = console.log, prevWarn = console.warn;
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => { console.log = prevLog; console.warn = prevWarn; } };
}

test('provisionSite stores an encrypted, round-trippable copy of the password', async (t) => {
  process.env.BLACKLIST_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  t.mock.method(brokerAdmin, 'ensureAuthzSource', async () => 'exists');
  t.mock.method(brokerAdmin, 'upsertUser', async () => 'created');
  t.mock.method(brokerAdmin, 'setSiteAcl', async () => 'updated');
  t.after(() => { delete process.env.BLACKLIST_SECRET_KEY; });

  const { provisionSite } = freshSiteProvision();
  const pool = fakePool();
  const out = await provisionSite(pool, { code: 'hdy', name: 'HDY' });

  const upd = pool.queries.find((q) => /UPDATE sites SET bridge_password_enc/i.test(q.sql));
  assert.ok(upd, 'must write bridge_password_enc');
  assert.notEqual(upd.params[1], out.mqtt.password, 'must not store the plaintext password');
  assert.equal(decryptPii(upd.params[1]), out.mqtt.password, 'stored value must decrypt back to the shown password');
});

test('provisionSite: missing BLACKLIST_SECRET_KEY aborts BEFORE any broker call', async (t) => {
  delete process.env.BLACKLIST_SECRET_KEY;
  let brokerCalls = 0;
  t.mock.method(brokerAdmin, 'ensureAuthzSource', async () => { brokerCalls++; return 'exists'; });
  t.mock.method(brokerAdmin, 'upsertUser', async () => { brokerCalls++; return 'created'; });
  t.mock.method(brokerAdmin, 'setSiteAcl', async () => { brokerCalls++; return 'updated'; });

  const { provisionSite } = freshSiteProvision();
  const pool = fakePool();
  await assert.rejects(() => provisionSite(pool, { code: 'hdy', name: 'HDY' }), /BLACKLIST_SECRET_KEY/);
  assert.equal(brokerCalls, 0, 'must not touch the broker when encryption cannot happen');
  // The idempotent `sites` row upsert (ON CONFLICT DO UPDATE, no secret in it)
  // is allowed to have run — it's harmless either order. What must NOT have
  // happened is any broker call and any bridge_password_enc write.
  assert.equal(pool.queries.find((q) => /UPDATE sites SET bridge_password_enc/i.test(q.sql)), undefined);
});

test('provisionSite: never logs the plaintext password, including on a DB write failure', async (t) => {
  process.env.BLACKLIST_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  t.mock.method(brokerAdmin, 'ensureAuthzSource', async () => 'exists');
  t.mock.method(brokerAdmin, 'upsertUser', async () => 'created');
  t.mock.method(brokerAdmin, 'setSiteAcl', async () => 'updated');
  t.after(() => { delete process.env.BLACKLIST_SECRET_KEY; });

  const { provisionSite } = freshSiteProvision();
  const pool = fakePool();
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (/UPDATE sites SET bridge_password_enc/i.test(sql)) throw new Error('db down');
    return origQuery(sql, params);
  };

  const { lines, restore } = captureConsole();
  let out;
  try { out = await provisionSite(pool, { code: 'hdy', name: 'HDY' }); }
  finally { restore(); }

  assert.equal(out.mqtt.password.length > 0, true, 'creds are still returned (best-effort DB write)');
  for (const line of lines) assert.equal(line.includes(out.mqtt.password), false, `console output leaked the password: ${line}`);
});

// ซ้อมกับ Mosquitto 2.1.2 จริง (28 ก.ย. 2569): createClient ที่อ้าง role ที่ยังไม่มีถูกปฏิเสธ
// ("Role not found") ⇒ provisionSite ต้องสร้างบัญชีโดยไม่ผูก role แล้วให้ setSiteAcl สร้างและผูก
test('provisionSite: upsertUser without a role, then setSiteAcl (role is created there)', async (t) => {
  process.env.BLACKLIST_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  const order = [];
  t.mock.method(brokerAdmin, 'ensureAuthzSource', async () => 'exists');
  t.mock.method(brokerAdmin, 'upsertUser', async (u, p, opts) => { order.push(['upsertUser', opts]); return 'created'; });
  t.mock.method(brokerAdmin, 'setSiteAcl', async (u, code) => { order.push(['setSiteAcl', code]); return 'updated'; });
  t.after(() => { delete process.env.BLACKLIST_SECRET_KEY; });

  const { provisionSite } = freshSiteProvision();
  await provisionSite(fakePool(), { code: 'newsite', name: 'New' });
  assert.deepEqual(order.map((x) => x[0]), ['upsertUser', 'setSiteAcl']);
  assert.ok(!order[0][1] || !order[0][1].role, 'upsertUser must not reference a role that setSiteAcl has not created yet');
  assert.equal(order[1][1], 'newsite');
});
