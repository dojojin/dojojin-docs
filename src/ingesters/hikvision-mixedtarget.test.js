// ============================================================
// Vigil Platform — check: mixedTargetDetection → faceCapture reshape
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The reshape is the whole risk of the mixedTargetDetection path: every field
// it gets wrong lands in the database as a silent null rather than an error,
// and the Face page shows a blank where an age or a gender should be. So the
// fixture is a verbatim capture off C43-SKU-SB-17's alertStream on 2026-08-02
// rather than a hand-written approximation of one.
//
//   node src/ingesters/hikvision-mixedtarget.test.js
// ============================================================
'use strict';

const assert = require('assert');
const { _mixedFaceToCapture, _prop } = require('./hikvision-isapi');

// Verbatim from the wire — CaptureResult[0] of a mixedTargetDetection event.
const CAPTURE = {
  targetID: 58685,
  Face: {
    Rect: { height: 0.086, width: 0.048, x: 0.317, y: 0.587 },
    Property: [
      { description: 'age', value: '28' },
      { description: 'ageGroup', value: 'prime' },
      { description: 'gender', value: 'female' },
      { description: 'glass', value: 'no' },
      { description: 'mask', value: 'no' },
      { description: 'hat', value: 'no' },
      { description: 'faceExpression', value: 'poker-faced' },
      { description: 'score', value: '76' },
    ],
    contentID1: 'faceImage', contentID2: 'faceBackgroundImage',
    pId1: '20260802150547469000a7du7ypadqLI',
    pId2: '2026080215054746700MiGpw5DqdudVZ',
    FacePictureRect: { height: 0.199, width: 0.091, x: 0.295, y: 0.517 },
    snapTime: '2026-08-02T15:04:21+07:00',
  },
  Human: {
    Property: [
      { description: 'jacketColor', value: 'blue' },
      { description: 'trousersColor', value: 'gray' },
      { description: 'trousersType', value: 'skirt' },
      { description: 'direction', value: 'backward' },
      { description: 'score', value: '49' },
    ],
    pId1: '20260802150423613005B8rWtzHoiAEH',
    pId2: '20260802150423612005QF7ltkBCoTdF',
  },
  uid: 'cfe58e5a-ade3-49d8-8486-744ad5f4bcf7',
};

const f = _mixedFaceToCapture(CAPTURE.targetID, CAPTURE.Face);

// The reshape has to produce exactly what ingestFaceEvent reads, which is the
// faceCapture faces[] shape — nested {value}, not the flat Property array.
assert.strictEqual(f.faceId, 58685);
assert.strictEqual(f.age.value, 28, 'age must be a number, not the string "28"');
assert.strictEqual(f.age.ageGroup, 'prime');
assert.strictEqual(f.gender.value, 'female');
assert.strictEqual(f.glass.value, 'no');
assert.strictEqual(f.mask.value, 'no');
assert.strictEqual(f.hat.value, 'no');
assert.strictEqual(f.faceExpression.value, 'poker-faced');
assert.strictEqual(f.faceScore, 76, 'score must be a number — it is divided by 100 downstream');
assert.deepStrictEqual(f.faceRect, CAPTURE.Face.Rect);

// pId1 is the crop and binds the image part; pId2 is the background and is
// carried separately as bgPid. Mixing them up loses the crop, which is the
// image the gallery shows.
assert.strictEqual(f.pId, CAPTURE.Face.pId1);
assert.notStrictEqual(f.pId, CAPTURE.Face.pId2);

// Exactly the keys ingestFaceEvent reaches for, so a rename upstream shows up
// here rather than as a column of nulls.
for (const k of ['faceId', 'age', 'gender', 'glass', 'mask', 'hat',
                 'faceExpression', 'faceScore', 'faceRect', 'pId']) {
  assert.ok(k in f, `missing ${k}`);
}

// "unknown" means the camera looked and could not tell. faceCapture omits the
// key entirely then, so it has to become null — otherwise every Face page
// filter has to special-case the literal string.
const u = _mixedFaceToCapture(1, {
  Property: [
    { description: 'gender', value: 'unknown' },
    { description: 'ageGroup', value: 'unknown' },
    { description: 'glass', value: 'unknown' },
  ],
  pId1: 'p',
});
assert.strictEqual(u.gender.value, null);
assert.strictEqual(u.glass.value, null);
assert.strictEqual(u.age, null, 'no age property at all → null, not {value:NaN}');

// A face with no score must not become NaN — it is divided by 100 and written
// to a numeric column downstream.
const s = _mixedFaceToCapture(2, { Property: [], pId1: 'p' });
assert.strictEqual(s.faceScore, null);
assert.strictEqual(s.faceRect, null);

// Property → map, including the body block the event carries alongside.
const body = _prop(CAPTURE.Human.Property);
assert.strictEqual(body.jacketColor, 'blue');
assert.strictEqual(body.trousersType, 'skirt');
assert.strictEqual(body.direction, 'backward');
assert.strictEqual(Object.keys(body).length, 5);
assert.deepStrictEqual(_prop(undefined), {}, 'missing Property must not throw');

// Entries without a description would collide on the key "undefined".
assert.deepStrictEqual(_prop([{ value: 'x' }, { description: 'a', value: '1' }]), { a: '1' });

console.log('hikvision mixedTargetDetection reshape: all assertions passed');
// Requiring the ingester constructs its pg pool and alert engine, and their
// handles keep the loop alive even though main() is guarded. Exit explicitly
// rather than leave a check that has already passed hanging until it is killed.
process.exit(0);
