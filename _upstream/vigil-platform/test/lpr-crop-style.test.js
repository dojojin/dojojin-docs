// ============================================================
// Vigil Platform — Tests: กล่องครอบตัด "ตัวรถ" ในหน้าต่างแจ้งเตือน LPR
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ตัวรถไม่มีไฟล์ครอบของตัวเอง — ต้องครอบจากภาพเต็มฉากด้วย vehicle_bbox
// สองอย่างที่พังแบบ "ดูปกติทุกประการ" และเจอตอนเรนเดอร์จริง 2026-09-09:
//
//   1) url("…") ฟันหนูคู่ → ค่านี้ไปอยู่ใน style="…" ฟันหนูตัวแรกปิด attribute
//      กลางทาง กรอบเลยว่างเปล่า ไม่มี error ไม่มีอะไรเตือน
//   2) background-size เป็น % ของ "กรอบ" ไม่ใช่ของรูป ⇒ ถ้าสัดส่วนกล่องที่ครอบ
//      ไม่เท่ากรอบ รถจะถูกยืด · กล่องของมอเตอร์ไซค์แคบและสูงมาก (83x331 ต่อพัน
//      จากกล้อง C10 ของจริง) จึงเป็นเคสที่เห็นผลชัดที่สุด
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ดึงฟังก์ชันจริงจากซอร์สของหน้าเว็บ (classic script ไม่มี module.exports)
const SRC = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-lpr.js'), 'utf8');
const CODE = SRC.match(/function _lprCropStyle\([\s\S]*?\n\}/);
assert.ok(CODE, 'ไม่เจอ _lprCropStyle ใน dashboard/page-lpr.js');
// eslint-disable-next-line no-new-func
const _lprCropStyle = new Function(`${CODE[0]}; return _lprCropStyle;`)();

/** อ่านค่ากลับจาก CSS ที่ได้ → กล่องที่ถูกครอบจริง (สัดส่วนของรูป) */
function parse(css) {
  const size = css.match(/background-size:([\d.]+)% ([\d.]+)%/);
  const pos = css.match(/background-position:([\d.]+)% ([\d.]+)%/);
  const fw = 100 / Number(size[1]), fh = 100 / Number(size[2]);
  return { fw, fh, fx: Number(pos[1]) / 100 * (1 - fw), fy: Number(pos[2]) / 100 * (1 - fh) };
}

describe('ครอบตัวรถออกจากภาพเต็มฉาก', () => {
  const IMG_AR = 1600 / 900;
  const TILE_AR = 219 / 120;      // ขนาดกรอบจริงที่วัดได้ตอนเรนเดอร์

  it('ไม่ยืดรถ — กล่องที่ครอบมีสัดส่วนเท่ากรอบเสมอ', () => {
    for (const box of [[571, 452, 83, 331], [120, 300, 400, 180], [40, 40, 60, 60]]) {
      const b = parse(_lprCropStyle('/x.jpg', box, IMG_AR, TILE_AR));
      const cropAR = (b.fw / b.fh) * IMG_AR;
      assert.ok(Math.abs(cropAR - TILE_AR) < 0.01,
        `กล่อง ${box} ได้สัดส่วน ${cropAR.toFixed(3)} ควรเป็น ${TILE_AR.toFixed(3)}`);
    }
  });

  it('กล่องที่ขยายแล้วต้องยังคลุมตัวรถทั้งคัน และไม่ล้นออกนอกรูป', () => {
    const [x, y, w, h] = [571, 452, 83, 331];
    const b = parse(_lprCropStyle('/x.jpg', [x, y, w, h], IMG_AR, TILE_AR));
    assert.ok(b.fx <= x / 1000 + 1e-6 && b.fx + b.fw >= (x + w) / 1000 - 1e-6, 'ครอบไม่ครบแนวนอน');
    assert.ok(b.fy <= y / 1000 + 1e-6 && b.fy + b.fh >= (y + h) / 1000 - 1e-6, 'ครอบไม่ครบแนวตั้ง');
    assert.ok(b.fx >= 0 && b.fy >= 0 && b.fx + b.fw <= 1.0001 && b.fy + b.fh <= 1.0001, 'ล้นออกนอกรูป');
  });

  it('รถที่ชิดขอบรูปต้องไม่ทำให้กล่องล้นออกไปนอกภาพ', () => {
    for (const box of [[0, 0, 60, 400], [940, 600, 60, 400], [0, 900, 200, 100]]) {
      const b = parse(_lprCropStyle('/x.jpg', box, IMG_AR, TILE_AR));
      assert.ok(b.fx >= -1e-6 && b.fy >= -1e-6, `กล่อง ${box} ติดลบ`);
      assert.ok(b.fx + b.fw <= 1.0001 && b.fy + b.fh <= 1.0001, `กล่อง ${box} ล้น`);
    }
  });

  // 🔴 ค่านี้ถูกวางลงใน style="…" — ฟันหนูคู่จะปิด attribute กลางทางแบบเงียบ ๆ
  it('ต้องใช้ url() ฟันหนูเดี่ยว ห้ามมีฟันหนูคู่ในค่าที่คืน', () => {
    const css = _lprCropStyle('/snapshots/a.jpg?w=960', [100, 100, 200, 200], IMG_AR, TILE_AR);
    assert.match(css, /url\('\/snapshots\/a\.jpg\?w=960'\)/);
    assert.ok(!css.includes('"'), 'มีฟันหนูคู่ปนมา');
  });
});
