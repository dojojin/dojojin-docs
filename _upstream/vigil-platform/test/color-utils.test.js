// ============================================================
// Vigil Platform — Tests: color-utils
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { xyzToColorName } = require('../src/color-utils');

describe('xyzToColorName — achromatic (confirmed from live DB)', () => {
  it('0,0,0 → Black',         () => assert.equal(xyzToColorName('0,0,0'),       'Black'));
  it('255,255,255 → White',   () => assert.equal(xyzToColorName('255,255,255'), 'White'));
  it('166,166,166 → Gray',    () => assert.equal(xyzToColorName('166,166,166'), 'Gray'));
  it('50,50,50 → Black (lum<60)', () => assert.equal(xyzToColorName('50,50,50'), 'Black'));
  it('220,220,220 → White (lum>200)', () => assert.equal(xyzToColorName('220,220,220'), 'White'));
});

describe('xyzToColorName — chromatic (confirmed from live DB)', () => {
  it('0,0,255 → Blue',        () => assert.equal(xyzToColorName('0,0,255'),     'Blue'));
  it('0,176,80 → Green',      () => assert.equal(xyzToColorName('0,176,80'),    'Green'));
  it('255,0,255 → Magenta',   () => assert.equal(xyzToColorName('255,0,255'),   'Magenta'));
  it('255,0,0 → Red',         () => assert.equal(xyzToColorName('255,0,0'),     'Red'));
  it('255,128,0 → Orange',    () => assert.equal(xyzToColorName('255,128,0'),   'Orange'));
  it('255,255,0 → Yellow',    () => assert.equal(xyzToColorName('255,255,0'),   'Yellow'));
});

describe('xyzToColorName — edge cases / invalid input', () => {
  it('null → null',                 () => assert.equal(xyzToColorName(null),       null));
  it('undefined → null',            () => assert.equal(xyzToColorName(undefined),  null));
  it('empty string → null',         () => assert.equal(xyzToColorName(''),         null));
  it('wrong part count → null',     () => assert.equal(xyzToColorName('255,255'),  null));
  it('NaN parts → null',            () => assert.equal(xyzToColorName('a,b,c'),    null));
  it('4 parts → null',              () => assert.equal(xyzToColorName('1,2,3,4'),  null));
});
