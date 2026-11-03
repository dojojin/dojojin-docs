// ============================================================
// Vigil Platform — Tests: bridge on backup path alert
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// เส้นหลัก Tailscale ตกไปเส้นสำรองเกิน 30 นาที → แจ้ง · กลับมา → แจ้งครั้งเดียว · ไซต์เส้นเดียวไม่แจ้ง
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, WARN_MS, REPEAT_MS, onHeartbeat } = require('../src/helpers/bridgePathWatch');

const T0 = Date.parse('2026-10-20T10:00:00Z');
const onSsh = (since) => ({ path: 'ssh', path_since: new Date(since).toISOString(), path_switches: 1 });
const st = () => ({ alertedAt: null });

test('does not alert on a short blip, alerts after 30 minutes on a backup path', () => {
  const s = st();
  assert.equal(evaluate('nrw', onSsh(T0), s, T0 + WARN_MS - 1), null);
  const r = evaluate('nrw', onSsh(T0), s, T0 + WARN_MS);
  assert.equal(r.kind, 'alert');
  assert.match(r.text, /nrw.*ssh.*30 นาที/);
});

test('repeats no more often than every 6 hours', () => {
  const s = st();
  assert.equal(evaluate('nrw', onSsh(T0), s, T0 + WARN_MS).kind, 'alert');
  assert.equal(evaluate('nrw', onSsh(T0), s, T0 + WARN_MS + REPEAT_MS - 1), null);
  assert.equal(evaluate('nrw', onSsh(T0), s, T0 + WARN_MS + REPEAT_MS).kind, 'alert');
});

test('says "recovered" once, only if it had alerted', () => {
  const s = st();
  const primary = { path: 'tailscale', path_since: new Date(T0).toISOString(), path_switches: 2 };
  assert.equal(evaluate('nrw', primary, s, T0), null, 'never alerted → silent');
  evaluate('nrw', onSsh(T0), s, T0 + WARN_MS);
  assert.equal(evaluate('nrw', primary, s, T0 + WARN_MS + 1).kind, 'recovered');
  assert.equal(evaluate('nrw', primary, s, T0 + WARN_MS + 2), null);
});

test('a single-path site (never switched) and an old bridge without path fields never alert', () => {
  assert.equal(evaluate('vss', { path: 'cloudflare', path_since: new Date(T0).toISOString(), path_switches: 0 }, st(), T0 + 99 * WARN_MS), null);
  assert.equal(evaluate('vss', {}, st(), T0 + 99 * WARN_MS), null);
  assert.equal(evaluate('vss', undefined, st(), T0 + 99 * WARN_MS), null);
});

test('LINE off or a failed push does not use up the cooldown; a good push does', async () => {
  const cfg = (enabled) => ({ query: async () => ({ rows: [{ enabled, channel_access_token: 't', perf_alert: { recipient_ids: ['U-only-owner'] } }] }) });
  const sent = [];
  const ok = async (token, id, msgs) => { sent.push([id, msgs[0].text]); return { success: true }; };
  const bad = async () => ({ success: false, error: 'x' });
  const b = onSsh(T0), t = T0 + WARN_MS;
  await onHeartbeat(cfg(false), 'zz-a', b, t, ok);
  assert.equal(sent.length, 0, 'LINE off → nothing sent');
  await onHeartbeat(cfg(true), 'zz-a', b, t + 1000, bad);
  assert.equal(sent.length, 0);
  await onHeartbeat(cfg(true), 'zz-a', b, t + 2000, ok);
  assert.equal(sent.length, 1, 'still alerts once LINE works');
  assert.equal(sent[0][0], 'U-only-owner', 'goes only to the configured recipient');
  await onHeartbeat(cfg(true), 'zz-a', b, t + 3000, ok);
  assert.equal(sent.length, 1, 'then the cooldown holds');
});
