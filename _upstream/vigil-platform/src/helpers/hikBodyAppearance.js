// ============================================================
// Vigil Platform — Helper: Hikvision body attributes → appearances row
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Hikvision reports body attributes as a flat Property[] of {description,
// value}; `appearances` stores them as typed columns using Bosch's vocabulary,
// because Appearance Search queries one set of names across every vendor.
// Translating between the two lived inside ingestBodyAppearance(), which is
// reachable only through the push path and only with a live database — so the
// mapping could not be exercised on its own, and the same translation now has
// to happen on the pull path too (mixedTargetDetection carries the body inline
// with the face). Lifted here verbatim rather than reimplemented: two copies of
// a vocabulary mapping drift, and the drift shows up as search results that
// quietly disagree depending on which camera found the person.
//
// Pure function, no I/O. Callers own the insert and the images.
// ============================================================
'use strict';

const _cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Hikvision's bottom-garment values are not Bosch's. Left as an explicit table
// rather than a capitalise-and-hope, because "longTrousers" capitalised is
// "LongTrousers", which matches nothing any search offers.
const BOTTOM_MAP = { longTrousers: 'Trousers', shortTrousers: 'Shorts', skirt: 'Skirt', dress: 'Dress' };

/**
 * @param {object} pm  flattened Property map, e.g. {jacketColor:'blue', ...}
 * @returns {object}   the appearances columns this vendor can fill
 */
function bodyToAppearance(pm = {}) {
  // "unknown" is the camera saying it looked and could not tell — storing the
  // word would make it searchable as if it were a colour.
  const upper_color = (pm.jacketColor && pm.jacketColor.toLowerCase() !== 'unknown')
    ? _cap(pm.jacketColor) : null;
  const lower_color = (pm.trousersColor && pm.trousersColor.toLowerCase() !== 'unknown')
    ? _cap(pm.trousersColor) : null;

  const attributes = {};
  if (pm.direction) attributes.direction = pm.direction;
  if (pm.hairStyle) attributes.hairStyle = pm.hairStyle;
  if (pm.things === 'yes') attributes.carrying = true;
  if (pm.mask && pm.mask !== 'unknown') attributes.mask = pm.mask;

  return {
    object_class:    'Person',
    // score is 0-100 on the wire and a 0-1 confidence in the column.
    confidence:      pm.score != null ? Number(pm.score) / 100 : null,
    gender:          pm.gender === 'male' ? 'Male' : pm.gender === 'female' ? 'Female' : null,
    // hat is deliberately NOT mapped to helmet: Bosch's helmet means safety
    // helmet, so mapping it would make hard-hat searches return people in caps.
    glasses:         pm.glass === 'yes' || pm.glass === 'sunglasses',
    upper_color,
    lower_color,
    top_category:    pm.jacketType   ? _cap(pm.jacketType) : null,
    bottom_category: pm.trousersType ? (BOTTOM_MAP[pm.trousersType] || _cap(pm.trousersType)) : null,
    bag_category:    pm.bag === 'yes' ? 'Backpack' : null,
    attributes:      Object.keys(attributes).length ? attributes : null,
  };
}

// Attributes worth surfacing on the event row itself, plus anything Hikvision
// adds later (ridingBike, ridingWithPassenger, …) so a new field is stored
// without a code change instead of being silently discarded.
const RAW_HANDLED = new Set(['jacketColor', 'trousersColor', 'jacketType', 'trousersType',
  'direction', 'bag', 'hairStyle', 'things', 'score', 'gender', 'glass', 'mask', 'age',
  'ageGroup', 'faceExpression', 'hat']);

function bodyToRawPatch(pm = {}) {
  const patch = {};
  for (const k of ['jacketColor', 'trousersColor', 'jacketType', 'trousersType',
                   'direction', 'bag', 'hairStyle']) {
    if (pm[k]) patch[k] = pm[k];
  }
  if (pm.things != null) patch.things = pm.things;
  for (const [k, v] of Object.entries(pm)) {
    if (!RAW_HANDLED.has(k) && v != null) patch[k] = v;
  }
  return patch;
}

module.exports = { bodyToAppearance, bodyToRawPatch, BOTTOM_MAP };

if (require.main === module) {
  const assert = require('assert');

  // Verbatim from C43-SKU-SB-17's wire, 2026-08-02.
  const pm = {
    jacketColor: 'blue', glass: 'no', gender: 'female', bag: 'no', hat: 'no',
    jacketType: 'shortSleeve', mask: 'no', hairStyle: 'longHair', ageGroup: 'prime',
    things: 'yes', trousersColor: 'gray', trousersType: 'skirt',
    direction: 'backward', score: '49',
  };
  const a = bodyToAppearance(pm);
  assert.strictEqual(a.upper_color, 'Blue');
  assert.strictEqual(a.lower_color, 'Gray');
  assert.strictEqual(a.top_category, 'ShortSleeve');
  assert.strictEqual(a.bottom_category, 'Skirt');
  assert.strictEqual(a.gender, 'Female');
  assert.strictEqual(a.glasses, false);
  assert.strictEqual(a.bag_category, null, "bag 'no' must not become a Backpack");
  assert.strictEqual(a.confidence, 0.49, 'score is 0-100 on the wire, 0-1 in the column');
  // mask 'no' is kept: "looked and confirmed no mask" is information, unlike
  // 'unknown'. Matches the behaviour this was lifted from — the point of the
  // extraction is that it changes nothing.
  assert.deepStrictEqual(a.attributes,
    { direction: 'backward', hairStyle: 'longHair', carrying: true, mask: 'no' });

  // The mapping table is the reason this file exists — capitalising these
  // instead would produce values no search offers.
  assert.strictEqual(bodyToAppearance({ trousersType: 'longTrousers' }).bottom_category, 'Trousers');
  assert.strictEqual(bodyToAppearance({ trousersType: 'shortTrousers' }).bottom_category, 'Shorts');
  assert.strictEqual(bodyToAppearance({ trousersType: 'dress' }).bottom_category, 'Dress');
  // An unmapped value still stores something rather than dropping the person.
  assert.strictEqual(bodyToAppearance({ trousersType: 'kilt' }).bottom_category, 'Kilt');

  // "unknown" must not become a searchable colour.
  const u = bodyToAppearance({ jacketColor: 'unknown', trousersColor: 'UNKNOWN', glass: 'unknown', mask: 'unknown' });
  assert.strictEqual(u.upper_color, null);
  assert.strictEqual(u.lower_color, null, 'case-insensitive — the camera has sent both');
  assert.strictEqual(u.glasses, false);
  assert.strictEqual(u.attributes, null, "mask 'unknown' must not be recorded as a mask reading");

  // sunglasses counts as wearing glasses; a bag counts as a Backpack.
  assert.strictEqual(bodyToAppearance({ glass: 'sunglasses' }).glasses, true);
  assert.strictEqual(bodyToAppearance({ bag: 'yes' }).bag_category, 'Backpack');

  // Empty input must produce a usable row, not throw or emit NaN.
  const e = bodyToAppearance();
  assert.strictEqual(e.object_class, 'Person');
  assert.strictEqual(e.confidence, null);
  assert.strictEqual(e.gender, null);
  assert.strictEqual(e.attributes, null);

  // raw patch: known fields kept, plus anything new the camera starts sending.
  const p = bodyToRawPatch({ ...pm, ridingBike: 'yes' });
  assert.strictEqual(p.jacketColor, 'blue');
  assert.strictEqual(p.things, 'yes');
  assert.strictEqual(p.ridingBike, 'yes', 'unrecognised attributes must survive');
  assert.ok(!('score' in p), 'score belongs in confidence, not on the event row');
  assert.ok(!('gender' in p), 'gender belongs in the appearances column');

  console.log('hikBodyAppearance self-check: all assertions passed');
}
