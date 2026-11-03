// ============================================================
// Vigil Platform — แม่แบบข้อความของแท็บช่องทาง ต้องเป็น placeholder ไม่ใช่ค่า
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เจ้าของเจอ 2026-08-26: ล้างช่อง Message Template ของแท็บป้ายทะเบียนแล้วบันทึก
// ค่าเด้งกลับมาทุกครั้ง · ต้นเหตุคือหน้าจอวาด textarea ด้วย
//   r.message_template ?? ACH_LPR_DEFAULT_TPL
// ทำให้ NULL (= "ใช้ข้อความอัตโนมัติ") กลายเป็นข้อความจริงในช่อง แล้วการบันทึก
// ครั้งถัดไปเขียนแม่แบบลง DB เอง — เป็น DB default ที่ย้ายมาอยู่ที่หน้าจอ ซึ่งคือ
// สิ่งที่คอมเมนต์ในไฟล์นั้นตั้งใจเลี่ยงมาแต่แรก
//
// ทดสอบที่ตัวซอร์สเพราะโค้ดส่วนนี้เป็นสคริปต์ของเบราว์เซอร์ require เข้ามาไม่ได้
// และสิ่งที่ต้องกันคือ "แม่แบบไปโผล่ในช่อง value" ซึ่งอ่านจากซอร์สได้ตรง ๆ

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-alerts.js'), 'utf8');

test('textarea ของแท็บช่องทาง ต้องไม่เอาแม่แบบมาเป็นค่าเริ่มต้น', () => {
  const m = SRC.match(/<textarea[^]*?id="achTemplate-\$\{ch\}"[^]*?<\/textarea>/);
  assert.ok(m, 'หา textarea ของ achTemplate ไม่เจอ');
  const block = m[0];

  // ค่าในช่อง = ค่าจาก DB เท่านั้น · NULL ต้องกลายเป็นช่องว่าง
  assert.ok(/r\.message_template \?\? ''/.test(block),
    'NULL ต้องวาดเป็นช่องว่าง ไม่ใช่แม่แบบ');

  // แม่แบบต้องอยู่ใน placeholder เท่านั้น
  const ph = block.match(/placeholder="[^]*?"/);
  assert.ok(ph && ph[0].includes('ACH_LPR_DEFAULT_TPL'),
    'แม่แบบต้องอยู่ใน placeholder');

  // และต้องไม่โผล่หลัง `>` ซึ่งคือเนื้อของ textarea
  const inner = block.slice(block.indexOf('>', block.indexOf('placeholder')) + 1);
  assert.ok(!inner.includes('ACH_LPR_DEFAULT_TPL'),
    'แม่แบบห้ามอยู่ในเนื้อ textarea — บันทึกครั้งถัดไปจะเขียนมันลง DB');
});

test('คำอธิบายใต้ช่อง มีครบทั้งไทยและอังกฤษ (gotcha #42)', () => {
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'i18n.js'), 'utf8');
  for (const k of ['ach.tplAuto', 'ach.lprTextNote']) {
    const n = i18n.split(`'${k}':`).length - 1;
    assert.equal(n, 2, `${k} ต้องมีทั้งบล็อก th และ en`);
  }
});
