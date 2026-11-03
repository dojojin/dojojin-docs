// ============================================================
// Vigil Platform — Tunnel / Tailscale connectivity sampler
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Pure: reads local system state (systemd, tailscale CLI), returns a plain
// object, touches no DB and no network beyond the local tailscaled socket.
// Every function is null-safe on purpose — same reasoning as storageHealth.js:
// a sampler that throws must never take the heartbeat down with it.
'use strict';

const { execFileSync } = require('child_process');

// cloudflared runs as a systemd unit on every Linux box in this fleet (central
// + edges) per docs/REF_edge-install.md — `systemctl is-active` is the
// authoritative check, not "is the process running" (a hung-but-alive process
// would still show a PID). Returns null (not false) when systemctl itself is
// unavailable (e.g. a non-systemd/non-Linux box) — distinct from a confirmed
// inactive unit, so central never renders a guess as a red alert.
function sampleTunnel() {
  try {
    const out = execFileSync('systemctl', ['is-active', 'cloudflared'],
      { encoding: 'utf8', timeout: 3000 }).trim();
    return { active: out === 'active' };
  } catch (e) {
    // systemctl exits non-zero (still capturing stdout) for inactive/failed/
    // unknown units — all genuinely "not up". A missing systemctl binary itself
    // throws ENOENT before ever producing output; that case is unknowable, not
    // down, so it is the only one reported as null.
    if (e.code === 'ENOENT') return null;
    return { active: false };
  }
}

// `tailscale status --json` — run centrally only. One call from central
// already reports every peer's Online state (this is how Tailscale itself
// works: each node holds the whole tailnet's last-known state), so edges do
// not need their own sampler for this. Returns null when the CLI is missing
// or tailscaled is not running — a box simply never enrolled reports null,
// not "offline", since it was never expected to be online in the first place.
function sampleTailscale() {
  try {
    const out = execFileSync('tailscale', ['status', '--json'],
      { encoding: 'utf8', timeout: 4000 });
    const st = JSON.parse(out);
    const peers = Object.values(st.Peer || {}).map((p) => ({
      hostname: p.HostName || null,
      online:   !!p.Online,
      relay:    p.Relay || null,
      direct:   !!p.CurAddr,
    }));
    return { backend_state: st.BackendState || null, self_online: !!st.Self?.Online, peers };
  } catch {
    return null;
  }
}

module.exports = { sampleTunnel, sampleTailscale };
