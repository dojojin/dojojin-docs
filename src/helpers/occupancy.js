// ============================================================
// Vigil Platform — Occupancy tracker
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// ============================================================
// Occupancy tracker — live "People in Area" KPI
// ============================================================
// Bosch IVA "Counter" / "Crowd" rules emit CountAggregation/Counter events
// with a numeric Count value. Bosch samples at high frequency (several per
// second) and the raw count strobes when tracking briefly loses an object,
// so we apply 2-second median smoothing to produce a stable display number.
// Counters that go silent for > 30s decay to 0 (the area emptied and Bosch
// stopped re-emitting).
//
// Returns the symbols api-server.js still uses after this move: the live Map
// (handed to routes/stats as `occupancy` — the same instance, never a copy),
// the smoothing window it reports, and the sample recorder the pg LISTEN
// bridge feeds CountAggregation/Counter rows into.
module.exports = function occupancyTracker(deps) {
  const { broadcast } = deps;

  const OCC_SMOOTH_WINDOW_MS = 2_000;
  const OCC_STALE_TTL_MS     = 30_000;
  const _occupancy = new Map();   // camera_id -> Map(rule_name -> entry)

  function recordOccupancySample(cameraId, ruleName, rawCount) {
    if (!cameraId || !ruleName) return;
    if (!Number.isFinite(rawCount) || rawCount < 0) return;

    let perCam = _occupancy.get(cameraId);
    if (!perCam) { perCam = new Map(); _occupancy.set(cameraId, perCam); }
    let entry = perCam.get(ruleName);
    if (!entry) { entry = { samples: [], smoothed: 0, raw: 0, lastUpdate: 0 }; perCam.set(ruleName, entry); }

    const now = Date.now();
    entry.samples.push({ ts: now, count: rawCount });
    entry.samples = entry.samples.filter(s => (now - s.ts) <= OCC_SMOOTH_WINDOW_MS);

    const sorted = entry.samples.map(s => s.count).sort((a, b) => a - b);
    const smoothed = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

    const changed = entry.smoothed !== smoothed;
    entry.raw = rawCount;
    entry.smoothed = smoothed;
    entry.lastUpdate = now;

    if (changed) {
      broadcast({
        type: 'occupancy_update',
        camera_id: cameraId,
        rule_name: ruleName,
        current: smoothed,
        raw: rawCount,
        ts: now,
      });
    }
  }

  setInterval(() => {
    const now = Date.now();
    for (const [cid, perCam] of _occupancy.entries()) {
      for (const [rule, entry] of perCam.entries()) {
        if (entry.smoothed > 0 && (now - entry.lastUpdate) > OCC_STALE_TTL_MS) {
          entry.smoothed = 0;
          entry.raw = 0;
          entry.samples = [];
          broadcast({
            type: 'occupancy_update',
            camera_id: cid, rule_name: rule,
            current: 0, raw: 0, ts: now, stale: true,
          });
        }
      }
    }
  }, 5_000);

  return { OCC_SMOOTH_WINDOW_MS, OCC_STALE_TTL_MS, occupancy: _occupancy, recordOccupancySample };
};
