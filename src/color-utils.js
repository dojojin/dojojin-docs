// ============================================================
// Vigil Platform — Color Utilities
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================
// xyzToColorName: maps IVA Pro XYZ payload (= sRGB) to an English color name.
// Used by extractAppearance() for live ingestion and by the backfill script.

// Canonical palette aligned to Bosch IVA Pro Appearance 12-color set.
// Confirmed XYZ values (from live DB): Black=0,0,0 · White=255,255,255 ·
// Gray=166,166,166 · Blue=0,0,255 · Green=0,176,80 · Beige=232,220,202 ·
// Magenta=255,0,255. Remaining 5 (Red/Orange/Yellow/Purple/Brown) use standard
// sRGB primary/secondary values — estimates until camera emits them.
const _PALETTE = [
  ['Red',     255, 0,   0  ],
  ['Orange',  255, 128, 0  ],
  ['Yellow',  255, 255, 0  ],
  ['Green',   0,   176, 80 ],
  ['Blue',    0,   0,   255],
  ['Purple',  128, 0,   255],
  ['Magenta', 255, 0,   255],
  ['Brown',   139, 69,  19 ],
  ['Beige',   232, 220, 202],
  ['Blonde',  184, 139, 80 ],  // confirmed: Bosch hair palette "Golden/Blonde"
  ['Auburn',  180, 50,  20 ],  // estimated: Bosch hair palette "Red/Auburn" (unseen)
];

function xyzToColorName(xyz) {
  if (!xyz) return null;
  const parts = xyz.split(',');
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(Number);
  if ([r, g, b].some(isNaN)) return null;

  // Achromatic path: low saturation → classify by luminance only
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min <= 20) {
    const lum = (r + g + b) / 3;
    if (lum < 60)  return 'Black';
    if (lum > 200) return 'White';
    return 'Gray';
  }

  // Chromatic path: nearest Euclidean neighbor in RGB space
  let bestName = _PALETTE[0][0], bestDist = Infinity;
  for (const [name, pr, pg, pb] of _PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; bestName = name; }
  }
  return bestName;
}

module.exports = { xyzToColorName };
