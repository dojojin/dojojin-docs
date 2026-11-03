// ============================================================
// Vigil Platform — Tests: ตารางเวลา reconcile ของ traffic-stats-refresher
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
//
// reconcile คืองานหนักที่สุดของวัน (INSERT รายวันวัดได้ 24–95 วินาที) และรันคืนละครั้ง
// บั๊กในตัวจับเวลาจึงใช้เวลาเป็นวัน ๆ กว่าจะโผล่ · เทสต์นี้ตรึงสองอย่าง:
//   1. ชั่วโมงที่ยิงคือ 05:00 ไทย (ย้ายจาก 03:00 ที่ทับ pg_dump — GOTCHAS #191)
//   2. ยิง "วันละครั้ง" จริง แม้ api-server restart กลางชั่วโมงนั้น
//
// ⚠️ _reconciledDay เป็น state ระดับ module — เทสต์จึงเขียนเป็น timeline เรียงลำดับ
//    ก้อนเดียว ไม่ใช่ it() อิสระที่สลับลำดับได้

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/traffic-stats-refresher');

// pool ปลอม: dueForReconcile ถาม "วันที่/ชั่วโมงตามเวลาไทย" จาก Postgres
const clockPool = (d, h) => ({ query: async () => ({ rows: [{ d, h }] }) });

describe('reconcile — ชั่วโมงที่ยิงและกันยิงซ้ำ', () => {
  it('default RECONCILE_HOUR = 5 (หลัง backup จบ ~04:05)', () => {
    assert.equal(R.RECONCILE_HOUR, 5);
    assert.equal(R.RECONCILED_KEY, 'traffic_stats_reconciled_day');
  });

  it('timeline: 05:00 ยิง → ยิงแล้วเงียบ → ชั่วโมงอื่นเงียบ → วันใหม่ยิงอีก', async () => {
    // 1) process เพิ่งขึ้น ยังไม่เคย reconcile · ถึง 05:00 ⇒ ยิง
    assert.equal(await R.dueForReconcile(clockPool('2026-09-06', 5)), '2026-09-06');

    // 2) ยิงไปแล้ววันนี้ ⇒ tick ที่เหลือของชั่วโมงเดียวกันต้องเงียบ (15 นาที/รอบ)
    await R.saveReconciledDay({ query: async () => ({}) }, '2026-09-06');
    assert.equal(await R.dueForReconcile(clockPool('2026-09-06', 5)), null);

    // 3) วันใหม่ที่ยังไม่เคย reconcile แต่เป็นตี 3 ⇒ ต้องเงียบ
    //    (ข้อนี้คือข้อที่แยก "5" ออกจาก "3" ของเดิม — ถ้า default ยังเป็น 3 จะยิงตรงนี้)
    assert.equal(await R.dueForReconcile(clockPool('2026-09-07', 3)), null);
    assert.equal(await R.dueForReconcile(clockPool('2026-09-07', 4)), null);

    // 4) วันใหม่ + ถึง 05:00 ⇒ ยิงอีกครั้ง
    assert.equal(await R.dueForReconcile(clockPool('2026-09-07', 5)), '2026-09-07');
  });

  it('restart ในชั่วโมง reconcile → โหลดจาก system_settings แล้วไม่รันซ้ำ', async () => {
    const settings = { query: async () => ({ rows: [{ value: '2026-09-08' }] }) };
    assert.equal(await R.loadReconciledDay(settings), '2026-09-08');
    assert.equal(await R.dueForReconcile(clockPool('2026-09-08', 5)), null);
  });

  it('settings พังไม่ทำให้ refresher ล้ม และ fast path ยังกันซ้ำได้', async () => {
    const broken = { query: async () => { throw new Error('boom'); } };

    // อ่านไม่ได้ ⇒ ไม่โยน และค่าที่มีอยู่ไม่ถูกล้างทิ้ง
    assert.equal(await R.loadReconciledDay(broken), '2026-09-08');

    // เขียนไม่ได้ ⇒ ไม่โยน แต่หน่วยความจำต้องถูกตั้งไปแล้ว
    // ไม่งั้น tick อีก 15 นาทีจะลากงาน 7 วันมาทำซ้ำ
    await R.saveReconciledDay(broken, '2026-09-09');
    assert.equal(await R.dueForReconcile(clockPool('2026-09-09', 5)), null);
  });
});
