// Vigil Platform — heavyRunner (single-flight + concurrency cap)
// ไม่แตะเครือข่าย/DB: loader เป็น stub ล้วน
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHeavyRunner } = require('../src/helpers/heavyRunner');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

test('same key shares one computation', async () => {
  const r = createHeavyRunner({ limit: 1 });
  let calls = 0;
  const d = deferred();
  const loader = () => { calls++; return d.p; };
  const ps = [r.run('k', loader), r.run('k', loader), r.run('k', loader)];
  d.res(42);
  assert.deepEqual(await Promise.all(ps), [42, 42, 42]);
  assert.equal(calls, 1);
  assert.equal(r.stats().flights, 0);
});

test('limit caps concurrency and queues FIFO', async () => {
  const r = createHeavyRunner({ limit: 2 });
  let live = 0, peak = 0;
  const order = [];
  const mk = (n) => () => { live++; peak = Math.max(peak, live); order.push(n); return tick(15).then(() => { live--; return n; }); };
  const out = await Promise.all([1, 2, 3, 4, 5].map((n) => r.run('k' + n, mk(n))));
  assert.deepEqual(out, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test('queued caller that leaves never runs its loader', async () => {
  const r = createHeavyRunner({ limit: 1 });
  const hold = deferred();
  const first = r.run('a', () => hold.p);
  let ran = false;
  const ac = new AbortController();
  const second = r.run('b', () => { ran = true; return 1; }, ac.signal);
  ac.abort();
  await assert.rejects(second, { code: 'HEAVY_ABANDONED' });
  hold.res('ok');
  await first;
  await tick();
  assert.equal(ran, false);
  assert.deepEqual(r.stats(), { running: 0, queued: 0, flights: 0 });
});

test('flight survives while at least one waiter remains', async () => {
  const r = createHeavyRunner({ limit: 1 });
  const hold = deferred();
  const first = r.run('a', () => hold.p);
  let calls = 0;
  const ac1 = new AbortController();
  const w1 = r.run('b', () => { calls++; return 'B'; }, ac1.signal);
  const w2 = r.run('b', () => { calls++; return 'B2'; });   // same flight, no signal
  ac1.abort();                                              // one of two leaves
  hold.res('ok');
  await first;
  assert.equal(await w2, 'B');
  assert.equal(await w1, 'B');
  assert.equal(calls, 1);
});

test('a running computation is not cancelled when its waiter leaves', async () => {
  const r = createHeavyRunner({ limit: 1 });
  const d = deferred();
  const ac = new AbortController();
  let ran = false;
  const p = r.run('a', () => { ran = true; return d.p; }, ac.signal);
  await tick();
  ac.abort();
  d.res('done');
  assert.equal(await p, 'done');
  assert.equal(ran, true);
});

test('waiting past maxWaitMs fails HEAVY_BUSY and frees the queue', async () => {
  const r = createHeavyRunner({ limit: 1, maxWaitMs: 30 });
  const hold = deferred();
  const first = r.run('a', () => hold.p);
  await assert.rejects(r.run('b', () => 1), { code: 'HEAVY_BUSY' });
  assert.equal(r.stats().queued, 0);
  hold.res(1);
  await first;
});

test('a failing loader releases its slot', async () => {
  const r = createHeavyRunner({ limit: 1 });
  await assert.rejects(r.run('a', () => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await r.run('b', () => 'next'), 'next');
  assert.deepEqual(r.stats(), { running: 0, queued: 0, flights: 0 });
});

test('a new request after completion computes again (no stale flight)', async () => {
  const r = createHeavyRunner({ limit: 1 });
  let n = 0;
  await r.run('k', () => ++n);
  await tick();
  assert.equal(await r.run('k', () => ++n), 2);
});
