// ============================================================
// Vigil Platform — Heavy query runner (single-flight + concurrency cap)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Why: /api/lpr/stats fans out ~12 pool.query calls per request and the pool
// holds 15 connections. Two overlapping requests drain it and every list/search
// page behind them waits (2026-10-01: load 17, IO pressure 45%, 120 s timeouts).
// Three rules fix the shape of the damage, none of them changes any number:
//
//   1. single-flight  — callers with the same key share one computation
//   2. concurrency cap — at most `limit` computations run; the rest queue
//   3. leave the queue — a caller that disconnects before its turn costs nothing
//                        (refcounted: the flight is dropped only when the LAST
//                        waiter is gone; a running query is cancelled at the DB
//                        through requestDb.flight() once every waiting GET has left)
//
// A flight that waits longer than `maxWaitMs` for a slot fails with
// err.code === 'HEAVY_BUSY' so the route can answer 503 instead of piling up.
'use strict';

const { flight } = require('./requestDb');

function createHeavyRunner({ limit = 1, maxWaitMs = 45000 } = {}) {
  const flights = new Map();   // key -> { promise, refs, ac }
  const queue = [];            // waiting starters, FIFO
  let running = 0;

  const pump = () => {
    while (running < limit && queue.length) queue.shift()();
  };

  function start(loader, ac) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = queue.indexOf(go);
        if (i >= 0) { queue.splice(i, 1); reject(Object.assign(new Error('heavy runner busy'), { code: 'HEAVY_BUSY' })); }
      }, maxWaitMs);
      function go() {
        clearTimeout(timer);
        running++;
        // ปล่อยช่องก่อน settle: ผู้รอผลที่ตื่นขึ้นมาต้องเห็น running ที่นับถูกแล้ว
        const release = () => { running--; pump(); };
        Promise.resolve().then(loader).then((v) => { release(); resolve(v); }, (e) => { release(); reject(e); });
      }
      ac.signal.addEventListener('abort', () => {
        const i = queue.indexOf(go);
        if (i >= 0) { queue.splice(i, 1); clearTimeout(timer); reject(Object.assign(new Error('abandoned'), { code: 'HEAVY_ABANDONED' })); }
      }, { once: true });
      queue.push(go);
      pump();
    });
  }

  /**
   * @param {string} key      same key = same computation
   * @param {() => Promise}   loader
   * @param {AbortSignal} [signal]  caller left (fires once)
   */
  function run(key, loader, signal) {
    let f = flights.get(key);
    if (f && f.fl.cancelled) f = null;   // ทุกคนที่รอทิ้งไปแล้ว — เริ่มใหม่ ไม่ต่อคิวกับงานที่กำลังถูกยกเลิก
    if (!f) {
      const ac = new AbortController();
      // flight: คิวรีที่กำลังรันถูกยกเลิกเมื่อทุกคำขอที่รอทิ้งหน้าแล้ว (requestDb · GOTCHAS #234) · ที่ยังรอคิวถูกถอดออก
      const fl = flight({ onCancel: () => ac.abort(), label: String(key).split(/[|?]/)[0].slice(0, 40) });   // ส่วนหน้าของ key เท่านั้น — กัน query string ลง log
      f = { refs: 0, ac, fl };
      f.promise = start(() => fl.run(loader), ac);
      flights.set(key, f);
      const done = () => { if (flights.get(key) === f) flights.delete(key); };
      f.promise.then(done, done);
    }
    f.refs++;
    f.fl.join();
    if (signal) {
      const leave = () => { if (--f.refs === 0) f.ac.abort(); };
      if (signal.aborted) leave(); else signal.addEventListener('abort', leave, { once: true });
    }
    return f.promise;
  }

  return { run, stats: () => ({ running, queued: queue.length, flights: flights.size }) };
}

module.exports = { createHeavyRunner };
