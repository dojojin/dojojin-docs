// ============================================================
// Vigil Platform — Edge Snapshot Retention + Inventory
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Edge nodes capture Bosch/IVA scene JPGs to local disk (edge-config-agent)
// but run NO api-server → NO retention → disk fills. This prunes expired
// snapshot date-dirs and reports a cheap inventory (oldest date + dir count)
// so central can see whether retention is working.
//
// SAFETY (destructive, runs unwatched on a remote box — guard paranoid):
//   • only ever rm dirs whose basename is exactly YYYY-MM-DD
//   • only descend into <SNAPSHOT_DIR>/events (Bosch scene) — never the root,
//     so preview/ and lpr-watchlist/ siblings are structurally out of reach
//   • refuse to run if SNAPSHOT_DIR is unset / '/' / suspiciously short
//   • NaN retention → default (never 0 = wipe-all); clamp ≥1
//   • cutoff computed in UTC (date-dirs are named via toISOString, UTC)
//   • lpr/ is deliberately NOT pruned here — edge LPR images may be primary
//     evidence (PDPA/legal weight); that retention is a separate decision.
// ============================================================

const fs   = require('fs');
const path = require('path');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolve <SNAPSHOT_DIR>/events, or null if the base is unset/unsafe.
function _safeEventsDir(snapshotDir) {
  if (!snapshotDir) return null;
  const abs = path.resolve(snapshotDir);
  if (abs === '/' || abs.length < 4) return null;   // never operate on root
  return path.join(abs, 'events');
}

// Cheap inventory — one readdir of events/ (top-level date dirs), no recursion.
// { oldest: 'YYYY-MM-DD'|null, dirs: <count of date dirs> }
function snapshotInventory(snapshotDir) {
  const dir = _safeEventsDir(snapshotDir);
  if (!dir) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return { oldest: null, dirs: 0 }; }
  const dates = entries
    .filter(e => e.isDirectory() && DATE_RE.test(e.name))
    .map(e => e.name)
    .sort();                                         // lexical = chronological
  return { oldest: dates[0] || null, dirs: dates.length };
}

// Prune date-dirs strictly older than `days` under events/ ONLY. Async fs.rm
// so a large rm never blocks the caller's event loop.
async function pruneEdgeSnapshots(snapshotDir, days) {
  const dir = _safeEventsDir(snapshotDir);
  if (!dir) { console.warn('[edge-prune] SNAPSHOT_DIR unset/unsafe — skipping'); return { removed: 0 }; }
  const retain = Math.max(1, Number.isFinite(days) ? days : 7);   // NaN → 7, never 0
  const cutoff = new Date(Date.now() - retain * 86400_000).toISOString().slice(0, 10); // UTC
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return { removed: 0 }; }
  let removed = 0;
  for (const e of entries) {
    if (!e.isDirectory() || !DATE_RE.test(e.name)) continue;   // ONLY YYYY-MM-DD dirs
    if (e.name >= cutoff) continue;                            // keep cutoff day + newer
    try {
      await fs.promises.rm(path.join(dir, e.name), { recursive: true, force: true });
      removed++;
    } catch (err) { console.warn(`[edge-prune] rm ${e.name} failed: ${err.message}`); }
  }
  if (removed) console.log(`[edge-prune] removed ${removed} date-dir(s) < ${cutoff} (UTC, retain ${retain}d)`);
  return { removed, cutoff };
}

module.exports = { snapshotInventory, pruneEdgeSnapshots };

// ── Self-check — node src/edge/snapshot-retention.js ─────────
// Asserts the GUARDS (what matters when it runs unwatched), not just happy path.
if (require.main === module) {
  const os = require('os');
  const assert = require('assert');
  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edgesnap-'));
    const ev = path.join(tmp, 'events');
    const mk = d => fs.mkdirSync(path.join(ev, d), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const old   = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    mk(old); mk(today); mk('junk-not-a-date');
    fs.mkdirSync(path.join(tmp, 'preview'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'preview', 'cam1.jpg'), 'x');   // sibling — must survive

    const inv = snapshotInventory(tmp);
    assert.strictEqual(inv.dirs, 2, 'inventory counts only date dirs (old+today, junk excluded)');
    assert.strictEqual(inv.oldest, old, 'oldest = old date');

    await pruneEdgeSnapshots(tmp, 7);
    assert.ok(!fs.existsSync(path.join(ev, old)),               'old date-dir removed');
    assert.ok(fs.existsSync(path.join(ev, today)),             'today kept');
    assert.ok(fs.existsSync(path.join(ev, 'junk-not-a-date')), 'non-date dir untouched');
    assert.ok(fs.existsSync(path.join(tmp, 'preview', 'cam1.jpg')), 'preview sibling untouched');

    assert.strictEqual((await pruneEdgeSnapshots('',  7)).removed, 0, 'unset dir refused');
    assert.strictEqual((await pruneEdgeSnapshots('/', 7)).removed, 0, 'root refused');

    mk(old);
    await pruneEdgeSnapshots(tmp, NaN);
    assert.ok(!fs.existsSync(path.join(ev, old)), 'NaN days → default retain, old pruned (not wipe-all)');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('edge snapshot-retention self-check OK');
  })().catch(e => { console.error('SELF-CHECK FAIL:', e.message); process.exit(1); });
}
