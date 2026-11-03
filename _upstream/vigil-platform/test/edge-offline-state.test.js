// ============================================================
// Vigil Platform — edge offline/recovery state machine
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ขับ checkEdgeStale() ด้วย pool ปลอม + lineSender ปลอม แล้ว assert ว่ามันส่ง
// อะไรและเขียนสถานะอะไร — ไม่แตะ DB จริง ไม่ยิง LINE จริง
//
// ทำไมต้องมี: ตรรกะนี้ตัดสินว่า "ยังดับอยู่" ต่างจาก "ดับใหม่" อย่างไร และเงื่อนไข
// กันแกว่งจะปล่อยข้อความออกไปตอนไหน · วัดจาก alert_logs จริง 17 วันแล้วพบว่าของเดิม
// ส่งข้อความเหมือนกัน 6 ใบให้เหตุเดียว และไม่เคยส่งตอนกลับมาเลย ถ้าไม่มีเทสต์คุม
// ความถี่กับเงื่อนไขปิดเหตุจะเลื่อนกลับไปโดยไม่มีใครเห็นจนกว่าจะเกิดเหตุจริง
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ENGINE = path.join(__dirname, '..', 'src', 'alert-engine.js');

const HOUR = 3600e3;
const MIN = 60e3;

// pool ปลอม: คืนแถวที่กำหนด, จำ UPDATE/INSERT ไว้ให้ตรวจ
function fakePool(rows) {
  const updates = [];
  const logs = [];
  return {
    updates, logs,
    async query(sql, params) {
      if (/FROM edge_status/i.test(sql) && /SELECT/i.test(sql)) return { rows };
      if (/^UPDATE edge_status/i.test(sql.trim())) {
        updates.push({ site: params[0], sql, params });
        return { rows: [] };
      }
      if (/INSERT INTO alert_logs/i.test(sql)) {
        logs.push({ rule: params[0], site: params[1], trigger: params[2], text: params[3] });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

// โหลด engine ใหม่ทุกครั้ง แล้วฉีด pool/lineSender/config เข้าไปผ่าน init()
function loadEngine(rows, { pushOk = true } = {}) {
  delete require.cache[require.resolve(ENGINE)];
  const sent = [];
  const lineSender = {
    async pushLineMessage(_t, id, messages) {
      sent.push({ to: id, text: messages[0].text });
      return pushOk ? { success: true, request_id: 'req-1' } : { success: false, error: 'boom' };
    },
  };
  const pool = fakePool(rows);
  const engine = require(ENGINE);
  return { engine, pool, sent, lineSender };
}

function siteRow(over = {}) {
  return {
    site_id: 'hkt', last_seen_at: new Date(Date.now() - 10 * MIN).toISOString(),
    bridge_remote: 'up', bridge_local: 'up', disk_free_gb: 100, disk_total_gb: 500,
    offline_since: null, offline_notified_at: null, offline_notify_count: 0, recovered_at: null,
    stale_sec: 600,
    ...over,
  };
}

const CONFIG = {
  enabled: true,
  channel_access_token: 'tok',
  recipients: [{ id: 'U1', name: 'ops', type: 'user', enabled: true }],
  edge_alert: { enabled: true, threshold_sec: 180, cooldown_hours: 4, disabled_sites: [] },
};

async function run(rows, opts = {}) {
  const { engine, pool, sent, lineSender } = loadEngine(rows, opts);
  await engine._testInit({ pool, lineSender, config: { ...CONFIG, ...(opts.config || {}) } });
  await engine.checkEdgeStale();
  return { pool, sent };
}

test('edge offline/recovery state machine', async (t) => {

  await t.test('ลงครั้งแรก → ส่งหนึ่งใบ และจับเวลาจาก heartbeat สุดท้าย', async () => {
    const last = new Date(Date.now() - 10 * MIN).toISOString();
    const { pool, sent } = await run([siteRow({ last_seen_at: last, stale_sec: 600 })]);
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0].text, /ขาดการติดต่อ/);
    const u = pool.updates.find(u => /offline_since/.test(u.sql));
    assert.ok(u, 'ต้องเขียน offline_since');
    assert.strictEqual(u.params[1], last, 'offline_since = heartbeat สุดท้าย ไม่ใช่ now()');
    assert.strictEqual(pool.logs[0].rule, 'Edge Offline');
  });

  await t.test('ยังดับอยู่แต่ยังไม่ถึง cooldown → เงียบ', async () => {
    const { sent } = await run([siteRow({
      offline_since: new Date(Date.now() - 3 * HOUR).toISOString(),
      offline_notified_at: new Date(Date.now() - 3 * HOUR).toISOString(),
      offline_notify_count: 1,
    })]);
    assert.strictEqual(sent.length, 0, 'ห้ามส่งซ้ำก่อนครบ cooldown');
  });

  await t.test('ครบ 4 ชม. → ส่ง "ยังไม่กลับมา" ไม่ใช่ข้อความเดิม', async () => {
    const { pool, sent } = await run([siteRow({
      offline_since: new Date(Date.now() - 5 * HOUR).toISOString(),
      offline_notified_at: new Date(Date.now() - 5 * HOUR).toISOString(),
      offline_notify_count: 1,
    })]);
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0].text, /ยังไม่กลับมา/);
    assert.doesNotMatch(sent[0].text, /ขาดการติดต่อ \d+ นาที/, 'ต้องไม่ซ้ำคำเดิม');
    assert.strictEqual(pool.logs[0].rule, 'Edge Still Offline');
  });

  await t.test('ใบซ้ำที่สองเป็นต้นไปเป็นวันละครั้ง ไม่ใช่ทุก 4 ชม.', async () => {
    const base = {
      offline_since: new Date(Date.now() - 30 * HOUR).toISOString(),
      offline_notify_count: 2,
    };
    const a = await run([siteRow({ ...base, offline_notified_at: new Date(Date.now() - 5 * HOUR).toISOString() })]);
    assert.strictEqual(a.sent.length, 0, 'ผ่าน 5 ชม. ยังไม่ถึงกำหนดใบถัดไป');
    const b = await run([siteRow({ ...base, offline_notified_at: new Date(Date.now() - 25 * HOUR).toISOString() })]);
    assert.strictEqual(b.sent.length, 1, 'ผ่าน 25 ชม. ถึงกำหนด');
  });

  await t.test('เพิ่งกลับมา → ยังไม่แจ้ง แค่จด recovered_at', async () => {
    const { pool, sent } = await run([siteRow({
      last_seen_at: new Date().toISOString(), stale_sec: 5,
      offline_since: new Date(Date.now() - 2 * HOUR).toISOString(),
      offline_notify_count: 1,
    })]);
    assert.strictEqual(sent.length, 0, 'ต้องรอให้นิ่งก่อน');
    assert.ok(pool.updates.some(u => /recovered_at/.test(u.sql)), 'ต้องจด recovered_at');
  });

  await t.test('นิ่งครบ 10 นาที → แจ้งกลับมา พร้อมระยะเวลาที่ดับจริง', async () => {
    const down = Date.now() - 3 * HOUR;
    const back = Date.now() - 12 * MIN;
    const { pool, sent } = await run([siteRow({
      last_seen_at: new Date().toISOString(), stale_sec: 5,
      offline_since: new Date(down).toISOString(),
      recovered_at: new Date(back).toISOString(),
      offline_notify_count: 1,
    })]);
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0].text, /กลับมาแล้ว/);
    // ระยะเวลา = recovered_at - offline_since ≈ 2.8 ชม. ไม่ใช่เวลาตั้งแต่ข้อความล่าสุด
    assert.match(sent[0].text, /2\.8 ชั่วโมง/);
    assert.strictEqual(pool.logs[0].rule, 'Edge Recovered');
    const clr = pool.updates.find(u => /offline_since/.test(u.sql));
    assert.strictEqual(clr.params[1], null, 'ต้องล้างสถานะเมื่อปิดเหตุ');
  });

  await t.test('กระพริบ: ดับซ้ำก่อนครบ 10 นาที → ล้าง recovered_at และเงียบ', async () => {
    const { pool, sent } = await run([siteRow({
      stale_sec: 600,
      offline_since: new Date(Date.now() - 2 * HOUR).toISOString(),
      offline_notified_at: new Date(Date.now() - 30 * MIN).toISOString(),
      offline_notify_count: 1,
      recovered_at: new Date(Date.now() - 3 * MIN).toISOString(),
    })]);
    assert.strictEqual(sent.length, 0, 'กระพริบต้องไม่ทำให้เกิดข้อความ');
    const u = pool.updates.find(u => /recovered_at/.test(u.sql));
    assert.strictEqual(u.params[1], null, 'ต้องล้าง recovered_at');
  });

  await t.test('ไซต์ที่ถูกปิดเสียงต้องเงียบทั้งขาลงและขากลับ', async () => {
    const cfg = { edge_alert: { ...CONFIG.edge_alert, disabled_sites: ['hkt'] } };
    const down = await run([siteRow()], { config: cfg });
    assert.strictEqual(down.sent.length, 0);
    const back = await run([siteRow({
      last_seen_at: new Date().toISOString(), stale_sec: 5,
      offline_since: new Date(Date.now() - 2 * HOUR).toISOString(),
      recovered_at: new Date(Date.now() - 20 * MIN).toISOString(),
    })], { config: cfg });
    assert.strictEqual(back.sent.length, 0, 'ปิดเสียงแล้วห้ามพูดตอนกลับมาด้วย');
  });

  await t.test('หลายไซต์ลงพร้อมกัน → ข้อความเดียว + บอกว่ามักเป็นฝั่งส่วนกลาง', async () => {
    const { pool, sent } = await run([
      siteRow({ site_id: 'hdy' }), siteRow({ site_id: 'hkt' }), siteRow({ site_id: 'rmutr-v' }),
    ]);
    assert.strictEqual(sent.length, 1, 'สามไซต์ต้องได้ข้อความเดียว ไม่ใช่สามใบ');
    assert.match(sent[0].text, /3 ไซต์/);
    assert.match(sent[0].text, /ส่วนกลาง|broker/);
    assert.strictEqual(pool.logs.length, 3, 'แต่ alert_logs ต้องแยกแถวต่อไซต์');
  });

  await t.test('ส่งไม่สำเร็จ → ห้ามขยับสถานะ (ไม่งั้นเหตุนี้จะเงียบตลอดไป)', async () => {
    const { pool, sent } = await run([siteRow()], { pushOk: false });
    assert.strictEqual(sent.length, 1, 'พยายามส่งแล้ว');
    assert.strictEqual(pool.updates.length, 0, 'แต่ต้องไม่เขียน offline_since');
    assert.strictEqual(pool.logs.length, 0);
  });

  await t.test('ไซต์ปกติที่ไม่เคยดับ → ไม่แตะอะไรเลย', async () => {
    const { pool, sent } = await run([siteRow({
      last_seen_at: new Date().toISOString(), stale_sec: 5,
    })]);
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(pool.updates.length, 0);
  });
});
