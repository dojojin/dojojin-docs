// ============================================================
// Vigil Platform — Dahua Snapshot Frame Selector
// CCTV Analytics & Management Suite — Multi-vendor (Phase MV.5)
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ============================================================
'use strict';

// Pure scoring/selection helpers — no DB, no file I/O, no ffmpeg.
// Importable by tests without triggering runtime deps.

const sharp = require('sharp');

const SNAPSHOT_DEBUG_MAX_CANDIDATES = 12;
const SNAPSHOT_CONFIDENCE_THRESHOLD = 45;
const SNAPSHOT_NEAR_BEST_MIN_DELTA  = 8;
const SNAPSHOT_NEAR_BEST_RATIO      = 0.08;
const SNAPSHOT_EDGE_RISK_MARGIN     = 0.02;
const SCAN_WINDOW_SEC               = 30;
const SCAN_MAX_SEGS                 = 5;

function eventBoundingBox(data) {
  const box = data?.Object?.BoundingBox || data?.Objects?.[0]?.BoundingBox;
  if (!Array.isArray(box) || box.length < 4) return null;
  const nums = box.map(Number);
  return nums.every(Number.isFinite) ? nums : null;
}

function eventBoxEdgeRisk(data) {
  const box = eventBoundingBox(data);
  if (!box) return { triggered: false, reason: 'no_bbox' };
  const scale = Math.max(...box) > 1 ? 8192 : 1;
  const margin = scale * SNAPSHOT_EDGE_RISK_MARGIN;
  const left   = Math.min(box[0], box[2]);
  const top    = Math.min(box[1], box[3]);
  const right  = Math.max(box[0], box[2]);
  const bottom = Math.max(box[1], box[3]);
  const edges  = [];
  if (left   <= margin)          edges.push('left');
  if (top    <= margin)          edges.push('top');
  if (right  >= scale - margin)  edges.push('right');
  if (bottom >= scale - margin)  edges.push('bottom');
  return {
    triggered: edges.length > 0,
    margin_ratio: SNAPSHOT_EDGE_RISK_MARGIN,
    edges,
    bbox: box,
  };
}

function frameRoi(meta, data, padRatio = 0.04) {
  const w = meta?.width  || 0;
  const h = meta?.height || 0;
  if (!w || !h) return null;
  const box = eventBoundingBox(data);
  if (!box) return { left: 0, top: 0, width: w, height: h };
  const scale = Math.max(...box) > 1 ? 8192 : 1;
  const padX  = Math.round(w * padRatio);
  const padY  = Math.round(h * padRatio);
  const left   = Math.max(0, Math.floor((Math.min(box[0], box[2]) / scale) * w) - padX);
  const top    = Math.max(0, Math.floor((Math.min(box[1], box[3]) / scale) * h) - padY);
  const right  = Math.min(w, Math.ceil((Math.max(box[0], box[2]) / scale) * w) + padX);
  const bottom = Math.min(h, Math.ceil((Math.max(box[1], box[3]) / scale) * h) + padY);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

async function roiPixels(buf, data) {
  const img  = sharp(buf);
  const meta = await img.metadata();
  const roi  = frameRoi(meta, data, 0.06);
  if (!roi) return null;
  return img
    .extract(roi)
    .resize({ width: 96, height: 96, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
}

async function scoreFrameForObject(buf, data) {
  if (!buf || buf.length <= 0) return -1;
  const box = eventBoundingBox(data);
  if (!box) return buf.length;
  try {
    const img   = sharp(buf);
    const meta  = await img.metadata();
    const roi   = frameRoi(meta, data);
    if (!roi) return buf.length;
    const stats    = await img.extract(roi).resize({ width: 96, height: 96, fit: 'inside' }).stats();
    const channels = stats.channels || [];
    const detail   = channels.reduce((sum, ch) => sum + (Number(ch.stdev) || 0), 0);
    return detail + Math.min(buf.length / 200000, 5);
  } catch {
    return buf.length > 0 ? 0 : -1;
  }
}

async function scoreFrameMotion(buf, baselineBuf, data) {
  if (!buf || !baselineBuf || buf.length <= 0 || baselineBuf.length <= 0) return 0;
  try {
    const [current, baseline] = await Promise.all([
      roiPixels(buf, data),
      roiPixels(baselineBuf, data),
    ]);
    if (!current || !baseline || current.length !== baseline.length) return 0;
    let diff = 0;
    for (let i = 0; i < current.length; i++) {
      diff += Math.abs(current[i] - baseline[i]);
    }
    return diff / current.length;
  } catch {
    return 0;
  }
}

function selectScanSegments(segs, eventSec, windowSec, maxN) {
  return segs
    .filter(s => Math.abs(s - eventSec) <= windowSec)
    .sort((a, b) => Math.abs(a - eventSec) - Math.abs(b - eventSec))
    .slice(0, maxN);
}

function chooseBestSnapshotCandidate(candidates) {
  if (!candidates.length) return null;
  const sorted       = [...candidates].sort((a, b) => b.score - a.score);
  const best         = sorted[0];
  const nearBestDelta = Math.max(SNAPSHOT_NEAR_BEST_MIN_DELTA, Math.abs(best.score) * SNAPSHOT_NEAR_BEST_RATIO);
  return sorted
    .filter(c => c.score >= best.score - nearBestDelta)
    .sort((a, b) => {
      const offsetDiff = Math.abs(a.actualOffset) - Math.abs(b.actualOffset);
      if (offsetDiff !== 0) return offsetDiff;
      return b.score - a.score;
    })[0];
}

module.exports = {
  SNAPSHOT_DEBUG_MAX_CANDIDATES,
  SNAPSHOT_CONFIDENCE_THRESHOLD,
  SNAPSHOT_NEAR_BEST_MIN_DELTA,
  SNAPSHOT_NEAR_BEST_RATIO,
  SNAPSHOT_EDGE_RISK_MARGIN,
  SCAN_WINDOW_SEC,
  SCAN_MAX_SEGS,
  eventBoundingBox,
  eventBoxEdgeRisk,
  frameRoi,
  scoreFrameForObject,
  scoreFrameMotion,
  chooseBestSnapshotCandidate,
  selectScanSegments,
};
