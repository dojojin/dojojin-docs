// ============================================================
// Vigil Platform — Storage stats sampler (spool, clips)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Spool queue depth and clips inventory, shared by health.js and storage.js.
// Wrapped in module-level cache so both callers benefit — health.js already
// caches to avoid 35s+ endpoint latency on every poll; storage.js reuses that
// same cached result rather than walking the filesystem twice.
'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 35_000;  // Match health.js _HEALTH_CACHE_TTL_MS
const _cache = new Map();

async function _cached(key, fn) {
  const hit = _cache.get(key);
  const now = Date.now();
  if (hit && (now - hit.at) < CACHE_TTL_MS) return hit.value;
  const value = await fn();
  _cache.set(key, { value, at: now });
  return value;
}

async function _dirSize(dir) {
  let bytes = 0, files = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, e.name));
        bytes += st.size;
        files++;
      } catch {}
    }
  } catch {}
  return { bytes, files };
}

// Spool queue depth (LPR forward items awaiting delivery)
async function spoolStats(snapshotDir) {
  return _cached(`spool_stats:${snapshotDir}`, async () => {
    const SPOOL_BASE = path.join(snapshotDir, '..', 'spool');
    let files = 0, bytes = 0;
    for (const sub of ['lpr-forward-api-server', 'lpr-forward-lpr-receiver']) {
      try {
        const dir = path.join(SPOOL_BASE, sub);
        for (const f of await fs.promises.readdir(dir)) {
          if (!f.endsWith('.json')) continue;
          files++;
          try { bytes += (await fs.promises.stat(path.join(dir, f))).size; } catch {}
        }
      } catch {}
    }
    return { spool_files: files, spool_mb: Math.round(bytes / (1024 * 1024)) };
  });
}

// Clips directory inventory (recorded video files)
async function clipsStats(mediaDir) {
  // ⚠️ path ต้องอยู่ใน cache key — ไม่งั้นผู้เรียกสองรายที่ส่งคนละ dir จะกินผลของกันเอง
  // ภายใน TTL 35 วิ แล้วตัวเลข "คลิป" ของสองหน้าจะไม่ตรงกันแบบเงียบ ๆ
  return _cached(`clips_stats:${mediaDir}`, async () => {
    const { bytes, files } = await _dirSize(mediaDir);
    return { clips_files: files, clips_mb: Math.round(bytes / (1024 * 1024)) };
  });
}

module.exports = { spoolStats, clipsStats };
