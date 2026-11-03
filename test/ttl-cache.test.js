// ============================================================
// Vigil Platform — Tests: helpers/ttlCache
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTtlCache, listCaches } = require('../src/helpers/ttlCache');

// injected clock — no timers, no real waiting
function clock(start = 1_000_000) {
  const c = { t: start };
  c.now = () => c.t;
  c.advance = (ms) => { c.t += ms; };
  return c;
}

describe('ttlCache', () => {
  it('get returns the value until the TTL expires, then undefined', () => {
    const c = clock();
    const cache = createTtlCache({ name: 't-ttl', ttlMs: 1000, now: c.now });
    cache.set('k', 'v');
    assert.equal(cache.get('k'), 'v');
    c.advance(999);
    assert.equal(cache.get('k'), 'v');
    c.advance(1);                       // exactly at expiry = expired
    assert.equal(cache.get('k'), undefined);
    assert.equal(cache.peek('k'), 'v'); // peek ignores TTL
    assert.equal(cache.get('missing'), undefined);
  });

  it('set honours a per-entry TTL override (lpr period TTLs)', () => {
    const c = clock();
    const cache = createTtlCache({ name: 't-override', ttlMs: 1000, now: c.now });
    cache.set('short', 1);
    cache.set('long', 2, { ttlMs: 60_000 });
    c.advance(2000);
    assert.equal(cache.get('short'), undefined);
    assert.equal(cache.get('long'), 2);
  });

  it('wrap single-flights: 5 concurrent callers run the loader once', async () => {
    const cache = createTtlCache({ name: 't-flight', ttlMs: 1000 });
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const loader = () => { calls++; return gate.then(() => 'payload'); };

    const all = Promise.all([1, 2, 3, 4, 5].map(() => cache.wrap('k', loader)));
    assert.equal(cache.stats().inflight, 1);
    release();
    const results = await all;
    assert.deepEqual(results, ['payload', 'payload', 'payload', 'payload', 'payload']);
    assert.equal(calls, 1);
    assert.equal(cache.stats().inflight, 0);
    assert.equal(cache.get('k'), 'payload');
  });

  it('wrap stamps the TTL from load START, not from completion', async () => {
    const c = clock();
    const cache = createTtlCache({ name: 't-start', ttlMs: 1000, now: c.now });
    await cache.wrap('k', async () => { c.advance(900); return 'v'; });
    assert.equal(cache.get('k'), 'v');
    c.advance(100);                     // 900 + 100 = the full 1000ms budget
    assert.equal(cache.get('k'), undefined);
  });

  it('a rejection evicts the pending entry and rethrows; next call retries', async () => {
    const cache = createTtlCache({ name: 't-reject', ttlMs: 60_000 });
    let calls = 0;
    await assert.rejects(
      cache.wrap('k', async () => { calls++; throw new Error('boom'); }),
      /boom/);
    assert.equal(cache.peek('k'), undefined);
    await assert.rejects(cache.wrap('k', async () => { calls++; throw new Error('boom'); }), /boom/);
    assert.equal(calls, 2);             // not poisoned for the TTL
    assert.equal(cache.stats().size, 0);
  });

  it('staleOnError:true serves the previous value and counts it', async () => {
    const c = clock();
    const cache = createTtlCache({ name: 't-stale', ttlMs: 1000, now: c.now });
    await cache.wrap('k', async () => 'good');
    c.advance(2000);
    const v = await cache.wrap('k', async () => { throw new Error('down'); }, { staleOnError: true });
    assert.equal(v, 'good');
    assert.equal(cache.stats().stale, 1);
    // the stale value survives the failed load, so the next failure serves it too
    assert.equal(cache.peek('k'), 'good');
    assert.equal(await cache.wrap('k', async () => { throw new Error('down'); }, { staleOnError: true }), 'good');
    // …with no previous value there is nothing to serve — it rethrows
    await assert.rejects(cache.wrap('fresh', async () => { throw new Error('down'); }, { staleOnError: true }), /down/);
  });

  it('staleOnError as a predicate passes through the codes it rejects (hcp 400/409)', async () => {
    const c = clock();
    const cache = createTtlCache({ name: 't-stale-fn', ttlMs: 1000, now: c.now });
    const notUserError = (e) => !(e.code === 400 || e.code === 409);
    await cache.wrap('k', async () => 'good');
    c.advance(2000);

    const userErr = Object.assign(new Error('bad range'), { code: 400 });
    await assert.rejects(cache.wrap('k', async () => { throw userErr; }, { staleOnError: notUserError }), /bad range/);

    const edgeErr = Object.assign(new Error('edge down'), { code: 502 });
    assert.equal(await cache.wrap('k', async () => { throw edgeErr; }, { staleOnError: notUserError }), 'good');
    assert.equal(cache.stats().stale, 1);
  });

  it('scope composes the key: same sites + different cameras = different entries', async () => {
    const cache = createTtlCache({ name: 't-scope', ttlMs: 60_000 });
    const a = [1, 2]; a.cameras = ['cam-a'];
    const b = [1, 2]; b.cameras = ['cam-b'];
    assert.equal(await cache.wrap('facets', async () => 'A', { scope: a }), 'A');
    assert.equal(await cache.wrap('facets', async () => 'B', { scope: b }), 'B');
    assert.equal(await cache.wrap('facets', async () => 'later', { scope: a }), 'A');
    // null scope (admin) is its own entry, and is NOT skipped like undefined
    assert.equal(await cache.wrap('facets', async () => 'ALL', { scope: null }), 'ALL');
    assert.equal(cache.stats().size, 3);
    assert.equal(cache.peek('facets'), undefined);   // unscoped key untouched
  });

  // acuseek แต่งท่านี้เอง (stale-while-revalidate): peek ตอบด้วยของเก่าทันที แล้วเตะ
  // โหลดเบื้องหลัง — ผู้ใช้ต้องไม่รอ edgeCall 120 วิ เพียงเพราะแมปหมดอายุ
  //
  // 🔴 ที่แยก "ช่องเก็บค่า" กับ "ช่องกันโหลดซ้อน" เป็นคนละคีย์ เพราะระหว่าง wrap โหลด
  //    มันแทน entry เดิมด้วย entry ที่ยังไม่มีค่า ⇒ peek ของคีย์นั้นบอด · ถ้าใช้คีย์เดียว
  //    คำขอที่สองระหว่างรีเฟรชจะตกไปรอโหลดจริง ซึ่งคือสิ่งที่ท่านี้ตั้งใจเลี่ยง
  it('peek + wrap compose into stale-while-revalidate', async () => {
    const c = clock();
    const cache = createTtlCache({ name: 't-swr', ttlMs: 1000, max: 4, now: c.now });
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const load = async () => { calls++; await gate; return 'new'; };
    const refresh = () => cache.wrap('load', async () => cache.set('map', await load()), { ttlMs: 0 });
    const swr = () => {
      const stale = cache.peek('map');
      if (!stale) return refresh();
      if (cache.get('map') === undefined) refresh().catch(() => {});
      return Promise.resolve(stale);
    };

    cache.set('map', 'old');
    assert.equal(await swr(), 'old');
    assert.equal(calls, 0);                 // ยังสด = ไม่โหลด
    c.advance(2000);                        // หมดอายุ
    assert.equal(await swr(), 'old');       // ได้ของเก่าทันที ทั้งที่ loader ยังค้างที่ gate
    assert.equal(await swr(), 'old');       // คำขอที่สองระหว่างรีเฟรชก็ไม่รอ
    assert.equal(calls, 1);                 // และไม่โหลดซ้ำ — single-flight ของ wrap
    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(cache.get('map'), 'new');  // ของใหม่ลงช่องเก็บค่าแล้ว
  });

  it('evicts past max, oldest-touched first', () => {
    const cache = createTtlCache({ name: 't-max', ttlMs: 60_000, max: 3 });
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
    cache.get('a');                     // touch → 'b' is now the oldest
    cache.set('d', 4);
    assert.equal(cache.stats().size, 3);
    assert.equal(cache.peek('b'), undefined);
    assert.deepEqual([cache.get('a'), cache.get('c'), cache.get('d')], [1, 3, 4]);
    assert.equal(cache.stats().evictions, 1);
  });

  it('stats and delete/clear track what happened', async () => {
    const cache = createTtlCache({ name: 't-stats', ttlMs: 60_000 });
    assert.equal(cache.get('nope'), undefined);          // miss
    await cache.wrap('k', async () => 'v');              // miss
    await cache.wrap('k', async () => 'v2');             // hit
    assert.equal(cache.get('k'), 'v');                   // hit
    const st = cache.stats();
    assert.equal(st.name, 't-stats');
    assert.equal(st.hits, 2);
    assert.equal(st.misses, 2);
    assert.equal(st.size, 1);
    assert.equal(st.inflight, 0);
    assert.equal(cache.delete('k'), true);
    cache.set('x', 1); cache.clear();
    assert.equal(cache.stats().size, 0);
  });

  it('listCaches reports every cache created in the process', () => {
    const before = listCaches().length;
    const cache = createTtlCache({ name: 't-registry', ttlMs: 10 });
    cache.set('k', 'v');
    const rows = listCaches();
    assert.equal(rows.length, before + 1);
    const mine = rows.find((r) => r.name === 't-registry');
    assert.deepEqual(mine, { name: 't-registry', size: 1, hits: 0, misses: 0, inflight: 0, stale: 0, evictions: 0 });
  });
});

// staleWhileRevalidate (audit 2026-10-02 · O2)
it('staleWhileRevalidate serves the previous value at once and refreshes in the background', async () => {
  let t = 0;
  const c = createTtlCache({ name: 't-swr', ttlMs: 100, now: () => t });
  let n = 0;
  let release;
  const slow = () => new Promise((r) => { release = () => r(++n); });
  const tick = () => new Promise((r) => setImmediate(r));
  const first = c.wrap('k', slow, { staleWhileRevalidate: true }); await tick(); release(); assert.equal(await first, 1);
  t = 150;                                                    // expired
  const v = await c.wrap('k', slow, { staleWhileRevalidate: true });
  assert.equal(v, 1, 'stale value returned without waiting');
  assert.equal(await c.wrap('k', slow, { staleWhileRevalidate: true }), 1, 'still stale while reload in flight');
  await tick(); release(); await tick();
  assert.equal(await c.wrap('k', slow, { staleWhileRevalidate: true }), 2, 'fresh after reload');
});

it('staleWhileRevalidate does not serve values older than maxStaleMs, and is off by default', async () => {
  let t = 0;
  const c = createTtlCache({ name: 't-swr2', ttlMs: 100, now: () => t });
  await c.wrap('k', async () => 'old', { staleWhileRevalidate: true });
  t = 100 + 600;                                              // > 5×TTL past expiry
  assert.equal(await c.wrap('k', async () => 'new', { staleWhileRevalidate: true }), 'new');
  t = 2000;
  assert.equal(await c.wrap('k', async () => 'newer'), 'newer', 'default: wait for the load');
});

it('a caller without staleWhileRevalidate waits for the in-flight reload instead of getting stale data', async () => {
  let t = 0;
  const c = createTtlCache({ name: 't-swr3', ttlMs: 100, now: () => t });
  const tick = () => new Promise((r) => setImmediate(r));
  await c.wrap('k', async () => 'old', { staleWhileRevalidate: true });
  t = 150;
  let release;
  const reload = () => new Promise((r) => { release = () => r('new'); });
  assert.equal(await c.wrap('k', reload, { staleWhileRevalidate: true }), 'old');
  const plain = c.wrap('k', async () => 'unused');            // no option → joins the reload
  await tick(); release();
  assert.equal(await plain, 'new');
});
