// ============================================================
// Vigil Platform — test: เฝ้าดู transaction ที่เปิดค้าง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// กันการถอยหลังของ incident 2026-08-27 (transaction ค้าง 34 ชม. ตรึง autovacuum)
// ไม่ต่อ DB จริง — ใช้ fake pool ดักว่าส่ง SQL แบบไหนออกไป เพราะสิ่งที่พังได้เงียบ
// ที่สุดคือ "เผลอกลับไปดู query_start" ซึ่งจะเฝ้าเฉพาะสิ่งที่ statement_timeout
// จัดการเองอยู่แล้ว และพลาดตัวที่ทำระบบพังจริง
// ============================================================
'use strict';

const assert = require('assert');
const path   = require('path');
const watch  = require(path.join(__dirname, '..', 'src', 'helpers', 'longTxWatch'));

const fakePool = (rows = []) => {
  const seen = [];
  return { seen, query: async (sql, params) => { seen.push({ sql, params }); return { rows }; } };
};

(async () => {
  // ── 1. ต้องคิดอายุจาก xact_start ไม่ใช่ query_start ────────────────────
  const p = fakePool();
  await watch.findLongTx(p, '20 minutes');
  const sql = p.seen[0].sql;
  assert.ok(/now\(\)\s*-\s*xact_start\s*>\s*\$1/.test(sql),
    'ต้องกรองด้วย xact_start — query_start เฝ้าผิดตัว (statement_timeout จัดการเองได้อยู่แล้ว)');
  assert.ok(!/now\(\)\s*-\s*query_start\s*>/.test(sql),
    'ห้ามใช้ query_start เป็นเงื่อนไขกรอง');

  // ── 2. ต้องตัด autovacuum worker ออก ไม่งั้นเป็น noise ล้วน ─────────────
  assert.ok(/backend_type\s*=\s*'client backend'/.test(sql),
    "ต้องกรอง backend_type = 'client backend' — autovacuum รันยาวได้ตามปกติ");

  // ── 3. ต้องไม่รายงานตัวเอง ────────────────────────────────────────────
  assert.ok(/pid\s*<>\s*pg_backend_pid\(\)/.test(sql), 'ต้องกัน connection ของตัวเอง');

  // ── 4. เกณฑ์เวลาต้องเป็น parameter ไม่ใช่ค่าฝังใน SQL ──────────────────
  assert.strictEqual(p.seen[0].params[0], '20 minutes');

  // ── 5. เกณฑ์เริ่มต้นต้องสูงกว่าเพดานทุกชั้น (pool ยาวสุด 600s · role 15 นาที)
  // ต่ำกว่านี้ = เตือนเคสที่ระบบฆ่าเองได้อยู่แล้ว ⇒ คนเลิกอ่าน log
  const m = /^(\d+)\s*minutes?$/.exec(watch.DEFAULT_AGE);
  assert.ok(m && Number(m[1]) >= 16,
    `เกณฑ์เริ่มต้น ${watch.DEFAULT_AGE} ต่ำกว่า statement_timeout ระดับ role (15 นาที)`);

  // ── 6. checkLongTx ต้อง log เมื่อเจอ และเงียบเมื่อไม่เจอ ────────────────
  const orig = console.warn;
  let out = [];
  console.warn = (...a) => out.push(a.join(' '));
  try {
    await watch.checkLongTx(fakePool([]), '20 minutes');
    assert.strictEqual(out.length, 0, 'ไม่เจออะไรต้องไม่ log');

    out = [];
    await watch.checkLongTx(fakePool([{
      pid: 99, usename: 'vigil_sql', app: 'api-server',
      state: 'idle in transaction', tx_age_sec: 7200, query: 'SELECT 1',
    }]), '20 minutes');
    const all = out.join('\n');
    assert.ok(all.includes('99'), 'ต้องบอก pid ให้ไปปิดถูกตัว');
    assert.ok(all.includes('120.0'), 'ต้องบอกอายุเป็นนาที');
    assert.ok(all.includes('pg_terminate_backend(99)'), 'ต้องบอกวิธีปิดพร้อม pid');
  } finally { console.warn = orig; }

  // ── 7. checkLongTx ต้องไม่ throw เมื่อ DB ล้ม — มันอยู่ใน setInterval ────
  // (throw ที่นี่ = unhandled rejection ทุก 5 นาที กลบ log อื่นจนหมด)
  const dead = { query: async () => { throw new Error('connection terminated'); } };
  await assert.rejects(() => watch.checkLongTx(dead), /connection terminated/,
    'ให้ reject ตามปกติ — ผู้เรียกใน alert-worker มี .catch() รออยู่แล้ว');

  console.log('✅ long-tx watch: ผ่าน 7 ข้อ');
})().catch((e) => { console.error('🔴', e.message); process.exit(1); });
