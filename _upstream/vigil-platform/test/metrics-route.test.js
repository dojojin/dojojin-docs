// ============================================================
// Vigil Platform — Tests: metrics route helpers
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { bucketFor, diskForecast } = require('../src/routes/metrics');

const H = 3600_000;
const D = 24 * H;

describe('bucketFor', () => {
  it('keeps every range inside a drawable number of points', () => {
    // The whole reason this function exists: a 30-day window at raw 60s
    // resolution is 43,200 points per series, which Chart.js will happily
    // accept and then take seconds to render into 600px.
    for (const span of [1 * H, 6 * H, 12 * H, D, 3 * D, 7 * D, 14 * D, 30 * D, 90 * D, 365 * D]) {
      const b = bucketFor(0, span);
      const pts = span / 1000 / b.sec;
      assert.ok(pts <= 400, `${span / H}h → ${Math.round(pts)} points (bucket ${b.sec}s)`);
      assert.ok(pts >= 24, `${span / H}h → only ${Math.round(pts)} points, too coarse to read`);
    }
  });

  it('never returns a bucket finer than the 60s sample rate', () => {
    // Asking Postgres for 10-second bins over minute samples would draw five
    // empty gaps for every real point.
    assert.ok(bucketFor(0, 60_000).sec >= 60);
    assert.ok(bucketFor(0, 1).sec >= 60);
  });

  it('produces a valid Postgres interval string', () => {
    for (const span of [H, D, 7 * D, 30 * D, 365 * D]) {
      assert.match(bucketFor(0, span).interval, /^\d+ (minute|minutes|hour|hours|day|days)$/);
    }
  });
});

describe('diskForecast', () => {
  const series = (vals, startMs = Date.UTC(2026, 0, 1)) =>
    vals.map((y, i) => ({ t: new Date(startMs + i * D).toISOString(), disk_free_gb: y }));

  it('projects days-to-full from a steady decline', () => {
    // 100GB losing 2GB/day, last reading 80GB → 40 days left.
    const f = diskForecast(series([100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80]));
    assert.equal(f.gb_per_day, 2);
    assert.equal(f.days_to_full, 40);
  });

  it('says nothing when the disk is flat or being freed', () => {
    // A forecast here would be an invented number pointing at infinity.
    assert.equal(diskForecast(series([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50])), null);
    assert.equal(diskForecast(series([50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70])), null);
  });

  it('refuses to guess from too little history', () => {
    assert.equal(diskForecast(series([100, 90, 80])), null);
  });

  it('ignores gaps rather than treating them as zero free space', () => {
    // A null sample means "not measured". Counting it as 0 GB would forecast
    // the disk as already full.
    // Enough real points to clear the minimum-history bar even after the gaps,
    // so this exercises gap handling and not the "too little data" guard.
    const s = series([100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72]);
    s[3].disk_free_gb = null;
    s[7].disk_free_gb = null;
    const f = diskForecast(s);
    assert.equal(f.gb_per_day, 2);            // the gaps must not bend the slope
    assert.equal(f.days_to_full, 36);         // 72GB left at 2GB/day
  });

  it('returns null for an empty series instead of throwing', () => {
    assert.equal(diskForecast([]), null);
  });
});
