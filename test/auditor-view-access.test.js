// ============================================================
// Vigil Platform — auditor/admin ต้องเห็นได้ทุกหน้า แม้มีรายการจำกัดค้างอยู่
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เหตุจริง 2026-09-08: บัญชี `Unlock` (id 977, role auditor) เปิดหน้าตั้งค่าไม่ได้
// ขึ้นการ์ด "อยู่ระหว่างการปรับปรุงการให้บริการ" ทั้งที่แบนเนอร์บนหัวจอเขียนว่า
// "ดูได้ทุกหน้ารวมการตั้งค่า แต่อ่านอย่างเดียว"
//
// ต้นเหตุ: บัญชีเคยเป็น viewer ที่มี allowed_views 30 รายการ · พอเลื่อนเป็น auditor
// หน้าจอผู้ใช้ **ซ่อน** ตัวเลือกนั้นไปเลย (`show = role === 'viewer'`) และไม่ยิง PUT
// ⇒ รายการเดิมค้างอยู่ใน DB แก้ผ่านหน้าจอไม่ได้อีก แต่ viewGuard ยังบังคับตามมันอยู่
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { effectiveViews, viewAllows } = require('../src/helpers/viewGuard');

// รายการจริงที่ค้างอยู่กับบัญชีนั้น (ตัดมาบางส่วน) — ไม่มี settings / health
const STALE = ['stats', 'reports', 'cameras', 'events', 'lpr', 'lpr:overview', 'map'];

describe('แกน "เห็นหน้าไหน" กับ role ที่จำกัดไม่ได้', () => {
  it('auditor ที่มีรายการค้างอยู่ = ไม่จำกัด', () => {
    assert.equal(effectiveViews({ role: 'auditor', allowed_views: STALE }), null);
  });

  it('admin ก็เช่นกัน — หน้าจอซ่อนตัวเลือกนี้ให้ทั้งสอง role', () => {
    assert.equal(effectiveViews({ role: 'admin', allowed_views: STALE }), null);
  });

  it('viewer ยังถูกจำกัดตามรายการเหมือนเดิม ห้ามหลุด', () => {
    assert.deepEqual(effectiveViews({ role: 'viewer', allowed_views: STALE }), STALE);
  });

  it('auditor เข้าเส้นทางของหน้าตั้งค่าได้ · viewer ที่มีรายการเดียวกันเข้าไม่ได้', () => {
    const stale = { allowed_views: STALE };
    assert.equal(viewAllows({ ...stale, role: 'auditor' }, '/api/settings/branding'), true);
    assert.equal(viewAllows({ ...stale, role: 'viewer' }, '/api/settings/branding'), false);
  });

  it('ผู้ใช้ที่ไม่มีรายการจำกัด (null) ยังผ่านเหมือนเดิมทุก role', () => {
    for (const role of ['viewer', 'auditor', 'admin']) {
      assert.equal(effectiveViews({ role, allowed_views: null }), null);
    }
  });
});
