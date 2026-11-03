// ============================================================
// Vigil Platform — Routes: LPR Push Receiver (Hikvision ITCCAM HTTP Push)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CS7 — thin glue only. The ANPR parse/resolve/ingest logic moved to
// ../lpr-core (so the dormant LAN puller can share it) and the downstream
// forward + spool/retry moved to ../lpr-forward. This module just mounts the
// HTTP push endpoint. It is mounted by BOTH api-server.js AND the standalone
// lpr-receiver.js — they call the same core, so the cutover/rollback between
// them is a single cloudflared route flip (advisor #2), no code change.
//
// CS2 — downstream forward is OPT-IN per camera (decision B): a camera forwards
// only if it has an explicit cam.lpr_forward_url (or an admin sets a global
// default below). No camera auto-forwards → prevents silently shipping plate
// PII to a 3rd party (PDPA).
// ============================================================
'use strict';

const path = require('path');
const { ingestLprPush } = require('../lpr-core');
const { createForwarder } = require('../lpr-forward');

module.exports = function lprRoutes(app, pool, { SNAPSHOT_DIR, loadCameraConfig }) {
  // Forwarder owns the CIB delivery + disk spool/retry. Spool holds raw push
  // bodies (plate PII) so it lives under repo-root/spool/ which is gitignored
  // (same class as snapshots/) — never committed.
  //
  // Per-process subdir (advisor #3): both api-server AND lpr-receiver mount this
  // module and run a drain timer. During the cutover window both are up; a shared
  // dir would let the idle process's drain double-POST the active one's spool to
  // CIB. Keying by the entry script (api-server / lpr-receiver) isolates each.
  // APP_NAME is set by each entry script (lpr-receiver.js / api-server.js).
  // argv[1] under PM2 resolves to ProcessContainerFork (PM2 internal), not the
  // app name, so both processes would share one spool dir and double-drain it.
  const procTag = process.env.APP_NAME
               || path.basename(process.argv[1] || 'app', '.js');
  const forwarder = createForwarder({
    spoolDir: path.join(SNAPSHOT_DIR, '..', 'spool', `lpr-forward-${procTag}`),
    label: 'lpr',
    // 6h, not the 1h default. A camera that buffered plates to its microSD while
    // the edge was down replays them ~4x normal rate on reconnect, and the spool
    // drains at ~5/s — the 19-minute hkt outage on 2026-07-30 needed 46 of the
    // 60 available minutes to clear. A 30-40 minute outage would have blown the
    // deadline and dropped plates the partner never got any other way. Disk is
    // not the constraint: ~1MB per plate, 432GB free, so even a full 6h outage
    // is ~68GB.
    maxAgeMs: 6 * 3600 * 1000,
    // 4 → 6 (2026-08-05). Measured at hkt's 17:00 peak: plates arrive at
    // 444/min against a 4-slot ceiling of 423/min — the gap is small but
    // constant, so the spool never empties even though it isn't growing
    // unbounded either (self-feeding: 3 of 4 slots go to drain, 1 to live
    // traffic, so a backlog starves the very slot that would clear it).
    // 6 raises the ceiling to ~630/min (~82 Mbps) against a measured 74 Mbps
    // uplink with 55 already in use by ANPR — leaves headroom for face/tunnel
    // traffic. Not 8: that would be ~110 Mbps, over the real pipe. Move one
    // step at a time — this file's comment above already records what ~7,000
    // simultaneous connections did to this same endpoint.
    maxConcurrent: 6,
  });

  // Global forward default from system_settings (per-camera override wins at
  // call time). Read once at init; settings change rarely (restart to refresh).
  pool.query("SELECT value FROM system_settings WHERE key = 'lpr_forward_default'")
    .then(r => { if (r.rows[0] && r.rows[0].value) { forwarder.setDefault(r.rows[0].value); console.log(`[lpr] forward default = ${r.rows[0].value}`); } })
    .catch(() => { /* no row → no global default */ });

  // express.raw reads multipart body as Buffer (express.json skips multipart)
  const rawBodyParser = require('express').raw({ type: '*/*', limit: '20mb' });

  // Resolve a camera by its lpr_push_token (exact match on a hard-to-guess
  // 122-bit UUID — the entropy is the protection). Returns the config entry or null.
  function camByLprToken(token) {
    if (!token) return null;
    try {
      return (loadCameraConfig().cameras || []).find(c => c.lpr_push_token && c.lpr_push_token === token) || null;
    } catch { return null; }
  }

  // LIVE-HIGH-001: reject unknown tokens before express.raw() buffers the body.
  // log เป็นสรุปทุก 10 นาทีพร้อมต้นทาง (helpers/unknownTokenLog · audit 2026-10-02 · D15)
  const _unknownLpr = require('../helpers/unknownTokenLog').createUnknownTokenLog('lpr-push');
  function lprTokenGate(req, res, next) {
    const cam = camByLprToken(req.params.token);
    if (!cam) {
      _unknownLpr.record(req);
      res.status(200).end('OK');
      req.resume(); // drain socket without buffering into memory
      return;
    }
    req._cam = cam;
    next();
  }

  // POST /lpr/:token — authenticated via per-camera secret token in the path
  app.post('/lpr/:token', lprTokenGate, rawBodyParser, async (req, res) => {
    // Respond 200 immediately — camera retries if it doesn't get a response
    res.status(200).end('OK');

    // CS1 (maintenance pause: stop storing but keep forwarding to CIB) is handled
    // inside ingestLprPush() itself — don't short-circuit here, or a paused camera
    // on the tokened route would silently cut CIB's feed instead of just pausing storage.
    await ingestLprPush({
      rawBody: req.body,
      contentType: req.headers['content-type'] || '',
      pool, SNAPSHOT_DIR, loadCameraConfig,
      forward: forwarder.forward,
      preResolvedCam: req._cam,
    });
  });

  // POST /lpr — legacy unauthenticated route, CLOSED 2026-07-22 (SEC5-HIGH-002 /
  // LIVE-HIGH-003). Zero hits recorded across Central + both live edges for this
  // route's entire history — no camera has ever depended on it. Kept as a stub
  // (no body parsing at all) rather than removed outright so a stray hit is
  // diagnosable instead of a silent 404.
  app.post('/lpr', (req, res) => {
    console.warn('[lpr] legacy /lpr hit after closure — unexpected, investigate source');
    res.status(410).end('Gone — use the tokened /lpr/:token URL');
  });
};
