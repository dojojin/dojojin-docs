// Vigil Platform — ยามเฝ้าความเร็วรายวัน (preventive P2 · 2026-10-06)
// pool/sender ปลอม · ไม่มี DB/LINE จริง
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pw = require('../src/helpers/perfWatch');

const cfg = pw.settings({ enabled: true, recipient_ids: ['U-test-owner'] });

test('defaults are off with no recipients', () => {
  const d = pw.settings(undefined);
  assert.equal(d.enabled, false);
  assert.deepEqual(d.recipient_ids, []);
});

test('decide flags a query that got 2x slower than its 7-day median, ignores noise', () => {
  const hist = new Map([['1', [800, 900, 1000]], ['2', [3000, 3100]], ['3', [100]]]);
  const today = [
    { queryid: 1, calls: 10, mean_ms: 2500, query_head: 'SELECT slow' },   // 2.8x of 900 → flag
    { queryid: 2, calls: 10, mean_ms: 4000, query_head: 'SELECT ok' },     // 1.3x → no
    { queryid: 3, calls: 10, mean_ms: 500,  query_head: 'SELECT tiny' },   // under min_ms → no
    { queryid: 4, calls: 2,  mean_ms: 9000, query_head: 'SELECT rare' },   // under min_calls → no
    { queryid: 5, calls: 5,  mean_ms: 6000, query_head: 'SELECT new' },    // no history, > 5 s → fresh
    { queryid: 6, calls: 5,  mean_ms: 2000, query_head: 'SELECT new ok' }, // no history, < 5 s → no
  ];
  const r = pw.decide(today, hist, cfg);
  assert.deepEqual(r.regressions.map(q => q.queryid), [1]);
  assert.equal(r.regressions[0].baseline_ms, 900);
  assert.deepEqual(r.fresh.map(q => q.queryid), [5]);
});

test('decide: a query whose SQL text changed (new queryid) is compared with its predecessor, not flagged as new', () => {
  const head = 'SELECT COUNT(*) FILTER (WHERE lp.no_helmet) AS no_helmet, COUNT(*) AS total FROM license_plates lp LEFT JOIN lpr_watchlist w ON w.plate_number = UPPER(lp.plate_number)';
  const hist = new Map([['100', [6000, 6200]], ['200', [9000]]]);
  hist.heads = new Map([['100', head], ['200', 'SELECT something entirely different FROM events e WHERE e.id = $1']]);
  const today = [
    { queryid: 101, calls: 5, mean_ms: 6300, query_head: head },                                 // แก้ข้อความ เร็วเท่าเดิม → เงียบ
    { queryid: 102, calls: 5, mean_ms: 15000, query_head: head.replace('total', 'n_total') },    // ตัวเดิมแต่ช้าลงจริง → regression
    { queryid: 103, calls: 5, mean_ms: 7000, query_head: 'SELECT brand new FROM appearances a WHERE a.x = $1' }, // ใหม่จริง → fresh
  ];
  const r = pw.decide(today, hist, cfg);
  assert.deepEqual(r.fresh.map(q => q.queryid), [103]);
  assert.deepEqual(r.regressions.map(q => [q.queryid, q.renamed_from]), [[102, '100']]);
});

test('slow-req counter reads only today’s [slow-req] lines', async () => {
  const f = path.join(os.tmpdir(), `pw-${process.pid}.log`);
  fs.writeFileSync(f, [
    '2026-10-05 23:59:59.000: [slow-req] 200 3000ms GET /x',
    '2026-10-06 08:00:00.000: [slow-req] 200 2500ms GET /a',
    '2026-10-06 09:00:00.000: [lpr-query] something else',
    '2026-10-06 10:00:00.000: [slow-req] 500 120000ms GET /b',
  ].join('\n'));
  try { assert.equal(await pw.countSlowReq('2026-10-06', f), 2); }
  finally { fs.unlinkSync(f); }
  assert.equal(await pw.countSlowReq('2026-10-06', '/nonexistent/file'), null);
});

test('notify sends one batched LINE to the configured recipient, honours cooldown, never sends unconfigured', async () => {
  const engine = require('../src/alert-engine');
  const sent = [];
  const lineSender = { pushLineMessage: async (_t, to, msgs) => { sent.push({ to, text: msgs[0].text }); return { success: true }; } };
  const pool = { query: async (sql) => {
    if (/SELECT enabled, channel_access_token FROM line_config/.test(sql)) return { rows: [{ enabled: true, channel_access_token: 'test-token' }] };
    throw new Error('unexpected SQL ' + sql.slice(0, 40));
  } };
  await engine._testInit({ pool, lineSender, config: {} });
  const now = new Date('2026-10-06T11:25:00Z');
  const payload = { day: '2026-10-06', alerted: { 'q:9': new Date(now - 2 * 3600_000).toISOString() },
    regressions: [{ queryid: 1, calls: 10, mean_ms: 2500, baseline_ms: 900, query_head: 'SELECT slow' },
                  { queryid: 9, calls: 10, mean_ms: 9000, baseline_ms: 900, query_head: 'SELECT cooled' }],
    fresh: [], slow_req: 150, slow_req_limit: 100,
    stale_tables: [{ table: 'face_embeddings', gb: 15, changed: 120000, analyzed_at: null }] };
  await pw.notify(pool, cfg, payload, now);
  assert.equal(sent.length, 1, 'ทุกเรื่องรวมเป็นข้อความเดียว');
  assert.equal(sent[0].to, 'U-test-owner');
  assert.match(sent[0].text, /SELECT slow/);
  assert.doesNotMatch(sent[0].text, /SELECT cooled/, 'เรื่องที่แจ้งไปแล้วใน 24 ชม. ห้ามซ้ำ');
  assert.match(sent[0].text, /คำขอเกิน 2 วิ วันนี้ 150/);
  assert.match(sent[0].text, /face_embeddings/);
  assert.ok(payload.alerted['q:1'] && payload.alerted['slow-req'] && payload.alerted['t:face_embeddings']);

  sent.length = 0;
  await pw.notify(pool, pw.settings({ enabled: true, recipient_ids: [] }), { ...payload, alerted: {} }, now);
  assert.equal(sent.length, 0, 'ไม่มีผู้รับ = ไม่ส่งหาใคร');
});

test('api-server schedules the watch; helmet metric passes recipient objects to _pushToAll', () => {
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(rd('src/api-server.js'), /require\('\.\/helpers\/perfWatch'\)\.start\(pool\);/);
  assert.match(rd('src/helpers/helmetMetricCheck.js'), /cfg\.recipient_ids\.map\(id => \(\{ id \}\)\)/);
  assert.match(rd('db/db_migration_256_autovacuum_and_perf_watch.sql'), /DEFAULT '\{"enabled": false, "recipient_ids": \[\]\}'::jsonb/);
});

test('first day without any history only records — no "new slow query" flood', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/helpers/perfWatch.js'), 'utf8');
  assert.match(s, /const fresh = hist\.size \? d\.fresh : \[\];/);
});

// preventive P4 (2026-10-06): ตัวตรวจตอน commit ต้องครอบตารางใหญ่ทุกตัวที่เคยทำให้ช้า
test('check-events covers every big table that has caused a full scan', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'scripts/check-events-queries.js'), 'utf8');
  for (const t of ['events', 'license_plates', 'appearances', 'face_embeddings', 'face_embed_queue'])
    assert.match(s, new RegExp(`const TABLE_RE[^\\n]*\\b${t}\\b`), t);
  const { scan } = require('../scripts/check-events-queries.js');
  assert.deepEqual(scan(), [], 'โค้ดปัจจุบันต้องผ่านตัวตรวจ');
});

test('slow-req counter skips image transfers and reports the busiest routes', async () => {
  const f = path.join(os.tmpdir(), `pw-${process.pid}-img.log`);
  fs.writeFileSync(f, [
    '2026-10-09 11:00:00.000: [slow-req] 200 3500ms GET /api/hcp/picture?u=Dev%3A%2F%2Fx user=a ip=1',
    '2026-10-09 11:00:01.000: [slow-req] 200 8000ms GET /snapshots/events%2F1.jpg user=a ip=1',
    '2026-10-09 11:00:02.000: [slow-req] 200 4000ms GET /api/lpr/stats?period=today user=a ip=1',
    '2026-10-09 11:00:03.000: [slow-req] 200 5000ms GET /api/lpr/stats?period=today user=a ip=1',
    '2026-10-09 11:00:04.000: [slow-req] 200 2500ms GET /api/events user=a ip=1',
  ].join('\n') + '\n');
  try {
    const r = await pw.scanSlowReq('2026-10-09', f);
    assert.equal(r.n, 3);
    assert.equal(r.skipped, 2);
    assert.deepEqual(r.top[0], { route: '/api/lpr/stats', count: 2 });
    assert.equal(await pw.countSlowReq('2026-10-09', f), 3);
  } finally { fs.unlinkSync(f); }
});

test('slow-req alert text names the routes behind the number', async () => {
  const sent = [];
  const engine = require('../src/alert-engine');
  const orig = engine._pushToAll;
  engine._pushToAll = async (_t, _r, msgs) => { sent.push(msgs[0].text); return { sent: 1 }; };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'x' }] }) };
  try {
    await pw.notify(pool, cfg, { day: '2026-10-09', regressions: [], fresh: [], stale_tables: [], alerted: {},
      slow_req: 150, slow_req_limit: 100, slow_req_top: [{ route: '/api/lpr/stats', count: 90 }] });
  } finally { engine._pushToAll = orig; }
  assert.match(sent[0], /ช้าบ่อยสุด: \/api\/lpr\/stats ×90/);
});

test('xid age: alerts at 150M with the table name, quiet below, and respects cooldown', async () => {
  const sent = [];
  const engine = require('../src/alert-engine');
  const orig = engine._pushToAll;
  engine._pushToAll = async (_t, _r, msgs) => { sent.push(msgs[0].text); return { sent: 1 }; };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'x' }] }) };
  const base = { day: '2026-10-10', regressions: [], fresh: [], stale_tables: [], alerted: {}, slow_req: 0, slow_req_limit: 100 };
  try {
    await pw.notify(pool, cfg, { ...base, xid_age: 149_000_000, xid_age_table: 'license_plates', xid_age_warn: 150_000_000 });
    assert.equal(sent.length, 0);                                    // ต่ำกว่าเกณฑ์ = เงียบ
    const hot = { ...base, alerted: {}, xid_age: 160_000_000, xid_age_table: 'license_plates', xid_age_warn: 150_000_000 };
    await pw.notify(pool, cfg, hot);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /160M \(ตาราง license_plates\)/);
    assert.ok(hot.alerted['xid-age']);
    await pw.notify(pool, cfg, hot);                                  // ยังอยู่ใน cooldown 24 ชม.
    assert.equal(sent.length, 1);
  } finally { engine._pushToAll = orig; }
});

test('xid age threshold is configurable and defaults to 150M', () => {
  assert.equal(pw.settings(undefined).xid_age_warn, 150_000_000);
  assert.equal(pw.settings({ xid_age_warn: 120_000_000 }).xid_age_warn, 120_000_000);
});

test('oldestXid reads the oldest relation from pg_class', async () => {
  const r = await pw.oldestXid({ query: async () => ({ rows: [{ relname: 'license_plates', age: '134015346' }] }) });
  assert.deepEqual(r, { table: 'license_plates', age: 134015346 });
});

test('oldestXid passes the size threshold so tiny tables are ignored', async () => {
  let seen;
  const pool = { query: async (sql, params) => { seen = { sql, params }; return { rows: [] }; } };
  await pw.oldestXid(pool, 1024 ** 3);
  assert.deepEqual(seen.params, [1024 ** 3]);
  assert.match(seen.sql, /pg_total_relation_size\(c\.oid\) >= \$1/);
  await pw.oldestXid(pool);
  assert.deepEqual(seen.params, [0]);
});

test('decide: rollup writers are not ratio-judged, only flagged above the absolute ceiling', () => {
  const head = 'INSERT INTO event_kpi_hourly (camera_id, bucket_hour, total) SELECT $1';
  const hist = new Map([['7', [400, 400, 400]]]);
  const mk = (queryid, mean_ms) => ({ queryid, calls: 10, mean_ms, query_head: head });
  // (a) 4x ของค่ากลาง แต่ต่ำกว่าเพดาน → เงียบ ไม่เข้า fresh
  let r = pw.decide([mk(7, 1600)], hist, cfg);
  assert.deepEqual(r, { regressions: [], fresh: [] });
  // (b) เกินเพดาน → เตือน พร้อมธง rollup
  r = pw.decide([mk(7, 70000)], hist, cfg);
  assert.equal(r.regressions.length, 1);
  assert.equal(r.regressions[0].rollup, true);
  assert.equal(r.regressions[0].baseline_ms, 400);
  // (c) ไม่มีประวัติ เฉลี่ย 9 วิ → ไม่เป็น fresh
  r = pw.decide([mk(8, 9000)], new Map([['1', [100]]]), cfg);
  assert.deepEqual(r, { regressions: [], fresh: [] });
  // ไม่มีประวัติ เกินเพดาน → baseline null
  r = pw.decide([mk(8, 90000)], new Map([['1', [100]]]), cfg);
  assert.equal(r.regressions[0].baseline_ms, null);
});

test('probe: reads the cold LPR-today timing from the probe user lines only', async () => {
  const f = path.join(os.tmpdir(), `pw-${process.pid}-probe.log`);
  fs.writeFileSync(f, [
    '2026-10-10 18:12:10.000: [slow-req] 200 4200ms GET /api/lpr/stats?range=7d user=zz_perf_123 ip=127.0.0.1',
    '2026-10-10 18:12:15.000: [slow-req] 200 2100ms GET /api/health/details user=zz_perf_123 ip=127.0.0.1',
    '2026-10-10 11:00:00.000: [slow-req] 200 9000ms GET /api/lpr/stats?period=today user=asarn ip=1.2.3.4',
  ].join('\n') + '\n');
  try {
    const r = await pw.scanSlowReq('2026-10-10', f);
    assert.equal(r.probeLpr, 4200);                       // ผู้ใช้จริง 9000 ไม่ปน
    assert.equal((await pw.scanSlowReq('2026-10-11', f)).probeLpr, null);
  } finally { fs.unlinkSync(f); }
});

test('probe: alerts when cold LPR-today is over the ceiling, quiet when absent or under', async () => {
  const sent = [];
  const engine = require('../src/alert-engine');
  const orig = engine._pushToAll;
  engine._pushToAll = async (_t, _r, msgs) => { sent.push(msgs[0].text); return { sent: 1 }; };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'x' }] }) };
  const base = { day: '2026-10-10', regressions: [], fresh: [], stale_tables: [], alerted: {}, slow_req: 0, slow_req_limit: 100 };
  try {
    await pw.notify(pool, cfg, { ...base, probe_lpr_today_ms: null, probe_lpr_limit_ms: 3000 });
    await pw.notify(pool, cfg, { ...base, probe_lpr_today_ms: 2900, probe_lpr_limit_ms: 3000 });
    assert.equal(sent.length, 0);
    await pw.notify(pool, cfg, { ...base, probe_lpr_today_ms: 4200, probe_lpr_limit_ms: 3000 });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /LPR "วันนี้".*4\.2 วิ.*เพดาน 3\.0 วิ/);
  } finally { engine._pushToAll = orig; }
  assert.equal(pw.settings(undefined).probe_lpr_ms, 3000);
});


// 2026-10-21: คิวรีหน้าเหตุการณ์ตัวเดียวกันแต่เลือกตัวกรองต่างกัน ($8 / $9 / $10 ในหัว) ถูกจับคู่กับรูปที่ไม่กรอง (0.16 วิ)
// แล้วเตือน "ช้าลง" ทั้งที่แค่เลือกตัวกรองที่หนักกว่า — ตำแหน่ง placeholder ในหัวต้องตรงกันถึงนับเป็นตัวเดิม
test('decide: same SQL head with different placeholder positions is a different shape, not a regression of it', () => {
  const head = (n) => `SELECT e.*, COALESCE(e.snapshot_filename, e.raw_json->>$${n}) AS snapshot_file, e.raw_json->>$${n + 1} AS snapshot_source FROM events e WHERE e.event_type NOT LIKE $${n + 2}`;
  const hist = new Map([['500', [163]]]);
  hist.heads = new Map([['500', head(7)]]);
  const r = pw.decide([
    { queryid: 501, calls: 7, mean_ms: 6728, max_ms: 41210, query_head: head(8) },   // ตัวกรองต่าง → ไม่ใช่ตัวเดิม
    { queryid: 502, calls: 7, mean_ms: 1200, query_head: head(7) },                   // รูปเดียวกัน แก้ข้อความ → เทียบตัวเดิม
  ], hist, cfg);
  assert.deepEqual(r.regressions.map(q => [q.queryid, q.renamed_from]), [[502, '500']]);
  assert.deepEqual(r.fresh.map(q => q.queryid), [501]);
});

test('notify: a mean dragged up by one very slow call says so', async () => {
  const engine = require('../src/alert-engine');
  const sent = [];
  const lineSender = { pushLineMessage: async (_t, to, msgs) => { sent.push(msgs[0].text); return { success: true }; } };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 't' }] }) };
  await engine._testInit({ pool, lineSender, config: {} });
  const payload = { day: '2026-10-21', alerted: {}, fresh: [], stale_tables: [],
    regressions: [{ queryid: 7, calls: 7, mean_ms: 6728, max_ms: 41210, baseline_ms: 163, query_head: 'SELECT e.* one bad call' },
                  { queryid: 8, calls: 11, mean_ms: 5687, max_ms: 11875, baseline_ms: 1000, query_head: 'SELECT count steady' }] };
  await pw.notify(pool, cfg, payload, new Date('2026-10-21T11:25:00Z'));
  assert.match(sent[0], /ช้าครั้งเดียว 41\.2 วิ ที่เหลือเฉลี่ย 1\.0 วิ — SELECT e\.\* one bad call/);
  assert.doesNotMatch(sent[0], /ช้าครั้งเดียว[^\n]*SELECT count steady/, 'ช้าทุกครั้ง ไม่ใช่ครั้งเดียว');
});

// 2026-10-21: slow log ของ Postgres อ่านไม่ได้มาตั้งแต่ 22 ก.ย. โดยไม่มีใครรู้ — ต้องร้องเมื่อเงียบ ไม่ใช่เมื่อไม่รู้
test('notify: a silent Postgres log is reported; an unknown one (docker unreachable) is not', async () => {
  const engine = require('../src/alert-engine');
  const sent = [];
  const lineSender = { pushLineMessage: async (_t, _to, msgs) => { sent.push(msgs[0].text); return { success: true }; } };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 't' }] }) };
  await engine._testInit({ pool, lineSender, config: {} });
  const base = { day: '2026-10-21', regressions: [], fresh: [], stale_tables: [] };
  await pw.notify(pool, cfg, { ...base, alerted: {}, pg_log_lines_6h: 0 }, new Date('2026-10-21T11:25:00Z'));
  assert.match(sent[0], /slow log ของ Postgres ไม่มีบรรทัดใหม่ใน 6 ชม\./);
  sent.length = 0;
  await pw.notify(pool, cfg, { ...base, alerted: {}, pg_log_lines_6h: null }, new Date('2026-10-21T11:25:00Z'));
  await pw.notify(pool, cfg, { ...base, alerted: {}, pg_log_lines_6h: 1200 }, new Date('2026-10-21T11:25:00Z'));
  assert.equal(sent.length, 0);
});

test('slow-req counter leaves out internal-token and temporary test accounts, but reports how many it left out', async () => {
  const f = path.join(os.tmpdir(), `pw-${process.pid}-notuser.log`);
  fs.writeFileSync(f, [
    '2026-10-25 03:00:00.000: [slow-req] 200 9000ms GET /api/faces?limit=24 user=internal ip=127.0.0.1',
    '2026-10-25 15:50:00.000: [slow-req] 200 12000ms GET /api/faces?count=only user=zz_tmp_875950 ip=1',
    '2026-10-25 18:12:05.466: [slow-req] 200 3599ms GET /api/lpr/stats?period=today user=zz_perf_2826018 ip=1',
    '2026-10-25 10:00:00.000: [slow-req] 200 2500ms GET /api/events user=asarn ip=1',
  ].join('\n') + '\n');
  try {
    const r = await pw.scanSlowReq('2026-10-25', f);
    assert.equal(r.n, 2, 'real user + the daily probe only');
    assert.equal(r.notUser, 2);
    assert.equal(r.probeLpr, 3599);
    assert.ok(!r.top.some((t) => t.route === '/api/faces'));
  } finally { fs.unlinkSync(f); }
  const sent = [];
  const engine = require('../src/alert-engine');
  const orig = engine._pushToAll;
  engine._pushToAll = async (_t, _r, msgs) => { sent.push(msgs[0].text); return { sent: 1 }; };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'x' }] }) };
  try {
    await pw.notify(pool, cfg, { day: '2026-10-25', regressions: [], fresh: [], stale_tables: [], alerted: {},
      slow_req: 150, slow_req_limit: 100, slow_req_top: [], slow_req_not_user: 108 });
    assert.match(sent[0], /ไม่นับคำขอภายในระบบ\/ทดสอบอีก 108/);
  } finally { engine._pushToAll = orig; }
});

test('query probe: over the ceiling, slower than its own 7-night median, failures, and a night with no run', () => {
  const c = pw.settings({ ratio: 2, min_ms: 1000, probe_query_ms: 5000 });
  const h = {};
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) h[d] = { a: 100, b: 600, c: 50, d: 7000 };
  h['2026-10-26'] = { a: 120, b: 1500, c: -1, d: 7100, e: 6000, _stopped_at: null };
  const r = pw.judgeProbe({ day: '2026-10-26', history: h }, '2026-10-26', c);
  const by = Object.fromEntries(r.offenders.map((o) => [o.id, o]));
  assert.equal(by.a, undefined, 'normal stays quiet');
  assert.equal(by.b.why, 'slower'); assert.equal(by.b.base, 600);
  assert.equal(by.c.why, 'timeout');
  assert.equal(by.d.why, 'over', 'over the ceiling even when it was always slow');
  assert.equal(by.e.why, 'over', 'new case with no history but over the ceiling');
  assert.equal(r.offenders[0].id, 'c', 'failures first');
  assert.deepEqual(pw.judgeProbe({ history: h }, '2026-10-27', c), { missing: true, offenders: [] });
  assert.equal(pw.judgeProbe(null, '2026-10-27', c), null, 'never installed = no opinion');
});

test('query probe: lpr-stats-week grows Mon→Sun so only the ceiling applies, other ids keep the ratio rule', () => {
  const c = pw.settings({ ratio: 2, min_ms: 1000, probe_query_ms: 5000 });
  const h = {};
  [100, 640, 990, 1350].forEach((ms, i) => { h[`2026-10-2${i}`] = { 'lpr-stats-week|hdy': ms }; });
  ['2026-10-20', '2026-10-21', '2026-10-22'].forEach((d, i) => { h[d]['snapshots-30d|hdy'] = [400, 450, 500][i]; });
  h['2026-10-26'] = { 'lpr-stats-week|hdy': 1700, 'snapshots-30d|hdy': 1500 };
  let by = Object.fromEntries(judge(h, c).offenders.map((o) => [o.id, o]));
  assert.equal(by['lpr-stats-week|hdy'], undefined, 'growing calendar week is not "slower than usual"');
  assert.equal(by['snapshots-30d|hdy'].why, 'slower', 'ratio rule unchanged for normal ids');
  h['2026-10-26']['lpr-stats-week|hdy'] = 5200;
  by = Object.fromEntries(judge(h, c).offenders.map((o) => [o.id, o]));
  assert.equal(by['lpr-stats-week|hdy'].why, 'over', 'ceiling still applies');
});
function judge(h, c) { return pw.judgeProbe({ day: '2026-10-26', history: h }, '2026-10-26', c); }

test('query probe alert text lists the worst cases with their usual time', async () => {
  const sent = [];
  const engine = require('../src/alert-engine');
  const orig = engine._pushToAll;
  engine._pushToAll = async (_t, _r, msgs) => { sent.push(msgs[0].text); return { sent: 1 }; };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'x' }] }) };
  try {
    await pw.notify(pool, cfg, { day: '2026-10-26', regressions: [], fresh: [], stale_tables: [], alerted: {}, slow_req: 0, slow_req_limit: 100,
      probe_query: { missing: false, offenders: [{ id: 'faces-counts|vss', ms: 1064, base: 92, why: 'slower' }, { id: 'x', ms: -1, why: 'timeout' }] }, probe_query_limit_ms: 5000 });
    assert.match(sent[0], /คิวรีหน้าจอ \(วัดตี 1:15\): 2 กรณี/);
    assert.match(sent[0], /faces-counts\|vss 1\.1 วิ \(ปกติ 0\.1 วิ\)/);
    assert.match(sent[0], /x หมดเวลา/);
  } finally { engine._pushToAll = orig; }
});

test('rollup gaps and late-arriving cameras become their own alert lines', async () => {
  const sent = [];
  const engine = require('../src/alert-engine');
  const orig = engine._pushToAll;
  engine._pushToAll = async (_t, _r, msgs) => { sent.push(msgs[0].text); return { sent: 1 }; };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'x' }] }) };
  try {
    await pw.notify(pool, cfg, { day: '2026-10-26', regressions: [], fresh: [], stale_tables: [], alerted: {}, slow_req: 0, slow_req_limit: 100,
      rollup_issues: [{ table: 'event_kpi_hourly', why: 'diff', day: '2026-10-25', raw: 971324, rollup: 945023, diff: 26301 }],
      late_cameras: [{ day: '2026-10-23', camera_id: 'C9-KAR-SB-04', added: 26301 }] });
    assert.match(sent[0], /ตารางสรุป event_kpi_hourly วันที่ 2026-10-25 ไม่ตรงกับนับดิบ/);
    assert.match(sent[0], /กล้อง C9-KAR-SB-04: ข้อมูลวันที่ 2026-10-23 มาถึง central ช้าเกิน 3 ชม\. 26,301 event/);
  } finally { engine._pushToAll = orig; }
});

// 2026-10-26: INSERT ตารางสรุปช้าในชั่วโมงที่มีคนสแกน license_plates ด้วยมือ — ข้อความต้องบอกเอง ไม่ต้องให้เจ้าของถาม
test('parseAdhoc counts only psql / unnamed / adhoc_* statements and reports Thai hours', () => {
  const log = [
    '2026-10-26 03:51:10.123 UTC [1] vigil_sql@vigil_platform [unknown] LOG:  duration: 164000.5 ms  statement: WITH c AS (',
    '\tSELECT DISTINCT ON (lp.plate_number) ...',
    '2026-10-26 05:53:00.000 UTC [2] vigil_sql@vigil_platform psql LOG:  duration: 85000 ms  statement: SELECT left(plate_number,2)',
    '2026-10-26 09:14:00.000 UTC [3] vigil_sql@vigil_platform adhoc_tb_check LOG:  duration: 3000 ms  statement: WITH x AS',
    '2026-10-26 03:52:00.000 UTC [4] vigil_sql@vigil_platform api-server LOG:  duration: 14000 ms  statement: INSERT INTO event_kpi_hourly',
    '2026-10-26 03:53:00.000 UTC [5] vigil_sql@vigil_platform query_probe LOG:  duration: 9000 ms  statement: SELECT 1',
    '2026-10-26 18:21:03.370 UTC [6] vigil_sql@vigil_platform zz_qaudit_compare LOG:  duration: 47000 ms  execute <unnamed>: ',
  ].join('\n');
  const a = pw.parseAdhoc(log);
  assert.deepEqual(a, { n: 4, total_s: 299, max_s: 164, hours: ['01', '10', '12', '16'], from: '01:21', to: '16:14' });
  assert.equal(pw.parseAdhoc('2026-10-26 03:52:00.000 UTC [4] u@d api-server LOG:  duration: 14000 ms'), null);
});

test('notify appends the ad-hoc note only to an alert that is going out anyway, and only when it adds up', async () => {
  const engine = require('../src/alert-engine');
  const sent = [];
  const lineSender = { pushLineMessage: async (_t, to, msgs) => { sent.push(msgs[0].text); return { success: true }; } };
  const pool = { query: async () => ({ rows: [{ enabled: true, channel_access_token: 'test-token' }] }) };
  await engine._testInit({ pool, lineSender, config: {} });
  const cfgOn = pw.settings({ enabled: true, recipient_ids: ['U-test-owner'] });
  const now = new Date('2026-10-26T11:25:00Z');
  const base = { day: '2026-10-26', regressions: [], fresh: [], slow_req: 0, slow_req_limit: 100, stale_tables: [] };
  const adhoc = { n: 25, total_s: 1500, max_s: 169, hours: ['10', '12'], from: '09:57', to: '16:14' };

  await pw.notify(pool, cfgOn, { ...base, alerted: {}, adhoc }, now);
  assert.equal(sent.length, 0, 'งานสำรวจอย่างเดียวไม่ทำให้เตือน');

  const reg = [{ queryid: 1, calls: 128, mean_ms: 1700, baseline_ms: 400, query_head: 'INSERT INTO event_kpi_hourly' }];
  await pw.notify(pool, cfgOn, { ...base, regressions: reg, alerted: {}, adhoc }, now);
  assert.match(sent[0], /หมายเหตุ: วันนี้มีคิวรีสำรวจด้วยมือ .* 25 ครั้ง รวม 25 นาที \(ยาวสุด 169 วิ\) ช่วง 09:57–16:14 น\. ชั่วโมงที่มี 10, 12/);

  sent.length = 0;
  await pw.notify(pool, cfgOn, { ...base, regressions: reg, alerted: {}, adhoc: { ...adhoc, total_s: 30 } }, now);
  assert.doesNotMatch(sent[0], /หมายเหตุ/, 'รวมไม่ถึง 60 วิ = ไม่แนบ');
});
