// ============================================================
// Vigil Platform — เตือนเมื่อ edge ทำข้อมูลหาย
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// incident 2026-08-14: คิวของ vss ตายค้าง 2 สัปดาห์ และสัญญาณ "กล้องถูกบัง" หายไป
// 7 สัปดาห์ โดย **ไม่มีสัญญาณเตือนใด ๆ เลย** — pm2 ขึ้น online, heartbeat ขึ้น
// remote=up ทุกนาที, forwarded เดินหน้าปกติ · ตัวเลขที่บอกความจริงมีอยู่แล้วใน
// edge_status.bridge_dropped แต่ไม่มีใครดู
//
// 🔴 กับดักที่ไฟล์นี้ตรึงไว้: ค่า bridge_dropped **ไม่ monotonic**
//   - `evicted` เป็นตัวนับในหน่วยความจำของ bridge → รีเซ็ตเป็น 0 ทุกครั้งที่ restart
//   - ไฟล์ใน data/oversized ถูกหมุนทิ้งเมื่อเกินเพดาน → จำนวนลดลงได้
// ถ้าเขียนเป็น "ค่า > 0 แล้วเตือน" จะเตือนซ้ำทุก 5 นาทีจนกว่าจะมีคนไปล้าง
// ถ้าเขียนเป็น "ค่าเปลี่ยนแล้วเตือน" ค่าที่ลดลงตอน restart จะกลายเป็นสัญญาณหลอก
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { _lossDecision } = require('../src/alert-engine');

describe('เตือน edge ทำข้อมูลหาย — ตรรกะการตัดสินใจ', () => {
  let seen;
  beforeEach(() => { seen = new Map(); });

  it('ไซต์ปกติ (0 มาตลอด) ต้องไม่เตือน', () => {
    assert.strictEqual(_lossDecision('vss', 0, seen).alert, false);
    assert.strictEqual(_lossDecision('vss', 0, seen).alert, false);
  });

  it('เริ่มมีของหาย 0 → 3 ต้องเตือน และบอกจำนวนที่เพิ่ม', () => {
    _lossDecision('vss', 0, seen);
    const r = _lossDecision('vss', 3, seen);
    assert.strictEqual(r.alert, true);
    assert.strictEqual(r.delta, 3);
  });

  it('ค่าเท่าเดิมต้องไม่เตือนซ้ำ — ไม่งั้นจะยิงทุก 5 นาทีไม่หยุด', () => {
    _lossDecision('vss', 3, seen);
    assert.strictEqual(_lossDecision('vss', 3, seen).alert, false);
    assert.strictEqual(_lossDecision('vss', 3, seen).alert, false);
  });

  it('หายเพิ่มอีกต้องเตือนอีก และนับเฉพาะส่วนที่เพิ่ม', () => {
    _lossDecision('vss', 3, seen);
    const r = _lossDecision('vss', 10, seen);
    assert.strictEqual(r.alert, true);
    assert.strictEqual(r.delta, 7, 'ต้องบอก 7 ไม่ใช่ 10 — คนอ่านสนใจว่าหายเพิ่มเท่าไหร่');
  });

  it('🔴 ค่าลดลง (bridge restart / ไฟล์ถูกหมุนทิ้ง) ต้องตั้งฐานใหม่เงียบ ๆ', () => {
    _lossDecision('vss', 10, seen);
    assert.strictEqual(_lossDecision('vss', 0, seen).alert, false, 'ค่าลดลงไม่ใช่เหตุการณ์ใหม่');
    // และหลังตั้งฐานใหม่แล้ว ของที่หายเพิ่มจริงต้องยังจับได้
    assert.strictEqual(_lossDecision('vss', 2, seen).alert, true);
  });

  it('ไซต์ที่ยังไม่เคยเห็น + มีของหายค้างอยู่ ต้องเตือน 1 ครั้ง', () => {
    // เกิดตอน alert-worker เพิ่ง restart แล้ว Map ว่าง — ของที่ยังหายอยู่
    // ควรถูกเตือนซ้ำ ไม่ใช่เงียบไปเพราะ "เรา" restart
    const r = _lossDecision('hdy', 5, seen);
    assert.strictEqual(r.alert, true);
    assert.strictEqual(r.delta, 5);
  });

  it('แต่ละไซต์นับแยกกัน ไม่ปนกัน', () => {
    _lossDecision('vss', 5, seen);
    assert.strictEqual(_lossDecision('hkt', 0, seen).alert, false, 'hkt ยังปกติ ห้ามติดร่างแหจาก vss');
    assert.strictEqual(_lossDecision('vss', 5, seen).alert, false);
  });

  it('ค่าที่อ่านไม่ได้ (null จาก DB) ต้องนับเป็น 0 ไม่ใช่ NaN', () => {
    _lossDecision('vss', 4, seen);
    const r = _lossDecision('vss', null, seen);
    assert.strictEqual(r.alert, false);
    assert.strictEqual(seen.get('vss'), 0, 'ต้องเก็บเป็น 0 ไม่ใช่ null/NaN');
    // NaN จะทำให้การเทียบครั้งถัดไปเป็น false ตลอดกาล = เตือนไม่ได้อีกเลย
    assert.strictEqual(_lossDecision('vss', 1, seen).alert, true);
  });
});
