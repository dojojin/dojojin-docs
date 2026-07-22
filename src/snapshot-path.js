// ============================================================
// Vigil Platform — Snapshot Path Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Builds the structured snapshot path and ensures the directory exists.
// Layout: {snapshotDir}/{category}/{YYYY-MM-DD}/{cam}/{slot}/
//   category = 'events' | 'face' | 'lpr'
//   slot     = 4-hour UTC window: 0000, 0400, 0800, 1200, 1600, 2000
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

function snapPath(snapshotDir, category, camId, tsMs) {
  const d       = new Date(tsMs);
  const date    = d.toISOString().slice(0, 10);
  const slot    = String(Math.floor(d.getUTCHours() / 4) * 4).padStart(2, '0') + '00';
  const safeCam = String(camId).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir     = path.join(snapshotDir, category, date, safeCam, slot);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, relBase: `${category}/${date}/${safeCam}/${slot}` };
}

module.exports = { snapPath };
