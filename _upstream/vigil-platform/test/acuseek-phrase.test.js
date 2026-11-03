// ============================================================
// Vigil Platform — Tests: แปลคำค้นไทยให้ AcuSeek
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// สิ่งที่เทสต์ชุดนี้คุ้มครองไม่ใช่ "แปลสวย" แต่คือ 2 อย่างที่ผู้ใช้เดือดร้อนจริง:
//   1. คำถามที่เครื่องตอบไม่ได้ ต้องมีคำเตือน — ไม่งั้นผู้ใช้เห็นคะแนน 97 แล้วเชื่อ
//      ทั้งที่ภาพไม่มีสิ่งที่ถามหา (เคสจริง "คนถือปืน")
//   2. คำต้องห้ามต้องถูกดักก่อนถึงเครื่อง พร้อมบอกทางเลี่ยงที่ใช้ได้จริง

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/helpers/acuseekPhrase');

describe('แปลไทย → วลีอังกฤษ', () => {
  it('ประกอบเป็นวลี ไม่ใช่คำเดี่ยว (วัดจริง: คำเดี่ยวได้ 77 วลีได้ 90)', () => {
    const en = P.toEnglish('คนสะพายเป้');
    assert.match(en, /^a person /);
    assert.match(en, /backpack/);
    assert.ok(en.split(' ').length >= 4, `ได้วลีสั้นเกินไป: "${en}"`);
  });

  it('สีของเสื้อผ้าไปอยู่กับเสื้อ ส่วนสีของรถไปอยู่กับรถ', () => {
    assert.match(P.toEnglish('ผู้ชายใส่เสื้อสีแดง'), /^a man wearing a red shirt/);
    assert.match(P.toEnglish('รถสีขาว'), /^a white car/);
  });

  it('ไม่ระบุว่าคนหรือรถ แต่มีของสวมใส่ → ถือว่าเป็นคน', () => {
    assert.match(P.toEnglish('ใส่หมวกกันน็อก'), /^a person wearing a helmet/);
  });

  it('คำที่พิสูจน์แล้วว่าได้ผล 3/3 ต้องแปลออกมาตรงกับที่ทดสอบ', () => {
    assert.match(P.toEnglish('คนขี่มอเตอร์ไซค์ไม่สวมหมวก'), /without a helmet/);
    assert.match(P.toEnglish('รถขายไอศกรีม'), /ice cream truck/);
    assert.match(P.toEnglish('รถเข็นขายของ'), /street food stall cart/);
    assert.match(P.toEnglish('คนใส่จีวรเดินเท้าเปล่า'), /orange robes/);
    assert.match(P.toEnglish('คนใส่จีวรเดินเท้าเปล่า'), /barefoot/);
  });

  it('แยก "มอเตอร์ไซค์" ออกจาก "จักรยาน" และ "รถเข็น" ออกจาก "รถ"', () => {
    assert.match(P.toEnglish('จักรยานยนต์'), /motorcycle/);
    assert.match(P.toEnglish('จักรยาน'), /bicycle/);
    assert.doesNotMatch(P.toEnglish('จักรยาน'), /motorcycle/);
    assert.match(P.toEnglish('รถเข็นขายของ'), /stall cart/);
  });


  it('คนขี่มอเตอร์ไซค์ = คน ไม่ใช่รถ (บั๊กที่เจอตอน reproduce กับเครื่องจริง)', () => {
    const en = P.toEnglish('คนขี่มอเตอร์ไซค์ไม่สวมหมวก');
    assert.equal(en, 'a motorcycle rider without a helmet',
      'ต้องได้รูปที่ทดสอบแล้วถูก 3/3 ไม่ใช่ "a motorcycle without a helmet"');
  });

  it('ช่องเดียวกันเอาอันเดียว — ห้ามได้วลีที่ขัดแย้งกันเอง', () => {
    const en = P.toEnglish('ไม่สวมหมวก');
    assert.match(en, /without a helmet/);
    assert.doesNotMatch(en, /wearing a hat/, 'ได้ทั้ง "ไม่ใส่หมวก" และ "ใส่หมวก" พร้อมกัน');
    assert.doesNotMatch(en, /wearing a helmet/);
  });

  it('รถเปล่า ๆ ที่ไม่มีคนขี่ ยังเป็นรถอยู่', () => {
    assert.equal(P.toEnglish('รถสีขาว'), 'a white car');
    assert.match(P.toEnglish('มอเตอร์ไซค์'), /^a motorcycle$/);
  });

  it('ไม่มี "riding" ซ้ำเมื่อประธานเป็น rider แล้ว', () => {
    assert.doesNotMatch(P.toEnglish('คนขี่มอเตอร์ไซค์'), /rider.*riding/);
  });

  it('ไม่รู้จักสักคำ → คืน null (ไม่ส่งขยะไปให้เครื่อง)', () => {
    assert.equal(P.toEnglish('อะไรก็ไม่รู้ ฟหกด'), null);
    assert.equal(P.toEnglish(''), null);
  });
});

describe('คำต้องห้าม — ต้องดักก่อนถึงเครื่อง', () => {
  it('จับคำไทยได้ และบอกทางเลี่ยงที่ยืนยันแล้วว่าใช้ได้', () => {
    const r = P.prepare('พระยืนบิณฑบาต');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'blocked');
    assert.equal(r.blocked[0].en, 'monk');
    assert.match(r.blocked[0].hint.th, /จีวร/);   // ทางเลี่ยงที่ได้พระจริง 3/3
  });

  it('จับคำอังกฤษที่ผู้ใช้พิมพ์เองได้ด้วย', () => {
    assert.equal(P.prepare('a monk walking').ok, false);
  });

  it('ครบทั้ง 6 หมวดที่ยืนยันแล้วว่าเครื่องบล็อก', () => {
    const groups = new Set(P.BLOCKED.map((b) => b.group));
    ['ศาสนา', 'ความยากจน', 'ความพิการ', 'เชื้อชาติ', 'สถานะการย้ายถิ่น', 'อาชีพทางเพศ']
      .forEach((g) => assert.ok(groups.has(g), `ขาดหมวด ${g}`));
  });

  it('ตารางสำหรับหน้าจอจัดกลุ่มให้แล้ว', () => {
    const t = P.blockedTable();
    assert.ok(t.length >= 6);
    t.forEach((row) => { assert.ok(row.group); assert.ok(row.words.length); });
  });

  it('คำที่เครื่อง**ไม่ได้**บล็อก ต้องไม่ถูกเราดักเอง (ปืน/มีด/ยาเสพติด ผ่านที่เครื่องจริง)', () => {
    // เครื่องปล่อยผ่านคำเหล่านี้ (ทดสอบแล้ว) — เราจึงต้องไม่บล็อกเกินหน้าที่
    // แต่ต้องมี "คำเตือน" แทน เพราะผลลัพธ์เชื่อไม่ได้
    for (const w of ['คนถือปืน', 'คนถือมีด']) {
      const r = P.prepare(w);
      assert.equal(r.blocked.length, 0, `${w} ไม่ควรถูกดักเป็นคำต้องห้าม`);
      assert.ok(r.warnings.some((x) => x.id === 'tinyobject'), `${w} ต้องมีคำเตือน`);
    }
  });
});

describe('คำเตือน — รูปคำถามที่เครื่องตอบไม่ได้', () => {
  const cases = [
    ['รถชนมอเตอร์ไซค์',        'relation'],
    ['ซ้อนสาม',               'count'],
    ['มอเตอร์ไซค์ขึ้นทางเท้า', 'spatial'],
    // แยกออกจาก tinyobject 2026-08-14 — เจ้าของเปิดภาพผลจริงแล้วเห็นบุหรี่ชัด 3/4 ใบ
    // ⇒ เครื่องทำได้จริง ไม่ใช่กลุ่มเดียวกับปืนที่ได้ 97 โดยไม่มีปืนสักใบ
    // ยังเตือนอยู่ แต่เป็นคนละความหมาย: "ได้จริงแต่ไม่ครบ" ไม่ใช่ "ตอบไม่ได้"
    ['คนสูบบุหรี่',            'smoking'],
    ['ก้มผูกเชือกรองเท้า',      'finegrained'],
    ['เสื้อโลโก้ liverpool',   'brand'],
  ];
  for (const [text, id] of cases) {
    it(`"${text}" → เตือน ${id}`, () => {
      const w = P.findUnsupported(text);
      assert.ok(w.some((x) => x.id === id), `ไม่เตือน ${id}: ${JSON.stringify(w.map((x) => x.id))}`);
    });
  }

  it('คำเตือนทุกข้อมีหลักฐานจากการทดสอบจริงติดมาด้วย', () => {
    // กันไม่ให้ใครเพิ่มคำเตือนแบบเดา — ทุกข้อต้องอ้างผลที่วัดแล้วได้
    P.UNSUPPORTED.forEach((u) => {
      assert.ok(u.proof && u.proof.length > 20, `${u.id} ไม่มีหลักฐานประกอบ`);
      assert.ok(u.why && u.why.length > 10, `${u.id} ไม่มีเหตุผล`);
    });
  });

  it('คำค้นที่ใช้ได้จริงต้องไม่มีคำเตือนมาก่อกวน', () => {
    for (const t of ['รถขายไอศกรีม', 'คนขี่มอเตอร์ไซค์ไม่สวมหมวก', 'รถเข็นขายของ', 'คนใส่เป้']) {
      assert.deepEqual(P.findUnsupported(t), [], `"${t}" ไม่ควรมีคำเตือน`);
    }
  });

  it('จับมือ/กอด ต้อง**ไม่**เตือน — เจ้าของพิสูจน์แล้วว่าเครื่องหาได้จริง', () => {
    // เดิมเตือนว่าตอบไม่ได้ ซึ่งผิด · ครอปกินบริบทรอบตัว คนที่ติดกันจึงอยู่ในครอปเดียว
    for (const t of ['ผู้ชายเดินจับมือผู้หญิง', 'คนกอดกัน', 'ผู้หญิงอุ้มเด็ก']) {
      assert.deepEqual(P.findUnsupported(t), [], `"${t}" หาได้จริง ไม่ควรเตือน`);
    }
  });

  it('ของที่อยู่ห่างกันคนละมุมภาพ ยังต้องเตือนอยู่', () => {
    assert.ok(P.findUnsupported('อุบัติเหตุรถชนมอเตอร์ไซค์').some((x) => x.id === 'relation'));
  });
});

describe('prepare — สัญญาที่ route กับหน้าจอใช้ร่วมกัน', () => {
  it('ผ่านฉลุย', () => {
    const r = P.prepare('ผู้ชายใส่เสื้อแดงขี่มอเตอร์ไซค์');
    assert.equal(r.ok, true);
    assert.match(r.english, /motorcycle|red/);
    assert.deepEqual(r.blocked, []);
  });

  it('แปลไม่ออก → ok=false reason=unknown (คนละเหตุกับ blocked)', () => {
    const r = P.prepare('ฟหกดเ');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown');
  });

  it('มีคำเตือนแต่ยังค้นได้ — เตือนไม่ใช่บล็อก', () => {
    const r = P.prepare('คนถือปืน');
    assert.equal(r.ok, true, 'ต้องยังค้นได้ ผู้ใช้อาจอยากลองเอง');
    assert.ok(r.warnings.length > 0);
    assert.ok(r.english);
  });
});

describe('จับคำเวลาจากข้อความ — ทำให้นับได้จริง ไม่ใช่แค่กรองสวย', () => {
  it('เมื่อวานตอนบ่าย → ย้อน 1 วัน ช่วงบ่าย', () => {
    const t = P.parseTime('คนขี่มอเตอร์ไซค์ไม่สวมหมวก เมื่อวานตอนบ่าย');
    assert.equal(t.days, 1);
    assert.equal(t.band, 'afternoon');
    assert.match(t.label, /เมื่อวาน/);
  });

  it('"เมื่อคืน" พา days มาด้วยในตัว (คืนที่ผ่านมา ไม่ใช่คืนนี้ที่ยังไม่ถึง)', () => {
    const t = P.parseTime('รถเข็นขายของ เมื่อคืน');
    assert.equal(t.band, 'night');
    assert.equal(t.days, 1);
  });

  it('คำเฉพาะชนะคำกว้าง — "ดึก" ต้องไม่กลายเป็น "กลางคืน"', () => {
    assert.equal(P.parseTime('คนเดิน ดึก').band, 'latenight');
  });

  it('ไม่มีคำเวลา → คืน null ทั้งคู่ (ผู้เรียกใช้ค่าจากฟอร์มแทน)', () => {
    const t = P.parseTime('รถขายไอศกรีม');
    assert.equal(t.band, null); assert.equal(t.days, null); assert.equal(t.label, null);
  });

  it('bandHours: ทั้งวันคืน null (ไม่ต้องซอย) · กลางคืนข้ามเที่ยงคืน', () => {
    assert.equal(P.bandHours('all'), null);
    const n = P.bandHours('night');
    assert.ok(n.to <= n.from, 'กลางคืนต้องข้ามเที่ยงคืน');
    assert.equal(P.bandHours('day').from, 6);
  });

  it('prepare พา time ติดมาด้วยเสมอ', () => {
    assert.equal(P.prepare('คนเดิน ช่วงเช้า').time.band, 'morning');
    assert.equal(P.prepare('พระ ตอนเช้า').time.band, 'morning', 'ถูกบล็อกก็ยังต้องรู้เวลา');
  });
});

describe('เวลาแบบที่คนไทยพูด', () => {
  const cases = [
    ['6โมงเช้า', 6 * 60],       ['หกโมงเช้า', 6 * 60],
    ['6โมงครึ่ง', 6 * 60 + 30], ['3โมงเช้า', 9 * 60],
    ['ทุ่ม', 19 * 60],          ['ทุ่มครึ่ง', 19 * 60 + 30],
    ['ทุ่ม45', 19 * 60 + 45],   ['สองทุ่ม', 20 * 60],
    ['ห้าทุ่ม', 23 * 60],       ['บ่ายโมง', 13 * 60],
    ['บ่ายสามโมง', 15 * 60],    ['5โมงเย็น', 17 * 60],
    ['ตีสี่', 4 * 60],          ['เที่ยง', 12 * 60],
    ['เที่ยงคืน', 0],           ['สิบเอ็ดโมง', 11 * 60],
    ['14:00', 14 * 60],         ['14.30', 14 * 60 + 30],
  ];
  for (const [txt, min] of cases) {
    it(`"${txt}" → ${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
      () => assert.equal(P.parseClock(txt), min));
  }

  it('"3โมงเช้า" = 09:00 ไม่ใช่ 03:00 — เลข 1-5 ใช้ระบบเก่า, 6-11 ใช้เลขนาฬิกา', () => {
    assert.equal(P.parseClock('3โมงเช้า'), 9 * 60);
    assert.equal(P.parseClock('9โมงเช้า'), 9 * 60);
    assert.equal(P.parseClock('ตีสาม'), 3 * 60, 'ตีสาม ต่างหากที่แปลว่า 03:00');
  });

  it('อ่านไม่ออกคืน null ไม่ใช่เดามั่ว', () => {
    assert.equal(P.parseClock('อะไรสักอย่าง'), null);
    assert.equal(P.parseClock('99:99'), null);
  });
});

describe('ช่วงเวลาที่ระบุเอง', () => {
  it('"ตั้งแต่ 6โมงเช้า ถึง สองทุ่ม"', () => {
    const r = P.parseTimeRange('ตั้งแต่ 6โมงเช้า ถึง สองทุ่ม');
    assert.equal(r.fromMin, 6 * 60);
    assert.equal(r.toMin, 20 * 60);
    assert.equal(r.label, '06:00–20:00');
  });

  it('"14:00-16:00"', () => {
    const r = P.parseTimeRange('14:00-16:00');
    assert.equal(r.fromMin, 14 * 60); assert.equal(r.toMin, 16 * 60);
  });

  it('บอกเวลาเดียว → ถือเป็นช่วง 1 ชั่วโมงนับจากเวลานั้น', () => {
    const r = P.parseTimeRange('ทุ่มครึ่ง');
    assert.equal(r.fromMin, 19 * 60 + 30);
    assert.equal(r.toMin, 20 * 60 + 30);
  });

  it('ช่วงที่พิมพ์มีสิทธิ์เหนือคำกว้าง ๆ อย่าง "กลางวัน"', () => {
    const t = P.parseTime('คนเดิน กลางวัน 14:00 ถึง 16:00');
    assert.ok(t.range, 'ต้องได้ range');
    assert.equal(t.range.fromMin, 14 * 60);
    assert.match(t.label, /14:00–16:00/);
  });

  it('ไม่มีคำเวลาเลย → range เป็น null', () => {
    assert.equal(P.parseTime('รถขายไอศกรีม').range, null);
  });
});

describe('ช่วงเวลาที่เจ้าของกำหนดเอง (2026-08-12)', () => {
  const cases = [
    ['เช้ามืด', 'dawn', 4, 6],
    ['ก่อนเที่ยง', 'beforenoon', 10, 12],
    ['หลังเที่ยง', 'afternoon1', 12, 13],
    ['ตอนเย็น', 'evening', 16, 18],
    ['บ่ายแก่ๆ', 'lateaftn', 14, 15],
  ];
  for (const [w, band, from, to] of cases) {
    it(`"${w}" → ${from}:00–${to}:00`, () => {
      const t = P.parseTime('คนเดิน ' + w);
      assert.equal(t.band, band);
      const h = P.bandHours(band);
      assert.equal(h.from, from); assert.equal(h.to, to);
    });
  }

  it('คำเจาะจงต้องชนะคำกว้าง — เช้ามืด ไม่ใช่ เช้า · บ่ายแก่ๆ ไม่ใช่ บ่าย', () => {
    assert.equal(P.parseTime('คนเดิน เช้ามืด').band, 'dawn');
    assert.equal(P.parseTime('คนเดิน ตอนเช้า').band, 'morning');
    assert.equal(P.parseTime('คนเดิน บ่ายแก่ๆ').band, 'lateaftn');
    assert.equal(P.parseTime('คนเดิน ตอนบ่าย').band, 'afternoon');
    assert.equal(P.parseTime('คนเดิน ก่อนเที่ยง').band, 'beforenoon');
    assert.equal(P.parseTime('คนเดิน หลังเที่ยง').band, 'afternoon1');
  });
});

describe('วันที่เจาะจง', () => {
  const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);   // 12 ส.ค. 2026 เที่ยง UTC
  const cases = [
    ['วันที่ 10 สิงหา', 2026, 8, 10],
    ['10 ส.ค.',         2026, 8, 10],
    ['10/8',            2026, 8, 10],
    ['10/8/2569',       2026, 8, 10],   // พ.ศ. → ค.ศ.
    ['2026-08-10',      2026, 8, 10],
    ['วันที่ 3 ก.ค. 69', 2026, 7, 3],
  ];
  for (const [txt, y, m, d] of cases) {
    it(`"${txt}" → ${d}/${m}/${y}`, () => {
      const r = P.parseDate(txt, NOW);
      assert.deepEqual([r.y, r.m, r.d], [y, m, d]);
    });
  }

  it('ปี พ.ศ. แปลงเป็น ค.ศ. — ไม่งั้นได้ปี 2569 ซึ่งเกินช่วงที่เครื่องรับ', () => {
    assert.equal(P.parseDate('1/1/2569', NOW).y, 2026);
    assert.equal(P.parseDate('1/1/2026', NOW).y, 2026);
  });

  it('วันที่ที่ยังไม่มาถึงในปีนี้ = หมายถึงปีที่แล้ว (ค้นวิดีโอย่อมพูดถึงอดีต)', () => {
    assert.equal(P.parseDate('วันที่ 25 ธันวา', NOW).y, 2025);
  });

  it('วันที่ใช้ร่วมกับช่วงเวลาได้', () => {
    const t = P.parseTime('คนเดิน วันที่ 10 สิงหา ตอนบ่าย');
    assert.equal(t.date.d, 10); assert.equal(t.date.m, 8);
    assert.equal(t.band, 'afternoon');
    assert.match(t.label, /10\/08/);
  });

  it('"14:00-16:00" ต้องไม่ถูกอ่านเป็นวันที่', () => {
    const t = P.parseTime('คนเดิน 14:00-16:00');
    assert.equal(t.date, null);
    assert.equal(t.range.fromMin, 14 * 60);
  });

  it('วันที่มั่ว → null ไม่ใช่เดา', () => {
    assert.equal(P.parseDate('99/99', NOW), null);
    assert.equal(P.parseDate('ไม่มีวันที่', NOW), null);
  });
});

describe('เมื่อวาน / เมื่อวานซืน — "วันไหน" ไม่ใช่ "ย้อนกี่วัน"', () => {
  it('แยกกันได้ถูกด้วย dayOffset', () => {
    assert.equal(P.parseTime('คนเดิน วันนี้').dayOffset, 0);
    assert.equal(P.parseTime('คนเดิน เมื่อวาน').dayOffset, 1);
    assert.equal(P.parseTime('คนเดิน เมื่อวานซืน').dayOffset, 2);
  });

  it('เจาะจงวันไหน = ค้นวันเดียว (days = 1) ไม่ใช่ย้อนหลายวัน', () => {
    // บั๊กจริง 2026-08-12: "เมื่อวานซืน" เคยได้หน้าต่างของ "วันนี้"
    // เพราะเอา days=2 ไปวนสร้างหน้าต่าง i=0..1 แทนที่จะเลื่อนไป 2 วัน
    assert.equal(P.parseTime('คนเดิน เมื่อวานซืน').days, 1);
  });

  it('"ย้อน 3 วัน" ยังเป็นช่วง ไม่ใช่วันเดียว', () => {
    const t = P.parseTime('คนเดิน ย้อน 3 วัน');
    assert.equal(t.dayOffset, null);
    assert.equal(t.days, 3);
  });

  it('"ก่อนเที่ยง" ต้องได้ 10–12 ไม่ใช่ 12–13 (คำว่า "เที่ยง" ข้างในหลอกตัวอ่านเวลา)', () => {
    const t = P.parseTime('คนเดิน ก่อนเที่ยง');
    assert.equal(t.range, null, 'ต้องไม่ถูกอ่านเป็นช่วงเวลาจุดเดียว');
    assert.equal(t.band, 'beforenoon');
    assert.deepEqual([P.bandHours('beforenoon').from, P.bandHours('beforenoon').to], [10, 12]);
  });
});

describe('เส้นแบ่ง "ชื่อช่วง" กับ "เวลาจุดเดียว"', () => {
  // เจ้าของจับได้จากภาพผลลัพธ์ 2026-08-12: พิมพ์ "เมื่อวานตอนบ่ายโมง" แล้วได้ผลตอน 17:xx
  // เพราะ "บ่ายโมง" ถูกกลืนเป็นช่วงบ่ายทั้งยวง 12:00–18:00
  it('"บ่ายโมง" = 13:00 ไม่ใช่ช่วงบ่ายทั้งยวง', () => {
    const t = P.parseTime('รถ taxi บ่ายโมง');
    assert.ok(t.range, 'ต้องเป็นเวลาจุด ไม่ใช่ชื่อช่วง');
    assert.equal(t.range.fromMin, 13 * 60);
  });

  it('"เมื่อวานตอนบ่ายโมง" = เมื่อวาน 13:00', () => {
    const t = P.parseTime('รถ taxi เมื่อวานตอนบ่ายโมง');
    assert.equal(t.dayOffset, 1);
    assert.equal(t.range.fromMin, 13 * 60);
  });

  it('"ตอนบ่าย" (ไม่มีตัวบอกเวลา) ยังเป็นช่วงกว้างเหมือนเดิม', () => {
    const t = P.parseTime('รถ taxi ตอนบ่าย');
    assert.equal(t.range, null);
    assert.equal(t.band, 'afternoon');
  });

  it('ชื่อช่วงที่ไม่มีตัวบอกเวลา ต้องไม่ถูกอ่านเป็นเวลาจุด', () => {
    for (const [w, band] of [['ก่อนเที่ยง', 'beforenoon'], ['หลังเที่ยง', 'afternoon1'],
                             ['เช้ามืด', 'dawn'], ['บ่ายแก่ๆ', 'lateaftn'], ['ตอนเย็น', 'evening']]) {
      const t = P.parseTime('รถ taxi ' + w);
      assert.equal(t.range, null, `${w} ไม่ควรเป็นเวลาจุด`);
      assert.equal(t.band, band, w);
    }
  });

  it('มีตัวบอกเวลา (โมง/ทุ่ม/ตี/ตัวเลข) → เวลาจุดชนะเสมอ', () => {
    for (const [w, hh] of [['บ่ายสามโมง', 15], ['5โมงเย็น', 17], ['ทุ่มครึ่ง', 19],
                           ['ตีสี่', 4], ['14:00', 14]]) {
      const t = P.parseTime('รถ taxi ' + w);
      assert.ok(t.range, `${w} ต้องเป็นเวลาจุด`);
      assert.equal(Math.floor(t.range.fromMin / 60), hh, w);
    }
  });
});

describe('คำที่แปลไม่ออก และคู่คน — จากเคสที่เจ้าของเจอเอง 2026-08-12', () => {
  it('"ผู้ชายเดินจับมือผู้หญิง" ต้องไม่หายเหลือแค่ "a man walking"', () => {
    const en = P.toEnglish('ผู้ชายเดินจับมือผู้หญิง');
    assert.match(en, /a man with a woman/, 'ประธานที่สองต้องไม่หาย');
    assert.match(en, /holding hands/, 'คำว่าจับมือต้องไม่หาย');
  });

  it('ไม่ผลิตวลีซ้ำซ้อน', () => {
    assert.equal(P.toEnglish('ผู้หญิงอุ้มเด็ก'), 'a woman carrying a child');
    assert.doesNotMatch(P.toEnglish('สองคนเดินด้วยกัน'), /walking walking/);
  });

  it('สีเกาะเสื้อผ้าชิ้นที่อยู่ก่อนคำสี (ไทยวางคำขยายไว้หลัง)', () => {
    assert.match(P.toEnglish('ผู้ชายเสื้อยืดขาวกางเกงยีนส์'), /a white shirt/);
    assert.match(P.toEnglish('คนใส่กางเกงขาสั้นสีดำ'), /black trousers/);
  });

  it('ไม่มีคำเสื้อผ้ามาก่อนสี → ห้ามแต่งเป็นเสื้อให้เอง', () => {
    // "คนถือร่มสีแดง" เคยได้ "wearing a red shirt" ซึ่งผิดและทำให้ผลค้นเพี้ยนทั้งชุด
    const en = P.toEnglish('คนถือร่มสีแดง');
    assert.doesNotMatch(en, /red shirt/);
    assert.match(en, /umbrella/);
  });

  it('คำที่ระบบไม่รู้จักต้องถูกรายงาน ไม่ใช่หายเงียบ', () => {
    const r = P.prepare('คนใส่เสื้อลายมังกรถือกระบอง');
    assert.ok(r.unknown.length > 0, 'ต้องบอกว่ามีคำที่แปลไม่ออก');
  });

  it('คำที่รู้จักครบต้องไม่ถูกรายงานว่าไม่รู้จัก', () => {
    for (const t of ['รถขายไอศกรีม', 'ผู้ชายใส่เสื้อสีแดง', 'คนขี่มอเตอร์ไซค์ไม่สวมหมวก']) {
      assert.deepEqual(P.prepare(t).unknown, [], `"${t}" ไม่ควรมีคำที่ไม่รู้จัก`);
    }
  });

  it('ตัวเลขบนเสื้อ → เตือนว่าอ่านไม่ได้ (ยืนยันแล้วจากเคส Liverpool)', () => {
    assert.ok(P.prepare('ผู้ชายใส่เสื้อบอล มีตัวเลข 13 บนเสื้อ')
      .warnings.some((w) => w.id === 'brand'));
  });
});

// ── ชั้นที่ 3 · ด่าน "เครื่องทำไม่ได้" ต้องตรวจฝั่งอังกฤษด้วย ─────────────────
//
// AcuSeek เป็นระบบ embedding — ไม่มีคำว่า "ไม่รู้" ถามอะไรก็คืนเพื่อนบ้านที่ใกล้สุด
// พร้อมคะแนนสวยเสมอ · ด่านนี้เป็นสิ่งเดียวที่กันผู้ใช้จากการเชื่อผลที่ผิด
// ตราบใดที่ regex เป็นไทยล้วน วลีอังกฤษที่มาจากทางอื่น (ช่องพิมพ์อังกฤษวันนี้ /
// ตัวแปลภาษาในอนาคต) จะเดินผ่านไปเงียบ ๆ
describe('acuseekPhrase — ด่านเครื่องทำไม่ได้ ฝั่งอังกฤษ', () => {
  const EN_CASES = [
    ['a person smoking a cigarette',          'smoking'],
    ['a man holding a gun',                   'tinyobject'],
    ['a woman eating noodles',                'finegrained'],
    ['two people riding a motorcycle',        'count'],
    ['a motorcycle on the sidewalk',          'spatial'],
    ['a car collision with a motorcycle',     'relation'],
    ['a man wearing a jersey with number 13', 'brand'],
  ];
  for (const [en, id] of EN_CASES) {
    it(`ดักได้: "${en}" → ${id}`, () => {
      assert.ok(P.findUnsupported('', en).some((w) => w.id === id),
        `วลีอังกฤษนี้ต้องถูกเตือนว่าเครื่องตอบไม่ได้ (${id})`);
    });
  }

  // 🔴 เทสต์ที่สำคัญที่สุดในชุดนี้: ด่านใหม่ต้องไม่ดักของที่ตารางผลิตออกมาเอง
  // ถ้าดักผิด ผู้ใช้จะเห็นคำเตือนกับคำค้นที่ใช้งานได้จริง แล้วจะเลิกเชื่อคำเตือนทั้งหมด
  // ซึ่งอันตรายกว่าไม่มีคำเตือนเลย
  it('ต้องไม่ดักคำค้นที่เครื่องทำได้จริง (กัน false positive ทั้งชุด)', () => {
    const OK = [
      'ผู้ชายใส่เสื้อสีแดง', 'ผู้หญิงใส่เสื้อสีดำกางเกงยีนส์', 'คนใส่แว่นตา',
      'คนสะพายเป้', 'คนขี่มอเตอร์ไซค์ไม่สวมหมวก', 'รถกระบะสีขาว',
      'รถขายไอศกรีม', 'คนใส่หมวก', 'ผู้หญิงถือร่ม', 'คนใส่ชุดนักเรียน',
      'แท็กซี่', 'คนเดิน', 'เด็กใส่เสื้อสีฟ้า', 'คนใส่เสื้อกันฝน',
    ];
    for (const th of OK) {
      const r = P.prepare(th);
      if (!r.ok) continue;                       // แปลไม่ออกเป็นคนละเรื่อง
      assert.deepEqual(r.warnings, [],
        `"${th}" → "${r.english}" ไม่ควรถูกเตือน แต่โดน: ${JSON.stringify(r.warnings.map((w) => w.id))}`);
    }
  });

  it('prepare ตรวจวลีอังกฤษที่แปลออกมาแล้ว ไม่ใช่แค่ข้อความไทย', () => {
    // ไทยว่า "สูบ" ตรง regex ไทยอยู่แล้ว — เคสนี้ยืนยันว่า warnings ไม่ซ้ำกัน
    // เมื่อทั้งสองฝั่งจับ id เดียวกันได้
    const r = P.prepare('คนสูบบุหรี่');
    const ids = r.warnings.map((w) => w.id);
    assert.deepEqual(ids, [...new Set(ids)], 'id ต้องไม่ซ้ำเมื่อจับได้ทั้งสองฝั่ง');
  });

  it('findUnsupported ยังเรียกด้วยอาร์กิวเมนต์เดียวได้เหมือนเดิม', () => {
    assert.ok(P.findUnsupported('คนถือปืน').some((w) => w.id === 'tinyobject'));
    assert.deepEqual(P.findUnsupported('ผู้ชายใส่เสื้อสีแดง'), []);
  });
});

// ── คำที่เพิ่มหลังเปิดภาพยืนยันแล้ว 2026-08-14 ────────────────────────────
describe('acuseekPhrase — ชุดคลุมยาวมุสลิม และหมวกโม่ง', () => {
  it('บุรก้า / นิกอบ / ชุดคลุมยาว → วลีเดียวกัน เพราะเครื่องแยกไม่ออกจริง', () => {
    for (const t of ['คนใส่บุรก้า', 'คนใส่บุรกา', 'ผู้หญิงใส่นิกอบ', 'คนใส่ชุดคลุมยาว']) {
      const r = P.prepare(t);
      assert.ok(r.ok && /wearing a burqa/.test(r.english), `${t} → ${r.english}`);
      assert.deepEqual(r.warnings, [], 'ยืนยันด้วยภาพแล้ว 4/4 ไม่ต้องเตือน');
      assert.deepEqual(r.unknown, [], 'ต้องไม่รายงานว่าไม่รู้จัก');
    }
  });

  it('ไม่ชนกับคำต้องห้าม "มุสลิม" — บรรยายเสื้อผ้าคนละเรื่องกับบรรยายตัวบุคคล', () => {
    assert.strictEqual(P.prepare('คนใส่บุรก้า').ok, true);
    assert.strictEqual(P.prepare('ผู้หญิงมุสลิม').ok, false, 'คำว่ามุสลิมยังต้องถูกบล็อกเหมือนเดิม');
  });

  it('หมวกโม่ง → แปลตรงคำ แต่ต้องขึ้นคำเตือนว่าหาไม่ได้ (ทดสอบแล้ว 0/4)', () => {
    const r = P.prepare('ชายใส่หมวกโม่ง');
    assert.ok(/balaclava/.test(r.english), 'ต้องแปลตรงคำที่ถาม ไม่ใช่กลายเป็น hat เงียบ ๆ');
    assert.ok(r.warnings.some((w) => w.id === 'facecover'));
    assert.ok(P.findUnsupported('', 'a man wearing a ski mask').some((w) => w.id === 'facecover'),
      'ฝั่งอังกฤษต้องดักด้วย');
  });

  it('หมวกกันน็อค สะกดด้วย ค ต้องได้ helmet ไม่ใช่ hat (บั๊กเดิม)', () => {
    for (const t of ['คนใส่หมวกกันน็อค', 'คนใส่หมวกกันน็อก']) {
      const r = P.prepare(t);
      assert.ok(/wearing a helmet/.test(r.english), `${t} → ${r.english}`);
      assert.deepEqual(r.unknown, [], 'ไม่ควรรายงาน "กันน็อค" ว่าเป็นคำที่ไม่รู้จัก');
    }
    assert.ok(/without a helmet/.test(P.prepare('คนขี่มอเตอร์ไซค์ไม่สวมหมวก').english));
    assert.ok(/wearing a hat/.test(P.prepare('คนใส่หมวก').english), 'หมวกเปล่า ๆ ยังเป็น hat');
  });
});

// ── "เป็นกลุ่ม / หลายคน" 2026-08-14 ────────────────────────────────────
// คำเตือนกลุ่มนี้ต้องพูดสองอย่าง ไม่ใช่ห้ามทั้งดุ้น: นับจำนวนไม่ได้ (three people
// ได้คนเดียว 0/4) แต่หา "ที่ที่มีคนเยอะ" ได้บ้าง (crowd มีคน 2-3 คนติดครอปจริง)
describe('acuseekPhrase — เป็นกลุ่ม / หลายคน', () => {
  it('คำที่แปลว่า "อยู่รวมกันหลายคน" ต้องขึ้นคำเตือน count', () => {
    for (const t of ['คนยืนกันเป็นกลุ่ม', 'คนมุงกัน', 'คนหลายคน', 'คนสามคน', 'คนจับกลุ่ม']) {
      assert.ok(P.prepare(t).warnings.some((w) => w.id === 'count'), `"${t}" ไม่ขึ้นคำเตือน`);
    }
  });

  it('ฝั่งอังกฤษดักได้ทั้ง "N people" และ "a group/crowd of people"', () => {
    for (const e of ['three people walking together', 'a group of people standing', 'a crowd of people']) {
      assert.ok(P.findUnsupported('', e).some((w) => w.id === 'count'), `"${e}" ไม่ถูกดัก`);
    }
  });

  it('คำเตือนต้องบอกทั้งข้อจำกัดและสิ่งที่พอทำได้ ไม่ใช่ห้ามอย่างเดียว', () => {
    const w = P.prepare('คนยืนกันเป็นกลุ่ม').warnings.find((x) => x.id === 'count');
    assert.match(w.why, /นับจำนวนไม่ได้/);
    assert.match(w.why, /พอได้ผล|คนเยอะ/, 'ต้องบอกด้วยว่าอะไรพอทำได้ ไม่งั้นผู้ใช้เลิกใช้ทั้งที่ใช้ได้บางส่วน');
  });

  it('หมวกโม่ง + เป็นกลุ่ม → ขึ้นทั้งสองคำเตือน ไม่กลืนกัน', () => {
    const ids = P.prepare('ชายใส่หมวกโม่งอยู่กันเป็นกลุ่ม').warnings.map((w) => w.id);
    assert.ok(ids.includes('facecover') && ids.includes('count'), JSON.stringify(ids));
  });

  it('คำค้นปกติต้องไม่โดนกฎนี้ลูกหลง', () => {
    for (const t of ['ผู้ชายใส่เสื้อสีแดง', 'คนใส่แว่นตา', 'รถกระบะสีขาว', 'คนสะพายเป้',
                     'คนใส่บุรก้า', 'คนขี่มอเตอร์ไซค์ไม่สวมหมวก', 'ผู้หญิงถือร่ม']) {
      const r = P.prepare(t);
      if (r.ok) assert.deepEqual(r.warnings, [], `"${t}" → ${r.english}`);
    }
  });
});
