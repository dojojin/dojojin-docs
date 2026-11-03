// ============================================================
// Vigil Platform — face reference-photo lookup ต้องมีชั้นเดียวของความจริง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เหตุจริง 2026-08-29: fallback หา "ภาพอ้างอิงบุคคล HCP" ถูกเติมที่หน้า Face
// Matches (2026-08-18) แต่ตัวส่งการ์ด LINE ยังใช้สำเนาเก่า → การ์ดเหลือรูปเดียว
// ทั้งที่หน้าจอโชว์ครบ (คนใน watch list ไม่มีแถว mirror face_blacklist)
// บทเรียนสองข้อที่ไฟล์นี้ล็อกไว้:
//   1. เงื่อนไขจับคู่ต้องอยู่ใน helpers/faceRefLookup.js ที่เดียว — ห้ามคัดลอก
//      กลับไปฝังใน query ของไฟล์ไหนอีก (แตกแถวกันแบบเงียบ ๆ ได้เสมอ)
//   2. เพิ่ม JOIN/คอลัมน์ใน SQL แล้วต้องตามให้ถึงปลายทาง — LATERAL r2 เคยถูก
//      เพิ่มโดยไม่มี r2.* ใน SELECT list คอลัมน์เลยไม่มาแบบไม่มี error
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const HELPER = read('src', 'helpers', 'faceRefLookup.js');
const FACES = read('src', 'routes', 'faces.js');
const SENDER = read('src', 'line-sender.js');

// ลายนิ้วมือของเงื่อนไขจับคู่ทั้งสองชั้น
const FALLBACK_SIG = "'face:' ||";                 // external_id ของ source_records
const MIRROR_SIG = 'bl.hcp_person_id =';           // เงื่อนไข mirror face_blacklist

test('เงื่อนไขจับคู่อยู่ใน helper ที่เดียว — ไฟล์ผู้ใช้ห้ามมีสำเนาของตัวเอง', () => {
  assert.ok(HELPER.includes(FALLBACK_SIG), 'helper ต้องถือ fallback external_id');
  assert.ok(HELPER.includes(MIRROR_SIG), 'helper ต้องถือเงื่อนไข mirror');
  for (const [name, src] of [['faces.js', FACES], ['line-sender.js', SENDER]]) {
    assert.ok(!src.includes(FALLBACK_SIG),
      `${name} มีสำเนา fallback ของตัวเอง — ต้องใช้ helpers/faceRefLookup แทน`);
    assert.ok(!src.includes(MIRROR_SIG),
      `${name} มีสำเนาเงื่อนไข mirror ของตัวเอง — ต้องใช้ helpers/faceRefLookup แทน`);
  }
});

test('ทั้งสองทางเรียกผ่าน helper จริง (ไม่ใช่แค่ลบสำเนาทิ้ง)', () => {
  assert.ok(/require\('\.\.\/helpers\/faceRefLookup'\)/.test(FACES));
  assert.match(FACES, /refPhotoScalarSql\('e'\)/, 'faces.js ต้องใช้ scalar จาก helper');
  assert.equal(FACES.split("refPhotoScalarSql('e')").length - 1, 2,
    'faces.js มีจุดใช้ ref_photo สองจุด ต้องผ่าน helper ทั้งคู่');
  assert.ok(/require\('\.\/helpers\/faceRefLookup'\)/.test(SENDER));
  assert.match(SENDER, /\$\{mirrorPairSql\('e'\)\}/);
  assert.match(SENDER, /\$\{fallbackWhereSql\('e', 'sr2'\)\}/);
});

test('บทเรียน SELECT-splat: คอลัมน์ fallback ต้องถูก select และถูกใช้จริง', () => {
  // LATERAL r2 เคยถูกเพิ่มโดยไม่มี r2.* — คอลัมน์หายเงียบ การ์ดยังรูปเดียว
  assert.match(SENDER, /r\.\*, r2\.\*/, 'SELECT list ต้องมีทั้ง r.* และ r2.*');
  assert.match(SENDER, /row\.fb_ref_path/, 'ฝั่ง JS ต้องอ่าน fb_ref_path มาเติมเมื่อทางหลักไม่เจอ');
});
