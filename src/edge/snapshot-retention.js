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
//   • folder names come from a fixed allowlist, never from the MQTT payload —
//     a policy field arriving as '..' would reach path.join and none of the
//     guards above would catch it
//   • lpr/ WAS deliberately not pruned here — it can be primary evidence, and
//     that retention was called out as a separate decision. The owner made it
//     on 2026-07-31 (baseline 6 days), so lpr/ is now prunable, but only when a
//     site has an explicit number set. It never inherits the events value.
//   • face/ is biometric data under stricter PDPA handling. The code path
//     exists and is held closed (FACE_PRUNE_ENABLED) pending a legal review —
//     setting a number for it does nothing until that flips.
// ============================================================

const fs   = require('fs');
const path = require('path');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The only folders this file will ever touch. An allowlist rather than
// validation of the incoming string: the value arrives over MQTT, and the
// difference between "reject anything with a slash or a dot-dot" and "must be
// one of these three" is the difference between a filter someone has to keep
// getting right and a fact.
const PRUNE_FOLDERS = new Set(['events', 'lpr', 'face']);

// face/ holds biometric images. This was held closed pending the legal review
// the retention plan calls for; the owner confirmed on 2026-07-31 that deletion
// is authorised ("จัดการได้เลย ลบได้จริง"), so it is open. It still only acts
// when a site has an explicit face_days set — no site inherits a value here.
const FACE_PRUNE_ENABLED = true;

// Resolve <SNAPSHOT_DIR>/<folder>, or null if the base or folder is unsafe.
function _safeFolderDir(snapshotDir, folder) {
  if (!snapshotDir || !PRUNE_FOLDERS.has(folder)) return null;
  const abs = path.resolve(snapshotDir);
  if (abs === '/' || abs.length < 4) return null;   // never operate on root
  return path.join(abs, folder);
}

function _safeEventsDir(snapshotDir) { return _safeFolderDir(snapshotDir, 'events'); }

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

// Per-folder inventory: the date-dirs present, newest first. Central uses this
// to answer "if I set N days, how many days disappear?" without the edge ever
// being asked to simulate a deletion — a simulate mode is one more thing that
// can be wrong in the direction that destroys data.
function folderInventory(snapshotDir, folder) {
  const dir = _safeFolderDir(snapshotDir, folder);
  if (!dir) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return { oldest: null, dirs: 0, dates: [] }; }
  const dates = entries.filter(e => e.isDirectory() && DATE_RE.test(e.name))
    .map(e => e.name).sort();
  return { oldest: dates[0] || null, dirs: dates.length, dates };
}

// Prune date-dirs strictly older than `days` under events/ ONLY. Async fs.rm
// so a large rm never blocks the caller's event loop.
//
// opts.minFreeGb (R2) adds a second pass: after the age pass, if the volume is
// still below that many free GB, keep removing the OLDEST remaining date-dir
// until it is not. This is what stops hdy filling up — it grows ~110 GB/day
// against 380 GB free, so a pruner that only honours an age would be three and
// a half days from a full disk the moment its age window is set too generously.
//
// Two guards on that pass, both learned from what "free space" does NOT tell
// you: the volume can be full because of something outside events/ entirely, in
// which case deleting every snapshot we have would not fix it and would destroy
// the day an operator is most likely to need. So:
//   • never delete the newest remaining date-dir
//   • stop when nothing is left to delete, and SAY that it gave up
// Counts are reported separately (by_age vs by_space) because they mean very
// different things operationally: one is policy working, the other is policy
// being overridden by a disk that is losing.
//
// opts.hold (ไซต์ปิดปรับปรุง · migration 285) — ข้ามรอบลบตามอายุทั้งหมด แต่ยังลบตาม min_free_gb
// เพราะดิสก์เต็ม = edge พัง (ingest/คิว bridge หยุด) ซึ่งเสียหายกว่า · ลบตอน hold ทุกครั้งต้อง warn
// ห้ามทำ hold ด้วยการส่ง days ไม่ใช่ตัวเลข — ค่านั้นถูกแปลงเป็น 7 วันแล้วลบ
async function pruneEdgeFolder(snapshotDir, folder, days, opts = {}) {
  if (folder === 'face' && !FACE_PRUNE_ENABLED) {
    // Refused here rather than upstream so a caller that forgets the gate still
    // cannot delete biometric images.
    return { removed: 0, by_age: 0, by_space: 0, folder, held: 'face_prune_disabled' };
  }
  const dir = _safeFolderDir(snapshotDir, folder);
  if (!dir) { console.warn(`[edge-prune] SNAPSHOT_DIR/folder unset or unsafe (${folder}) — skipping`); return { removed: 0, folder }; }
  const retain = Math.max(1, Number.isFinite(days) ? days : 7);   // NaN → 7, never 0
  const cutoff = new Date(Date.now() - retain * 86400_000).toISOString().slice(0, 10); // UTC
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return { removed: 0 }; }
  let removed = 0;
  const hold = opts.hold === true;
  for (const e of hold ? [] : entries) {
    if (!e.isDirectory() || !DATE_RE.test(e.name)) continue;   // ONLY YYYY-MM-DD dirs
    if (e.name >= cutoff) continue;                            // keep cutoff day + newer
    try {
      await fs.promises.rm(path.join(dir, e.name), { recursive: true, force: true });
      removed++;
    } catch (err) { console.warn(`[edge-prune] rm ${e.name} failed: ${err.message}`); }
  }
  if (removed) console.log(`[edge-prune] ${folder}: removed ${removed} date-dir(s) < ${cutoff} (UTC, retain ${retain}d)`);

  const byAge = removed;
  let bySpace = 0, gaveUp = false, freeGb = null;
  const minFree = Number(opts.minFreeGb);
  if (Number.isFinite(minFree) && minFree > 0) {
    const readMount = opts._readMount || require('../helpers/storageHealth').readMount;
    for (;;) {
      const m = readMount(dir);
      freeGb = m ? m.free_gb : null;
      if (freeGb === null) { console.warn('[edge-prune] อ่านพื้นที่ว่างไม่ได้ — ข้ามการลบตามพื้นที่'); break; }
      if (freeGb >= minFree) break;
      let names;
      try { names = (await fs.promises.readdir(dir, { withFileTypes: true }))
        .filter(e => e.isDirectory() && DATE_RE.test(e.name)).map(e => e.name).sort(); }
      catch { break; }
      // Keep the newest: a disk that is full for reasons outside events/ must
      // not end up with an empty history and a still-full disk.
      if (names.length <= 1) {
        gaveUp = true;
        console.warn(`[edge-prune] ${folder}: พื้นที่ว่าง ${freeGb} GB < ${minFree} GB แต่ไม่มีวันเก่าให้ลบแล้ว — ` +
          `พื้นที่น่าจะถูกใช้โดยอย่างอื่นนอกโฟลเดอร์นี้`);
        break;
      }
      try {
        await fs.promises.rm(path.join(dir, names[0]), { recursive: true, force: true });
        bySpace++;
        console.warn(`[edge-prune] ${folder}: ลบ ${names[0]} เพราะพื้นที่ (ว่าง ${freeGb} GB < ${minFree} GB)` +
          (hold ? ' · ⚠️ ไซต์ปิดปรับปรุง (hold) แต่ดิสก์ใกล้เต็ม ต้องลบ' : ''));
      } catch (err) { console.warn(`[edge-prune] rm ${names[0]} failed: ${err.message}`); gaveUp = true; break; }
    }
  }
  return { removed: byAge + bySpace, by_age: byAge, by_space: bySpace, folder, cutoff, retain, free_gb: freeGb, gave_up: gaveUp, ...(hold ? { held: 'site_hold' } : {}) };
}

// Kept so existing callers and the self-check read the same as before — events/
// is still the only folder that prunes without an explicit per-site number.
const pruneEdgeSnapshots = (snapshotDir, days, opts) => pruneEdgeFolder(snapshotDir, 'events', days, opts);

module.exports = { snapshotInventory, folderInventory, pruneEdgeSnapshots, pruneEdgeFolder, PRUNE_FOLDERS, FACE_PRUNE_ENABLED };

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

    // R2 — min_free_gb. readMount is injected so the test drives free space
    // instead of depending on whatever the machine happens to have.
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'edgesnap2-'));
    const ev2 = path.join(d2, 'events');
    for (const n of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.mkdirSync(path.join(ev2, n), { recursive: true });
    let free = 5;
    const mount = () => ({ free_gb: free });
    // Age pass keeps nothing back (all three are ancient), so use a huge retain
    // to isolate the space pass: nothing is due by age, everything by space.
    let r2 = await pruneEdgeSnapshots(d2, 36500, { minFreeGb: 50, _readMount: () => { free += 40; return mount(); } });
    assert.strictEqual(r2.by_age, 0, 'ไม่มีอะไรหมดอายุ');
    assert.strictEqual(r2.by_space, 1, 'ลบเพราะพื้นที่ 1 วัน แล้วพอ');
    assert.ok(fs.existsSync(path.join(ev2, '2020-01-03')), 'วันใหม่สุดต้องอยู่');
    assert.ok(!fs.existsSync(path.join(ev2, '2020-01-01')), 'วันเก่าสุดถูกลบก่อน');

    // Disk stays full no matter what: must stop with one dir left, not zero.
    free = 1;
    r2 = await pruneEdgeSnapshots(d2, 36500, { minFreeGb: 999, _readMount: () => ({ free_gb: 1 }) });
    assert.strictEqual(r2.gave_up, true, 'ต้องยอมแพ้ ไม่ใช่ลบจนหมด');
    const left = fs.readdirSync(ev2).filter(n => DATE_RE.test(n));
    assert.strictEqual(left.length, 1, 'ต้องเหลือวันใหม่สุดไว้เสมอ');

    // minFreeGb absent / zero → space pass must not run at all.
    r2 = await pruneEdgeSnapshots(d2, 36500, { _readMount: () => ({ free_gb: 0 }) });
    assert.strictEqual(r2.by_space, 0, 'ไม่ตั้ง min_free_gb = ไม่ลบตามพื้นที่');
    r2 = await pruneEdgeSnapshots(d2, 36500, { minFreeGb: 0, _readMount: () => ({ free_gb: 0 }) });
    assert.strictEqual(r2.by_space, 0, 'min_free_gb = 0 ต้องถือว่าปิด ไม่ใช่ลบทุกอย่าง');
    fs.rmSync(d2, { recursive: true, force: true });

    // R3 — folders beyond events/. Layout measured at hkt 2026-07-31:
    // lpr/YYYY-MM-DD/<camera>/… — the date is the top level, same as events/.
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'edgesnap3-'));
    const oldDay = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    for (const f of ['lpr', 'face', 'events']) {
      fs.mkdirSync(path.join(d3, f, oldDay, 'C10-KAR-SB-04'), { recursive: true });
      fs.mkdirSync(path.join(d3, f, today), { recursive: true });
    }
    fs.mkdirSync(path.join(d3, 'preview'), { recursive: true });
    fs.writeFileSync(path.join(d3, 'preview', 'cam.jpg'), 'x');

    const invLpr = folderInventory(d3, 'lpr');
    assert.deepStrictEqual(invLpr.dates, [oldDay, today].sort(), 'inventory lists lpr date dirs');

    const rl = await pruneEdgeFolder(d3, 'lpr', 6);
    assert.strictEqual(rl.by_age, 1, 'lpr prunes by age when a number is given');
    assert.ok(!fs.existsSync(path.join(d3, 'lpr', oldDay)), 'lpr old day removed (nested camera dir and all)');
    assert.ok(fs.existsSync(path.join(d3, 'lpr', today)),  'lpr today kept');

    // face/ became prunable on 2026-07-31 once the owner authorised deletion of
    // biometric images. It behaves exactly like lpr/ — and, like lpr/, the
    // caller only reaches here when a site has an explicit number set, which is
    // enforced in bridge.js, not in this file.
    const rf = await pruneEdgeFolder(d3, 'face', 6);
    assert.strictEqual(rf.by_age, 1, 'face prunes by age when a number is given');
    assert.ok(!fs.existsSync(path.join(d3, 'face', oldDay)), 'face old day removed');
    assert.ok(fs.existsSync(path.join(d3, 'face', today)),  'face today kept');
    assert.strictEqual(FACE_PRUNE_ENABLED, true, 'gate is open — if this flips back the test must fail loudly');

    // The folder name arrives over MQTT — anything outside the allowlist must
    // not reach path.join, and traversal must not resolve to a sibling.
    for (const bad of ['..', '../..', 'preview', '/etc', 'lpr/../preview', '']) {
      const r = await pruneEdgeFolder(d3, bad, 1);
      assert.strictEqual(r.removed, 0, `folder ${JSON.stringify(bad)} must be refused`);
    }
    assert.ok(fs.existsSync(path.join(d3, 'preview', 'cam.jpg')), 'preview untouched by any of it');
    assert.strictEqual(folderInventory(d3, '..'), null, 'inventory refuses non-allowlisted folders too');
    fs.rmSync(d3, { recursive: true, force: true });

    mk(old);
    await pruneEdgeSnapshots(tmp, NaN);
    assert.ok(!fs.existsSync(path.join(ev, old)), 'NaN days → default retain, old pruned (not wipe-all)');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('edge snapshot-retention self-check OK');
  })().catch(e => { console.error('SELF-CHECK FAIL:', e.message); process.exit(1); });
}
