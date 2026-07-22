// ============================================================
// Vigil Platform — Helper: plate colour → Thai registration type
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// Thailand plate registration category from the plate's dominant colour (Dahua
// ANPR reports it as Object.MainColor RGBA). Confirmed with the owner:
//   white  → รถส่วนบุคคล (private)          yellow → รถสาธารณะ/รับจ้าง (public/taxi)
//   red    → ป้ายแดง (temporary/new)        black  → ป้ายต่างประเทศ/รถราชการ
//   blue   → ทางการทูต/องค์กรระหว่างประเทศ    green  → รถบริการให้เช่า (rental)
// Classified by primary channel so near-values (e.g. 254,254,252) still resolve;
// an unrecognised colour returns null (caller keeps it unset — never a guess).
function plateType(rgba) {
  if (!Array.isArray(rgba) || rgba.length < 3) return null;
  const r = Number(rgba[0]), g = Number(rgba[1]), b = Number(rgba[2]);
  if (![r, g, b].every(Number.isFinite)) return null;
  const hi = (v) => v >= 170;
  const lo = (v) => v <= 90;
  if (hi(r) && hi(g) && hi(b)) return 'รถส่วนบุคคล';
  if (hi(r) && hi(g) && lo(b)) return 'รถสาธารณะ/รับจ้าง';
  if (hi(r) && lo(g) && lo(b)) return 'ป้ายแดง';
  if (lo(r) && hi(g) && lo(b)) return 'รถบริการให้เช่า';
  if (lo(r) && lo(g) && hi(b)) return 'ทางการทูต/องค์กรระหว่างประเทศ';
  if (lo(r) && lo(g) && lo(b)) return 'ป้ายต่างประเทศ/รถราชการ';
  return null;
}

// Hikvision ANPR reports the plate colour as a NAME (not RGB) in its ISAPI XML
// (<plateColor>white|red|green|yellow|black|blue|colorful|unknown</plateColor>),
// so map the name straight to the same registration categories. 'colorful' =
// auction plate; 'unknown' → the system's ไม่ทราบ. Owner-confirmed.
const _COLOR_NAME_TYPE = {
  white:  'รถส่วนบุคคล',
  red:    'ป้ายแดง',
  green:  'รถบริการให้เช่า',
  yellow: 'รถสาธารณะ/รับจ้าง',
  black:  'ป้ายต่างประเทศ/รถราชการ',
  blue:   'ทางการทูต/องค์กรระหว่างประเทศ',
  colorful: 'ป้ายประมูล',
};
function plateTypeFromColorName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return null;
  if (n === 'unknown') return 'ไม่ทราบ';
  return _COLOR_NAME_TYPE[n] || null;
}

module.exports = { plateType, plateTypeFromColorName };

// ponytail: self-check — the colour→type table must stay stable (money/ops path).
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(plateType([255, 255, 255, 0]), 'รถส่วนบุคคล');
  assert.strictEqual(plateType([254, 254, 252, 0]), 'รถส่วนบุคคล');   // near-white
  assert.strictEqual(plateType([255, 255, 0, 0]), 'รถสาธารณะ/รับจ้าง');
  assert.strictEqual(plateType([255, 0, 0, 0]), 'ป้ายแดง');
  assert.strictEqual(plateType([0, 255, 0, 0]), 'รถบริการให้เช่า');
  assert.strictEqual(plateType([0, 0, 255, 0]), 'ทางการทูต/องค์กรระหว่างประเทศ');
  assert.strictEqual(plateType([0, 0, 0, 0]), 'ป้ายต่างประเทศ/รถราชการ');
  assert.strictEqual(plateType(null), null);
  assert.strictEqual(plateType([120, 120, 120]), null);   // grey → unknown
  assert.strictEqual(plateTypeFromColorName('white'), 'รถส่วนบุคคล');
  assert.strictEqual(plateTypeFromColorName('RED'), 'ป้ายแดง');
  assert.strictEqual(plateTypeFromColorName('colorful'), 'ป้ายประมูล');
  assert.strictEqual(plateTypeFromColorName('unknown'), 'ไม่ทราบ');
  assert.strictEqual(plateTypeFromColorName('teal'), null);
  console.log('plateType self-check ok');
}
