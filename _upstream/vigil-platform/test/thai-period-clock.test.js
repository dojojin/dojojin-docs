// ============================================================
// Vigil Platform — Tests: ช่วงนาฬิกาในประโยคภาษาไทย
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เดิม "เมื่อวาน 18:00-19:00" ได้ยอด **ทั้งวัน** กลับมาโดยไม่บอกอะไรเลย
// ซึ่งหน้าตาเหมือนคำตอบที่ถูกต้องทุกประการ (เจ้าของเจอเอง 2026-09-09)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseThaiPeriod } = require('../src/helpers/thaiPeriod');

const NOW = new Date('2026-09-08T17:40:00Z');    // 9 ก.ย. 00:40 เวลาไทย
const th = (d) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 16);

describe('ช่วงนาฬิกา', () => {
  it('"เมื่อวาน 18:00-19:00" = หนึ่งชั่วโมงของเมื่อวาน ไม่ใช่ทั้งวัน', () => {
    const p = parseThaiPeriod('ขอรูปรถบรรทุก RMUTR-V เมื่อวาน 18:00-19:00', NOW);
    assert.equal(p.kind, 'clock');
    assert.equal(th(p.from), '2026-09-08T18:00');
    assert.equal(th(p.to), '2026-09-08T19:00');
    assert.equal(p.label, '8 ก.ย. 18:00-19:00');
  });

  it('ไม่ระบุวัน = วันนี้ · รูปแบบ "18-19 น." และ "ตอน 18 โมง" ใช้ได้เหมือนกัน', () => {
    assert.equal(th(parseThaiPeriod('8-12 น.', NOW).from), '2026-09-09T08:00');
    const one = parseThaiPeriod('เมื่อวานตอน 18 โมง', NOW);
    assert.equal(th(one.from), '2026-09-08T18:00');
    assert.equal(th(one.to), '2026-09-08T19:00', 'ระบุชั่วโมงเดียว = ชั่วโมงนั้นชั่วโมงเดียว');
  });

  it('ข้ามเที่ยงคืนไปวันถัดไป ไม่ใช่ช่วงติดลบแล้วตอบว่าไม่มีข้อมูล', () => {
    const p = parseThaiPeriod('เมื่อวาน 22:00-02:00', NOW);
    assert.equal(th(p.from), '2026-09-08T22:00');
    assert.equal(th(p.to), '2026-09-09T02:00');
  });

  // 🔴 ตัวเลขที่ไม่ได้หมายถึงเวลา ห้ามกลายเป็นช่วงเวลา
  it('"3 วัน" · "5 อันดับ" · "3 ชั่วโมงที่ผ่านมา" ต้องไม่ถูกอ่านเป็นนาฬิกา', () => {
    assert.equal(parseThaiPeriod('3 วัน', NOW).kind, 'range');
    assert.equal(parseThaiPeriod('ขอ 5 อันดับ', NOW), null);
    assert.equal(parseThaiPeriod('3 ชั่วโมงที่ผ่านมา', NOW).kind, 'range');
    assert.equal(parseThaiPeriod('ชั่วโมงที่แล้ว', NOW).kind, 'hour');
  });

  it('ช่วงหลายวันไม่ถูกหั่นด้วยนาฬิกา แต่ต้องติดธงไว้ให้การ์ดบอกผู้ใช้', () => {
    const p = parseThaiPeriod('7 วัน 18:00-19:00', NOW);
    assert.equal(p.kind, 'range');
    assert.equal(p.clockDropped, true);
  });
});

// เจ้าของพิมพ์ "เมื่อวานก่อนเที่ยง" แล้วได้ช่วง 12:00-13:00 กลับมา คือ *หลัง* เที่ยง
// ตรงข้ามกับที่ถาม และการ์ดก็ดูปกติทุกประการ (2026-09-09)
describe('ก่อน/หลัง เวลา', () => {
  const NOW2 = new Date('2026-09-08T17:40:00Z');
  const label = (t) => parseThaiPeriod(t, NOW2).label;

  it('"ก่อนเที่ยง" = ครึ่งวันแรก · "หลังเที่ยง" = ครึ่งวันหลัง (ไม่ใช่ชั่วโมงเดียว)', () => {
    assert.match(label('เมื่อวานก่อนเที่ยง'), /00:00-12:00/);
    assert.match(label('เมื่อวานหลังเที่ยง'), /12:00/);
    assert.ok(!label('เมื่อวานก่อนเที่ยง').includes('12:00-13:00'));
  });

  it('ใช้กับชั่วโมงอื่นได้ด้วย', () => {
    assert.match(label('เมื่อวาน ก่อน 10 โมง'), /00:00-10:00/);
    assert.match(label('เมื่อวาน หลังบ่ายสามโมง'), /15:00/);
  });

  it('"พักเที่ยง" ยังเป็นช่วงพักเที่ยงเหมือนเดิม', () => {
    assert.match(label('พักเที่ยงเมื่อวาน'), /12:00-13:00/);
  });

  it('"10.30" เดี่ยว ๆ อ่านเป็นเวลาได้ โดยไม่ต้องมีคำว่า ตอน/เวลา นำ', () => {
    assert.match(label('ช่วง 10.30 ที่ภูเก็ต'), /10:30-11:30/);
    assert.match(label('เมื่อวาน 10:30'), /10:30-11:30/);
  });

  it('ตัวเลขที่ไม่ใช่เวลาต้องไม่ถูกอ่านเป็นเวลา', () => {
    assert.equal(parseThaiPeriod('ขอ 3 ป้าย', NOW2), null);
    assert.equal(parseThaiPeriod('ป้าย 1กอ88 เจอที่ไหน', NOW2), null);
    assert.equal(parseThaiPeriod('ค่าเฉลี่ย 10.305', NOW2), null, 'ทศนิยมยาวกว่าสองหลักไม่ใช่เวลา');
  });
});
