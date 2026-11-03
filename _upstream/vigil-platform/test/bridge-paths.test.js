// ============================================================
// Vigil Platform — Tests: edge bridge path selection
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// 2026-10-18: Tailscale primary, SSH -R backup, Cloudflare wss last (owner's call).
// Failover must be quick; failback must not flap.
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUrls, pathName, decide, FAILOVER_MS, MIN_DWELL_MS, FAILBACK_OK } = require('../src/edge/bridgePaths');

const URLS = 'mqtt://100.89.1.29:1883, mqtt://127.0.0.1:18830 ,wss://dashboard.dojojin.tech/mqtt';
const base = { idx: 0, count: 3, connected: true, downSince: null, since: 0, probeOk: 0 };

test('parses the ordered list and names each path', () => {
  const l = parseUrls(URLS);
  assert.deepEqual(l.map(pathName), ['tailscale', 'ssh', 'cloudflare']);
  assert.deepEqual(parseUrls(''), []);
  assert.deepEqual(parseUrls(undefined), []);
});

test('stays put while connected, and before the failover window ends', () => {
  assert.equal(decide(base, 1e6), null);
  assert.equal(decide({ ...base, connected: false, downSince: 1e6 }, 1e6 + FAILOVER_MS - 1), null);
});

test('moves down the list when the current path stays down, and wraps to the top', () => {
  const down = { ...base, connected: false, downSince: 0 };
  assert.equal(decide(down, FAILOVER_MS), 1);
  assert.equal(decide({ ...down, idx: 1 }, FAILOVER_MS), 2);
  assert.equal(decide({ ...down, idx: 2 }, FAILOVER_MS), 0);
});

test('returns to the primary only after enough good probes and the minimum dwell', () => {
  const backup = { ...base, idx: 1, since: 0, probeOk: FAILBACK_OK };
  assert.equal(decide(backup, MIN_DWELL_MS), 0);
  assert.equal(decide(backup, MIN_DWELL_MS - 1), null, 'no flapping right after a switch');
  assert.equal(decide({ ...backup, probeOk: FAILBACK_OK - 1 }, MIN_DWELL_MS), null);
  assert.equal(decide({ ...backup, connected: false }, MIN_DWELL_MS), null, 'a dead backup fails over, it does not fail back blindly');
});

test('a single URL never switches (old behaviour, watchdog handles it)', () => {
  assert.equal(decide({ ...base, count: 1, connected: false, downSince: 0 }, 10 * FAILOVER_MS), null);
});
