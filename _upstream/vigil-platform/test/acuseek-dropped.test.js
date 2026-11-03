// ============================================================
// Vigil Platform — คำที่ "รู้จักแต่ไม่ได้ใช้" ในค้นหาอัจฉริยะ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// `unknown` เดิมตอบได้แค่ "ระบบไม่รู้จักคำนี้" ซึ่งจับได้เฉพาะคำนอกตาราง
// แต่ความพังที่อันตรายกว่าคือคำที่ **อยู่ในตารางแล้ว** ระบบอ่านออกด้วย
// แต่ตอนประกอบประโยคกลับไม่ได้ใช้ ⇒ `unknown` ว่าง ผู้ใช้จึงไม่เห็นคำเตือนใด ๆ
// ทั้งที่คำค้นเพี้ยนไปคนละเรื่อง (วัด 28 คำค้น 2026-08-14: พลาด ~10 เตือนแค่ 6)
//
// 🔴 สองกลไกที่ทำให้เงียบ — ทั้งคู่ยังอยู่ ไฟล์นี้แค่ทำให้ "มองเห็น" ไม่ได้แก้ตัวแปล
//   1. HEAD.find() เลือก "ตัวแรกในตาราง" ไม่ใช่ประธานจริงของประโยค และ
//      หมา/แมว/รถเข็น ถูกวางไว้ **เหนือ** คน ⇒ "คนจูงหมา" ได้ `a dog` คนหายทั้งคน
//   2. สีจะถูกใช้ก็ต่อเมื่อมีคำเสื้อผ้านำหน้า ⇒ "หมวกกันน็อคสีขาว" ทิ้งขาวเงียบ ๆ
//      และ unknownWords ก็ mark ว่า "ใช้แล้ว" เพราะมันนับแค่ว่า *อ่านออก* ไม่ใช่ *ได้ใช้*
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const phrase = require('../src/helpers/acuseekPhrase');

const why = (text) => (phrase.prepare(text).dropped || []).map((d) => d.why).sort();

describe('acuseek — ประธานที่เป็นคนหายไปจากประโยค', () => {
  for (const [th, en] of [
    ['คนอุ้มแมว',   'a cat carrying a child'],
    ['คนจูงหมา',    'a dog'],
    ['คนเข็นรถเข็น', 'a street food stall cart'],
  ]) {
    it(`"${th}" → ยังแปลเป็น "${en}" แต่ต้องเตือนว่าคนหาย`, () => {
      assert.strictEqual(phrase.prepare(th).english, en, 'ข้อ A ไม่แก้ตัวแปล ผลต้องเหมือนเดิม');
      assert.ok(why(th).includes('person'), 'ต้องมี dropped.why = person');
    });
  }

  it('"คนขี่มอเตอร์ไซค์ไม่ใส่หมวก" → ประธานกลายเป็นคนขี่อยู่แล้ว ห้ามเตือน', () => {
    assert.deepEqual(why('คนขี่มอเตอร์ไซค์ไม่ใส่หมวก'), []);
  });

  it('"รถกระบะสีขาว" → ไม่มีคำว่าคนตั้งแต่แรก ห้ามเตือน', () => {
    assert.deepEqual(why('รถกระบะสีขาว'), []);
  });
});

describe('acuseek — สีที่อ่านออกแต่ไม่ได้ถูกใช้', () => {
  it('"คนใส่หมวกกันน็อคสีขาว" → ขาวหายไปจากประโยคอังกฤษ ต้องเตือน', () => {
    const p = phrase.prepare('คนใส่หมวกกันน็อคสีขาว');
    assert.strictEqual(p.english, 'a person wearing a helmet');
    assert.deepEqual(p.unknown, [], 'คำนี้ unknown ว่างมาตลอด — นั่นคือเหตุที่ต้องมี dropped');
    assert.ok(why('คนใส่หมวกกันน็อคสีขาว').includes('color'));
  });

  it('"คนใส่ชุดดำทั้งตัว" → ยุบเหลือ a person ต้องเตือน', () => {
    assert.strictEqual(phrase.prepare('คนใส่ชุดดำทั้งตัว').english, 'a person');
    assert.ok(why('คนใส่ชุดดำทั้งตัว').length > 0);
  });

  it('สีที่สองต้องไม่หายเงียบ — "เสื้อเชิ้ตขาวกางเกงดำ" ใช้ได้แค่สีเดียว', () => {
    const p = phrase.prepare('ผู้ชายใส่เสื้อเชิ้ตขาวกางเกงดำ');
    assert.match(p.english, /black trousers/);
    assert.ok((p.dropped || []).some((d) => d.why === 'color' && /ขาว/.test(d.th)));
  });

  it('"คนใส่เสื้อแดง" → สีถูกใช้จริง ห้ามเตือน', () => {
    assert.strictEqual(phrase.prepare('คนใส่เสื้อแดง').english, 'a person wearing a red shirt');
    assert.deepEqual(why('คนใส่เสื้อแดง'), []);
  });
});

describe('acuseek — ประโยคยุบเหลือประธานเปล่า', () => {
  it('"คนใส่เสื้อลายมังกร" → ได้ a person โล้น ๆ (unknown จับได้อยู่แล้ว ไม่ต้องเตือนซ้ำ)', () => {
    const p = phrase.prepare('คนใส่เสื้อลายมังกร');
    assert.strictEqual(p.english, 'a person');
    assert.ok(p.unknown.length > 0, 'unknown เดิมเตือนเคสนี้อยู่แล้ว');
    assert.deepEqual((p.dropped || []).map((d) => d.why), [],
      'มีคำเตือนอยู่แล้ว ห้ามเตือนซ้ำซ้อน');
  });

  it('คำค้นที่ปกติดี ต้องไม่มีคำเตือนใหม่โผล่มา', () => {
    for (const t of ['คนเดินถือร่ม', 'คนวิ่ง', 'คนถือถุงพลาสติก',
                     'ผู้ชายใส่หมวก', 'รถจักรยานยนต์สีแดง', 'คนใส่เสื้อสีดำสะพายเป้']) {
      assert.deepEqual(why(t), [], `"${t}" ไม่ควรมี dropped`);
    }
  });
});
