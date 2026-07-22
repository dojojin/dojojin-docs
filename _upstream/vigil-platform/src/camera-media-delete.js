// ============================================================
// Vigil Platform — Camera Media Delete (OPT5-EDGE-005)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Deletes a camera's on-disk media after camera delete (keepData=false).
// Layout is {snapshotDir}/{category}/{date}/{camera}/{slot}/ (snapshot-path.js)
// — camera is nested UNDER date, so there is no single path for "this
// camera's media"; every date-dir under every category must be walked.
//
// SAFETY (destructive, remote-triggered on an edge box — guard paranoid,
// same posture as edge/snapshot-retention.js):
//   • reject-then-use, never sanitize-then-use: empty / '.' / '..' / anything
//     outside [A-Za-z0-9._-] is rejected outright, not coerced
//   • exact dir-name match only (path.join + stat), never prefix/startsWith
//     — "CAM1" can never remove "CAM10"
//   • refuse if snapshotDir is unset / '/' / suspiciously short
//   • idempotent — a dir already gone is silently skipped, so a re-fire
//     after a partial run just cleans up stragglers
// ------------------------------------------------------------
'use strict';

const fs   = require('fs');
const path = require('path');

const CATEGORIES  = ['events', 'face', 'lpr'];
const SAFE_ID_RE  = /^[A-Za-z0-9._-]+$/;

function _safeCamName(camId) {
  const s = String(camId || '');
  if (!s || s === '.' || s === '..' || !SAFE_ID_RE.test(s)) return null;
  return s;
}

async function deleteCameraMedia(snapshotDir, camId, opts = {}) {
  const dryRun = !!opts.dryRun;
  const out = { dirsRemoved: 0, rejected: false };

  const safeCam = _safeCamName(camId);
  if (!safeCam) { out.rejected = true; return out; }

  const abs = snapshotDir ? path.resolve(snapshotDir) : null;
  if (!abs || abs === '/' || abs.length < 4) { out.rejected = true; return out; }

  for (const category of CATEGORIES) {
    const catDir = path.join(abs, category);
    const dateDirs = await fs.promises.readdir(catDir, { withFileTypes: true }).catch(() => []);
    for (const dd of dateDirs) {
      if (!dd.isDirectory()) continue;
      const camDir = path.join(catDir, dd.name, safeCam); // exact join, never startsWith
      const exists = await fs.promises.stat(camDir).then(s => s.isDirectory()).catch(() => false);
      if (!exists) continue;
      if (dryRun) console.log(`[camera-media-delete] (dry-run) would rm -rf ${camDir}`);
      else await fs.promises.rm(camDir, { recursive: true, force: true }).catch(() => {});
      out.dirsRemoved++;
    }
  }
  return out;
}

module.exports = { deleteCameraMedia };

// ------------------------------------------------------------
// Self-check (node src/camera-media-delete.js) — proves: exact-match delete
// (a sibling camera whose id is a prefix/superset of the target is NEVER
// touched), '..'/'.'/empty camIds are rejected outright (not sanitized), a
// missing category dir (no face/) doesn't throw, dry-run deletes nothing,
// and a second real run is a no-op (idempotent).
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const os = require('os');
  (async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'camdel-'));

    // Target camera CAM1, media in events/ across 2 dates. lpr/ has none (missing
    // category dir must not throw). face/ has none either (same reason).
    const cam1Date1 = path.join(base, 'events', '2026-07-01', 'CAM1', '0000');
    const cam1Date2 = path.join(base, 'events', '2026-07-02', 'CAM1', '0400');
    const cam1F1 = path.join(cam1Date1, 'a.jpg');
    const cam1F2 = path.join(cam1Date2, 'b.jpg');

    // Sibling camera CAM10 — id is a superset-by-prefix of CAM1. Must survive
    // an exact-match delete of CAM1 (this is exactly the bug class the audit
    // called out: "exact path derivation, not prefix matching").
    const cam10Dir = path.join(base, 'events', '2026-07-01', 'CAM10', '0000');
    const cam10F   = path.join(cam10Dir, 'c.jpg');

    [cam1Date1, cam1Date2, cam10Dir].forEach(d => fs.mkdirSync(d, { recursive: true }));
    fs.writeFileSync(cam1F1, 'A1'); fs.writeFileSync(cam1F2, 'A2'); fs.writeFileSync(cam10F, 'C');

    const { deleteCameraMedia } = require('./camera-media-delete');

    // ── malicious/degenerate camIds must be rejected, not coerced ──
    for (const bad of ['..', '.', '', null, undefined, 'a/../../b', 'has space']) {
      const r = await deleteCameraMedia(base, bad);
      assert.ok(r.rejected, `camId ${JSON.stringify(bad)} must be rejected`);
    }
    assert.ok(fs.existsSync(cam1F1), 'rejected calls touched nothing');

    // ── dry-run: nothing on disk changes ──
    const dry = await deleteCameraMedia(base, 'CAM1', { dryRun: true });
    assert.strictEqual(dry.dirsRemoved, 2, 'dry-run: would remove 2 date-dirs (events only)');
    assert.ok(fs.existsSync(cam1F1), 'dry-run left CAM1 media untouched');

    // ── real run ──
    const res = await deleteCameraMedia(base, 'CAM1');
    assert.strictEqual(res.dirsRemoved, 2, 'removed CAM1 under both dates');
    assert.ok(!fs.existsSync(cam1Date1), 'CAM1/2026-07-01 gone');
    assert.ok(!fs.existsSync(cam1Date2), 'CAM1/2026-07-02 gone');
    assert.ok(fs.existsSync(cam10F), 'sibling CAM10 (prefix superset) NEVER touched — exact match held');

    // ── idempotent: second real run finds nothing left ──
    const res2 = await deleteCameraMedia(base, 'CAM1');
    assert.strictEqual(res2.dirsRemoved, 0, 'second run is a no-op — idempotent');

    // ── unsafe base path refused ──
    const badBase = await deleteCameraMedia('/', 'CAM1');
    assert.ok(badBase.rejected, 'refuses to operate with snapshotDir="/"');

    fs.rmSync(base, { recursive: true, force: true });
    console.log('camera-media-delete self-check OK');
  })().catch(e => { console.error(e); process.exit(1); });
}
