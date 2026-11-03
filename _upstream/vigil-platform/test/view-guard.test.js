// ============================================================
// Vigil Platform — Tests: view guard (allowlist, default-deny)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { viewGuard, viewAllows } = require('../src/helpers/viewGuard');

function fakeRes() {
  return {
    code: null, body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const guardWith = (deps = {}) => viewGuard({
  auth: { getUserFromToken: async () => null },
  getSessionToken: () => null,
  isValidInternalToken: () => false,
  ...deps,
});

async function run(guard, req) {
  const res = fakeRes();
  let passed = false;
  await guard(req, res, () => { passed = true; });
  return { passed, res };
}

describe('viewGuard', () => {
  it('allowed_views = null → ผ่านทุก path (ผู้ใช้เดิมทุกคนไม่กระทบ)', async () => {
    const g = guardWith();
    const r = await run(g, { user: { allowed_views: null }, originalUrl: '/api/users' });
    assert.equal(r.passed, true);
  });

  it('มีสิทธิ์เฉพาะแท็บ → ยิง endpoint ของแท็บอื่นในหน้าเดียวกันไม่ได้', async () => {
    const g = guardWith();
    const user = { allowed_views: ['traffic:helmet'] };
    assert.equal((await run(g, { user, originalUrl: '/api/traffic/helmet-series?date=x' })).passed, true);
    const blocked = await run(g, { user, originalUrl: '/api/traffic/enforcement?days=7' });
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.code, 403);
    assert.equal(blocked.res.body.code, 'VIEW_NOT_ALLOWED');
  });

  it('`/api/cameras` ใน CORE ต้องไม่แจก `/api/cameras/status-log` ให้ด้วย', async () => {
    const g = guardWith();
    const user = { allowed_views: ['traffic:helmet'] };
    assert.equal((await run(g, { user, originalUrl: '/api/cameras' })).passed, true);
    assert.equal((await run(g, { user, originalUrl: '/api/cameras/status-log' })).passed, false);
  });

  it('allowed_views = [] → เหลือแค่ CORE (ยัง logout/เปลี่ยนรหัสได้ ไม่ล็อกตัวเองออก)', async () => {
    const g = guardWith();
    const user = { allowed_views: [] };
    assert.equal((await run(g, { user, originalUrl: '/api/auth/logout' })).passed, true);
    assert.equal((await run(g, { user, originalUrl: '/api/views' })).passed, true);
    assert.equal((await run(g, { user, originalUrl: '/api/events' })).passed, false);
  });

  it('internal token (report renderer) ผ่านเสมอ ไม่มี user ก็ไม่พัง', async () => {
    const g = guardWith({ isValidInternalToken: () => true });
    assert.equal((await run(g, { originalUrl: '/api/stats/heatmap' })).passed, true);
    const g2 = guardWith();
    assert.equal((await run(g2, { internal: true, originalUrl: '/api/stats/heatmap' })).passed, true);
  });

  it('ยังไม่ล็อกอิน → ปล่อยผ่านให้ auth guard เดิมเป็นคนตอบ 401 (ไม่กลืน error เป็น 403)', async () => {
    const g = guardWith();
    assert.equal((await run(g, { originalUrl: '/api/events' })).passed, true);
  });

  it('ตัดสินสิทธิ์ไม่ได้ = ปฏิเสธไว้ก่อน (fail closed)', async () => {
    const g = guardWith({
      getSessionToken: () => 'tok',
      auth: { getUserFromToken: async () => { throw new Error('db down'); } },
    });
    const r = await run(g, { originalUrl: '/api/events' });
    assert.equal(r.passed, false);
    assert.equal(r.res.code, 403);
  });

  it('allowed_views ที่ไม่ใช่ array (ข้อมูลเพี้ยน) = ปฏิเสธ ไม่ใช่ปล่อยผ่าน', async () => {
    const g = guardWith();
    const r = await run(g, { user: { allowed_views: 'traffic' }, originalUrl: '/api/events' });
    assert.equal(r.passed, false);
  });
});

describe('viewAllows — ใช้กับ /snapshots และ /media ที่อยู่นอก /api', () => {
  it('หน้าที่ต้องใช้ภาพได้ภาพ · หน้าที่ไม่ต้องใช้ไม่ได้', () => {
    const p = '/snapshots/events/2026-08-11/cam1/1600/x.jpg';
    assert.equal(viewAllows({ allowed_views: ['events'] }, p), true);
    assert.equal(viewAllows({ allowed_views: ['traffic:helmet'] }, p), false);
    assert.equal(viewAllows({ allowed_views: null }, p), true);
    assert.equal(viewAllows({ allowed_views: [] }, p), false);
  });

  it('user ที่ไม่มีข้อมูลสิทธิ์ (undefined) = ไม่จำกัด — ตรงกับ semantics ของ NULL', () => {
    assert.equal(viewAllows({}, '/snapshots/a/b/c/d/e.jpg'), true);
  });
});
