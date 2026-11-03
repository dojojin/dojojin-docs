// ============================================================
// Vigil Platform — ยกเลิกคิวรีของคำขอ GET ที่ผู้ใช้ทิ้งไปแล้ว (perf ข้อ 1 ระยะ A · 2026-10-23)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา: คิวรีของหน้าที่ผู้ใช้ปิด/เปลี่ยนหน้าไปแล้วยังรันต่อจนจบหรือจนชนเพดาน 120 วิ และแย่ง IO จนทั้งระบบช้า
// (perfWatch 22 ต.ค.: ค้นตามรูปแบบ 62.7 วิ × 14 · ไม่ขึ้นใน [slow-req] เพราะเบราว์เซอร์ตัดไปก่อน)
// repro 23 ต.ค.: ตัด /api/appearances/stats ที่ 2 วิ → CREATE TEMP TABLE ยังรันต่อใน pg_stat_activity
//
// วิธี: middleware ผูกคำขอ GET ไว้ใน AsyncLocalStorage · ตัวห่อ pool.connect จด client.processID ของทุก connection
// ที่คำขอนั้นยืม (pool.query ของ pg-pool ก็เรียก this.connect(cb) ภายใน จึงผ่านตัวห่อเหมือนกัน) · ถ้าการเชื่อมต่อปิด
// ก่อนตอบเสร็จ → pg_cancel_backend ทุก pid ที่ยังยืมอยู่
// 🔴 กันยกเลิกผิดตัว (บทเรียน 21 ต.ค.): connection ที่ถูกยกเลิกคืนแบบมี error ให้ pool ทิ้ง (ไม่กลับเข้า pool) ·
//    SIGINT ที่มาช้าจึงไม่มีทางโดนคำขออื่น และไม่มี connection กลับไปค้างใน transaction ที่ล้ม
// 🔴 คำสั่งยกเลิกวิ่งบน connection แยก (pool ข้าง max 1) ไม่ใช่ pool ของคำขอ — repro 23 ต.ค.: pool เต็มด้วยคำขอที่ถูกทิ้ง
//    แล้วคำสั่งยกเลิกต้องต่อคิวใน pool เดียวกัน = คิวรีหนักวิ่งจนครบเพดาน และคำขอถัดไปไม่ได้คำตอบ
// ใช้เฉพาะ GET — งานเขียน / webhook / งานเบื้องหลัง (ไม่อยู่ในบริบทคำขอ) ไม่ถูกแตะ
// ยกเลิกเฉพาะ connection ที่ "ยืมอยู่ตอนผู้ใช้ทิ้ง" — ไม่ยกเลิกที่ยืมทีหลัง เพราะ AsyncLocalStorage ตามไปถึง timer/promise
// ที่คำขอนั้นเริ่มไว้ (เช่น interval ที่เริ่มตอน GET แรก) ซึ่งจะโดนยกเลิกตลอดไป
// 🔴 งานที่หลายคำขอใช้ร่วมกัน (single-flight: ttlCache, heavyRunner) รันผ่าน flight() — มีบริบทของตัวเอง ยกเลิกเมื่อ
//    "ทุกคำขอที่รอ" ทิ้งไปแล้วเท่านั้น · ผู้รอที่ไม่ใช่ GET (งานเบื้องหลัง/POST) ตรึงไว้ ไม่มีวันถูกยกเลิก
//    (ตรวจหลัง deploy 23 ต.ค.: /api/appearances/stats อยู่หลัง ttlCache — แบบตัดขาดจากคำขอเลย ไม่ยกเลิกสักครั้ง)
// ============================================================
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const stats = { requests: 0, cancelled: 0, lastAt: null };

function track(ctx, client) {
  const pid = client.processID;
  if (!pid || client.__reqDbTracked) return client;
  client.__reqDbTracked = true;
  ctx.active.add(pid);
  const release = client.release;
  client.release = function (...args) {
    client.release = release;
    client.__reqDbTracked = false;
    ctx.active.delete(pid);
    if (ctx.killed.has(pid)) args = [args[0] || new Error('requestDb: cancelled, abandoned request')];   // pool ทิ้ง connection นี้
    return release.apply(client, args);
  };
  return client;
}

function cancelPid(ctx, pid) {
  if (ctx.killed.has(pid)) return;
  ctx.killed.add(pid);
  ctx.cancelled++;
  ctx.rawQuery('SELECT pg_cancel_backend($1)', [pid]).catch((e) => console.warn(`[req-cancel] ยกเลิก pid ${pid} ไม่สำเร็จ: ${e.message}`));
}

const newCtx = () => ({ active: new Set(), killed: new Set(), done: false, cancelled: 0, rawQuery: null, onAbandon: [], t0: Date.now() });

// ยกเลิกทุกคิวรีที่บริบทนี้ยืมอยู่ · คืนจำนวนที่สั่งยกเลิก
function abandon(ctx) {
  ctx.done = true;
  const before = ctx.cancelled;
  for (const f of ctx.onAbandon.splice(0)) ctx.cancelled += f() || 0;
  if (ctx.rawQuery) for (const pid of ctx.active) cancelPid(ctx, pid);
  return ctx.cancelled - before;
}

/**
 * งานที่หลายคำขอรอร่วมกัน · `run(fn)` รัน fn ในบริบทของงานนี้ · `join()` เรียกในบริบทของผู้รอแต่ละคน
 * ยกเลิกเมื่อผู้รอคนสุดท้ายทิ้ง (onCancel ถูกเรียกด้วย — เช่นถอดออกจากคิว)
 */
function flight({ onCancel, label = '' } = {}) {
  const ctx = newCtx();
  let waiters = 0, pinned = false;
  // ผู้รอเป็นศูนย์แล้ว รอ graceMs ก่อนยกเลิก — กด refresh / สลับหน้าไปกลับ = คนใหม่มาต่องานเดิม ไม่ต้องเริ่มนับใหม่
  const maybeCancel = () => {
    if (waiters > 0 || pinned || ctx.done) return;
    const n = abandon(ctx);
    if (onCancel) onCancel();
    if (n) {
      stats.cancelled += n; stats.lastAt = new Date().toISOString();
      console.log(`[req-cancel] shared:${label} ไม่มีใครรอแล้ว ${flight.graceMs}ms → ยกเลิก ${n} คิวรี`);
    }
  };
  const f = {
    get cancelled() { return ctx.done; },
    run: (fn) => als.run(ctx, fn),
    join() {
      const rctx = als.getStore();
      // งานเบื้องหลัง/POST รอ = ห้ามยกเลิก · บริบทของคำขอที่จบไปแล้ว (ตอบเสร็จหรือถูกทิ้ง) ก็นับเป็นงานเบื้องหลัง —
      // คือ timer/promise ที่คำขอนั้นเริ่มไว้ ไม่ใช่คนที่รอดูผลอยู่
      if (!rctx || rctx === ctx || rctx.done || rctx.ended) { pinned = true; return; }
      waiters++;
      rctx.onAbandon.push(() => {
        if (--waiters === 0) setTimeout(maybeCancel, flight.graceMs).unref?.();
        return 0;
      });
    },
  };
  return f;
}

/** ห่อ pool ให้รู้จักคำขอ · เรียกครั้งเดียวต่อ pool ตอนบูต */
function wrapPool(pool) {
  if (pool.__reqDbWrapped) return pool;
  pool.__reqDbWrapped = true;
  const origConnect = pool.connect.bind(pool);
  // pool ข้างสำหรับคำสั่งยกเลิก — ใช้ค่าเชื่อมต่อเดียวกัน · pool ปลอมในเทสต์ไม่มี options จึงใช้ตัวเอง
  // password ต้องใส่เอง: pg-pool ตั้งเป็น non-enumerable การ spread จึงทำหาย (เงียบ — cancel ล้มทุกครั้ง)
  const o = pool.options;
  const side = o ? new pool.constructor({ ...o, password: o.password, max: 1, idleTimeoutMillis: 10000 }) : pool;
  if (side !== pool) side.on('error', () => {});
  // ออกจากบริบทของคำขอ — คำสั่งยกเลิกต้องไม่ถูกจดเป็นคิวรีของคำขอที่กำลังถูกยกเลิกเสียเอง
  const rawQuery = (sql, args) => als.exit(() => side.query(sql, args));
  pool.connect = function (cb) {
    const ctx = als.getStore();
    if (!ctx || ctx.done || ctx.ended) return origConnect(cb);
    ctx.rawQuery = ctx.rawQuery || rawQuery;
    if (typeof cb === 'function') {
      return origConnect((err, client, done) => { if (!err) track(ctx, client); cb(err, client, done); });
    }
    return origConnect().then((client) => track(ctx, client));
  };
  return pool;
}

/** middleware: ผูกคำขอ GET กับบริบท · ปิดก่อนตอบเสร็จ = ยกเลิกคิวรีที่ยังรันของคำขอนั้น */
function middleware(req, res, next) {
  if (req.method !== 'GET') return next();
  const ctx = newCtx();
  stats.requests++;
  res.once('close', () => {
    if (res.writableEnded) { ctx.ended = true; ctx.onAbandon.length = 0; return; }   // ตอบเสร็จแล้ว = ปิดตามปกติ
    const n = abandon(ctx);
    if (n) {
      stats.cancelled += n; stats.lastAt = new Date().toISOString();
      console.log(`[req-cancel] ${req.method} ${req.path} ผู้ใช้ทิ้งหลัง ${Date.now() - ctx.t0}ms → ยกเลิก ${n} คิวรี`);
    }
  });
  als.run(ctx, next);
}

flight.graceMs = 5000;

module.exports = { wrapPool, middleware, flight, stats, _als: als };
