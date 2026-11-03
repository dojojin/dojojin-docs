// ============================================================
// Vigil Platform — Tests: PUT /api/sites/:id/status + helpers/siteStatus
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// maintenance โหมดรายไซต์ (migration 285) · fake pool เก็บสถานะกล้อง/ไซต์ในหน่วยความจำ
// ไม่แตะ DB หรือ cameras-config.json จริง · harness แบบเดียวกับ sites-delete-guard.test.js
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sitesRoutes = require('../src/routes/sites');
const siteStatus = require('../src/helpers/siteStatus');
const brokerAdmin = require('../src/helpers/brokerAdmin');

function setup(pool, extra) {
  const handlers = {};
  const app = {};
  for (const m of ['get', 'put', 'post', 'delete']) {
    app[m] = (p, ...fns) => { handlers[`${m} ${p}`] = fns[fns.length - 1]; };
  }
  const cfg = { cameras: [{ camera_id: 'C1' }, { camera_id: 'C2' }, { camera_id: 'C3' }] };
  const saves = [];
  sitesRoutes(app, pool, {
    auth: { requireAdmin: 'ADMIN' },
    loadCameraConfig: () => cfg,
    saveCameraConfig: (c) => { saves.push(JSON.parse(JSON.stringify(c))); return true; },
    ...extra,
  });
  return { h: handlers['put /api/sites/:id/status'], saves };
}

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// cams: id -> { paused, by_site, enabled }
function makePool({ code = 'hdy', status = 'active', cams = {}, edge = false } = {}) {
  const st = { code, status, cams, siteUpdate: null, audits: [], pausedIds: [], resumedIds: [] };
  return {
    st,
    query: async (sql, args) => {
      if (/SELECT id, code, status FROM sites/.test(sql)) return { rows: [{ id: 7, code: st.code, status: st.status }] };
      if (/SELECT id FROM cameras WHERE site_id=\$1 AND paused=FALSE/.test(sql)) {
        return { rows: Object.entries(st.cams).filter(([, c]) => !c.paused).map(([id]) => ({ id })) };
      }
      if (/SELECT id FROM cameras WHERE site_id=\$1 AND paused_by_site=TRUE/.test(sql)) {
        return { rows: Object.entries(st.cams).filter(([, c]) => c.by_site).map(([id]) => ({ id })) };
      }
      if (/UPDATE cameras SET paused=TRUE/.test(sql)) {
        st.pausedIds.push(args[0]);
        for (const id of args[0]) Object.assign(st.cams[id], { paused: true, by_site: args[1] });
        return { rows: args[0].map(id => ({ id, enabled: st.cams[id].enabled !== false })) };
      }
      if (/UPDATE cameras SET paused=FALSE/.test(sql)) {
        st.resumedIds.push(args[0]);
        for (const id of args[0]) Object.assign(st.cams[id], { paused: false, by_site: false });
        return { rows: args[0].map(id => ({ id, enabled: st.cams[id].enabled !== false })) };
      }
      if (/UPDATE sites SET status=/.test(sql)) {
        st.siteUpdate = { sql, args };
        st.status = /status='maintenance'/.test(sql) ? 'maintenance' : /status='archived'/.test(sql) ? 'archived' : 'active';
        return { rowCount: 1 };
      }
      if (/FROM edge_status/.test(sql)) return { rowCount: edge ? 1 : 0, rows: [] };
      if (/INSERT INTO audit_log/.test(sql)) {
        if (/'site_status'|site_status/.test(String(args[2]))) st.audits.push(args);
        return { rowCount: 1 };
      }
      if (/INSERT INTO camera_status_log|UPDATE cameras SET last_seen_at/.test(sql)) return { rowCount: 1 };
      throw new Error('unhandled SQL: ' + sql);
    },
  };
}

const mkReq = (body, id = '7') => ({ params: { id }, body, user: { id: 1, username: 'admin' } });

describe('PUT /api/sites/:id/status', () => {
  beforeEach(() => siteStatus.invalidate());

  it('maintenance ไม่ ingest → pause เฉพาะกล้องที่ยังไม่ paused ด้วย bySite + sites update + audit', async () => {
    const pool = makePool({ cams: { C1: { paused: false }, C2: { paused: true, by_site: false }, C3: { paused: false } } });
    const { h, saves } = setup(pool);
    const res = fakeRes();
    await h(mkReq({ status: 'maintenance', note: '  เปลี่ยนสวิตช์  ' }), res);
    assert.deepEqual(res.body, { ok: true, status: 'maintenance', cameras_paused: 2 });
    assert.deepEqual(pool.st.pausedIds, [['C1', 'C3']]);
    assert.equal(pool.st.cams.C1.by_site, true);
    assert.equal(pool.st.cams.C2.by_site, false, 'กล้องที่แอดมิน pause เอง ไม่ถูกแตะ');
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].cameras.map(c => c.paused), [true, undefined, true]);
    assert.deepEqual(pool.st.siteUpdate.args, [7, 'admin', 'เปลี่ยนสวิตช์', false]);
    const d = JSON.parse(pool.st.audits[0][3]);
    assert.deepEqual(d, { site_id: 7, code: 'hdy', from: 'active', to: 'maintenance', ingest: false, cameras_paused: 2, edge_revoked: false, note: 'เปลี่ยนสวิตช์' });
  });

  it('maintenance + ingest=true → 400 (ปิดไว้จนกว่าแจ้งเตือนจากเหตุการณ์จะเงียบตามสถานะไซต์)', async () => {
    const pool = makePool({ cams: { C1: { paused: false } }, edge: true });
    const { h } = setup(pool);
    const res = fakeRes();
    await h(mkReq({ status: 'maintenance', ingest: true }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(pool.st.pausedIds.length, 0);
    assert.equal(pool.st.siteUpdate, null);
  });

  it('active → คืนเฉพาะกล้อง paused_by_site · ที่แอดมิน pause เองยังค้าง', async () => {
    const pool = makePool({ status: 'maintenance',
      cams: { C1: { paused: true, by_site: true }, C2: { paused: true, by_site: false }, C3: { paused: true, by_site: true } } });
    const { h, saves } = setup(pool);
    const res = fakeRes();
    await h(mkReq({ status: 'active' }), res);
    assert.deepEqual(res.body, { ok: true, status: 'active', cameras_resumed: 2 });
    assert.deepEqual(pool.st.resumedIds, [['C1', 'C3']]);
    assert.equal(pool.st.cams.C2.paused, true);
    assert.deepEqual(saves[0].cameras.map(c => c.paused), [false, undefined, false]);
    assert.match(pool.st.siteUpdate.sql, /status_note=NULL, maintenance_ingest=FALSE/);
    assert.equal(JSON.parse(pool.st.audits[0][3]).cameras_resumed, 2);
  });

  it('ส่งสถานะเดิมซ้ำ → 200 unchanged ไม่แตะอะไร', async () => {
    const pool = makePool({ status: 'maintenance', cams: { C1: { paused: true, by_site: true } } });
    const { h } = setup(pool);
    const res = fakeRes();
    await h(mkReq({ status: 'maintenance' }), res);
    assert.deepEqual(res.body, { ok: true, unchanged: true });
    assert.equal(pool.st.siteUpdate, null);
    assert.equal(pool.st.pausedIds.length, 0);
  });

  it('status แปลก → 400', async () => {
    const pool = makePool();
    const { h } = setup(pool);
    const res = fakeRes();
    await h(mkReq({ status: 'bogus' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(pool.st.siteUpdate, null);
  });

  it('note ยาวเกิน 500 → 400', async () => {
    const { h } = setup(makePool());
    const res = fakeRes();
    await h(mkReq({ status: 'maintenance', note: 'x'.repeat(501) }), res);
    assert.equal(res.statusCode, 400);
  });

  it('site main → 400 · ไม่พบ → 404', async () => {
    const poolMain = makePool({ code: 'main' });
    let res = fakeRes();
    await setup(poolMain).h(mkReq({ status: 'maintenance' }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(poolMain.st.pausedIds.length, 0);

    const none = { query: async () => ({ rows: [] }) };
    res = fakeRes();
    await setup(none).h(mkReq({ status: 'maintenance' }, '99'), res);
    assert.equal(res.statusCode, 404);
  });
});

describe('PUT /api/sites/:id/status — archived (S4)', () => {
  const realDelete = brokerAdmin.deleteUser;
  let deleted;
  beforeEach(() => {
    siteStatus.invalidate();
    deleted = [];
    brokerAdmin.deleteUser = async (u) => { deleted.push(u); };
  });
  const restore = () => { brokerAdmin.deleteUser = realDelete; };

  it('active → archived: pause กล้องที่ยังไม่ paused (bySite) + ถอน edge-<code> เมื่อมี edge', async () => {
    try {
      const pool = makePool({ cams: { C1: { paused: false }, C2: { paused: true, by_site: false } }, edge: true });
      const { h } = setup(pool);
      const res = fakeRes();
      await h(mkReq({ status: 'archived' }), res);
      assert.deepEqual(res.body, { ok: true, status: 'archived', cameras_paused: 1, edge_revoked: true });
      assert.deepEqual(pool.st.pausedIds, [['C1']]);
      assert.equal(pool.st.cams.C1.by_site, true);
      assert.equal(pool.st.status, 'archived');
      assert.deepEqual(deleted, ['edge-hdy']);
      assert.equal(JSON.parse(pool.st.audits[0][3]).edge_revoked, true);
      assert.equal(JSON.parse(pool.st.audits[0][3]).to, 'archived');
    } finally { restore(); }
  });

  it('maintenance → archived เมื่อไม่มี edge → ไม่เรียก deleteUser · edge_revoked=false ไม่มี warning', async () => {
    try {
      const pool = makePool({ status: 'maintenance', cams: { C1: { paused: true, by_site: true } }, edge: false });
      const res = fakeRes();
      await setup(pool).h(mkReq({ status: 'archived' }), res);
      assert.deepEqual(res.body, { ok: true, status: 'archived', cameras_paused: 0, edge_revoked: false });
      assert.deepEqual(deleted, []);
    } finally { restore(); }
  });

  it('ถอนรหัสล้ม → ยัง ok (สถานะเปลี่ยนแล้ว) + warning + edge_revoked=false', async () => {
    const orig = console.warn; console.warn = () => {};
    try {
      brokerAdmin.deleteUser = async () => { throw new Error('dynsec down'); };
      const pool = makePool({ cams: { C1: { paused: false } }, edge: true });
      const res = fakeRes();
      await setup(pool).h(mkReq({ status: 'archived' }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.edge_revoked, false);
      assert.match(res.body.warning, /dynsec down/);
      assert.equal(pool.st.status, 'archived');
      assert.equal(JSON.parse(pool.st.audits[0][3]).edge_revoked, false);
    } finally { console.warn = orig; restore(); }
  });

  it('archived → active: คืนกล้อง paused_by_site + needs_edge_provision เมื่อมี edge · ไม่เรียก deleteUser', async () => {
    try {
      const pool = makePool({ status: 'archived', cams: { C1: { paused: true, by_site: true }, C2: { paused: true, by_site: false } }, edge: true });
      const res = fakeRes();
      await setup(pool).h(mkReq({ status: 'active' }), res);
      assert.deepEqual(res.body, { ok: true, status: 'active', cameras_resumed: 1, needs_edge_provision: true });
      assert.equal(pool.st.cams.C2.paused, true);
      assert.deepEqual(deleted, []);
    } finally { restore(); }
  });

  it('archived → active ไม่มี edge → ไม่มี needs_edge_provision · maintenance → active ก็ไม่มี', async () => {
    try {
      let pool = makePool({ status: 'archived', cams: { C1: { paused: true, by_site: true } }, edge: false });
      let res = fakeRes();
      await setup(pool).h(mkReq({ status: 'active' }), res);
      assert.equal(res.body.needs_edge_provision, undefined);
      pool = makePool({ status: 'maintenance', cams: { C1: { paused: true, by_site: true } }, edge: true });
      res = fakeRes();
      await setup(pool).h(mkReq({ status: 'active' }), res);
      assert.equal(res.body.needs_edge_provision, undefined);
    } finally { restore(); }
  });

  it('archived → maintenance: เปลี่ยนสถานะอย่างเดียว ไม่แตะ broker', async () => {
    try {
      const pool = makePool({ status: 'archived', cams: { C1: { paused: true, by_site: true } }, edge: true });
      const res = fakeRes();
      await setup(pool).h(mkReq({ status: 'maintenance' }), res);
      assert.deepEqual(res.body, { ok: true, status: 'maintenance', cameras_paused: 0 });
      assert.equal(pool.st.status, 'maintenance');
      assert.deepEqual(deleted, []);
    } finally { restore(); }
  });

  it('site main → archived ไม่ได้', async () => {
    const res = fakeRes();
    await setup(makePool({ code: 'main' })).h(mkReq({ status: 'archived' }), res);
    assert.equal(res.statusCode, 400);
  });

  it('username ที่ถอนต้องตรงกับที่ site-provision.js สร้าง (edge-<code>)', () => {
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'site-provision.js'), 'utf8'), /const username = `edge-\$\{code\}`/);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sites.js'), 'utf8'), /brokerAdmin\.deleteUser\(`edge-\$\{site\.code\}`\)/);
  });
});

describe('archived sites hidden from live views only', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  it('archivedCameraIds: คืน Set ของ camera id · query ล้ม → Set ว่าง', async () => {
    const q = [];
    const a = await siteStatus.archivedCameraIds({ query: async (sql) => { q.push(sql); return { rows: [{ id: 'C1' }, { id: 'C9' }] }; } });
    assert.deepEqual([...a].sort(), ['C1', 'C9']);
    assert.match(q[0], /s\.status = 'archived'/);
    assert.equal((await siteStatus.archivedCameraIds({ query: async () => { throw new Error('x'); } })).size, 0);
  });

  it('status-current / health details / exec summary กรองกล้อง archived ออกจากรายการและตัวนับ', () => {
    const cs = read('src', 'routes', 'cameras-status.js');
    assert.match(cs, /archivedCameraIds\(pool\)[\s\S]{0,200}filter\(c => !archived\.has\(c\.camera_id \|\| c\.id\)\)/);
    const h = read('src', 'routes', 'health.js');
    assert.match(h, /liveCams = \(config\.cameras \|\| \[\]\)\.filter\(c => !archived\.has/);
    assert.match(h, /result\.cameras\.list = liveCams\.map/);
    const e = read('src', 'stats-summary-route.js');
    assert.match(e, /archivedCams = await archivedCameraIds\(pool\)[\s\S]{0,300}!archivedCams\.has\(c\.camera_id\)/);
  });

  it('status-current: กล้องของไซต์ archived ไม่อยู่ใน cameras/summary', async () => {
    const camerasStatusRoutes = require('../src/routes/cameras-status');
    const handlers = {};
    const app = {};
    for (const m of ['get', 'put', 'post', 'delete', 'patch']) app[m] = (p, ...fns) => { handlers[`${m} ${p}`] = fns[fns.length - 1]; };
    const pool = { query: async (sql) => {
      if (/s\.status = 'archived'/.test(sql)) return { rows: [{ id: 'C2' }] };
      if (/FROM cameras c\s+LEFT JOIN LATERAL/.test(sql)) return { rows: [{ camera_id: 'C1', paused: false, last_seen_at: new Date() }] };
      throw new Error('unhandled SQL: ' + sql);
    } };
    camerasStatusRoutes(app, pool, { auth: { requireAdmin: 'A', requireAuth: 'A', requireAdminOrAuditor: 'A' },
      loadCameraConfig: () => ({ cameras: [{ camera_id: 'C1' }, { camera_id: 'C2' }] }), saveCameraConfig: () => {} });
    const res = fakeRes();
    await handlers['get /api/cameras/status-current']({ query: {}, user: {} }, res);
    assert.deepEqual(res.body.cameras.map(c => c.camera_id), ['C1']);
    assert.equal(res.body.summary.total, 1);
  });
});

describe('helpers/siteStatus.quietSiteCodes', () => {
  beforeEach(() => siteStatus.invalidate());

  it('คืน Set ของ code · cache ไม่ยิงซ้ำภายใน 30 วิ · invalidate แล้วอ่านใหม่', async () => {
    let n = 0;
    const pool = { query: async () => { n++; return { rows: [{ code: 'hdy' }] }; } };
    const a = await siteStatus.quietSiteCodes(pool);
    assert.deepEqual([...a], ['hdy']);
    await siteStatus.quietSiteCodes(pool);
    assert.equal(n, 1);
    siteStatus.invalidate();
    await siteStatus.quietSiteCodes(pool);
    assert.equal(n, 2);
  });

  it('query ล้ม → Set ว่าง ไม่โยน', async () => {
    const orig = console.warn; console.warn = () => {};
    try {
      const s = await siteStatus.quietSiteCodes({ query: async () => { throw new Error('boom'); } });
      assert.equal(s.size, 0);
    } finally { console.warn = orig; }
  });
});

// ── ทุกจุดแจ้งเตือนต้องถามชุด "ไซต์เงียบ" — เช็คระดับซอร์สกันใครลบทิ้งเงียบ ๆ ──
describe('alert spots consult sites.status', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const fnBody = (src, name) => {
    const i = src.indexOf(`async function ${name}(`);
    assert.ok(i >= 0, name);
    const j = src.indexOf('\nasync function ', i + 10);
    return src.slice(i, j < 0 ? undefined : j);
  };

  it('alert-engine: checkEdgeStale / DataLoss / DiskLow ข้าม quiet code เหมือน disabled_sites', () => {
    const src = read('src', 'alert-engine.js');
    for (const f of ['checkEdgeStale', 'checkEdgeDataLoss', 'checkEdgeDiskLow']) {
      const b = fnBody(src, f);
      assert.match(b, /quietSiteCodes\(pool\)/, f);
      assert.match(b, /disabled_sites\.includes\(site\.site_id\) \|\| quiet\.has\(site\.site_id\)\) continue/, f);
    }
  });

  it('alert-engine: checkQuietCameras (_computeQuietState) ตัดกล้องของไซต์ที่ status <> active', () => {
    const b = fnBody(read('src', 'alert-engine.js'), '_computeQuietState');
    assert.match(b, /paused = FALSE[\s\S]{0,200}s\.status <> 'active'/);
  });

  it('api-server: checkOfflineCameras ตัดกล้องไซต์เงียบก่อน watchdog และก่อน checkMqttSilent', () => {
    const b = fnBody(read('src', 'api-server.js'), 'checkOfflineCameras');
    assert.match(b, /quietSiteCodes\(pool\)/);
    assert.match(b, /camRes\.rows = camRes\.rows\.filter/);
    assert.match(b, /cfgCameras = cfgCameras\.filter\(c => !quietIds\.has[\s\S]*checkMqttSilent\(\{ cfgCameras,/);
  });

  it('bridgePathWatch.onHeartbeat ไม่ส่ง LINE ให้ไซต์เงียบ', () => {
    assert.match(fnBody(read('src', 'helpers', 'bridgePathWatch.js'), 'onHeartbeat'), /quietSiteCodes\(pool\)\)\.has\(siteId\)\) return/);
  });

  it('helmetMetricCheck + query-probe กรอง s.status = active ใน SQL', () => {
    const h = read('src', 'helpers', 'helmetMetricCheck.js');
    assert.match(h, /RATES_SQL = `[\s\S]*?s\.status = 'active'/);
    assert.match(h, /UNFILTERED_SQL = `[\s\S]*?s\.status = 'active'/);
    const q = read('scripts', 'query-probe.js');
    assert.match(q, /SITES_SQL = `[\s\S]*?s\.status = 'active'[\s\S]*?disabled_sites/);
  });
});
