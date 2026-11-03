// ============================================================
// Vigil Platform — Tests: truck-ban ranking · plate · buckets outside · PDF routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// อันดับ/KPI ย้ายจากหน้าเว็บมานับที่เซิร์ฟเวอร์ (2026-11-02) · pool ปลอม ไม่แตะ DB จริง · renderer ถูกแทน (ไม่เปิด Puppeteer)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const reportRenderer = require('../src/report-renderer');
const { registerPlateHistoryAndMismatch } = require('../src/routes/lpr-list');

function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {}, writableFinished: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.writableFinished = true; return r; };
  r.send = (b) => { r.body = b; r.writableFinished = true; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.on = () => {};
  return r;
}
// planRow = แถวที่คิวรีหลัก (license_plates) ตอบ · ตารางเล็กอื่นตอบว่าง
function setup(planRows = []) {
  const h = {};
  const app = { get: (p, fn) => { h[p] = fn; }, post: () => {}, delete: () => {} };
  const calls = [];
  const client = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: /FROM license_plates lp/.test(sql) ? planRows : [] }; }, release: () => {} };
  const pool = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (/FROM cameras c JOIN sites s/.test(sql)) return { rows: [{ id: 'C1' }, { id: 'C2' }] };
      return { rows: [] };
    },
    connect: async () => client,
  };
  registerPlateHistoryAndMismatch(app, pool);
  return { h, calls };
}
const main = (calls) => calls.find((c) => /FROM license_plates lp/.test(c.sql));
const admin = { role: 'admin' };
const R = '/api/lpr/truck-ban/ranking';

describe('GET /api/lpr/truck-ban/ranking', () => {
  it('400 on impossible / malformed days and on more than 400 days, before any DB call', async () => {
    const many = Array.from({ length: 401 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)).join(',');
    for (const days of ['2026-02-30', '2026-13-01', '26-10-2026', '2026-10-22,x', many]) {
      const { h, calls } = setup();
      const res = fakeRes();
      await h[R]({ query: { days }, user: admin }, res);
      assert.equal(res.statusCode, 400, days.slice(0, 30));
      assert.equal(calls.length, 0);
    }
  });

  it('dedupes + sorts days, builds the two ban windows per day with LATERAL, passes cams/q/limit', async () => {
    const { h, calls } = setup([{ violations: 5, plates: 3, repeaters: 1, max_per_plate: 3, peak: { b: 17, n: 2 },
      groups: [{ n: 3, plates: 1 }, { n: 1, plates: 2 }], cam_plates: [{ id: 'C1', plates: 3 }],
      list: [{ plate: '813085', n: 3, last: '2026-10-30T09:19:35Z', cams: ['C1'], region: 'ภูเก็ต' }], oldest: '2026-07-29' }]);
    const res = fakeRes();
    await h[R]({ query: { days: '2026-10-30,2026-10-28,2026-10-30', cameras: 'C2', q: '81-3', limit: '99999' }, user: admin }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.kpis, { violations: 5, plates: 3, repeaters: 1, max_per_plate: 3, peak: { bucket: '08:30', n: 2 } });
    assert.equal(res.body.oldest, '2026-07-29');
    assert.equal(res.body.rows[0].plate, '813085');
    const q = main(calls);
    // $1 = กล้อง LPR ทั้งไซต์ (นับ cam_plates ข้ามตัวเลือก) · $5 days · $6 กล้องที่เลือก · $7 ตัวเลขที่ค้น · $8 เพดาน 2000
    assert.deepEqual(q.args.slice(0, 8), [['C1', 'C2'], ['truck'], '2026-10-27T17:00:00.000Z', '2026-10-30T17:00:00.000Z',
      ['2026-10-28', '2026-10-30'], ['C2'], '813', 2000]);
    assert.match(q.sql, /unnest\(\$5::date\[\]\)/);
    assert.match(q.sql, /time '06:00', time '09:00'/);
    assert.match(q.sql, /time '16:00', time '19:00'/);
    assert.match(q.sql, /CROSS JOIN LATERAL/);
    assert.match(q.sql, /lp\.detected_at >= w\.a AND lp\.detected_at < w\.b/);
    assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM truck_ban_rejections/);
    assert.match(q.sql, /GROUP BY 1, 2, 3/, 'one violation = plate × day × window');
  });

  it('empty days = zero KPIs (oldest still asked for the all-time button)', async () => {
    const { h, calls } = setup([{ violations: 0, plates: 0, repeaters: 0, max_per_plate: 0, peak: null, groups: [], cam_plates: [], list: [], oldest: '2026-07-29' }]);
    const res = fakeRes();
    await h[R]({ query: {}, user: admin }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.kpis.violations, 0);
    assert.equal(res.body.kpis.peak, null);
    assert.equal(res.body.oldest, '2026-07-29');
    assert.deepEqual(main(calls).args[4], []);
  });
});

describe('GET /api/lpr/truck-ban/plate/:plate', () => {
  const P = '/api/lpr/truck-ban/plate/:plate';
  it('only truck-category plates (not a general plate lookup)', async () => {
    for (const plate of ['กข1234', '412345', '81234', '81234567']) {
      const { h, calls } = setup();
      const res = fakeRes();
      await h[P]({ params: { plate }, query: { days: '2026-10-30' }, user: admin }, res);
      assert.equal(res.statusCode, 400, plate);
      assert.equal(calls.length, 0);
    }
  });
  it('reads of that plate inside the ban windows, without rawXml', async () => {
    const { h, calls } = setup([{ day: '2026-10-30', win: 'am', plate_number: '813085' }]);
    const res = fakeRes();
    await h[P]({ params: { plate: '813085' }, query: { days: '2026-10-30' }, user: { role: 'viewer' } }, res);
    assert.deepEqual(res.body, [{ day: '2026-10-30', win: 'am', plate_number: '813085' }]);
    const q = main(calls);
    assert.equal(q.args[5], '813085');
    assert.match(q.sql, /lp\.plate_number = \$6/);
    assert.match(q.sql, /jsonb_build_object\('plateColor'/);
    assert.doesNotMatch(q.sql, /e\.raw_json AS raw_json|rawXml/);
  });
});

describe('GET /api/lpr/truck-ban/buckets — outside', () => {
  it('returns distinct plates outside the ban windows next to all/ban', async () => {
    const { h, calls } = setup([{ k: 'all', b: null, n: 1960 }, { k: 'ban', b: null, n: 672 }, { k: 'out', b: null, n: 1641 }]);
    const res = fakeRes();
    await h['/api/lpr/truck-ban/buckets']({ query: { day: '2026-10-30' }, user: admin }, res);
    assert.equal(res.body.all, 1960);
    assert.equal(res.body.ban, 672);
    assert.equal(res.body.outside, 1641);
    assert.match(main(calls).sql, /h NOT IN \(6, 7, 8, 16, 17, 18\)/);
  });
});

describe('truck-ban PDF routes', () => {
  function stubRenderers(t) {
    const seen = {};
    for (const k of ['renderTruckBanTopPdf', 'renderTruckBanTablePdf', 'renderNoticePdf']) {
      t.mock.method(reportRenderer, k, async (o) => { seen[k] = o; return Buffer.from('%PDF-' + k); });
    }
    return seen;
  }
  it('400 without days or with bad days', async (t) => {
    stubRenderers(t);
    for (const query of [{}, { days: '2026-02-30' }]) {
      const { h, calls } = setup();
      const res = fakeRes();
      await h['/api/lpr/truck-ban/report.pdf']({ query, user: admin }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(calls.length, 0);
    }
  });
  it('no rows → notice PDF with truck-ban heading, never cached', async (t) => {
    const seen = stubRenderers(t);
    const { h } = setup([{ violations: 0, plates: 0, repeaters: 0, max_per_plate: 0, peak: null, groups: [], cam_plates: [], list: [], oldest: null }]);
    const res = fakeRes();
    await h['/api/lpr/truck-ban/report-table.pdf']({ query: { days: '2026-10-30', mode: 'text' }, user: admin }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.match(res.headers['Cache-Control'], /no-store/);
    assert.equal(seen.renderNoticePdf.heading, 'รายงานรถบรรทุกวิ่งในช่วงห้าม');
    assert.equal(seen.renderTruckBanTablePdf, undefined);
  });
  it('text table = every plate in the top 10 count-ranks, total from the full histogram', async (t) => {
    const seen = stubRenderers(t);
    const list = [{ plate: '813085', n: 3, last: '2026-10-30T09:00:00Z', cams: ['C1'], region: 'ภูเก็ต' },
      { plate: '712345', n: 1, last: '2026-10-30T02:00:00Z', cams: ['C2'], region: null }];
    const { h } = setup([{ violations: 4, plates: 2, repeaters: 1, max_per_plate: 3, peak: { b: 12, n: 2 },
      groups: [{ n: 3, plates: 1 }, { n: 1, plates: 5 }], cam_plates: [], list, oldest: null }]);
    const res = fakeRes();
    await h['/api/lpr/truck-ban/report-table.pdf']({ query: { days: '2026-10-30', mode: 'text' }, user: admin }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(String(res.body), '%PDF-renderTruckBanTablePdf');
    const o = seen.renderTruckBanTablePdf;
    assert.deepEqual(o.rows.map((r) => r.plate), ['813085', '712345']);
    assert.equal(o.total, 6);
    assert.equal(o.withImages, false);
    assert.match(o.criteriaNote, /06:00–09:00 และ 16:00–19:00/);
    assert.match(res.headers['Content-Disposition'], /truck-ban-table-text/);
  });
});
