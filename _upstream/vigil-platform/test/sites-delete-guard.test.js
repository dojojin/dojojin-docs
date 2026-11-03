// ============================================================
// Vigil Platform — Tests: DELETE /api/sites/:id guard
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// site ที่ยังมีแถวใน event_categories / report_schedules / lpr_watchlist_groups /
// face_blacklist_groups (FK NO ACTION) เคยทำให้ DELETE โยน 23503 → 500
// ตอนนี้ต้องตอบ 409 พร้อมบอกว่าอะไรยังผูกอยู่ · harness แบบเดียวกับ telegram-t4-*-route.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const sitesRoutes = require('../src/routes/sites');

function setup(pool) {
  const handlers = {};
  const app = {};
  for (const m of ['get', 'put', 'post', 'delete']) {
    app[m] = (p, ...fns) => { handlers[`${m} ${p}`] = fns[fns.length - 1]; };
  }
  sitesRoutes(app, pool, { auth: { requireAdmin: 'ADMIN' } });
  return handlers['delete /api/sites/:id'];
}

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// counts = { event_categories: 8, ... } · deleteErr = error ที่ DELETE FROM sites จะโยน
function makePool({ counts = {}, cams = 0, deleteErr = null } = {}) {
  const log = { deleted: false, audit: null };
  return {
    log,
    query: async (sql, args) => {
      if (/SELECT code FROM sites/.test(sql)) return { rowCount: 1, rows: [{ code: 'hkt' }] };
      if (/FROM cameras WHERE site_id/.test(sql)) return { rows: [{ n: cams }] };
      const m = /FROM (\w+) WHERE site_id=\$1/.exec(sql);
      if (m) return { rows: [{ n: counts[m[1]] || 0 }] };
      if (/DELETE FROM sites/.test(sql)) {
        if (deleteErr) throw deleteErr;
        log.deleted = true; return { rowCount: 1 };
      }
      if (/INSERT INTO audit_log/.test(sql)) { log.audit = args; return { rowCount: 1 }; }
      throw new Error('unhandled SQL: ' + sql);
    },
  };
}

const req = { params: { id: '7' }, user: { id: 1, username: 'admin' } };

describe('DELETE /api/sites/:id', () => {
  it('ยังมีข้อมูลผูกอยู่ → 409 + blockers เฉพาะตารางที่ไม่ว่าง และไม่ลบ', async () => {
    const pool = makePool({ counts: { event_categories: 8, report_schedules: 1 } });
    const res = fakeRes();
    await setup(pool)(req, res);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body.blockers, { event_categories: 8, report_schedules: 1 });
    assert.match(res.body.error, /หมวดเหตุการณ์ 8 · ตารางรายงาน 1$/);
    assert.equal(pool.log.deleted, false);
  });

  it('ไม่มีอะไรผูก → ลบได้ และเขียน audit_log', async () => {
    const pool = makePool();
    const res = fakeRes();
    await setup(pool)(req, res);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(pool.log.deleted, true);
    assert.equal(pool.log.audit[2], 'site_deleted');
  });

  it('FK อื่นที่ไม่อยู่ในลิสต์ (23503 ตอน DELETE) → 409 พร้อม detail ไม่ใช่ 500', async () => {
    const err = Object.assign(new Error('fk'), { code: '23503', detail: 'Key (id)=(7) is still referenced from table "x".' });
    const res = fakeRes();
    await setup(makePool({ deleteErr: err }))(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /still referenced from table "x"/);
  });
});
