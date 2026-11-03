// ============================================================
// Vigil Platform — Tests: appearance_dim_hourly refresher (migration 282 · 2026-10-27)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ตรวจกับข้อมูลจริง 25 ต.ค. แล้วว่าทุกมิติตรงกับคิวรีเดิมของ /api/appearances/stats (195,660 แถว · 11 มิติ ALL SAME)
// เทสต์นี้กันรูปของ SQL ไม่ให้ถอยกลับ: อ่านตารางรอบเดียว · มิติครบ · เส้นแบ่งเวลาจาก DB · ลงทะเบียนงานครบ
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/appearance-rollup-refresher');

test('every dimension comes from one read of appearances (LATERAL VALUES), nulls dropped, upsert on the full key', () => {
  const sql = app.selectSql('TRUE');
  assert.equal((sql.match(/FROM appearances/g) || []).length, 1, 'อ่าน appearances รอบเดียว');
  assert.match(sql, /CROSS JOIN LATERAL \(VALUES/);
  assert.match(sql, /d\.value IS NOT NULL/);
  for (const d of ['all', 'gender', 'top', 'bottom', 'color', 'hair_color', 'hair_length', 'age', 'expr', 'dir', 'flag'])
    assert.match(sql, new RegExp(`\\('${d}',`), d);
  for (const f of ['bag', 'backpack', 'shoulder', 'glasses', 'helmet', 'mask', 'hat']) assert.match(sql, new RegExp(`THEN '${f}' END`), f);
  // เงื่อนไขเดียวกับคิวรีเดิม
  assert.match(sql, /COALESCE\(a\.age_group, a\.rj_age_group\)/);
  assert.match(sql, /json_build_array\(a\.upper_color, a\.lower_color\)::text/);
  assert.match(sql, /COALESCE\(a\.object_class, 'unknown'\)/);
  assert.match(sql, /date_trunc\('hour', a\.event_time\)/);
});

test('refreshRange cuts on the database clock and sweeps rows nothing backs any more', async () => {
  const seen = [];
  const cut = new Date('2026-10-27T00:00:00Z');
  const pool = { query: async (sql, args) => { seen.push({ sql, args }); return /SELECT now\(\) AS cut/.test(sql) ? { rows: [{ cut }] } : { rowCount: 5 }; } };
  const r = await app.refreshRange(pool, new Date('2026-10-24T17:00:00Z'), new Date('2026-10-25T17:00:00Z'));
  assert.equal(r.rows, 5);
  const ins = seen.find((q) => /INSERT INTO appearance_dim_hourly/.test(q.sql));
  assert.match(ins.sql, /ON CONFLICT \(bucket_hour, camera_id, object_class, dim, value\)\s+DO UPDATE SET n = EXCLUDED\.n/);
  assert.deepEqual(ins.args, ['2026-10-24T17:00:00.000Z', '2026-10-25T17:00:00.000Z']);
  const del = seen.find((q) => /DELETE FROM appearance_dim_hourly/.test(q.sql));
  assert.match(del.sql, /updated_at < \$3::timestamptz/);
  assert.equal(del.args[2], cut, 'เส้นแบ่งต้องเป็น now() ของ Postgres ไม่ใช่เวลาของ Node');
});

test('the rollup job is registered with its own lock, loads its reconcile day at boot, and is checked against raw counts', () => {
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const jobs = rd('src/jobs/rollups.js');
  assert.match(jobs, /name: 'app-rollup',\s+lockId: 4,/);
  const ids = [...jobs.matchAll(/lockId: (\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'lockId ห้ามซ้ำ');
  assert.match(jobs, /appearance\.loadReconciledDay\(_pool\);/);
  const rc = require('../src/helpers/rollupCheck');
  assert.match(rc.CHECKS.appearance_dim_hourly.raw, /FROM appearances WHERE event_time >= \$1 AND event_time < \$2/);
  assert.match(rc.CHECKS.appearance_dim_hourly.rollup, /dim = 'all'/);
  const mig = rd('db/db_migration_282_appearance_dim_hourly.sql');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS appearance_dim_hourly/);
  assert.match(mig, /PRIMARY KEY \(bucket_hour, camera_id, object_class, dim, value\)/);
});

test('retention keeps more than the 31 days the stats page can ask for', () => {
  assert.ok(app.RETENTION_DAYS > 31);
  assert.equal(app.RECONCILED_KEY, 'app_rollup_reconciled_day');
});

// ── route: /api/appearances/stats อ่านตารางสรุป (ขั้น 3) ─────────────────────────────
// เทียบกับโค้ดเดิมบน DB จริง 15 กรณีแล้ว (7d/1d/3d/30d · 5 ไซต์ · Person · กล้อง · 2.5 ชม. · 40 นาที · จบที่ตอนนี้) ตรงทุกค่า
// ยกเว้นคู่สีที่จำนวนเท่ากันที่ขอบ LIMIT 50 (เดิมสุ่ม ใหม่เรียงตามค่า) · เทสต์นี้กันการเลือกทาง + ขอบชั่วโมง
function statsRoute({ lastSuccess, coverage }) {
  const rollupsPath = require.resolve('../src/jobs/rollups');
  const saved = require.cache[rollupsPath];
  require.cache[rollupsPath] = { id: rollupsPath, filename: rollupsPath, loaded: true,
    exports: { status: () => [{ name: 'app-rollup', last_success: lastSuccess }] } };
  const seen = [];
  const client = { query: async (sql) => { seen.push({ sql }); return { rows: [] }; }, release() {} };
  const pool = {
    query: async (sql, args) => {
      seen.push({ sql, args });
      if (/min\(bucket_hour\)/.test(sql)) return { rows: [{ m: coverage }] };
      if (/WITH src AS/.test(sql)) return { rows: [{ k: 'all', n: 3 }, { k: 'd', dim: 'gender', value: 'Male', n: 2 }] };
      return { rows: [] };
    },
    connect: async () => client,
  };
  let h;
  const app = { get: (p, ...f) => { if (p === '/api/appearances/stats') h = f[f.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  delete require.cache[require.resolve('../src/routes/appearances')];
  require('../src/routes/appearances')(app, pool, { getDisplayTz: async () => 'Asia/Bangkok', getIP: () => '' });
  // route อ่าน jobs/rollups ตอนเรียก (lazy require) ⇒ ตัวปลอมต้องอยู่จนเรียกเสร็จ แล้วค่อยคืนของจริง
  return async (query) => {
    let body; const res = { set() { return res; }, status() { return res; }, json(b) { body = b; return res; }, setHeader() {} };
    try { await h({ method: 'GET', query, user: { role: 'admin', allowedSites: null } }, res); }
    finally { if (saved) require.cache[rollupsPath] = saved; else delete require.cache[rollupsPath]; }
    return { body, seen };
  };
}

test('stats read full hours from the rollup and only the partial edge hours from raw rows', async () => {
  const call = statsRoute({ lastSuccess: new Date('2026-10-27T05:02:00Z'), coverage: new Date('2026-09-25T17:00:00Z') });
  const { body, seen } = await call({ from: '2026-10-20T03:13:00.000Z', to: '2026-10-27T03:47:00.000Z' });
  const q = seen.find((x) => /WITH src AS/.test(x.sql));
  assert.ok(q, 'ใช้ทางตารางสรุป');
  assert.ok(!seen.some((x) => /CREATE TEMP TABLE _app_stats_filtered/.test(x.sql)), 'ไม่สร้าง temp table แบบเดิม');
  assert.match(q.sql, /FROM appearance_dim_hourly r\s+WHERE r\.bucket_hour >= \$\d+ AND r\.bucket_hour < \$\d+/);
  // a = ชั่วโมงถัดจาก from · b = ชั่วโมงของ to (03:00) — ไม่เกินชั่วโมงก่อนรอบ refresh ล่าสุด (05:00 − 1 ชม.)
  assert.ok(q.args.includes('2026-10-20T04:00:00.000Z'));
  assert.ok(q.args.includes('2026-10-27T03:00:00.000Z'));
  assert.match(q.sql, /a\.event_time >= \$\d+ AND a\.event_time < \$\d+\) OR \(a\.event_time >= \$\d+ AND a\.event_time <= \$\d+/);
  assert.equal(body.kpi.total, 3);
  assert.equal(body.gender.Male, 2);
});

test('the newest full hour is always read raw, so rows that arrived after the last refresh still count', async () => {
  const call = statsRoute({ lastSuccess: new Date('2026-10-27T03:02:00Z'), coverage: new Date('2026-09-25T17:00:00Z') });
  const { seen } = await call({ from: '2026-10-26T03:13:00.000Z', to: '2026-10-27T03:47:00.000Z' });
  const q = seen.find((x) => /WITH src AS/.test(x.sql));
  assert.ok(q.args.includes('2026-10-27T02:00:00.000Z'), 'b = ชั่วโมงก่อนรอบ refresh ล่าสุด');
  assert.ok(!q.args.includes('2026-10-27T03:00:00.000Z'));
});

test('falls back to the original query when the refresher has not run yet or the rollup does not reach back far enough', async () => {
  for (const opts of [{ lastSuccess: null, coverage: new Date('2026-09-25T17:00:00Z') },
                      { lastSuccess: new Date('2026-10-27T05:02:00Z'), coverage: new Date('2026-10-25T17:00:00Z') }]) {
    const call = statsRoute(opts);
    const { seen } = await call({ from: '2026-10-20T03:13:00.000Z', to: '2026-10-27T03:47:00.000Z' });
    assert.ok(!seen.some((x) => /WITH src AS/.test(x.sql)), JSON.stringify(opts));
    assert.ok(seen.some((x) => /CREATE TEMP TABLE _app_stats_filtered/.test(x.sql)), 'ทางเดิม');
  }
});
