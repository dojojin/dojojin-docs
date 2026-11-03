// ============================================================
// Vigil Platform — Tests: ตัวจับคำสั่งผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ประโยคสองประโยคที่เจ้าของยกมาเป็นตัวอย่าง (2026-09-08) ต้องจับได้ถูกคำสั่ง
// และต้องได้ช่วงเวลา/จำนวนที่ถูกต้องไปด้วยในครั้งเดียว
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, matchCommand, suggest } = require('../src/helpers/lineCommandMatch');

// ชุดคำสั่งเดียวกับที่ migration 201 seed ไว้
const CMDS = [
  { key: 'helmet_count', enabled: true, slots: ['period', 'site'],
    triggers: ['ไม่สวมหมวก', 'ไม่ใส่หมวก', 'หมวกนิรภัย', 'หมวกกันน็อค', 'helmet'],
    require_all: [], exclude: ['ป้าย', 'อันดับ', 'มากสุด', 'เยอะสุด', 'บ่อย'] },
  { key: 'helmet_top', enabled: true, slots: ['period', 'limit', 'site'],
    triggers: ['ไม่สวมหมวก', 'หมวกนิรภัย', 'หมวกกันน็อค', 'helmet'],
    require_all: ['ป้าย'], exclude: [] },
  { key: 'violation_top', enabled: true, slots: ['period', 'limit', 'site'],
    triggers: ['ฝ่าฝืน', 'กระทำผิด', 'ทำผิด', 'violation'],
    require_all: [], exclude: [] },
  { key: 'lpr_count', enabled: true, slots: ['period', 'site'],
    triggers: ['อ่านป้าย', 'ยอดรถ', 'จำนวนรถ', 'ทะเบียนที่อ่านได้', 'อ่านไม่ได้'],
    require_all: [], exclude: ['ฝ่าฝืน', 'หมวก', 'อันดับ'] },
];
const NOW = new Date('2026-09-08T08:20:33Z');   // 15:20 เวลาไทย

describe('ประโยคจริงที่เจ้าของยกมา', () => {
  it('"ขอทราบยอดคนไม่สวมหมวกนิรภัย ชั่วโมงที่แล้ว หน่อย"', () => {
    const r = matchCommand('ขอทราบยอดคนไม่สวมหมวกนิรภัย ชั่วโมงที่แล้ว หน่อย', CMDS, { now: NOW });
    assert.equal(r.status, 'ok');
    assert.equal(r.command.key, 'helmet_count');
    assert.equal(r.slots.period.label, '8 ก.ย. 14:00-14:59');
  });

  it('"ขอป้ายทะเบียนที่ฝ่าฝืน เยอะที่สุดมา 3 ป้าย"', () => {
    const r = matchCommand('ขอป้ายทะเบียนที่ฝ่าฝืน เยอะที่สุดมา 3 ป้าย', CMDS, { now: NOW });
    assert.equal(r.status, 'ok');
    assert.equal(r.command.key, 'violation_top');
    assert.equal(r.slots.limit, 3);
    assert.equal(r.slots.period, undefined, 'ไม่ระบุช่วง = ปล่อยให้คำสั่งใช้ค่าเริ่มต้น');
  });
});

describe('คำสั่งที่คำเรียกทับกัน', () => {
  it('มีคำว่า "ป้าย" = ถามอันดับป้าย ไม่ใช่ยอดรวม', () => {
    const r = matchCommand('ป้ายไหนไม่สวมหมวกนิรภัยบ่อยสุด 5 ป้าย', CMDS, { now: NOW });
    assert.equal(r.command.key, 'helmet_top');
    assert.equal(r.slots.limit, 5);
  });

  it('ไม่มีคำว่า "ป้าย" = ถามยอดรวม', () => {
    assert.equal(matchCommand('วันนี้ไม่สวมหมวกกี่ราย', CMDS, { now: NOW }).command.key, 'helmet_count');
  });

  it('คำต้องห้ามตัดคำสั่งที่ไม่เกี่ยวออก — "อ่านไม่ได้" ที่พ่วงคำว่าฝ่าฝืน', () => {
    const r = matchCommand('รถที่ฝ่าฝืนแล้วอ่านป้ายไม่ได้', CMDS, { now: NOW });
    assert.equal(r.command.key, 'violation_top', 'lpr_count ถูกตัดด้วย exclude "ฝ่าฝืน"');
  });
});

describe('กรณีที่ต้องไม่เดา', () => {
  it('คำสั่งที่ปิดอยู่ไม่ถูกจับ', () => {
    const off = CMDS.map((c) => ({ ...c, enabled: c.key !== 'violation_top' }));
    assert.equal(matchCommand('ขอป้ายที่ฝ่าฝืน', off, { now: NOW }).status, 'no_match');
  });

  it('ประโยคที่ไม่เกี่ยวเลย = no_match ไม่ใช่จับมั่ว', () => {
    const r = matchCommand('สวัสดีครับพี่ ๆ วันนี้ประชุมกี่โมง', CMDS, { now: NOW });
    assert.equal(r.status, 'no_match');
  });

  it('คะแนนสูสี = ถามกลับ ไม่เดา', () => {
    const twins = [
      { key: 'a', enabled: true, triggers: ['รายงาน'], require_all: [], exclude: [], slots: [] },
      { key: 'b', enabled: true, triggers: ['รายงาน'], require_all: [], exclude: [], slots: [] },
    ];
    const r = matchCommand('ขอรายงาน', twins, { now: NOW });
    assert.equal(r.status, 'ambiguous');
    assert.equal(r.candidates.length, 2);
  });

  it('คำยาวชนะคำสั้นเมื่อทั้งคู่เข้าเงื่อนไข', () => {
    const cs = [
      { key: 'broad',  enabled: true, triggers: ['หมวก'], require_all: [], exclude: [], slots: [] },
      { key: 'narrow', enabled: true, triggers: ['หมวกนิรภัย'], require_all: [], exclude: [], slots: [] },
    ];
    assert.equal(matchCommand('ยอดหมวกนิรภัย', cs, { now: NOW }).command.key, 'narrow');
  });
});

describe('การปรับข้อความก่อนเทียบ', () => {
  it('ตัดคำสุภาพและวรรคตอนออก', () => {
    assert.equal(normalize('ขอทราบ ยอดรถ วันนี้ หน่อยครับ!!'), 'ยอดรถ วันนี้');
  });

  it('เลขไทยอ่านออก', () => {
    assert.equal(normalize('เอา ๓ ป้าย'), 'เอา 3 ป้าย');
  });
});

describe('เมื่อจับไม่ได้ ต้องเสนอทางไปต่อ', () => {
  it('suggest คืนคำสั่งที่ใกล้เคียงไม่เกินที่ขอ', () => {
    const s = suggest('หมวก', CMDS, 3);
    assert.ok(s.length > 0 && s.length <= 3);
    assert.ok(s.some((c) => c.key.startsWith('helmet')));
  });
});

describe('บอทต้องไม่แทรกบทสนทนาปกติในกลุ่ม', () => {
  it('ประโยคที่ไม่มีคำซ้อนกับคำสั่งเลย ไม่มีข้อเสนอกลับ = เงียบ', () => {
    // เจอจริงตอนทดสอบ 2026-09-08: suggest คืนคำสั่งแม้ไม่มีคำตรงกันสักคำ
    // ทำให้บอทตอบ "ยังไม่เข้าใจคำสั่งนี้" ใส่ทุกข้อความในกลุ่ม
    assert.deepEqual(suggest('สวัสดีครับพี่ ๆ วันนี้ประชุมกี่โมง', CMDS, 3), []);
    assert.deepEqual(suggest('ไปกินข้าวกันไหม', CMDS, 3), []);
  });

  it('ประโยคที่พูดถึงเรื่องของระบบจริง ยังได้ข้อเสนอ', () => {
    assert.ok(suggest('หมวกนิรภัย', CMDS, 3).length > 0);
  });
});

describe('ชนิดวัตถุจากคำไทย', () => {
  const { matchObjectClass, objLabel } = require('../src/helpers/eventObjectClass');

  it('คำที่ยาวกว่าชนะเสมอ — "จักรยาน" ต้องไม่แย่ง "จักรยานยนต์"', () => {
    assert.equal(matchObjectClass('ขอรูปจักรยานยนต์ RMUTR-V'), 'Motorcycle');
    assert.equal(matchObjectClass('ขอรูปจักรยาน RMUTR-V'), 'Bicycle');
  });

  it('คำพ้องที่คนพิมพ์จริงใช้ได้ และแปลกลับเป็นคำแสดงผลคำเดียว', () => {
    assert.equal(matchObjectClass('ขอรูปมอเตอร์ไซค์'), 'Motorcycle');
    assert.equal(matchObjectClass('ขอรูปรถสิบล้อ'), 'Truck');
    assert.equal(objLabel('Truck'), 'รถบรรทุก');
  });

  it('ประโยคที่ไม่ได้พูดถึงชนิดวัตถุ ต้องไม่จับอะไรเลย', () => {
    assert.equal(matchObjectClass('ขอหมวดเหตุการณ์ RMUTR-V เมื่อวาน'), null);
  });
});

// เจ้าของพิมพ์ "คันหาอัจฉริยะ" (ไม้หันอากาศ) แทน "ค้นหาอัจฉริยะ" (ไม้โท) 2026-09-09
// ผิดตัวเดียว บอทเงียบสนิท ซึ่งจากฝั่งคนพิมพ์แยกไม่ออกจาก "ระบบค้าง"
describe('ทนต่อการพิมพ์วรรณยุกต์ผิด', () => {
  const CMDS = [
    { key: 'smart_search', label: 'ค้นหาอัจฉริยะ', enabled: true, slots: [],
      triggers: ['ค้นหาอัจฉริยะ', 'acuseek'], exclude: [], require_all: [] },
    { key: 'plate_lookup', label: 'ค้นป้าย', enabled: true, slots: [],
      triggers: ['ค้นป้าย', 'ตามหา'], exclude: [], require_all: [] },
    { key: 'helmet_count', label: 'ยอดไม่สวมหมวก', enabled: true, slots: [],
      triggers: ['ไม่สวมหมวก', 'หมวกนิรภัย'], exclude: [], require_all: [] },
  ];

  it('วรรณยุกต์ผิดตัวเดียวยังจับคำสั่งได้', () => {
    const m = matchCommand('คันหาอัจฉริยะ Taxi สีส้ม เมื่อวานตอนเช้า', CMDS);
    assert.equal(m.status, 'ok');
    assert.equal(m.command.key, 'smart_search');
    assert.equal(matchCommand('ขอยอดคนไมสวมหมวก ภูเก็ต', CMDS).command.key, 'helmet_count');
  });

  it('สะกดถูกต้องต้องชนะเสมอเมื่อทั้งคู่เข้าเงื่อนไข', () => {
    const cmds = [...CMDS,
      { key: 'other', label: 'อื่น', enabled: true, slots: [],
        triggers: ['คันหาอัจฉริยะ'], exclude: [], require_all: [] }];
    assert.equal(matchCommand('ค้นหาอัจฉริยะ คนถือร่ม', cmds).command.key, 'smart_search');
  });

  // 🔴 คำสั้นถอดวรรณยุกต์แล้วชนกันง่ายมาก ("ค้น" → "คน") จึงใช้กับคำยาว ≥ 5 ตัวเท่านั้น
  it('บทสนทนาปกติในกลุ่มต้องไม่ถูกจับ แม้จะมีคำที่ถอดวรรณยุกต์แล้วคล้ายกัน', () => {
    assert.equal(matchCommand('สวัสดีครับพี่ ๆ วันนี้ประชุมกี่โมง', CMDS).status, 'no_match');
    assert.equal(matchCommand('คนขับรถกลับบ้านแล้ว', CMDS).status, 'no_match');
    assert.equal(matchCommand('ตามหาคนที่ใช่', CMDS).command.key, 'plate_lookup');
  });
});

// ของจริงบน prod 2026-09-14: ผู้สั่งพิมพ์คุยเรื่องอื่นในห้องเดียวกับที่บอทฟังอยู่
// (ยืนยันจาก line_command_log ไม่ใช่เดา) — เจอ 2 จุด กลไกคนละแบบ
//   1. "...ปิดแจ้งเตือนย้อนหลังก่อน" ชนคำเรียกของ mute_plate ตรงตัว (matchCommand
//      คะแนน 12 — ไม่ใช่การเดา) ป้ายทะเบียนหาไม่เจอ บอทถาม "ป้ายทะเบียนอะไร"
//   2. "...แล้ว @Wirut Boonrit" — คำว่า "แล้ว" (คำไทยสามัญมาก) เป็นส่วนหนึ่งของ
//      คำเรียก "เห็นแล้ว" (ack_alert) → suggest() เสนอ "รับทราบการแจ้งเตือน"
// แก้ด้วย migration 226 — ตัด "ปิดแจ้งเตือน" ออกจาก mute_plate, ตัด "เห็นแล้ว"
// ออกจาก ack_alert (ตรวจแล้ว ack_alert ไม่เคยถูกใช้สำเร็จเลยสักครั้งในปูมทั้งหมด
// ตัดไม่มีต้นทุน · mute_plate วิธีพิมพ์จริงตามเอกสาร/เทสต์คือ "หยุดแจ้งเตือน 1กอ88
// 3 ชั่วโมง" ไม่เคยมีคำว่า "ปิดแจ้งเตือน" เลย ตัดออกไม่กระทบการใช้งานจริง)
//
// ทางที่ไม่เลือก: บังคับ @ บอทก่อนสั่งเสมอ — พลิกการตัดสินใจเดิม (2026-09-08,
// docs/LOGIC_line-commands.md §3) ที่ตั้งใจให้พิมพ์ประโยคไทยธรรมดาได้ · วัดอัตรา
// จริง 14 วันพบว่าบทสนทนาไม่เกี่ยวข้องที่ชนคำสั่งจริงมีแค่ 1 ครั้งจาก 162 ข้อความ
describe('บทสนทนาปกติที่เคยชนคำสั่งจริงบน prod (2026-09-14)', () => {
  const CMDS = [
    { key: 'ack_alert', label: 'รับทราบการแจ้งเตือน', enabled: true, slots: [],
      triggers: ['รับทราบ', 'รับเรื่อง', 'ack'], require_all: ['แจ้งเตือน'], exclude: [] },
    { key: 'mute_plate', label: 'หยุดแจ้งเตือนป้ายนี้', enabled: true, slots: ['plate', 'hours'],
      triggers: ['หยุดแจ้งเตือน', 'พักแจ้งเตือน', 'ปิดเสียง', 'งดแจ้งเตือน'],
      require_all: [], exclude: ['เปิด'] },
    { key: 'unmute_plate', label: 'เปิดแจ้งเตือนป้ายนี้กลับ', enabled: true, slots: ['plate'],
      triggers: ['เปิดแจ้งเตือน', 'เปิดเสียง', 'ยกเลิกหยุดแจ้งเตือน', 'เอากลับ'],
      require_all: [], exclude: [] },
  ];

  it('พูดถึงการปิดฟีเจอร์แจ้งเตือนย้อนหลัง (ไม่ใช่ป้ายทะเบียน) ต้องไม่ถูกจับเป็น mute_plate อีก', () => {
    const m = matchCommand(
      'C9 · C10 · C17 · C30\n\nกล้อง 4 ตัวค้าง ANR ส่งกลับมาทำให้มันแจ้งเตือนย้อนหลัง '
      + 'เดี๋ยวผมไปปิดแจ้งเตือนย้อนหลังก่อน', CMDS);
    assert.equal(m.status, 'no_match', 'ต้องไม่ถูกจับเป็น mute_plate เหมือนเดิม — คำเรียก "ปิดแจ้งเตือน" ต้องถูกตัดแล้ว');
  });

  it('mention คนอื่นแล้วต่อด้วยคำว่า "แล้ว" ต้องไม่ถูกจับเป็นคำสั่งรับทราบ', () => {
    const m = matchCommand('คุยกับพี่วิรุธ แล้ว @Wirut Boonrit', CMDS);
    assert.equal(m.status, 'no_match');
    assert.deepEqual(suggest('คุยกับพี่วิรุธ แล้ว @Wirut Boonrit', CMDS, 3), [],
      'suggest() ก็ต้องไม่เสนอ "รับทราบการแจ้งเตือน" ด้วย ไม่งั้นบอทยังตอบกลับอยู่ดี');
  });

  it('วิธีพิมพ์จริงของ mute_plate (หยุด/พัก/ปิดเสียง/งด) ต้องยังใช้ได้ปกติทุกคำ', () => {
    assert.equal(matchCommand('หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง', CMDS).command.key, 'mute_plate');
    assert.equal(matchCommand('พักแจ้งเตือน 1กอ88', CMDS).command.key, 'mute_plate');
    assert.equal(matchCommand('ปิดเสียง 1กอ88 12 ชม.', CMDS).command.key, 'mute_plate');
    assert.equal(matchCommand('งดแจ้งเตือน 1กอ88', CMDS).command.key, 'mute_plate');
  });

  it('unmute_plate ("เปิดแจ้งเตือน") ไม่ได้ถูกแตะ ยังใช้ได้ปกติ', () => {
    assert.equal(matchCommand('เปิดแจ้งเตือน 1กอ88', CMDS).command.key, 'unmute_plate');
  });
});
