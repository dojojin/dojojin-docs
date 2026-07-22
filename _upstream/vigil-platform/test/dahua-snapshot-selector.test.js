// ============================================================
// Vigil Platform — Tests: Dahua snapshot frame selector
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// sharp lives in src/node_modules — explicit path so tests resolve correctly
const sharp  = require('../src/node_modules/sharp');

const {
  eventBoundingBox, eventBoxEdgeRisk, frameRoi,
  scoreFrameForObject, scoreFrameMotion,
  chooseBestSnapshotCandidate, selectScanSegments,
  SNAPSHOT_CONFIDENCE_THRESHOLD, SNAPSHOT_NEAR_BEST_MIN_DELTA,
  SCAN_WINDOW_SEC, SCAN_MAX_SEGS,
} = require('../src/ingesters/dahua-snapshot-selector');

// --- helpers ---
async function makeJpeg(opts = {}) {
  const { width = 200, height = 200, r = 128, g = 128, b = 128 } = opts;
  return sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function makeNoisyJpeg(width = 200, height = 200) {
  // Raw noise buffer → JPEG
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 13 + 37) % 256; // deterministic "noise"
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

const BBOX_CENTER = [3000, 3000, 5000, 5000]; // 8192-scale, centre of frame
const BBOX_EDGE   = [0, 0, 500, 500];         // 8192-scale, top-left corner

// ----------------------------------------------------------------
describe('eventBoundingBox', () => {
  it('returns null when data is null/undefined', () => {
    assert.equal(eventBoundingBox(null), null);
    assert.equal(eventBoundingBox({}),   null);
  });

  it('reads from Object.BoundingBox', () => {
    const b = eventBoundingBox({ Object: { BoundingBox: [100, 200, 300, 400] } });
    assert.deepEqual(b, [100, 200, 300, 400]);
  });

  it('falls back to Objects[0].BoundingBox', () => {
    const b = eventBoundingBox({ Objects: [{ BoundingBox: [1, 2, 3, 4] }] });
    assert.deepEqual(b, [1, 2, 3, 4]);
  });

  it('returns null when fewer than 4 elements', () => {
    assert.equal(eventBoundingBox({ Object: { BoundingBox: [1, 2, 3] } }), null);
  });

  it('returns null when any element is non-finite', () => {
    assert.equal(eventBoundingBox({ Object: { BoundingBox: [1, 2, 'x', 4] } }), null);
  });
});

// ----------------------------------------------------------------
describe('eventBoxEdgeRisk', () => {
  it('returns triggered=false + reason when no bbox', () => {
    const r = eventBoxEdgeRisk({});
    assert.equal(r.triggered, false);
    assert.equal(r.reason, 'no_bbox');
  });

  it('does NOT trigger for a centre bbox', () => {
    const r = eventBoxEdgeRisk({ Object: { BoundingBox: BBOX_CENTER } });
    assert.equal(r.triggered, false);
    assert.deepEqual(r.edges, []);
  });

  it('triggers for a top-left corner bbox', () => {
    const r = eventBoxEdgeRisk({ Object: { BoundingBox: BBOX_EDGE } });
    assert.equal(r.triggered, true);
    assert.ok(r.edges.includes('left'), 'expected left edge');
    assert.ok(r.edges.includes('top'),  'expected top edge');
  });
});

// ----------------------------------------------------------------
describe('frameRoi', () => {
  const meta = { width: 1920, height: 1080 };

  it('returns full frame when no bbox', () => {
    const roi = frameRoi(meta, {});
    assert.deepEqual(roi, { left: 0, top: 0, width: 1920, height: 1080 });
  });

  it('returns null when meta has no dimensions', () => {
    assert.equal(frameRoi({}, { Object: { BoundingBox: BBOX_CENTER } }), null);
  });

  it('returns a sub-rect for a centre bbox', () => {
    const roi = frameRoi(meta, { Object: { BoundingBox: BBOX_CENTER } });
    assert.ok(roi, 'expected a roi');
    assert.ok(roi.left > 0,  'should not start at x=0');
    assert.ok(roi.top  > 0,  'should not start at y=0');
    assert.ok(roi.width  < 1920, 'should be narrower than full frame');
    assert.ok(roi.height < 1080, 'should be shorter than full frame');
  });

  it('clamps ROI to frame bounds', () => {
    const roi = frameRoi(meta, { Object: { BoundingBox: BBOX_EDGE } });
    assert.ok(roi);
    assert.ok(roi.left   >= 0);
    assert.ok(roi.top    >= 0);
    assert.ok(roi.left + roi.width  <= 1920);
    assert.ok(roi.top  + roi.height <= 1080);
  });
});

// ----------------------------------------------------------------
describe('scoreFrameForObject', () => {
  it('returns -1 for empty buffer', async () => {
    assert.equal(await scoreFrameForObject(Buffer.alloc(0), {}), -1);
    assert.equal(await scoreFrameForObject(null, {}), -1);
  });

  it('returns buf.length for data with no bbox', async () => {
    const flat = await makeJpeg();
    const score = await scoreFrameForObject(flat, {});
    assert.equal(score, flat.length);
  });

  it('noisy ROI scores higher than flat grey ROI (same bbox)', async () => {
    const data  = { Object: { BoundingBox: BBOX_CENTER } };
    const flat  = await makeJpeg({ r: 100, g: 100, b: 100 });
    const noisy = await makeNoisyJpeg();
    const sFlat  = await scoreFrameForObject(flat,  data);
    const sNoisy = await scoreFrameForObject(noisy, data);
    assert.ok(sNoisy > sFlat, `noisy(${sNoisy.toFixed(2)}) should beat flat(${sFlat.toFixed(2)})`);
  });
});

// ----------------------------------------------------------------
describe('scoreFrameMotion', () => {
  it('returns 0 for null/empty buffers', async () => {
    const flat = await makeJpeg();
    assert.equal(await scoreFrameMotion(null, flat, {}), 0);
    assert.equal(await scoreFrameMotion(flat, null, {}), 0);
  });

  it('motion between two different frames > motion between identical frames', async () => {
    const data  = { Object: { BoundingBox: BBOX_CENTER } };
    const frameA = await makeJpeg({ r: 50,  g: 50,  b: 50  });
    const frameB = await makeJpeg({ r: 200, g: 200, b: 200 });
    const motionSame = await scoreFrameMotion(frameA, frameA, data);
    const motionDiff = await scoreFrameMotion(frameA, frameB, data);
    assert.ok(motionDiff > motionSame,
      `diff(${motionDiff.toFixed(2)}) should exceed same(${motionSame.toFixed(2)})`);
  });
});

// ----------------------------------------------------------------
describe('chooseBestSnapshotCandidate', () => {
  it('returns null for empty list', () => {
    assert.equal(chooseBestSnapshotCandidate([]), null);
  });

  it('picks the highest-scoring candidate', () => {
    const cands = [
      { score: 10, actualOffset: -2000 },
      { score: 50, actualOffset: -1000 },
      { score: 30, actualOffset:     0 },
    ];
    const pick = chooseBestSnapshotCandidate(cands);
    assert.equal(pick.score, 50);
  });

  it('within near-best band, prefers closer-to-anchor offset', () => {
    // Two candidates both within near-best delta of the winner
    const cands = [
      { score: 100, actualOffset: -8000 }, // winner in score
      { score: 100 - SNAPSHOT_NEAR_BEST_MIN_DELTA + 1, actualOffset: -100 }, // near-best, much closer
    ];
    const pick = chooseBestSnapshotCandidate(cands);
    assert.equal(pick.actualOffset, -100, 'should prefer offset closer to 0');
  });

  it('outside near-best band, picks highest score regardless of offset', () => {
    const cands = [
      { score: 100, actualOffset: -8000 },
      { score:   5, actualOffset:     0 }, // far below near-best threshold
    ];
    const pick = chooseBestSnapshotCandidate(cands);
    assert.equal(pick.score, 100);
  });
});

// ----------------------------------------------------------------
describe('selectScanSegments', () => {
  const SEGS = [1000, 1005, 1010, 1015, 1020, 1025, 1030, 1035, 1040];

  it('returns empty when no segments within window', () => {
    const result = selectScanSegments(SEGS, 2000, SCAN_WINDOW_SEC, SCAN_MAX_SEGS);
    assert.deepEqual(result, []);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(selectScanSegments([], 1020, SCAN_WINDOW_SEC, SCAN_MAX_SEGS), []);
  });

  it('returns segments within window, sorted by proximity', () => {
    const result = selectScanSegments(SEGS, 1020, 10, SCAN_MAX_SEGS);
    assert.ok(result.length > 0);
    assert.equal(result[0], 1020, 'closest segment first');
    for (let i = 1; i < result.length; i++) {
      assert.ok(
        Math.abs(result[i] - 1020) >= Math.abs(result[i - 1] - 1020),
        'sorted by proximity to eventSec'
      );
    }
  });

  it('caps at maxN', () => {
    const result = selectScanSegments(SEGS, 1020, 100, 3);
    assert.equal(result.length, 3);
  });

  it('excludes segments outside window', () => {
    const result = selectScanSegments(SEGS, 1020, 5, SCAN_MAX_SEGS);
    for (const s of result) {
      assert.ok(Math.abs(s - 1020) <= 5, `${s} outside window`);
    }
  });

  it('includes the exact eventSec when present', () => {
    const result = selectScanSegments([1010, 1020, 1030], 1020, 5, SCAN_MAX_SEGS);
    assert.ok(result.includes(1020));
  });
});
