// ============================================================
// Vigil Platform — Tests: scope cache key (scopeCacheKey)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// `siteWhere()` กรองด้วยทั้ง Site และ `cameras` (แกนที่ 2, decision #253) แต่ cache key
// ที่เขียนเองมักมีแค่ Site → คนที่ถูกจำกัด 4 กล้อง กับคนที่เห็น 84 กล้องใน Site เดียวกัน
// (site 18/20 ของจริง) ใช้ entry เดียวกัน = ข้อมูลรั่วข้ามสิทธิ์เงียบ ๆ
// เทสต์ชุดนี้ล็อกไว้ว่า key ต้องแยกตามกล้องด้วยเสมอ

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeScope, scopeCacheKey } = require('../src/auth');

describe('scopeCacheKey', () => {
  it('Site เดียวกัน กล้องคนละชุด → key ต้องต่างกัน (บั๊กที่ helper นี้มีไว้กัน)', () => {
    const many = makeScope([18], ['cam-a', 'cam-b', 'cam-c']);
    const few  = makeScope([18], ['cam-a']);
    assert.notEqual(scopeCacheKey(many), scopeCacheKey(few));
  });

  it('Site เดียวกัน กล้องชุดเดียวกันแต่คนละลำดับ → key ต้องเท่ากัน', () => {
    assert.equal(
      scopeCacheKey(makeScope([18, 14], ['cam-b', 'cam-a'])),
      scopeCacheKey(makeScope([14, 18], ['cam-a', 'cam-b'])),
    );
  });

  it('null / undefined = ไม่จำกัด → "all"', () => {
    assert.equal(scopeCacheKey(null), 'all');
    assert.equal(scopeCacheKey(undefined), 'all');
  });

  it('ไม่จำกัดรายกล้อง → ลงท้ายด้วย "|*"', () => {
    assert.equal(scopeCacheKey(makeScope([18, 14], null)), '14,18|*');
  });

  it('ไม่มี Site เลย → "none|..." (ไม่ใช่สตริงว่างที่ไปชนกับ key อื่น)', () => {
    assert.equal(scopeCacheKey(makeScope([], null)), 'none|*');
    assert.equal(scopeCacheKey(makeScope([], [])), 'none|none');
  });

  it('เรียงเลข Site แบบตัวเลข ไม่ใช่ตัวอักษร', () => {
    assert.equal(scopeCacheKey(makeScope([20, 3, 18], null)), '3,18,20|*');
  });

  it('array ธรรมดา (ไม่มี cameras) → "*" ตรงกับที่ siteWhere() ทำกับ array แบบนั้น', () => {
    assert.equal(scopeCacheKey([18]), '18|*');
  });

  it('`[...scope]` ทำ cameras หาย → key ต้องไม่เท่าของเดิม (footgun decision #253)', () => {
    const scope = makeScope([18], ['cam-a']);
    assert.notEqual(scopeCacheKey([...scope]), scopeCacheKey(scope));
    assert.equal(scopeCacheKey([...scope]), '18|*', 'copy ที่ลืม cameras = key ของคนเห็นทุกกล้อง');
  });

  it('pure — ไม่แก้ scope ที่รับเข้ามา', () => {
    const scope = makeScope([20, 3], ['cam-b', 'cam-a']);
    scopeCacheKey(scope);
    assert.deepEqual([...scope], [20, 3]);
    assert.deepEqual(scope.cameras, ['cam-b', 'cam-a']);
  });
});
