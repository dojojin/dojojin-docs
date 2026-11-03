// ============================================================
// Vigil Platform — Tests: เส้นทาง webhook ของคำสั่งผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// สามบั๊กที่หลุดไปถึงกลุ่มจริงเมื่อ 2026-09-08 อยู่ตรงเส้นทางนี้ทั้งหมด และ**ไม่มี
// เทสต์เดิมตัวไหนจับได้เลย** เพราะทุกตัวทดสอบแค่ "คิดถูกไหม" ไม่ได้ทดสอบ "ส่งถึงไหม":
//   1. ปุ่มบนการ์ดใส่ลิงก์เป็น path ล้วน → LINE ตอบ 400 ทิ้งทั้งข้อความ
//   2. ส่งไม่สำเร็จแล้วไม่ log อะไรเลย → บั๊กข้อ 1 มองไม่เห็นทั้งที่เกิดสองครั้ง
//   3. รอคำสั่งเสร็จก่อนตอบ 200 (2,200 ms) → LINE ส่ง event ซ้ำ คำสั่งรันสองรอบ
//      การ์ดเด้งสองใบตัวเลขไม่เท่ากัน
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('webhook ต้องตอบ LINE ให้ทัน', () => {
  const src = read('src/routes/line.js');

  it('งานประมวลผลคำสั่งไม่ถูก await ก่อนตอบ 200', () => {
    // LINE ให้เวลาระดับ 1 วินาที · คำสั่งที่ดึงข้อมูลหนักใช้ 2-5 วินาที
    // ⇒ ต้องยิงงานออกไปแบบไม่รอ แล้วปล่อยให้ลูปจบเพื่อตอบ 200
    const i = src.indexOf('handleLineText(');
    assert.ok(i > 0, 'ไม่พบการเรียก handleLineText');
    // หน้าต่างกว้างพอจะครอบบล็อก onAck ที่แทรกเข้ามา (2026-09-09) — สิ่งที่กันคือ
    // "ตัวห่อหายไป" ไม่ใช่ระยะห่างเป็นตัวอักษร
    const before = src.slice(Math.max(0, i - 1400), i);
    assert.match(before, /void \(async \(\) => \{/,
      'ต้องห่อด้วย void (async () => { … })() ไม่งั้น LINE จะรอจนหมดเวลาแล้วส่งซ้ำ');
  });

  it('event ที่ LINE ส่งซ้ำถูกทิ้ง', () => {
    assert.match(src, /isRedelivery/,
      'ต้องเช็ค deliveryContext.isRedelivery — ไม่งั้นคำสั่งเดิมรันสองรอบ');
  });

  it('ส่งไม่สำเร็จต้องขึ้น log ทั้ง reply และ push', () => {
    const i = src.indexOf('ตอบกลับไม่สำเร็จ');
    assert.ok(i > 0, 'ต้อง console.error เมื่อส่งไม่ออก');
    const around = src.slice(i - 200, i + 300);
    assert.match(around, /reply=/, 'ต้องบอกด้วยว่า reply ล้มเพราะอะไร');
    assert.match(around, /push=/, 'ต้องบอกด้วยว่า push ล้มเพราะอะไร');
  });

  it('ตัดออกจากเส้นทางลงทะเบียนเฉพาะข้อความของผู้สั่งที่ลงทะเบียนแล้ว', () => {
    // เกือบพลาด: ถ้า continue ให้ทุกข้อความ คนที่ทักบอทมาขออนุมัติจะไม่ถูกบันทึกอีกเลย
    assert.match(src, /_isOperator/,
      'ต้องเช็คก่อนว่าเป็นผู้สั่งจริงไหม ก่อนตัดออกจากเส้นทางลงทะเบียนผู้รับ');
    const i = src.indexOf('const _isOperator');
    const after = src.slice(i, i + 400);
    assert.match(after, /loadOperator/, 'เช็คด้วย loadOperator ไม่ใช่เดาจากรูปร่างข้อความ');
  });

  // GOTCHAS #209 ต่อยอด 2026-09-15: "@Unlockk ... กล้องดับหรอ..." ชนคำสั่งจริง
  // เพราะแท็กคนในห้องดันมีคำเรียกคำสั่งฝังอยู่ในประโยค — ยืนยันจาก line_command_log
  // จริง (id=272, id=276) ว่า message.mention ของ LINE มี isSelf บอกได้แม่นยำว่า
  // แท็กบอทเองหรือแท็กคนอื่น
  it('ข้อความที่แท็กคนอื่น (ไม่ใช่บอท) ต้องไม่เข้าทางคำสั่ง แม้เป็นผู้สั่งที่ลงทะเบียนแล้ว', () => {
    const i = src.indexOf('const _mentionsSelf');
    assert.ok(i > 0, 'ต้องมีตัวเช็ค mention ก่อนเข้าทางคำสั่ง');
    assert.match(src.slice(i, i + 300), /isSelf/,
      'ต้องเช็คด้วย isSelf ของ LINE (บอกว่าคนที่ถูกแท็กคือบอทเองไหม) ไม่ใช่เดาจากข้อความ');
    const gateIdx = src.indexOf(
      'if (_isOperator && !_mentionsOthersOnly && !_groupNeedsMention)');
    assert.ok(gateIdx > i, 'เงื่อนไข _mentionsOthersOnly ต้องกันทางคำสั่งไว้ก่อน _isOperator เดิม');
  });

  // decision #289 (2026-09-16): เจอซ้ำรอบที่ 3 ว่าผู้สั่งคุยเรื่องอื่นล้วน ๆ ในแชท**กลุ่ม**
  // แล้วบอทเด้งการ์ด "ยังไม่เข้าใจคำสั่งนี้" ใส่ — บังคับ @ บอทก่อนถึงจะเข้าทางคำสั่ง
  // เฉพาะกลุ่ม/ห้อง ส่วนแชท 1:1 คงพฤติกรรมเดิม (ไม่ต้อง @)
  it('แชทกลุ่ม/ห้อง ต้อง @ บอทเองก่อนถึงจะเข้าทางคำสั่ง', () => {
    const i = src.indexOf('const _groupNeedsMention');
    assert.ok(i > 0, 'ต้องมีตัวเช็คว่ากลุ่ม/ห้องนี้แท็กบอทเองหรือยัง');
    const body = src.slice(i, i + 300);
    assert.match(body, /sourceType === 'group'/, 'ต้องครอบคลุมแชทกลุ่ม');
    assert.match(body, /sourceType === 'room'/, 'ต้องครอบคลุมแชทห้อง');
    assert.match(body, /&&\s*!_mentionsSelf/, 'ต้องปิดทางไว้จนกว่าจะแท็กบอทเอง (isSelf)');
  });

  it('แชท 1:1 กับบอทยังไม่ต้อง @ (พฤติกรรมเดิม)', () => {
    const i = src.indexOf('const _groupNeedsMention');
    const body = src.slice(i, i + 300);
    assert.doesNotMatch(body, /sourceType === 'user'/,
      'แชท 1:1 (sourceType user) ต้องไม่ถูกบังคับ @ — ไม่มีทางเข้าใจผิดว่าใครเป็นคนฟัง');
  });
});

describe('ลิงก์บนการ์ดต้องเป็น URL เต็มรูป', () => {
  it('path ล้วนถูกประกอบเป็น URL เต็มจาก DASHBOARD_PUBLIC_URL', () => {
    const before = process.env.DASHBOARD_PUBLIC_URL;
    process.env.DASHBOARD_PUBLIC_URL = 'https://dash.example.com';
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/helpers/lineCommandRun')];
    const run = require('../src/helpers/lineCommandRun');
    // _absLink ไม่ได้ export — ตรวจผ่านข้อความในไฟล์ว่าไม่มีการส่ง path ดิบออกไป
    const src = read('src/helpers/lineCommandRun.js');
    assert.match(src, /link: _absLink\(src\.link\)/,
      'การ์ดต้องผ่าน _absLink() ก่อนเสมอ — LINE ทิ้งทั้งข้อความถ้า URI ไม่เต็มรูป');
    assert.ok(typeof run.handleLineText === 'function');
    if (before === undefined) delete process.env.DASHBOARD_PUBLIC_URL;
    else process.env.DASHBOARD_PUBLIC_URL = before;
  });

  it('ทะเบียนแหล่งข้อมูลเก็บ link เป็น path (ตัวประกอบ URL อยู่ที่เดียว)', () => {
    const { SOURCES } = require('../src/line-answer-sources');
    for (const [key, s] of Object.entries(SOURCES)) {
      if (!s.link) continue;
      assert.ok(s.link.startsWith('/'), `${key}: link ควรเป็น path เพื่อให้ประกอบ URL ที่เดียว`);
    }
  });
});

describe('ปูมและคำถามค้างต้องถูกกวาด', () => {
  it('jobs/retention รู้จักทั้งสองตาราง', () => {
    // สองตารางนี้เขียนทุกครั้งที่มีคนพิมพ์ในกลุ่มที่บอทอยู่ ⇒ โตไม่มีเพดานถ้าไม่มีใครลบ
    const src = read('src/jobs/retention.js');
    assert.match(src, /DELETE FROM line_command_log/);
    assert.match(src, /DELETE FROM line_pending_asks/);
  });
});
