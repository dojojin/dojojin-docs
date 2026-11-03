// ============================================================
// Vigil Platform — Tests: ไซต์ปิดปรับปรุง (sites.status <> 'active') ห้ามถูกงาน retention/purge ลบ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// pool ปลอม + โฟลเดอร์ใน tmp · ไม่แตะ DB/broker/ไฟล์จริง · ไม่ require edge/bridge.js (มัน connect MQTT)
// สองสิ่งที่ต้องพิสูจน์: ไม่มีไซต์แช่แข็ง = SQL เดิมทุกตัวอักษร · มีไซต์แช่แข็ง = id ของกล้องแช่แข็ง
// ไม่โผล่ในขอบเขตการลบเลย
'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { frozenScope } = require('../src/helpers/retentionScope');
const { pruneLprImages, pruneLprRows } = require('../src/lpr-retention');
const { enforcePartitionRetention } = require('../src/helpers/partitionRetention');
const { pruneEdgeFolder } = require('../src/edge/snapshot-retention');

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const quiet = async (fn) => {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
};

// sites/cameras ปลอม: FROZEN = กล้องของไซต์ maintenance
const LIVE = ['L1', 'L2'];
const FROZEN = ['F1', 'F2'];
function scopeRows(sql, frozen) {
  if (/FROM sites WHERE status <> 'active'/.test(sql)) return { rows: frozen ? [{ code: 'vss3' }] : [] };
  if (/FROM cameras c LEFT JOIN sites s/.test(sql)) {
    return { rows: [...LIVE.map(id => ({ id, frozen: false })), ...(frozen ? FROZEN : []).map(id => ({ id, frozen: true }))] };
  }
  return null;
}

describe('frozenScope', () => {
  it('query ล้ม → โยน (fail closed ไม่ใช่ Set ว่าง)', async () => {
    await quiet(() => assert.rejects(frozenScope({ query: async () => { throw new Error('db down'); } }), /db down/));
  });
  it('ทุกไซต์ active → frozenCams ว่าง · liveCams ครบ', async () => {
    const r = await frozenScope({ query: async (sql) => scopeRows(sql, false) });
    assert.deepEqual(r, { frozenCams: [], frozenSiteCodes: [], liveCams: LIVE });
  });
});

const JOB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-freeze-'));
after(() => fs.rmSync(JOB_DIR, { recursive: true, force: true }));

// ดึง enforceRetention / enforceRawXmlRetention จาก timer ที่ start() ตั้งไว้ (harness เดียวกับ retention-face-embeddings)
function startJobs(pool, settings = {}) {
  const realST = global.setTimeout, realSI = global.setInterval;
  const scheduled = new Map();
  global.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { scheduled.set(ms, fn); return { unref() {} }; } return realST(fn, ms, ...a); };
  global.setInterval = () => ({ unref() {} });
  const failures = [];
  try {
    const dir = JOB_DIR;
    require('../src/jobs/retention').start({
      pool, getSystemSetting: async (_p, k) => settings[k] ?? (k === 'data_retention_days' ? '100' : null),
      retentionBeat: { beat() {}, beatFail(...a) { failures.push(a); } },
      SNAPSHOT_DIR: dir, THUMBS_DIR: dir, BBOX_CACHE_DIR: dir, MEDIA_DIR: dir, REPORTS_DIR: dir, FILES_DIR: dir,
    });
  } finally { global.setTimeout = realST; global.setInterval = realSI; }
  return { scheduled, failures };
}

function recordingPool(frozen) {
  const sqls = [];
  return {
    sqls,
    query: async (sql, args = []) => {
      sqls.push({ sql: norm(sql), args });
      const s = scopeRows(sql, frozen);
      if (s) return s;
      // SELECT id ของแต่ละกล้อง → คืน 1 แถว (ต่ำกว่า batch = จบลูปกล้องนั้น)
      if (/^SELECT id FROM events/.test(norm(sql))) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}

// ทุก query ที่มี id กล้องแช่แข็งใน params ต้องเป็นการ "กันออก" (<> ALL) หรือคำถามอ่านอย่างเดียว ไม่ใช่ขอบเขตลบ
function assertNoFrozenScope(sqls) {
  for (const { sql, args } of sqls) {
    const flat = JSON.stringify(args);
    if (!FROZEN.some(f => flat.includes(`"${f}"`))) continue;
    assert.match(sql, /<> ALL\(\$3::text\[\]\)/, `frozen id ใน params ของ: ${sql}`);
  }
}

describe('enforceRetention', () => {
  const ORIGINAL_EVENTS_SELECT = norm(`SELECT id FROM events WHERE event_time < $1 AND event_type IS DISTINCT FROM 'anprAlarm'
             ORDER BY event_time LIMIT $2`);

  it('ไม่มีไซต์แช่แข็ง → SQL events/face/appearances เดิมทุกตัวอักษร', async () => {
    const pool = recordingPool(false);
    const { scheduled, failures } = startJobs(pool, { appearances_retention_days: '50' });
    await quiet(() => scheduled.get(300 * 1000)());
    assert.deepEqual(failures, []);
    const evSel = pool.sqls.filter(s => /^SELECT id FROM events/.test(s.sql));
    assert.equal(evSel.length, 1);
    assert.equal(evSel[0].sql, ORIGINAL_EVENTS_SELECT);
    assert.equal(evSel[0].args.length, 2);
    for (const t of ['face_embeddings', 'face_embed_queue']) {
      const s = pool.sqls.find(x => x.sql.startsWith(`DELETE FROM ${t} WHERE id IN`));
      assert.doesNotMatch(s.sql, /camera_id/, `${t} ต้องไม่มีตัวกรองกล้อง`);
      assert.equal(s.args.length, 2);
    }
    const ap = pool.sqls.filter(x => x.sql.startsWith('DELETE FROM appearances WHERE id IN'));
    assert.equal(ap.length, 1);
    assert.doesNotMatch(ap[0].sql, /camera_id/);
  });

  it('มีไซต์แช่แข็ง → รายกล้องเฉพาะ liveCams + รอบ NULL · id แช่แข็งไม่อยู่ในขอบเขตลบ', async () => {
    const pool = recordingPool(true);
    const { scheduled, failures } = startJobs(pool, { appearances_retention_days: '50' });
    await quiet(() => scheduled.get(300 * 1000)());
    assert.deepEqual(failures, []);
    const evSel = pool.sqls.filter(s => /^SELECT id FROM events/.test(s.sql));
    assert.deepEqual(evSel.map(s => s.args[2] ?? null), [...LIVE, null]);
    assert.ok(evSel.every(s => !s.sql.includes('IS NULL') || s.args.length === 2));
    assert.ok(!pool.sqls.some(s => s.sql === ORIGINAL_EVENTS_SELECT), 'ห้ามใช้ลูปรวมตอนมีไซต์แช่แข็ง');
    // ลบลูกครบ 6 ตารางต่อ batch เหมือนเดิม
    for (const t of ['appearances', 'license_plates', 'face_event_notes', 'face_event_acks', 'lpr_alert_acks']) {
      assert.equal(pool.sqls.filter(s => s.sql.startsWith(`DELETE FROM ${t} WHERE event_id = ANY`)).length, 3, t);
    }
    // appearances retention: รายกล้อง live เท่านั้น ไม่มีรอบ NULL
    const ap = pool.sqls.filter(x => x.sql.startsWith('DELETE FROM appearances WHERE id IN'));
    assert.deepEqual(ap.map(s => s.args[2]), LIVE);
    assertNoFrozenScope(pool.sqls);
  });

  it('อ่านสถานะไซต์ไม่ได้ → ไม่ลบอะไรเลย + beatFail', async () => {
    const sqls = [];
    const pool = { query: async (sql) => { sqls.push(norm(sql)); if (/FROM sites/.test(sql)) throw new Error('boom'); return { rows: [], rowCount: 0 }; } };
    const { scheduled, failures } = startJobs(pool);
    await quiet(() => scheduled.get(300 * 1000)());
    assert.equal(failures.length, 1);
    assert.ok(!sqls.some(s => /^(DELETE|UPDATE)/.test(s)), 'ห้ามมี DELETE/UPDATE เลย');
  });

  it('rawXml: มีไซต์แช่แข็ง → UPDATE เฉพาะกล้องที่เปิด · ไม่มี → SQL เดิม', async () => {
    let pool = recordingPool(true);
    let j = startJobs(pool);
    await quiet(() => j.scheduled.get(420 * 1000)());
    let sel = pool.sqls.filter(s => /^SELECT id FROM events/.test(s.sql));
    assert.deepEqual(sel.map(s => s.args[2] ?? null), [...LIVE, null]);
    assertNoFrozenScope(pool.sqls);

    pool = recordingPool(false);
    j = startJobs(pool);
    await quiet(() => j.scheduled.get(420 * 1000)());
    sel = pool.sqls.filter(s => /^SELECT id FROM events/.test(s.sql));
    assert.equal(sel.length, 1);
    assert.equal(sel[0].sql, norm(`SELECT id FROM events WHERE event_time < $1 AND raw_json ? 'rawXml' ORDER BY event_time LIMIT $2`));
  });

  it('snapshot: ข้ามโฟลเดอร์กล้องแช่แข็ง + ไฟล์แบน prefix กล้องแช่แข็ง', async () => {
    const pool = recordingPool(true);
    const realST = global.setTimeout, realSI = global.setInterval;
    const scheduled = new Map();
    global.setTimeout = (fn, ms, ...a) => { if (ms >= 1000) { scheduled.set(ms, fn); return { unref() {} }; } return realST(fn, ms, ...a); };
    global.setInterval = () => ({ unref() {} });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-freeze-snap-'));
    try {
      require('../src/jobs/retention').start({
        pool, getSystemSetting: async () => '30', retentionBeat: { beat() {}, beatFail() {} },
        SNAPSHOT_DIR: dir, THUMBS_DIR: path.join(dir, 't'), BBOX_CACHE_DIR: path.join(dir, 'b'),
        MEDIA_DIR: dir, REPORTS_DIR: dir, FILES_DIR: dir,
      });
    } finally { global.setTimeout = realST; global.setInterval = realSI; }
    const old = (Date.now() - 60 * 86400_000) / 1000;
    const mk = (...p) => { const f = path.join(dir, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.utimesSync(f, old, old); return f; };
    const keepA = mk('events', '2020-01-01', 'F1', '0000', 'a.jpg');
    const keepB = mk('F2_face_1_2.jpg');
    const goneA = mk('events', '2020-01-01', 'L1', '0000', 'a.jpg');
    const goneB = mk('L1_face_1_2.jpg');
    await quiet(() => scheduled.get(330 * 1000)());
    assert.ok(fs.existsSync(keepA) && fs.existsSync(keepB), 'ไฟล์กล้องแช่แข็งต้องอยู่');
    assert.ok(!fs.existsSync(goneA) && !fs.existsSync(goneB), 'ไฟล์กล้องที่เปิดอยู่ถูกลบตามปกติ');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('LPR retention', () => {
  it('pruneLprRows: ไม่มีแช่แข็ง = SQL เดิม · มี = รายกล้อง live + NULL', async () => {
    let pool = recordingPool(false);
    await pruneLprRows(pool, '2020-01-01', 10000, { frozenCams: [], liveCams: LIVE });
    assert.equal(pool.sqls[0].sql, `SELECT id FROM events WHERE event_type = 'anprAlarm' AND event_time < $1 ORDER BY event_time LIMIT $2`);
    pool = recordingPool(true);
    await pruneLprRows(pool, '2020-01-01', 10000, { frozenCams: FROZEN, liveCams: LIVE });
    const sel = pool.sqls.filter(s => /^SELECT id FROM events/.test(s.sql));
    assert.deepEqual(sel.map(s => s.args[2] ?? null), [...LIVE, null]);
    assertNoFrozenScope(pool.sqls);
  });

  it('pruneLprImages: ไม่มีแช่แข็ง = rm -rf ทั้ง date-dir · มี = ลบรายกล้องข้ามตัวแช่แข็ง (รวมวัน boundary)', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-freeze-lpr-'));
    const root = path.join(base, 'lpr');
    const cutoff = Date.now() - 7 * 86400_000;
    const boundary = new Date(cutoff).toISOString().slice(0, 10);
    const old = (cutoff - 3600_000) / 1000;
    const mk = (...p) => { const f = path.join(root, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.utimesSync(f, old, old); return f; };
    try {
      mk('2020-01-01', 'L1', '0000', 'a.jpg'); mk('2020-01-01', 'F1', '0000', 'a.jpg');
      let r = await quiet(() => pruneLprImages(root, cutoff));
      assert.equal(r.dirsRemoved, 1);
      assert.ok(!fs.existsSync(path.join(root, '2020-01-01')), 'fast path เดิม');

      mk('2020-01-01', 'L1', '0000', 'a.jpg'); const fz = mk('2020-01-01', 'F1', '0000', 'a.jpg');
      mk('2020-01-02', 'L2', '0000', 'a.jpg');                       // ไม่มีกล้องแช่แข็ง → fast path
      const bL = mk(boundary, 'L1', '0000', 'b.jpg'); const bF = mk(boundary, 'F1', '0000', 'b.jpg');
      r = await quiet(() => pruneLprImages(root, cutoff, { frozenDirs: new Set(['F1']) }));
      assert.ok(fs.existsSync(fz), 'โฟลเดอร์กล้องแช่แข็งในวันเก่าต้องอยู่');
      assert.ok(!fs.existsSync(path.join(root, '2020-01-01', 'L1')), 'กล้องอื่นในวันเดียวกันถูกลบ');
      assert.ok(!fs.existsSync(path.join(root, '2020-01-02')), 'วันที่ไม่มีกล้องแช่แข็งยัง rm -rf ได้');
      assert.equal(r.dirsRemoved, 1);
      assert.ok(fs.existsSync(bF) && !fs.existsSync(bL), 'วัน boundary (รายไฟล์) ก็ข้ามกล้องแช่แข็ง');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

describe('partition retention', () => {
  const ROWS = [{ relname: 'events_y2020m01', parent: 'events', bound: "FOR VALUES FROM ('2020-01-01 00:00:00+00') TO ('2020-02-01 00:00:00+00')", bytes: '100' }];
  const SETTINGS = [{ key: 'data_retention_days', value: '30' }, { key: 'lpr_retention_days', value: '30' }, { key: 'partition_drop_enabled', value: 'true' }];
  function partPool({ frozen, hasFrozenRows }) {
    const sqls = [];
    return {
      sqls,
      query: async (sql, args) => {
        sqls.push(norm(sql));
        const s = scopeRows(sql, frozen);
        if (s) return s;
        if (/system_settings/.test(sql)) return { rows: SETTINGS };
        if (/FROM pg_class c/.test(sql)) return { rows: ROWS };
        if (/^SELECT 1 FROM events_y2020m01 WHERE camera_id = ANY/.test(norm(sql))) {
          assert.deepEqual(args[0], FROZEN);
          return { rowCount: hasFrozenRows ? 1 : 0, rows: [] };
        }
        if (/pg_constraint/.test(sql)) return { rows: [{ t: 'license_plates' }] };
        return { rows: [], rowCount: 0 };
      },
    };
  }

  it('partition มีแถวของไซต์แช่แข็ง → ไม่ DROP + รายงานใน held', async () => {
    const pool = partPool({ frozen: true, hasFrozenRows: true });
    const r = await quiet(() => enforcePartitionRetention(pool));
    assert.deepEqual(r.dropped, []);
    assert.equal(r.held.length, 1);
    assert.deepEqual(r.held[0].sites, ['vss3']);
    assert.ok(!pool.sqls.some(s => /^DROP TABLE|^DELETE/.test(s)));
  });

  it('ไม่มีไซต์แช่แข็ง → DROP ตามเดิม ไม่ถาม partition', async () => {
    const pool = partPool({ frozen: false });
    const r = await quiet(() => enforcePartitionRetention(pool));
    assert.equal(r.dropped.length, 1);
    assert.ok(!pool.sqls.some(s => /^SELECT 1 FROM events_y/.test(s)));
    assert.ok(pool.sqls.some(s => s === 'DROP TABLE events_y2020m01 CASCADE'));
  });
});

describe('publishSiteRetention hold', () => {
  it('ส่ง hold เป็น boolean เสมอ: maintenance → true · active → false', async () => {
    const brokerAdmin = require('../src/helpers/brokerAdmin');
    const orig = { isConfigured: brokerAdmin.isConfigured, publish: brokerAdmin.publish };
    const sent = [];
    brokerAdmin.isConfigured = () => true;
    brokerAdmin.publish = async (topic, payload) => { sent.push({ topic, payload }); };
    try {
      const publish = require('../src/helpers/publishSiteRetention');
      for (const status of ['maintenance', 'active']) {
        await quiet(() => publish(7, { query: async () => ({ rows: [{ code: 'vss3', status, retention_events_days: null,
          retention_lpr_days: null, retention_face_days: null, retention_min_free_gb: 50 }] }) }));
      }
    } finally { Object.assign(brokerAdmin, orig); }
    assert.deepEqual(sent.map(s => [s.topic, s.payload.hold]),
      [['projects/vss3/_config/retention', true], ['projects/vss3/_config/retention', false]]);
  });

  it('status route + boot republish เรียก publishSiteRetention (ระดับซอร์ส)', () => {
    const sites = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sites.js'), 'utf8');
    const i = sites.indexOf("app.put('/api/sites/:id/status'");
    const j = sites.indexOf('app.post(', i);
    assert.match(sites.slice(i, j), /UPDATE sites SET status=[\s\S]*publishSiteRetention\(id, pool\)/);
    const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-server.js'), 'utf8');
    assert.match(api, /OR retention_face_days IS NOT NULL\s+OR status <> 'active'/);
  });
});

describe('edge hold', () => {
  it('pruneEdgeFolder hold → ไม่ลบตามอายุ แต่ยังลบตาม min_free_gb', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-freeze-edge-'));
    try {
      for (const n of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.mkdirSync(path.join(d, 'events', n), { recursive: true });
      let r = await quiet(() => pruneEdgeFolder(d, 'events', 7, { hold: true }));
      assert.equal(r.by_age, 0);
      assert.equal(r.held, 'site_hold');
      assert.equal(fs.readdirSync(path.join(d, 'events')).length, 3, 'hold = วันเก่าอยู่ครบ');
      let free = 5;
      r = await quiet(() => pruneEdgeFolder(d, 'events', 7, { hold: true, minFreeGb: 50, _readMount: () => { const f = free; free += 50; return { free_gb: f }; } }));
      assert.equal(r.by_age, 0);
      assert.equal(r.by_space, 1, 'ดิสก์ใกล้เต็มยังลบได้');
      assert.ok(!fs.existsSync(path.join(d, 'events', '2020-01-01')));
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it('bridge._prune ส่ง hold ทุกโฟลเดอร์ + hold ค้างข้าม boot ด้วยไฟล์ (ระดับซอร์ส)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'edge', 'bridge.js'), 'utf8');
    const p = src.slice(src.indexOf('const _prune = async'), src.indexOf('setTimeout(_prune'));
    assert.equal((p.match(/minFreeGb: _retention\.min_free_gb, hold \}/g) || []).length, 2);
    assert.match(src, /_retention\.hold = fs\.existsSync\(HOLD_FILE\)/);
    assert.match(src, /if \('hold' in cfg\)/);
  });
});

describe('POST /api/storage/purge', () => {
  function setupStorage(frozen, snapDir) {
    const handlers = {};
    const app = { get: (p, fn) => { handlers[`get ${p}`] = fn; }, post: (p, fn) => { handlers[`post ${p}`] = fn; } };
    const pool = { query: async (sql, args) => {
      const s = scopeRows(sql, frozen);
      if (s) return s;
      if (/SELECT code FROM sites WHERE code = \$1/.test(sql)) return { rows: [{ code: args[0] }] };
      throw new Error('unhandled ' + sql);
    } };
    const realSI = global.setInterval, realST = global.setTimeout;
    global.setTimeout = global.setInterval = () => ({ unref() {} });
    try { require('../src/routes/storage')(app, pool, { SNAPSHOT_DIR: snapDir }); }
    finally { global.setInterval = realSI; global.setTimeout = realST; }
    return handlers['post /api/storage/purge'];
  }
  const res = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

  it('edge ของไซต์ปิดปรับปรุง → 409 ไม่ส่งคำสั่ง', async () => {
    const h = setupStorage(true, os.tmpdir());
    const r = res();
    await h({ body: { machine: 'vss3', category: 'events', days: 7, dryRun: false, confirmFiles: 1 } }, r);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, 'ไซต์นี้ปิดปรับปรุงอยู่ — ห้ามล้างข้อมูล');
  });

  it('central dry-run ข้ามโฟลเดอร์กล้องแช่แข็ง', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-freeze-purge-'));
    const old = (Date.now() - 60 * 86400_000) / 1000;
    for (const cam of ['L1', 'F1']) {
      const f = path.join(d, 'events', '2020-01-01', cam, '0000', 'a.jpg');
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.utimesSync(f, old, old);
    }
    try {
      const r = res();
      await setupStorage(true, d)({ body: { category: 'events', days: 7 } }, r);
      assert.equal(r.body.files, 1);
      assert.deepEqual(r.body.sample, [path.join('events', '2020-01-01', 'L1', '0000', 'a.jpg')]);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
});
