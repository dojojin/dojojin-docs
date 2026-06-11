// ============================================================
// Vigil Platform — Dahua CGI Event Ingester
// CCTV Analytics & Management Suite — Multi-vendor (Phase MV.5)
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.1.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ------------------------------------------------------------
// Receives VCA / Smart events from Dahua cameras over the CGI event
// stream (`GET /cgi-bin/eventManager.cgi?action=attach`), a long-lived
// multipart/x-mixed-replace HTTP response. Same outbound-connection
// model as the Hikvision ISAPI ingester (decision #114). Events
// normalise into the SHARED `events` table (vendor-tagged) and fire
// `pg_notify('new_event')` — the dashboard is vendor-agnostic.
//
// SCOPE: this ingester handles Dahua VCA "incident" events —
// Line Crossing, Intrusion, Smart Motion, object Left/Taken-away.
// Dahua **Face Detection** events are deliberately NOT ingested:
// Face Detection only flags "a face is present" with a coarse box
// and unreliable demographics — it is not a Face Capture engine.
// Accurate face analytics needs a Face Capture-class camera (e.g.
// Hikvision Face Capture, decision #117).
//
// Event snapshot — RTSP CLIP-BUFFER EXTRACT: Dahua VCA event timestamps
// are not stable enough across models/firmware to pick a single still
// frame. The ingester reaches into media-recorder's rolling RTSP clip
// buffer (`media-buffer/<camera>/<unix_ts>.ts`, 1-second segments of
// the 12 fps main stream) and scores a burst of candidate frames around
// server receive time. Requires snapshot capture ON so media-recorder
// keeps the Dahua buffer warm; falls back to a (late) live snapshot.cgi
// grab when the buffer isn't available.
//
// Transport: Dahua delivers VCA events on eventManager attach. ONVIF
// is not used for VCA (no Face/IVS topics). snapManager attachFileProc
// is opened as a snapshot-only companion stream when the model supports
// event JPEGs; eventManager remains the source of truth for DB inserts.
//
// Camera list: cameras-config.json entries with vendor:'dahua'.
// Run standalone:  node src/ingesters/dahua-cgi.js
// ============================================================

const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const sharp  = require('sharp');
const { Pool, Client } = require('pg');
const alertEngine = require('../alert-engine');
const { decryptCamCreds } = require('../crypto-creds');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('../singleton')('dahua-cgi');   // refuse to run a second copy

const CONFIG_FILE   = path.join(__dirname, '..', '..', 'cameras-config.json');
const SNAPSHOT_DIR  = path.join(__dirname, '..', '..', 'snapshots');
// media-recorder's rolling RTSP clip buffer — `media-buffer/<camera>/<unix_ts>.ts`.
const MEDIA_BUFFER_DIR = path.join(__dirname, '..', '..', 'media-buffer');
const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
const RECONNECT_BASE_MS  = 5_000;   // base reconnect delay
const RECONNECT_MAX_MS   = 30_000;  // backoff ceiling
const UNREACHABLE_CODES  = new Set(['EHOSTUNREACH', 'ENETUNREACH']);
const DEDUP_WINDOW_MS   = 3000;   // collapse repeated posts of one detection
const EVENT_LOOKBACK_MS = 1200;   // fallback: event arrives ~this long after the detection frame
const RTSP_FRAME_LOOKBACK_MS = 700; // pick the buffer frame just before Dahua reports the event
const MAX_FUTURE_EVENT_MS = 6000; // Dahua may deliver CGI text before the timestamped frame reaches RTSP
const SNAP_EVENT_WAIT_MS = 1200;  // wait briefly for snapManager's event JPEG before RTSP fallback
const FRAME_WAIT_MS     = 3000;   // max wait after a target timestamp for its .ts segment to flush
const FRAME_WAIT_POLL_MS = 300;   // re-check interval while waiting for the segment
const SERVER_ANCHOR_FRAME_OFFSETS_MS = [-4000, -2000, -1000, 0, 1000, 2000, 3000, 5000, 7000, 10000, 12000];
const SERVER_ANCHOR_MAX_FUTURE_MS = 12000;
const SNAPSHOT_DEBUG_MAX_CANDIDATES = 12;
const SNAPSHOT_CONFIDENCE_THRESHOLD = 45;
const SNAPSHOT_NEAR_BEST_MIN_DELTA = 8;
const SNAPSHOT_NEAR_BEST_RATIO = 0.08;
const SNAPSHOT_EDGE_RISK_MARGIN = 0.02;
const CLIP_RESOLVER_OFFSETS_SEC = [4, 6, 8, 9, 10, 11, 12, 14, 16];
const CLIP_RESOLVER_STATUS_RETRY_MS = 1500;
const CLIP_RESOLVER_STATUS_MAX_RETRIES = 30;
const DAHUA_EVENT_CODES = [
  'CrossLineDetection', 'CrossRegionDetection', 'LeftDetection', 'TakenAwayDetection',
  'SmartMotionHuman', 'SmartMotionVehicle',
];

// ============================================================
// Dahua event Code → normalized event shape. event_type reuses
// Bosch's vocabulary 1:1 where the concept maps so existing category
// rules + CLASS_HIERARCHY apply. VideoMotion is intentionally
// unmapped (raw motion is too noisy). Face* codes intentionally
// absent — see the SCOPE note in the file header.
// ============================================================
const DAHUA_EVENT_MAP = {
  CrossLineDetection:   { event_type: 'LineDetector/Crossed',        rule_name: 'Line Crossing' },
  CrossRegionDetection: { event_type: 'FieldDetector/ObjectsInside', rule_name: 'Intrusion Detection' },
  SmartMotionHuman:     { event_type: 'SmartMotion/Human',           rule_name: 'Smart Motion (Human)' },
  SmartMotionVehicle:   { event_type: 'SmartMotion/Vehicle',         rule_name: 'Smart Motion (Vehicle)' },
  LeftDetection:        { event_type: 'UnattendedBaggage',           rule_name: 'Object Left' },
  TakenAwayDetection:   { event_type: 'ObjectRemoval',               rule_name: 'Object Removed' },
};
const DAHUA_CLASS = { Human: 'Person', Vehicle: 'Vehicle', NonMotor: 'Vehicle' };

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 3,
  application_name: 'dahua',
});
pool.on('connect', (c) => { c.query("SET TIME ZONE 'UTC'").catch(() => {}); });

// ============================================================
// HTTP Digest auth — Dahua CGI rejects Basic. RFC 2617 (qop=auth, MD5).
// ============================================================
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function parseChallenge(header) {
  const out = {};
  for (const m of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

function buildDigestHeader(user, pass, method, uri, challenge, nc = '00000001') {
  const cnonce = crypto.randomBytes(8).toString('hex');
  const qop = challenge.qop ? challenge.qop.split(',')[0].trim() : null;
  const ha1 = md5(`${user}:${challenge.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${challenge.realm}", `
        + `nonce="${challenge.nonce}", uri="${uri}", response="${response}"`;
  if (challenge.opaque) h += `, opaque="${challenge.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

// ============================================================
// Snapshot grab — returns the JPEG as a Buffer. The rolling buffer
// polls ~1×/s, so the digest challenge is cached per camera (just
// bump the nonce-count) to keep each poll a single request; a
// stale-nonce 401 transparently re-handshakes.
// ============================================================
const _digestCache = new Map();   // camera_id → { challenge, nc }

function captureFrame(cam) {
  return new Promise((resolve) => {
    const uri  = cam.snapshot_path || '/cgi-bin/snapshot.cgi?channel=1';
    const port = cam.http_port || 80;
    const get = (authHeader, isRetry) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get(
        { host: cam.ip_address, port, path: uri, headers, timeout: 5000 },
        (res) => {
          if (res.statusCode === 401) {
            const wa = res.headers['www-authenticate'];
            res.resume();
            if (isRetry || !wa || !/digest/i.test(wa)) {
              _digestCache.delete(cam.camera_id);
              return resolve(null);
            }
            const entry = { challenge: parseChallenge(wa), nc: 1 };
            _digestCache.set(cam.camera_id, entry);
            return get(buildDigestHeader(cam.username, cam.password, 'GET', uri,
              entry.challenge, String(entry.nc).padStart(8, '0')), true);
          }
          if (res.statusCode !== 200) { res.resume(); return resolve(null); }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      );
      r.on('error', () => resolve(null));
      r.on('timeout', () => { r.destroy(); resolve(null); });
    };
    const cached = _digestCache.get(cam.camera_id);
    if (cached) {
      cached.nc++;
      get(buildDigestHeader(cam.username, cam.password, 'GET', uri,
        cached.challenge, String(cached.nc).padStart(8, '0')), false);
    } else {
      get(null, false);   // triggers the 401 → cache → retry
    }
  });
}

function saveJpeg(buf, filename) {
  try { fs.writeFileSync(path.join(SNAPSHOT_DIR, filename), buf); return filename; }
  catch { return null; }
}

// ============================================================
// Detection-frame extract from media-recorder's RTSP clip buffer.
// media-recorder segments the 12 fps main stream into 1-second
// `media-buffer/<camera>/<unix_ts>.ts` files. Given a detection time
// we find the segment covering that second and ffmpeg-extracts one
// frame — the subject is in it, with no extra load on the camera.
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One JPEG frame out of a .ts segment at a target offset. Dahua segments
// often span >1 second because ffmpeg can only cut on keyframes with
// `-c copy`; extracting the first frame can be a couple seconds early.
function ffmpegFrame(tsFile, offsetSec = 0) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const seek = Math.max(0, Number(offsetSec) || 0);
    const args = [
      '-v', 'error', '-fflags', '+discardcorrupt',
      '-i', tsFile,
    ];
    if (seek >= 0.05) args.push('-ss', seek.toFixed(3));
    args.push(
      '-frames:v', '1', '-q:v', '3', '-pix_fmt', 'yuvj420p',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    );
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('close', () => finish(chunks.length ? Buffer.concat(chunks) : null));
    ff.on('error', () => finish(null));
    setTimeout(() => { try { ff.kill('SIGKILL'); } catch { /* */ } finish(null); }, 5000);
  });
}

// Pull the detection-time frame from the RTSP clip buffer. Returns the
// JPEG Buffer, or null when the buffer isn't usable (clip capture off,
// media-recorder down, buffer still warming up) — caller falls back.
async function extractFrameCandidateFromBuffer(cameraId, targetMs, waitMs = FRAME_WAIT_MS) {
  const dir = path.join(MEDIA_BUFFER_DIR, cameraId);
  const targetSec = Math.floor(targetMs / 1000);
  const startedMs = Date.now();
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  while (true) {
    let segs;
    try {
      segs = fs.readdirSync(dir)
        .filter((f) => /^\d+\.ts$/.test(f))
        .map((f) => parseInt(f, 10))
        .sort((a, b) => a - b);
    } catch { return null; }            // dir missing — clip capture off
    if (segs.length) {
      // segment covering targetSec = largest start <= targetSec
      let pick = segs[0];
      for (const s of segs) { if (s <= targetSec) pick = s; else break; }
      // safe to read only once ffmpeg has moved on (a newer segment exists)
      if (segs[segs.length - 1] > pick) {
        const offsetSec = Math.max(0, (targetMs / 1000) - pick);
        const frame = await ffmpegFrame(path.join(dir, `${pick}.ts`), offsetSec);
        return (frame && frame.length > 0)
          ? { frame, targetMs, targetSec, segment: pick, offsetSec, waitedMs: Date.now() - startedMs }
          : null;
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(FRAME_WAIT_POLL_MS, Math.max(0, deadline - Date.now())));
  }
  return null;
}

async function extractFrameFromBuffer(cameraId, targetMs, waitMs = FRAME_WAIT_MS) {
  const candidate = await extractFrameCandidateFromBuffer(cameraId, targetMs, waitMs);
  return candidate ? candidate.frame : null;
}

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
  const left = Math.min(box[0], box[2]);
  const top = Math.min(box[1], box[3]);
  const right = Math.max(box[0], box[2]);
  const bottom = Math.max(box[1], box[3]);
  const edges = [];
  if (left <= margin) edges.push('left');
  if (top <= margin) edges.push('top');
  if (right >= scale - margin) edges.push('right');
  if (bottom >= scale - margin) edges.push('bottom');
  return {
    triggered: edges.length > 0,
    margin_ratio: SNAPSHOT_EDGE_RISK_MARGIN,
    edges,
    bbox: box,
  };
}

function frameRoi(meta, data, padRatio = 0.04) {
  const w = meta?.width || 0;
  const h = meta?.height || 0;
  if (!w || !h) return null;
  const box = eventBoundingBox(data);
  if (!box) return { left: 0, top: 0, width: w, height: h };
  const scale = Math.max(...box) > 1 ? 8192 : 1;
  const padX = Math.round(w * padRatio);
  const padY = Math.round(h * padRatio);
  const left = Math.max(0, Math.floor((Math.min(box[0], box[2]) / scale) * w) - padX);
  const top = Math.max(0, Math.floor((Math.min(box[1], box[3]) / scale) * h) - padY);
  const right = Math.min(w, Math.ceil((Math.max(box[0], box[2]) / scale) * w) + padX);
  const bottom = Math.min(h, Math.ceil((Math.max(box[1], box[3]) / scale) * h) + padY);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function serverAnchorFrameCandidateTimes(cam, base) {
  const configured = Array.isArray(cam?.dahua_server_frame_offsets_ms)
    ? cam.dahua_server_frame_offsets_ms.map(Number).filter(Number.isFinite)
    : null;
  const offsets = configured && configured.length ? configured : SERVER_ANCHOR_FRAME_OFFSETS_MS;
  const maxFuture = Math.max(SERVER_ANCHOR_MAX_FUTURE_MS, ...offsets.filter(ms => ms > 0));
  const now = Date.now();
  return [...new Set(offsets.map(ms => Math.max(0, Math.min(now + maxFuture, base + ms))))];
}

async function scoreFrameForObject(buf, data) {
  if (!buf || buf.length <= 0) return -1;
  const box = eventBoundingBox(data);
  if (!box) return buf.length;
  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    const roi = frameRoi(meta, data);
    if (!roi) return buf.length;
    const stats = await img.extract(roi).resize({ width: 96, height: 96, fit: 'inside' }).stats();
    const channels = stats.channels || [];
    const detail = channels.reduce((sum, ch) => sum + (Number(ch.stdev) || 0), 0);
    return detail + Math.min(buf.length / 200000, 5);
  } catch {
    return buf.length > 0 ? 0 : -1;
  }
}

async function roiPixels(buf, data) {
  const img = sharp(buf);
  const meta = await img.metadata();
  const roi = frameRoi(meta, data, 0.06);
  if (!roi) return null;
  return img
    .extract(roi)
    .resize({ width: 96, height: 96, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
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

function chooseBestSnapshotCandidate(candidates) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const nearBestDelta = Math.max(SNAPSHOT_NEAR_BEST_MIN_DELTA, Math.abs(best.score) * SNAPSHOT_NEAR_BEST_RATIO);
  return sorted
    .filter(c => c.score >= best.score - nearBestDelta)
    .sort((a, b) => {
      const offsetDiff = Math.abs(a.actualOffset) - Math.abs(b.actualOffset);
      if (offsetDiff !== 0) return offsetDiff;
      return b.score - a.score;
    })[0];
}

async function extractBestFrameFromClip(clipPath, data, durationSec = 0) {
  const candidates = [];
  const duration = Number(durationSec);
  const maxOffset = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const offsets = CLIP_RESOLVER_OFFSETS_SEC
    .filter(sec => !maxOffset || sec < maxOffset - 0.25);
  if (maxOffset && !offsets.includes(Math.max(0, Math.floor(maxOffset / 2)))) {
    offsets.push(Math.max(0, Math.floor(maxOffset / 2)));
  }
  const uniqueOffsets = [...new Set(offsets)].sort((a, b) => a - b);
  for (const offsetSec of uniqueOffsets) {
    const frame = await ffmpegFrame(clipPath, offsetSec);
    if (frame && frame.length > 0) {
      candidates.push({ frame, offsetSec });
    }
  }
  const baseline = candidates[0] || null;
  for (const candidate of candidates) {
    candidate.rawScore = await scoreFrameForObject(candidate.frame, data);
    candidate.motionScore = baseline && baseline !== candidate
      ? await scoreFrameMotion(candidate.frame, baseline.frame, data)
      : 0;
    candidate.score = (candidate.motionScore * 8) + (candidate.rawScore / 20);
  }
  const debug = {
    strategy: 'clip-resolver',
    scoring: 'motion-diff-v1',
    source_clip: path.basename(clipPath),
    duration_sec: Number.isFinite(duration) ? duration : null,
    confidence_threshold: SNAPSHOT_CONFIDENCE_THRESHOLD,
    baseline: baseline ? { offset_sec: baseline.offsetSec } : null,
    candidates: candidates.slice(0, SNAPSHOT_DEBUG_MAX_CANDIDATES).map(c => ({
      offset_sec: Number(c.offsetSec.toFixed(3)),
      raw_score: Number(c.rawScore.toFixed(2)),
      motion_score: Number(c.motionScore.toFixed(2)),
      score: Number(c.score.toFixed(2)),
    })),
  };
  if (!candidates.length) return { frame: null, debug };
  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates[0];
  debug.confidence = Number(selected.score.toFixed(2));
  debug.low_confidence = selected.score < SNAPSHOT_CONFIDENCE_THRESHOLD;
  debug.selected = {
    offset_sec: Number(selected.offsetSec.toFixed(3)),
    score: Number(selected.score.toFixed(2)),
    motion_score: Number(selected.motionScore.toFixed(2)),
  };
  return { frame: selected.frame, debug };
}

function detectionDebug(data, now = Date.now()) {
  const rawUtcMs = Number(data?.UTC) * 1000;
  const rawUtcMsPart = Number(data?.UTCMS);
  const rawCamMs = rawUtcMs + (Number.isFinite(rawUtcMsPart) ? rawUtcMsPart : 0);
  if (!Number.isFinite(rawCamMs) || rawCamMs <= 0) {
    return { now, rawCamMs: null, correctedMs: null, deltaMs: null, usedMs: now - EVENT_LOOKBACK_MS, fallback: true };
  }
  const tzOff = Math.round((rawCamMs - now) / 3600000) * 3600000;
  const correctedMs = rawCamMs - tzOff;
  const deltaMs = correctedMs - now;
  if (Math.abs(deltaMs) >= 15000) {
    return { now, rawCamMs, tzOff, correctedMs, deltaMs, usedMs: now - EVENT_LOOKBACK_MS, fallback: true };
  }
  const usedMs = deltaMs > MAX_FUTURE_EVENT_MS ? now + MAX_FUTURE_EVENT_MS : correctedMs;
  return { now, rawCamMs, tzOff, correctedMs, deltaMs, usedMs, clamped: usedMs !== correctedMs };
}

async function extractBestFrameFromBuffer(cam, data, receivedMs = Date.now()) {
  const candidates = [];
  const timing = detectionDebug(data, receivedMs);
  const base = receivedMs;
  const times = serverAnchorFrameCandidateTimes(cam, base);
  const preferredOffset = 0;
  for (let i = 0; i < times.length; i++) {
    const targetMs = times[i];
    const waitMs = targetMs > Date.now()
      ? Math.max(FRAME_WAIT_MS, Math.ceil(targetMs - Date.now()) + FRAME_WAIT_MS)
      : 0;
    const candidate = await extractFrameCandidateFromBuffer(cam.camera_id, targetMs, waitMs);
    if (candidate && candidate.frame && candidate.frame.length > 0) {
      const actualOffset = targetMs - base;
      const rawScore = await scoreFrameForObject(candidate.frame, data);
      candidates.push({
        ...candidate,
        rawScore,
        actualOffset,
      });
    }
  }
  const baseline = candidates
    .filter(c => c.actualOffset < 0)
    .sort((a, b) => a.actualOffset - b.actualOffset)[0]
    || candidates[0]
    || null;
  for (const candidate of candidates) {
    candidate.motionScore = baseline && baseline !== candidate
      ? await scoreFrameMotion(candidate.frame, baseline.frame, data)
      : 0;
    candidate.timingPenalty = Math.abs(candidate.actualOffset - preferredOffset) / 1200;
    candidate.score = (candidate.motionScore * 8)
      + (candidate.rawScore / 20)
      - candidate.timingPenalty;
  }
  const debug = {
    strategy: 'rtsp-buffer-burst',
    anchor: 'server_received_ms',
    scoring: 'motion-diff-v1',
    direction: data?.Direction || null,
    preferredOffset,
    confidence_threshold: SNAPSHOT_CONFIDENCE_THRESHOLD,
    server_received_ms: receivedMs,
    timing,
    baseline: baseline ? {
      target_delta_ms: Math.round(baseline.targetMs - base),
      segment: baseline.segment,
      offset_sec: Number(baseline.offsetSec.toFixed(3)),
    } : null,
    tried: times.slice(0, SNAPSHOT_DEBUG_MAX_CANDIDATES).map(t => Math.round(t - base)),
    candidates: candidates.slice(0, SNAPSHOT_DEBUG_MAX_CANDIDATES).map(c => ({
      target_delta_ms: Math.round(c.targetMs - base),
      segment: c.segment,
      offset_sec: Number(c.offsetSec.toFixed(3)),
      waited_ms: c.waitedMs,
      raw_score: Number(c.rawScore.toFixed(2)),
      motion_score: Number(c.motionScore.toFixed(2)),
      timing_penalty: Number(c.timingPenalty.toFixed(2)),
      score: Number(c.score.toFixed(2)),
    })),
  };
  if (!candidates.length) return { frame: null, debug };
  candidates.sort((a, b) => b.score - a.score);
  const selected = chooseBestSnapshotCandidate(candidates);
  debug.highest_score = Number(candidates[0].score.toFixed(2));
  debug.near_best_delta = Number(Math.max(
    SNAPSHOT_NEAR_BEST_MIN_DELTA,
    Math.abs(candidates[0].score) * SNAPSHOT_NEAR_BEST_RATIO
  ).toFixed(2));
  debug.selection_rule = 'near-best-closest-anchor';
  debug.confidence = Number(selected.score.toFixed(2));
  debug.edge_risk = eventBoxEdgeRisk(data);
  debug.low_confidence = selected.score < SNAPSHOT_CONFIDENCE_THRESHOLD || debug.edge_risk.triggered;
  debug.selected = {
    target_delta_ms: Math.round(selected.targetMs - base),
    segment: selected.segment,
    offset_sec: Number(selected.offsetSec.toFixed(3)),
    score: Number(selected.score.toFixed(2)),
    motion_score: Number(selected.motionScore.toFixed(2)),
  };
  return { frame: selected.frame, debug };
}

// ============================================================
// Per-(camera,code) dedup — Dahua re-posts a detection while it persists.
// ============================================================
const _dedup = new Map();
function shouldRecord(cameraId, code) {
  const k = `${cameraId}|${code}`;
  const now = Date.now();
  const last = _dedup.get(k) || 0;
  _dedup.set(k, now);
  return (now - last) > DEDUP_WINDOW_MS;
}

// ============================================================
// snapManager event-JPEG cache. snapManager may deliver the event text
// and the matching JPEG a few hundred ms after eventManager reports the
// detection; keep only a small recent window and consume each image once.
const _snapContexts = new Map();  // camera_id → { code, ts }
const _eventSnaps = new Map();    // camera_id → [{ code, ts, buf, used }]
const _snapConnected = new Set();
const _snapDisabled = new Set();   // unsupported by this model/firmware until config reload

function clearSnapState(cameraId) {
  _snapContexts.delete(cameraId);
  _eventSnaps.delete(cameraId);
  _snapActive.delete(cameraId);
  _snapConnected.delete(cameraId);
}

function rememberEventSnapshot(cameraId, code, buf) {
  if (!buf || buf.length <= 0) return;
  const arr = _eventSnaps.get(cameraId) || [];
  const now = Date.now();
  arr.push({ code: code || null, ts: now, buf, used: false });
  const fresh = arr.filter(x => now - x.ts < 10000).slice(-12);
  _eventSnaps.set(cameraId, fresh);
}

async function waitForEventSnapshot(cameraId, code, sinceMs) {
  if (!_snapConnected.has(cameraId)) return null;
  const deadline = Date.now() + SNAP_EVENT_WAIT_MS;
  while (Date.now() <= deadline) {
    const arr = _eventSnaps.get(cameraId) || [];
    const snap = arr.find(x =>
      !x.used &&
      x.ts >= sinceMs - 1500 &&
      (!x.code || !code || x.code === code)
    );
    if (snap) {
      snap.used = true;
      return snap.buf;
    }
    await sleep(120);
  }
  return null;
}

// multipart/x-mixed-replace parser. Each part:
//   --myboundary\r\n  Content-Type:..  [Content-Length:..]  \r\n  <body>
// Dahua text parts may omit Content-Length → body runs to the next
// boundary. Binary-safe (Buffer).
// ============================================================
const _BOUNDARY = Buffer.from('--myboundary');
const _HDR_END  = Buffer.from('\r\n\r\n');

function processMultipart(cam, buf, mode = 'event') {
  let offset = 0;
  while (true) {
    const bStart = buf.indexOf(_BOUNDARY, offset);
    if (bStart < 0) break;
    const hdrStart = bStart + _BOUNDARY.length;
    const hdrEnd = buf.indexOf(_HDR_END, hdrStart);
    if (hdrEnd < 0) { offset = bStart; break; }
    const headers = buf.slice(hdrStart, hdrEnd).toString('utf8');
    const bodyStart = hdrEnd + _HDR_END.length;
    const clMatch = headers.match(/Content-Length:\s*(\d+)/i);
    let bodyEnd;
    if (clMatch) {
      bodyEnd = bodyStart + parseInt(clMatch[1], 10);
      if (buf.length < bodyEnd) { offset = bStart; break; }
    } else {
      const next = buf.indexOf(_BOUNDARY, bodyStart);
      if (next < 0) { offset = bStart; break; }
      bodyEnd = next;
    }
    handlePart(cam, headers, buf.slice(bodyStart, bodyEnd), mode);
    offset = bodyEnd;
  }
  return offset > 0 ? buf.slice(offset) : buf;
}

function handlePart(cam, headers, body, mode = 'event') {
  const ct = (headers.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1] || '';
  if (/image\/jpeg/i.test(ct)) {
    if (mode === 'snap') {
      const ctx = _snapContexts.get(cam.camera_id) || {};
      rememberEventSnapshot(cam.camera_id, ctx.code, body);
    }
    return;
  }
  const text = body.toString('utf8').trim();
  if (!text || /^Heartbeat$/i.test(text)) return;
  if (mode === 'snap') parseSnapManagerText(cam, text);
  else parseDahuaEvent(cam, text);
}

function parseSnapManagerText(cam, text) {
  const code = parseSnapManagerCode(text);
  if (code) _snapContexts.set(cam.camera_id, { code, ts: Date.now() });
}

function parseSnapManagerCode(text) {
  const direct = text.match(/(?:^|[;\r\n])Code=([^;\r\n]+)/);
  if (direct) {
    const code = direct[1].trim();
    return DAHUA_EVENT_MAP[code] ? code : null;
  }
  for (const m of text.matchAll(/Events\[\d+\]\.Code=([^\r\n]+)/g)) {
    const code = m[1].trim();
    if (DAHUA_EVENT_MAP[code]) return code;
  }
  return null;
}

// ============================================================
// Dahua event line:  Code=X;action=Start;index=N;data={...json...}
// ============================================================
function parseDahuaEvent(cam, text) {
  const codeM = text.match(/Code=([^;]+)/);
  if (!codeM) return;                           // Heartbeat etc.
  const code   = codeM[1].trim();
  const action = ((text.match(/action=([^;]+)/) || [])[1] || '').trim();

  // Touch last_seen on every chunk so the camera stays "online".
  pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
    [cam.camera_id]).catch(() => {});

  const mapping = DAHUA_EVENT_MAP[code];
  if (!mapping) return;                         // unmapped (incl. Face*) — ignored

  if (action && action !== 'Start' && action !== 'Pulse') return;   // drop Stop / repeats
  if (!shouldRecord(cam.camera_id, code)) return;

  let data = {};
  const braceIdx = text.indexOf('{');
  if (braceIdx >= 0) {
    try { data = JSON.parse(text.slice(braceIdx)); } catch { /* keep {} */ }
  }
  ingestEvent(cam, code, mapping, data);
}

function extractObjectClass(data) {
  const t = data?.Object?.ObjectType
         || data?.Objects?.[0]?.ObjectType
         || null;
  return t ? (DAHUA_CLASS[t] || t) : null;
}

// Detection time for snapshot picking. Dahua's data.UTC is the
// camera's LOCAL time sent as a unix timestamp (second-precision) —
// strip the whole-hour timezone offset to bring it onto the host
// clock; if it still looks wrong, fall back to "now minus latency".
function detectionTs(data) {
  return detectionDebug(data).usedMs;
}

function snapshotTargetTs(cam, data) {
  const configured = Number(cam?.dahua_snapshot_lookback_ms);
  const lookback = Number.isFinite(configured) && configured >= 0
    ? configured
    : RTSP_FRAME_LOOKBACK_MS;
  return Math.max(0, detectionTs(data) - lookback);
}

// ============================================================
// Event ingest — INSERT + notify + alert + clip + snapshot.
// ============================================================
async function ingestEvent(cam, code, mapping, data) {
  const objectClass = extractObjectClass(data);
  const rawJson = {
    vendor: 'dahua', eventType: code, dahuaCode: code,
    ruleName: data?.Name || null, direction: data?.Direction || null,
    eventId: data?.EventID ?? null, data,
  };
  // Zone Enter/Leave → event_state true/false ให้ตรง convention ของ Bosch
  // IsInside (Ph.2, 2026-06-10): ปลดล็อก dwell pairing + Leave ถูกซ่อนจาก
  // Events list แบบเดียวกับ Bosch leave events. Direction อื่น (เช่น
  // LeftToRight ของ line crossing) คงเป็น 'true' ตามเดิม.
  const dir = data?.Direction;
  const eventState = dir === 'Enter' ? 'true' : dir === 'Leave' ? 'false' : 'true';
  let eventId;
  try {
    const r = await pool.query(
      `INSERT INTO events
       (camera_id, event_category, event_type, rule_name,
        object_id, object_class, likelihood, event_state, raw_json, event_time)
       VALUES ($1,'RuleEngine',$2,$3,NULL,$4,NULL,$5,$6,NOW())
       RETURNING id`,
      [cam.camera_id, mapping.event_type, mapping.rule_name, objectClass,
       eventState, JSON.stringify(rawJson)]
    );
    eventId = r.rows[0].id;
  } catch (err) {
    console.error(`  ❌ DB insert [${cam.camera_id}]:`, err.message);
    return;
  }
  console.log(`  ✅ [${cam.camera_id}] ${mapping.rule_name}`
    + (objectClass ? ` (${objectClass})` : '') + ` → event ${eventId}`);

  // pg_notify fires AFTER snapshot save (see end of function) so WS event
  // carries snapshot_file already — same pattern as mqtt-subscriber.js.
  // Pre-alarm clip — media-recorder LISTENs event_for_clip + decides
  // per-camera from cameras.enable_clip_capture (same channel + payload
  // shape mqtt-subscriber / hikvision use).
  pool.query(`SELECT pg_notify('event_for_clip', $1)`, [JSON.stringify({
    event_id: eventId, camera_id: cam.camera_id,
    event_time: new Date(), received_at_ms: Date.now(),
  })]).catch(err => console.error(`  🎬 pg_notify clip [${cam.camera_id}]:`, err.message));
  // Alert engine — same rule-match / cooldown / quiet-hours / LINE
  // pipeline as Bosch + Hikvision.
  alertEngine.onEvent({
    event_id: eventId, camera_id: cam.camera_id,
    camera_name: cam.camera_name || cam.camera_id,
    location: cam.location || null,
    rule_name: mapping.rule_name, event_type: mapping.event_type,
    object_class: objectClass, likelihood: null,
    event_time: new Date(), snapshot_filename: null,
  }).catch(err => console.error(`  🔔 alert [${cam.camera_id}]:`, err.message));

  // Event snapshot — extract candidate frames from the RTSP clip
  // buffer around server receive time. Falls back to a (late) live
  // snapshot.cgi grab when the buffer isn't available.
  const snapshotStartMs = Date.now();
  let snapshotDebug = {
    received_ms: snapshotStartMs,
    event_direction: data?.Direction || null,
    event_utc: data?.UTC ?? null,
    event_utcms: data?.UTCMS ?? null,
    event_pts: data?.PTS ?? null,
    with_snap: data?.WithSnap ?? null,
  };
  let frame = await waitForEventSnapshot(cam.camera_id, code, snapshotStartMs);
  let snapSource = 'dahua-event-snapshot';
  let snapshotStatus = 'missing';
  if (frame) snapshotDebug.strategy = 'snapManager-event-jpeg';
  if (!frame) {
    const best = await extractBestFrameFromBuffer(cam, data, snapshotStartMs);
    frame = best.frame;
    snapshotDebug = { ...snapshotDebug, ...(best.debug || {}) };
    if (snapshotDebug.low_confidence) snapshotStatus = 'low_confidence';
    snapSource = 'dahua-rtsp-buffer-best';
  }
  if (!frame) {
    const targetMs = snapshotTargetTs(cam, data);
    frame = await extractFrameFromBuffer(cam.camera_id, targetMs);
    snapshotDebug = { ...snapshotDebug, strategy: 'rtsp-buffer-single-fallback', target_delta_ms: Math.round(targetMs - detectionTs(data)) };
    snapSource = 'dahua-rtsp-buffer';
    if (frame) {
      snapshotStatus = 'low_confidence';
      snapshotDebug.low_confidence = true;
      snapshotDebug.low_confidence_reason = 'single_rtsp_fallback_no_candidate_score';
    }
  }
  if (!frame) {
    frame = await captureFrame(cam);
    snapshotDebug = { ...snapshotDebug, strategy: 'cgi-live-fallback' };
    snapSource = 'dahua-cgi-live';
    if (frame) {
      snapshotStatus = 'low_confidence';
      snapshotDebug.low_confidence = true;
      snapshotDebug.low_confidence_reason = 'cgi_live_fallback_late';
    }
  }
  if (frame && frame.length > 0) {
    if (snapshotStatus !== 'low_confidence') snapshotStatus = 'ok';
    const fn = `${cam.camera_id}_${eventId}_${Date.now()}.jpg`;
    if (saveJpeg(frame, fn)) {
      await pool.query(`UPDATE events
          SET raw_json = raw_json || $1::jsonb,
              snapshot_filename = $2,
              has_snapshot = TRUE
        WHERE id=$3`,
        [JSON.stringify({
          _snapshot: fn,
          _snapshot_source: snapSource,
          _snapshot_status: snapshotStatus,
          _snapshot_debug: snapshotDebug,
        }), fn, eventId]).catch(() => {});
      console.log(`  📸 [${cam.camera_id}] snapshot ${fn} (${snapSource})`);
    } else {
      snapshotStatus = 'failed';
      await pool.query(`UPDATE events SET raw_json = raw_json || $1::jsonb WHERE id=$2`,
        [JSON.stringify({
          _snapshot_status: snapshotStatus,
          _snapshot_debug: { ...snapshotDebug, failed: true, failure_reason: 'save_jpeg_failed' },
        }), eventId]).catch(() => {});
    }
  } else {
    snapshotStatus = 'missing';
    await pool.query(`UPDATE events SET raw_json = raw_json || $1::jsonb WHERE id=$2`,
      [JSON.stringify({
        _snapshot_status: snapshotStatus,
        _snapshot_debug: { ...snapshotDebug, failed: true },
      }), eventId]).catch(() => {});
  }
  // Fire AFTER snapshot UPDATE — WS event arrives with snapshot_file ready.
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)])
    .catch(err => console.error('  pg_notify:', err.message));
}

async function resolveDahuaSnapshotFromClip({ event_id, camera_id, clip_file, clip_duration_sec, _retry = 0 }) {
  const eventId = Number(event_id);
  if (!Number.isFinite(eventId) || !camera_id || !clip_file) return;
  const cam = _activeCams.get(camera_id);
  if (!cam || String(cam.vendor || 'dahua').toLowerCase() !== 'dahua') return;
  let row;
  try {
    const r = await pool.query(
      `SELECT raw_json FROM events WHERE id=$1 AND camera_id=$2`,
      [eventId, camera_id]
    );
    row = r.rows[0];
  } catch (err) {
    console.error(`  🎞️  clip resolver query [${camera_id}/${eventId}]:`, err.message);
    return;
  }
  if (!row?.raw_json || row.raw_json.vendor !== 'dahua') return;
  const currentStatus = row.raw_json._snapshot_status || null;
  const currentSource = row.raw_json._snapshot_source || null;
  if (!currentStatus && _retry < CLIP_RESOLVER_STATUS_MAX_RETRIES) {
    setTimeout(() => {
      resolveDahuaSnapshotFromClip({
        event_id, camera_id, clip_file, clip_duration_sec, _retry: _retry + 1,
      }).catch(err => console.error('  🎞️  clip resolver retry:', err.message));
    }, CLIP_RESOLVER_STATUS_RETRY_MS);
    return;
  }
  const unreliableOkSource = currentStatus === 'ok'
    && (currentSource === 'dahua-rtsp-buffer' || currentSource === 'dahua-cgi-live');
  if (!['low_confidence', 'missing', 'failed'].includes(currentStatus) && !unreliableOkSource) return;

  const clipPath = path.join(MEDIA_DIR, path.basename(clip_file));
  if (!fs.existsSync(clipPath)) return;
  const data = row.raw_json.data || {};
  const firstPassDebug = row.raw_json._snapshot_debug || null;
  const best = await extractBestFrameFromClip(clipPath, data, Number(clip_duration_sec));
  const clipDebug = {
    ...(best.debug || {}),
    first_pass: firstPassDebug,
  };
  if (!best.frame || best.frame.length <= 0) {
    await pool.query(
      `UPDATE events SET raw_json = raw_json || $1::jsonb WHERE id=$2`,
      [JSON.stringify({
        _snapshot_status: 'missing',
        _snapshot_debug: { ...clipDebug, failed: true },
      }), eventId]
    ).catch(() => {});
    return;
  }
  const fn = `${camera_id}_${eventId}_clip_${Date.now()}.jpg`;
  if (!saveJpeg(best.frame, fn)) {
    await pool.query(
      `UPDATE events SET raw_json = raw_json || $1::jsonb WHERE id=$2`,
      [JSON.stringify({
        _snapshot_status: 'failed',
        _snapshot_debug: { ...clipDebug, failed: true, failure_reason: 'save_jpeg_failed' },
      }), eventId]
    ).catch(() => {});
    return;
  }
  const status = clipDebug.low_confidence ? 'low_confidence' : 'ok';
  await pool.query(
    `UPDATE events
        SET raw_json = raw_json || $1::jsonb,
            snapshot_filename = $2,
            has_snapshot = TRUE
      WHERE id=$3`,
    [JSON.stringify({
      _snapshot: fn,
      _snapshot_source: 'dahua-clip-resolver',
      _snapshot_status: status,
      _snapshot_debug: clipDebug,
    }), fn, eventId]
  ).catch(() => {});
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)]).catch(() => {});
  console.log(`  🎞️  [${camera_id}] clip snapshot ${fn} (${status})`);
}

async function listenForClipDone() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  client.on('error', e => console.error('  🎞️  clip resolver listen:', e.message));
  client.on('notification', (msg) => {
    if (msg.channel !== 'clip_done') return;
    try {
      resolveDahuaSnapshotFromClip(JSON.parse(msg.payload)).catch(err =>
        console.error('  🎞️  clip resolver:', err.message)
      );
    } catch {
      // ignore malformed notifications
    }
  });
  await client.connect();
  await client.query('LISTEN clip_done');
  _clipDoneClient = client;
  console.log('  🎞️  Dahua clip resolver listening for clip_done');
}

// ============================================================
// Per-camera connection. Transport selectable via cam.dahua_transport
// (default 'eventManager') — only eventManager is wired today.
// ============================================================
function connectCamera(cam) {
  if (_destroyed.has(cam.camera_id)) return;
  _activeCams.set(cam.camera_id, cam);
  connectSnapManager(cam);
  const transport = String(cam.dahua_transport || 'eventManager').toLowerCase();
  if (transport !== 'eventmanager') {
    console.warn(`  ⚠️  [${cam.camera_id}] dahua_transport="${transport}" not implemented — using eventManager`);
  }
  const port   = cam.http_port || cam.port || 80;
  // Explicit code list — this firmware's codes=[All] delivers only
  // Heartbeat + system events (VCA events excluded).
  const uri    = '/cgi-bin/eventManager.cgi?action=attach&heartbeat=30&codes='
    + '[CrossLineDetection,CrossRegionDetection,LeftDetection,TakenAwayDetection,'
    + 'SmartMotionHuman,SmartMotionVehicle,All]';
  const method = 'GET';

  const doRequest = (authHeader) => {
    const headers = { Accept: '*/*' };
    if (authHeader) headers.Authorization = authHeader;
    const req = http.request(
      { host: cam.ip_address, port, path: uri, method, headers, timeout: 0 },
      (res) => {
        if (res.statusCode === 401) {
          const wa = res.headers['www-authenticate'];
          if (!wa || !/digest/i.test(wa)) {
            console.error(`  ❌ [${cam.camera_id}] 401 without Digest challenge`);
            res.resume();
            return scheduleReconnect(cam);
          }
          res.resume();
          return doRequest(buildDigestHeader(
            cam.username, cam.password, method, uri, parseChallenge(wa)));
        }
        if (res.statusCode !== 200) {
          console.error(`  ❌ [${cam.camera_id}] HTTP ${res.statusCode}`);
          res.resume();
          return scheduleReconnect(cam);
        }
        console.log(`  📡 [${cam.camera_id}] event stream connected (${cam.ip_address}:${port})`);
        _retryCount.delete(cam.camera_id);
        let buffer = Buffer.alloc(0);
        res.on('data', (chunk) => {
          buffer = processMultipart(cam, Buffer.concat([buffer, chunk]), 'event');
          if (buffer.length > 4 * 1024 * 1024) buffer = buffer.slice(-1024 * 1024);
        });
        res.on('end',   () => { console.warn(`  ⚠️  [${cam.camera_id}] stream ended`); scheduleReconnect(cam); });
        res.on('error', (e) => { console.error(`  ❌ [${cam.camera_id}] stream:`, e.message); scheduleReconnect(cam); });
      }
    );
    _eventReqs.set(cam.camera_id, req);
    req.on('error', (e) => {
      if (_eventReqs.get(cam.camera_id) === req) _eventReqs.delete(cam.camera_id);
      console.error(`  ❌ [${cam.camera_id}] request:`, e.message);
      scheduleReconnect(cam, e.code);
    });
    req.end();
  };
  doRequest(null);
}

function connectSnapManager(cam) {
  if (_destroyed.has(cam.camera_id)) return;
  if (cam.dahua_event_snapshot === false) return;
  if (_snapDisabled.has(cam.camera_id)) return;
  if (_snapActive.has(cam.camera_id)) return;
  _snapActive.add(cam.camera_id);
  const port = cam.http_port || cam.port || 80;
  const uri = '/cgi-bin/snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events=['
    + DAHUA_EVENT_CODES.join('%2C')
    + ']&channel=1&heartbeat=5';
  const method = 'GET';

  const doRequest = (authHeader) => {
    const headers = { Accept: '*/*' };
    if (authHeader) headers.Authorization = authHeader;
    const req = http.request(
      { host: cam.ip_address, port, path: uri, method, headers, timeout: 0, insecureHTTPParser: true },
      (res) => {
        if (res.statusCode === 401) {
          const wa = res.headers['www-authenticate'];
          if (!wa || !/digest/i.test(wa)) {
            console.warn(`  ⚠️  [${cam.camera_id}] snapManager 401 without Digest challenge`);
            res.resume();
            _snapActive.delete(cam.camera_id);
            return scheduleSnapReconnect(cam);
          }
          res.resume();
          return doRequest(buildDigestHeader(
            cam.username, cam.password, method, uri, parseChallenge(wa)));
        }
        if (res.statusCode !== 200) {
          console.warn(`  ⚠️  [${cam.camera_id}] snapManager HTTP ${res.statusCode}`);
          res.resume();
          _snapActive.delete(cam.camera_id);
          if ([400, 404, 405].includes(res.statusCode)) {
            _snapDisabled.add(cam.camera_id);
            console.warn(`  ℹ️  [${cam.camera_id}] snapManager unsupported — using RTSP/live fallback`);
            return;
          }
          return scheduleSnapReconnect(cam);
        }
        _snapConnected.add(cam.camera_id);
        _retryCount.delete(cam.camera_id);
        console.log(`  📸 [${cam.camera_id}] snapManager event snapshot stream connected`);
        let buffer = Buffer.alloc(0);
        res.on('data', (chunk) => {
          buffer = processMultipart(cam, Buffer.concat([buffer, chunk]), 'snap');
          if (buffer.length > 8 * 1024 * 1024) buffer = buffer.slice(-2 * 1024 * 1024);
        });
        const done = (msg) => {
          if (msg) console.warn(`  ⚠️  [${cam.camera_id}] snapManager ${msg}`);
          _snapConnected.delete(cam.camera_id);
          _snapActive.delete(cam.camera_id);
          scheduleSnapReconnect(cam);
        };
        res.on('end', () => done('stream ended'));
        res.on('error', (e) => done(`stream: ${e.message}`));
      }
    );
    _snapReqs.set(cam.camera_id, req);
    req.on('error', (e) => {
      if (_snapReqs.get(cam.camera_id) === req) _snapReqs.delete(cam.camera_id);
      console.warn(`  ⚠️  [${cam.camera_id}] snapManager request: ${e.message}`);
      clearSnapState(cam.camera_id);
      if (e.code === 'HPE_INVALID_HEADER_TOKEN' || /Invalid header token|Parse Error/i.test(e.message || '')) {
        _snapDisabled.add(cam.camera_id);
        console.warn(`  ℹ️  [${cam.camera_id}] snapManager parser rejected stream — using RTSP/live fallback`);
        return;
      }
      scheduleSnapReconnect(cam, e.code);
    });
    req.end();
  };
  doRequest(null);
}

const _reconnectTimers = new Map();
const _snapReconnectTimers = new Map();
const _activeCams      = new Map();   // camera_id → cam (currently live or reconnecting)
const _snapActive      = new Set();
const _eventReqs       = new Map();   // camera_id → current eventManager request
const _snapReqs        = new Map();   // camera_id → current snapManager request
const _destroyed       = new Set();   // camera_ids that must not reconnect (hot-removed)
const _retryCount      = new Map();   // camera_id → consecutive EHOSTUNREACH count (for backoff)
let _clipDoneClient    = null;

function cameraConfigSignature(cam) {
  return JSON.stringify({
    ip_address: cam.ip_address || '',
    username: cam.username || '',
    password: cam.password || '',
    http_port: cam.http_port || cam.port || 80,
    snapshot_path: cam.snapshot_path || '',
    dahua_transport: String(cam.dahua_transport || 'eventManager').toLowerCase(),
    dahua_event_snapshot: cam.dahua_event_snapshot !== false,
    dahua_snapshot_lookback_ms: Number(cam.dahua_snapshot_lookback_ms),
    dahua_server_frame_offsets_ms: Array.isArray(cam.dahua_server_frame_offsets_ms)
      ? cam.dahua_server_frame_offsets_ms.map(Number).filter(Number.isFinite)
      : null,
  });
}

function stopCameraConnection(cameraId) {
  _destroyed.add(cameraId);
  _activeCams.delete(cameraId);
  clearTimeout(_reconnectTimers.get(cameraId));
  _reconnectTimers.delete(cameraId);
  clearTimeout(_snapReconnectTimers.get(cameraId));
  _snapReconnectTimers.delete(cameraId);
  _retryCount.delete(cameraId);
  const eventReq = _eventReqs.get(cameraId);
  if (eventReq) {
    try { eventReq.destroy(); } catch { /* ignore */ }
    _eventReqs.delete(cameraId);
  }
  const snapReq = _snapReqs.get(cameraId);
  if (snapReq) {
    try { snapReq.destroy(); } catch { /* ignore */ }
    _snapReqs.delete(cameraId);
  }
  clearSnapState(cameraId);
}

function scheduleReconnect(cam, errCode = null) {
  if (_destroyed.has(cam.camera_id)) return;
  if (_reconnectTimers.has(cam.camera_id)) return;
  let delay;
  if (UNREACHABLE_CODES.has(errCode)) {
    const retries = _retryCount.get(cam.camera_id) || 0;
    delay = Math.min(RECONNECT_BASE_MS * (2 ** retries), RECONNECT_MAX_MS);
    _retryCount.set(cam.camera_id, retries + 1);
  } else {
    delay = RECONNECT_BASE_MS;
    _retryCount.delete(cam.camera_id);
  }
  const t = setTimeout(() => {
    _reconnectTimers.delete(cam.camera_id);
    connectCamera(cam);
  }, delay);
  _reconnectTimers.set(cam.camera_id, t);
}

function scheduleSnapReconnect(cam, errCode = null) {
  if (_destroyed.has(cam.camera_id)) return;
  if (_snapReconnectTimers.has(cam.camera_id)) return;
  let delay;
  if (UNREACHABLE_CODES.has(errCode)) {
    const retries = _retryCount.get(cam.camera_id) || 0;
    delay = Math.min(RECONNECT_BASE_MS * (2 ** retries), RECONNECT_MAX_MS);
    _retryCount.set(cam.camera_id, retries + 1);
  } else {
    delay = RECONNECT_BASE_MS;
    _retryCount.delete(cam.camera_id);
  }
  const t = setTimeout(() => {
    _snapReconnectTimers.delete(cam.camera_id);
    connectSnapManager(cam);
  }, delay);
  _snapReconnectTimers.set(cam.camera_id, t);
}

// ============================================================
// Bootstrap — config load + hot-reload via fs.watch
// ============================================================
function loadDahuaCameras() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return (cfg.cameras || [])
      .filter(c => String(c.vendor || 'bosch').toLowerCase() === 'dahua')
      .filter(c => !c.paused)
      .map(decryptCamCreds);
  } catch (e) {
    console.error('❌ Cannot read cameras-config.json:', e.message);
    return [];
  }
}

// Diff the new camera list against _activeCams: connect new cameras,
// stop removed ones, reconnect cameras whose IP/credentials changed.
function syncCameras() {
  const newCams = loadDahuaCameras();
  const newById = new Map(newCams.map(c => [c.camera_id, c]));

  for (const cam of newCams) {
    if (!cam.ip_address || !cam.username || !cam.password) continue;
    const prev    = _activeCams.get(cam.camera_id);
    const changed = prev && cameraConfigSignature(prev) !== cameraConfigSignature(cam);
    if (changed) {
      console.log(`  🔄 [${cam.camera_id}] config changed — reconnecting`);
      stopCameraConnection(cam.camera_id);
      _snapDisabled.delete(cam.camera_id);
      setTimeout(() => { _destroyed.delete(cam.camera_id); connectCamera(cam); }, RECONNECT_BASE_MS);
    } else if (!prev) {
      console.log(`  ➕ [${cam.camera_id}] new camera — connecting`);
      connectCamera(cam);
    }
  }

  for (const [id] of _activeCams) {
    if (!newById.has(id)) {
      console.log(`  ➖ [${id}] removed from config — stopping`);
      stopCameraConnection(id);
      _snapDisabled.delete(id);
    }
  }
}

function watchConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    fs.watch(CONFIG_FILE, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        console.log('  🔄 cameras-config.json changed — syncing Dahua cameras...');
        setTimeout(syncCameras, 500);
      }
    });
    console.log(`  👁️  Watching ${CONFIG_FILE}`);
  } catch (e) { console.warn('Watch failed:', e.message); }
}

function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  📷 Dahua CGI Event Ingester (Multi-vendor MV.5) ║');
  console.log('╚══════════════════════════════════════════════════╝');

  alertEngine.init(pool);
  const cams = loadDahuaCameras();
  if (cams.length === 0) {
    console.log('  ℹ️  No vendor:"dahua" cameras in cameras-config.json — waiting.');
    console.log('     Add one via the dashboard — no restart needed.');
  }
  for (const cam of cams) {
    if (!cam.ip_address || !cam.username || !cam.password) {
      console.error(`  ⚠️  [${cam.camera_id}] missing ip_address/username/password — skipped`);
      continue;
    }
    console.log(`  → ${cam.camera_id} (${cam.ip_address})`);
    connectCamera(cam);
  }
  watchConfig();
  listenForClipDone().catch(err => console.error('  🎞️  clip resolver listen:', err.message));
}

function shutdown() {
  console.log('\n⏏  Dahua ingester shutting down...');
  for (const t of _reconnectTimers.values()) clearTimeout(t);
  for (const t of _snapReconnectTimers.values()) clearTimeout(t);
  if (_clipDoneClient) {
    try { _clipDoneClient.end(); } catch { /* ignore */ }
  }
  try { alertEngine.shutdown(); } catch { /* ignore */ }
  pool.end().finally(() => process.exit(0));
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

main();
