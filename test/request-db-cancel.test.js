// ============================================================
// Vigil Platform — Tests: helpers/requestDb.js — ยกเลิกคิวรีของคำขอ GET ที่ผู้ใช้ทิ้ง (perf ข้อ 1 ระยะ A)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const reqDb = require('../src/helpers/requestDb');

// pool ปลอมแบบ pg-pool: connect(cb) / connect() · query() ยืมผ่าน this.connect แล้ว release
function fakePool() {
  let next = 100;
  const log = [];
  const pool = {
    log,
    connect(cb) {
      const client = { processID: next++, release(err) { log.push(['release', this.processID, err]); } };
      if (cb) { setImmediate(() => cb(null, client, () => client.release())); return; }
      return Promise.resolve(client);
    },
    query(sql, args) {
      return new Promise((resolve) => this.connect((err, client) => {
        log.push(['query', client.processID, sql, args]);
        setImmediate(() => { client.release(); resolve({ rows: [] }); });
      }));
    },
  };
  return reqDb.wrapPool(pool);
}
function fakeReqRes(method = 'GET') {
  const res = new EventEmitter(); res.writableEnded = false;
  return { req: { method, path: '/api/x' }, res };
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
reqDb.flight.graceMs = 0;   // เทสต์ส่วนใหญ่ไม่ต้องรอช่วงผ่อนผัน — เทสต์ของมันเองตั้งค่าเอง

test('an abandoned GET cancels the query still running, and the pool destroys that connection', async () => {
  const pool = fakePool();
  const { req, res } = fakeReqRes();
  let client;
  await new Promise((done) => reqDb.middleware(req, res, async () => { client = await pool.connect(); done(); }));
  res.emit('close');                                   // ผู้ใช้ทิ้งก่อนตอบเสร็จ
  client.release();                                    // route คืน connection ระหว่างที่คำสั่งยกเลิกยังวิ่ง
  await tick(); await tick(); await tick();
  const cancel = pool.log.find((x) => x[0] === 'query' && /pg_cancel_backend/.test(x[2]));
  assert.ok(cancel, 'pg_cancel_backend issued');
  assert.deepEqual(cancel[3], [client.processID]);
  const rel = pool.log.find((x) => x[0] === 'release' && x[1] === client.processID);
  assert.ok(rel[2] instanceof Error, 'released with an error — a late cancel can never hit a later borrower');
});

test('a GET that finished normally cancels nothing', async () => {
  const pool = fakePool();
  const { req, res } = fakeReqRes();
  await new Promise((done) => reqDb.middleware(req, res, async () => { await pool.query('SELECT 1'); done(); }));
  res.writableEnded = true; res.emit('close');
  await tick();
  assert.ok(!pool.log.some((x) => /pg_cancel_backend/.test(x[2] || '')));
});

test('a connection already returned to the pool is never cancelled', async () => {
  const pool = fakePool();
  const { req, res } = fakeReqRes();
  await new Promise((done) => reqDb.middleware(req, res, async () => { await pool.query('SELECT 1'); done(); }));
  res.emit('close');                                   // ทิ้งหลังคิวรีจบและคืน connection แล้ว
  await tick();
  assert.ok(!pool.log.some((x) => /pg_cancel_backend/.test(x[2] || '')));
});

test('non-GET requests and work outside any request are not tracked', async () => {
  const pool = fakePool();
  const { req, res } = fakeReqRes('POST');
  let client;
  await new Promise((done) => reqDb.middleware(req, res, async () => { client = await pool.connect(); done(); }));
  res.emit('close'); await tick();
  assert.ok(!pool.log.some((x) => /pg_cancel_backend/.test(x[2] || '')));
  assert.equal(client.__reqDbTracked, undefined);
  const bg = await pool.connect();                     // งานเบื้องหลัง
  assert.equal(bg.__reqDbTracked, undefined);
});

// ผู้รอหลายคนรอผลเดียวกันผ่าน ttlCache · คืน { leave(i), finish(), loading[] , pool }
function sharedLoad(nWaiters, { background = false } = {}) {
  const { createTtlCache } = require('../src/helpers/ttlCache');
  const cache = createTtlCache({ name: 'test:reqdb:' + Math.random(), ttlMs: 1000 });
  const pool = fakePool();
  let letGo; const gate = new Promise((r) => { letGo = r; });
  const loader = async () => { const c = await pool.connect(); try { await gate; } finally { c.release(); } return 1; };
  const res = [], loading = [];
  for (let i = 0; i < nWaiters; i++) {
    const rr = fakeReqRes(); res.push(rr.res);
    loading.push(new Promise((done) => reqDb.middleware(rr.req, rr.res, () => done(cache.wrap('k', loader)))));
  }
  if (background) loading.push(cache.wrap('k', loader));          // งานเบื้องหลังรอผลเดียวกัน
  return { pool, loading, leave: (i) => res[i].emit('close'), finish: () => letGo(),
    cancels: () => pool.log.filter((x) => /pg_cancel_backend/.test(x[2] || '')).length };
}

test('a shared load is not cancelled while another request still waits for it', async () => {
  const t = sharedLoad(2);
  await tick(); await tick();
  t.leave(0);
  await settle();
  t.finish(); await (await t.loading[1]); await tick(); await tick();
  assert.equal(t.cancels(), 0);
});

test('a shared load is cancelled once every waiting request has left', async () => {
  const t = sharedLoad(2);
  await tick(); await tick();
  t.leave(0); t.leave(1);
  await settle();
  assert.equal(t.cancels(), 1);
  t.finish();
});

test('a shared load that background work also waits for is never cancelled', async () => {
  const t = sharedLoad(1, { background: true });
  await tick(); await tick();
  t.leave(0);
  t.finish(); await t.loading[1]; await tick(); await tick();
  assert.equal(t.cancels(), 0);
});

test('heavyRunner: the running computation is cancelled once its only waiter leaves', async () => {
  const { createHeavyRunner } = require('../src/helpers/heavyRunner');
  const runner = createHeavyRunner({ limit: 1 });
  const pool = fakePool();
  const { req, res } = fakeReqRes();
  let letGo; const gate = new Promise((r) => { letGo = r; });
  const p = new Promise((done) => reqDb.middleware(req, res, () =>
    done(runner.run('k', async () => { const c = await pool.connect(); try { await gate; } finally { c.release(); } }))));
  await tick(); await tick();
  res.emit('close');
  await settle();
  assert.equal(pool.log.filter((x) => /pg_cancel_backend/.test(x[2] || '')).length, 1);
  letGo(); await (await p);
});

test('a connection borrowed after the user left is not cancelled (timers and promises started by the request)', async () => {
  const pool = fakePool();
  const { req, res } = fakeReqRes();
  let later;
  await new Promise((done) => reqDb.middleware(req, res, () => done()));
  res.emit('close');
  await reqDb._als.run({ active: new Set(), killed: new Set(), done: true, cancelled: 0, rawQuery: null }, async () => { later = await pool.connect(); });
  await tick();
  assert.ok(!pool.log.some((x) => /pg_cancel_backend/.test(x[2] || '')));
  assert.equal(later.__reqDbTracked, undefined);
});

for (const how of ['answered', 'abandoned']) {
  test(`a join from a request already ${how} (a timer it started) pins the flight: the real waiter leaving does not cancel it`, async () => {
    const pool = fakePool();
    const fl = reqDb.flight();
    const old = fakeReqRes(); let oldCtx;
    await new Promise((r) => reqDb.middleware(old.req, old.res, () => { oldCtx = reqDb._als.getStore(); r(); }));
    if (how === 'answered') old.res.writableEnded = true;
    old.res.emit('close');
    let letGo; const gate = new Promise((r) => { letGo = r; });
    const run = fl.run(async () => { const c = await pool.connect(); try { await gate; } finally { c.release(); } });
    reqDb._als.run(oldCtx, () => fl.join());                     // timer ของคำขอที่จบไปแล้วมารอผล
    assert.equal(oldCtx.onAbandon.length, 0, 'nothing left queued on a context that will never close again');
    const live = fakeReqRes();
    await new Promise((r) => reqDb.middleware(live.req, live.res, () => { fl.join(); r(); }));
    await tick();
    live.res.emit('close');                                      // ผู้รอตัวจริงทิ้ง
    await settle();
    assert.equal(pool.log.filter((x) => /pg_cancel_backend/.test(x[2] || '')).length, 0);
    letGo(); await run;
  });
}

test('grace: a new waiter that arrives within the grace window (refresh) keeps the shared work; none arriving cancels it', async () => {
  const pool = fakePool();
  reqDb.flight.graceMs = 40;
  try {
    for (const rejoin of [true, false]) {
      const fl = reqDb.flight();
      let letGo; const gate = new Promise((r) => { letGo = r; });
      const run = fl.run(async () => { const c = await pool.connect(); try { await gate; } finally { c.release(); } });
      const a = fakeReqRes();
      await new Promise((r) => reqDb.middleware(a.req, a.res, () => { fl.join(); r(); }));
      await tick();
      const before = pool.log.filter((x) => /pg_cancel_backend/.test(x[2] || '')).length;
      a.res.emit('close');                                       // ผู้ใช้กด refresh
      await settle(10);
      if (rejoin) { const b = fakeReqRes(); await new Promise((r) => reqDb.middleware(b.req, b.res, () => { fl.join(); r(); })); }
      await settle(60);
      const n = pool.log.filter((x) => /pg_cancel_backend/.test(x[2] || '')).length - before;
      assert.equal(n, rejoin ? 0 : 1, rejoin ? 'rejoined within grace → kept' : 'nobody came back → cancelled');
      letGo(); await run;
    }
  } finally { reqDb.flight.graceMs = 0; }
});
