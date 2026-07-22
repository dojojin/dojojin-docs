// ============================================================
// Vigil Platform — Helper: normalizeTimeOfDay
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// "HH:MM" or "HH:MM:SS" → "HH:MM" (Postgres TIME accepts it); ''/null → null.
// Throws on malformed input so callers can return 400.
module.exports = function normalizeTimeOfDay(v) {
  if (v == null || v === '') return null;
  const m = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(String(v).trim());
  if (!m) throw new Error('time must be HH:MM');
  const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) throw new Error('time out of range (00:00–23:59)');
  return `${m[1]}:${m[2]}`;
};
