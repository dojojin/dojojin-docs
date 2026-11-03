// ============================================================
// Vigil Platform — Tests: กรองตามจังหวัดของป้ายทะเบียน
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เจ้าของพิมพ์ "สรุปจำนวนป้ายทะเบียน จังหวัด ยะลา ที่หาดใหญ่ เมื่อวาน" แล้วได้ยอดรวม
// ของหาดใหญ่ทั้งหมด (313,780) กลับไป — คำว่า "จังหวัดยะลา" ถูกทิ้งเงียบ (2026-09-09)
// ของจริงคือ 4,472 (ตรวจกับ SQL ตรง ๆ แล้ว)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractSlots } = require('../src/helpers/lineCommandMatch');
const { SOURCES } = require('../src/line-answer-sources');

const CMD = { slots: ['period', 'site', 'camera', 'province'], _sites: [] };
const NOW = new Date('2026-09-08T17:40:00Z');

describe('อ่านจังหวัดของป้ายจากประโยค', () => {
  it('ต้องมีคำว่า "จังหวัด" นำ — เว้นวรรคหรือไม่เว้นก็ได้', () => {
    assert.equal(extractSlots('สรุปจำนวนป้ายทะเบียน จังหวัด ยะลา ที่หาดใหญ่', CMD, NOW).province, 'ยะลา');
    assert.equal(extractSlots('จำนวนป้ายทะเบียนจังหวัดสงขลา เมื่อวาน', CMD, NOW).province, 'สงขลา');
  });

  // 🔴 ชื่อจังหวัดหลายตัวเป็นชื่อไซต์ด้วย ("ภูเก็ต") — จับจากชื่อลอย ๆ จะแยกไม่ออกว่า
  //    "ที่ภูเก็ต" (สถานที่) กับ "ป้ายจังหวัดภูเก็ต" (ทะเบียน) เป็นคนละความหมาย
  it('ชื่อจังหวัดลอย ๆ ที่ไม่มีคำว่า "จังหวัด" ต้องไม่ถูกจับ', () => {
    assert.equal(extractSlots('สรุปจำนวนป้ายทะเบียน ภูเก็ต เมื่อวาน', CMD, NOW).province, undefined);
  });
});

describe('การ์ดยอดป้ายเฉพาะจังหวัด', () => {
  it('ตัวเลขหลักคือจำนวนที่นับได้ และเขียนกำกับว่าเฉพาะจังหวัดนั้น', () => {
    const out = SOURCES.lpr_count.format({ _province: true, n: 4472, exact: true },
      { province: 'ยะลา' });
    assert.equal(out.big, '4,472');
    assert.equal(out.unit, 'ป้าย');
    assert.match(out.note, /เฉพาะป้ายจังหวัดยะลา/);
  });

  it('นับไม่ทันจนได้ค่าประมาณ ต้องเขียนบอก ไม่ใช่โชว์เป็นยอดจริง', () => {
    const out = SOURCES.lpr_count.format({ _province: true, n: 5000, exact: false },
      { province: 'ยะลา' });
    assert.match(out.note, /ค่าประมาณ/);
  });

  it('สะกดชื่อจังหวัดผิด = 0 พร้อมบอกให้ตรวจชื่อ', () => {
    const out = SOURCES.lpr_count.format({ _province: true, n: 0, exact: true },
      { province: 'ยะลาา' });
    assert.equal(out.empty, true);
    assert.match(out.emptyText, /ตรวจชื่อจังหวัด/);
  });

  it('ไม่ระบุจังหวัด = การ์ดเดิมทุกอย่าง', () => {
    const out = SOURCES.lpr_count.format({ total: 723181, noread: 31421, vehicles: 754602 }, {});
    assert.equal(out.big, '723,181');
    assert.equal(out.unit, 'ป้ายที่อ่านได้');
  });
});
