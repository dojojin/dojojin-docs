// ============================================================
// Vigil Platform — Tests: ยามเฝ้า partner API (helpers/partnerWatch.js · OpenAPI ระยะ 2 R3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ส่ง LINE ผ่าน send ปลอมเท่านั้น + ตัด fetch ขาออก (feedback: harness เคยส่ง LINE จริงเข้ากลุ่มตำรวจ)
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.fetch = async () => { throw new Error('network blocked in test'); };
const W = require('../src/helpers/partnerWatch');

const NOW = new Date('2026-10-22T01:30:00Z');            // 08:30 เวลาไทย
const cfg = W.settings({});
const base = (o = {}) => ({
  slug: 'p1', label: 'P1', active: true, created_at: '2026-09-01T00:00:00Z', expires_at: null,
  agreement: { version: 1, valid_until: '2027-06-30', review_due: '2027-01-20' },
  last24: { total: 0, s401: 0, s403: 0, s429: 0 }, daily: [0, 0, 0, 0, 0, 0, 0], new_ips: [], ...o,
});
const kinds = (c) => W.decide([c], cfg, NOW).map((i) => i.key.split(':')[1]).sort();

test('a healthy partner raises nothing', () => {
  assert.deepEqual(kinds(base()), []);
});

test('agreement signals: missing, expired while active, review due soon / overdue, credential expiring', () => {
  assert.deepEqual(kinds(base({ agreement: null })), ['no-agreement']);
  assert.deepEqual(kinds(base({ agreement: null, created_at: '2026-10-20T00:00:00Z' })), [], 'grace period for new partners');
  assert.deepEqual(kinds(base({ agreement: { version: 2, valid_until: '2026-10-21', review_due: '2027-01-01' } })), ['agreement-expired']);
  assert.deepEqual(kinds(base({ agreement: { version: 1, valid_until: null, review_due: '2026-11-01' } })), ['review-due']);
  assert.match(W.decide([base({ agreement: { version: 1, valid_until: null, review_due: '2026-10-01' } })], cfg, NOW)[0].text, /เลยกำหนด/);
  assert.deepEqual(kinds(base({ expires_at: '2026-10-30T00:00:00Z' })), ['cred-expiring']);
  assert.deepEqual(kinds(base({ expires_at: '2026-10-01T00:00:00Z' })), [], 'already expired = auth refuses it, nothing to warn');
  assert.deepEqual(kinds(base({ active: false, agreement: null })), [], 'inactive partners get no agreement nags');
});

test('usage signals: volume spike vs 7-day median, 403/401/429 bursts, new IPs', () => {
  assert.deepEqual(kinds(base({ last24: { total: 900, s401: 0, s403: 0, s429: 0 }, daily: [100, 100, 120, 90, 100, 110, 100] })), ['volume']);
  assert.deepEqual(kinds(base({ last24: { total: 400, s401: 0, s403: 0, s429: 0 }, daily: [10, 10, 10, 10, 10, 10, 10] })), [], 'below volume_min');
  assert.deepEqual(kinds(base({ last24: { total: 900, s401: 0, s403: 0, s429: 0 }, daily: [300, 300, 300, 300, 300, 300, 300] })), [], 'under 5x');
  assert.deepEqual(kinds(base({ last24: { total: 600, s401: 0, s403: 0, s429: 0 } })), ['volume'], 'no history but heavy');
  assert.deepEqual(kinds(base({ last24: { total: 60, s401: 20, s403: 20, s429: 10 } })), ['badsig', 'forbidden', 'ratelimited']);
  assert.deepEqual(kinds(base({ new_ips: ['1.2.3.4'] })), ['new-ip']);
  assert.deepEqual(kinds(base({ active: false, last24: { total: 0, s401: 25, s403: 0, s429: 0 } })), ['badsig'], 'revoked partner still knocking');
});

test('cooldown: review items wait 7 days, usage items 24 hours', () => {
  const items = [{ key: 'p1:review-due', cls: 'review' }, { key: 'p1:forbidden', cls: 'usage' }];
  const at = (h) => new Date(NOW - h * 3600_000).toISOString();
  assert.deepEqual(W.dueItems(items, { 'p1:review-due': at(48), 'p1:forbidden': at(48) }, cfg, NOW).map((i) => i.key), ['p1:forbidden']);
  assert.equal(W.dueItems(items, { 'p1:review-due': at(24 * 8) }, cfg, NOW).length, 2);
});

// pool ปลอมสำหรับ runOnce: ตอบตามรูป SQL
function fakePool({ lc, consumers, saved = {} }) {
  const writes = [];
  return { writes, async query(sql, p) {
    if (/FROM line_config/.test(sql)) return { rows: [lc] };
    if (/FROM api_consumers c/.test(sql)) return { rows: consumers };
    if (/array_agg\(DISTINCT ip\)/.test(sql)) return { rows: [] };
    if (/FROM api_request_log/.test(sql)) return { rows: [] };
    if (/SELECT value FROM system_settings/.test(sql)) return { rows: [{ value: JSON.stringify(saved) }] };
    if (/INSERT INTO system_settings/.test(sql)) { writes.push(JSON.parse(p[1])); return { rows: [] }; }
    throw new Error('unexpected: ' + sql.slice(0, 60));
  } };
}
const LC = { enabled: true, channel_access_token: 'x', perf_alert: { enabled: true, recipient_ids: ['U1'] } };
const C1 = { id: 1, slug: 'p1', label: 'P1', active: true, created_at: '2026-09-01T00:00:00Z', expires_at: null, agreement: null };

test('runOnce sends one message to perf_alert recipients only, and stamps cooldown only when sent', async () => {
  const calls = [];
  const send = async (tok, rec, msgs, tag) => { calls.push({ rec, text: msgs[0].text, tag }); return { sent: true }; };
  const pool = fakePool({ lc: LC, consumers: [C1] });
  const out = await W.runOnce(pool, { now: NOW, send });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].rec, [{ id: 'U1' }]);
  assert.match(calls[0].text, /ยังไม่มีข้อตกลงข้อมูล/);
  assert.ok(out.alerted['p1:no-agreement']);

  const failing = fakePool({ lc: LC, consumers: [C1] });
  const out2 = await W.runOnce(failing, { now: NOW, send: async () => ({ sent: false }) });
  assert.equal(out2.alerted['p1:no-agreement'], undefined, 'failed send does not consume cooldown');
});

test('runOnce stays silent when LINE or the perf_alert channel is off, but still records findings', async () => {
  let n = 0; const send = async () => { n++; return { sent: true }; };
  for (const lc of [{ ...LC, enabled: false }, { ...LC, perf_alert: { enabled: false, recipient_ids: ['U1'] } }, { ...LC, perf_alert: { recipient_ids: [] } }]) {
    const pool = fakePool({ lc, consumers: [C1] });
    const out = await W.runOnce(pool, { now: NOW, send });
    assert.equal(out.items.length, 1);
    assert.equal(pool.writes.length, 1);
  }
  assert.equal(n, 0);
});
