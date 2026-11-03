// ============================================================
// Vigil Platform — Tests: เจ้าของเดียวของงาน rollup (src/jobs/rollups.js)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ใช้ pool ปลอมทั้งหมด — ห้ามแตะ DB จริง งานพวกนี้ "เขียน" ตารางสรุป
// ครอบ 3 อย่างที่พังเงียบได้: รูปของ status(), runOnce ปฏิเสธรอบซ้อน,
// และเส้นทาง "มี process อื่นถือ advisory lock อยู่"
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const rollups = require('../src/jobs/rollups');

// pool ปลอม: ตอบ rowCount 0 ให้ SQL ที่ไม่รู้จัก (helmet timer 3 วิอาจยิงระหว่างเทสต์)
// lockGranted คุมว่า pg_try_advisory_lock จะให้ล็อกไหม
function fakePool({ lockGranted = true } = {}) {
  const calls = { locks: 0, unlocks: 0, connects: 0, released: 0 };
  const query = async (sql) => {
    if (/pg_try_advisory_lock/.test(sql)) { calls.locks++; return { rows: [{ got: lockGranted }], rowCount: 1 }; }
    if (/pg_advisory_unlock/.test(sql))   { calls.unlocks++; return { rows: [{}], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  };
  return {
    calls,
    query,
    connect: async () => { calls.connects++; return { query, release: () => { calls.released++; } }; },
  };
}

// module มี state ระดับไฟล์ (_started/_pool) — แต่ละเทสต์ที่ต้อง start() จึงขอ
// instance ใหม่ ไม่งั้นเทสต์ก่อนหน้าจะเป็นคนกำหนด pool ให้เทสต์ถัดไปโดยไม่ตั้งใจ
function freshStarted(opts) {
  delete require.cache[require.resolve('../src/jobs/rollups')];
  const mod = require('../src/jobs/rollups');
  const pool = fakePool(opts);
  mod.start({ pool });
  return { mod, pool };
}

test('status() ตอบได้ก่อนเรียก start() และมีครบทุกฟิลด์ที่หน้า health ใช้', () => {
  const s = rollups.status();
  // 2026-09-18 เหลือ 3 งาน — helmet-criteria ถูกถอดออกพร้อมกับการเลิกคิดเพดานสด ๆ
  // 2026-10-27 เพิ่ม app-rollup (appearance_dim_hourly · migration 282) ต่อท้าย
  assert.strictEqual(s.length, 4, 'ต้องมี 4 งาน');
  assert.deepStrictEqual(
    s.map((j) => j.name),
    ['traffic-stats', 'kpi-stats', 'cat-rollup', 'app-rollup'],
    'ลำดับต้องตรงกับที่ api-server เคยเรียก'
  );
  for (const j of s) {
    for (const k of ['running', 'last_start', 'last_success', 'last_failure',
      'last_error', 'next_run', 'interval_ms', 'uses_lock']) {
      assert.ok(k in j, `${j.name} ขาดฟิลด์ ${k}`);
    }
    assert.strictEqual(j.running, false);
    assert.strictEqual(j.next_run, null, 'ยังไม่ start ⇒ ไม่มีรอบถัดไป');
  }
  // ตอนนี้ทุกงานที่เหลือเขียนตารางสรุปทั้งหมด จึงต้องล็อกทุกตัว
  assert.ok(s.every((j) => j.uses_lock), 'งานที่เขียนตารางสรุปต้องล็อกทุกตัว');
});

test('runOnce ปฏิเสธชื่อที่ไม่รู้จัก และปฏิเสธเมื่อยังไม่ได้ start()', async () => {
  assert.match((await rollups.runOnce('ไม่มีจริง')).error, /ไม่รู้จัก/);
  assert.match((await rollups.runOnce('kpi-stats')).error, /start\(\)/);
});

test('start() ตั้ง timer แบบ unref — เรียกซ้ำไม่สร้างเจ้าของที่สอง', () => {
  const { mod } = freshStarted();
  const first = mod.status().map((j) => Number(j.next_run));
  mod.start({ pool: fakePool() });      // ต้องเป็น no-op
  assert.deepStrictEqual(mod.status().map((j) => Number(j.next_run)), first,
    'start() รอบสองต้องไม่ตั้ง timer ใหม่');
  for (const j of mod.status()) assert.ok(j.next_run instanceof Date, `${j.name} ไม่มี next_run`);
});

test('runOnce สำเร็จ: จับล็อกแล้วปลดคืน + คืน connection', async () => {
  const { mod, pool } = freshStarted();
  const r = await mod.runOnce('cat-rollup');
  assert.strictEqual(r.ok, true, `ควรสำเร็จ แต่ได้ ${JSON.stringify(r)}`);
  assert.strictEqual(pool.calls.locks, 1, 'ต้องขอล็อกหนึ่งครั้ง');
  assert.strictEqual(pool.calls.unlocks, 1, 'ต้องปลดล็อกหนึ่งครั้ง');
  assert.strictEqual(pool.calls.connects, pool.calls.released, 'ต้องคืน connection');
  const st = mod.status().find((j) => j.name === 'cat-rollup');
  assert.strictEqual(st.running, false, 'ต้องปลด running ใน finally เสมอ');
  assert.ok(st.last_success instanceof Date);
  assert.strictEqual(st.last_error, null);
});

test('runOnce ปฏิเสธเมื่อรอบเดิมยังไม่จบ', async () => {
  const { mod } = freshStarted();
  // ยิงสองครั้งพร้อมกัน — ตัวที่สองต้องถูกปฏิเสธ ไม่ใช่รันคู่ขนาน
  const [a, b] = await Promise.all([mod.runOnce('kpi-stats'), mod.runOnce('kpi-stats')]);
  const refused = [a, b].filter((r) => !r.ok);
  assert.strictEqual(refused.length, 1, 'ต้องมีตัวเดียวที่ถูกปฏิเสธ');
  // ต้องมี `skipped` เสมอ — routes/jobs.js ใช้ฟิลด์นี้เลือก 409 (มีเจ้าของแล้ว)
  // แทน 400 · ถ้าหายไป สาเหตุเดียวกันจะตอบคนละ status แล้วแต่จังหวะของ race
  assert.strictEqual(refused[0].skipped, 'already running here');
  assert.match(refused[0].error, /กำลังรันอยู่/);
});

test('advisory lock: process อื่นถือล็อกอยู่ ⇒ ข้ามรอบและบันทึกเหตุผล', async () => {
  const { mod: fresh, pool } = freshStarted({ lockGranted: false });

  const r = await fresh.runOnce('kpi-stats');
  assert.strictEqual(r.ok, false, 'แพ้ล็อก = ไม่สำเร็จ');
  assert.strictEqual(r.skipped, 'another owner');

  const st = fresh.status().find((j) => j.name === 'kpi-stats');
  assert.strictEqual(st.skip_reason, 'skipped: another owner');
  assert.strictEqual(st.last_success, null, 'ห้ามนับรอบที่ข้ามเป็นสำเร็จ');
  assert.strictEqual(st.running, false);

  // ต้องคืน connection แม้จับล็อกไม่ได้ ไม่งั้น pool รั่วทีละ 1 ทุกรอบ
  assert.strictEqual(pool.calls.connects, pool.calls.released,
    'connect กับ release ต้องเท่ากัน');
  assert.ok(pool.calls.unlocks >= 1, 'ยังต้องยิง unlock กันกรณีล็อกค้าง');
});
