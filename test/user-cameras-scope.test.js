// ============================================================
// Vigil Platform — Tests: per-user camera scope (user_cameras)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แกนที่ 2 ของสิทธิ์ (decision #253) เดินทางไปกับ `allowedSites` ในรูป property
// `cameras` ที่ไม่ enumerable — วิธีนี้ทำให้ call site เดิม 66 จุดไม่ต้องแก้เลย
// แต่ก็แปลว่า **ถ้ามีใคร copy array นั้นเองโดยไม่ผ่าน makeScope() การจำกัดรายกล้อง
// จะหายเงียบๆ** เทสต์ชุดนี้ล็อกพฤติกรรมนั้นไว้

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeScope, siteWhere, resolveSiteScope } = require('../src/auth');

describe('makeScope', () => {
  it('ยังเป็น array ปกติ — .length และการส่งเข้า ANY($n) ทำงานเหมือนเดิม', () => {
    const s = makeScope([1, 2], ['cam-a']);
    assert.ok(Array.isArray(s));
    assert.equal(s.length, 2);
    assert.deepEqual([...s], [1, 2]);
  });

  it('`cameras` ไม่ enumerable — JSON/spread ของ array ไม่มีมันปน', () => {
    const s = makeScope([1], ['cam-a']);
    assert.equal(JSON.stringify(s), '[1]');
    assert.deepEqual(Object.keys(s), ['0']);
    assert.deepEqual(s.cameras, ['cam-a']);
  });

  it('null = ไม่จำกัด', () => assert.equal(makeScope(null, ['x']), null));
});

describe('siteWhere — แกน Site × แกนกล้อง', () => {
  it('ไม่จำกัดอะไรเลย → ไม่มี SQL เพิ่ม', () => {
    assert.deepEqual(siteWhere(null, 'e.camera_id', 1), { sql: '', args: [] });
  });

  it('ไม่มี Site เลย → AND FALSE (fail closed)', () => {
    assert.deepEqual(siteWhere(makeScope([], null), 'e.camera_id', 1), { sql: 'AND FALSE', args: [] });
  });

  it('มี Site ไม่จำกัดกล้อง → เหมือนเดิมทุกประการ 1 พารามิเตอร์', () => {
    const r = siteWhere(makeScope([18], null), 'e.camera_id', 5);
    assert.equal(r.args.length, 1);
    assert.match(r.sql, /site_id = ANY\(\$5\)/);
    assert.ok(!r.sql.includes('id = ANY($6)'));
  });

  it('จำกัดกล้องด้วย → เพิ่มอีก 1 พารามิเตอร์ ต่อจาก offset ที่ให้มา', () => {
    const r = siteWhere(makeScope([18], ['cam-a', 'cam-b']), 'e.camera_id', 5);
    assert.equal(r.args.length, 2);
    assert.deepEqual(r.args[0], [18]);
    assert.deepEqual(r.args[1], ['cam-a', 'cam-b']);
    assert.match(r.sql, /site_id = ANY\(\$5\) AND id = ANY\(\$6\)/);
  });

  it('กล้องต้องตัดกับ Site เสมอ — user_cameras ใช้แหกกรอบ Site ไม่ได้', () => {
    const r = siteWhere(makeScope([18], ['cam-of-other-site']), 'e.camera_id', 1);
    // เงื่อนไข site_id ยังอยู่คู่กับเงื่อนไขกล้องเสมอ ไม่ได้ถูกแทนที่
    assert.match(r.sql, /site_id = ANY\(\$1\)/);
    assert.match(r.sql, /AND id = ANY\(\$2\)/);
  });

  it('array ที่ไม่ได้สร้างจาก makeScope → ไม่มีการจำกัดกล้อง (รู้ตัวไว้)', () => {
    const r = siteWhere([18], 'e.camera_id', 1);
    assert.equal(r.args.length, 1);
  });
});

describe('resolveSiteScope — ต้องหอบ cameras ต่อทุกกิ่ง', () => {
  const req = (allowedSites, allowedCameras, siteId) => ({
    user: { allowedSites, allowedCameras },
    query: siteId ? { site_id: String(siteId) } : {},
  });

  it('ไม่มี ?site_id= → คงทั้ง Site และกล้อง', () => {
    const s = resolveSiteScope(req(makeScope([18, 14], ['cam-a']), ['cam-a']));
    assert.deepEqual([...s], [18, 14]);
    assert.deepEqual(s.cameras, ['cam-a']);
  });

  it('เลือก Site ที่ตัวเองมีสิทธิ์ → แคบลงเหลือ Site นั้น แต่กล้องยังถูกจำกัดอยู่', () => {
    const s = resolveSiteScope(req(makeScope([18, 14], ['cam-a']), ['cam-a'], 18));
    assert.deepEqual([...s], [18]);
    assert.deepEqual(s.cameras, ['cam-a'], 'กิ่งนี้สร้าง array ใหม่ — เคยทำ cameras หาย');
  });

  it('เลือก Site ที่ไม่มีสิทธิ์ → ว่าง (fail closed) และยังคง cameras ไว้', () => {
    const s = resolveSiteScope(req(makeScope([18], ['cam-a']), ['cam-a'], 99));
    assert.equal(s.length, 0);
    assert.deepEqual(s.cameras, ['cam-a']);
  });

  it('admin (allowedSites=null) เลือก Site → ได้ Site นั้น ไม่มีการจำกัดกล้อง', () => {
    const s = resolveSiteScope(req(null, null, 7));
    assert.deepEqual([...s], [7]);
    assert.equal(s.cameras, null);
  });

  it('admin ไม่เลือกอะไร → null เหมือนเดิม', () => {
    assert.equal(resolveSiteScope(req(null, null)), null);
  });
});
