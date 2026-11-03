// ============================================================
// Vigil Platform — Tests: แคชรายการอุปกรณ์ HCP (stale-while-revalidate)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไมต้องมีเทสต์: การกวาด HCP ใช้เวลา 9.9–16.0 วิ (วัดจริงผ่าน URL สาธารณะ
// 2026-08-12) และหน้าเว็บตัดที่ 30 วิ · ถ้ามีใครมา "ทำให้ง่ายขึ้น" เป็น TTL เปล่า
// การรอ 16 วิจะกลับมาเงียบ ๆ กับคนที่มาถึงตอนหมดอายุพอดี — มองไม่เห็นจากโค้ด
// สมบัติที่ต้องคุ้มครองคือ **หมดอายุแล้วต้องคืนทันที ไม่ใช่ไปรอของใหม่**

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHcpDevicesCache } = require('../src/helpers/hcpDevicesCache');

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('createHcpDevicesCache', () => {
  it('ครั้งแรกต้องรอของจริง แล้วครั้งต่อไปได้ของเดิมโดยไม่เรียกซ้ำ', async () => {
    let n = 0;
    const c = createHcpDevicesCache(async () => ({ v: ++n }), { freshMs: 10_000 });
    const a = await c.get();
    const b = await c.get();
    assert.equal(n, 1);
    assert.equal(a.body.v, 1);
    assert.equal(b.at, a.at);          // อายุข้อมูลไม่ขยับ = ของเดิมจริง
  });

  it('หมดอายุแล้ว → คืนของเดิม "ทันที" แล้วค่อยดึงใหม่ข้างหลัง', async () => {
    let n = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const c = createHcpDevicesCache(async () => {
      n++;
      if (n > 1) await gate;           // รอบดึงใหม่ค้างไว้ — จำลองการกวาดที่ใช้ 16 วิ
      return { v: n };
    }, { freshMs: 0 });                // 0 = หมดอายุทันที

    const first = await c.get();
    const stale = await c.get();       // ต้องไม่ค้างรอ gate
    assert.equal(stale.body.v, 1, 'ต้องได้ของเดิม ไม่ใช่ไปรอของใหม่');
    assert.equal(stale.at, first.at);
    assert.equal(n, 2, 'ต้องสั่งดึงใหม่ข้างหลังไปแล้ว');

    release();
    await tick(); await tick();
    const after = await c.get();
    assert.equal(after.body.v, 2, 'พอดึงเสร็จต้องได้ของใหม่');
    assert.ok(after.at >= first.at);
  });

  it('ดึงใหม่ล้ม → ยังคืนของเดิมได้ ไม่โยนใส่หน้าเว็บ และแจ้ง onError', async () => {
    let n = 0;
    const errs = [];
    const c = createHcpDevicesCache(async () => {
      if (++n > 1) throw new Error('HCP ล่ม');
      return { v: 1 };
    }, { freshMs: 0, onError: (e) => errs.push(e.message) });

    const first = await c.get();
    const stale = await c.get();
    await tick(); await tick();
    assert.equal(stale.body.v, 1);
    assert.deepEqual(errs, ['HCP ล่ม']);
    // อายุข้อมูลค้างอยู่ที่ของเดิม — นี่คือสัญญาณที่หน้าเว็บเอาไปแสดงให้เห็นว่าข้อมูลเก่า
    assert.equal((await c.get()).at, first.at);
  });

  it('ครั้งแรกล้ม → โยนให้ผู้เรียกจัดการ (ไม่มีของเดิมให้คืน) แล้วลองใหม่ได้', async () => {
    let n = 0;
    const c = createHcpDevicesCache(async () => {
      if (++n === 1) throw new Error('edge HTTP 502');
      return { v: 'ok' };
    }, { freshMs: 10_000 });
    await assert.rejects(() => c.get(), /edge HTTP 502/);
    assert.equal((await c.get()).body.v, 'ok');   // inflight ถูกล้างแล้ว ไม่ค้างเป็น promise ที่ reject ตลอดกาล
  });

  it('หลายคนเปิดพร้อมกัน → กวาด HCP รอบเดียว', async () => {
    let n = 0;
    const c = createHcpDevicesCache(async () => { n++; await sleep(20); return { v: n }; },
      { freshMs: 10_000 });
    const all = await Promise.all([c.get(), c.get(), c.get(), c.get()]);
    assert.equal(n, 1);
    all.forEach((r) => assert.equal(r.body.v, 1));
  });

  it('prewarm เติมแคชได้ และกลืน error เองเมื่อ HCP ยังไม่พร้อมตอนบูต', async () => {
    const ok = createHcpDevicesCache(async () => ({ v: 'warm' }), { freshMs: 10_000 });
    await ok.prewarm();
    assert.equal((await ok.get()).body.v, 'warm');

    const errs = [];
    const bad = createHcpDevicesCache(async () => { throw new Error('ยังไม่พร้อม'); },
      { freshMs: 10_000, onError: (e) => errs.push(e.message) });
    await bad.prewarm();               // ต้องไม่โยน — ไม่งั้น unhandled rejection ตอนบูต
    assert.deepEqual(errs, ['ยังไม่พร้อม']);
  });
});
