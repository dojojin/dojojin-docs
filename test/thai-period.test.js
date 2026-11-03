// ============================================================
// Vigil Platform — Tests: ตัวแยกช่วงเวลาไทยของคำสั่งผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// "ชั่วโมงที่แล้ว" กับ "60 นาทีล่าสุด" ให้คำตอบคนละเลข — ทั้งไฟล์นี้มีไว้ตรึงนิยาม
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseThaiPeriod, parseLimit } = require('../src/helpers/thaiPeriod');

// 2026-09-08 15:20:33 เวลาไทย = 08:20:33Z
const NOW = new Date('2026-09-08T08:20:33Z');
const th = (d) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ');

describe('ช่วงเวลาระดับชั่วโมง', () => {
  it('"ชั่วโมงที่แล้ว" = ชั่วโมงเต็มก่อนหน้า ไม่ใช่ 60 นาทีล่าสุด', () => {
    const r = parseThaiPeriod('ขอทราบยอดคนไม่สวมหมวกนิรภัย ชั่วโมงที่แล้ว หน่อย', NOW);
    assert.equal(th(r.from), '2026-09-08 14:00');
    assert.equal(th(r.to), '2026-09-08 15:00');
    assert.equal(r.label, '8 ก.ย. 14:00-14:59', 'ป้ายต้องบอกช่วงที่ตีความให้คนค้านได้');
  });

  it('"ชั่วโมงนี้" = ต้นชั่วโมงถึงเดี๋ยวนี้', () => {
    const r = parseThaiPeriod('ยอดชั่วโมงนี้', NOW);
    assert.equal(th(r.from), '2026-09-08 15:00');
    assert.equal(r.to.getTime(), NOW.getTime());
  });

  it('"12 ชั่วโมงที่ผ่านมา" = เวลาวิ่งย้อนหลังจริง ไม่ปัดเป็นชั่วโมงเต็ม', () => {
    const r = parseThaiPeriod('12 ชั่วโมงที่ผ่านมา', NOW);
    assert.equal(th(r.from), '2026-09-08 03:20');
    assert.equal(r.hours, 12);
  });

  it('มีตัวเลขนำหน้าแล้วต้องไม่ตกลงกิ่ง "ชั่วโมงที่แล้ว"', () => {
    assert.equal(parseThaiPeriod('3 ชั่วโมงที่แล้ว', NOW).hours, 3);
  });
});

describe('ช่วงเวลาระดับวันขึ้นไป', () => {
  it('วันนี้ / เมื่อวาน', () => {
    const t = parseThaiPeriod('สรุปวันนี้', NOW);
    assert.equal(th(t.from), '2026-09-08 00:00');
    const y = parseThaiPeriod('เมื่อวานมีกี่คัน', NOW);
    assert.equal(th(y.from), '2026-09-07 00:00');
    assert.equal(th(y.to), '2026-09-08 00:00', 'เมื่อวานต้องจบที่เที่ยงคืน ไม่ลากมาถึงตอนนี้');
    assert.equal(y.label, 'เมื่อวาน 7 ก.ย.');
  });

  it('"3 วันล่าสุด" นับรวมวันนี้ = ย้อนไป 2 วัน', () => {
    assert.equal(th(parseThaiPeriod('3 วันล่าสุด', NOW).from), '2026-09-06 00:00');
  });

  it('7 วัน · เดือนนี้ · เดือนที่แล้ว', () => {
    assert.equal(th(parseThaiPeriod('7 วัน', NOW).from), '2026-09-02 00:00');
    assert.equal(th(parseThaiPeriod('เดือนนี้', NOW).from), '2026-09-01 00:00');
    const last = parseThaiPeriod('เดือนที่แล้ว', NOW);
    assert.equal(th(last.from), '2026-08-01 00:00');
    assert.equal(th(last.to), '2026-09-01 00:00');
  });
});

describe('วันที่ระบุ', () => {
  it('"1 ก.ย." และ "1 กันยายน"', () => {
    for (const s of ['ขอข้อมูล 1 ก.ย.', 'ขอข้อมูล 1 กันยายน']) {
      assert.equal(th(parseThaiPeriod(s, NOW).from), '2026-09-01 00:00', s);
    }
  });

  it('"1/9/2569" = พ.ศ. ต้องแปลงเป็น ค.ศ. ไม่งั้นได้ช่วงที่ไม่มีข้อมูล', () => {
    assert.equal(th(parseThaiPeriod('1/9/2569', NOW).from), '2026-09-01 00:00');
    assert.equal(th(parseThaiPeriod('1/9/69', NOW).from), '2026-09-01 00:00');
  });

  it('เลขไทย ๓ วัน อ่านออก', () => {
    assert.equal(parseThaiPeriod('๓ วัน', NOW).days, 3);
  });
});

describe('ไม่ระบุช่วงเวลา', () => {
  it('คืน null เพื่อให้ผู้เรียกใช้ค่าเริ่มต้นของคำสั่ง ไม่ใช่เดาเป็นวันนี้', () => {
    assert.equal(parseThaiPeriod('ขอป้ายทะเบียนที่ฝ่าฝืนเยอะที่สุดมา 3 ป้าย', NOW), null);
    assert.equal(parseThaiPeriod('', NOW), null);
    assert.equal(parseThaiPeriod(null, NOW), null);
  });
});

describe('จำนวนที่ขอ', () => {
  it('"3 ป้าย" · "top 5" · "5 อันดับ"', () => {
    assert.equal(parseLimit('ขอป้ายที่ฝ่าฝืนเยอะที่สุดมา 3 ป้าย'), 3);
    assert.equal(parseLimit('top 5'), 5);
    assert.equal(parseLimit('เอา 5 อันดับ'), 5);
  });

  it('เกินเพดานถูกตัดที่ 20 · ไม่ระบุคืน null', () => {
    assert.equal(parseLimit('ขอ 999 อันดับ'), 20);
    assert.equal(parseLimit('ขอป้ายที่ฝ่าฝืน'), null);
  });

  it('ตัวเลขที่เป็นช่วงเวลาไม่ถูกอ่านเป็นจำนวนอันดับ', () => {
    assert.equal(parseLimit('ยอด 7 วัน'), null);
  });
});
