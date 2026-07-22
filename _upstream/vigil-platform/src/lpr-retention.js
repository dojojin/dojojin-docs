// ============================================================
// Vigil Platform — LPR Retention (RF4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// LPR data is high-volume (a row+images per passing vehicle) and PII (plate +
// face-in-scene), so it gets its OWN, shorter retention than general events:
//   lpr_image_retention_days  (default 7)  — prune the JPGs (PII + disk) sooner
//   lpr_retention_days        (default 30) — prune the metadata rows later
// Decoupled (advisor): images go first; the plate text/metadata survives for
// forensic search. image-days is capped ≤ metadata-days at runtime (an image
// must never outlive its row). The detail modal shows a plaque/vehicle-vector
// fallback once the image is gone (page-lpr.js _lprMediaFallback).
//
// Deps are injected so this is unit-testable without booting api-server.
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

// Matches edge's date-dir naming (src/edge/snapshot-retention.js DATE_RE).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── File prune (PURE fs) — lprRoot = .../lpr, NOT .../snapshots (the sibling
// lpr-watchlist/ is never entered). Handles both old layout (lpr/date/file) and
// new layout (lpr/date/cam/slot/file) by recursing into subdirs and cleaning up
// empty dirs bottom-up. Per-file mtime — this is the slow-but-exact path, kept
// for the boundary day (see pruneLprImages) and any non-date-named legacy dir.
async function _pruneSubdir(dir, cutoffMs, dryRun) {
  let filesDeleted = 0, bytesFreed = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = await _pruneSubdir(full, cutoffMs, dryRun);
      filesDeleted += r.filesDeleted; bytesFreed += r.bytesFreed;
      if (!dryRun) {
        const left = await fs.promises.readdir(full).catch(() => ['_']);
        if (left.length === 0) await fs.promises.rmdir(full).catch(() => {});
      }
    } else if (e.isFile()) {
      const st = await fs.promises.stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoffMs) {
        bytesFreed += st.size;
        if (!dryRun) await fs.promises.unlink(full).catch(() => {});
        filesDeleted++;
      }
    }
  }
  return { filesDeleted, bytesFreed };
}

// Fast path — whole date-dir strictly older than the cutoff DATE (not the
// cutoff dir itself) is guaranteed to contain only expired files, because
// every file under lpr/<YYYY-MM-DD>/ was captured that calendar date. Safe to
// rm -rf without opening a single file (OPT5-CEN-002). Mirrors
// pruneEdgeSnapshots' `< cutoff` boundary — the cutoff day itself always goes
// through the slow per-file path below, since it may still be receiving
// today's captures with mixed old/new mtimes.
async function pruneLprImages(lprRoot, cutoffMs, opts = {}) {
  const dryRun = !!opts.dryRun;
  let filesDeleted = 0, bytesFreed = 0, dirsRemoved = 0;
  const cutoffDateStr = new Date(cutoffMs).toISOString().slice(0, 10); // UTC, matches folder naming
  const dateDirs = await fs.promises.readdir(lprRoot, { withFileTypes: true }).catch(() => []);
  for (const dd of dateDirs) {
    if (!dd.isDirectory()) continue;
    const dateDir = path.join(lprRoot, dd.name);
    if (DATE_RE.test(dd.name) && dd.name < cutoffDateStr) {
      if (dryRun) console.log(`[lpr-retention] (dry-run) would rm -rf ${dateDir}`);
      else await fs.promises.rm(dateDir, { recursive: true, force: true }).catch(() => {});
      dirsRemoved++;
      continue;
    }
    const r = await _pruneSubdir(dateDir, cutoffMs, dryRun);
    filesDeleted += r.filesDeleted; bytesFreed += r.bytesFreed;
    if (!dryRun) {
      const left = await fs.promises.readdir(dateDir).catch(() => ['_']);
      if (left.length === 0) await fs.promises.rmdir(dateDir).catch(() => {});
    }
  }
  return { filesDeleted, bytesFreed, dirsRemoved };
}

// ── Row prune (DB) — anprAlarm events older than cutoff + license_plates/lpr_alert_acks.
// Batched id-IN-subquery (mirrors enforceRetention) so each batch is a short
// transaction. Children deleted explicitly — no FK cascade after
// MANUAL_partition_events_option_a.sql (Option A is app-enforced).
async function pruneLprRows(pool, cutoffIso, batch) {
  let total = 0, n;
  do {
    const ids = await pool.query(
      `SELECT id FROM events WHERE event_type = 'anprAlarm' AND event_time < $1 ORDER BY event_time LIMIT $2`,
      [cutoffIso, batch]
    );
    n = ids.rowCount;
    if (n === 0) break;
    const arr = ids.rows.map(r => r.id);
    await pool.query(`DELETE FROM license_plates WHERE event_id = ANY($1::bigint[])`, [arr]);
    await pool.query(`DELETE FROM lpr_alert_acks WHERE event_id = ANY($1::bigint[])`, [arr]);
    const del = await pool.query(`DELETE FROM events WHERE id = ANY($1::bigint[])`, [arr]);
    total += del.rowCount;
    if (n === batch) await new Promise(r => setTimeout(r, 100)); // yield between batches
  } while (n === batch);
  return total;
}

async function enforceLprRetention({ pool, snapshotDir, metaDays, imageDays, batch = 10000, dryRunImages = false }) {
  const out = { rowsDeleted: 0, filesDeleted: 0, bytesFreed: 0, dirsRemoved: 0, metaDays: 0, imageDays: 0 };
  const mDays = Math.min(730, Math.max(1, parseInt(metaDays, 10) || 30));
  const iDays = Math.min(mDays, Math.max(1, parseInt(imageDays, 10) || 7)); // image ≤ metadata
  out.metaDays = mDays; out.imageDays = iDays;

  const cutoffIso = new Date(Date.now() - mDays * 86400 * 1000).toISOString();
  out.rowsDeleted = await pruneLprRows(pool, cutoffIso, batch);

  const imgCutoffMs = Date.now() - iDays * 86400 * 1000;
  const r = await pruneLprImages(path.join(snapshotDir, 'lpr'), imgCutoffMs, { dryRun: dryRunImages });
  out.filesDeleted = r.filesDeleted; out.bytesFreed = r.bytesFreed; out.dirsRemoved = r.dirsRemoved;
  return out;
}

module.exports = { enforceLprRetention, pruneLprImages, pruneLprRows };

// ------------------------------------------------------------
// Self-check (node src/lpr-retention.js) — PURE file prune only (the rm path is
// the risky one). Proves: whole expired date-dirs go via the fast rm -rf path,
// the boundary day (named exactly as the cutoff date) still goes through the
// exact per-file path so mixed old/new mtimes on that day are handled
// correctly, recent dirs are untouched, dry-run deletes nothing, and a
// sibling lpr-watchlist/ is NEVER touched (OPT5-CEN-002).
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const os = require('os');
  (async () => {
    const base    = fs.mkdtempSync(path.join(os.tmpdir(), 'lprret-'));
    const lprRoot = path.join(base, 'lpr');
    const wl      = path.join(base, 'lpr-watchlist');  // sibling — must survive

    const cutoff = Date.now() - 7 * 86400 * 1000;
    const cutoffDateStr = new Date(cutoff).toISOString().slice(0, 10);

    // Whole date-dir well before cutoff → must go via fast rm -rf path,
    // regardless of individual file mtimes inside (old flat layout).
    const fastFlat  = path.join(lprRoot, '2020-01-01');
    const fastFlatF = path.join(fastFlat, 'lpr_scene_X_1.jpg');
    // Same, but new nested layout: lpr/date/cam/slot/file.
    const fastNested  = path.join(lprRoot, '2020-02-01', 'CAM01', '0800');
    const fastNestedF = path.join(fastNested, 'lpr_scene_1.jpg');

    // Boundary day: dir named EXACTLY as the cutoff date. Must NOT go via the
    // fast path (dd.name < cutoffDateStr is false when equal) — contains one
    // file older than cutoffMs (delete) and one newer (keep), proving the
    // slow per-file path still runs correctly here.
    const boundaryDir  = path.join(lprRoot, cutoffDateStr, 'CAM01', '0000');
    const boundaryOldF = path.join(boundaryDir, 'old.jpg');
    const boundaryNewF = path.join(boundaryDir, 'new.jpg');

    // Recent dir → untouched entirely.
    const keepNested = path.join(lprRoot, '2099-01-01', 'CAM01', '0000');
    const keepF      = path.join(keepNested, 'lpr_scene_2.jpg');

    [fastFlat, fastNested, boundaryDir, keepNested, wl].forEach(d => fs.mkdirSync(d, { recursive: true }));
    fs.writeFileSync(fastFlatF,     'FAST_FLAT');
    fs.writeFileSync(fastNestedF,   'FAST_NESTED');
    fs.writeFileSync(boundaryOldF,  'BOUNDARY_OLD');
    fs.writeFileSync(boundaryNewF,  'BOUNDARY_NEW');
    fs.writeFileSync(keepF,         'NEW');
    fs.writeFileSync(path.join(wl, 'suspect.jpg'), 'WL');

    const veryOld = Date.now() - 40 * 86400 * 1000;
    [fastFlatF, fastNestedF].forEach(f => fs.utimesSync(f, new Date(veryOld), new Date(veryOld)));
    fs.utimesSync(boundaryOldF, new Date(cutoff - 3600_000), new Date(cutoff - 3600_000)); // 1h before cutoff
    fs.utimesSync(boundaryNewF, new Date(cutoff + 3600_000), new Date(cutoff + 3600_000)); // 1h after cutoff

    // ── dry-run first: nothing on disk may change ──
    const dry = await pruneLprImages(lprRoot, cutoff, { dryRun: true });
    assert.strictEqual(dry.dirsRemoved, 2, 'dry-run: would remove 2 whole date-dirs');
    assert.strictEqual(dry.filesDeleted, 1, 'dry-run: would delete 1 boundary-day file');
    assert.ok(fs.existsSync(fastFlatF),   'dry-run: fast-path file untouched');
    assert.ok(fs.existsSync(boundaryOldF),'dry-run: boundary old file untouched');

    // ── real run ──
    const res = await pruneLprImages(lprRoot, cutoff);

    assert.strictEqual(res.dirsRemoved, 2,  'both pre-cutoff date-dirs removed via fast path');
    assert.strictEqual(res.filesDeleted, 1, 'exactly the boundary-day old file counted (slow path)');
    assert.ok(!fs.existsSync(fastFlat),   'fast-path flat date dir gone (whole dir rm)');
    assert.ok(!fs.existsSync(path.dirname(path.dirname(fastNested))), 'fast-path nested date dir gone (whole dir rm)');
    assert.ok(!fs.existsSync(boundaryOldF), 'boundary old file gone (slow path)');
    assert.ok(fs.existsSync(boundaryNewF),  'boundary new file kept (slow path, correct mtime)');
    assert.ok(fs.existsSync(keepF),         'recent file kept');
    assert.ok(fs.existsSync(path.join(wl, 'suspect.jpg')), 'lpr-watchlist sibling NEVER touched');

    fs.rmSync(base, { recursive: true, force: true });
    console.log('lpr-retention self-check OK');
  })().catch(e => { console.error(e); process.exit(1); });
}
