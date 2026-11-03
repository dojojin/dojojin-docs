// ============================================================
// Vigil Platform — Tests: "อ่านป้ายไม่ได้" ต้องนับครบทั้งสองยี่ห้อ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา 2026-09-08: หน้า LPR นับ "อ่านป้ายไม่ได้" อยู่ 2 ที่ และแต่ละที่ตาบอด
// คนละยี่ห้อ — Dahua ไม่ส่งฟิลด์ `plate` มาเลยและไม่มีแถวใน license_plates ส่วน
// Hikvision ส่ง plate='unknown' มาพร้อมแถวใน license_plates · ผลคือ 24 ชม.
// เดียวกัน: hkt แท็บ 0 / KPI 12,397 · hdy แท็บ 18,790 / KPI 0
//
// สองอย่างที่เทสต์นี้ล็อกไว้ เพราะทั้งคู่พังแบบ "เงียบ" ไม่มีอะไร error:
//   1. รูปของ predicate — ต้องเป็น OR สองขา ห้ามเป็น IN ('', 'unknown')
//      Postgres จับคู่ partial index จาก expression tree · เขียนเป็น IN แล้ว
//      planner เลิกใช้ดัชนีทั้งสองตัวเงียบ ๆ (วัดจริง 24 ชม.: 98.9 ms → 2,439 ms)
//      หน้าจอยังถูกอยู่ ช้าลงเฉย ๆ — code review มองไม่เห็น
//   2. ตัวหารของบรรทัด % ในการ์ด KPI — ช่วง rollup ที่ยังไม่ backfill คืน
//      vehicles = null การหารตรง ๆ จะได้ "NaN%" ขึ้นหน้าจอผู้ใช้
// ============================================================
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1) รูปของ predicate ─────────────────────────────────────────
// ทุกที่ที่นับ "อ่านป้ายไม่ได้" จาก events ต้องมีสองขาครบและอยู่ในรูป OR
// ⚠️ นี่คือ "ลวดสะดุด" ไม่ใช่ข้อพิสูจน์ — assert ระดับไฟล์ บอกได้แค่ว่าข้อความ
//    ที่ถูกต้องมีอยู่ "ที่ไหนสักแห่ง" ในไฟล์ ถ้ามีใครเพิ่มสำเนาที่สองที่เขียนผิด
//    ไว้อีกจุดในไฟล์เดียวกัน เทสต์นี้ยังผ่าน · ของจริงยังต้องอ่าน diff
const PRED_SITES = [
  'src/routes/lpr-list.js',            // แท็บ "ไม่ทราบทะเบียน"
  'src/routes/lpr-query.js',           // การ์ด KPI (live ทั้ง full และ ?part=kpi)
  'src/traffic-stats-refresher.js',    // ตัวเติม n_noread_ev ลง lpr_hourly_stats
];

describe('predicate "อ่านป้ายไม่ได้"', () => {
  for (const f of PRED_SITES) {
    it(`${f} — มีขา Dahua (plate ว่าง) และขา Hikvision (plate='unknown') ครบ`, () => {
      const src = read(f);
      // ข้อความต้องตรงกับ WHERE ของดัชนีเป๊ะ (idx_events_anpr_noread_time /
      // idx_events_anpr_unknown_time) ต่างได้แค่ alias `e.` — ดู migration 199/200
      assert.match(src, /COALESCE\((e\.)?raw_json->>'plate',''\) = ''/,
        'ขา Dahua หาย — hdy/nrw/rmutr-v จะกลับไปนับเป็น 0');
      assert.match(src, /(e\.)?raw_json->>'plate' = 'unknown'/,
        "ขา Hikvision หาย — hkt จะกลับไปนับเป็น 0 (12,397 เหตุการณ์/24 ชม.)");
    });

    it(`${f} — ไม่ใช้ IN ('', 'unknown') (planner จะเลิกใช้ดัชนีเงียบ ๆ)`, () => {
      const src = read(f);
      assert.doesNotMatch(src.replace(/^\s*(\/\/|--).*$/gm, ''),
        /raw_json->>'plate'\s+IN\s*\(/i,
        "รูป IN ทำให้ planner ไม่ใช้ partial index ทั้งสองตัว — 98.9 ms กลายเป็น 2,439 ms");
    });
  }

  it('migration 200 เพิ่มคอลัมน์แบบไม่ rewrite ตาราง (ไม่มี UPDATE/DEFAULT)', () => {
    // migration ที่ UPDATE ก้อนใหญ่ = api-server ไม่บูตจนกว่าจะเสร็จ
    const sql = read('db/db_migration_200_lpr_noread_events.sql')
      .replace(/^\s*--.*$/gm, '');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS n_noread_ev/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS n_anpr_ev/);
    assert.doesNotMatch(sql, /\bUPDATE\b/i, 'ห้ามมี UPDATE ย้อนหลังใน migration');
    assert.doesNotMatch(sql, /ADD COLUMN[^;]*DEFAULT/i,
      'DEFAULT ทำให้ bucket ที่ยัง backfill ไม่ถึงอ่านว่า "เป็นศูนย์จริง" (กติกา migration 170/171)');
  });

  it('รอบใหม่ใน refresher SET เฉพาะคอลัมน์ของตัวเอง', () => {
    // SET ครบทุกคอลัมน์ = ล้างงานของอีกสองรอบทิ้งทุกครั้งที่รัน (migration 171)
    const m = read('src/traffic-stats-refresher.js')
      .match(/INSERT INTO lpr_hourly_stats \(camera_id, bucket_hour, n_noread_ev[\s\S]*?`, args\)/);
    assert.ok(m, 'หารอบ n_noread_ev ไม่เจอ');
    const setClause = m[0].split(/DO UPDATE/)[1];
    assert.match(setClause, /n_noread_ev\s*=/);
    assert.match(setClause, /n_anpr_ev\s*=/);
    for (const col of ['n_total', 'n_noread ', 'n_no_helmet', 'n_riders3', 'n_vehicle_events']) {
      assert.doesNotMatch(setClause, new RegExp(`${col}\\s*=`),
        `รอบนี้ไปทับ ${col.trim()} ของอีกรอบ`);
    }
  });
});

// ── 2) บรรทัด % ในการ์ด KPI ──────────────────────────────────────
const el = { innerHTML: '', className: '', textContent: '',
  classList: { add() {}, remove() {} } };
const ctx = {
  document: {
    getElementById: id => (id === 'lprKpi' ? el : null),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    body: { appendChild() {} }, documentElement: { style: { setProperty() {} } },
  },
  addEventListener() {}, requestAnimationFrame: fn => setTimeout(fn, 0),
  ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  fetch: async () => ({ ok: false, json: async () => null }),
  console, API: '', setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: () => null, setItem() {} },
  location: { origin: '', href: '' }, navigator: { language: 'th' },
  I18N: { t: (k, f) => f || k }, Chart: function () {}, ol: {},
};
ctx.window = ctx; ctx.globalThis = ctx;

let renderKpi;
before(() => {
  vm.createContext(ctx);
  vm.runInContext(read('dashboard/page-lpr.js'), ctx, { filename: 'page-lpr.js' });
  renderKpi = vm.runInContext('_renderLprKpi', ctx);
});

describe('การ์ด KPI "ไม่ระบุ"', () => {
  it('คิด % จาก vehicles (ยอด anprAlarm) ไม่ใช่ total (แถว license_plates)', () => {
    // total < noread ได้จริงในไซต์ Dahua — license_plates ไม่มีแถวของรถที่อ่านไม่ออก
    renderKpi({ noread: 18790, vehicles: 25000, total: 6210 });
    assert.ok(el.innerHTML.includes('75.2%'), el.innerHTML.slice(0, 400));
  });

  it('ไม่มีตัวหาร → เว้นว่าง ไม่ใช่ NaN% (bucket ที่ยังไม่ backfill คืน null)', () => {
    for (const d of [{ noread: 12397 }, { noread: 12397, vehicles: 0 },
                     { noread: 12397, vehicles: null }]) {
      renderKpi(d);
      assert.doesNotMatch(el.innerHTML, /NaN/, JSON.stringify(d));
      assert.doesNotMatch(el.innerHTML, /Infinity/, JSON.stringify(d));
    }
  });
});
