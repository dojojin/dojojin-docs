// ============================================================
// Vigil Platform — validation ของ PUT /api/sites/order
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// endpoint นี้เขียนทับ sort_order ของ "ทุกแถว" ในครั้งเดียว · ถ้า validation หลุด
// รายการที่ส่งมาไม่ครบจะทำให้ site ที่ขาดไปตกไปอยู่ท้ายลำดับของทุกคนเงียบ ๆ
// จุดที่ต้องตรึงที่สุดคือ "เทียบกับทุก site ในตาราง ไม่ใช่ที่ผู้เรียกมองเห็น"
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { _validateOrderShape, _validateOrderSet } = require('../src/routes/sites.js');

test('PUT /api/sites/order — validation', async (t) => {
  await t.test('รูปร่างที่ถูกต้องผ่าน', () => {
    assert.strictEqual(_validateOrderShape([1, 2, 3]), null);
  });

  await t.test('ปฏิเสธของที่ไม่ใช่ array หรือ array ว่าง', () => {
    assert.ok(_validateOrderShape(undefined));
    assert.ok(_validateOrderShape('1,2,3'));
    assert.ok(_validateOrderShape([]));
  });

  await t.test('ปฏิเสธค่าที่ไม่ใช่จำนวนเต็ม', () => {
    assert.ok(_validateOrderShape([1, '2']));
    assert.ok(_validateOrderShape([1, 2.5]));
    assert.ok(_validateOrderShape([1, null]));
  });

  await t.test('ปฏิเสธ id ซ้ำ — ไม่งั้นบางแถวจะไม่ถูกเขียนเลย', () => {
    assert.ok(_validateOrderShape([1, 2, 2]));
  });

  await t.test('ครบทุก site ผ่าน ไม่สนลำดับที่อ่านมาจาก DB', () => {
    assert.strictEqual(_validateOrderSet([3, 1, 2], [1, 2, 3]), null);
  });

  await t.test('🔴 รายการไม่ครบต้องถูกปฏิเสธ (admin ที่ถูกจำกัด allowedSites)', () => {
    // GET /api/sites คืน subset ให้ admin ที่ถูกจำกัด ถ้าเรารับ subset นั้น
    // site ที่เหลือจะหลุดจากลำดับของทุกคน
    assert.ok(_validateOrderSet([1, 2], [1, 2, 3]));
  });

  await t.test('id ที่ไม่มีอยู่จริงต้องถูกปฏิเสธ', () => {
    assert.ok(_validateOrderSet([1, 2, 99], [1, 2, 3]));
  });

  await t.test('จำนวนเท่ากันแต่คนละชุด ต้องถูกปฏิเสธ', () => {
    assert.ok(_validateOrderSet([1, 2, 4], [1, 2, 3]));
  });
});
