// ============================================================
// Vigil Platform — Tests: ข้อความ "ช่วยเหลือ"
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เจ้าของขอ 2026-09-09: รายชื่อเปล่า ๆ 21 บรรทัดไม่ได้บอกว่าพิมพ์ยังไง
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { helpText } = require('../src/helpers/lineCommandRun');

const CMDS = [
  { key: 'lpr_count', label: 'ยอดอ่านป้ายทะเบียน', example: 'สรุปจำนวนป้ายทะเบียน หาดใหญ่ เมื่อวาน' },
  { key: 'no_ex', label: 'คำสั่งที่ยังไม่มีตัวอย่าง' },
  { key: 'mute_plate', label: 'หยุดแจ้งเตือนป้ายนี้', action_key: 'mute_plate',
    example: 'หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง' },
];

describe('ข้อความช่วยเหลือ', () => {
  it('แยกกลุ่ม "ถามข้อมูล" กับ "สั่งให้ทำ" — สองอย่างนี้เสี่ยงไม่เท่ากัน', () => {
    const t = helpText(CMDS);
    assert.ok(t.indexOf('[ ถามข้อมูล ]') < t.indexOf('[ สั่งให้ทำ ]'));
    assert.ok(t.indexOf('ยอดอ่านป้ายทะเบียน') < t.indexOf('[ สั่งให้ทำ ]'));
    assert.ok(t.indexOf('หยุดแจ้งเตือนป้ายนี้') > t.indexOf('[ สั่งให้ทำ ]'));
  });

  it('มีตัวอย่างที่พิมพ์ตามได้จริงใต้ชื่อคำสั่ง', () => {
    assert.match(helpText(CMDS), /สรุปจำนวนป้ายทะเบียน หาดใหญ่ เมื่อวาน/);
  });

  it('คำสั่งที่ยังไม่ได้กรอกตัวอย่าง ต้องไม่ทิ้งบรรทัดว่างไว้', () => {
    const lines = helpText(CMDS).split('\n');
    const i = lines.findIndex((l) => l.includes('คำสั่งที่ยังไม่มีตัวอย่าง'));
    assert.ok(!/^ {3}\s*$/.test(lines[i + 1] || ''), 'ห้ามมีบรรทัดย่อหน้าว่าง');
  });

  it('บอกวิธีเติมเวลาและขอบเขตต่อท้าย — สองอย่างที่คนพิมพ์ผิดบ่อยที่สุด', () => {
    const t = helpText(CMDS);
    assert.match(t, /ก่อนเที่ยง/);
    assert.match(t, /กล้องฉัตรไชย ทั้งหมด/);
  });

  it('ยังไม่มีคำสั่งเปิดใช้ ต้องบอกตรง ๆ ไม่ใช่หัวข้อลอย', () => {
    assert.equal(helpText([]), 'ยังไม่มีคำสั่งที่เปิดใช้งาน');
  });
});
