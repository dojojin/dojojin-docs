// ============================================================
// Vigil Platform — Tests: last_event_at ต้องถูกเขียนจริง ไม่ใช่แค่มีอยู่ใน SET
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา 2026-09-12: ตอนไล่หาว่า "ทำไมไม่มีใครรู้ว่ากล้อง 4 ตัวที่ภูเก็ตหยุดส่งข้อมูล
// 8 ชั่วโมง" พบว่า cameras.last_event_at ซึ่งควรเป็น "สัญญาณข้อมูลจริง" มีค่าอยู่แค่
// 2 จาก 169 แถว และค่าใหม่สุดค้างที่ 2026-08-17
//
// สาเหตุ: WHERE กรองด้วย last_seen_at คอลัมน์เดียว · ผู้เรียกที่ส่ง event:true มา
// ทีหลังภายใน 30 วินาที จะหลุดเงื่อนไขทั้งแถว ⇒ SET ที่เขียนไว้ถูกต้องแต่ไม่เคยทำงาน
// บั๊กแบบนี้เงียบสนิท: ไม่มี error ไม่มี log มีแต่คอลัมน์ที่ค่อย ๆ ตายไป
//
// เทสต์ยิงคิวรีเข้า pool ปลอมแล้วอ่าน SQL ที่ได้ — ไม่ต้องมี Postgres

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { touchCamera, TOUCH_EVERY_SEC } = require('../src/helpers/touchCamera');

// pool ปลอม: เก็บคิวรีล่าสุดไว้ให้ตรวจ
function fakePool() {
  const calls = [];
  return {
    calls,
    query(sql, params) { calls.push({ sql, params }); return Promise.resolve({ rowCount: 1 }); },
  };
}

const sqlOf = (p) => p.calls[0].sql.replace(/\s+/g, ' ').trim();

describe('touchCamera — คาบของแต่ละคอลัมน์', () => {
  it('แบบมี event เขียนทั้งสองคอลัมน์ และคาบต้องคิด last_event_at ด้วย', async () => {
    const p = fakePool();
    await touchCamera(p, 'C9-KAR-SB-04', { event: true });
    const sql = sqlOf(p);
    assert.match(sql, /last_event_at = NOW\(\)/, 'ต้องเขียน last_event_at');
    assert.match(sql, /last_event_at <\s*NOW\(\)/,
      'WHERE ต้องมีเงื่อนไขของ last_event_at ไม่งั้นแถวหลุดเพราะ last_seen_at สด');
    assert.match(sql, /last_seen_at <\s*NOW\(\)/, 'และต้องยังยอมเขียนเมื่อ last_seen_at เก่าด้วย');
    assert.match(sql, /OR/, 'สองเงื่อนไขต่อกันด้วย OR — เก่าอันไหนก็ควรได้เขียน');
  });

  it('แบบไม่มี event ไม่แตะ last_event_at เลย ทั้งใน SET และ WHERE', async () => {
    const p = fakePool();
    await touchCamera(p, 'C9-KAR-SB-04');
    const sql = sqlOf(p);
    assert.equal(/last_event_at/.test(sql), false,
      'การติดต่อเฉย ๆ ห้ามทำให้ last_event_at ขยับ ไม่งั้นมันก็เป็น last_seen_at ตัวที่สอง');
  });

  it('ยังส่งคาบเป็นพารามิเตอร์ ไม่ใช่ต่อสตริงเข้า SQL', async () => {
    const p = fakePool();
    await touchCamera(p, 'C9-KAR-SB-04', { event: true });
    assert.deepEqual(p.calls[0].params, ['C9-KAR-SB-04', String(TOUCH_EVERY_SEC)]);
    // คาบเดียวกันต้องถูกใช้กับทั้งสองเงื่อนไข — $2 จึงต้องโผล่สองครั้ง
    assert.equal((sqlOf(p).match(/\$2/g) || []).length, 2);
  });

  it('ไม่มี cameraId = ไม่ยิงคิวรี (ingest path ห้ามพังเพราะการประทับเวลา)', async () => {
    const p = fakePool();
    await touchCamera(p, null, { event: true });
    assert.equal(p.calls.length, 0);
  });

  it('คิวรีล้มก็ไม่ throw', async () => {
    const p = { query: () => Promise.reject(new Error('DB ล้ม')) };
    await touchCamera(p, 'C9-KAR-SB-04', { event: true });  // ต้องไม่โยนออกมา
  });

  it('ยังกรองที่ WHERE เสมอ — ห้ามย้ายไปเช็คในโปรเซส (หลาย service แตะกล้องตัวเดียวกัน)', async () => {
    const p = fakePool();
    await touchCamera(p, 'C9-KAR-SB-04', { event: true });
    assert.match(sqlOf(p), /^UPDATE cameras SET .* WHERE id = \$1 AND /);
  });
});
