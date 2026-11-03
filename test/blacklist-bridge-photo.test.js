// ============================================================
// Vigil Platform — Blacklist bridge photo freshness
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Both bridges copy a photo out of blacklist-photos/ and show it on an alarm,
// and both used to miss it when the SOURCE photo was corrected in place —
// ผธ4973 showed a "ไม่มีข้อมูล" placeholder on live alarms for over a day
// (2026-08-22). The two halves are fixed differently, so they are pinned
// differently:
//
//   LPR  — sync() re-copies every desired row's photo, and attemptAutoSync()
//          now does it too, before its early return. What needs pinning is the
//          exclusions: manual-owned plates, and plates not inserted yet.
//   Face — a copy is cheap but an embed is an HTTP call to the edge, so the
//          same trick would fire N network calls per import. Instead the source
//          file's sha1 rides in the diff and a changed photo becomes an
//          ordinary update. What needs pinning is that comparison, especially
//          the null case that would otherwise loop forever.
//
// Runs against a scratch SNAPSHOT_DIR (set before requiring the modules — both
// freeze their REF_DIR at load time) and plain in-memory objects. No pool, no
// live data touched.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-bridge-photo-'));
process.env.SNAPSHOT_DIR = TMP;

const PHOTO_DIR = path.join(__dirname, '..', 'blacklist-photos');
const bridge = require('../src/helpers/blacklistBridge');
const faceBridge = require('../src/helpers/blacklistFaceBridge');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// ---------- a real source photo to copy, without depending on live data ----------
// Any file under PHOTO_DIR works; the bridge only cares that the path resolves
// inside it. Written under a source id no import uses, removed at the end.
const FAKE_SRC_REL = path.join('_test', 'bridge-photo.jpg');
const FAKE_SRC_ABS = path.join(PHOTO_DIR, FAKE_SRC_REL);
fs.mkdirSync(path.dirname(FAKE_SRC_ABS), { recursive: true });
fs.writeFileSync(FAKE_SRC_ABS, Buffer.from('the corrected photo, not the placeholder'));

const REF_DIR = path.join(TMP, 'lpr-watchlist');
const refFor = (master) => path.join(REF_DIR, `wl_bridge_${master}.jpg`);
const written = (master) => fs.existsSync(refFor(master));

// diff() output, shaped the way materializeDesiredPhotos() reads it
function fakeDiff({ desired, skipped = [], add = [] }) {
  return { desired: new Map(desired), skipped, add };
}

console.log('materializeDesiredPhotos()');

const { materializeDesiredPhotos } = bridge.__test;

// The bug this whole file exists for: the row is unchanged, the photo is not.
check('refreshes a photo for a row that is not being written', () => {
  fs.rmSync(REF_DIR, { recursive: true, force: true });
  materializeDesiredPhotos(fakeDiff({
    desired: [['กก1234', { blacklist_master_id: '901', photo_source: FAKE_SRC_REL }]],
  }));
  assert.ok(written('901'), 'expected wl_bridge_901.jpg to be written');
  assert.strictEqual(fs.readFileSync(refFor('901')).toString(),
    fs.readFileSync(FAKE_SRC_ABS).toString(), 'the copy must match the source bytes');
});

// THE ONE INVARIANT (see the module header): a plate an operator typed is
// theirs. Writing our image over their reference photo is the filesystem half
// of the same rule the origin guard protects in SQL.
check('never writes for a manual-owned plate', () => {
  fs.rmSync(REF_DIR, { recursive: true, force: true });
  materializeDesiredPhotos(fakeDiff({
    desired: [['กก1234', { blacklist_master_id: '902', photo_source: FAKE_SRC_REL }]],
    skipped: ['กก1234'],
  }));
  assert.ok(!written('902'), 'a manual-owned plate must not get a bridge image');
});

// attemptAutoSync() calls this BEFORE the pending-review guard, which can hold
// the sync for as long as it takes a human to look. A plate still waiting to be
// inserted would otherwise leave an image with no row pointing at it.
check('existingOnly skips plates that have no row yet', () => {
  const d = fakeDiff({
    desired: [
      ['กก1234', { blacklist_master_id: '903', photo_source: FAKE_SRC_REL }],  // already live
      ['ขข5678', { blacklist_master_id: '904', photo_source: FAKE_SRC_REL }],  // pending insert
    ],
    add: [{ plate_number: 'ขข5678' }],
  });
  fs.rmSync(REF_DIR, { recursive: true, force: true });
  materializeDesiredPhotos(d, { existingOnly: true });
  assert.ok(written('903'), 'a live row must still be refreshed');
  assert.ok(!written('904'), 'a not-yet-inserted plate must not leave an orphan image');

  // ...and without the flag — sync(), inside the transaction that inserts it — it does
  fs.rmSync(REF_DIR, { recursive: true, force: true });
  materializeDesiredPhotos(d);
  assert.ok(written('904'), 'sync() must write the image for a row it is inserting');
});

check('a row with no source photo is simply left alone', () => {
  fs.rmSync(REF_DIR, { recursive: true, force: true });
  materializeDesiredPhotos(fakeDiff({
    desired: [['กก1234', { blacklist_master_id: '905', photo_source: null }]],
  }));
  assert.ok(!written('905'), 'no source photo means nothing to copy');
});

console.log('faceRowChanged()');

const { faceRowChanged, sourcePhotoSha1 } = faceBridge.__test;
const ROW = { label: 'L', notes: null, group_id: null, notify_line: true };

check('a corrected source photo counts as changed', () => {
  assert.strictEqual(
    faceRowChanged({ ...ROW, photo_sha1: 'OLDHASH' }, { ...ROW, photo_sha1: 'NEWHASH' }),
    true, 'a changed photo must produce an update');
});

check('an unchanged photo produces no work', () => {
  assert.strictEqual(
    faceRowChanged({ ...ROW, photo_sha1: 'SAMEHASH' }, { ...ROW, photo_sha1: 'SAMEHASH' }),
    false, 'an identical photo must not re-embed — an embed is an HTTP call to the edge');
});

// The flapping loop, and the reason the comparison is one-directional: an
// unreadable file means "no opinion", not "changed". Compared plainly it would
// land in update every sync, fail to embed every time, forever.
check('an unreadable source photo does not re-embed forever', () => {
  assert.strictEqual(
    faceRowChanged({ ...ROW, photo_sha1: 'OLDHASH' }, { ...ROW, photo_sha1: null }),
    false, 'a null source hash must not count as a change');
});

// Rows written before migration 169 carry no hash. One backfill pass is wanted.
check('a row predating the column backfills once', () => {
  assert.strictEqual(
    faceRowChanged({ ...ROW, photo_sha1: null }, { ...ROW, photo_sha1: 'NEWHASH' }),
    true, 'a null stored hash must backfill');
});

check('the other fields still decide on their own', () => {
  const same = { ...ROW, photo_sha1: 'H' };
  assert.strictEqual(faceRowChanged(same, { ...same, label: 'renamed' }), true);
  assert.strictEqual(faceRowChanged(same, { ...same }), false);
});

console.log('sourcePhotoSha1()');

check('hashes the bytes, and answers null rather than throwing', () => {
  const h = sourcePhotoSha1(FAKE_SRC_REL);
  assert.match(h || '', /^[0-9a-f]{40}$/, 'expected a sha1 hex digest');
  assert.strictEqual(h, sourcePhotoSha1(FAKE_SRC_REL), 'must be stable across calls');
  assert.strictEqual(sourcePhotoSha1('_test/not-here.jpg'), null, 'missing file → null');
  assert.strictEqual(sourcePhotoSha1(null), null, 'no photo → null');
  assert.strictEqual(sourcePhotoSha1('../src/.env'), null, 'must not escape PHOTO_DIR');
});

check('a corrected photo produces a different hash', () => {
  const before = sourcePhotoSha1(FAKE_SRC_REL);
  fs.writeFileSync(FAKE_SRC_ABS, Buffer.from('a different corrected photo'));
  assert.notStrictEqual(sourcePhotoSha1(FAKE_SRC_REL), before,
    'this is the whole point — mtime moves on every import, content does not');
});

process.on('exit', () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(path.dirname(FAKE_SRC_ABS), { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nblacklist bridge photo: all checks passed');
  process.exitCode = failures ? 1 : 0;
});
