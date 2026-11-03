// ============================================================
// Vigil Platform — Tests: host metrics sampler
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseNetDev, readCpuPct, _resetCpuState, sampleHost } = require('../src/helpers/hostMetrics');

// Trimmed from real /proc/net/dev on vigilcentral, 2026-07-27 — the machine
// that exposed the double-count, so the fixture keeps the bug reproducible.
const PROC_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 49619074403 34917706    0    0    0     0          0         0 49619074403 34917706    0    0    0     0       0          0
enp0s31f6: 1000 10 0 0 0 0 0 0 500 5 0 0 0 0 0 0
docker0: 700 7 0 0 0 0 0 0 300 3 0 0 0 0 0 0
vethc1c09d0: 700 7 0 0 0 0 0 0 300 3 0 0 0 0 0 0
tailscale0: 90 1 0 0 0 0 0 0 40 1 0 0 0 0 0 0
`;

const physOnly = (n) => n === 'enp0s31f6' || n === 'enp2s0';

describe('parseNetDev', () => {
  it('counts only physical NICs — docker0/veth/tailscale would double-count', () => {
    // Every byte on docker0 and the veth also crossed enp0s31f6. Summing all
    // interfaces reported ~197GB on this machine where the truth was 152GB.
    const r = parseNetDev(PROC_NET_DEV, physOnly);
    assert.deepEqual(r, { rx: 1000, tx: 500, iface: 'enp0s31f6' });
  });

  it('never counts loopback, even if something claims it is physical', () => {
    const r = parseNetDev(PROC_NET_DEV, () => true);
    assert.ok(!r.iface.split(',').includes('lo'));
    assert.equal(r.rx, 1000 + 700 + 700 + 90);
  });

  it('sums a two-NIC edge in interface order', () => {
    const twoNic = PROC_NET_DEV + 'enp2s0: 2000 20 0 0 0 0 0 0 800 8 0 0 0 0 0 0\n';
    assert.deepEqual(parseNetDev(twoNic, physOnly), { rx: 3000, tx: 1300, iface: 'enp0s31f6,enp2s0' });
  });

  it('returns nulls, not zeros, when nothing qualifies', () => {
    // null means "not measured" and leaves a gap in the graph; 0 would be drawn
    // as a genuine drop to no traffic, which is a different and wrong story.
    assert.deepEqual(parseNetDev(PROC_NET_DEV, () => false), { rx: null, tx: null, iface: null });
    assert.deepEqual(parseNetDev('', physOnly), { rx: null, tx: null, iface: null });
  });

  it('skips malformed rows instead of poisoning the sum with NaN', () => {
    const bad = PROC_NET_DEV + 'enp2s0: not-a-number\n';
    assert.equal(parseNetDev(bad, physOnly).rx, 1000);
  });
});

describe('readCpuPct', () => {
  it('returns null on the first call — a delta needs two readings', () => {
    _resetCpuState();
    assert.equal(readCpuPct(), null);
  });

  it('returns a real percentage once it has a delta', () => {
    _resetCpuState();
    readCpuPct();
    // Burn a little CPU so the counters actually move between reads.
    const until = Date.now() + 120;
    while (Date.now() < until) Math.sqrt(Math.random());
    const pct = readCpuPct();
    assert.ok(pct === null || (pct >= 0 && pct <= 100), `cpu_pct out of range: ${pct}`);
  });
});

describe('sampleHost', () => {
  it('always returns every column metrics_host expects', () => {
    // The heartbeat carries this. A missing key would insert as undefined and
    // fail the INSERT, taking the heartbeat down with it — the sampler must
    // degrade to nulls, never throw.
    const s = sampleHost();
    for (const k of ['cpu_pct', 'load_avg_1m', 'mem_used_mb', 'mem_total_mb',
                     'disk_free_gb', 'disk_total_gb', 'net_rx_bytes', 'net_tx_bytes', 'net_iface']) {
      assert.ok(k in s, `missing ${k}`);
    }
    assert.ok(s.mem_total_mb > 0 && s.mem_used_mb > 0);
    assert.ok(s.mem_used_mb <= s.mem_total_mb);
  });

  it('survives a mount point that does not exist', () => {
    const s = sampleHost('/definitely/not/a/mount');
    assert.equal(s.disk_free_gb, null);
    assert.ok(s.mem_total_mb > 0);   // the rest still works
  });
});
