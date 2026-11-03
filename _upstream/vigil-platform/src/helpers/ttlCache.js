// ============================================================
// Vigil Platform — TTL cache (in-process, per-route)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// One implementation of "Map + TTL" for the route layer. Twelve files each had
// their own; the 2026-09-06 cross-scope leak (GOTCHAS #190, decision #266)
// happened because every one of them composed its own cache key. `wrap({scope})`
// makes the scope component impossible to forget.
//
// Three things worth knowing before using it:
//
// 1. TTL counts from when the load STARTS, not when it finishes — health.js
//    depends on this (a 35s TTL against a 15s poll only clears two intervals if
//    the stamp is taken at the start).
// 2. `get`/`wrap` hits move the key to the end of the Map, so eviction is LRU,
//    not "oldest computed". lpr-query's warm loop relies on it: it touches the
//    `month` key on off-cadence passes purely to keep the most expensive entry
//    from being pushed out by user filter traffic.
// 3. An expired entry is kept until it is overwritten or evicted, because
//    `peek` and `staleOnError` need it. A rejected load restores the previous
//    (expired) value rather than deleting it, so a backend outage keeps serving
//    the last good answer for as long as the slot survives.
'use strict';

const { flight } = require('./requestDb');

const _registry = [];

/**
 * @param {object} opts
 * @param {string} opts.name    label shown in listCaches() / health diagnostics
 * @param {number} opts.ttlMs   default TTL
 * @param {number} [opts.max]   soft ceiling; oldest-touched entry is dropped past it
 * @param {() => number} [opts.now]  injectable clock (tests)
 */
function createTtlCache({ name, ttlMs, max = 64, now = Date.now }) {
  const map = new Map();   // key -> { value, hasValue, promise, expiresAt }
  const s = { name, hits: 0, misses: 0, inflight: 0, stale: 0, evictions: 0 };

  const touch = (key, e) => { map.delete(key); map.set(key, e); };

  function evict() {
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
      s.evictions++;
    }
  }

  function get(key) {
    const e = map.get(key);
    if (!e || !e.hasValue || e.expiresAt <= now()) { s.misses++; return undefined; }
    s.hits++;
    touch(key, e);
    return e.value;
  }

  function set(key, value, { ttlMs: override } = {}) {
    map.delete(key);
    map.set(key, {
      value, hasValue: true, promise: null,
      expiresAt: now() + (override === undefined ? ttlMs : override),
    });
    evict();
    return value;
  }

  // staleWhileRevalidate (opt-in): หมดอายุแล้วแต่ยังมีค่าเก่า และเก่าไม่เกิน `maxStaleMs` → ตอบค่าเก่าทันที
  // แล้วโหลดใหม่เบื้องหลัง (ผู้เรียกคนต่อไประหว่างโหลดก็ได้ค่าเก่า) · ใช้กับหน้าที่ poll ถี่เท่ากับ TTL
  // ซึ่งไม่งั้นแทบทุกรอบพลาด cache แล้วต้องรอโหลดเต็ม (executive-summary · audit 2026-10-02 · O2)
  function wrap(key, loader, { ttlMs: override, scope, staleOnError, staleWhileRevalidate, maxStaleMs } = {}) {
    // lazy require: auth.js pulls in helpers, so a top-level require cycles
    const k = scope !== undefined
      ? `${key}|${require('../auth').scopeCacheKey(scope)}`
      : key;

    const e = map.get(k);
    if (staleWhileRevalidate && e && e.promise && e.swrValue !== undefined) { s.stale++; touch(k, e); return Promise.resolve(e.swrValue); }
    if (e && e.promise && !e.flight?.cancelled) { s.hits++; e.flight?.join(); return e.promise; }   // single-flight
    if (e && e.hasValue && e.expiresAt > now()) {
      s.hits++; touch(k, e);
      return Promise.resolve(e.value);
    }
    s.misses++;

    const prev = e && e.hasValue ? e : null;   // last value, already expired
    const entry = {
      value: undefined, hasValue: false, promise: null,
      expiresAt: now() + (override === undefined ? ttlMs : override),   // from load START
    };
    // ค่าเก่าที่ยังใช้ได้ระหว่างโหลดใหม่ (เฉพาะผู้ที่ขอ staleWhileRevalidate)
    const ttlUsed = override === undefined ? ttlMs : override;
    const serveStale = staleWhileRevalidate && prev
      && now() - prev.expiresAt <= (maxStaleMs === undefined ? 5 * ttlUsed : maxStaleMs);
    if (serveStale) entry.swrValue = prev.value;
    map.delete(k); map.set(k, entry);
    s.inflight++;

    // flight: ยกเลิกคิวรีของการโหลดเมื่อทุกคนที่รอทิ้งหน้าแล้วเท่านั้น (requestDb · GOTCHAS #234)
    //        ผู้ที่ได้ค่าเก่า (serveStale) ไม่ได้รอ จึงไม่ join — โหลดเบื้องหลังนั้นไม่ถูกยกเลิก
    const fl = entry.flight = flight({ label: name });
    entry.promise = Promise.resolve().then(() => fl.run(loader)).then(
      (value) => {
        s.inflight--;
        if (map.get(k) === entry) {   // identity guard: a newer load may own the key
          entry.value = value; entry.hasValue = true; entry.promise = null; delete entry.swrValue;
          evict();
        }
        return value;
      },
      (err) => {
        s.inflight--;
        // The pending (rejected) entry must go in BOTH branches, or every later
        // caller awaits an already-rejected promise for the rest of the TTL.
        if (map.get(k) === entry) { if (prev) map.set(k, prev); else map.delete(k); }
        let useStale = false;
        try {
          useStale = !!prev && (staleOnError === true
            || (typeof staleOnError === 'function' && staleOnError(err)));
        } catch { useStale = false; }   // bookkeeping never throws
        if (useStale) { s.stale++; return prev.value; }
        throw err;
      },
    );
    evict();
    if (serveStale) {
      entry.promise.catch(() => {});   // โหลดเบื้องหลังล้ม — ไม่ปล่อย unhandled rejection (ค่าเก่าถูกคืนไว้แล้วด้านบน)
      s.stale++;
      return Promise.resolve(prev.value);
    }
    fl.join();
    return entry.promise;
  }

  /** last stored value ignoring TTL — for callers that judge staleness themselves */
  function peek(key) {
    const e = map.get(key);
    return e && e.hasValue ? e.value : undefined;
  }

  const cache = {
    get, set, wrap, peek,
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    stats: () => ({ ...s, size: map.size }),
  };
  _registry.push(cache);
  return cache;
}

/** stats() of every cache created in this process — /api/health/details */
const listCaches = () => _registry.map((c) => c.stats());

module.exports = { createTtlCache, listCaches };
