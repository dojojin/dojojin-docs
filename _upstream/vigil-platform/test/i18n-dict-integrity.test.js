// ============================================================
// Vigil Platform — Tests: DICT ของ i18n ต้องครบและไม่มี key ซ้ำ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// บั๊กจริง 2026-08-24 — หลุดขึ้น production ไปแล้วก่อนถูกจับได้:
//
//   var DICT = { th: {...}, en: {...},  ...1300 บรรทัด...  en: {...} };
//
// การเพิ่มคำแปลอังกฤษชุดใหม่ถูกเขียนเป็นบล็อก `en:` **ก้อนที่สอง** แทนที่จะเติมลง
// ก้อนเดิม · DICT เป็น object literal ตัวเดียว JS จึงเอาก้อนหลังทับก้อนแรกทั้งก้อน
// → DICT.en เหลือ **64 key จาก 3,306** ภาษาอังกฤษพังทั้งระบบ **โดยไม่มี error ใด ๆ**
// ทั้ง `node --check` และการเทียบ "th มีกี่ key / en มีกี่ key" ก็ยังเขียว เพราะ
// การ grep หา key จากตัวไฟล์เห็นทั้งสองก้อน — ต้อง **ประเมิน object จริง** ถึงจะเห็น
//
// เทสต์นี้จึงรัน DICT จริงด้วย vm แล้วนับจากผลลัพธ์ ไม่ใช่นับจากสตริงในไฟล์

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const I18N_FILE = path.join(__dirname, '..', 'dashboard', 'i18n.js');
const SRC = fs.readFileSync(I18N_FILE, 'utf8');
const LINES = SRC.split('\n');

function extractDict() {
  let depth = 0, start = -1;
  for (let i = 0; i < LINES.length; i++) {
    if (start < 0) { if (/var DICT = \{/.test(LINES[i])) { start = i; depth = 1; } continue; }
    for (const c of LINES[i]) { if (c === '{') depth++; else if (c === '}') depth--; }
    if (depth <= 0) {
      const ctx = {};
      vm.runInNewContext(LINES.slice(start, i + 1).join('\n') + '\nout = DICT;', ctx);
      return { dict: ctx.out, start, end: i };
    }
  }
  throw new Error('หา var DICT ใน dashboard/i18n.js ไม่เจอ');
}

const { dict, start, end } = extractDict();

describe('i18n DICT integrity', () => {
  it('มีครบทั้ง th และ en', () => {
    assert.ok(dict.th && typeof dict.th === 'object', 'ไม่มี DICT.th');
    assert.ok(dict.en && typeof dict.en === 'object', 'ไม่มี DICT.en');
  });

  // นี่คือเทสต์ที่จับบั๊กจริงได้ — ถ้ามีบล็อกซ้ำ ก้อนหลังจะทับก้อนแรก
  // แล้วฝั่งนั้นจะเหลือ key น้อยผิดปกติทันที
  it('ทั้งสองภาษามี key ใกล้เคียงกัน (บล็อกซ้ำจะทำให้ฝั่งหนึ่งหด)', () => {
    const th = Object.keys(dict.th).length;
    const en = Object.keys(dict.en).length;
    assert.ok(th > 1000, `DICT.th มีแค่ ${th} key — น้อยผิดปกติ`);
    assert.ok(en > 1000, `DICT.en มีแค่ ${en} key — น้อยผิดปกติ ` +
      '(อาการของการมีบล็อก en: ซ้ำใน DICT ก้อนหลังทับก้อนแรก)');
  });

  it('ไม่มี key ที่มีข้างเดียว', () => {
    const th = Object.keys(dict.th), en = Object.keys(dict.en);
    const onlyTh = th.filter((k) => !(k in dict.en));
    const onlyEn = en.filter((k) => !(k in dict.th));
    assert.deepEqual(onlyTh, [], `มีใน th ไม่มีใน en: ${onlyTh.join(', ')}`);
    assert.deepEqual(onlyEn, [], `มีใน en ไม่มีใน th: ${onlyEn.join(', ')}`);
  });

  // ต้นเหตุโดยตรง: ห้ามมี 'th:' หรือ 'en:' โผล่ซ้ำในระดับบนของ DICT
  it('ไม่มีบล็อกภาษาซ้ำใน DICT', () => {
    const body = LINES.slice(start, end + 1);
    for (const lang of ['th', 'en']) {
      const n = body.filter((l) => l === `    ${lang}: {`).length;
      assert.equal(n, 1, `เจอบล็อก '${lang}:' ${n} ก้อนใน DICT — ต้องมีก้อนเดียว ` +
        'เพราะก้อนหลังจะทับก้อนแรกทั้งก้อนโดยไม่มี error');
    }
  });

  // key ที่หน้าเว็บเรียกจริงต้องมีอยู่ — การเทียบ th กับ en เท่ากันอย่างเดียว
  // **ผ่านได้ทั้งที่ key หายไปจากทั้งคู่** (เกิดจริงกับ fsvc.unitDays / page.files)
  it('ทุก key ที่ I18N.t() เรียก มีอยู่ใน DICT ทั้งสองภาษา', () => {
    const DASH = path.join(__dirname, '..', 'dashboard');
    const files = fs.readdirSync(DASH).filter((f) => f.endsWith('.js') && f !== 'i18n.js');
    const missing = [];
    for (const f of files) {
      const js = fs.readFileSync(path.join(DASH, f), 'utf8');
      // จับเฉพาะ key ที่เป็น literal — ตัวที่ประกอบจากตัวแปรตรวจแบบนี้ไม่ได้
      // เช่น I18N.t('page.' + name, name) จะจับได้แค่ 'page.' ซึ่งไม่ใช่ key จริง
      // จึงข้ามทุกตัวที่ลงท้ายด้วยจุด
      for (const m of js.matchAll(/I18N\.t\(\s*'([A-Za-z0-9_.]+)'/g)) {
        const k = m[1];
        if (k.endsWith('.')) continue;
        if (!(k in dict.th) || !(k in dict.en)) missing.push(`${f}: ${k}`);
      }
    }
    assert.deepEqual(missing, [], 'key ที่ JS เรียกแต่ไม่มีใน DICT:\n  ' + missing.join('\n  '));
  });
});
