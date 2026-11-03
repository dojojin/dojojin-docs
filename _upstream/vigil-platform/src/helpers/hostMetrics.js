// ============================================================
// Vigil Platform — Host metrics sampler (CPU / RAM / disk / NIC)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// One sample of "how is this machine doing", shared by central and every edge
// so both sides of the graph mean the same thing. Pure: reads the OS, returns
// a plain object, touches no DB and no network.
//
// Called once a minute — the edge piggybacks it on the bridge heartbeat that
// already runs at that cadence, so this adds a payload field, not a timer.
'use strict';

const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

// CPU percent needs two readings, so the previous one lives here. Module scope
// is right: one sampler per process, and the first call after boot legitimately
// has nothing to compare against.
let _prevCpu = null;

// Real CPU utilisation from /proc/stat, NOT load average. Load counts tasks in
// uninterruptible I/O sleep, so a box waiting on disk reads "busy" while its
// cores idle — exactly the wrong answer on a machine whose job is writing
// snapshots. load_avg_1m is still reported alongside, as context.
function readCpuPct() {
  let line;
  try {
    line = fs.readFileSync('/proc/stat', 'utf8').split('\n', 1)[0];
  } catch {
    return null;                       // not Linux — caller falls back to load
  }
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  if (f.length < 4 || f.some(Number.isNaN)) return null;
  const idle = f[3] + (f[4] || 0);     // idle + iowait
  const total = f.reduce((a, b) => a + b, 0);
  const prev = _prevCpu;
  _prevCpu = { idle, total };
  if (!prev) return null;              // first call: no delta yet
  const dTotal = total - prev.total;
  const dIdle = idle - prev.idle;
  // A counter that went backwards means the machine rebooted between samples.
  // Report nothing rather than a nonsense number, and let the next call resync.
  if (dTotal <= 0 || dIdle < 0) return null;
  return +(100 * (1 - dIdle / dTotal)).toFixed(1);
}

// A physical NIC has a backing device in sysfs; bridges, veth pairs, docker0,
// tailscale0 and friends do not. Checked rather than pattern-matched on the
// name, because the names are not a contract — verified live on both machines:
// central shows enp0s31f6=yes with docker0/br-*/veth*/tailscale0=no, hdy-edge
// shows enp0s31f6 and enp2s0 both yes.
function isPhysicalIface(name) {
  try { return fs.existsSync(`/sys/class/net/${name}/device`); } catch { return false; }
}

// Byte counters straight from the kernel, summed across physical NICs only.
// Returned RAW, never as a rate: the reader diffs consecutive rows, so one
// missed sample costs one gap instead of corrupting the series, and a reboot is
// visible as next<prev rather than as an enormous spike.
//
// Virtual interfaces MUST be excluded, not merely tidied away. Central runs
// Postgres in Docker, so a packet to the container is counted on the physical
// NIC and again on docker0 and again on the veth — summing everything reported
// 197GB rx where the real figure is a third of that. Only the physical NICs
// carry traffic that actually crossed the wire, and neither machine routes
// between them (the edge pulls from the camera LAN and pushes out through the
// tunnel), so summing those is honest.
function readNet() {
  let txt;
  try {
    txt = fs.readFileSync('/proc/net/dev', 'utf8');
  } catch {
    return { rx: null, tx: null, iface: null };
  }
  return parseNetDev(txt, isPhysicalIface);
}

// Split out from readNet so the column arithmetic can be tested against a
// fixture instead of whatever the host happens to be doing.
function parseNetDev(txt, isPhysical) {
  let rx = 0, tx = 0;
  const names = [];
  for (const raw of txt.split('\n').slice(2)) {
    const m = raw.trim().match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    if (name === 'lo' || !isPhysical(name)) continue;
    const cols = m[2].trim().split(/\s+/).map(Number);
    if (cols.length < 9 || Number.isNaN(cols[0]) || Number.isNaN(cols[8])) continue;
    rx += cols[0];
    tx += cols[8];
    names.push(name);
  }
  if (!names.length) return { rx: null, tx: null, iface: null };
  return { rx, tx, iface: names.join(',') };
}

function readDisk(mount = '/') {
  try {
    const out = execFileSync('df', ['-k', mount], { encoding: 'utf8', timeout: 4000 });
    const p = out.trim().split('\n')[1].trim().split(/\s+/);
    const total = parseInt(p[1], 10);
    const avail = parseInt(p[3], 10);
    if (!Number.isFinite(total) || !Number.isFinite(avail)) return { free_gb: null, total_gb: null };
    return {
      free_gb: +(avail / (1024 * 1024)).toFixed(1),
      total_gb: +(total / (1024 * 1024)).toFixed(1),
    };
  } catch {
    return { free_gb: null, total_gb: null };
  }
}

// Returns the shape metrics_host stores, ready to insert. Every field is
// nullable on purpose — a sampler that throws would take the heartbeat down
// with it, and a heartbeat is worth more than a metric.
function sampleHost(mount = '/') {
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  const cpuPct = readCpuPct();
  const net = readNet();
  const disk = readDisk(mount);
  return {
    // Fall back to load-derived percent only where /proc/stat is unavailable
    // (macOS). Normalised by core count so a 4-core edge and a 20-core central
    // can share one Y axis instead of the small box looking permanently idle.
    cpu_pct: cpuPct != null ? cpuPct : +Math.min(100, (load1 / cores) * 100).toFixed(1),
    load_avg_1m: +load1.toFixed(2),
    mem_total_mb: Math.round(os.totalmem() / (1024 * 1024)),
    mem_used_mb: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)),
    disk_free_gb: disk.free_gb,
    disk_total_gb: disk.total_gb,
    net_rx_bytes: net.rx,
    net_tx_bytes: net.tx,
    net_iface: net.iface,
  };
}

// Static host spec — computed once and cached at module scope. Fields are
// nullable on purpose: a missing file yields null, never a throw.
let _hostSpec = null;
function hostSpec() {
  if (_hostSpec != null) return _hostSpec;

  const spec = {
    cpu_model: null,
    cpu_cores: os.cpus().length || null,
    arch: os.arch() || null,
    os_pretty: null,
    kernel: os.release() || null,
    mem_total_mb: Math.round(os.totalmem() / (1024 * 1024)) || null,
    swap_total_mb: null,
    timezone: null,
  };

  // CPU model from first processor
  try {
    const cpus = os.cpus();
    if (cpus && cpus[0] && cpus[0].model) {
      spec.cpu_model = cpus[0].model;
    }
  } catch {}

  // OS pretty name from /etc/os-release
  try {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    const match = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (match && match[1]) {
      spec.os_pretty = match[1];
    }
  } catch {}

  // Swap total from /proc/meminfo
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const match = meminfo.match(/SwapTotal:\s+(\d+)/);
    if (match && match[1]) {
      spec.swap_total_mb = Math.round(parseInt(match[1], 10) / 1024);
    }
  } catch {}

  // Timezone from JS runtime
  try {
    spec.timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {}

  _hostSpec = spec;
  return spec;
}

module.exports = {
  sampleHost, hostSpec, readCpuPct, readNet, readDisk, isPhysicalIface, parseNetDev,
  _resetCpuState: () => { _prevCpu = null; },
};
