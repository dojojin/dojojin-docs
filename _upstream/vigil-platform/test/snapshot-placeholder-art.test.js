// ============================================================
// Vigil Platform — Tests: รูปจำลองเมื่อไฟล์ภาพถูกลบตามรอบเก็บข้อมูล
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// `_SNAP_VEH_CLASS` ใน page-snapshots.js แปลง object_class ที่กล้องส่งมา ไปเป็นคำที่
// `vehKind()` ใน lpr-plaque.js รู้จัก · ของเดิมใส่คำผิดชุด ('motorcycle' แทน
// 'twoWheelVehicle') ซึ่ง vehKind ไม่รู้จักแล้ว fall through เป็น 'car' เงียบ ๆ
// ⇒ รูปจำลองเป็นรถเก๋งทุกใบ ไม่ว่าจะจักรยานยนต์ รถบรรทุก หรือรถบัส
// ไม่มี error ให้เห็น มีแต่รูปที่ผิด จึงต้องมีเทสต์ยึดไว้
//
// เทสต์นี้เทียบ **รูปที่ได้จริง** ไม่ใช่เทียบสตริงในตาราง — ตารางที่ถูกต้องแต่ vehKind
// เปลี่ยนคำวันหน้า ก็ต้องแดงเหมือนกัน

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

global.window = global;
require('../dashboard/lpr-plaque.js');

// ดึงตารางออกจากซอร์สตรง ๆ — ไฟล์เป็นสคริปต์ของเบราว์เซอร์ require ทั้งไฟล์ไม่ได้
const SRC = fs.readFileSync(path.join(__dirname, '../dashboard/page-snapshots.js'), 'utf8');
const MAP = (() => {
  const m = SRC.match(/const _SNAP_VEH_CLASS = (\{[\s\S]*?\});/);
  assert.ok(m, 'หา _SNAP_VEH_CLASS ใน page-snapshots.js ไม่เจอ');
  return new Function('return ' + m[1])();
})();

const art = (objectClass) => window.lprVehicleSvg(MAP[objectClass]);

describe('_SNAP_VEH_CLASS → รูปจำลองของ lpr-plaque', () => {
  it('ทุกชนิดที่อยู่ในตารางต้องเป็นคำที่ vehKind() รู้จักจริง (ไม่ตกไปเป็นรถเก๋ง)', () => {
    // car/vehicle/vehical ตั้งใจให้เป็นรถเก๋ง ที่เหลือต้องไม่ใช่
    const carArt = art('car');
    const shouldDiffer = Object.keys(MAP).filter(k => !['car', 'vehicle', 'vehical'].includes(k));
    const wrong = shouldDiffer.filter(k => art(k) === carArt);
    assert.deepEqual(wrong, [], `ชนิดเหล่านี้ยังวาดเป็นรถเก๋ง: ${wrong.join(', ')}`);
  });

  it('จักรยานยนต์ได้รูปสองล้อ ไม่ใช่รถเก๋ง', () => {
    assert.notEqual(art('motorcycle'), art('car'));
    assert.equal(art('motorcycle'), art('bicycle'), 'จักรยานใช้รูปสองล้อร่วมกัน (ไม่มีรูปของตัวเอง)');
  });

  it('รถบรรทุก รถตู้ กระบะ รถบัส ได้รูปคนละแบบกันทั้งหมด', () => {
    const kinds = ['truck', 'van', 'pickup', 'bus', 'car'];
    const arts = kinds.map(art);
    assert.equal(new Set(arts).size, kinds.length, 'มีชนิดที่วาดซ้ำกัน');
  });

  it('ภาพย่อไม่พกคำอธิบายเหตุผล — "ถูกลบตามรอบเก็บข้อมูล" อยู่ในโมดัลเท่านั้น (WA #2-D)', () => {
    const mini = SRC.match(/function _snapMiniGone[\s\S]*?\n\}/)[0];
    assert.ok(!mini.includes('imgGoneHint'), 'ภาพย่อต้องไม่มีบรรทัดเหตุผล');
    assert.ok(mini.includes('imgGoneShort'), 'ภาพย่อใช้คำสั้น snap.imgGoneShort');
  });

  it('ทุกที่ที่วาดภาพย่อ snapshot ใช้ _snapThumb — ไม่เหลือ <img> ที่ 404 แล้วโชว์ไอคอนรูปแตก', () => {
    const bare = SRC.split('\n')
      .filter(l => /<img src="\$\{API\}\/snapshots\//.test(l) && !/data-err="hide"/.test(l));
    assert.deepEqual(bare, [], 'ยังมี <img> ของ snapshot ที่ไม่ผ่าน _snapThumb');
  });
});

describe('i18n ของรูปจำลอง', () => {
  it('snap.imgGoneShort มีครบทั้ง th และ en (gotcha #42)', () => {
    const i18n = fs.readFileSync(path.join(__dirname, '../dashboard/i18n.js'), 'utf8');
    assert.equal((i18n.match(/'snap\.imgGoneShort'/g) || []).length, 2);
  });
});
