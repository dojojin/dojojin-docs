// ============================================================
// Vigil Platform — Tests: truck-ban plate rejections (Reject = ไม่ต้องแจ้งป้ายนี้อีก)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// GET อ่านได้ทุกคนที่เห็นหน้า LPR · POST/DELETE เฉพาะ admin/site_admin (viewer กดแล้วป้ายหายจากรายการของทุกคน)
// pool ปลอม — ไม่แตะ DB จริง
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { registerPlateHistoryAndMismatch } = require('../src/routes/lpr-list');

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function setup() {
  const h = { get: {}, post: {}, delete: {} };
  const app = { get: (p, fn) => { h.get[p] = fn; }, post: (p, fn) => { h.post[p] = fn; }, delete: (p, fn) => { h.delete[p] = fn; } };
  const calls = [];
  const pool = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (/^INSERT INTO truck_ban_rejections/.test(sql.trim())) {
      return { rows: [{ plate_number: args[0], kind: args[1], reason: args[2], rejected_by: args[3], rejected_at: '2026-10-26T09:00:00Z' }] };
    }
    return { rows: [] };
  } };
  registerPlateHistoryAndMismatch(app, pool);
  return { h, calls };
}
const P = '/api/lpr/truck-ban/rejections/:plate';

describe('truck-ban rejections', () => {
  it('viewer cannot reject or restore (403) and nothing is written', async () => {
    const { h, calls } = setup();
    for (const m of ['post', 'delete']) {
      const res = fakeRes();
      await h[m][P]({ params: { plate: '807104' }, body: {}, user: { role: 'viewer', username: 'v' } }, res);
      assert.equal(res.statusCode, 403);
    }
    assert.equal(calls.filter((c) => /truck_ban_rejections/.test(c.sql)).length, 0);
  });

  it('admin rejects a plate with who and why (upsert)', async () => {
    const { h, calls } = setup();
    const res = fakeRes();
    await h.post[P]({ params: { plate: ' 807104 ' }, body: { reason: 'รถบรรทุกเล็ก/หกล้อ' }, user: { role: 'admin', username: 'dojo', id: 1 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.rejected, true);
    assert.equal(res.body.kind, 'reject');
    const ins = calls.find((c) => /INSERT INTO truck_ban_rejections/.test(c.sql));
    assert.deepEqual(ins.args, ['807104', 'reject', 'รถบรรทุกเล็ก/หกล้อ', 'dojo', 1], 'kind defaults to reject');
    assert.match(ins.sql, /ON CONFLICT \(plate_number\) DO UPDATE/);
  });

  it('site_admin may reject; bad plates are refused before any write', async () => {
    const { h, calls } = setup();
    const ok = fakeRes();
    await h.post[P]({ params: { plate: '701234' }, body: {}, user: { role: 'site_admin', username: 's', id: 2 } }, ok);
    assert.equal(ok.statusCode, 200);
    for (const plate of ['', 'unknown', 'x'.repeat(33)]) {
      const res = fakeRes();
      await h.post[P]({ params: { plate }, body: {}, user: { role: 'admin' } }, res);
      assert.equal(res.statusCode, 400, `plate "${plate.slice(0, 5)}"`);
    }
    assert.equal(calls.filter((c) => /INSERT INTO truck_ban_rejections/.test(c.sql)).length, 1);
  });

  it('admin restores a plate (DELETE row) and GET lists newest first', async () => {
    const { h, calls } = setup();
    const del = fakeRes();
    await h.delete[P]({ params: { plate: '807104' }, user: { role: 'admin' } }, del);
    assert.deepEqual(del.body, { plate_number: '807104', rejected: false });
    assert.ok(calls.some((c) => /DELETE FROM truck_ban_rejections WHERE plate_number = \$1/.test(c.sql) && c.args[0] === '807104'));
    const list = fakeRes();
    await h.get['/api/lpr/truck-ban/rejections']({ user: { role: 'viewer' } }, list);
    assert.equal(list.statusCode, 200);
    assert.ok(calls.some((c) => /SELECT plate_number, kind, reason, rejected_by, rejected_at FROM truck_ban_rejections ORDER BY rejected_at DESC/.test(c.sql)), 'GET returns kind');
  });
});

describe('GET /api/lpr/truck-ban/daily', () => {
  function setupDaily(siteCams = ['C1', 'C2', 'C3']) {
    const h = {};
    const app = { get: (p, fn) => { h[p] = fn; }, post: () => {}, delete: () => {} };
    const calls = [];
    const client = { query: async (sql, args) => {
      calls.push({ sql, args });
      if (/FROM license_plates lp/.test(sql)) return { rows: [{ day: '2026-10-22', am: 336, pm: 371 }] };
      return { rows: [] };
    }, release: () => {} };
    const pool = {
      query: async (sql, args) => { calls.push({ sql, args }); return { rows: siteCams.map((id) => ({ id })) }; },
      connect: async () => client,
    };
    registerPlateHistoryAndMismatch(app, pool);
    return { fn: h['/api/lpr/truck-ban/daily'], calls };
  }
  const main = (calls) => calls.find((c) => /FROM license_plates lp/.test(c.sql));

  it('refuses bad or too-wide ranges before touching the DB', async () => {
    const { fn, calls } = setupDaily();
    for (const q of [{}, { from: '2026-10-22', to: '2026-10-01' }, { from: '2026-10', to: '2026-10-31' }, { from: '2026-08-01', to: '2026-10-31' }]) {
      const res = fakeRes();
      await fn({ query: q, user: { role: 'admin' } }, res);
      assert.equal(res.statusCode, 400, JSON.stringify(q));
    }
    assert.equal(calls.length, 0);
  });

  it('passes cameras as a literal list (site ∩ requested), truck only by default, Thai-day bounds', async () => {
    const { fn, calls } = setupDaily();
    const res = fakeRes();
    await fn({ query: { from: '2026-10-01', to: '2026-10-31', cameras: 'C2,C9,C3' }, user: { role: 'admin' } }, res);
    assert.deepEqual(res.body, [{ day: '2026-10-22', am: 336, pm: 371 }]);
    const q = main(calls);
    assert.deepEqual(q.args.slice(0, 4), [['C2', 'C3'], ['truck'], '2026-09-30T17:00:00.000Z', '2026-10-31T17:00:00.000Z']);
    assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM truck_ban_rejections/);
    assert.match(q.sql, /\^\[5-9\]\[0-9\]\{5,6\}\$/);
    assert.match(q.sql, /h IN \(6, 7, 8, 16, 17, 18\)/);
    assert.ok(calls.some((c) => /FROM cameras c JOIN sites s/.test(c.sql) && /c\.cam_role = 'lpr'/.test(c.sql)), 'LPR cameras only');
  });

  it('light=1 adds buggy (light truck); no matching camera = empty without querying plates', async () => {
    const a = setupDaily();
    await a.fn({ query: { from: '2026-10-22', to: '2026-10-22', light: '1' }, user: { role: 'admin' } }, fakeRes());
    assert.deepEqual(main(a.calls).args[1], ['truck', 'buggy']);
    const b = setupDaily();
    const res = fakeRes();
    await b.fn({ query: { from: '2026-10-22', to: '2026-10-22', cameras: 'NOPE' }, user: { role: 'admin' } }, res);
    assert.deepEqual(res.body, []);
    assert.equal(main(b.calls), undefined);
  });
});

describe('GET /api/lpr/truck-ban/buckets', () => {
  function setupBuckets(planRows) {
    const h = {};
    const app = { get: (p, fn) => { h[p] = fn; }, post: () => {}, delete: () => {} };
    const calls = [];
    const client = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: /FROM license_plates lp/.test(sql) ? planRows : [] }; }, release: () => {} };
    const pool = { query: async () => ({ rows: [{ id: 'C1' }] }), connect: async () => client };
    registerPlateHistoryAndMismatch(app, pool);
    return { fn: h['/api/lpr/truck-ban/buckets'], calls };
  }

  it('400 on a bad day', async () => {
    const { fn, calls } = setupBuckets([]);
    const res = fakeRes();
    await fn({ query: { day: '26/10/2026' }, user: { role: 'admin' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  });

  it('fills 48 half-hour buckets plus whole-day and ban-window totals for one Thai day', async () => {
    const { fn, calls } = setupBuckets([
      { k: 'b', b: 12, n: 40 }, { k: 'b', b: 47, n: 3 }, { k: 'all', b: null, n: 500 }, { k: 'ban', b: null, n: 120 },
    ]);
    const res = fakeRes();
    await fn({ query: { day: '2026-10-22' }, user: { role: 'admin' } }, res);
    assert.equal(res.body.buckets.length, 48);
    assert.equal(res.body.buckets[12], 40);
    assert.equal(res.body.buckets[47], 3);
    assert.equal(res.body.buckets[0], 0);
    assert.equal(res.body.all, 500);
    assert.equal(res.body.ban, 120);
    const q = calls.find((c) => /FROM license_plates lp/.test(c.sql));
    assert.deepEqual(q.args.slice(2, 4), ['2026-10-21T17:00:00.000Z', '2026-10-22T17:00:00.000Z']);
    assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM truck_ban_rejections/);
  });
});

// ── ไม่แน่ใจ (kind = 'defer' · migration 286) ─────────────────────────────────────────────────────
describe('truck-ban defer (ไม่แน่ใจ)', () => {
  const admin = { role: 'admin', username: 'dojo', id: 1 };
  const inserts = (calls) => calls.filter((c) => /INSERT INTO truck_ban_rejections/.test(c.sql));

  it('migration 286 is idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK, no UPDATE, no 284', () => {
    const dir = path.join(__dirname, '..', 'db');
    const sql = fs.readFileSync(path.join(dir, 'db_migration_286_truck_ban_defer.sql'), 'utf8');
    assert.match(sql, /ALTER TABLE truck_ban_rejections ADD COLUMN IF NOT EXISTS kind VARCHAR\(8\) NOT NULL DEFAULT 'reject'/);
    assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'truck_ban_rejections_kind_chk'\)/);
    assert.match(sql, /CHECK \(kind IN \('reject', 'defer'\)\)/);
    assert.doesNotMatch(sql, /^\s*UPDATE\b/im, 'existing rows stay reject via DEFAULT');
    assert.match(sql, /@author[\s\S]*@copyright[\s\S]*@license/);
    assert.ok(!fs.readdirSync(dir).some((f) => /^db_migration_284_/.test(f)), '284 stays reserved');
  });

  it('POST kind=defer writes defer (no reason needed) and reports rejected:false', async () => {
    const { h, calls } = setup();
    const res = fakeRes();
    await h.post[P]({ params: { plate: '807104' }, body: { kind: 'defer' }, user: admin }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(inserts(calls)[0].args, ['807104', 'defer', null, 'dojo', 1]);
    assert.equal(res.body.kind, 'defer');
    assert.equal(res.body.rejected, false);
  });

  it('POST upserts the kind both ways (defer to reject, reject to defer) in one statement', async () => {
    const { h, calls } = setup();
    for (const kind of ['reject', 'defer']) await h.post[P]({ params: { plate: '807104' }, body: { kind }, user: admin }, fakeRes());
    const ins = inserts(calls);
    assert.equal(ins.length, 2);
    for (const c of ins) assert.match(c.sql, /ON CONFLICT \(plate_number\) DO UPDATE\s+SET kind = EXCLUDED\.kind, reason = EXCLUDED\.reason, rejected_by = EXCLUDED\.rejected_by/);
    assert.deepEqual(ins.map((c) => c.args[1]), ['reject', 'defer']);
  });

  it('POST refuses a bad kind with 400 before any write; viewer still 403', async () => {
    const { h, calls } = setup();
    for (const kind of ['maybe', 'DEFER', '', 0, {}, []]) {
      const res = fakeRes();
      await h.post[P]({ params: { plate: '807104' }, body: { kind }, user: admin }, res);
      assert.equal(res.statusCode, 400, JSON.stringify(kind));
      assert.deepEqual(res.body, { error: 'bad_kind' });
    }
    const v = fakeRes();
    await h.post[P]({ params: { plate: '807104' }, body: { kind: 'defer' }, user: { role: 'viewer' } }, v);
    assert.equal(v.statusCode, 403);
    assert.equal(inserts(calls).length, 0);
  });

  it('DELETE removes either kind (plain row delete, no kind filter)', async () => {
    const { h, calls } = setup();
    await h.delete[P]({ params: { plate: '807104' }, user: admin }, fakeRes());
    const del = calls.find((c) => /DELETE FROM truck_ban_rejections/.test(c.sql));
    assert.equal(del.sql.trim(), 'DELETE FROM truck_ban_rejections WHERE plate_number = $1');
  });
});

describe('truck-ban defer · queries', () => {
  const admin = { role: 'admin' };
  const mainRow = { violations: 5, plates: 3, repeaters: 1, max_per_plate: 3, peak: { b: 17, n: 2 }, groups: [], cam_plates: [], list: [], oldest: '2026-07-29' };
  function setupRank({ kinds = [{ plate_number: '701234', kind: 'defer' }, { plate_number: '807104', kind: 'reject' }], marked = [] } = {}) {
    const h = {};
    const app = { get: (p, fn) => { h[p] = fn; }, post: () => {}, delete: () => {} };
    const calls = [];
    const client = { query: async (sql, args) => {
      calls.push({ sql, args });
      if (/pp\.p AS plate/.test(sql)) return { rows: marked };
      if (/FROM license_plates lp/.test(sql)) return { rows: [mainRow] };
      return { rows: [] };
    }, release: () => {} };
    const pool = { query: async (sql, args) => {
      calls.push({ sql, args });
      if (/FROM cameras c JOIN sites s/.test(sql)) return { rows: [{ id: 'C1' }, { id: 'C2' }] };
      if (/SELECT plate_number, kind FROM truck_ban_rejections/.test(sql)) return { rows: kinds };
      return { rows: [] };
    }, connect: async () => client };
    registerPlateHistoryAndMismatch(app, pool);
    return { h, calls };
  }
  const markedQ = (calls) => calls.find((c) => /pp\.p AS plate/.test(c.sql));
  const R = '/api/lpr/truck-ban/ranking';

  it('ranking without marked=1 is unchanged: one heavy query, no marked key', async () => {
    const { h, calls } = setupRank();
    const res = fakeRes();
    await h[R]({ query: { days: '2026-10-30' }, user: admin }, res);
    assert.equal(res.body.marked, undefined);
    assert.equal(markedQ(calls), undefined);
    assert.ok(!calls.some((c) => /SELECT plate_number, kind FROM truck_ban_rejections/.test(c.sql)));
  });

  it('marked=1 adds [{plate, kind, n, last, region}] over reject+defer plates only, same days/light/cameras', async () => {
    const { h, calls } = setupRank({ marked: [
      { plate: '701234', n: 4, last: '2026-10-30T09:19:35Z', region: 'ภูเก็ต' },
      { plate: '807104', n: 1, last: '2026-10-29T08:00:00Z', region: null }] });
    const res = fakeRes();
    await h[R]({ query: { days: '2026-10-30,2026-10-29', marked: '1', light: '1', cameras: 'C2' }, user: admin }, res);
    assert.deepEqual(res.body.marked, [
      { plate: '701234', n: 4, last: '2026-10-30T09:19:35Z', region: 'ภูเก็ต', kind: 'defer' },
      { plate: '807104', n: 1, last: '2026-10-29T08:00:00Z', region: null, kind: 'reject' }]);
    assert.equal(res.body.kpis.violations, 5, 'kpis untouched');
    const q = markedQ(calls);
    // $1 กล้อง (ตัดตามที่เลือก) · $2 ประเภท · $3–$4 ช่วง · $5 วัน · $6 ป้ายที่ทำเครื่องหมาย
    assert.deepEqual(q.args, [['C2'], ['truck', 'buggy'], '2026-10-28T17:00:00.000Z', '2026-10-30T17:00:00.000Z',
      ['2026-10-29', '2026-10-30'], ['701234', '807104']]);
    assert.match(q.sql, /lp\.plate_number = ANY\(\$6::text\[\]\)/);
    assert.match(q.sql, /GROUP BY 1, 2, 3/, 'one violation = plate × day × window');
    assert.match(q.sql, /CROSS JOIN LATERAL/);
    assert.doesNotMatch(q.sql, /NOT EXISTS \(SELECT 1 FROM truck_ban_rejections/, 'must not exclude the marked plates');
    const mainQ = calls.find((c) => /FROM license_plates lp/.test(c.sql) && !/pp\.p AS plate/.test(c.sql));
    assert.match(mainQ.sql, /NOT EXISTS \(SELECT 1 FROM truck_ban_rejections/, 'ranking still excludes both kinds');
  });

  it('marked=1 with no marked plates (or no days) skips the heavy query and returns []', async () => {
    const a = setupRank({ kinds: [] });
    const ra = fakeRes();
    await a.h[R]({ query: { days: '2026-10-30', marked: '1' }, user: admin }, ra);
    assert.deepEqual(ra.body.marked, []);
    assert.equal(markedQ(a.calls), undefined);
    const b = setupRank();
    const rb = fakeRes();
    await b.h[R]({ query: { days: '', marked: '1' }, user: admin }, rb);
    assert.deepEqual(rb.body.marked, []);
    assert.equal(markedQ(b.calls), undefined);
  });

  it('plate images: excluded for marked plates by default, included with include_marked=1', async () => {
    for (const [query, expectExcluded] of [[{}, true], [{ include_marked: '1' }, false]]) {
      const { h, calls } = setupRank();
      await h['/api/lpr/truck-ban/plate/:plate']({ params: { plate: '701234' }, query: { days: '2026-10-30', ...query }, user: admin }, fakeRes());
      const q = calls.find((c) => /FROM license_plates lp/.test(c.sql));
      assert.equal(/NOT EXISTS \(SELECT 1 FROM truck_ban_rejections/.test(q.sql), expectExcluded, JSON.stringify(query));
    }
  });
});

describe('truck-ban defer · UI source', () => {
  const dir = path.join(__dirname, '..', 'public', 'others', 'demo', 'truck-ban');
  const js = fs.readFileSync(path.join(dir, 'truck-ban.js'), 'utf8');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'truck-ban.css'), 'utf8');

  it('every new button is a data-action handled by the single click listener (no inline handlers)', () => {
    for (const a of ['deferAsk', 'yesAsk', 'rejAsk', 'deferList', 'rejList', 'unreject', 'plate']) {
      assert.match(js, new RegExp(`a === '${a}'`), a);
    }
    assert.match(html, /id="lbDefer" data-action="deferAsk"/);
    assert.match(html, /id="lbYes" data-action="yesAsk"/);
    assert.match(html, /id="tbDeferBtn" data-action="deferList"/);
    assert.doesNotMatch(html + js, /\son(click|change|input|submit)\s*=/i, 'CSP: no inline handlers');
    assert.doesNotMatch(css, /prefers-color-scheme/, 'demo is light only');
  });

  it('modal buttons follow the mark state; list rows carry plate, region, count, view / yes / reject', () => {
    assert.match(js, /\$\('lbDefer'\)\.hidden = !on \|\| !!k/);
    assert.match(js, /\$\('lbYes'\)\.hidden = !on \|\| k !== 'defer'/);
    assert.match(js, /\$\('lbReject'\)\.hidden = !on \|\| k === 'reject'/);
    const body = js.slice(js.indexOf('function renderDeferList'), js.indexOf('let rejTarget'));
    for (const t of ['tb-chip', 'm.region', 'm.n', 'data-action="plate"', 'data-action="unreject"', 'data-action="rejAsk"', 'ใช่เป้าหมาย']) {
      assert.ok(body.includes(t), t);
    }
  });

  it('writes send kind, ranking asks for marked=1, images of marked plates ask include_marked=1, actions refetch', () => {
    assert.match(js, /JSON\.stringify\(\{ kind, reason \}\)/);
    assert.match(js, /marked: '1'/);
    assert.match(js, /include_marked: '1'/);
    assert.match(js, /markPlate\(plate, 'defer', null\)\.then\(\(\) => \{ closeLb\(\); rebuild\(\); \}\)/);
    assert.match(js, /restorePlate\(plate\)\.then\(\(\) => \{ closeLb\(\); rebuild\(\); \}\)/);
    assert.match(js, /#tbRejBtn, #tbDeferBtn/, 'export snapshot drops the new button too');
  });

  it('?v= of truck-ban.js/css was bumped past tb14/tb10', () => {
    const js_v = Number((html.match(/truck-ban\.js\?v=tb(\d+)/) || [])[1]), css_v = Number((html.match(/truck-ban\.css\?v=tb(\d+)/) || [])[1]);
    assert.ok(js_v > 14 && css_v > 10, `${js_v} / ${css_v}`);
  });
});

describe('truck-ban Export PDF (charts bar) · UI source', () => {
  const dir = path.join(__dirname, '..', 'public', 'others', 'demo', 'truck-ban');
  const js = fs.readFileSync(path.join(dir, 'truck-ban.js'), 'utf8');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'truck-ban.css'), 'utf8');

  it('page button stays, exportCharts is wired to the single click listener, exportCard is gone', () => {
    assert.match(html, /data-action="exportPage"/);
    assert.match(js, /a === 'exportPage'/);
    assert.match(js, /a === 'exportCharts'/);
    assert.match(js, /function exportSection\(btn, root, title, file\)/);
    assert.match(js, /exportSection\(btn, \$\('tbCharts'\)/);
    assert.doesNotMatch(html + js + css, /exportCard|tb-cardexp|data-card=/, 'per-card buttons removed');
    assert.doesNotMatch(html + js, /\son(click|change|input|submit)\s*=/i, 'CSP: no inline handlers');
  });

  it('one export bar sits directly above #tbLiveCard, outside the #tbCharts wrapper that holds the 4 cards in order', () => {
    assert.equal((html.match(/data-action="exportCharts"/g) || []).length, 1);
    const bar = html.indexOf('class="tb-exportbar"'), wrapAt = html.indexOf('<div id="tbCharts">');
    const ids = ['tbLiveCard', 'tbDayCard', 'tbBackCard', 'tbMonthCard'].map((id) => html.indexOf(`id="${id}"`));
    assert.ok(bar > 0 && bar < wrapAt && wrapAt < ids[0], 'bar -> wrapper -> Realtime card');
    assert.deepEqual([...ids].sort((a, b) => a - b), ids, 'page order: Realtime, 24h, back, month');
    const inner = html.slice(wrapAt, html.indexOf('</div>\n\n  <div class="tb-lb"', wrapAt) + 6);
    for (const id of ['tbLiveCard', 'tbDayCard', 'tbBackCard', 'tbMonthCard']) assert.ok(inner.includes(`id="${id}"`), id);
    assert.ok(!inner.includes('exportCharts'), 'button must not be inside the snapshot root');
    assert.match(js, /\.tb-exportbar, #tbRejBtn/, 'page export drops the empty bar too');
  });

  it('?v= bumped past tb18 / tb13', () => {
    const jsV = Number((html.match(/truck-ban\.js\?v=tb(\d+)/) || [])[1]), cssV = Number((html.match(/truck-ban\.css\?v=tb(\d+)/) || [])[1]);
    assert.ok(jsV > 18 && cssV > 13, `${jsV} / ${cssV}`);
  });
});
