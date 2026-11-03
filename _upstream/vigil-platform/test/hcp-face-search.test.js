// ============================================================
// Vigil Platform — HC2 · เวลาและเพดานของการค้นใบหน้าผ่าน HCP
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทุกเคสในไฟล์นี้เคยพังแบบ "สำเร็จแต่ว่างเปล่า" ได้ทั้งนั้น — ไม่มี error ให้เห็น
// มีแต่ผลค้นที่ว่าง ซึ่งในงานสืบสวนอ่านเหมือน "ไม่มีคนนี้ในกล้อง"
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { hcpTime } = require('../src/helpers/hcpTime');
const { checkRange, planHcpSearch, MAX_CALLS } = require('../src/helpers/hcpSearchPlan');

const BKK = (s) => new Date(s);   // อ่านง่าย: สตริงมี offset อยู่แล้ว

// ── เวลา ────────────────────────────────────────────────────
test('เวลาที่ส่งให้ HCP เป็นเวลากรุงเทพจริง ไม่ใช่ UTC ที่แปะ +07:00', () => {
  // 00:00 UTC = 07:00 ตามเวลาไทย · ถ้าแปะ offset เฉย ๆ จะได้ 00:00+07:00
  // ซึ่งคนละเวลากัน 7 ชั่วโมง และ HCP จะตอบ "ช่วงนั้นไม่มีอะไร" อย่างสุภาพ
  assert.strictEqual(hcpTime(new Date('2026-08-08T00:00:00Z')), '2026-08-08T07:00:00+07:00');
});

test('ไม่มีมิลลิวินาทีติดไป — HCP ปฏิเสธรูปแบบที่มี', () => {
  assert.strictEqual(hcpTime(new Date('2026-08-08T00:00:00.443Z')), '2026-08-08T07:00:00+07:00');
  assert.ok(!/\.\d/.test(hcpTime(new Date())));
});

// ── ช่วงเวลา ────────────────────────────────────────────────
test('ช่วงเวลาย้อนหลัง (ถึง ก่อน ตั้งแต่) ถูกปฏิเสธ ไม่ใช่คืนผลว่าง', () => {
  // ก่อนแก้: windows = [] → ยิง HCP 0 ครั้ง → หน้าจอขึ้น "ไม่พบใบหน้าที่ใกล้เคียง"
  const r = checkRange('2026-08-08T00:00:00+07:00', '2026-08-01T00:00:00+07:00');
  assert.ok(r.error, 'ต้องมี error');
  assert.strictEqual(r.sinceMs, undefined);
});

test('ตั้งแต่ = ถึง ก็ถูกปฏิเสธ (ค้นช่วงกว้างศูนย์ไม่มีความหมาย)', () => {
  assert.ok(checkRange('2026-08-08T00:00:00+07:00', '2026-08-08T00:00:00+07:00').error);
});

test('วันที่ที่แปลงไม่ได้ ถูกปฏิเสธพร้อมบอกค่าที่ได้รับ', () => {
  const r = checkRange('ไม่ใช่วันที่', '2026-08-08T00:00:00+07:00');
  assert.ok(r.error);
  assert.strictEqual(r.since, 'ไม่ใช่วันที่');
});

test('31 วันผ่าน · 32 วันไม่ผ่าน และบอกว่าขอมากี่วัน', () => {
  // หน้าจอส่งขอบเป็น T00:00:00 → T23:59:59 ของอีกวัน ระยะจริงจึงเป็น ~30.99998 วัน
  // Math.ceil ทำให้ค่านั้นนับเป็น 31 พอดี — เคสที่คนใช้เจอบ่อยที่สุด
  assert.ok(!checkRange('2026-07-08T00:00:00+07:00', '2026-08-07T23:59:59+07:00').error);
  const over = checkRange('2026-07-01T00:00:00+07:00', '2026-08-02T00:00:00+07:00');
  assert.strictEqual(over.requested_days, 32);
  assert.strictEqual(over.limit_days, 31);
});

// ── การซอยหน้าต่าง ──────────────────────────────────────────
test('ซอยเป็นหน้าต่างละไม่เกิน 7 วัน และครอบช่วงที่ขอครบพอดี', () => {
  const { windows } = planHcpSearch({
    since: '2026-07-01T00:00:00+07:00', until: '2026-07-25T00:00:00+07:00',
    cameraIndexCodes: 'a,b,c',
  });
  assert.strictEqual(windows.length, 4);                      // 24 วัน → 7+7+7+3
  windows.forEach(([s, e]) => assert.ok(e - s <= 7 * 86400000, 'หน้าต่างเกิน 7 วัน'));
  assert.strictEqual(+windows[0][0], +BKK('2026-07-01T00:00:00+07:00'));
  assert.strictEqual(+windows.at(-1)[1], +BKK('2026-07-25T00:00:00+07:00'));
  // ต่อกันสนิท ไม่มีรูโหว่ระหว่างหน้าต่าง — รูหนึ่งวัน = คนหายไปหนึ่งวันเงียบ ๆ
  for (let i = 1; i < windows.length; i++) assert.strictEqual(+windows[i][0], +windows[i - 1][1]);
});

test('ช่วงสั้นกว่า 7 วัน = หน้าต่างเดียว', () => {
  assert.strictEqual(planHcpSearch({
    since: '2026-08-01T00:00:00+07:00', until: '2026-08-03T00:00:00+07:00',
    cameraIndexCodes: 'a',
  }).windows.length, 1);
});

// ── การแบ่ง batch กล้อง ─────────────────────────────────────
test('cameraIndexCodes แต่ละ batch ไม่เกิน 1000 ตัวอักษร และไม่ทำกล้องหาย', () => {
  const codes = Array.from({ length: 300 }, (_, i) => `cam${String(i).padStart(4, '0')}`); // 7 ตัวอักษร/ตัว
  const { camBatches } = planHcpSearch({
    since: '2026-08-01T00:00:00+07:00', until: '2026-08-02T00:00:00+07:00',
    cameraIndexCodes: codes.join(','),
  });
  camBatches.forEach((b) => assert.ok(b.length <= 1000, `batch ยาว ${b.length}`));
  assert.deepStrictEqual(camBatches.join(',').split(','), codes);   // ครบ ไม่ซ้ำ ไม่สลับ
});

test('ไม่มี batch ว่างหลุดออกไป แม้รหัสเดียวจะยาวเกินเพดาน', () => {
  // batch ว่าง = ยิง HCP ด้วย cameraIndexCodes เปล่า ซึ่งตอบ 0 แถวอย่างเงียบ ๆ
  const { camBatches } = planHcpSearch({
    since: '2026-08-01T00:00:00+07:00', until: '2026-08-02T00:00:00+07:00',
    cameraIndexCodes: `${'x'.repeat(1200)},short`,
  });
  camBatches.forEach((b) => assert.ok(b.length > 0, 'มี batch ว่าง'));
});

test('ไม่ระบุกล้องเลย = ปฏิเสธ ไม่ใช่ค้นทั้งระบบ', () => {
  assert.ok(planHcpSearch({
    since: '2026-08-01T00:00:00+07:00', until: '2026-08-02T00:00:00+07:00',
    cameraIndexCodes: ' , , ',
  }).error);
});

// ── เพดานจำนวนคำขอ ─────────────────────────────────────────
test('เกิน 40 คำขอ = ปฏิเสธพร้อมตัวเลขจริง ไม่ตัดให้เหลือ 40 เงียบ ๆ', () => {
  // 31 วัน → 5 หน้าต่าง · ต้องได้ ≥9 batch ถึงจะทะลุ 40 → 1500 กล้อง
  const codes = Array.from({ length: 1500 }, (_, i) => `cam${String(i).padStart(4, '0')}`);
  const r = planHcpSearch({
    since: '2026-07-08T00:00:00+07:00', until: '2026-08-07T23:59:59+07:00',
    cameraIndexCodes: codes.join(','),
  });
  assert.ok(r.error);
  assert.strictEqual(r.total_calls, r.windows * r.camera_batches);
  assert.ok(r.total_calls > MAX_CALLS);
  assert.strictEqual(r.limit_calls, MAX_CALLS);
  assert.strictEqual(r.camBatches, undefined, 'ปฏิเสธแล้วต้องไม่คืนแผนให้เอาไปยิงต่อ');
});

test('ของจริงที่ภูเก็ต (83 กล้อง · 31 วัน) ยังอยู่ใต้เพดาน', () => {
  const codes = Array.from({ length: 83 }, (_, i) => `${1000000 + i}`);
  const r = planHcpSearch({
    since: '2026-07-08T00:00:00+07:00', until: '2026-08-07T23:59:59+07:00',
    cameraIndexCodes: codes.join(','),
  });
  assert.ok(!r.error, r.error);
  assert.ok(r.windows.length * r.camBatches.length <= MAX_CALLS);
});

// ── HC0 · แมปกล้อง edge vs ฐานข้อมูล ────────────────────────
const { diffCameraMap } = require('../src/helpers/hcpCameraMap');

test('แมปตรงกัน = in_sync ไม่มีอะไรค้าง', () => {
  const d = diffCameraMap({ 1: 'camA', 2: 'camB' }, { 1: 'camA', 2: 'camB' });
  assert.strictEqual(d.in_sync, true);
  assert.deepStrictEqual([d.changed, d.missing_on_edge, d.extra_on_edge], [[], [], []]);
});

test('ชี้คนละกล้อง = จับได้ พร้อมบอกทั้งสองฝั่ง', () => {
  const d = diffCameraMap({ 1: 'camA' }, { 1: 'camZ' });
  assert.strictEqual(d.in_sync, false);
  assert.deepStrictEqual(d.changed, [{ hcp_index: '1', db: 'camA', edge: 'camZ' }]);
});

test('แยก "ขาดบน edge" ออกจาก "เกินบน edge" — คนละสาเหตุ คนละวิธีแก้', () => {
  const d = diffCameraMap({ 1: 'camA', 2: 'camB' }, { 1: 'camA', 3: 'camC' });
  assert.deepStrictEqual(d.missing_on_edge, ['2']);
  assert.deepStrictEqual(d.extra_on_edge, ['3']);
  assert.deepStrictEqual([d.db_count, d.edge_count], [2, 2]);   // จำนวนเท่ากันได้ทั้งที่ไม่ตรงกัน
});

test('edge ไม่มีไฟล์เลย = ทุกแถวขาด ไม่ใช่ in_sync', () => {
  assert.strictEqual(diffCameraMap({ 1: 'camA' }, {}).in_sync, false);
  assert.strictEqual(diffCameraMap({ 1: 'camA' }, null).missing_on_edge.length, 1);
});

// O12 (2026-10-06): ค้นใบหน้า engine=edge ต้องทำขนานได้ — COST ของ vec_dot + worker ใน transaction
test('face search by example runs vec_dot with parallel workers inside one transaction', () => {
  const fs = require('node:fs'), path = require('node:path');
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/routes/hcp.js'), 'utf8');
  const i = s.indexOf("await c.query('BEGIN');");
  assert.ok(i > 0);
  assert.match(s.slice(i, i + 600), /SET LOCAL max_parallel_workers_per_gather = 4[\s\S]*vec_dot\(embedding, \$1::real\[\]\)[\s\S]*COMMIT/);
  const m = fs.readFileSync(path.join(__dirname, '..', 'db/db_migration_254_vec_dot_cost.sql'), 'utf8');
  assert.match(m, /^ALTER FUNCTION vec_dot\(real\[\], real\[\]\) COST 10000;/m);
});
