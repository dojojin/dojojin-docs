// ============================================================
// Vigil Platform — Tests: บอทถามกลับเมื่อข้อมูลไม่ครบ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เจ้าของสั่ง 2026-09-08: ถ้าไม่ระบุไซต์ บอทต้องถามเอง แล้วผู้ใช้ตอบ "ภูเก็ต" ต่อได้
// เจอตอนทดสอบจริง: ชื่อไซต์ใน DB เป็นอังกฤษ (Phuket) คนตอบไทย ("ภูเก็ต") แล้วจับไม่ได้
// → migration 203 เพิ่ม sites.name_th · เทสต์ชุดนี้ตรึงว่าตอบได้ทั้งไทย อังกฤษ และเลข
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchSite, siteLabel } = require('../src/helpers/lineCommandSites');
const { readAnswer, askText } = require('../src/helpers/lineCommandRun');

const SITES = [
  { code: 'hkt', name: 'Phuket', name_th: 'ภูเก็ต' },
  { code: 'hdy', name: 'HatYai', name_th: 'หาดใหญ่' },
  { code: 'vss', name: 'VSS', name_th: null },
];
const NOW = new Date('2026-09-08T08:20:33Z');   // 15:20 เวลาไทย

describe('จับชื่อไซต์จากคำตอบ', () => {
  it('ชื่อไทย ชื่ออังกฤษ และรหัส ใช้ได้หมด', () => {
    assert.equal(matchSite('ภูเก็ต', SITES).code, 'hkt');
    assert.equal(matchSite('Phuket', SITES).code, 'hkt');
    assert.equal(matchSite('hkt', SITES).code, 'hkt');
    assert.equal(matchSite('หาดใหญ่', SITES).code, 'hdy');
  });

  it('ไซต์ที่ไม่มีชื่อไทยยังตอบด้วยชื่อเดิมได้', () => {
    assert.equal(matchSite('vss', SITES).code, 'vss');
    assert.equal(siteLabel(SITES[2]), 'VSS');
  });

  it('ชื่อไทยมาก่อนเสมอเมื่อมีให้เลือก — คนตอบบอทเป็นภาษาไทย', () => {
    assert.equal(siteLabel(SITES[0]), 'ภูเก็ต');
  });

  it('ตอบเป็นประโยคก็ยังจับได้', () => {
    assert.equal(matchSite('เอาของภูเก็ตครับ', SITES).code, 'hkt');
  });

  it('ไม่ตรงอะไรเลยคืน null ไม่ใช่เดาเอาตัวแรก', () => {
    assert.equal(matchSite('เชียงใหม่', SITES), null);
    assert.equal(matchSite('', SITES), null);
  });
});

describe('อ่านคำตอบของคำถามที่ค้างอยู่', () => {
  const askSite = { need: 'site', options: SITES.map((s) => ({ label: siteLabel(s), value: s.code, name: s.name, name_th: s.name_th })) };

  it('ตอบเป็นเลขตามลำดับตัวเลือก', () => {
    assert.equal(readAnswer('1', askSite, NOW), 'hkt');
    assert.equal(readAnswer('2', askSite, NOW), 'hdy');
  });

  it('เลขที่เกินรายการไม่ถูกตีความเป็นคำตอบ', () => {
    assert.equal(readAnswer('9', askSite, NOW), null);
  });

  it('ตอบเป็นชื่อไทย', () => {
    assert.equal(readAnswer('ภูเก็ต', askSite, NOW), 'hkt');
  });

  it('ตอบเรื่องอื่น = ไม่ใช่คำตอบ (ตัวรันจะทิ้งคำถามค้างแล้วเริ่มใหม่)', () => {
    assert.equal(readAnswer('เดี๋ยวคุยกันพรุ่งนี้นะครับ', askSite, NOW), null);
  });

  it('คำถามเรื่องช่วงเวลา ตอบเป็นเลขต้องได้ก้อนช่วงเวลาจริง ไม่ใช่ข้อความ', () => {
    const askPeriod = { need: 'period', options: [
      { label: 'ชั่วโมงที่แล้ว', value: 'ชั่วโมงที่แล้ว' }, { label: 'วันนี้', value: 'วันนี้' }] };
    const a = readAnswer('1', askPeriod, NOW);
    assert.equal(typeof a, 'object');
    assert.equal(a.label, '8 ก.ย. 14:00-14:59');
    const b = readAnswer('เมื่อวาน', askPeriod, NOW);   // พิมพ์เองก็ได้ ไม่ต้องเลือกจากรายการ
    assert.equal(b.kind, 'yesterday');
  });
});

describe('ข้อความที่บอทถามกลับ', () => {
  it('ขึ้นหัวข้อแล้วไล่ตัวเลือกเป็นเลข', () => {
    const t = askText('site', [{ label: 'ภูเก็ต' }, { label: 'หาดใหญ่' }]);
    assert.equal(t, 'ไซต์ไหน\n1. ภูเก็ต\n2. หาดใหญ่');
  });

  it('ไม่มี emoji ตามที่เจ้าของสั่ง', () => {
    const t = askText('period', [{ label: 'วันนี้' }]);
    assert.equal(/\p{Extended_Pictographic}/u.test(t), false);
  });
});

// เจ้าของถาม 2026-09-08: "ขอยอดผู้ไม่สวมหมวกนิรภัย ภูเก็ต เฉพาะกล้อง หน้าโรงเรียนนาบอน (C20)"
// ก่อนหน้านี้ชื่อกล้องถูกมองข้ามทั้งดุ้น แล้วบอทตอบยอดทั้งไซต์ 86 กล้องกลับไป
describe('เจาะจงกล้องจากประโยค', () => {
  const { matchCamera } = require('../src/helpers/lineCommandSites');
  // ชื่อจริงจากฐานข้อมูล — C19 กับ C20 ใช้ชื่อฐานเดียวกัน ต่างแค่เลขในวงเล็บ
  const CAMS = [
    { id: 'C20-CHL-SB-05', name: 'หน้าโรงเรียนนาบอน (C20)' },
    { id: 'C19-CHL-SB-05', name: 'หน้าโรงเรียนนาบอน (C19)' },
    { id: 'C4-CHL-SB-01', name: 'ขาออกตำบลฉลอง (C4)' },
  ];

  it('ชื่อเต็มพร้อมวงเล็บ ชี้ตัวเดียวได้', () => {
    const r = matchCamera('ขอยอดผู้ไม่สวมหมวกนิรภัย ภูเก็ต เฉพาะกล้อง หน้าโรงเรียนนาบอน (C20)', CAMS);
    assert.equal(r.exact.id, 'C20-CHL-SB-05');
  });

  it('รหัสในวงเล็บอย่างเดียวก็พอ', () => {
    assert.equal(matchCamera('ยอดไม่สวมหมวก กล้อง C20', CAMS).exact.id, 'C20-CHL-SB-05');
  });

  it('camera_id ที่ก๊อปจากหน้าเว็บก็ได้', () => {
    assert.equal(matchCamera('ยอดไม่สวมหมวก C19-CHL-SB-05', CAMS).exact.id, 'C19-CHL-SB-05');
  });

  it('ชื่อฐานที่ตรงหลายตัว = กำกวม ต้องถามกลับ ไม่ใช่หยิบตัวแรก', () => {
    const r = matchCamera('ยอดไม่สวมหมวก หน้าโรงเรียนนาบอน', CAMS);
    assert.equal(r.exact, undefined);
    assert.equal(r.many.length, 2);
  });

  it('ประโยคที่ไม่ได้พูดถึงกล้องเลย ต้องไม่จับมั่ว', () => {
    assert.equal(matchCamera('ยอดไม่สวมหมวกวันนี้', CAMS), null);
    assert.equal(matchCamera('', CAMS), null);
  });

  it('ตัวอักษรสั้น ๆ ในประโยคต้องไม่ไปตรงกับรหัสกล้อง', () => {
    // "c2" ไม่ควรตรงกับ (C20) — เงื่อนไขขอบเขตคำกันไว้
    assert.equal(matchCamera('ยอดไม่สวมหมวก c2', CAMS), null);
  });
});

describe('ชื่อไซต์ภาษาไทยในประโยคแรก', () => {
  const { matchCommand } = require('../src/helpers/lineCommandMatch');
  const SITES = [{ code: 'hkt', name: 'Phuket', name_th: 'ภูเก็ต' },
                 { code: 'hdy', name: 'HatYai', name_th: 'หาดใหญ่' }];
  const CMDS = [{ key: 'helmet_count', enabled: true, slots: ['period', 'site'],
    triggers: ['ไม่สวมหมวก', 'หมวกนิรภัย'], require_all: [], exclude: [], _sites: SITES }];

  it('พิมพ์ "ภูเก็ต" มาในประโยคแรก ต้องไม่ถูกถามซ้ำว่าไซต์ไหน', () => {
    // เดิมเทียบกับ sites.name ซึ่งเป็นอังกฤษล้วน ⇒ ชื่อไทยไม่เคยติด บอทถามทุกครั้ง
    assert.equal(matchCommand('ขอยอดผู้ไม่สวมหมวกนิรภัย ภูเก็ต วันนี้', CMDS, { now: NOW }).slots.site, 'hkt');
    assert.equal(matchCommand('ยอดไม่สวมหมวก หาดใหญ่', CMDS, { now: NOW }).slots.site, 'hdy');
  });

  it('ไม่ระบุไซต์ = ไม่เดา (ปล่อยให้ไปเข้าทางถามกลับ)', () => {
    assert.equal(matchCommand('ยอดไม่สวมหมวกวันนี้', CMDS, { now: NOW }).slots.site, undefined);
  });
});

// คำสั่งที่ "ลงมือทำ" — ของที่ส่งออกไปข้างนอกองค์กรแล้วเรียกคืนไม่ได้
// มาจากงานจริง: ป้ายรถทดสอบอยู่กลุ่มที่ตำรวจไม่ได้รับ (ถูกต้องแล้ว) แต่พอเป็นเคสจริง
// เจ้าของต้องเปิดหน้าจอกดส่งเอง ซึ่งหลายครั้งไม่ได้อยู่หน้าจอ
describe('คำสั่งชนิดลงมือทำ', () => {
  const { readAnswer } = require('../src/helpers/lineCommandRun');
  const { ACTIONS, getAction } = require('../src/line-actions');

  it('ยืนยันต้องชัดเจน — คำอื่นไม่นับว่าตอบ', () => {
    const ask = { need: 'confirm', options: [] };
    for (const yes of ['ใช่', 'ยืนยัน', 'ส่ง', 'ok', 'YES']) {
      assert.equal(readAnswer(yes, ask, NOW), 'yes', yes);
    }
    for (const no of ['ไม่', 'ยกเลิก', 'no']) {
      assert.equal(readAnswer(no, ask, NOW), 'no', no);
    }
    // เงียบ หรือพิมพ์อย่างอื่น = ไม่ส่ง · ของที่ส่งออกไปแล้วเรียกคืนไม่ได้
    for (const other of ['เดี๋ยวก่อน', 'อืม', '', 'ส่งให้ตำรวจ']) {
      assert.equal(readAnswer(other, ask, NOW), null, other);
    }
  });

  it('ข้อความยืนยันบอกครบว่าจะส่งอะไร ไปที่ไหน', () => {
    const t = ACTIONS.forward_alert.confirmText(
      { plate_number: '1กอ88', region: 'ภูเก็ต', camera_name: 'ขาออกตำบลฉลอง (C4)',
        event_time: '2026-09-08T11:01:54.000Z' },
      ['Phuket Eyes Police-VSS']);
    assert.match(t, /Phuket Eyes Police-VSS/, 'ต้องบอกชื่อกลุ่มปลายทาง ไม่ใช่รหัส');
    assert.match(t, /1กอ88/);
    assert.match(t, /ขาออกตำบลฉลอง/);
    assert.match(t, /18:01/, 'เวลาต้องเป็นเวลาไทย');
    assert.match(t, /ใช่/, 'ต้องบอกวิธีตอบ');
  });

  it('การกระทำที่ต้องมีปลายทาง ประกาศ needsTargets ไว้', () => {
    assert.equal(getAction('forward_alert').needsTargets, true);
    assert.equal(getAction('ไม่มีจริง'), null);
  });
});

describe('หยุดแจ้งเตือนชั่วคราว', () => {
  const { suppressionReason } = require('../src/helpers/lprLineAlert');
  const ok = { lineEnabled: true, channelEnabled: true, groupNotify: true, plateNotify: true,
               recipientCount: 1, cooldownRemainingSec: 0, hourlySent: 0 };

  it('ปิดชั่วคราวที่ยังไม่หมดอายุ = เงียบ และแยก reason จากการปิดถาวร', () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    assert.equal(suppressionReason({ ...ok, mutedUntil: future }), 'plate_muted_until');
    assert.equal(suppressionReason({ ...ok, plateNotify: false }), 'plate_muted',
      'ปิดถาวรต้องยังเป็นคนละเหตุผล ไม่งั้นดูปูมย้อนหลังแล้วแยกไม่ออก');
  });

  it('หมดอายุแล้วกลับมาแจ้งเองโดยไม่ต้องมีใครไปเปิด', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    assert.equal(suppressionReason({ ...ok, mutedUntil: past }), null);
    assert.equal(suppressionReason({ ...ok, mutedUntil: null }), null);
  });

  it('การปิดชั่วคราวถูกเช็คหลังกลุ่ม/ช่องทาง — เหตุผลแรกที่บล็อกจริงต้องถูกรายงาน', () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    assert.equal(suppressionReason({ ...ok, groupNotify: false, mutedUntil: future }), 'group_muted');
  });
});

describe('จำนวนชั่วโมงในคำสั่งหยุดแจ้งเตือน', () => {
  const { extractSlots } = require('../src/helpers/lineCommandMatch');
  const cmd = { slots: ['plate', 'hours'] };

  it('อ่าน "3 ชั่วโมง" และ "12 ชม." ได้', () => {
    assert.equal(extractSlots('หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง', cmd, NOW).hours, 3);
    assert.equal(extractSlots('หยุดแจ้งเตือน 1กอ88 12 ชม.', cmd, NOW).hours, 12);
  });

  it('ไม่ระบุ = ไม่มีค่า (ตัวรันใช้ค่าเริ่มต้น 24 ชม.)', () => {
    assert.equal(extractSlots('หยุดแจ้งเตือน 1กอ88', cmd, NOW).hours, undefined);
  });

  it('เพดาน 7 วัน — ปิดยาวกว่านั้นต้องไปทำในแดชบอร์ดที่มีชื่อคนกด', () => {
    assert.equal(extractSlots('หยุดแจ้งเตือน 1กอ88 999 ชั่วโมง', cmd, NOW).hours, 168);
  });
});

// ปม 2026-09-15 (ต่อยอด GOTCHAS #209, ปูม id=287): paste ข้อความยาวหลายบรรทัด
// (เช่น log) เข้าห้องที่บอทฟังอยู่ ดันมีคำเรียกคำสั่งฝังอยู่กลางเนื้อหาโดยบังเอิญ
// ("offline" ซ้ำหลายจุดในปูมที่ paste) ชน camera_offline ตรง ๆ ทั้งที่กำลังคุย
// วิเคราะห์บั๊กกันอยู่ — handleLineText ไม่ export DB ปลอมง่าย ๆ (ต้องมี pool จริง)
// เทสต์นี้จึงตรวจ source text แบบเดียวกับ test/line-webhook-command.test.js
describe('ข้อความยาว/หลายบรรทัดต้องไม่เข้าทางจับคำสั่ง', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'helpers', 'lineCommandRun.js'), 'utf8');

  it('มีการกันก่อนเรียก matchCommand', () => {
    const gateIdx = src.indexOf("includes('\\n')");
    const matchIdx = src.indexOf('const m = matchCommand(text, commands');
    assert.ok(gateIdx > 0, 'ต้องมีเงื่อนไขกันข้อความหลายบรรทัด');
    assert.ok(matchIdx > gateIdx, 'ต้องกันก่อนเรียก matchCommand ไม่ใช่หลัง');
  });

  it('เพดานความยาวต้องมากกว่าคำสั่งจริงที่ยาวที่สุด แต่กันปูม log ได้', () => {
    // คำสั่งจริงที่ยาวสุดในเทสต์ชุดนี้ ("ขอยอดผู้ไม่สวมหมวกนิรภัย ภูเก็ต วันนี้")
    // ยาวไม่ถึง 50 ตัวอักษร — เพดาน 200 เผื่อพอแต่ยังกันปูม log หลายบรรทัดได้
    const m = src.match(/length > (\d+)/);
    assert.ok(m, 'ต้องมีเพดานความยาว');
    assert.ok(Number(m[1]) >= 100 && Number(m[1]) <= 400,
      'เพดานต้องเผื่อประโยคจริงแต่ยังกันข้อความยาวผิดปกติได้');
  });
});
