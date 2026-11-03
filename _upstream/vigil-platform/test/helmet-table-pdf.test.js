// ============================================================
// Vigil Platform — report-table.pdf: อ่าน license_plates ครั้งเดียว + รวมคำขอซ้ำ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// 28–29 ต.ค.: รายงานตารางช้า 50–78 วิ เพราะ moto · beh · prov · ev ต่างคนต่างไล่ idx_plates_number
// ต่อป้าย และ reload 7 ครั้งเริ่มคิวรีหนัก 7 ชุด · เทสนี้ไม่แตะ DB: pool เป็น stub จับ SQL

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { registerTablePdf } = require('../src/routes/traffic-report-pdf');

const TRAFFIC_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'traffic.js'), 'utf8');

// เรียก handler จริงด้วย deps stub · คืน SQL ทุกก้อนที่ยิง + จำนวนครั้งที่ plateRegionCte ถูกเรียก
async function run(query) {
  let handler; const sqls = []; const regionCalls = [];
  const app = { post() {}, get: (p, h) => { if (p === '/api/traffic/helmet-top/report-table.pdf') handler = h; } };
  const pool = { query: async (sql) => { sqls.push(sql); return { rows: [] }; } };
  let noRows = 0;
  registerTablePdf(app, pool, {
    routeError: (res, e) => { throw e; }, TZ: 'Asia/Bangkok', PLATE_OK: '.', MIN_HITS: 3,
    parseCams: () => null,
    plateRegionCte: (...a) => { regionCalls.push(a); return 'prov AS (SELECT 1)'; },
    regionAltSql: () => 'CASE WHEN TRUE', TOP_LBL: { day: 'x' },
    resolveTopRange: () => ({ period: 'day', since: new Date('2026-10-28T00:00:00Z'), until: null }),
    topRangeSql: (args, r) => { args.push(r.since); return `lp.detected_at >= $${args.length}`; },
    topRangeLabel: () => 'x', _brandLogos: async () => ({}),
    _sendNoRowsPdf: () => { noRows++; },
  });
  const res = { on() {}, set() { return this; }, status() { return this; }, json() {}, writableFinished: true };
  await handler({ query, user: null, brandName: 'B' }, res);
  return { sqls, regionCalls, noRows };
}

test('SQL อ่าน license_plates เพื่อผู้เข้าชิงครั้งเดียว (rng) แล้วให้ moto/beh/prov/ev ใช้ต่อ', async () => {
  const { sqls, regionCalls, noRows } = await run({});
  assert.equal(sqls.length, 1);
  const sql = sqls[0];
  assert.match(sql, /rng AS MATERIALIZED \(/);
  assert.match(sql, /moto AS \(\s*SELECT lp\.plate_number AS plate FROM rng lp/);
  assert.match(sql, /beh AS \([\s\S]*?FROM rng lp\s+WHERE lp\.vehicle_type = 'twoWheelVehicle'/);
  assert.match(sql, /JOIN rng lp ON lp\.plate_number = t\.plate\s+AND lp\.no_helmet = true/);
  assert.deepEqual(regionCalls[0].slice(0, 2), ['prov', 'top']);
  assert.deepEqual(regionCalls[0].slice(2), ['TRUE', 'rng']);
  // license_plates เหลือแค่ scale · hit · rng
  assert.equal((sql.match(/FROM license_plates/g) || []).length, 3);
  assert.equal(noRows, 1);   // rows ว่าง → ส่ง PDF "ไม่มีข้อมูล" เหมือนเดิม
});

test('rng มีทุกคอลัมน์ที่ query ข้างล่างอ้างผ่าน lp.', async () => {
  const sql = (await run({})).sqls[0];
  const rngBody = sql.match(/rng AS MATERIALIZED \(([\s\S]*?)FROM license_plates lp/)[1];
  const after = sql.slice(sql.indexOf('moto AS'));
  const used = new Set([...after.matchAll(/\blp\.([a-z_]+)/g)].map((m) => m[1]));
  for (const col of used) assert.match(rngBody, new RegExp(`lp\\.${col}\\b`), `rng ขาด ${col}`);
});

test('คำขอที่ต่างกันแค่ _ (cache-buster) รวมเป็นคิวรีเดียว', async () => {
  let handler, calls = 0;
  const app = { post() {}, get: (p, h) => { if (p.endsWith('report-table.pdf')) handler = h; } };
  const pool = { query: async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return { rows: [] }; } };
  registerTablePdf(app, pool, {
    routeError: (res, e) => { throw e; }, TZ: 'Asia/Bangkok', PLATE_OK: '.', MIN_HITS: 3,
    parseCams: () => null, plateRegionCte: () => 'prov AS (SELECT 1)', regionAltSql: () => '',
    TOP_LBL: {}, resolveTopRange: () => ({ period: 'day', since: new Date(0), until: null }),
    topRangeSql: (args, r) => { args.push(r.since); return 'TRUE'; }, topRangeLabel: () => '',
    _brandLogos: async () => ({}), _sendNoRowsPdf: () => {},
  });
  const res = { on() {}, writableFinished: true };
  await Promise.all([1, 2, 3].map((i) => handler({ query: { _: String(i) }, brandName: 'B' }, res)));
  assert.equal(calls, 1);
});

test('plateRegionCte: 3 อาร์กิวเมนต์ยังอ่าน license_plates · อาร์กิวเมนต์ที่ 4 เปลี่ยนแหล่ง', () => {
  const fn = TRAFFIC_SRC.match(/const plateRegionCte = \(name, srcCte, rangeSql, from = 'license_plates'\) => `([\s\S]*?)`;/);
  assert.ok(fn, 'ไม่พบ plateRegionCte แบบมี from');
  // eval เฉพาะ template ของฟังก์ชัน (ไม่มี dependency อื่น)
  const make = new Function('name', 'srcCte', 'rangeSql', 'from', 'return `' + fn[1] + '`;');
  assert.match(make('p', 'top', 'X', 'license_plates'), /FROM license_plates lp/);
  assert.match(make('p', 'top', 'TRUE', 'rng'), /FROM rng lp/);
  // ผู้เรียกอื่นไม่ส่ง from
  assert.match(TRAFFIC_SRC, /plateRegionCte\('plate_region', 'cand', rangeSql\)/);
});
