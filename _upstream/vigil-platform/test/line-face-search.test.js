// ============================================================
// Vigil Platform — Tests: ค้นหาใบหน้าตามลักษณะ จากในแชท
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// สามประโยคตัวอย่างมาจากเจ้าของเอง 2026-09-09 — ถ้าอ่านสามประโยคนี้ไม่ออก ถือว่าพัง
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFaceAttrs, describeFaceAttrs, ageGroupTh } = require('../src/helpers/faceQueryTh');
const { parseThaiPeriod } = require('../src/helpers/thaiPeriod');
const { SOURCES } = require('../src/line-answer-sources');

const NOW = new Date('2026-09-08T17:40:00Z');   // 9 ก.ย. 00:40 เวลาไทย

describe('อ่านลักษณะคนจากประโยค', () => {
  it('สามประโยคที่เจ้าของยกมา ต้องอ่านออกครบ', () => {
    assert.deepEqual(parseFaceAttrs('ค้นหาใบหน้า ผู้หญิง ตอนเช้าช่วง ตีหนึ่ง ภูเก็ต กล้อง C38'),
      { gender: 'female' });
    assert.deepEqual(parseFaceAttrs('ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง ตอนเช้า'),
      { gender: 'female', top_color: 'Red' });
    assert.deepEqual(parseFaceAttrs('ค้นหาใบหน้า คนใส่หน้ากาก ช่วงบ่าย'), { mask: 'yes' });
  });

  // 🔴 "ไม่สวมหน้ากาก" มีคำว่า "หน้ากาก" อยู่ในตัว — ตรวจฝั่งยืนยันก่อนจะได้ตัวกรองกลับหัว
  it('ปฏิเสธต้องชนะคำยืนยันเสมอ', () => {
    const a = parseFaceAttrs('ผู้ชาย ไม่สวมหน้ากาก ไม่ใส่หมวก');
    assert.equal(a.mask, 'no');
    assert.equal(a.hat, 'no');
  });

  it('สีต้องผูกกับชิ้นเสื้อผ้า ไม่ใช่เดาว่าสีลอย ๆ คือเสื้อ', () => {
    assert.equal(parseFaceAttrs('กางเกงสีดำ').bottom_color, 'Black');
    assert.equal(parseFaceAttrs('กางเกงสีดำ').top_color, undefined);
    assert.equal(parseFaceAttrs('สีแดง').top_color, undefined, 'สีลอย ๆ ห้ามเดา');
  });

  it('แว่นกันแดดต้องไม่กลายเป็นแว่นสายตา', () => {
    assert.equal(parseFaceAttrs('ใส่แว่นกันแดด').glass, 'sunglasses');
    assert.equal(parseFaceAttrs('ใส่แว่น').glass, 'yes');
  });

  it('เขียนเงื่อนไขกลับเป็นภาษาไทยได้ครบ ไว้พิมพ์บนการ์ด', () => {
    const s = describeFaceAttrs(parseFaceAttrs('ผู้หญิง อายุ 20-29 เสื้อสีแดง สวมหมวก')).join(' · ');
    assert.match(s, /ผู้หญิง/); assert.match(s, /20-29/);
    assert.match(s, /เสื้อสีแดง/); assert.match(s, /สวมหมวก/);
  });

  it('ช่วงวัยที่กล้องส่งมาเป็นคำไทยเดียวกับหน้าเว็บ', () => {
    assert.equal(ageGroupTh('prime'), 'วัยทำงาน');
    assert.equal(ageGroupTh('middleAged'), 'วัยกลางคน');
    assert.equal(ageGroupTh('ไม่รู้จัก'), null);
  });
});

describe('ช่วงเวลาแบบที่คนพูด', () => {
  const label = (t) => parseThaiPeriod(t, NOW).label;

  it('ตีหนึ่ง / บ่ายสองโมง / สามทุ่ม / เที่ยง', () => {
    assert.match(label('เมื่อวาน ตีหนึ่ง'), /01:00-02:00/);
    assert.match(label('เมื่อวาน บ่ายสองโมง'), /14:00-15:00/);
    assert.match(label('เมื่อวาน สามทุ่ม'), /21:00-22:00/);
    assert.match(label('เมื่อวาน เที่ยง'), /12:00-13:00/);
  });

  it('ช่วงของวัน — ขอบเขตต้องตรงกับที่ใช้ในหน้าค้นหาอัจฉริยะ', () => {
    assert.match(label('เมื่อวานตอนเช้า'), /06:00-12:00/);
    assert.match(label('เมื่อวานช่วงบ่าย'), /12:00-18:00/);
    assert.match(label('เมื่อวานกลางคืน'), /18:00/, 'กลางคืนข้ามเที่ยงคืนไปวันถัดไป');
  });

  it('ชั่วโมงที่เจาะจงชนะช่วงของวันเสมอ', () => {
    assert.match(label('ตอนเช้าช่วง ตีหนึ่ง'), /01:00-02:00/);
  });
});

describe('การ์ดค้นหาใบหน้า', () => {
  const ROWS = [
    { camera_id: 'C41-PT-SB-18', event_time: '2026-09-08T04:59:00Z', snapshot: 'face/a.jpg',
      gender: 'female', age_group: 'prime', mask: 'yes', hat: 'no', glass: 'no' },
    { camera_id: 'C43-PT-SB-18', event_time: '2026-09-08T04:58:00Z', snapshot: null,
      snapshot_full: 'face/b.jpg', gender: 'female', age_group: 'young' },
    { camera_id: 'C43-PT-SB-18', event_time: '2026-09-08T04:57:00Z', gender: 'female' },
  ];
  const SLOTS = { face_attrs: { gender: 'female', top_color: 'Red' },
                  _camNames: { 'C41-PT-SB-18': 'แยกหน้าห้างเซ็นทรัล (C41)' } };

  it('แถวที่ไม่มีภาพเลยไม่ถูกนับ · ไม่มีภาพครอปใช้ภาพเต็มแทน', () => {
    const out = SOURCES.face_photos.format(ROWS, SLOTS, NOW);
    assert.equal(out.photos.length, 2);
    assert.equal(out.photos[1].file, 'face/b.jpg');
  });

  it('คำบรรยายเป็นเวลาไทย + ลักษณะที่กล้องเห็น (คำไทย ไม่ใช่รหัสดิบ)', () => {
    const out = SOURCES.face_photos.format(ROWS, SLOTS, NOW);
    assert.match(out.photos[0].caption, /^11:59/);
    assert.match(out.photos[0].caption, /หญิง วัยทำงาน หน้ากาก/);
    assert.ok(!out.photos[0].caption.includes('prime'), 'ห้ามหลุดรหัสอังกฤษออกไป');
  });

  it('การ์ดต้องพิมพ์เงื่อนไขที่ใช้ค้นกลับมาเสมอ ให้ค้านได้ว่าตีความตรงไหม', () => {
    assert.match(SOURCES.face_photos.format(ROWS, SLOTS, NOW).note, /ผู้หญิง · เสื้อสีแดง/);
    assert.match(SOURCES.face_photos.format([], SLOTS, NOW).emptyText, /ผู้หญิง · เสื้อสีแดง/);
  });

  it('ไม่ระบุลักษณะเลย ต้องบอกว่ากำลังแสดงทั้งหมด ไม่ใช่เงียบ', () => {
    assert.match(SOURCES.face_photos.format(ROWS, { face_attrs: {} }, NOW).note,
      /ไม่ได้ระบุลักษณะ/);
  });

  it('ตัวกรองที่ส่งไป endpoint ต้องเป็นค่าเดียวกับที่หน้าเว็บส่ง', () => {
    const q = SOURCES.face_photos.query(
      { face_attrs: { gender: 'female', mask: 'yes' }, period: parseThaiPeriod('เมื่อวาน', NOW) }, NOW);
    assert.equal(q.gender, 'female');
    assert.equal(q.mask, 'yes');
    assert.equal(q.with_total, '0', 'ห้ามขอให้นับ — การนับช่วงกว้างเคยทำให้หน้าเว็บค้าง');
  });
});
