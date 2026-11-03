// ============================================================
// Vigil Platform — ห้ามเขียนไฟล์ snapshot โดยไม่ตรวจว่าเป็นภาพจริง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เหตุจริง 2026-09-07 18:04 กล้อง BOSCH_3100i_02: นาทีที่กล้องถูกปิด มันยังตอบ
// HTTP 200 กลับมาแต่ body ว่าง ⇒ edge เขียนไฟล์ 0 ไบต์ แล้ว publish path นั้นให้
// central ผูกเข้า event ⇒ ระบบเชื่อว่า event มีรูป แต่หน้าเว็บขึ้น "err"
// (2 ไฟล์จาก 12 ของวันนั้น) · การตรวจ statusCode อย่างเดียวไม่พอ
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...f) => fs.readFileSync(path.join(__dirname, '..', ...f), 'utf8');

/** ตัดเอาเฉพาะตัวฟังก์ชันที่ระบุ (จนถึงบรรทัดที่คอลัมน์ 0 เริ่มบล็อกใหม่) */
function fnBody(src, header) {
  const i = src.indexOf(header);
  assert.ok(i > 0, `หาไม่เจอ: ${header}`);
  const j = src.indexOf('\nfunction ', i + header.length);
  const k = src.indexOf('\nconst ', i + header.length);
  const end = Math.min(...[j, k].filter((x) => x > 0));
  return src.slice(i, Number.isFinite(end) ? end : src.length);
}

test('edge: captureAndPublish ตรวจ magic byte ก่อนเขียนไฟล์', () => {
  const body = fnBody(read('src', 'edge-config-agent.js'), 'function captureAndPublish');
  const guard = body.indexOf('assertImageBuffer');
  const write = body.indexOf('writeFileSync');
  assert.ok(guard > 0, 'ต้องเรียก assertImageBuffer');
  assert.ok(write > 0, 'ต้องมีการเขียนไฟล์');
  assert.ok(guard < write, 'ต้องตรวจ **ก่อน** เขียน ไม่ใช่หลัง');
});

test('central: captureHttpSnapshot ตรวจ magic byte ก่อนเขียนไฟล์', () => {
  const body = fnBody(read('src', 'mqtt-subscriber.js'), 'async function captureHttpSnapshot');
  const guard = body.indexOf('assertImageBuffer');
  const write = body.indexOf('writeFileSync');
  assert.ok(guard > 0, 'ต้องเรียก assertImageBuffer');
  assert.ok(write > 0, 'ต้องมีการเขียนไฟล์');
  assert.ok(guard < write, 'ต้องตรวจ **ก่อน** เขียน ไม่ใช่หลัง');
});

test('ตัว assert เองปฏิเสธ body ว่างและหน้า HTML ที่มาพร้อม 200', () => {
  const { assertImageBuffer } = require('../src/helpers/imageMagic');
  assert.throws(() => assertImageBuffer(Buffer.alloc(0)), /too small/);
  assert.throws(() => assertImageBuffer(Buffer.from('<html>401 Unauthorized</html>')), /magic bytes/);
  assert.doesNotThrow(() => assertImageBuffer(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0])));
});
