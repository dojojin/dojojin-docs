// ============================================================
// Vigil Platform — Tests: ลบไซต์พร้อมข้อมูล (S5 · helpers/sitePurge)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ทุกอย่างเป็น stub: pool ปลอม (จำ SQL ทุกคำสั่ง) · broker ปลอม · tmp dir
// ไม่มีการต่อ DB/broker จริง
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const brokerAdmin = require('../src/helpers/brokerAdmin');
const sitePurge = require('../src/helpers/sitePurge');
const sitesRoutes = require('../src/routes/sites');
const camerasRoutes = require('../src/routes/cameras');

const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

// ── pool ปลอม — สถานะพอให้ลูปจบได้จริง (events ลดลงตาม DELETE) ──
function makeDb(o = {}) {
  const st = {
    site: { id: 7, code: 'rmv', name: 'RMUTR-V', status: 'maintenance', ...(o.site || {}) },
    cams: o.cams || ['CAM A', 'C2'],
    events: o.events || [
      { id: '1', event_time: new Date(1000), camera_id: 'C2' },
      { id: '2', event_time: new Date(2000), camera_id: 'CAM A' },
      { id: '3', event_time: new Date(3000), camera_id: 'C2' },
    ],
    camRows: { alert_logs: 2, lpr_hourly_stats: 1, face_embeddings: 1 },
    job: o.job ? JSON.stringify(o.job) : null,
    widened: o.widened || [],
    hasEdge: o.hasEdge ?? true,
    survivors: o.survivors || ['OTHER'],
    line: { recipients: [
      { id: 'U1', name: 'only-rmv', enabled: true, lpr_sites: ['rmv'] },
      { id: 'U2', name: 'two-sites', enabled: true, lpr_sites: ['rmv', 'hkt'] },
      { id: 'U3', name: 'all', enabled: true },
    ], edge_alert: { enabled: true, disabled_sites: ['rmv', 'hkt'] } },
    tg: { chats: [{ chat_id: 9, name: 'police', enabled: true, lpr_groups: ['g-rmv'] }] },
    lprGroups: ['g-rmv'],
    siteDeleted: false, camerasDeleted: false, audit: null,
  };
  const log = [];
  let failOn = o.failOn || null;
  async function query(sql, args = []) {
    const s = norm(sql);
    log.push({ sql: s, args });
    if (failOn && failOn.test(s)) { failOn = null; if (o.onFail) o.onFail(st); throw new Error('simulated crash'); }
    if (/^SELECT value FROM system_settings/.test(s)) return { rows: st.job ? [{ value: st.job }] : [] };
    if (/^INSERT INTO system_settings/.test(s)) { st.job = args[1]; return { rowCount: 1 }; }
    if (/^SELECT id, code, name, status FROM sites/.test(s)) return { rows: st.siteDeleted ? [] : [st.site] };
    if (/^SELECT id FROM cameras WHERE site_id/.test(s)) return { rows: st.camerasDeleted ? [] : st.cams.map((id) => ({ id })) };
    if (/^SELECT id FROM cameras WHERE NOT/.test(s)) return { rows: st.survivors.map((id) => ({ id })) };
    if (/FROM users u/.test(s) && /NOT \(uc\.camera_id/.test(s)) return { rows: st.widened };
    if (/FROM users u/.test(s)) return { rows: [{ id: 5, username: 'rv1' }] };
    if (/^SELECT id FROM lpr_watchlist_groups/.test(s)) return { rows: st.lprGroups.map((id) => ({ id })) };
    if (/^SELECT id FROM face_blacklist_groups/.test(s)) return { rows: [] };
    if (/count\(\*\)/.test(s)) return { rows: [{ n: 0 }] };
    if (/^SELECT recipients, edge_alert FROM line_config/.test(s)) return { rows: [st.line] };
    if (/^SELECT chats FROM telegram_config/.test(s)) return { rows: [st.tg] };
    if (/^UPDATE line_config/.test(s)) { st.line = { recipients: JSON.parse(args[0]), edge_alert: JSON.parse(args[1]) }; return { rowCount: 1 }; }
    if (/^UPDATE telegram_config/.test(s)) { st.tg = { chats: JSON.parse(args[0]) }; return { rowCount: 1 }; }
    if (/^SELECT 1 FROM edge_status/.test(s)) return { rowCount: st.hasEdge ? 1 : 0, rows: [] };
    if (/^SELECT id, name, camera_ids <@/.test(s)) return { rows: [{ id: 1, name: 'rule-rmv', disable: true }] };
    if (/^SELECT id, event_time FROM events/.test(s)) return { rows: st.events.filter((e) => args[0].includes(e.camera_id)).slice(0, 2) };
    if (/^DELETE FROM events/.test(s)) {
      const n = st.events.length;
      st.events = st.events.filter((e) => !(args[1].includes(e.id) && args[0].includes(e.camera_id)));
      return { rowCount: n - st.events.length };
    }
    if (/^DELETE FROM \w+ WHERE event_id = ANY/.test(s)) return { rowCount: 1 };
    let m = /^DELETE FROM (\w+) WHERE ctid/.exec(s);
    if (m) { const n = st.camRows[m[1]] || 0; st.camRows[m[1]] = 0; return { rowCount: n }; }
    if (/^UPDATE alert_rules/.test(s)) return { rows: [{ id: 1, name: 'rule-rmv', enabled: false, left: 0 }], rowCount: 1 };
    if (/^DELETE FROM user_cameras/.test(s)) return { rowCount: 1 };
    if (/^DELETE FROM cameras/.test(s)) { const n = st.camerasDeleted ? 0 : st.cams.length; st.camerasDeleted = true; return { rowCount: n }; }
    if (/^DELETE FROM sites/.test(s)) { const n = st.siteDeleted ? 0 : 1; st.siteDeleted = true; return { rowCount: n }; }
    if (/^INSERT INTO audit_log/.test(s)) { st.audit = args; return { rowCount: 1 }; }
    if (/^SELECT c\.site_id, s\.code/.test(s)) return { rows: o.camSite ? [o.camSite] : [] };
    return { rows: [], rowCount: 0 };
  }
  return { st, log, query, connect: async () => ({ query, release() {} }) };
}

// ── broker ปลอม — แทนเมธอดบน object เดียวกับที่ sitePurge ถือ ──
let brokerLog, restoreBroker;
function stubBroker(log) {
  const saved = {};
  for (const k of ['publish', 'deleteUser', 'deleteSiteRole', 'clearRetained']) {
    saved[k] = brokerAdmin[k];
    brokerAdmin[k] = async (...a) => { log.push({ broker: k, args: a }); };
  }
  return () => Object.assign(brokerAdmin, saved);
}

function tmpSnap() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-'));
  for (const d of ['events/2026-10-01/CAM_A/0000', 'events/2026-10-01/OTHER/0000', 'lpr/2026-10-02/C2/0400']) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
    fs.writeFileSync(path.join(base, d, 'x.jpg'), 'x');
  }
  return base;
}

async function waitJob(pool) {
  for (let i = 0; i < 1500; i++) { // 30 s — runs sleep 100 ms per batch; slow under a parallel full suite
    const j = await sitePurge.getPurgeJob(pool);
    if (j && j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job did not finish');
}

async function runFull(db, deps = {}) {
  const plan = await sitePurge.planSitePurge(db, db.st.site.id, {});
  assert.deepEqual(plan.blockers, []);
  await sitePurge.startSitePurge(db, plan, { edgeDrainMs: 0, ...deps });
  return waitJob(db);
}

// SQL ที่ "เขียน" ต้องมีขอบเขตเสมอ · line_config/telegram_config เป็นตารางแถวเดียว (id = 1)
const SCOPE_RE = /(camera_id|event_id|group_id|target_group_id) = ANY\(\$\d\)|\bid = ANY\(\$\d\)|site_id = \$1|WHERE id = \$1|camera_ids && \$1|\$1 = ANY\(site_codes\)/;
function assertScoped(log) {
  const writes = log.filter((e) => e.sql && /^(DELETE|UPDATE)\b/.test(e.sql));
  assert.ok(writes.length > 10, 'expected the run to issue writes');
  for (const w of writes) {
    if (/^UPDATE (line_config|telegram_config) .* WHERE id = 1$/.test(w.sql)) continue;
    assert.match(w.sql, SCOPE_RE, `unscoped write: ${w.sql}`);
    assert.doesNotMatch(w.sql, /\busers\b(?! u)/, `must never write users: ${w.sql}`);
  }
}

beforeEach(() => { sitePurge._reset(); brokerLog = []; restoreBroker = stubBroker(brokerLog); });
afterEach(() => { restoreBroker(); });

describe('planSitePurge — blockers', () => {
  it('main site', async () => {
    const p = await sitePurge.planSitePurge(makeDb({ site: { code: 'main' } }), 7);
    assert.ok(p.blockers.some((b) => b.code === 'main'));
  });
  it('active status', async () => {
    const p = await sitePurge.planSitePurge(makeDb({ site: { status: 'active' } }), 7);
    assert.ok(p.blockers.some((b) => b.code === 'status'));
  });
  it('users that would be widened', async () => {
    const p = await sitePurge.planSitePurge(makeDb({ widened: [{ id: 9, username: 'mixed' }] }), 7);
    assert.ok(p.blockers.some((b) => b.code === 'widened'));
    assert.deepEqual(p.users.widened, [{ id: 9, username: 'mixed' }]);
    assert.deepEqual(p.users.onlySite, [{ id: 5, username: 'rv1' }]);
  });
  it('another purge running', async () => {
    const p = await sitePurge.planSitePurge(makeDb({ job: { status: 'running', code: 'hkt', site_id: 3 } }), 7);
    assert.ok(p.blockers.some((b) => b.code === 'running'));
  });
  it('clean maintenance site → no blockers · edge pending · archived → unreachable', async () => {
    const p = await sitePurge.planSitePurge(makeDb(), 7);
    assert.deepEqual(p.blockers, []);
    assert.equal(p.files.edge, 'pending');
    assert.deepEqual(p.cameras, ['CAM A', 'C2']);
    assert.deepEqual(p.settings.alert_rules, [{ id: 1, name: 'rule-rmv', disable: true }]);
    assert.deepEqual(p.settings.line_recipients.map((r) => [r.id, r.disable]), [['U1', true], ['U2', false]]);
    const a = await sitePurge.planSitePurge(makeDb({ site: { status: 'archived' } }), 7);
    assert.equal(a.files.edge, 'unreachable');
  });
});

describe('runSitePurge', () => {
  it('step order, scoped writes, settings scrubbed, files removed, audit written', async () => {
    const db = makeDb();
    const snap = tmpSnap();
    const job = await runFull(db, { snapshotDir: snap, loadCameraConfig: () => ({ cameras: [{ camera_id: 'OTHER' }] }) });
    assert.equal(job.status, 'done', job.error);

    const log = db.log;
    const idx = (re) => db.log.findIndex((e) => re.test(e.sql));
    const lastIdx = (re) => { let k = -1; db.log.forEach((e, i) => { if (re.test(e.sql)) k = i; }); return k; };
    assert.ok(idx(/^DELETE FROM appearances WHERE event_id/) < idx(/^DELETE FROM events/), 'children before events');
    assert.ok(lastIdx(/^DELETE FROM cameras/) < idx(/^DELETE FROM sites/), 'cameras before sites');
    const writes = log.filter((e) => /^(DELETE|UPDATE)\b/.test(e.sql));
    assert.match(writes[writes.length - 1].sql, /^DELETE FROM sites/, 'sites row is the last write');
    assertScoped(db.log);

    // edge delete-media before revoke · revoke + role + both retained topics cleared
    const b = brokerLog.map((x) => `${x.broker}:${x.args[0]}`);
    const firstMedia = b.findIndex((x) => x.startsWith('publish:projects/rmv/_config/delete-media'));
    assert.ok(firstMedia >= 0 && firstMedia < b.indexOf('deleteUser:edge-rmv'));
    assert.deepEqual(brokerLog.filter((x) => x.broker === 'publish').map((x) => x.args[1].camera_id), ['CAM_A', 'C2']);
    assert.ok(b.includes('deleteSiteRole:rmv'));
    assert.ok(b.includes('clearRetained:projects/rmv/_config/cameras'));
    assert.ok(b.includes('clearRetained:projects/rmv/_config/retention'));

    assert.equal(db.st.events.length, 0);
    assert.equal(job.counts.events, 3);
    // pg ตัดไมโครวินาทีของ timestamptz → ขอบบนต้องเกินแถวใหม่สุดของชุด 1ms
    const firstEv = db.log.find((e) => /^DELETE FROM events/.test(e.sql));
    assert.equal(firstEv.args[3].getTime(), 2001);
    assert.ok(db.st.siteDeleted && db.st.camerasDeleted);
    // lpr_sites ['rmv'] → ว่าง = ทุกไซต์ → ต้องปิดรับป้าย · ['rmv','hkt'] → เหลือ hkt
    const [u1, u2, u3] = db.st.line.recipients;
    assert.equal(u1.lpr_enabled, false);
    assert.deepEqual(u2.lpr_sites, ['hkt']); assert.notEqual(u2.lpr_enabled, false);
    assert.equal(u3.lpr_sites, undefined);
    assert.deepEqual(db.st.line.edge_alert.disabled_sites, ['hkt']);
    assert.equal(db.st.tg.chats[0].lpr_enabled, false, 'group filter emptied → disabled');

    assert.ok(!fs.existsSync(path.join(snap, 'events/2026-10-01/CAM_A')), 'unsafe id mapped via safeCamDir and removed');
    assert.ok(!fs.existsSync(path.join(snap, 'lpr/2026-10-02/C2')));
    assert.ok(fs.existsSync(path.join(snap, 'events/2026-10-01/OTHER')), 'other camera untouched');
    assert.match(db.log.find((e) => /^INSERT INTO audit_log/.test(e.sql)).sql, /'site_purged'/);
    fs.rmSync(snap, { recursive: true, force: true });
  });

  it('archived site: no delete-media is sent (edge already revoked)', async () => {
    const db = makeDb({ site: { status: 'archived' } });
    const job = await runFull(db);
    assert.equal(job.status, 'done', job.error);
    assert.equal(brokerLog.filter((x) => x.broker === 'publish').length, 0);
    assert.equal(job.results.edge_media, 'unreachable');
  });

  it('folder-name collision with a surviving camera → images kept and reported', async () => {
    const db = makeDb({ cams: ['X Y'], events: [], survivors: ['X_Y'] });
    const job = await runFull(db);
    assert.deepEqual(job.results.name_collisions, ['X Y']);
    assert.equal(brokerLog.filter((x) => x.broker === 'publish').length, 0);
  });

  it('crash mid-run (status left "running") → resume completes idempotently', async () => {
    let crashedState = null;
    const db = makeDb({ failOn: /^DELETE FROM cameras/, onFail: (st) => { crashedState = st.job; } });
    const plan = await sitePurge.planSitePurge(db, 7, {});
    await sitePurge.startSitePurge(db, plan, { edgeDrainMs: 0 });
    const failed = await waitJob(db);
    assert.equal(failed.status, 'failed');
    assert.equal(JSON.parse(crashedState).status, 'running');
    db.st.job = crashedState; // what a killed process leaves behind
    assert.equal(db.st.camerasDeleted, false);

    const job = await sitePurge.resumePendingPurge(db, { edgeDrainMs: 0 });
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(job.cameras, ['CAM A', 'C2'], 'camera list comes from the persisted job');
    assert.ok(db.st.camerasDeleted && db.st.siteDeleted);
    assert.equal(db.st.events.length, 0);
    assert.equal(JSON.parse(db.st.job).status, 'done');
    assertScoped(db.log);
  });

  it('widening appearing mid-run fails the job before cameras are deleted', async () => {
    const db = makeDb();
    const plan = await sitePurge.planSitePurge(db, 7, {});
    db.st.widened = [{ id: 11, username: 'late' }];
    await sitePurge.startSitePurge(db, plan, { edgeDrainMs: 0 });
    const job = await waitJob(db);
    assert.equal(job.status, 'failed');
    assert.match(job.error, /late/);
    assert.equal(db.st.camerasDeleted, false);
    assert.equal(db.st.siteDeleted, false);
  });

  it('refuses an empty camera list for camera-scoped helpers', async () => {
    await assert.rejects(sitePurge.deleteCameraData(makeDb(), []), /non-empty/);
    await assert.rejects(sitePurge.deleteCameraRows(makeDb(), []), /non-empty/);
    await assert.rejects(sitePurge.scrubAlertRules(makeDb(), []), /non-empty/);
  });
});

describe('routes/sites.js — purge endpoints', () => {
  function setup(pool) {
    const h = {};
    const app = {};
    for (const m of ['get', 'put', 'post', 'delete']) app[m] = (p, ...fns) => { h[`${m} ${p}`] = fns[fns.length - 1]; };
    sitesRoutes(app, pool, { auth: { requireAdmin: 'ADMIN' } });
    return h;
  }
  const res = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const req = (body) => ({ params: { id: '7' }, body, user: { id: 1, username: 'admin' } });

  it('confirm mismatch → 400, nothing deleted', async () => {
    const db = makeDb();
    const r = res();
    await setup(db)['post /api/sites/:id/purge'](req({ confirm: 'RMV' }), r);
    assert.equal(r.statusCode, 400);
    assert.ok(!db.log.some((e) => /^DELETE/.test(e.sql)));
  });
  it('blockers → 409', async () => {
    const db = makeDb({ site: { status: 'active' } });
    const r = res();
    await setup(db)['post /api/sites/:id/purge'](req({ confirm: 'rmv' }), r);
    assert.equal(r.statusCode, 409);
    assert.ok(r.body.blockers.length);
  });
  it('exact code → 202, job runs, purge-job reports it', async () => {
    const db = makeDb();
    const h = setup(db);
    const r = res();
    await h['post /api/sites/:id/purge'](req({ confirm: 'rmv' }), r);
    assert.equal(r.statusCode, 202);
    assert.equal(r.body.job.code, 'rmv');
    const done = await waitJob(db);
    assert.equal(done.status, 'done', done.error);
    const r2 = res();
    await h['get /api/sites/purge-job']({}, r2);
    assert.equal(r2.body.job.status, 'done');
    const r3 = res();
    await h['get /api/sites/:id/purge-plan'](req(), r3);
    assert.equal(r3.statusCode, 404, 'site is gone');
  });
});

describe('DELETE /api/cameras/:cameraId — shared purge pieces', () => {
  function setup(pool, cfg) {
    const h = {};
    const app = {};
    for (const m of ['get', 'put', 'post', 'patch', 'delete', 'use']) app[m] = (p, ...fns) => { h[`${m} ${p}`] = fns[fns.length - 1]; };
    const audit = [];
    camerasRoutes(app, pool, {
      auth: { requireAdmin: 'A', requireAdminOrAuditor: 'A' },
      loadCameraConfig: () => cfg, saveCameraConfig: () => true,
      loadGroups: () => ({ groups: [{ id: 'g', cameraIds: ['C2', 'OTHER'] }] }), saveGroups: () => true,
      logCameraAudit: async (...a) => audit.push(a), SNAPSHOT_DIR: cfg.snap,
    });
    return { del: h['delete /api/cameras/:cameraId'], audit };
  }
  const res = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

  it('deletes every camera-scoped table + events children + row', async () => {
    const snap = tmpSnap();
    const db = makeDb({ cams: ['C2'], camSite: { site_id: 7, code: 'hkt', status: 'active' } });
    const { del } = setup(db, { cameras: [{ camera_id: 'C2' }, { camera_id: 'OTHER' }], snap });
    const r = res();
    await del({ params: { cameraId: 'C2' }, query: {} }, r);
    assert.deepEqual(r.body, { success: true, kept_data: false });
    const sqls = db.log.map((e) => e.sql);
    for (const t of sitePurge.CAMERA_TABLES) assert.ok(sqls.some((s) => s.startsWith(`DELETE FROM ${t} WHERE ctid`)), `missing ${t}`);
    for (const t of sitePurge.EVENT_CHILDREN) assert.ok(sqls.some((s) => s.startsWith(`DELETE FROM ${t} WHERE event_id`)), `missing ${t}`);
    assert.ok(sqls.some((s) => s.startsWith('DELETE FROM events')));
    assert.ok(sqls.some((s) => s.startsWith('UPDATE alert_rules')));
    assert.ok(sqls.some((s) => s.startsWith('DELETE FROM cameras')));
    assert.ok(!fs.existsSync(path.join(snap, 'lpr/2026-10-02/C2')), 'central media removed');
    assert.ok(brokerLog.some((x) => x.broker === 'publish' && /delete-media/.test(x.args[0])), 'edge told to delete media');
    assertScoped(db.log);
    fs.rmSync(snap, { recursive: true, force: true });
  });

  it('keep_data=1 → no data delete, row still removed', async () => {
    const db = makeDb({ cams: ['C2'] });
    const { del } = setup(db, { cameras: [{ camera_id: 'C2' }] });
    const r = res();
    await del({ params: { cameraId: 'C2' }, query: { keep_data: '1' } }, r);
    assert.deepEqual(r.body, { success: true, kept_data: true });
    assert.ok(!db.log.some((e) => /^DELETE FROM events/.test(e.sql)));
    assert.ok(db.log.some((e) => /^DELETE FROM cameras/.test(e.sql)));
  });

  it('user that would be widened → 409 and nothing touched', async () => {
    const db = makeDb({ cams: ['C2'], widened: [{ id: 3, username: 'cam-only' }] });
    const { del } = setup(db, { cameras: [{ camera_id: 'C2' }] });
    const r = res();
    await del({ params: { cameraId: 'C2' }, query: {} }, r);
    assert.equal(r.statusCode, 409);
    assert.ok(!db.log.some((e) => /^(DELETE|UPDATE)/.test(e.sql)));
  });

  it('failure mid-way → 500 naming the step (no swallowed error)', async () => {
    const db = makeDb({ cams: ['C2'], failOn: /^DELETE FROM alert_logs/ });
    const { del } = setup(db, { cameras: [{ camera_id: 'C2' }] });
    const r = res();
    await del({ params: { cameraId: 'C2' }, query: {} }, r);
    assert.equal(r.statusCode, 500);
    assert.match(r.body.error, /data/);
    assert.deepEqual(r.body.done, ['config', 'alert_rules']);
    assert.ok(!db.log.some((e) => /^DELETE FROM cameras/.test(e.sql)));
  });
});

describe('scrubRecipients', () => {
  it('narrowing keeps the recipient on · emptying disables lpr', () => {
    const { list, touched } = sitePurge.scrubRecipients(
      [{ id: 'a', lpr_sites: ['x'] }, { id: 'b', lpr_sites: ['x', 'y'] }, { id: 'c', lpr_sites: [] }, null], 'x', []);
    assert.equal(list[0].lpr_enabled, false);
    assert.deepEqual(list[1].lpr_sites, ['y']);
    assert.equal(list[1].lpr_enabled, undefined);
    assert.equal(list[2].lpr_enabled, undefined);
    assert.deepEqual(touched.map((t) => t.id), ['a', 'b']);
  });
});

// ================================================================
// broker helpers — stubs only
// ================================================================
const MQTT_PATH = require.resolve('mqtt', { paths: [path.join(__dirname, '..', 'src', 'helpers')] });
const BA_PATH = require.resolve('../src/helpers/brokerAdmin');
const PUB_PATH = require.resolve('../src/helpers/mqttPublisher');

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  });
}
function withFakeMqtt(makeClient, fn) {
  const prev = require.cache[MQTT_PATH];
  require.cache[MQTT_PATH] = { id: MQTT_PATH, filename: MQTT_PATH, loaded: true, exports: { connect: () => makeClient() } };
  delete require.cache[BA_PATH]; delete require.cache[PUB_PATH];
  return Promise.resolve().then(fn).finally(() => {
    if (prev) require.cache[MQTT_PATH] = prev; else delete require.cache[MQTT_PATH];
    delete require.cache[BA_PATH]; delete require.cache[PUB_PATH];
  });
}
function fakeClient(onPublish) {
  const c = new EventEmitter();
  c.connected = false;
  c.subscribe = (_t, _o, cb) => cb(null, [{ qos: 1 }]);
  c.publish = (topic, payload, opts, cb) => onPublish(c, topic, payload, opts, cb);
  c.end = () => {};
  setImmediate(() => { c.connected = true; c.emit('connect'); });
  return c;
}

describe('broker helpers', () => {
  it('mqttPublisher.publishRaw sends a zero-length retained payload as-is', async () => {
    const seen = [];
    await withEnv({ MQTT_PUBLISHER_USER: 'p', MQTT_PUBLISHER_PASSWORD: 'x', MQTT_BROKER_URL: 'mqtt://stub' }, () =>
      withFakeMqtt(() => fakeClient((c, topic, payload, opts, cb) => { seen.push({ topic, payload, opts }); cb(); }), async () => {
        const pub = require(PUB_PATH);
        await pub.publishRaw('projects/rmv/_config/cameras', '', { retain: true });
        await pub.publish('t/json', { a: 1 });
      }));
    assert.deepEqual(seen[0], { topic: 'projects/rmv/_config/cameras', payload: '', opts: { qos: 1, retain: true } });
    assert.equal(seen[1].payload, '{"a":1}');
  });

  it('mosquitto: clearRetained → publisher raw empty retained · deleteSiteRole → dynsec deleteRole, "not found" ignored', async () => {
    const pubs = [], batches = [];
    await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PUBLISHER_USER: 'p', MQTT_PUBLISHER_PASSWORD: 'x',
      MQTT_PROVISIONER_USER: 'v', MQTT_PROVISIONER_PASSWORD: 'y', MQTT_BROKER_URL: 'mqtt://stub' }, () =>
      withFakeMqtt(() => fakeClient((c, topic, payload, opts, cb) => {
        if (topic === '$CONTROL/dynamic-security/v1') {
          const { commands } = JSON.parse(payload);
          batches.push(commands);
          setImmediate(() => c.emit('message', '$CONTROL/dynamic-security/v1/response',
            Buffer.from(JSON.stringify({ responses: [{ command: 'deleteRole', error: 'Role not found' }] }))));
          if (cb) cb();
          return;
        }
        pubs.push({ topic, payload, opts }); cb();
      }), async () => {
        const ba = require(BA_PATH);
        await ba.clearRetained('projects/rmv/_config/retention');
        await ba.deleteSiteRole('rmv');
      }));
    assert.deepEqual(pubs, [{ topic: 'projects/rmv/_config/retention', payload: '', opts: { qos: 1, retain: true } }]);
    assert.deepEqual(batches, [[{ command: 'deleteRole', rolename: 'site-rmv' }]]);
  });

  it('emqx: deleteSiteRole deletes edge-<code> ACL rules (404 ok) · clearRetained publishes empty retained', async () => {
    const calls = [];
    const prev = global.fetch;
    const responses = [{ json: { token: 't' } }, { ok: false, status: 404 }, { json: { token: 't' } }, { status: 200 }];
    let i = 0;
    global.fetch = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body });
      const r = responses[i++];
      return { ok: r.ok !== false, status: r.status || 200, json: async () => r.json };
    };
    try {
      await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'd' }, async () => {
        delete require.cache[BA_PATH];
        const ba = require(BA_PATH);
        await ba.deleteSiteRole('rmv');
        await ba.clearRetained('projects/rmv/_config/cameras');
      });
    } finally { global.fetch = prev; delete require.cache[BA_PATH]; }
    assert.equal(calls[1].url, 'http://localhost:18083/api/v5/authorization/sources/built_in_database/rules/users/edge-rmv');
    assert.equal(calls[1].method, 'DELETE');
    assert.equal(calls[3].url, 'http://localhost:18083/api/v5/publish');
    assert.equal(calls[3].body, JSON.stringify({ topic: 'projects/rmv/_config/cameras', payload: '', qos: 1, retain: true }));
  });
});
