// ============================================================
// Vigil Platform — Tests: ตัวคุมชนิดไฟล์ที่อัปเข้าระบบ (magic bytes)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไมถึงมีไฟล์นี้ — reproduce แล้ว 2026-08-24:
//
//   แก้ `throw new Error('SVG format not supported')` ใน uploadMagic.js เป็น
//   `return { ext:'png', ... }` (จำลองคนแก้ตาราง magic แล้วพลาด)
//     → node --check ผ่าน
//     → npm test: 609 pass 0 fail
//     → sniffUploadType(<svg ที่มี <script>>, 'logo.svg') คืน {ext:'png'} เรียบร้อย
//   ทำแบบเดียวกันกับ imageMagic.js ได้ผลเหมือนกันเป๊ะ
//
// สองไฟล์นี้คือด่านที่ตัดสินว่าไฟล์อะไรเข้าระบบได้ (uploadMagic → POST /api/files,
// imageMagic → /api/branding/logo + รูปอ้างอิงบัญชีดำ) แต่ self-check ที่ท้ายไฟล์
// รันเฉพาะตอนสั่ง `node src/helpers/xxx.js` ตรง ๆ ซึ่งไม่มีใครทำ ตัวคุมความปลอดภัย
// จึงแก้พังได้โดยชุดเทสต์ไม่รู้เรื่องเลย
//
// ใช้ไฟล์จริงที่ track อยู่ใน repo (ตรวจ magic bytes แล้ว) ไม่เพิ่ม fixture ใหม่:
//   Region_Code.pdf 208K = 25504446 · ErrorCode.xlsx 140K = 504b0304
//   Field_Dictionary.xlsx 104K = 504b0304 · Bosch_...pptx 556K = OOXML zip จริง
// ส่วนเคสสังเคราะห์ (SVG, HTML, EXE, buffer สั้น) ประกอบ buffer ในเทสต์

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { sniffUploadType } = require('../src/helpers/uploadMagic');
const { assertImageBuffer } = require('../src/helpers/imageMagic');

const V = path.join(__dirname, '..', 'docs', 'vendor');
const read = (p) => fs.readFileSync(path.join(V, p));

const PDF = read('hikvision/Region_Code.pdf');
const XLSX = read('hikvision/ErrorCode.xlsx');
const XLSX2 = read('hikvision/Field_Dictionary.xlsx');
const PPTX = read('bosch/Bosch_CCTV_Solution_Presentation.pptx');

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><head></head><body><script>alert(1)</script></body></html>');
const NOT_HTML_JUST_MENTIONS_TAGS = Buffer.from('Please close the <door> when you leave the <house>.');
const EXE = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);

describe('uploadMagic.sniffUploadType — allowlist ของ POST /api/files', () => {
  it('ไฟล์จริงบนดิสก์ผ่านตามชนิดที่ถูกต้อง', () => {
    assert.deepEqual(sniffUploadType(PDF, 'Region_Code.pdf'), { ext: 'pdf', mime: 'application/pdf' });
    assert.equal(sniffUploadType(XLSX, 'ErrorCode.xlsx').ext, 'xlsx');
    assert.equal(sniffUploadType(PNG, 'a.png').ext, 'png');
    assert.equal(sniffUploadType(JPEG, 'a.jpg').ext, 'jpg');
    // jpeg กับ jpg เป็นลายเซ็นเดียวกัน ต้องได้ ext เดียวกันเสมอ
    assert.equal(sniffUploadType(JPEG, 'a.jpeg').ext, 'jpg');
  });

  // นี่คือข้อจำกัดที่เรารับไว้โดยตั้งใจ ไม่ใช่บั๊ก — docx/xlsx/pptx เป็น zip เหมือนกันหมด
  // magic bytes จึงพิสูจน์ได้แค่ "เป็น zip" ส่วนนามสกุลเป็นตัวเลือก "ป้ายชื่อ" เท่านั้น
  // เทสต์คู่นี้ตรึงพฤติกรรมนั้นไว้ให้ชัด ไม่ใช่กล่าวอ้างว่าเราตรวจเนื้อในได้
  it('นามสกุลเป็นตัวเลือกป้ายชื่อของ zip เท่านั้น ไม่ได้ตรวจเนื้อใน', () => {
    // xlsx จริง แต่ตั้งชื่อ .docx → ได้ป้าย docx (ระบบแยกไม่ออก และเรารู้ตัว)
    assert.equal(sniffUploadType(XLSX2, 'x.docx').ext, 'docx');
    // pptx จริง (OOXML zip แท้ ๆ) → ถูกปฏิเสธเพราะ "นามสกุลไม่อยู่ใน allowlist"
    // ไม่ใช่เพราะเราเปิด zip ดูแล้วรู้ว่าเป็น pptx
    assert.throws(() => sniffUploadType(PPTX, 'deck.pptx'), /ZIP must be \.docx or \.xlsx/);
    assert.throws(() => sniffUploadType(XLSX, 'x.zip'), /ZIP must be \.docx or \.xlsx/);
    assert.throws(() => sniffUploadType(XLSX, 'noext'), /ZIP must be \.docx or \.xlsx/);
  });

  it('ปฏิเสธไฟล์อันตรายที่ปลอมนามสกุล', () => {
    assert.throws(() => sniffUploadType(SVG, 'logo.svg'), /SVG/);
    assert.throws(() => sniffUploadType(SVG, 'logo.png'), /SVG/);      // ปลอมเป็น png ก็ไม่รอด
    assert.throws(() => sniffUploadType(EXE, 'x.docx'), /unsupported/); // MZ ไม่ใช่ zip
    assert.throws(() => sniffUploadType(Buffer.from([1, 2, 3]), 'x.png'), /too small/);
  });

  // 2026-09-24 — HTML ถูกเพิ่มเข้า allowlist ตามที่เจ้าของสั่ง (ดู helpers/htmlSanitize.js
  // สำหรับด่านความปลอดภัยจริง — sniff ตัวนี้แค่บอกว่า "หน้าตาเหมือน HTML" เฉยๆ)
  // ก่อนหน้านี้ HTML คือตัวอย่างของ "ไฟล์อันตรายที่ต้องถูกปฏิเสธเสมอ" ในเทสต์นี้ —
  // ถ้าเทสต์เก่ายังยืนยันว่า HTML ต้องโดนปฏิเสธ จะขัดกับ feature ใหม่โดยตรง จึงต้อง
  // ยืนยันพฤติกรรมใหม่ตรงนี้แทน ไม่ใช่ลบทิ้งเงียบ ๆ
  it('รับ HTML ตามชนิดเนื้อหา ไม่สนนามสกุล — และไม่รับข้อความที่แค่เอ่ยถึงแท็ก', () => {
    assert.deepEqual(sniffUploadType(HTML, 'x.jpg'), { ext: 'html', mime: 'text/html' });
    assert.equal(sniffUploadType(Buffer.from('<!DOCTYPE html><html></html>'), 'a.html').ext, 'html');
    assert.throws(() => sniffUploadType(NOT_HTML_JUST_MENTIONS_TAGS, 'note.txt'), /unsupported/);
  });

  // 2026-09-24 แผนผัง HKT อัปไม่ผ่าน: ขึ้นต้นด้วย <title> ไม่มี <html> ครอบ ·
  // และเอกสารที่มี <svg> ใน 1 KB แรกเคยโดนเหมาว่าเป็นไฟล์ SVG
  it('HTML ที่ขึ้นต้นด้วย <title>/<style> หรือมี svg ฝังช่วงต้น ผ่านเป็น html · SVG ล้วนยังโดนปฏิเสธ', () => {
    assert.equal(sniffUploadType(Buffer.from('<title>แผนผัง</title><style>p{}</style><svg></svg>'), 'a.html').ext, 'html');
    assert.equal(sniffUploadType(Buffer.from('\uFEFF  <style>p{}</style>'), 'a.html').ext, 'html');
    assert.equal(sniffUploadType(Buffer.from('<!doctype html><svg viewBox="0 0 1 1"></svg>'), 'a.html').ext, 'html');
    assert.throws(() => sniffUploadType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.html'), /SVG/);
    assert.throws(() => sniffUploadType(Buffer.from('<?xml version="1.0"?><html></html>'), 'a.html'), /SVG/);
  });

  // ชื่อไฟล์ถูกใช้เลือกป้ายชื่อเท่านั้น ห้ามหลุดไปประกอบ path — ผู้เรียก (routes/files.js)
  // สร้างชื่อที่เก็บเป็น uuid เองเสมอ เทสต์นี้ตรึงว่า sniff ไม่ปฏิเสธ/ไม่แปลง path ให้
  it('ชื่อไฟล์แบบ traversal ไม่ทำให้ผลเปลี่ยน (ชื่อไม่เคยถูกใช้เป็น path)', () => {
    assert.equal(sniffUploadType(XLSX2, '../../etc/passwd.docx').ext, 'docx');
    assert.equal(sniffUploadType(PDF, '../../../x.pdf').ext, 'pdf');
  });
});

describe('imageMagic.assertImageBuffer — /api/branding/logo + รูปอ้างอิงบัญชีดำ', () => {
  it('รูปที่รองรับผ่าน', () => {
    assert.equal(assertImageBuffer(PNG), true);
    assert.equal(assertImageBuffer(JPEG), true);
    assert.equal(assertImageBuffer(Buffer.from('RIFF\x00\x00\x00\x00WEBP')), true);
    assert.equal(assertImageBuffer(Buffer.from('GIF87a')), true);
    assert.equal(assertImageBuffer(Buffer.from('GIF89a')), true);
  });

  it('ปฏิเสธ SVG และไฟล์ที่ไม่ใช่รูป', () => {
    assert.throws(() => assertImageBuffer(SVG), /SVG format not supported/);
    assert.throws(() => assertImageBuffer(HTML), /invalid image magic bytes/);
    assert.throws(() => assertImageBuffer(PDF), /invalid image magic bytes/);
    assert.throws(() => assertImageBuffer(Buffer.from([0x89, 0x50])), /too small/);
    assert.throws(() => assertImageBuffer('ไม่ใช่ buffer'), /expected a Buffer/);
  });

  // regression ที่เคยเกิดจริงตอนต่อ /api/branding/logo — โลโก้ที่ export จาก
  // Illustrator พก XMP ที่มีทั้ง xmlns และคำว่า svg (ชื่อไฟล์ต้นฉบับ) อยู่ใน 1KB แรก
  // เวอร์ชันที่ sniff ข้อความก่อนดู magic ปฏิเสธไฟล์จริงเหล่านั้นทิ้ง
  it('รูปจริงที่พก XMP พูดถึง svg ต้องยังผ่าน', () => {
    const xmp = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
      '<dc:title>logo.svg</dc:title></x:xmpmeta>';
    assert.equal(assertImageBuffer(Buffer.concat([JPEG, Buffer.from(xmp)])), true);
    assert.equal(assertImageBuffer(Buffer.concat([PNG, Buffer.from(xmp)])), true);
  });
});
