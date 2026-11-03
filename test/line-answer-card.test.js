// ============================================================
// Vigil Platform — Tests: หน้าตาการ์ดคำตอบของคำสั่งผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เจ้าของทัก 2026-09-09 ว่าการ์ดอ่านยาก: "เข้า 4,256 ออก 4,323" ถูกยัดต่อท้ายชื่อหมวด
// ในช่องเดียวกัน ชื่อจึงตัดบรรทัด แล้วตัวเลขรวมทางขวาไม่ตรงกับชื่อของตัวเอง
// เทสต์นี้ล็อกโครงไว้: ชื่ออยู่คนละ text กับรายละเอียดย่อย และตัวเลขรวมอยู่คนละคอลัมน์
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAnswerFlex } = require('../src/line-sender');

const CARD = {
  title: 'หมวดเหตุการณ์', period: 'RMUTR-V · เมื่อวาน 8 ก.ย.',
  big: '12,273', unit: 'ครั้ง',
  rows: [['รถจักรยานยนต์', '8,579', 'เข้า 4,256 · ออก 4,323'], ['รถบัส', '1', 'ออก 1']],
  rowsTotal: 2, note: 'นับจากกล้องวิเคราะห์ภาพ ไม่ใช่กล้องอ่านป้าย',
};

const body = (c) => buildAnswerFlex(c).contents.body.contents;
const texts = (n) => JSON.stringify(n);

describe('การ์ดคำตอบใน LINE', () => {
  it('ชื่อกับรายละเอียดย่อยแยก text กัน และตัวเลขรวมอยู่คนละกล่อง', () => {
    const rowBox = body(CARD).find((b) => b.type === 'box' && b.layout === 'vertical'
                                          && Array.isArray(b.contents) && b.contents[0]?.layout === 'horizontal');
    const first = rowBox.contents[0];
    assert.equal(first.contents[0].contents[0].text, 'รถจักรยานยนต์');
    assert.equal(first.contents[0].contents[1].text, 'เข้า 4,256 · ออก 4,323');
    assert.equal(first.contents[1].text, '8,579');
    assert.equal(first.contents[1].align, 'end');
  });

  it('แถวที่ไม่มีรายละเอียดย่อยไม่ขึ้นบรรทัดว่าง', () => {
    const c = { ...CARD, rows: [['อ่านไม่ได้', '3,765']] };
    const rowBox = body(c).find((b) => b.layout === 'vertical' && b.contents[0]?.layout === 'horizontal');
    assert.equal(rowBox.contents[0].contents[0].contents.length, 1);
  });

  it('หมายเหตุท้ายการ์ดมีเส้นคั่นก่อน ไม่ไปกองต่อจากตัวเลขจนดูเหมือนอีกรายการ', () => {
    const b = body(CARD);
    const noteIdx = b.findIndex((x) => x.text === CARD.note);
    assert.ok(noteIdx > 0);
    assert.equal(b[noteIdx - 1].type, 'separator');
  });

  it('การ์ดที่ไม่มีตาราง (ตอบว่าไม่มีข้อมูล) ไม่ต้องมีเส้นคั่นลอย', () => {
    const b = body({ title: 'x', empty: true, emptyText: 'ไม่มีข้อมูล', note: 'หมายเหตุ' });
    assert.ok(!texts(b).includes('separator'));
  });
});
