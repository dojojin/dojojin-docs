// ============================================================
// Vigil Platform — Partner API cursor codec test
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CP3 (2026-08-08) ทำให้รูปแบบ cursor เป็นสัญญาที่เปลี่ยนไม่ได้โดยไม่ขึ้น /v2
// เทสต์นี้จึงล็อก "รูปร่าง" ไว้ ไม่ใช่แค่ล็อกว่า round-trip ได้ — ถ้าใครเผลอ
// เปลี่ยนชื่อฟิลด์หรือถอด v ออก ต้องแดงตรงนี้ก่อนไปโผล่ที่ partner
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { CURSOR_VERSION, encodeCursor, decodeCursor } = require('../src/helpers/partnerCursor');

const open = (c) => JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));

test('รูปร่างที่ประกาศไว้ในเอกสาร = ของที่ออกมาจริง', () => {
  const c = open(encodeCursor('2026-08-08 03:52:04.443+00', 10762123));
  assert.deepStrictEqual(c, { v: 1, t: '2026-08-08 03:52:04.443+00', i: '10762123' });
  assert.strictEqual(CURSOR_VERSION, 1);
});

test('timestamp ต้องออกมาเป็น string เดิมเป๊ะ ไม่ผ่าน Date', () => {
  // ไมโครวินาที: appearances เก็บ 6 ตำแหน่ง ถ้าวิ่งผ่าน Date จะเหลือ 3 แล้ว
  // cursor จะตกไป *ก่อน* แถวที่สร้างมันขึ้นมา → ส่งแถวเดิมซ้ำทุกหน้า
  const micro = '2026-08-07 07:13:13.735099+00';
  assert.strictEqual(decodeCursor(encodeCursor(micro, 1)).t, micro);
});

test('cursor รุ่นเก่าที่ยังไม่มี v ต้องใช้ได้ต่อ', () => {
  const legacy = Buffer.from(JSON.stringify({ t: '2026-08-08 00:00:00+00', i: '5' })).toString('base64url');
  assert.deepStrictEqual(decodeCursor(legacy), { t: '2026-08-08 00:00:00+00', i: '5' });
});

test('v ที่ไม่รู้จักต้องถูกปฏิเสธ ไม่ใช่ตีความมั่ว', () => {
  // เกิดได้ตอน deploy ไม่พร้อมกัน — ตีความผิดแล้วจะข้ามแถวไปเงียบ ๆ
  const future = Buffer.from(JSON.stringify({ v: 2, t: null, i: '5' })).toString('base64url');
  assert.strictEqual(decodeCursor(future), null);
});

test('ขยะทุกแบบต้องได้ null ไม่ใช่ throw', () => {
  for (const bad of ['', 'ไม่ใช่ base64', Buffer.from('{').toString('base64url'),
    Buffer.from(JSON.stringify({ i: 5 })).toString('base64url'),          // i ไม่ใช่ string
    Buffer.from(JSON.stringify({ i: '' })).toString('base64url'),         // i ว่าง
    Buffer.from(JSON.stringify({ i: 'x'.repeat(65) })).toString('base64url'),
    Buffer.from(JSON.stringify({ t: 'ไม่ใช่เวลา', i: '5' })).toString('base64url')]) {
    assert.strictEqual(decodeCursor(bad), null, `ควรได้ null: ${bad}`);
  }
});

test('id ที่ไม่ใช่ตัวเลขก็ต้องผ่าน (camera_id เป็นข้อความ)', () => {
  assert.strictEqual(decodeCursor(encodeCursor(null, 'C30-KAR-SB-15')).i, 'C30-KAR-SB-15');
});
