// ============================================================
// Vigil Platform — Helper: NVR scan registry
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// In-memory correlation store for the edge NVR channel scan (Phase 3). The
// scan is request/reply over MQTT across processes: the api-server ROUTE
// registers a pending scan_id and publishes the request; the api-server
// LISTEN handler (fed by mqtt-subscriber's pg_notify('scan_result')) resolves
// it when the edge replies. Both live in the api-server process, so a shared
// module-level Map is enough — no DB row for a transient 30s handshake.
// ------------------------------------------------------------
'use strict';

const _scans = new Map(); // scanId → { status, channels?, error?, at }
const TTL_MS = 5 * 60 * 1000;

function register(scanId) {
  _scans.set(scanId, { status: 'pending', at: Date.now() });
}

function resolve(scanId, data) {
  const entry = _scans.get(scanId);
  if (!entry) return; // unknown/expired scan — ignore a late reply
  if (data && data.error) { entry.status = 'error'; entry.error = String(data.error); }
  else { entry.status = 'ready'; entry.channels = Array.isArray(data?.channels) ? data.channels : []; }
  entry.at = Date.now();
}

function get(scanId) {
  const e = _scans.get(scanId);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { _scans.delete(scanId); return null; }
  return e;
}

// prune expired entries so a busy admin session can't grow the map unbounded
function _sweep() {
  const now = Date.now();
  for (const [id, e] of _scans) if (now - e.at > TTL_MS) _scans.delete(id);
}
setInterval(_sweep, TTL_MS).unref();

module.exports = { register, resolve, get };
