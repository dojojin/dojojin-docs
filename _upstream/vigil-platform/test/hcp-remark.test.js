// ============================================================
// Vigil Platform — Tests: HCP Description (personInfo.remark) parser
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseHcpRemark } = require('../src/helpers/hcpRemark');

// ของจริงจาก hkt: face indexCode 4814 → personCode 2046131290
// (สังเกตช่องว่างท้ายบรรทัดเลขบัตร — ต้นทางพิมพ์มาแบบนั้นจริง)
const SAMPLE = [
  'หมายจับคดีทดสอบแจ้งเตือน',
  'เลขบัตรประชาชน 5838682146901 ',
  'เลขคดี คดีดำ ผบ. 1-2569',
  'พบเจอติดต่อ สภอ.วิชั่น พตท.วิชั่น 0919409400',
].join('\n');

describe('parseHcpRemark', () => {
  it('แยกครบทุกช่องจากตัวอย่างจริงสี่บรรทัด', () => {
    const r = parseHcpRemark(SAMPLE);
    assert.equal(r.watch_type, 'หมายจับคดีทดสอบแจ้งเตือน');
    assert.equal(r.id_number, '5838682146901');
    assert.equal(r.case_no, 'คดีดำ ผบ. 1-2569');
    assert.equal(r.contact, 'สภอ.วิชั่น พตท.วิชั่น');
    assert.equal(r.phone, '0919409400');
    assert.deepEqual(r.extra, []);
    assert.equal(r.raw, SAMPLE);
  });

  it('ลำดับบรรทัดสลับก็ยังได้ผลเดิม', () => {
    const shuffled = [
      'พบเจอติดต่อ สภอ.วิชั่น พตท.วิชั่น 0919409400',
      'เลขคดี คดีดำ ผบ. 1-2569',
      'เลขบัตรประชาชน 5838682146901',
      'หมายจับคดีทดสอบแจ้งเตือน',
    ].join('\n');
    const r = parseHcpRemark(shuffled);
    assert.equal(r.watch_type, 'หมายจับคดีทดสอบแจ้งเตือน');
    assert.equal(r.id_number, '5838682146901');
    assert.equal(r.case_no, 'คดีดำ ผบ. 1-2569');
    assert.equal(r.phone, '0919409400');
    assert.deepEqual(r.extra, []);
  });

  it('บรรทัดที่ขาดไป = null ไม่ใช่ค่าเดา', () => {
    const r = parseHcpRemark('หมายจับคดีลักทรัพย์\nเลขคดี ผบ. 9-2569');
    assert.equal(r.watch_type, 'หมายจับคดีลักทรัพย์');
    assert.equal(r.case_no, 'ผบ. 9-2569');
    assert.equal(r.id_number, null);
    assert.equal(r.contact, null);
    assert.equal(r.phone, null);
  });

  it('เลขบัตร 12 หลัก = ไม่รับ และเก็บบรรทัดดิบไว้ใน extra (ไม่กลายเป็น title)', () => {
    const r = parseHcpRemark('เลขบัตรประชาชน 583868214690\nหมายจับคดีปลอมแปลง');
    assert.equal(r.id_number, null);
    assert.deepEqual(r.extra, ['เลขบัตรประชาชน 583868214690']);
    assert.equal(r.watch_type, 'หมายจับคดีปลอมแปลง');
  });

  it('เลขบัตรมีเว้นวรรค / ขีดคั่น ก็ยังอ่านได้', () => {
    assert.equal(parseHcpRemark('เลขบัตรประชาชน 5 8386 82146 90 1').id_number, '5838682146901');
    assert.equal(parseHcpRemark('เลขประจำตัวประชาชน 5-8386-82146-90-1').id_number, '5838682146901');
    assert.equal(parseHcpRemark('เลขบัตร 5838682146901').id_number, '5838682146901');
  });

  it('เบอร์แบบ 08x-xxx-xxxx ถูกดึงออกจาก contact', () => {
    const r = parseHcpRemark('พบเจอติดต่อ สภ.เมือง ร.ต.อ.สมชาย 081-234-5678');
    assert.equal(r.phone, '0812345678');
    assert.equal(r.contact, 'สภ.เมือง ร.ต.อ.สมชาย');
  });

  it('บรรทัดขึ้นต้นด้วย "แจ้ง" นับเป็นผู้ติดต่อ', () => {
    const r = parseHcpRemark('แจ้ง พ.ต.ต.ธีรศักดิ์ 0931539251');
    assert.equal(r.contact, 'พ.ต.ต.ธีรศักดิ์');
    assert.equal(r.phone, '0931539251');
    assert.equal(r.watch_type, null);
  });

  it('มี : หลังคำสำคัญก็ตัดทิ้งให้', () => {
    const r = parseHcpRemark('เลขบัตรประชาชน: 5838682146901\nเลขคดี: ผบ. 1-2569\nติดต่อ: สภ.เมือง 0919409400');
    assert.equal(r.id_number, '5838682146901');
    assert.equal(r.case_no, 'ผบ. 1-2569');
    assert.equal(r.contact, 'สภ.เมือง');
    assert.equal(r.phone, '0919409400');
  });

  it('ข้อความบรรทัดเดียวที่ไม่มีคำสำคัญ = title ล้วน', () => {
    const r = parseHcpRemark('บุคคลต้องสงสัย');
    assert.equal(r.watch_type, 'บุคคลต้องสงสัย');
    assert.deepEqual(r.extra, []);
    assert.equal(r.id_number, null);
  });

  it('บรรทัดเกินที่ไม่เข้าคำสำคัญตกไป extra ตามลำดับ', () => {
    const r = parseHcpRemark('คดีที่หนึ่ง\nรายละเอียดเพิ่มเติม\nอีกบรรทัด');
    // บรรทัดที่ 1 = ประเภท · บรรทัดที่ 2 = หัวข้อเหตุการณ์ (นิยามของเจ้าของ 2026-09-08)
    // ที่เหลือจึงตกไป extra
    assert.equal(r.watch_type, 'คดีที่หนึ่ง');
    assert.equal(r.case_title, 'รายละเอียดเพิ่มเติม');
    assert.deepEqual(r.extra, ['อีกบรรทัด']);
  });

  it('ค่าว่าง / null / undefined คืนรูปเดิมเสมอ ไม่โยน error', () => {
    for (const v of ['', '   \n \n', null, undefined]) {
      const r = parseHcpRemark(v);
      assert.equal(r.watch_type, null);
      assert.equal(r.id_number, null);
      assert.equal(r.case_no, null);
      assert.equal(r.contact, null);
      assert.equal(r.phone, null);
      assert.deepEqual(r.extra, []);
    }
    assert.equal(parseHcpRemark(null).raw, null);
    assert.equal(parseHcpRemark(undefined).raw, null);
    assert.equal(parseHcpRemark('').raw, '');
  });
});

describe('mod-11 ของเลขบัตรไทย', () => {
  it('เลข 13 หลักที่ไม่ผ่าน mod-11 ไม่ถูกเก็บเป็นเลขบัตร', () => {
  // 13 หลักครบแต่ checksum ไม่ผ่าน — ถ้าปล่อยผ่าน id_hash จะจับคนคนละคน
  // มารวมเป็น master เดียวถาวร (เจอตอน review 2026-09-08)
  const r = parseHcpRemark('เลขบัตรประชาชน 1234567890123');
  assert.equal(r.id_number, null);
  assert.deepEqual(r.extra, ['เลขบัตรประชาชน 1234567890123']);
});

  it('เลขจริงที่ผ่าน mod-11 ยังเก็บได้ตามปกติ', () => {
  assert.equal(parseHcpRemark('เลขบัตรประชาชน 5838682146901').id_number, '5838682146901');
});
});

// ของจริงหลัง sync 2026-09-08: 364 ระเบียนมีคำอธิบาย ส่วนใหญ่เป็นประโยคยาว
// บรรทัดเดียว ไม่ใช่รูปแบบ 4 บรรทัดที่เจ้าของเพิ่งกำหนด — ถ้ายกทั้งประโยค
// ขึ้นเป็นป้ายสี การ์ด LINE และหน้าเว็บจะได้ป้ายยาวข้ามจอ
describe('คำอธิบายของเดิมที่เป็นประโยคยาว', () => {
  const LONG = 'หมายจับศาลเยาวชน หากพบเจอ แจ้ง ร.ต.อ.สมชาย 0812345678';

  it('ประโยคยาวไม่ถูกยกเป็นป้าย แต่ระดับยังจับได้', () => {
    const r = parseHcpRemark(LONG);
    assert.equal(r.watch_type, null, 'ยาวเกิน 24 ตัว = ไม่เอาไปเป็นป้าย');
    assert.equal(r.watch_level, 'warrant', 'คำว่า "หมายจับ" ยังทำให้ระดับถูกต้อง');
    assert.equal(r.case_title, LONG, 'ข้อความเต็มย้ายไปเป็นหัวข้อเหตุการณ์');
  });

  it('เบอร์โทรที่ฝังกลางประโยคถูกดึงออกมาเป็นช่องโทรศัพท์', () => {
    assert.equal(parseHcpRemark(LONG).phone, '0812345678');
  });

  it('คำสั้นตามรูปแบบใหม่ยังขึ้นเป็นป้ายเหมือนเดิม', () => {
    const r = parseHcpRemark('มีหมายจับ\nคดีทดสอบแจ้งเตือน');
    assert.equal(r.watch_type, 'มีหมายจับ');
    assert.equal(r.watch_level, 'warrant');
    assert.equal(r.case_title, 'คดีทดสอบแจ้งเตือน');
  });

  it('watchLabel ให้คำมาตรฐานไว้ใช้แทนป้ายที่ว่าง', () => {
    const { watchLabel } = require('../src/helpers/hcpRemark');
    assert.equal(watchLabel('warrant'), 'มีหมายจับ');
    assert.equal(watchLabel('watch'), 'เฝ้าระวัง');
    assert.equal(watchLabel('follow'), 'เฝ้าติดตาม');
    assert.equal(watchLabel(null), '');
  });
});

describe('เลขบัตรที่ถูก mask แล้ว', () => {
  // เกิดตอน parse ข้อความที่เก็บไว้ซ้ำในรอบที่ไม่ได้ถามต้นทาง (ดู GOTCHAS #195)
  // ตัวเลขจริงอยู่ใน id_number_enc ไม่ได้หาย จึงไม่ต้องเอาบรรทัดที่อ่านไม่ได้นี้
  // ไปต่อท้ายหมายเหตุ — ของจริงเจอ 2 ระเบียนเมื่อ 2026-09-08
  it('บรรทัดที่เหลือแต่เลข mask ไม่ไหลไปเป็นหมายเหตุ', () => {
    const r = parseHcpRemark('มีหมายจับ\nคดีทดสอบ\n58xxxxxxxxx01');
    assert.deepEqual(r.extra, []);
    assert.equal(r.case_title, 'คดีทดสอบ');
    assert.equal(r.id_number, null);
  });

  it('เลข mask ที่มีคำนำหน้าก็ไม่ไหลไปเป็นหมายเหตุเช่นกัน', () => {
    const r = parseHcpRemark('เลขบัตรประชาชน 38xxxxxxxxx35');
    assert.deepEqual(r.extra, []);
  });

  it('ข้อความอื่นที่บังเอิญมี x ยังอยู่ครบ', () => {
    assert.deepEqual(parseHcpRemark('คดี x-ray ที่ด่าน').case_title, null);
    assert.equal(parseHcpRemark('คดี x-ray ที่ด่าน').watch_type, 'คดี x-ray ที่ด่าน');
  });
});
