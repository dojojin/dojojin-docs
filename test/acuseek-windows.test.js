// ============================================================
// Vigil Platform — หน้าต่างเวลาของค้นหาอัจฉริยะ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// บั๊กของฟีเจอร์นี้เกือบทุกตัวเป็นเรื่องหน้าต่างเวลา และทุกตัวขึ้นกับ "ตอนนี้กี่โมง"
// เทสต์ที่เรียก Date.now() จริงจึงจับไม่ได้ — ที่นี่จึงตรึงเวลาส่งเข้าไปทุกเคส
//
// 🔴 เคสที่เป็นเหตุให้ไฟล์นี้เกิด (เจ้าของเจอเอง 2026-08-14):
// ค้นตอนตี 1 ด้วย "ช่วงเช้า 06–12 ย้อนหลัง 1 วัน" → ช่วงเช้าของวันนี้ยังมาไม่ถึง
// ลูปเดิม continue ทิ้งทุกหน้าต่างแล้วตกไป fallback ที่คืน **ทั้ง 24 ชั่วโมง**
// ⇒ เลือกช่วงเช้าแต่ได้ผลตอนดึกเต็มหน้าจอ โดยไม่มีอะไรบอกว่าตัวกรองถูกทิ้ง
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildWindows } = require('../src/routes/acuseek');

const at = (iso) => new Date(`${iso}+07:00`).getTime();          // ภูเก็ต = UTC+7 เสมอ
const hh = (ms) => new Date(ms).toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).slice(0, 16);
const span = (w) => `${hh(w.start)}→${hh(w.end)}`;
const HOUR = 3600e3;

describe('acuseek buildWindows — ช่วงที่ยังมาไม่ถึง', () => {
  it('ตี 1 + ช่วงเช้า + 1 วัน → ต้องได้เช้าของ "เมื่อวาน" ไม่ใช่ทั้งวัน', () => {
    const w = buildWindows(1, 'morning', null, null, null, at('2026-08-14T01:00:00'));
    assert.strictEqual(w.length, 1);
    assert.strictEqual(span(w[0]), '2026-08-13 06:00→2026-08-13 12:00');
  });

  it('ห้ามคืนหน้าต่าง 24 ชั่วโมงเมื่อผู้ใช้เลือกช่วงแคบ (บั๊กเดิม)', () => {
    for (const band of ['morning', 'evening', 'beforenoon', 'lateaftn', 'dawn']) {
      for (const nowIso of ['2026-08-14T00:10:00', '2026-08-14T03:00:00', '2026-08-14T05:59:00']) {
        for (const w of buildWindows(1, band, null, null, null, at(nowIso))) {
          assert.ok(w.end - w.start <= 12 * HOUR + 1000,
            `${band} @ ${nowIso} ได้หน้าต่างกว้าง ${(w.end - w.start) / HOUR} ชม. — กว้างเกินกว่าที่ช่วงนั้นเป็นไปได้`);
        }
      }
    }
  });

  it('บ่าย 3 + ช่วงเช้า → ใช้เช้าของ "วันนี้" ที่ผ่านไปแล้ว', () => {
    const w = buildWindows(1, 'morning', null, null, null, at('2026-08-14T15:00:00'));
    assert.strictEqual(span(w[0]), '2026-08-14 06:00→2026-08-14 12:00');
  });

  it('ย้อนหลังหลายวันยังได้ครบทุกวัน และเรียงใหม่→เก่า', () => {
    const w = buildWindows(3, 'morning', null, null, null, at('2026-08-14T01:00:00'));
    assert.deepEqual(w.map(span), [
      '2026-08-13 06:00→2026-08-13 12:00',
      '2026-08-12 06:00→2026-08-12 12:00',
      '2026-08-11 06:00→2026-08-11 12:00',
    ]);
  });
});

describe('acuseek buildWindows — พฤติกรรมเดิมที่ต้องไม่พัง', () => {
  it('ทั้งวัน = หน้าต่างเดียวย้อน N วัน ไม่ซอย', () => {
    const now = at('2026-08-14T01:00:00');
    const w = buildWindows(1, 'all', null, null, null, now);
    assert.strictEqual(w.length, 1);
    assert.strictEqual(w[0].end, now);
    assert.strictEqual(w[0].start, now - 864e5);
  });

  it('กลางคืน 18→06 ข้ามเที่ยงคืนได้ และตัดปลายที่ "ตอนนี้"', () => {
    const now = at('2026-08-14T01:00:00');
    const w = buildWindows(1, 'night', null, null, null, now);
    assert.strictEqual(hh(w[0].start), '2026-08-13 18:00');
    assert.strictEqual(w[0].end, now, 'ปลายต้องไม่ล้ำอนาคต');
  });

  it('ระบุช่วงเองชนะ band', () => {
    const w = buildWindows(1, 'morning', { fromMin: 13 * 60, toMin: 14 * 60 }, null, null,
      at('2026-08-14T20:00:00'));
    assert.strictEqual(span(w[0]), '2026-08-14 13:00→2026-08-14 14:00');
  });

  it('ระบุวันที่มาเอง = วันเดียว และห้ามเลื่อนวันให้ (ตอบคนละคำถามกับที่ถาม)', () => {
    const w = buildWindows(3, 'morning', null, { y: 2026, m: 8, d: 10 }, null,
      at('2026-08-14T01:00:00'));
    assert.strictEqual(w.length, 1);
    assert.strictEqual(span(w[0]), '2026-08-10 06:00→2026-08-10 12:00');
  });

  it('ระบุวันที่ในอนาคต → คืนว่าง ให้ผู้เรียกบอกผู้ใช้ตรง ๆ ไม่ใช่ค้นทั้งวัน', () => {
    const w = buildWindows(1, 'morning', null, { y: 2026, m: 9, d: 1 }, null,
      at('2026-08-14T01:00:00'));
    assert.deepEqual(w, []);
  });

  it('dayOffset (เมื่อวาน) ยังทำงาน และไม่ถูกเลื่อนซ้ำ', () => {
    const w = buildWindows(1, 'morning', null, null, 1, at('2026-08-14T01:00:00'));
    assert.strictEqual(span(w[0]), '2026-08-13 06:00→2026-08-13 12:00');
  });
});
