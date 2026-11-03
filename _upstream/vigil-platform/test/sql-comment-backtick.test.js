// ============================================================
// Vigil Platform — กันคอมเมนต์ SQL ที่มี backtick อยู่ใน template literal
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// incident 2026-08-31: เติมคอมเมนต์อธิบาย ORDER BY ลงใน SQL ที่อยู่ใน template
// literal โดยเขียนชื่อคอลัมน์ในเครื่องหมาย backtick ตามนิสัย markdown ผลคือ
// backtick นั้น **ปิด template literal** ตรงกลาง SQL ส่วนที่เหลือกลายเป็นโค้ด JS
// และ GET /api/sites พังทั้ง endpoint ด้วย "s is not defined" — ทุกหน้าที่มีแถบ
// เลือก site จึงว่างเปล่าพร้อมกัน
//
// `node --check` ผ่านฉลุยเพราะผลลัพธ์ยังเป็น JS ที่ถูกไวยากรณ์ · เทสต์นี้จับ
// รูปแบบนั้นตรง ๆ เพราะมันมองไม่เห็นด้วยตาเวลา review diff
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');

function jsFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(full, acc);
    else if (e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('ห้ามมี backtick ในบรรทัดคอมเมนต์ SQL (-- ...)', () => {
  const bad = [];
  for (const f of jsFiles(ROOT)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // ต้องเป็น `--` แล้วตามด้วยอักขระที่ไม่ใช่ `-` เพื่อไม่ไปจับ PEM footer
      // (-----END PUBLIC KEY----- ใน license.js) ซึ่งไม่ใช่คอมเมนต์ SQL
      if (/^\s*--(?![-])/.test(line) && line.includes('`')) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [],
    'คอมเมนต์ SQL ที่มี backtick จะปิด template literal กลาง query:\n' + bad.join('\n'));
});
