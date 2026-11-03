// ============================================================
// Vigil Platform — Tests: นับเหตุการณ์แยกตามชนิดวัตถุ (คำสั่งกลุ่ม B)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SOURCES } = require('../src/line-answer-sources');
const { matchCommand } = require('../src/helpers/lineCommandMatch');

const NOW = new Date('2026-09-08T17:40:00Z');

describe('จำนวนตามชนิดวัตถุ', () => {
  // payload จาก /api/stats/object-counts ที่ยิงจริง 2026-09-09 (ภูเก็ต 12 ชม.)
  const DATA = {
    from: '2026-09-07T17:00:00.000Z', to: '2026-09-08T05:00:00.000Z',
    source: 'rollup', stale_minutes: 5, total: 141309,
    classes: [
      { object_class: 'Motorcycle', count: 59744 },
      { object_class: 'Vehicle', count: 26266 },
      { object_class: 'Car', count: 25496 },
    ],
  };

  it('ระบุชนิด = ตัวเลขใหญ่เป็นของชนิดนั้น ไม่ใช่ยอดรวม', () => {
    const out = SOURCES.object_counts.format(DATA, { object_class: 'Motorcycle' }, NOW);
    assert.equal(out.big, '59,744');
    assert.deepEqual(out.rows, []);
  });

  it('ไม่ระบุชนิด = แจงทุกชนิดในครั้งเดียว พร้อมยอดรวม', () => {
    const out = SOURCES.object_counts.format(DATA, {}, NOW);
    assert.equal(out.big, '141,309');
    assert.deepEqual(out.rows[0], ['รถจักรยานยนต์', '59,744']);
  });

  // 🔴 anprAlarm พก object_class มาเหมือนกัน (วัดจริงที่ RMUTR-V 1 ชม.:
  //    LineDetector 595 + anprAlarm 214) ⇒ คันที่ผ่านทั้งสองแบบถูกนับสองครั้ง
  it('ต้องเขียนบอกว่ารวมกล้องอ่านป้ายด้วย และข้อมูลสรุปช้ากว่าจริงกี่นาที', () => {
    const out = SOURCES.object_counts.format(DATA, { object_class: 'Motorcycle' }, NOW);
    assert.match(out.note, /รวมกล้องอ่านป้าย/);
    assert.match(out.note, /นับสองครั้ง/);
    assert.match(out.note, /อัปเดตทุก 5 นาที/);
  });

  it('ชนิดที่ขอไม่มีในผลลัพธ์ = 0 พร้อมอธิบายว่าทำไม', () => {
    const out = SOURCES.object_counts.format(DATA, { object_class: 'Truck' }, NOW);
    assert.equal(out.empty, true);
    assert.match(out.emptyText, /ไม่ได้ส่งชนิดวัตถุมา/);
  });

  it('ส่งชนิดไปให้ endpoint กรอง ไม่ใช่ดึงมาทั้งหมดแล้วกรองเอง', () => {
    const q = SOURCES.object_counts.query({ object_class: 'Truck' }, NOW);
    assert.equal(q.object_classes, 'Truck');
    assert.ok(q.from && q.to);
  });
});

describe('คำสั่งที่พิมพ์แบบคนพูด', () => {
  // อ่านคำเรียกจริงจาก migration — เทสต์จะพังถ้ามีคนถอดคำเรียกออกโดยไม่ตั้งใจ
  const sql218 = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'db_migration_218_line_wording_and_object_counts.sql'), 'utf8');

  it('คำเรียกที่เจ้าของพิมพ์จริงถูกเพิ่มไว้แล้ว', () => {
    for (const w of ['จำนวนป้ายทะเบียน', 'กล้องติดดับ', 'สถานะกล้อง']) {
      assert.ok(sql218.includes(w), `ยังไม่มีคำเรียก "${w}"`);
    }
  });

  // 🔴 "ป้ายทะเบียน" เฉย ๆ ยาว 11 ตัว จะชนะ "ขอรูป"+"รูปรถ" (รวม 10) แล้วดึงคำถาม
  //    เรื่องรูปไปนับยอดแทน — จึงใส่ได้เฉพาะรูปที่มีคำบอกเจตนานำหน้า
  it('ห้ามใส่คำเรียกกว้าง ๆ ว่า "ป้ายทะเบียน" ให้คำสั่งนับยอด', () => {
    // ตัดบรรทัดคอมเมนต์ทิ้งก่อน — เหตุผลที่เขียนไว้ก็มีคำนี้อยู่ในตัว
    const code = sql218.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    const lprPart = code.split("key = 'lpr_count'")[0];
    assert.ok(!/\["ป้ายทะเบียน"|,"ป้ายทะเบียน"|"ป้ายทะเบียน",/.test(lprPart));
  });

  it('ถามชนิดรถเจาะจง ต้องไม่ตกไปที่คำสั่งยอดอ่านป้าย', () => {
    const cmds = [
      { key: 'lpr_count', enabled: true, slots: [], require_all: [],
        triggers: ['อ่านป้าย', 'ยอดรถ', 'จำนวนรถ', 'จำนวนป้ายทะเบียน'],
        exclude: ['รถจักรยานยนต์', 'รถบรรทุก'] },
      { key: 'object_counts', enabled: true, slots: [], require_all: [], exclude: [],
        triggers: ['จำนวนรถจักรยานยนต์', 'จำนวนรถบรรทุก'] },
    ];
    assert.equal(matchCommand('สรุปจำนวนรถจักรยานยนต์ เมื่อวาน', cmds, { now: NOW }).command.key,
      'object_counts');
    assert.equal(matchCommand('สรุปจำนวนป้ายทะเบียน เมื่อวาน', cmds, { now: NOW }).command.key,
      'lpr_count');
  });
});
