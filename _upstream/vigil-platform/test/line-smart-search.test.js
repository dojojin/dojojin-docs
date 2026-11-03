// ============================================================
// Vigil Platform — Tests: สั่งค้นหาอัจฉริยะ (AcuSeek) จากในแชท
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// รูปร่าง payload ตัดมาจากการยิงจริง 2026-09-09 (ห้ามแต่งขึ้นเอง — WA #3)
// "คนถือร่ม เมื่อวานตอนบ่ายโมง" → 236 รายการ ตรงกับตัวเลขบนหน้าจอของเจ้าของ
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SOURCES } = require('../src/line-answer-sources');
const { _stripTriggers } = require('../src/helpers/lineCommandRun');

const DONE = {
  _phase: 'done', ok: true, runStatus: 'completed', total: 236, saturated: false,
  english: 'a person holding an umbrella', timeLabel: 'เมื่อวาน · 13:00–14:00',
  warnings: [], unknown: ['กาง'], dropped_by_scope: 0,
  results: [
    { camera_name: 'ซอยรมณี - ถนนถลาง (C56)', time: '2026-09-08T13:58:00+07:00' },
    { camera_name: 'ซอยรมณี - ถนนถลาง (C56)', time: '2026-09-08T13:57:00+07:00' },
    { camera_name: 'ท้ายซอยบางลา (C47)', time: '2026-09-08T13:56:00+07:00' },
  ],
};

describe('ค้นหาอัจฉริยะผ่าน LINE', () => {
  it('การ์ดพิมพ์ช่วงเวลาที่ **เครื่องค้นตีความเอง** กลับมาเสมอ', () => {
    assert.equal(SOURCES.smart_search.format(DONE).periodLabel, 'เมื่อวาน · 13:00–14:00');
  });

  it('คำที่ใช้ค้นจริงและคำที่ระบบไม่รู้จัก ต้องไปถึงคนอ่าน', () => {
    const out = SOURCES.smart_search.format(DONE);
    assert.match(out.note, /a person holding an umbrella/);
    assert.match(out.note, /ยังไม่รู้จักคำว่า กาง/);
    assert.match(out.note, /ไม่ใช่ลำดับความถูกต้อง/, 'คำเตือนเรื่องความน่าเชื่อถือต้องติดไปด้วยเสมอ');
  });

  // เหตุผลเดียวกับหัวไฟล์ routes/acuseek.js — "คนถือปืน" ได้ 97 คะแนนพร้อมภาพที่ไม่มีปืน
  it('คำเตือนเรื่องสิ่งที่เครื่องทำไม่ได้ ห้ามหายไประหว่างทาง', () => {
    const out = SOURCES.smart_search.format(
      { ...DONE, warnings: [{ id: 'gun', th: 'เครื่องแยกอาวุธไม่ได้' }] });
    assert.match(out.note, /เครื่องแยกอาวุธไม่ได้/);
  });

  it('จำนวนต่อกล้องนับจากตัวอย่างที่ดึงมา ต้องเขียนกำกับ ไม่ใช่ปล่อยให้เข้าใจว่าเป็นทั้งหมด', () => {
    const out = SOURCES.smart_search.format(DONE);
    assert.equal(out.big, '236');
    assert.deepEqual(out.rows[0], ['ซอยรมณี - ถนนถลาง (C56)', '2']);
    assert.match(out.note, /นับจาก 3 รายการล่าสุด/);
  });

  it('ค้นไม่สำเร็จ ต้องบอกเหตุผลที่ทำอะไรต่อได้ ไม่ใช่ "ผิดพลาด"', () => {
    const no = SOURCES.smart_search.format({ _phase: 'rejected', ok: false, reason: 'noCameras' });
    assert.match(no.emptyText, /ไม่มีกล้องที่ค้นได้/);
    const slow = SOURCES.smart_search.format({ _phase: 'slow', english: 'x' });
    assert.match(slow.emptyText, /ยังทำงานไม่เสร็จ/);
  });

  it('ตัดคำเรียกออกจากประโยคก่อนส่งให้เครื่องค้น (ตัวยาวก่อนตัวสั้น)', () => {
    assert.equal(
      _stripTriggers('ค้นหาอัจฉริยะ คนถือร่มเมื่อวานตอนบ่ายโมง', ['ค้นหาอัจฉริยะ', 'ค้นหา']),
      'คนถือร่มเมื่อวานตอนบ่ายโมง');
  });
});
