// ============================================================
// Vigil Platform — tests: stats page line-selection keys
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const S = require('../dashboard/stats-selection.js');

// สภาพจริงที่ทำให้เจอบั๊ก: ชื่อ base ซ้ำกันข้ามกลุ่ม
// - กลุ่ม vehicle    = การ์ดยานพาหนะอัตโนมัติ (มาจาก /api/stats/vehicle-cards)
// - กลุ่ม standalone = หมวดที่ผู้ใช้สร้างเอง ตั้ง stat_group='standalone'
//   ชื่อ "รถจักรยานยนต์ (IN)/(OUT)" ถูกตัดท้ายเหลือ base เดียวกันเป๊ะ
const GROUPS = () => ([
  { key: 'vehicle',    cards: [{ base: 'รถจักรยานยนต์' }, { base: 'รถยนต์' }] },
  { key: 'standalone', cards: [{ base: 'รถจักรยานยนต์' }, { base: 'รถบัส' }] },
]);

describe('stats selection keys', () => {
  test('การ์ดชื่อเดียวกันคนละกลุ่ม = คนละคีย์', () => {
    const a = S.key('vehicle', 'รถจักรยานยนต์');
    const b = S.key('standalone', 'รถจักรยานยนต์');
    assert.notStrictEqual(a, b);
    assert.strictEqual(S.parse(a).group, 'vehicle');
    assert.strictEqual(S.parse(b).base, 'รถจักรยานยนต์');
  });

  test('inGroup ดูเฉพาะกลุ่มของตัวเอง', () => {
    assert.ok(S.inGroup(S.key('vehicle', 'รถยนต์'), 'vehicle'));
    assert.ok(!S.inGroup(S.key('standalone', 'รถยนต์'), 'vehicle'));
    // ชื่อกลุ่มที่เป็น prefix ของอีกกลุ่มต้องไม่หลุด (veh vs vehicle)
    assert.ok(!S.inGroup(S.key('vehicle', 'รถยนต์'), 'veh'));
  });

  test('คีย์ทิศทางแยกตามกลุ่มด้วย', () => {
    const k = S.keyDir('standalone', 'รถจักรยานยนต์', 'IN');
    assert.deepStrictEqual(S.parse(k), { group: 'standalone', base: 'รถจักรยานยนต์', dir: 'IN' });
    assert.ok(S.inGroup(k, 'standalone'));
    assert.ok(!S.inGroup(k, 'vehicle'));
  });

  test('ค่าเริ่มต้นเลือกได้ทุกกลุ่มที่ชื่อตรง', () => {
    const d = S.pickDefaults(GROUPS(), ['รถจักรยานยนต์']);
    assert.strictEqual(d.size, 2);
    assert.ok(d.has(S.key('vehicle', 'รถจักรยานยนต์')));
    assert.ok(d.has(S.key('standalone', 'รถจักรยานยนต์')));
  });

  test('ไม่มีชื่อไหนตรงเลย → 6 ใบแรก', () => {
    const d = S.pickDefaults(GROUPS(), ['ไม่มีหมวดนี้']);
    assert.strictEqual(d.size, 4);     // ตัวอย่างนี้มี 4 ใบ (น้อยกว่า 6)
  });

  // ── บั๊กที่รายงานเข้ามา 2026-09-04 ──────────────────────────────
  test('ยุบกลุ่มหนึ่ง ต้องไม่ลบการ์ดชื่อเดียวกันของกลุ่มที่ยังเปิดอยู่', () => {
    const groups = GROUPS();
    const sel = new Set([
      S.key('vehicle', 'รถจักรยานยนต์'),
      S.key('standalone', 'รถจักรยานยนต์'),   // ← ตัวที่เคยโดนลูกหลง
    ]);
    const stash = {};
    S.applyCollapse(groups, new Set(['vehicle']), sel, new Set(), new Set(), stash);

    assert.ok(!sel.has(S.key('vehicle', 'รถจักรยานยนต์')), 'ของกลุ่มที่ยุบต้องถูกถอด');
    assert.ok(sel.has(S.key('standalone', 'รถจักรยานยนต์')), 'ของกลุ่มที่เปิดอยู่ต้องอยู่ครบ');
    assert.strictEqual(sel.size, 1);
    assert.ok(stash.vehicle.bases.has(S.key('vehicle', 'รถจักรยานยนต์')));
    assert.strictEqual(stash.vehicle.bases.size, 1);
  });

  test('เส้นรายทิศและการ์ดพิเศษก็แยกตามกลุ่มเหมือนกัน', () => {
    const groups = GROUPS();
    const dirSel = new Set([
      S.keyDir('vehicle', 'รถจักรยานยนต์', 'IN'),
      S.keyDir('standalone', 'รถจักรยานยนต์', 'IN'),
    ]);
    const extraSel = new Set([S.key('watch', 'หมวกนิรภัย'), S.key('vehicle', 'อื่น ๆ')]);
    S.applyCollapse(groups, new Set(['vehicle']), new Set(), dirSel, extraSel, {});

    assert.deepStrictEqual([...dirSel], [S.keyDir('standalone', 'รถจักรยานยนต์', 'IN')]);
    assert.deepStrictEqual([...extraSel], [S.key('watch', 'หมวกนิรภัย')]);
  });

  test('กางกลับแล้วได้เส้นเดิมคืนครบ (stash คืนค่าได้)', () => {
    const groups = GROUPS();
    const sel = new Set([S.key('vehicle', 'รถยนต์'), S.key('standalone', 'รถบัส')]);
    const stash = {};
    S.applyCollapse(groups, new Set(['vehicle']), sel, new Set(), new Set(), stash);
    assert.deepStrictEqual([...sel], [S.key('standalone', 'รถบัส')]);

    stash.vehicle.bases.forEach((k) => sel.add(k));   // = _esRestoreCollapseStash
    assert.strictEqual(sel.size, 2);
    assert.ok(sel.has(S.key('vehicle', 'รถยนต์')));
  });

  test('เรียกซ้ำหลายรอบไม่สะสมขยะ (เรนเดอร์ทุกครั้งเรียกซ้ำ)', () => {
    const groups = GROUPS();
    const sel = new Set([S.key('vehicle', 'รถยนต์')]);
    const stash = {};
    for (let i = 0; i < 5; i++) S.applyCollapse(groups, new Set(['vehicle']), sel, new Set(), new Set(), stash);
    assert.strictEqual(sel.size, 0);
    assert.strictEqual(stash.vehicle.bases.size, 1);
  });
});
