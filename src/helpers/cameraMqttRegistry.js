// ============================================================
// Vigil Platform — Helper: camera MQTT push registry
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// In-memory correlation store for POST /api/cameras/:id/push-mqtt on an
// edge-site camera — same request/reply-over-MQTT shape as scanRegistry.js /
// purgeRegistry.js (register a reqId + publish the request; the api-server
// LISTEN handler, fed by mqtt-subscriber's pg_notify('camera_mqtt_result'),
// resolves it when the edge replies). Unlike those two, the route itself
// awaits the result with waitFor() instead of handing the client a second GET
// to poll — a "did it work" push needs one round trip, not a poll loop.
'use strict';

const _reqs = new Map(); // reqId → { status, data?, error?, at }
const TTL_MS = 90 * 1000;

function register(reqId) { _reqs.set(reqId, { status: 'pending', at: Date.now() }); }

function resolve(reqId, data) {
  const e = _reqs.get(reqId);
  if (!e) return; // unknown/expired/already-timed-out — late reply, ignore
  if (data && data.error) { e.status = 'error'; e.error = String(data.error); e.data = data; }
  else { e.status = 'ready'; e.data = data; }
  e.at = Date.now();
}

function get(reqId) {
  const e = _reqs.get(reqId);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { _reqs.delete(reqId); return null; }
  return e;
}

// Polls get() until the entry leaves 'pending' or timeoutMs elapses. Returns
// null on timeout — the caller must treat that as "no reply yet, outcome
// unknown, may still land later or may already have been applied", never as
// "failed": the edge could still be mid-RCP-round-trip when we stop waiting.
async function waitFor(reqId, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const e = get(reqId);
    if (e && e.status !== 'pending') return e;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

function _sweep() {
  const now = Date.now();
  for (const [id, e] of _reqs) if (now - e.at > TTL_MS) _reqs.delete(id);
}
setInterval(_sweep, TTL_MS).unref();

module.exports = { register, resolve, get, waitFor };
