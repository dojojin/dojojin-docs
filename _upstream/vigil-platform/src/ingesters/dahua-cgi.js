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
// Line Crossing, Intrusion, Smart Motion, object Left/Taken-away —
// plus, as of the 2026-07-15 multi-channel NVR plan, an NVR's onboard-AI
// codes (Face*, TrafficJunction/ANPR, VehicleDetect, NonMotorDetect,
// HumanTrait). Face* codes are OPT-IN PER CHANNEL via that channel's
// `capture_categories: ['face']` — never ingested by default, and never
// on a plain single-channel Dahua camera (no NVR onboard AI to opt into).
// The original exclusion reasoning still applies to a bare camera's own
// Face Detection (coarse box, unreliable demographics, not a Face Capture
// engine — accurate face analytics needs a Face Capture-class camera,
// e.g. Hikvision Face Capture, decision #117); on an NVR with onboard AI
// it's a deliberate, explicit per-channel choice, not a blanket default.
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
// Multi-channel NVR support (2026-07-15): a physical NVR (e.g.
// DHI-NVR5216-16P-I/L) exposes N channels, each configured as its own
// flat cameras-config.json entry (own camera_id, own DB row) carrying a
// new `nvr_channel` field (0-based, matches the eventManager event line's
// `index=N`) and an optional `device_id` grouping key. Entries that share
// a connection identity (`device_id`, or ip:port:user when absent — see
// dahua-protocol.js `deviceKey()`) are served by ONE eventManager + ONE
// snapManager stream instead of one pair per channel — opening a stream
// per channel would multiply concurrent CGI sessions against a single
// device and risk the NVR's session cap. Everything downstream of event
// parsing (DB insert, alerts, snapshots, EDGE_MODE publish) still keys on
// the resolved channel's own camera_id, unchanged. See
// docs/superpowers/plans/2026-07-15-dahua-nvr-multichannel.md.
//
// Camera list: cameras-config.json entries with vendor:'dahua'.
// Run standalone:  node src/ingesters/dahua-cgi.js
// ============================================================

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
// Load .env BEFORE any other module require — several deps (edge/publisher via
// lpr-core, etc.) read process.env.EDGE_MODE at their own module-load time and
// cache it, so if dotenv ran later those consts would freeze as undefined→false.
// (2026-07-16 regression fix: adding require('../lpr-core') above the old
// dotenv line silently flipped the whole ingester to the non-EDGE DB path.)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mqtt   = require('mqtt');
const { spawn } = require('child_process');
const sharp  = require('sharp');
const { Pool, Client } = require('pg');
const alertEngine = require('../alert-engine');
const { decryptCamCreds } = require('../crypto-creds');
const { parseChallenge, buildDigestHeader } = require('../helpers/digestAuth');
const {
  DAHUA_EVENT_MAP, DAHUA_CLASS, DAHUA_CATEGORY_CODES, parseDahuaEventText, parseSnapManagerCode, parseSnapManagerIndex,
  parsePlateCutout, extractObjectClass, extractFaceAttributes, faceComparisonListType, deviceKey, codesForCategories, channelAllowsCode,
  parseDahuaTrafficJunction, normalizeDahuaEmotion,
} = require('./dahua-protocol');
const { xyzToColorName } = require('../color-utils');
const { VEHICLE_TYPE_TO_CLASS } = require('../lpr-core');
const {
  SNAPSHOT_DEBUG_MAX_CANDIDATES, SNAPSHOT_CONFIDENCE_THRESHOLD,
  SNAPSHOT_NEAR_BEST_MIN_DELTA, SNAPSHOT_NEAR_BEST_RATIO,
  SCAN_WINDOW_SEC, SCAN_MAX_SEGS,
  eventBoxEdgeRisk, scoreFrameForObject, scoreFrameMotion, chooseBestSnapshotCandidate,
  selectScanSegments,
} = require('./dahua-snapshot-selector');
const { EDGE_MODE, publishEdgeEvent, newCorrId } = require('../edge/publisher');
const { fetchStoredFile } = require('./dahua-rpc');
require('../singleton')('dahua-cgi');   // refuse to run a second copy

const CONFIG_FILE   = path.join(__dirname, '..', '..', 'cameras-config.json');
// media-recorder's rolling RTSP clip buffer — `media-buffer/<camera>/<unix_ts>.ts`.
const MEDIA_BUFFER_DIR = path.join(__dirname, '..', '..', 'media-buffer');
const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'snapshots');
const { snapPath } = require('../snapshot-path');

// MQTT client for publishing edge snapshots to central via NanoMQ → bridge.
// Task #23: on central (EDGE_MQTT_BROKER unset), this hits central's own EMQX
// directly and needs auth — SNAPSHOT_PUBLISHER_USER/PASSWORD (PUBLISH-only on
// +/onvif-ej/Device/snapshot). On edge, EDGE_MQTT_BROKER points at the local
// NanoMQ which allows anonymous, so these env vars are simply unset there.
const _snapMqttOpts = {
  clientId: `dah-snap-${process.pid}`, reconnectPeriod: 5000, clean: true,
};
if (process.env.SNAPSHOT_PUBLISHER_USER && process.env.SNAPSHOT_PUBLISHER_PASSWORD) {
  _snapMqttOpts.username = process.env.SNAPSHOT_PUBLISHER_USER;
  _snapMqttOpts.password = process.env.SNAPSHOT_PUBLISHER_PASSWORD;
}
const _snapMqtt = mqtt.connect(process.env.EDGE_MQTT_BROKER || 'mqtt://localhost:1883', _snapMqttOpts);
_snapMqtt.on('error', (e) => console.warn('[dah-snap-mqtt]', e.message));
const RECONNECT_BASE_MS  = 5_000;   // base reconnect delay
const RECONNECT_MAX_MS   = 30_000;  // backoff ceiling
const UNREACHABLE_CODES  = new Set(['EHOSTUNREACH', 'ENETUNREACH']);
const DEDUP_WINDOW_MS   = 3000;   // collapse repeated posts of one detection
// Fixed pixel region of the camera's own plate cutout that the ITC burns into
// the top-left of its composite snapshot (2026-07-16, measured from live
// 1920x1144 composites — stable across samples). Crop this for plate_image.
// Camera-OSD-config-dependent: re-measure if the overlay layout is changed.
// FALLBACK ONLY, gated by native frame width — see ANPR_PLATE_CROP_MIN_WIDTH.
const ANPR_PLATE_CROP = { x: 15, y: 78, w: 205, h: 180 };
// Cutout-first for every ANPR camera (2026-07-20): the camera's-own-cutout
// comes from the snapManager stream, per-event OID-matched — it never
// touches the shared scene buffer captureFrame() returns, so it's unaffected
// by _inflightCapture's per-camera_id promise-coalescing (see that map's
// declaration). A prior version of this comment claimed pixel-content
// validation could substitute for a geometry check on the fixed-pixel
// fallback — DISPROVEN live, 2026-07-20: scored a 48-sample mixed-lighting
// set (day/color + night/IR-grayscale) and found no usable separation —
// real plates ranged 0.0-70.3% brightness-fraction (black plastic bezels
// score near 0, blown-out IR reflections score near 100) with junk
// (leaves/wires/building) scattered across the SAME range. Pixel content
// cannot tell a real plate from background; camera geometry can.
// ANPR_PLATE_CROP_MIN_WIDTH is that geometry check: cameras with a native
// frame narrower than this (measured live: hdy-anpr-bigc2 = 1920px) burn a
// real plate thumbnail into the ANPR_PLATE_CROP region; cameras at or above
// it (measured live: hdy-anpr-bigc1 = 2688px) do not — that region is
// background there, always (confirmed: every hdy-anpr-bigc1 fixed-pixel
// sample checked across 2026-07-17 through 2026-07-20 was background, 0
// exceptions). On a cutout miss: narrow camera → use the fixed-pixel crop;
// wide camera → write no crop at all rather than a guaranteed-junk one.
// IMPORTANT — this must read the frame's NATIVE resolution, before the
// 1920x1080 scene resize further down; that resize is exactly what produced
// the wrong 1833px reading that misdirected the analysis this comment
// replaces. sharp(frame).metadata() below runs before that resize.
const ANPR_PLATE_CROP_MIN_WIDTH = 2200;

// snapManager attachFileProc reliably streams event JPEGs only for these codes.
// Subscribing it to the full event-code set (Face*/rule/VideoBlind, e.g. when a
// camera has capture_categories unset → all 16 codes) makes some firmware return
// an EMPTY stream — 0 images, silently killing plate cutouts (live-confirmed
// 2026-07-17: bigc/lotus with unset caps got 0 cutouts on 16 codes, 11 on 4).
// The eventManager subscription keeps the FULL list; this only narrows the
// snapshot stream. Face crops come via the RPC stored-file path, not snapManager.
const SNAP_SAFE_CODES = new Set(['TrafficJunction', 'VehicleDetect', 'SmartMotionVehicle', 'NonMotorDetect']);
const EVENT_LOOKBACK_MS = 1200;   // fallback: event arrives ~this long after the detection frame
const RTSP_FRAME_LOOKBACK_MS = 700; // pick the buffer frame just before Dahua reports the event
const MAX_FUTURE_EVENT_MS = 6000; // Dahua may deliver CGI text before the timestamped frame reaches RTSP
const SNAP_EVENT_WAIT_MS = 1200;  // wait briefly for snapManager's event JPEG before RTSP fallback
// Late-cutout recovery (2026-07-19): on some units (live-confirmed
// hdy-anpr-bigc1/hdy-motor-bigc1, .184/.185 — 0% cutout-hit rate vs 60-77%
// on identical hardware elsewhere) the camera's OWN plate cutout consistently
// arrives 10-36s after the event, blowing way past SNAP_EVENT_WAIT_MS —
// DIAG-CUTOUT logging confirmed the data isn't lost, just late. Root cause on
// the camera side is unconfirmed (config diff + ping both came back clean);
// this recovers the correct crop when it eventually shows up instead of
// permanently keeping the fixed-region fallback. 45s = observed max delay
// (36s) + margin. Background-only — never blocks the main ingest path.
const LATE_CUTOUT_RETRY_MS = 45_000;
const FRAME_WAIT_MS     = 3000;   // max wait after a target timestamp for its .ts segment to flush
const FRAME_WAIT_POLL_MS = 300;   // re-check interval while waiting for the segment
const SERVER_ANCHOR_FRAME_OFFSETS_MS = [-4000, -2000, -1000, 0, 1000, 2000, 3000, 5000, 7000, 10000, 12000];
const SERVER_ANCHOR_MAX_FUTURE_MS = 12000;
const SEGMENT_CLOSE_AGE_MS = 2000;    // mtime fallback: segment not written to for this long = safe to read
const CLIP_RESOLVER_OFFSETS_SEC = [4, 6, 8, 9, 10, 11, 12, 14, 16];
const CLIP_RESOLVER_STATUS_RETRY_MS = 1500;
const CLIP_RESOLVER_STATUS_MAX_RETRIES = 30;

// ============================================================
// Dahua event Code → normalized event shape. event_type reuses
// Bosch's vocabulary 1:1 where the concept maps so existing category
// rules + CLASS_HIERARCHY apply. VideoMotion is intentionally
// unmapped (raw motion is too noisy).
// ============================================================
// DAHUA_EVENT_MAP, DAHUA_CLASS — ย้ายไป dahua-protocol.js (pure, testable)

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
// Snapshot grab — returns the JPEG as a Buffer. The rolling buffer
// polls ~1×/s, so the digest challenge is cached per camera (just
// bump the nonce-count) to keep each poll a single request; a
// stale-nonce 401 transparently re-handshakes.
// ============================================================
const _digestCache = new Map();   // camera_id → { challenge, nc }

// Coalesce concurrent captures per camera (2026-07-15 root-cause fix —
// "some snapshots missing"). Root cause, confirmed live: on this NVR,
// FaceRecognition + FaceComparision fire ~9ms apart for the SAME detected
// person, and each independently called captureFrame() for the same
// camera_id — two near-simultaneous HTTP GETs racing on the shared
// _digestCache nonce for that camera_id, so the NVR ECONNRESETs one and
// the other times out. Since both calls are for the same person at the
// same instant, sharing one frame is both correct (same subject) and
// halves the CGI load on the NVR. _captureFrameOnce below is the real
// HTTP round-trip; captureFrame is the public coalescing entry point.
const _inflightCapture = new Map();   // camera_id → Promise<Buffer|null>

function captureFrame(cam) {
  // TEMP DIAGNOSTIC (2026-07-15, verifying the coalescing fix actually
  // coalesces) — remove once confirmed.
  const nowMs = Date.now();
  const existing = _inflightCapture.get(cam.camera_id);
  if (existing) {
    console.warn(`  🔎 DIAG-COALESCE [${cam.camera_id}] HIT @${nowMs} — reusing in-flight capture`);
    return existing;
  }
  console.warn(`  🔎 DIAG-COALESCE [${cam.camera_id}] MISS @${nowMs} — starting new capture`);
  const p = _captureFrameOnce(cam).finally(() => {
    console.warn(`  🔎 DIAG-COALESCE [${cam.camera_id}] settled @${Date.now()} (started @${nowMs})`);
    if (_inflightCapture.get(cam.camera_id) === p) _inflightCapture.delete(cam.camera_id);
  });
  _inflightCapture.set(cam.camera_id, p);
  return p;
}

function _captureFrameOnce(cam) {
  return new Promise((resolve) => {
    // NVR channel is 0-based (matches eventManager index=N); the CGI
    // snapshot.cgi channel param is 1-based. A plain single-channel
    // camera has no nvr_channel → channel 1, same as before this change.
    const channel = Number.isInteger(cam.nvr_channel) ? cam.nvr_channel + 1 : 1;
    const uri  = cam.snapshot_path || `/cgi-bin/snapshot.cgi?channel=${channel}`;
    const port = cam.http_port || 80;
    // TEMP DIAGNOSTIC (2026-07-15, "some snapshots missing" root-cause pass) —
    // captureFrame() had 4 silent resolve(null) paths; tag each one so we can
    // see WHICH failure mode is actually firing instead of just "it failed".
    // Remove once the real cause is confirmed and (if fixable) fixed.
    const fail = (reason, extra) => {
      console.warn(`  🔎 DIAG [${cam.camera_id}] captureFrame fail: ${reason}${extra ? ' — ' + extra : ''}`);
      resolve(null);
    };
    const get = (authHeader, isRetry) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get(
        // 10s, not 5s (2026-07-15 root-cause follow-up): live-tested against
        // this NVR — snapshot.cgi is genuinely slow, not broken. A manual
        // idle-time test (no concurrent capture) took 5.38s to succeed on
        // its 3rd attempt; the previous 5000ms timeout was cutting it off
        // right at that boundary. Combined with the capture-coalescing fix
        // above (only ever 1 in-flight request per camera), a longer
        // timeout no longer risks compounding concurrent-request load.
        { host: cam.ip_address, port, path: uri, headers, timeout: 10000 },
        (res) => {
          if (res.statusCode === 401) {
            const wa = res.headers['www-authenticate'];
            res.resume();
            if (isRetry || !wa || !/digest/i.test(wa)) {
              _digestCache.delete(cam.camera_id);
              return fail('401', `isRetry=${isRetry} www-authenticate=${wa || '(none)'}`);
            }
            const entry = { challenge: parseChallenge(wa), nc: 1 };
            _digestCache.set(cam.camera_id, entry);
            return get(buildDigestHeader(cam.username, cam.password, 'GET', uri,
              entry.challenge, String(entry.nc).padStart(8, '0')), true);
          }
          if (res.statusCode !== 200) { res.resume(); return fail('non-200 status', String(res.statusCode)); }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }
      );
      r.on('error', (e) => fail('request error', e?.code || e?.message || String(e)));
      r.on('timeout', () => { r.destroy(); fail('timeout', '10000ms'); });
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
      // safe to read once ffmpeg has moved on: either a newer segment exists,
      // or the segment's mtime shows it hasn't been written to in >2s (closed).
      // ponytail: mtime fallback covers sparse-buffer case (single segment, no newer one yet)
      const segPath = path.join(dir, `${pick}.ts`);
      let segClosed = segs[segs.length - 1] > pick;
      if (!segClosed) {
        try { segClosed = Date.now() - fs.statSync(segPath).mtimeMs > SEGMENT_CLOSE_AGE_MS; }
        catch { /* file disappeared between readdir and stat — treat as not closed */ }
      }
      if (segClosed) {
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

function serverAnchorFrameCandidateTimes(cam, base) {
  const configured = Array.isArray(cam?.dahua_server_frame_offsets_ms)
    ? cam.dahua_server_frame_offsets_ms.map(Number).filter(Number.isFinite)
    : null;
  const offsets = configured && configured.length ? configured : SERVER_ANCHOR_FRAME_OFFSETS_MS;
  const maxFuture = Math.max(SERVER_ANCHOR_MAX_FUTURE_MS, ...offsets.filter(ms => ms > 0));
  const now = Date.now();
  return [...new Set(offsets.map(ms => Math.max(0, Math.min(now + maxFuture, base + ms))))];
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

async function extractScanFrameFromBuffer(cameraId, receivedMs, data) {
  const dir = path.join(MEDIA_BUFFER_DIR, cameraId);
  let segs;
  try {
    segs = fs.readdirSync(dir)
      .filter(f => /^\d+\.ts$/.test(f))
      .map(f => parseInt(f, 10))
      .sort((a, b) => a - b);
  } catch {
    return { frame: null, debug: { strategy: 'rtsp-buffer-scan', error: 'dir_missing' } };
  }
  const eventSec = Math.floor(receivedMs / 1000);
  const targets  = selectScanSegments(segs, eventSec, SCAN_WINDOW_SEC, SCAN_MAX_SEGS);
  const candidates = [];
  for (const pick of targets) {
    const segPath  = path.join(dir, `${pick}.ts`);
    let segClosed  = segs[segs.length - 1] > pick;
    if (!segClosed) {
      try { segClosed = Date.now() - fs.statSync(segPath).mtimeMs > SEGMENT_CLOSE_AGE_MS; }
      catch { /* disappeared */ }
    }
    if (!segClosed) continue;
    const frame = await ffmpegFrame(segPath, 0);
    if (frame && frame.length > 0) {
      const score = await scoreFrameForObject(frame, data);
      candidates.push({ frame, score, segment: pick });
    }
  }
  const debug = { strategy: 'rtsp-buffer-scan', scanned: targets.length, candidates: candidates.length };
  if (!candidates.length) return { frame: null, debug };
  candidates.sort((a, b) => b.score - a.score);
  debug.selected_segment = candidates[0].segment;
  debug.selected_score   = Number(candidates[0].score.toFixed(2));
  return { frame: candidates[0].frame, debug };
}

// ============================================================
// Per-(camera,code) dedup — Dahua re-posts a detection while it persists.
// ============================================================
const _dedup = new Map();
const _unmappedCodes = new Set();   // codes นอก map ที่ log ไปแล้ว (log once)
const _unconfiguredChannels = new Set();   // "deviceKey#channel" already logged (log once)
function shouldRecord(cameraId, code) {
  const k = `${cameraId}|${code}`;
  const now = Date.now();
  const last = _dedup.get(k) || 0;
  _dedup.set(k, now);
  // key มี ObjectID (วิ่งขึ้นเรื่อยๆ) — prune กัน map โตไม่จำกัด
  if (_dedup.size > 2000) {
    for (const [key, ts] of _dedup) {
      if (now - ts > DEDUP_WINDOW_MS * 10) _dedup.delete(key);
    }
  }
  return (now - last) > DEDUP_WINDOW_MS;
}

// ============================================================
// snapManager event-JPEG cache. snapManager may deliver the event text
// and the matching JPEG a few hundred ms after eventManager reports the
// detection; keep only a small recent window and consume each image once.
// Keyed by deviceKey (one shared snapManager connection per NVR) — each
// cached snapshot also carries its own `channel` so a multi-channel NVR
// never hands channel-2's JPEG to a channel-4 event (2026-07-15 plan).
// deviceKey → [{ code, channel, plateImg, plate, oid, ts }] — a QUEUE, not a
// single slot (2026-07-19 fix). Was `Map<deviceKey, ctx>` (one slot, latest
// write wins) — under two vehicles detected close together, if their TEXT
// metadata parts both arrive before either's IMAGE part (plausible: text is
// tiny, images take longer to encode; also our own processMultipart() just
// walks whatever's in the current TCP read in buffer order, which doesn't
// guarantee strict text1→image1→text2→image2 alternation), the second
// text overwrote the first before its image showed up — image1 got paired
// with vehicle 2's oid/plate. Live-confirmed 2026-07-17 on hdy-anpr-bigc2:
// two cars 1s apart (ObjectID 46432/46433) — the "2384" event's plate_image
// file rendered vehicle "3558"'s plate. FIFO queue: each image pairs with
// the OLDEST unconsumed context, matching arrival order instead of "latest
// wins". Capped/pruned like _eventSnaps so a stalled pairing can't leak.
const _snapContexts = new Map();
const _eventSnaps = new Map();    // deviceKey → [{ code, channel, ts, buf, used }]
const _snapConnected = new Set(); // deviceKey
const _snapDisabled = new Set();  // deviceKey — unsupported by this model/firmware until config reload

// Fire-and-forget upsert of live ingester state into DB so health.js can read it.
function upsertCamStatus(cameraId, patch) {
  if (EDGE_MODE) return;   // no local DB on edge
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const cols = ['camera_id', ...keys, 'updated_at'];
  const vals = [cameraId, ...keys.map(k => patch[k]), new Date()];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ') + `, updated_at = $${keys.length + 2}`;
  pool.query(
    `INSERT INTO ingester_camera_status (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (camera_id) DO UPDATE SET ${setClause}`,
    vals
  ).catch(e => console.error('[dahua] upsertCamStatus:', e.message));
}

// Status writes are per-camera_id in the DB (one row per channel) even
// though the connection itself is per-device — fan the same patch out to
// every channel of the device.
function upsertDeviceStatus(device, patch) {
  for (const cam of device.channels.values()) upsertCamStatus(cam.camera_id, patch);
}

function clearSnapState(deviceKeyStr) {
  _snapContexts.delete(deviceKeyStr);
  _eventSnaps.delete(deviceKeyStr);
  _snapActive.delete(deviceKeyStr);
  _snapConnected.delete(deviceKeyStr);
  _snapLastData.delete(deviceKeyStr);
}

// Cap/window widened 2026-07-19→20 (defect #4 of the burst-mismatch
// investigation): a dense multi-lane burst measured live on hdy-anpr-bigc2
// (2026-07-17) sustained ~36 events/min with sub-second clusters — a 10s/12-
// item cap can evict a still-unconsumed context before takeEventPlateCutout()
// ever sees it, forcing the (narrow-camera-only) fixed-pixel fallback or a
// null crop (wide camera) — either way worse than a real cutout hit. 15s/30
// items gives headroom for that measured density without material memory
// cost (~30 JPEGs × a few KB, per device, pruned every push).
const EVENT_SNAP_WINDOW_MS = 15000;
const EVENT_SNAP_MAX_ITEMS = 30;

function rememberEventSnapshot(deviceKeyStr, code, channel, buf, plateImg, plate, oid) {
  if (!buf || buf.length <= 0) return;
  const arr = _eventSnaps.get(deviceKeyStr) || [];
  const now = Date.now();
  arr.push({ code: code || null, channel: Number.isInteger(channel) ? channel : null, ts: now, buf, plateImg: plateImg || null, plate: plate || null, oid: oid || null, used: false });
  const fresh = arr.filter(x => now - x.ts < EVENT_SNAP_WINDOW_MS).slice(-EVENT_SNAP_MAX_ITEMS);
  _eventSnaps.set(deviceKeyStr, fresh);
}

// Takes the resolved CHANNEL cam (not a device) so it can filter the
// device's shared snapshot cache down to this channel. A cached snapshot
// with channel===null (firmware didn't tag it) is still allowed through —
// best-effort match rather than a stricter-than-the-data filter; if it's
// wrong, the RTSP-buffer fallback chain that runs next is channel-correct
// via media-recorder's per-camera clip buffer.
async function waitForEventSnapshot(cam, code, sinceMs) {
  const dKey = deviceKey(cam);
  if (!_snapConnected.has(dKey)) return null;
  const wantChannel = Number.isInteger(cam.nvr_channel) ? cam.nvr_channel : 0;
  const deadline = Date.now() + SNAP_EVENT_WAIT_MS;
  while (Date.now() <= deadline) {
    const arr = _eventSnaps.get(dKey) || [];
    const snap = arr.find(x =>
      !x.used &&
      x.ts >= sinceMs - 1500 &&
      (x.channel === null || x.channel === wantChannel) &&
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

// Edge ANPR plate crop source (2026-07-17): the snapManager image body carries
// the camera's OWN already-cropped plate JPEG, appended after the scene, at the
// byte {off,len} parsed into snap.plateImg. Extract it — a clean plate for every
// model, sidestepping the fixed-position crop that lands on empty road on native
// 4MP cams. Pairs the cutout to THIS event deterministically so heavy traffic
// can't hand another car's crop to this row: prefer ObjectID (stable even when
// OCR reads the plate differently across the two streams — the bigc case), else
// plate text, else time-only. Never swaps: a mismatched id/plate just misses →
// fall back to the fixed crop.
//
// Returns { crop, scene } on hit, null on miss/bad-offset (caller falls back
// to captureFrame()+fixed crop). `scene` is snap.buf WHOLE, not sliced to the
// crop region — live-verified 2026-07-20: the snapManager body is one scene
// JPEG (own EOI marker) with the plate crop appended after as trailing bytes;
// sharp/libvips decodes straight through to the scene's EOI and ignores the
// trailing bytes, so no manual slicing is needed. This scene is the paired
// detect-moment frame for the SAME matched snap as the crop (one search, both
// buffers) — unlike captureFrame()'s live snapshot.cgi grab, which fires
// independently of any specific detection and can return whatever the camera
// is showing several seconds later (root cause of the hdy-motor-bigc2 scene/
// crop mismatch report: OSD had already moved on to a later vehicle by the
// time the live grab completed).
async function takeEventPlateCutout(cam, code, sinceMs, plate, oid, waitMs = SNAP_EVENT_WAIT_MS) {
  const dk = deviceKey(cam);
  if (!_snapConnected.has(dk)) return null;
  const wantChannel = Number.isInteger(cam.nvr_channel) ? cam.nvr_channel : 0;
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const arr = _eventSnaps.get(dk) || [];
    const snap = arr.find(x =>
      !x.used && x.plateImg &&
      x.ts >= sinceMs - 1500 &&
      (x.channel === null || x.channel === wantChannel) &&
      (!x.code || !code || x.code === code) &&
      ((oid != null && x.oid != null) ? String(x.oid) === String(oid) : (!plate || x.plate === plate))
    );
    if (snap) {
      snap.used = true;
      const { off, len } = snap.plateImg;
      if (off >= 0 && len > 0 && off + len <= snap.buf.length) {
        _diagCutoutResult(cam, 'hit', { oid, plate, arrLen: arr.length });
        return { crop: snap.buf.slice(off, off + len), scene: snap.buf };
      }
      _diagCutoutResult(cam, 'bad-offset', { oid, plate, off, len, bufLen: snap.buf.length, arrLen: arr.length });
      return null;
    }
    await sleep(120);
  }
  // Miss — diagnostic-only (2026-07-19, "BigC vs nakuan1" investigation): dump
  // why no candidate matched, so a live capture during real traffic tells us
  // whether it's (a) nothing arrived at all — _eventSnaps empty/no plateImg,
  // (b) candidates arrived but got evicted — rememberEventSnapshot's
  // `.slice(-12)` 10s cap can drop a true match under bursty traffic before
  // this search ever sees it, or (c) candidates present but oid/plate/channel/
  // code genuinely don't match (the "OCR reads differently across streams"
  // case the ObjectID-preference was built for). No behavior change — read-only.
  const arr = _eventSnaps.get(dk) || [];
  _diagCutoutResult(cam, 'miss', {
    oid, plate, wantChannel, code, arrLen: arr.length,
    candidates: arr.map(x => ({
      used: x.used, hasPlateImg: !!x.plateImg, ch: x.channel, code: x.code,
      oid: x.oid, plate: x.plate, ageMs: Date.now() - x.ts,
    })),
  });
  return null;
}

// Fire-and-forget: called AFTER the event has already been published with the
// fixed-region fallback crop (2026-07-19 late-cutout recovery). Keeps
// searching for the camera's own cutout for up to LATE_CUTOUT_RETRY_MS and,
// if it eventually shows up, overwrites the SAME plate_image file path with
// the correct bytes — the DB row's plate_image already points at that path,
// so no MQTT patch / DB UPDATE is needed, the file just gets better in place.
// Never awaited by the caller; errors are swallowed (best-effort recovery,
// must not affect anything else if it fails).
function scheduleLateCutoutRecovery(cam, code, sinceMs, plate, oid, filePath, corr, scenePath) {
  takeEventPlateCutout(cam, code, sinceMs, plate, oid, LATE_CUTOUT_RETRY_MS)
    .then(async (late) => {
      if (!late || !late.crop || late.crop.length === 0) {
        _diagCutoutResult(cam, 'late-recovery gave up', { corr });
        return;
      }
      fs.writeFile(filePath, late.crop, (err) => {
        if (err) { console.warn(`  ⚠️  [${cam.camera_id}] late-cutout overwrite failed (corr=${corr}):`, err.message); return; }
        _diagCutoutResult(cam, 'late-recovery RECOVERED', { corr, filePath });
      });
      // Scene recovery (2026-07-21) — same paired-scene rationale as the hit-path
      // fix (5f347d4): if the crop eventually turns up late, its scene is the
      // correct detect-moment frame too, better than the captureFrame() live grab
      // already published for this event. Best-effort, mirrors the crop's
      // overwrite-in-place contract (no DB/MQTT patch needed). Only helps the
      // recoverable share of misses — live-verified 2026-07-21 that some misses
      // never get a snap at all within the 45s window (image part never
      // delivered), which this can't fix either way.
      if (scenePath && late.scene && late.scene.length > 0) {
        try {
          const resized = await sharp(late.scene).rotate()
            .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 }).toBuffer();
          fs.writeFile(scenePath, resized, (err) => {
            if (err) console.warn(`  ⚠️  [${cam.camera_id}] late-scene overwrite failed (corr=${corr}):`, err.message);
          });
        } catch (e) {
          console.warn(`  ⚠️  [${cam.camera_id}] late-scene resize failed (corr=${corr}):`, e?.message || e);
        }
      }
    })
    .catch((e) => console.warn(`  ⚠️  [${cam.camera_id}] late-cutout recovery threw (corr=${corr}):`, e?.message || e));
}

// Diagnostic logger — OFF by default (2026-07-19: confirmed the BigC/ITC431
// late-cutout theory live, 96.7% recovery rate over 13,719 samples spanning
// a full day incl. real lunch-hour peak traffic; no longer need it running).
// Kept in place (not deleted) as a single narrow choke point so it's cheap to
// re-enable for a future investigation — just set DIAG_CUTOUT_ENABLED=1 in
// .env and restart the ingester, no code change needed.
const DIAG_CUTOUT_ENABLED = process.env.DIAG_CUTOUT_ENABLED === '1';
function _diagCutoutResult(cam, outcome, detail) {
  if (!DIAG_CUTOUT_ENABLED) return;
  console.log(`  🔬 DIAG-CUTOUT [${cam.camera_id}] ${outcome}`, JSON.stringify(detail));
}

// multipart/x-mixed-replace parser. Each part:
//   --myboundary\r\n  Content-Type:..  [Content-Length:..]  \r\n  <body>
// Dahua text parts may omit Content-Length → body runs to the next
// boundary. Binary-safe (Buffer).
// ============================================================
const _BOUNDARY = Buffer.from('--myboundary');
const _HDR_END  = Buffer.from('\r\n\r\n');

function processMultipart(device, buf, mode = 'event') {
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
    handlePart(device, headers, buf.slice(bodyStart, bodyEnd), mode);
    offset = bodyEnd;
  }
  return offset > 0 ? buf.slice(offset) : buf;
}

function handlePart(device, headers, body, mode = 'event') {
  const ct = (headers.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1] || '';
  // Confirmed 2026-07-15 (two independent live diagnostics, this NVR/firmware):
  // the eventManager ('event' mode) stream never interleaves a JPEG part for
  // FaceRecognition (0 hits across 10+ live events, first pass), AND the
  // Object.Image/ImageInfo Offset+Length fields inside the JSON do NOT
  // reference bytes appended to this same body either (second pass, live
  // byte-math check: body was ~2KB, the offsets/lengths implied a ~60KB
  // trailing blob that was never there). Those fields describe a position
  // inside the NVR's own internal packed storage file (matches the
  // "<inode>:<length>.jpg" shape of FaceComparision's ObjPath/OriPath) — not
  // something this live CGI stream ever transmits. No embedded face-crop to
  // capture here via either mechanism; snapshot capture stays on
  // captureFrame()/snapManager only.
  if (/image\/jpeg/i.test(ct)) {
    if (mode === 'snap') {
      // FIFO: pair this image with the OLDEST unconsumed text context, not
      // "whatever's there now" — see _snapContexts declaration for why.
      const q = _snapContexts.get(device.key);
      const ctx = (q && q.length) ? q.shift() : {};
      rememberEventSnapshot(device.key, ctx.code, ctx.channel, body, ctx.plateImg, ctx.plate, ctx.oid);
    }
    return;
  }
  const text = body.toString('utf8').trim();
  if (!text || /^Heartbeat$/i.test(text)) return;
  if (mode === 'snap') parseSnapManagerText(device, text);
  else parseDahuaEvent(device, text);
}

function parseSnapManagerText(device, text) {
  const code = parseSnapManagerCode(text);
  const channel = parseSnapManagerIndex(text);
  const plateImg = parsePlateCutout(text);   // camera's own plate crop {off,len} into the next image part
  // Plate text pairs the cutout to its event deterministically (not just by
  // time) so heavy traffic can't hand one car's crop to another's row. Prefer
  // Object.Text — the same field the eventManager event's lpr.plate comes from
  // (parseDahuaTrafficJunction) — so the two strings compare exactly.
  const pm = text.match(/\.Object\.Text=([^\r\n]+)/) || text.match(/\.Plate\.Text=([^\r\n]+)/);
  const plate = pm ? pm[1].trim() : null;
  // ObjectID is the detector's per-detection id, shared with the eventManager
  // event's data.Object.ObjectID — a stable pairing key that (unlike plate text)
  // survives OCR variance on low-quality cams (bigc), while staying unique so it
  // can't swap one vehicle's crop onto another's row.
  const om = text.match(/Events\[\d+\]\.Object\.ObjectID=(\d+)/);
  const oid = om ? om[1] : null;
  if (!code) return;
  // Push onto the FIFO queue (see _snapContexts declaration) instead of
  // overwriting a single slot — each queued context waits for its own image
  // part, in arrival order. Cap + prune stale entries so a text part whose
  // image never shows up (dropped frame, camera hiccup) can't leak forever.
  const q = _snapContexts.get(device.key) || [];
  q.push({ code, channel, plateImg, plate, oid, ts: Date.now() });
  const now = Date.now();
  // Same widened window/cap as _eventSnaps (EVENT_SNAP_WINDOW_MS/MAX_ITEMS) —
  // this queue and that cache are the two halves of the same text/image
  // pairing under burst load; capping them differently would just move the
  // eviction bottleneck from one side to the other.
  _snapContexts.set(device.key, q.filter(x => now - x.ts < EVENT_SNAP_WINDOW_MS).slice(-EVENT_SNAP_MAX_ITEMS));
}

// parseSnapManagerCode, parseSnapManagerIndex — ย้ายไป dahua-protocol.js

// ============================================================
// Dahua event line:  Code=X;action=Start;index=N;data={...json...}
// `index` = the 0-based NVR channel — resolves which of the device's
// configured channels (camera_id) this event belongs to.
// ============================================================
function parseDahuaEvent(device, text) {
  const parsed = parseDahuaEventText(text);
  if (!parsed) return;   // no Code= field (plain Heartbeat body etc.)

  const { code, action, index, mapping, data, dedupKey } = parsed;
  const channel = Number.isInteger(index) ? index : 0;
  const cam = device.channels.get(channel);
  if (!cam) {
    // Event on a channel nobody configured (e.g. a busy NVR has 16
    // channels but only 2 are onboarded) — drop, log once per channel so
    // an operator can see what's available without a log flood.
    const logKey = `${device.key}#${channel}`;
    if (!_unconfiguredChannels.has(logKey)) {
      _unconfiguredChannels.add(logKey);
      console.warn(`  ⚠️  [${device.key}] event on unconfigured channel ${channel} (code=${code}) — ignored`);
    }
    return;
  }

  // Touch last_seen on every Code= chunk so the camera stays "online".
  if (!EDGE_MODE) {
    pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`,
      [cam.camera_id]).catch(() => {});
  }

  if (!mapping) {
    // log-once ต่อ code (วิธีเดียวกับ hikvision 2026-06-11) — subscription
    // มี All อยู่แล้ว: code แปลกหน้า (เช่น HumanTrait ของรุ่น AI 5541)
    // เคยหายเงียบ ทำให้ไม่รู้ว่ากล้องส่งอะไรมาบ้าง (AP.3, 2026-06-12)
    if (code !== 'Heartbeat' && !_unmappedCodes.has(code)) {
      _unmappedCodes.add(code);
      console.warn(`  ⚠️ [${cam.camera_id}] unmapped code "${code}" — ignored (add to DAHUA_EVENT_MAP?)`);
      console.warn(`  ⚠️ sample: ${text.replace(/\s+/g, ' ').slice(0, 1200)}`);
    }
    return;
  }

  if (action && action !== 'Start' && action !== 'Pulse') return;   // drop Stop / repeats

  // Per-channel capture allow-list (2026-07-15 plan). The device
  // subscription is a UNION of every channel's wanted codes, so a
  // channel can still receive codes it didn't opt into — drop those here.
  if (!channelAllowsCode(cam.capture_categories, code)) return;

  // Dedup ระดับ "object รายตัว" — Dahua ยิง Enter/Leave ต่อคน (มี ObjectID).
  // key เดิม (camera|code) เคยกลืน Enter ของคนละคนที่มาห่างกัน <3 วิ →
  // Leave กำพร้า → dwell pairing เพี้ยน (เห็นจริง 2026-06-12, GOTCHAS #86).
  // ObjectID + Direction เข้า key: re-post ของคนเดิมถูกกลืนเหมือนเดิม
  // แต่คนละคน/คนละทิศไม่ชนกันอีก. index อยู่ใน dedupKey แล้ว (dahua-protocol.js)
  // กัน channel คนละตัวชนกันบน device เดียวกัน.
  if (!shouldRecord(cam.camera_id, dedupKey)) return;

  ingestEvent(cam, code, mapping, data);
}

// extractObjectClass — ย้ายไป dahua-protocol.js

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
  // ANPR / TrafficJunction plate parse (2026-07-15). Produces the normalized
  // LPR record; null plate → no license_plates row (treated as a bare event).
  const isAnpr = DAHUA_CATEGORY_CODES.anpr.includes(code);
  const lpr = isAnpr ? parseDahuaTrafficJunction(data, xyzToColorName) : null;
  // object_class derives from the Hikvision vehicle_type vocab the parser now
  // emits (shared VEHICLE_TYPE_TO_CLASS map), falling back to the generic
  // Plate→Vehicle mapping when the category is unknown/unmapped.
  const objectClass = (lpr && VEHICLE_TYPE_TO_CLASS[lpr.vehicleType]) || extractObjectClass(data);
  // Face attribute extraction (2026-07-15 Face system plan) — only for the
  // codes that actually carry a Face object. `faceAttrs.gender`/`.glasses`
  // feed the `appearances` table (same convention Hikvision Face Capture
  // uses); `faceAttrs.raw` is flattened into raw_json below for operator
  // visibility — those raw fields (mask/glass/age) have UNCONFIRMED enum
  // semantics (see dahua-protocol.js extractFaceAttributes doc comment),
  // captured as-is, not translated into Hikvision's raw_json vocabulary.
  const faceAttrs = DAHUA_CATEGORY_CODES.face.includes(code) ? extractFaceAttributes(data) : null;
  // FaceComparision listType (2026-07-15 Face-page integration pass) —
  // faceComparisonListType() mirrors the NVR's own group Similarity config
  // (see dahua-protocol.js doc comment), not an invented cutoff. Sim/CandPath
  // semantics for a real match are still unconfirmed (every sample seen so
  // far is Sim:0, no-match) — this reproduces the NVR's own decision.
  const isBlacklistMatch = code === 'FaceComparision' && faceComparisonListType(data?.Sim) === 'blackList';
  const rawJson = {
    vendor: 'dahua', eventType: code, dahuaCode: code,
    ruleName: data?.Name || null, direction: data?.Direction || null,
    eventId: data?.EventID ?? null, data,
    ...(faceAttrs ? {
      // lowercase to match Hikvision's raw_json convention (routes/faces.js
      // compares gender==='male'/'female') — faceAttrs.gender is 'Male'/
      // 'Female'/null from the Feature-array-derived extraction.
      gender: faceAttrs.gender ? faceAttrs.gender.toLowerCase() : null,
      // glass (2026-07-15 fix, "องค์ประกอบใบหน้า" verification pass): was
      // writing the raw Dahua Glass integer here, but the wear-chip UI
      // (page-face-matches.js _faceCardHtml) compares against Hikvision's
      // 'yes'/'no'/'sunglasses' STRING convention — the integer never
      // matched, so the glasses chip silently never rendered for Dahua.
      // faceAttrs.glasses is the trusted boolean (derived from the Feature
      // text array, cross-checked live against the raw Glass int — they
      // disagreed once, see extractFaceAttributes doc comment) — use that,
      // not the raw int, which stays in raw_json.data for reference only.
      glass: faceAttrs.glasses === true ? 'yes' : faceAttrs.glasses === false ? 'no' : null,
      // mask/beard/hat intentionally NOT mapped to strings yet — enum
      // direction unconfirmed (no ground-truth photo available; face-crop
      // retrieval is blocked, see handlePart() comment above). Raw ints
      // only, collected for future verification, not rendered by the UI.
      mask: faceAttrs.raw.mask, beard: faceAttrs.raw.beard, hat: faceAttrs.raw.hat,
      age: faceAttrs.raw.age, faceExpression: normalizeDahuaEmotion(faceAttrs.raw.emotion),
    } : {}),
    ...(isAnpr && lpr ? {
      // ANPR fields the LPR page reads from raw_json (the license_plates
      // columns cover region/vehicle_type/color/brand + plate_image; these
      // are the raw_json-only ones page-lpr/page-snapshots fall back to:
      // plateColor, confidence(%), direction, laneNo, plus vehicle* as a
      // fallback if the license_plates JOIN is ever absent).
      plate: lpr.plate, confidence: lpr.confidence, region: lpr.region,
      vehicleType: lpr.vehicleType, vehicleColor: lpr.vehicleColor,
      vehicleBrand: lpr.vehicleBrand, plateColor: lpr.plateColor,
      direction: lpr.direction, laneNo: lpr.laneNo, speed: lpr.speed,
      // NonMotor-only (ITC431); null on car/Pickup events and on ITC237.
      helmet: lpr.helmet, nonMotorManned: lpr.nonMotorManned, riderCount: lpr.riderCount,
    } : {}),
    ...(code === 'FaceComparision' ? {
      // similarity as a 0-1 float (Hikvision's scale — routes/faces.js
      // compares against face_similarity_min/100.0), not Dahua's raw 0-100 Sim.
      similarity: Number.isFinite(data?.Sim) ? data.Sim / 100 : null,
      listType: isBlacklistMatch ? 'blackList' : null,
      // fdLibName = the matched enrolled GROUP name (Hikvision parity: its
      // FDLibName comes from a per-match Candidate struct). This NVR has 4
      // groups — "High Risk Person" 866 + "Blacklist Person" 418 enrolled,
      // plus 2 empty — so the earlier single hardcode was wrong. On a real
      // Sim>=70 match the group name lives in data.Candidates[] (null in every
      // no-match sample seen so far — all Sim:0), whose exact field name is
      // unverified until a real match is captured. Left null until then rather
      // than guessed — the Face-page badge falls back to a generic "blackList"
      // label. NOTE: data.ChName is the CHANNEL/gate name ("โลตัส Face_ขาเข้า/
      // ขาออก"), NOT the group — kept below as `gate`, not as the group.
      fdLibName: null,
      gate: data?.ChName ?? null,
      candidatePath: data?.CandPath ?? null,
      // Reference photo: when a real match occurs (Sim>=70) CandPath should
      // carry the enrolled library photo's storage path — fetchable via the
      // same RPC stored-file mechanism as ObjPath/OriPath (see EDGE_MODE
      // branch below, previewLib). Every live sample so far is Sim:0 with
      // CandPath:null, so the match path is still unverified — mqtt-subscriber
      // overrides this null with _preview_lib when the fetch succeeds.
      _snapshot_ref: null,
    } : {}),
  };
  // Zone Enter/Leave → event_state true/false ให้ตรง convention ของ Bosch
  // IsInside (Ph.2, 2026-06-10): ปลดล็อก dwell pairing + Leave ถูกซ่อนจาก
  // Events list แบบเดียวกับ Bosch leave events. Direction อื่น (เช่น
  // LeftToRight ของ line crossing) คงเป็น 'true' ตามเดิม.
  const dir = data?.Direction;
  const eventState = dir === 'Enter' ? 'true' : dir === 'Leave' ? 'false' : 'true';

  if (EDGE_MODE) {
    const corr = newCorrId();
    // Stamp event_time BEFORE the snapshot capture below — it used to be
    // stamped after, so a slow/timing-out captureFrame() pushed event_time
    // up to ~10s past the actual detection (2026-07-15 finding: the
    // Recognized/Comparision twin pair, fired ~9ms apart by the NVR, landed
    // in the DB ~10s apart because only the Recognized twin waited out a
    // 10s capture timeout). event_time should reflect when the event
    // arrived, not how long its snapshot took.
    const eventTimeIso = new Date().toISOString();
    let previewRef = null;
    let previewFull = null;
    let previewLib = null;
    let plateImageRef = null;   // ANPR plate crop (license_plates.plate_image)
    let previewSource = 'dahua-cgi-live';
    // ANPR plate crop: prefer the camera's OWN cutout from the snapManager
    // stream (detect-moment, clean on every model — see takeEventPlateCutout).
    // Started here so it races the scene capture below; awaited in the crop
    // block. Falls back to the fixed-region crop when absent. Scene snapshot is
    // unchanged (still captureFrame) — narrow scope, 2026-07-17.
    const plateCutoutSinceMs = Date.now();
    const plateCutoutOid = data && data.Object && data.Object.ObjectID;
    const plateCutoutP = isAnpr ? takeEventPlateCutout(cam, code, plateCutoutSinceMs, lpr && lpr.plate, plateCutoutOid) : null;
    try {
      // Preferred source (2026-07-15, RPC stored-file breakthrough):
      // FaceComparision events carry the NVR's OWN already-stored images —
      // ObjPath = face crop, OriPath = full scene at detection time. Fetching
      // those (dahua-rpc.js) sidesteps snapshot.cgi entirely, which stalls
      // for minutes under AI load (root cause of the ~40-50% missing-image
      // rate measured today). Crop becomes _snapshot (Hikvision face-page
      // convention: crop is the primary image), scene becomes _snapshot_full.
      if (code === 'FaceComparision' && (data?.ObjPath || data?.OriPath)) {
        const tsMs = Date.now();
        const { dir: evDir, relBase: evBase } = snapPath(SNAPSHOT_DIR, 'events', cam.camera_id, tsMs);
        const [cropBuf, sceneBuf, libBuf] = await Promise.all([
          data?.ObjPath ? fetchStoredFile(cam, data.ObjPath) : null,
          data?.OriPath ? fetchStoredFile(cam, data.OriPath) : null,
          // CandPath = the enrolled reference photo of the matched library
          // person — only non-null on a real match (Sim>=70, never observed
          // live yet); harmless no-op otherwise.
          data?.CandPath ? fetchStoredFile(cam, data.CandPath) : null,
        ]);
        if (libBuf) {
          const fn = `${corr}_${tsMs}_ref.jpg`;
          fs.writeFileSync(path.join(evDir, fn), libBuf);
          previewLib = `${evBase}/${fn}`;
        }
        if (sceneBuf) {
          const fn = `${corr}_${tsMs}_full.jpg`;
          fs.writeFileSync(path.join(evDir, fn), sceneBuf);
          previewFull = `${evBase}/${fn}`;
        }
        if (cropBuf) {
          const fn = `${corr}_${tsMs}.jpg`;
          fs.writeFileSync(path.join(evDir, fn), cropBuf);
          previewRef = `${evBase}/${fn}`;
        } else if (sceneBuf) {
          previewRef = previewFull;   // crop failed but scene worked — still an image
          previewFull = null;
        }
        if (previewRef) previewSource = 'dahua-nvr-stored';
      }
      // Fallback / non-FaceComparision events: live CGI grab as before.
      if (!previewRef) {
        let frame = await captureFrame(cam);
        if (frame && frame.length > 0) {
          const tsMs = Date.now();
          const { dir: evDir, relBase: evBase } = snapPath(SNAPSHOT_DIR, 'events', cam.camera_id, tsMs);
          // ANPR plate crop. Preferred: the camera's OWN cutout from the
          // snapManager stream (plateCutoutP) — a clean detect-moment plate on
          // every model. Fallback: the fixed top-left region of the composite
          // snapshot.cgi frame (1920x1144 ITC cams burn their cutout there; on
          // native 4MP cams this hits empty road, hence the cutout is preferred
          // — 2026-07-17). Done BEFORE the scene resize so the fallback crop is
          // from the full-res frame.
          if (isAnpr) {
            try {
              // Cutout-first for every ANPR camera (2026-07-20 — see
              // ANPR_PLATE_CROP_MIN_WIDTH above for the full root-cause
              // writeup). The camera's-own-cutout comes from the snapManager
              // stream, per-event OID-matched — it never touches the shared
              // scene buffer captureFrame() returns, so it's unaffected by
              // _inflightCapture's per-camera_id coalescing.
              const cutout = plateCutoutP ? await plateCutoutP : null;
              const usedRealCutout = !!(cutout && cutout.crop && cutout.crop.length > 0);
              let crop = null;
              if (usedRealCutout) {
                crop = cutout.crop;
                if (cutout.scene && cutout.scene.length > 0) {
                  // Paired scene (2026-07-20) — same matched snap as the crop
                  // above (one search, both buffers), so it can't drift under
                  // traffic the way captureFrame()'s independent live grab
                  // can. Replaces `frame` before the resize below so it still
                  // goes through the normal rotate/resize/quality pipeline.
                  frame = cutout.scene;
                }
              } else {
                // Cutout missed — whether the fixed-pixel fallback is even
                // usable depends on camera geometry, not crop pixel content
                // (see ANPR_PLATE_CROP_MIN_WIDTH doc comment: pixel-content
                // validation was tried and disproven live). Read the frame's
                // NATIVE width — this MUST happen before the scene resize
                // below, or it reads the resized/capped size instead.
                const frameMeta = await sharp(frame).metadata();
                const nativeWidth = frameMeta.width || 0;
                if (nativeWidth > 0 && nativeWidth < ANPR_PLATE_CROP_MIN_WIDTH) {
                  crop = await sharp(frame)
                    .extract({ left: ANPR_PLATE_CROP.x, top: ANPR_PLATE_CROP.y, width: ANPR_PLATE_CROP.w, height: ANPR_PLATE_CROP.h })
                    .jpeg().toBuffer();
                }
                // else: wide camera (≥ANPR_PLATE_CROP_MIN_WIDTH) — the fixed
                // region is background there, always. Leave crop null rather
                // than write a guaranteed-junk one ("no image" do-regardless
                // safety net, 2026-07-20).
              }
              if (crop && crop.length > 0) {
                const pfn = `${corr}_${tsMs}_plate.jpg`;
                const pfullPath = path.join(evDir, pfn);
                fs.writeFileSync(pfullPath, crop);
                plateImageRef = `${evBase}/${pfn}`;
              }
              // Late-cutout recovery (2026-07-19) — whenever cutout missed
              // (fixed-pixel written, or nothing written at all on a wide
              // camera) AND a plate was actually read (nothing to recover
              // for a genuinely unreadable plate). Fire-and-forget: does not
              // delay this event's publish below.
              if (!usedRealCutout && lpr && lpr.plate) {
                const recoveryPath = plateImageRef
                  ? path.join(evDir, path.basename(plateImageRef))
                  : path.join(evDir, `${corr}_${tsMs}_plate.jpg`);
                // Scene will be written below as `${corr}_${tsMs}.jpg` (same evDir) —
                // predictable ahead of time since tsMs/corr are already fixed here.
                const scenePath = path.join(evDir, `${corr}_${tsMs}.jpg`);
                scheduleLateCutoutRecovery(cam, code, plateCutoutSinceMs, lpr.plate, plateCutoutOid, recoveryPath, corr, scenePath);
                // Nothing written yet (wide camera, no fixed-pixel fallback)
                // — point plateImageRef at the recovery path anyway so a
                // later successful recovery has somewhere to write and the
                // DB row already carries the reference (mirrors the
                // pre-existing "recovery overwrites the published file in
                // place" contract; RF4 in the dashboard already renders a
                // fallback icon for a plate_image that 404s, so this is safe
                // even if recovery never lands).
                if (!plateImageRef) plateImageRef = `${evBase}/${path.basename(recoveryPath)}`;
              }
            } catch (e) {
              console.warn(`  ⚠️  [${cam.camera_id}] plate crop failed (corr=${corr}):`, e?.message || e);
            }
            // Scene resize on ingest — parity in spirit with Hikvision LPR
            // (which resizes to 1080p q80). A FIXED 1080p is used here, not the
            // central lpr_scene_resolution setting resizeScene() reads: this
            // ingester runs on the edge, which has no local DB to read that
            // setting from (see "no local DB on edge" above). Display sizing
            // still matches Hikvision via the serve-time ?w= resize the page
            // already uses. Keep original on any failure.
            try {
              frame = await sharp(frame).rotate()
                .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 }).toBuffer();
            } catch { /* keep original */ }
          }
          const fn = `${corr}_${tsMs}.jpg`;
          fs.writeFileSync(path.join(evDir, fn), frame);
          previewRef = `${evBase}/${fn}`;   // scene = event snapshot (Hikvision LPR convention)
        } else {
          // captureFrame() resolves null on 401/non-200/timeout/network error —
          // this was previously silent (2026-07-15 finding: "some photos missing"
          // with no way to tell why).
          console.warn(`  ⚠️  [${cam.camera_id}] captureFrame returned no frame (corr=${corr}) — event will have no snapshot`);
        }
      }
    } catch (e) {
      previewRef = null;
      previewFull = null;
      previewLib = null;
      plateImageRef = null;
      console.warn(`  ⚠️  [${cam.camera_id}] snapshot capture threw (corr=${corr}):`, e?.message || e);
    }
    // Same guard Hikvision's edge face path uses — only worth an appearances
    // row when we actually derived something (dahua-cgi.js central path
    // mirrors this same condition below).
    const appearance = (faceAttrs && (faceAttrs.gender || faceAttrs.glasses))
      ? { object_class: 'Person', confidence: faceAttrs.confidence, gender: faceAttrs.gender, glasses: faceAttrs.glasses }
      : null;
    publishEdgeEvent({
      vendor: 'dahua', corr, previewRef, previewFull, previewLib, previewSource,
      event: {
        camera_id: cam.camera_id, event_category: 'RuleEngine',
        event_type: mapping.event_type, rule_name: mapping.rule_name,
        object_id: null, object_class: objectClass, likelihood: null,
        event_state: eventState, raw_json: rawJson, event_time: eventTimeIso,
      },
      appearance,
      // ANPR → license_plates row (columns match mqtt-subscriber's edge INSERT
      // 1:1). plate_image is the cropped plate (may be null → page falls back
      // to the scene snapshot). Only sent when a plate was actually parsed.
      licensePlate: (isAnpr && lpr) ? {
        plate_number: lpr.plate, confidence: lpr.confidence,
        country: lpr.country, region: lpr.region,
        vehicle_type: lpr.vehicleType, vehicle_color: lpr.vehicleColor,
        vehicle_brand: lpr.vehicleBrand, plate_type: lpr.plateType,
        bbox_x: lpr.bbox?.x ?? null, bbox_y: lpr.bbox?.y ?? null,
        bbox_width: lpr.bbox?.width ?? null, bbox_height: lpr.bbox?.height ?? null,
        plate_image: plateImageRef,
      } : null,
      alert: {
        camera_name: cam.camera_name || cam.camera_id, location: cam.location || null,
        rule_name: mapping.rule_name, event_type: mapping.event_type,
        object_class: objectClass, likelihood: null, event_time: eventTimeIso,
      },
      clip: { camera_id: cam.camera_id, event_time: eventTimeIso, received_at_ms: Date.now() },
    });
    console.log(`  ✅ [${cam.camera_id}] ${mapping.rule_name}`
      + (objectClass ? ` (${objectClass})` : '') + ` → edge${previewRef ? ` 📸 ${previewRef}` : ''}`);
    return;
  }

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

  // Face attributes → appearances table (2026-07-15 Face system plan).
  // Same guard, columns, and normalization as Hikvision Face Capture/
  // Recognition (hikvision-isapi.js) — gender 'Male'/'Female', boolean
  // glasses. Fire-and-forget, mirrors the pg_notify calls below.
  if (faceAttrs && (faceAttrs.gender || faceAttrs.glasses)) {
    pool.query(
      `INSERT INTO appearances (event_id, camera_id, object_class, confidence, gender, glasses)
       VALUES ($1,$2,'Person',$3,$4,$5)`,
      [eventId, cam.camera_id, faceAttrs.confidence, faceAttrs.gender, faceAttrs.glasses]
    ).catch(err => console.error(`  🙂 appearances insert [${cam.camera_id}]:`, err.message));
  }

  // ANPR → license_plates table (2026-07-15). Central-direct Dahua ANPR cams
  // reach this non-EDGE path; parity with the EDGE licensePlate publish above
  // and with Hikvision's non-EDGE license_plates insert (lpr-core.js). No
  // plate crop here (that's an edge/disk concern) — plate_image left null,
  // scene snapshot handled by the snapshot pipeline below like other events.
  if (isAnpr && lpr) {
    pool.query(
      `INSERT INTO license_plates
         (event_id, camera_id, plate_number, confidence, country, region,
          vehicle_type, vehicle_color, vehicle_brand, plate_type,
          bbox_x, bbox_y, bbox_width, bbox_height, plate_image,
          plate_color, no_helmet, rider_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,$17)`,
      [eventId, cam.camera_id, lpr.plate, lpr.confidence, lpr.country, lpr.region,
       lpr.vehicleType, lpr.vehicleColor, lpr.vehicleBrand, lpr.plateType,
       lpr.bbox?.x ?? null, lpr.bbox?.y ?? null, lpr.bbox?.width ?? null, lpr.bbox?.height ?? null,
       // #085/#090 perf — plateColor/helmet/riderCount feed raw_json here too.
       // helmet/riderCount are NonMotor-only (ITC431 motorcycles) — null on
       // car/Pickup events and on ITC237, not asserted false/0 from silence.
       lpr.plateColor ?? null, lpr.helmet === 'no', lpr.riderCount ?? null]
    ).catch(err => console.error(`  🚗 license_plates insert [${cam.camera_id}]:`, err.message));
    // #089 perf — denormalize onto events so stats.js can filter without joining license_plates
    if (lpr.vehicleType) {
      pool.query(`UPDATE events SET vehicle_type = $1 WHERE id = $2`, [lpr.vehicleType, eventId])
        .catch(err => console.error(`  🚗 events.vehicle_type update [${cam.camera_id}]:`, err.message));
    }
  }

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
  let frame = await waitForEventSnapshot(cam, code, snapshotStartMs);
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
    const scan = await extractScanFrameFromBuffer(cam.camera_id, snapshotStartMs, data);
    frame = scan.frame;
    snapshotDebug = { ...snapshotDebug, ...(scan.debug || {}) };
    snapSource = 'dahua-rtsp-buffer-scan';
    if (frame) {
      snapshotStatus = 'low_confidence';
      snapshotDebug.low_confidence = true;
      snapshotDebug.low_confidence_reason = 'scan_fallback_no_burst_candidates';
    }
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
    // Publish to central via NanoMQ → bridge; saveEdgeSnapshot handles save + DB update
    _snapMqtt.publish(
      `${cam.camera_id}/onvif-ej/Device/snapshot`,
      JSON.stringify({
        ts:       new Date().toISOString(),
        data:     frame.toString('base64'),
        event_id: eventId,
        source:   snapSource,
        debug:    { ...snapshotDebug, _snapshot_status: snapshotStatus },
      }),
      { qos: 0 }
    );
    console.log(`  📸 [${cam.camera_id}] snapshot → MQTT (${(frame.length / 1024).toFixed(0)}KB, ${snapSource})`);
  } else {
    snapshotStatus = 'missing';
    await pool.query(`UPDATE events SET raw_json = raw_json || $1::jsonb WHERE id=$2`,
      [JSON.stringify({
        _snapshot_status: snapshotStatus,
        _snapshot_debug: { ...snapshotDebug, failed: true },
      }), eventId]).catch(() => {});
  }
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
  const status = clipDebug.low_confidence ? 'low_confidence' : 'ok';
  _snapMqtt.publish(
    `${camera_id}/onvif-ej/Device/snapshot`,
    JSON.stringify({
      ts:       new Date().toISOString(),
      data:     best.frame.toString('base64'),
      event_id: eventId,
      source:   'dahua-clip-resolver',
      debug:    { ...clipDebug, _snapshot_status: status },
    }),
    { qos: 0 }
  );
  pool.query(`SELECT pg_notify('new_event', $1)`, [String(eventId)]).catch(() => {});
  console.log(`  🎞️  [${camera_id}] clip snapshot → MQTT (${(best.frame.length / 1024).toFixed(0)}KB, ${status})`);
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
// Device grouping (2026-07-15 multi-channel NVR plan). Config entries
// that share a connection identity (deviceKey — explicit `device_id`, or
// ip:port:user when absent) are ONE physical device: one eventManager +
// one snapManager stream total, regardless of how many channels it has.
// `device.repCam` (lowest nvr_channel) supplies the shared connection
// fields (ip/port/creds/transport); per-event routing always resolves
// the CHANNEL's own cam via device.channels.get(index).
// ============================================================
function groupByDevice(cams) {
  const devices = new Map();
  for (const cam of cams) {
    const key = deviceKey(cam);
    let device = devices.get(key);
    if (!device) {
      device = { key, repCam: cam, channels: new Map() };
      devices.set(key, device);
    }
    device.channels.set(cam.nvr_channel, cam);
    if (cam.nvr_channel < device.repCam.nvr_channel) device.repCam = cam;
  }
  return devices;
}

// Device-wide eventManager/snapManager subscription = union of every
// channel's wanted codes (per-channel capture_categories allow-list).
// A channel with no capture_categories wants everything mapped, so a
// device with any such channel subscribes to everything — correct, since
// codesForCategories(null) already returns the full DAHUA_EVENT_MAP key set.
function deviceSubscriptionCodes(device) {
  const set = new Set();
  for (const cam of device.channels.values()) {
    for (const code of codesForCategories(cam.capture_categories)) set.add(code);
  }
  return [...set];
}

// ============================================================
// Per-device connection. Transport selectable via repCam.dahua_transport
// (default 'eventManager') — only eventManager is wired today.
// ============================================================
function connectDevice(device) {
  if (_destroyed.has(device.key)) return;
  _devices.set(device.key, device);
  for (const cam of device.channels.values()) _activeCams.set(cam.camera_id, cam);
  connectSnapManager(device);
  const repCam = device.repCam;
  const transport = String(repCam.dahua_transport || 'eventManager').toLowerCase();
  if (transport !== 'eventmanager') {
    console.warn(`  ⚠️  [${device.key}] dahua_transport="${transport}" not implemented — using eventManager`);
  }
  const port = repCam.http_port || repCam.port || 80;
  // Subscription = union of all this device's channels' wanted codes.
  const codes = deviceSubscriptionCodes(device);
  const uri    = '/cgi-bin/eventManager.cgi?action=attach&heartbeat=30&codes='
    + `[${codes.join(',')}]`;
  const method = 'GET';

  const doRequest = (authHeader) => {
    const headers = { Accept: '*/*' };
    if (authHeader) headers.Authorization = authHeader;
    const req = http.request(
      { host: repCam.ip_address, port, path: uri, method, headers, timeout: 0 },
      (res) => {
        if (res.statusCode === 401) {
          const wa = res.headers['www-authenticate'];
          if (!wa || !/digest/i.test(wa)) {
            console.error(`  ❌ [${device.key}] 401 without Digest challenge`);
            res.resume();
            upsertDeviceStatus(device, { event_stream: 'reconnecting', last_event_http_status: 401 });
            return scheduleReconnect(device);
          }
          res.resume();
          return doRequest(buildDigestHeader(
            repCam.username, repCam.password, method, uri, parseChallenge(wa)));
        }
        if (res.statusCode !== 200) {
          console.error(`  ❌ [${device.key}] HTTP ${res.statusCode}`);
          res.resume();
          upsertDeviceStatus(device, { event_stream: 'reconnecting', last_event_http_status: res.statusCode });
          return scheduleReconnect(device);
        }
        console.log(`  📡 [${device.key}] event stream connected (${repCam.ip_address}:${port}, `
          + `${device.channels.size} channel(s), ${codes.length} code(s))`);
        upsertDeviceStatus(device, { event_stream: 'connected', retry_count: 0, last_error_code: null });
        _retryCount.delete(device.key);
        let buffer = Buffer.alloc(0);
        res.on('data', (chunk) => {
          buffer = processMultipart(device, Buffer.concat([buffer, chunk]), 'event');
          if (buffer.length > 4 * 1024 * 1024) buffer = buffer.slice(-1024 * 1024);
        });
        res.on('end',   () => { console.warn(`  ⚠️  [${device.key}] stream ended`); upsertDeviceStatus(device, { event_stream: 'reconnecting' }); scheduleReconnect(device); });
        res.on('error', (e) => { console.error(`  ❌ [${device.key}] stream:`, e.message); upsertDeviceStatus(device, { event_stream: 'reconnecting', last_error_code: e.code || null }); scheduleReconnect(device); });
      }
    );
    _eventReqs.set(device.key, req);
    req.on('error', (e) => {
      if (_eventReqs.get(device.key) === req) _eventReqs.delete(device.key);
      console.error(`  ❌ [${device.key}] request:`, e.message);
      upsertDeviceStatus(device, { event_stream: 'reconnecting', last_error_code: e.code || null });
      scheduleReconnect(device, e.code);
    });
    req.end();
  };
  doRequest(null);
}

function connectSnapManager(device) {
  if (_destroyed.has(device.key)) return;
  // Skip the shared snapshot stream only if EVERY channel opted out —
  // if even one channel wants event-JPEG snapshots, the device needs it.
  const wantsSnap = [...device.channels.values()].some(c => c.dahua_event_snapshot !== false);
  if (!wantsSnap) return;
  if (_snapDisabled.has(device.key)) return;
  if (_snapActive.has(device.key)) return;
  _snapActive.add(device.key);
  const repCam = device.repCam;
  const port = repCam.http_port || repCam.port || 80;
  // Filter to snapManager-safe codes (see SNAP_SAFE_CODES) — the full set breaks
  // the stream on some firmware. No safe codes (e.g. a face-only device) → skip;
  // face capture doesn't use snapManager.
  const codes = deviceSubscriptionCodes(device).filter(c => SNAP_SAFE_CODES.has(c));
  if (!codes.length) { _snapActive.delete(device.key); return; }
  // No `&channel=` filter — subscribes across the whole device; each
  // channel's JPEG is tagged via parseSnapManagerIndex() on arrival.
  const uri = '/cgi-bin/snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events=['
    + codes.join('%2C')
    + ']&heartbeat=5';
  const method = 'GET';

  const doRequest = (authHeader) => {
    const headers = { Accept: '*/*' };
    if (authHeader) headers.Authorization = authHeader;
    const req = http.request(
      { host: repCam.ip_address, port, path: uri, method, headers, timeout: 0, insecureHTTPParser: true },
      (res) => {
        if (res.statusCode === 401) {
          const wa = res.headers['www-authenticate'];
          if (!wa || !/digest/i.test(wa)) {
            console.warn(`  ⚠️  [${device.key}] snapManager 401 without Digest challenge`);
            res.resume();
            _snapActive.delete(device.key);
            upsertDeviceStatus(device, { snap_stream: 'reconnecting', last_snap_http_status: 401 });
            return scheduleSnapReconnect(device);
          }
          res.resume();
          return doRequest(buildDigestHeader(
            repCam.username, repCam.password, method, uri, parseChallenge(wa)));
        }
        if (res.statusCode !== 200) {
          console.warn(`  ⚠️  [${device.key}] snapManager HTTP ${res.statusCode}`);
          res.resume();
          _snapActive.delete(device.key);
          if ([400, 404, 405].includes(res.statusCode)) {
            _snapDisabled.add(device.key);
            console.warn(`  ℹ️  [${device.key}] snapManager unsupported — using RTSP/live fallback`);
            upsertDeviceStatus(device, { snap_stream: 'disabled', last_snap_http_status: res.statusCode });
            return;
          }
          upsertDeviceStatus(device, { snap_stream: 'reconnecting', last_snap_http_status: res.statusCode });
          return scheduleSnapReconnect(device);
        }
        _snapConnected.add(device.key);
        _snapLastData.set(device.key, Date.now());   // seed for the zombie watchdog
        _snapRetryCount.delete(device.key);
        console.log(`  📸 [${device.key}] snapManager event snapshot stream connected`);
        upsertDeviceStatus(device, { snap_stream: 'connected' });
        let buffer = Buffer.alloc(0);
        res.on('data', (chunk) => {
          _snapLastData.set(device.key, Date.now());   // watchdog: liveness (incl. heartbeats)
          buffer = processMultipart(device, Buffer.concat([buffer, chunk]), 'snap');
          if (buffer.length > 8 * 1024 * 1024) {
            // Diagnostic (2026-07-21) — this silently discarded everything but the
            // last 2MB before, with no trace. Investigating whether this safety
            // valve is the source of the "image part never arrives" misses found
            // live today (48/48 sampled "gave up" cases had no plateImg candidate
            // ever appear) — a stuck/slow-to-complete part here would block
            // processMultipart from consuming anything queued behind it, and once
            // buffer.length crosses 8MB every unparsed part in it (stuck one
            // included) is dropped with zero visibility. Read-only otherwise —
            // same truncation as before, just no longer silent.
            console.warn(`  ⚠️  [${device.key}] snapManager buffer overflow — dropping ${(buffer.length - 2 * 1024 * 1024)} bytes unparsed (bufLen=${buffer.length})`);
            buffer = buffer.slice(-2 * 1024 * 1024);
          }
        });
        const done = (msg) => {
          if (msg) console.warn(`  ⚠️  [${device.key}] snapManager ${msg}`);
          _snapConnected.delete(device.key);
          _snapLastData.delete(device.key);
          _snapActive.delete(device.key);
          upsertDeviceStatus(device, { snap_stream: 'reconnecting' });
          scheduleSnapReconnect(device);
        };
        res.on('end', () => done('stream ended'));
        res.on('error', (e) => done(`stream: ${e.message}`));
      }
    );
    _snapReqs.set(device.key, req);
    req.on('error', (e) => {
      if (_snapReqs.get(device.key) === req) _snapReqs.delete(device.key);
      console.warn(`  ⚠️  [${device.key}] snapManager request: ${e.message}`);
      clearSnapState(device.key);
      if (e.code === 'HPE_INVALID_HEADER_TOKEN' || /Invalid header token|Parse Error/i.test(e.message || '')) {
        _snapDisabled.add(device.key);
        console.warn(`  ℹ️  [${device.key}] snapManager parser rejected stream — using RTSP/live fallback`);
        upsertDeviceStatus(device, { snap_stream: 'disabled', last_error_code: e.code || null });
        return;
      }
      upsertDeviceStatus(device, { snap_stream: 'reconnecting', last_error_code: e.code || null });
      scheduleSnapReconnect(device, e.code);
    });
    req.end();
  };
  doRequest(null);
}

const _reconnectTimers = new Map();       // deviceKey → timer
const _snapReconnectTimers = new Map();   // deviceKey → timer
const _devices          = new Map();      // deviceKey → { key, repCam, channels } — active/connecting devices
const _activeCams       = new Map();      // camera_id → cam (per-channel; mirrors connected devices' channels)
const _snapActive       = new Set();      // deviceKey
const _eventReqs        = new Map();      // deviceKey → current eventManager request
const _snapReqs         = new Map();      // deviceKey → current snapManager request
const _destroyed        = new Set();      // deviceKeys that must not reconnect (hot-removed)
const _retryCount       = new Map();      // deviceKey → consecutive EHOSTUNREACH count (event stream backoff)
const _snapRetryCount   = new Map();      // deviceKey → consecutive EHOSTUNREACH count (snap stream backoff)
const _snapLastData     = new Map();      // deviceKey → ts of last byte on the snap stream (zombie watchdog)
let _clipDoneClient     = null;

// Zombie-snap watchdog. `heartbeat=5` makes a healthy attachFileProc stream
// deliver a byte at least every ~5s, so a connected stream that goes silent for
// SNAP_STALE_MS has died without a TCP FIN — Node never fires 'end', so it sits
// in _snapConnected forever delivering nothing (live incident 2026-07-17:
// anpr-bigc1's persistent stream connected once then delivered 0 frames while
// fresh probes worked). Force a reconnect; the req's own error handler does the
// rest. unref() so this timer never keeps the process alive on its own.
const SNAP_STALE_MS = 20000;
setInterval(() => {
  const now = Date.now();
  for (const key of _snapConnected) {
    if (now - (_snapLastData.get(key) || 0) > SNAP_STALE_MS) {
      console.warn(`  ⚠️  [${key}] snapManager stale >${SNAP_STALE_MS / 1000}s — forcing reconnect`);
      const req = _snapReqs.get(key);
      if (req) req.destroy(new Error('snap stale watchdog'));
    }
  }
}, 10000).unref();

// Device-level signature: connection identity + every channel's routing
// and filter fields. ANY change here (a channel added/removed, a
// capture_categories tweak, a snapshot_path edit, new creds, ...)
// reconnects the ONE shared stream for the whole device — a single
// blip, not per-channel churn (this is what keeps the live NVR at a
// fixed 2 sessions regardless of how many channels are configured).
function deviceConfigSignature(device) {
  const repCam = device.repCam;
  const channels = [...device.channels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ch, cam]) => ({
      ch,
      camera_id: cam.camera_id,
      capture_categories: Array.isArray(cam.capture_categories)
        ? [...cam.capture_categories].sort() : null,
      snapshot_path: cam.snapshot_path || '',
      dahua_event_snapshot: cam.dahua_event_snapshot !== false,
      dahua_snapshot_lookback_ms: Number(cam.dahua_snapshot_lookback_ms),
      dahua_server_frame_offsets_ms: Array.isArray(cam.dahua_server_frame_offsets_ms)
        ? cam.dahua_server_frame_offsets_ms.map(Number).filter(Number.isFinite)
        : null,
    }));
  return JSON.stringify({
    ip_address: repCam.ip_address || '',
    username: repCam.username || '',
    password: repCam.password || '',
    http_port: repCam.http_port || repCam.port || 80,
    dahua_transport: String(repCam.dahua_transport || 'eventManager').toLowerCase(),
    channels,
  });
}

function stopDeviceConnection(key) {
  _destroyed.add(key);
  const device = _devices.get(key);
  _devices.delete(key);
  if (device) {
    for (const cam of device.channels.values()) _activeCams.delete(cam.camera_id);
  }
  clearTimeout(_reconnectTimers.get(key));
  _reconnectTimers.delete(key);
  clearTimeout(_snapReconnectTimers.get(key));
  _snapReconnectTimers.delete(key);
  _retryCount.delete(key);
  _snapRetryCount.delete(key);
  const eventReq = _eventReqs.get(key);
  if (eventReq) {
    try { eventReq.destroy(); } catch { /* ignore */ }
    _eventReqs.delete(key);
  }
  const snapReq = _snapReqs.get(key);
  if (snapReq) {
    try { snapReq.destroy(); } catch { /* ignore */ }
    _snapReqs.delete(key);
  }
  clearSnapState(key);
}

function scheduleReconnect(device, errCode = null) {
  if (_destroyed.has(device.key)) return;
  if (_reconnectTimers.has(device.key)) return;
  let delay;
  if (UNREACHABLE_CODES.has(errCode)) {
    const retries = _retryCount.get(device.key) || 0;
    delay = Math.min(RECONNECT_BASE_MS * (2 ** retries), RECONNECT_MAX_MS);
    _retryCount.set(device.key, retries + 1);
    upsertDeviceStatus(device, { retry_count: retries + 1, last_error_code: errCode });
  } else {
    delay = RECONNECT_BASE_MS;
    _retryCount.delete(device.key);
  }
  const t = setTimeout(() => {
    _reconnectTimers.delete(device.key);
    connectDevice(device);
  }, delay);
  _reconnectTimers.set(device.key, t);
}

function scheduleSnapReconnect(device, errCode = null) {
  if (_destroyed.has(device.key)) return;
  if (_snapReconnectTimers.has(device.key)) return;
  let delay;
  if (UNREACHABLE_CODES.has(errCode)) {
    const retries = _snapRetryCount.get(device.key) || 0;
    delay = Math.min(RECONNECT_BASE_MS * (2 ** retries), RECONNECT_MAX_MS);
    _snapRetryCount.set(device.key, retries + 1);
  } else {
    delay = RECONNECT_BASE_MS;
    _snapRetryCount.delete(device.key);
  }
  const t = setTimeout(() => {
    _snapReconnectTimers.delete(device.key);
    connectSnapManager(device);
  }, delay);
  _snapReconnectTimers.set(device.key, t);
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
      .map(decryptCamCreds)
      // Normalize nvr_channel so every downstream Map/lookup can rely on
      // it being an integer. Entries with no nvr_channel are plain
      // single-channel cameras → channel 0, own device group of one —
      // today's (pre-NVR) behavior, unchanged.
      .map(c => ({ ...c, nvr_channel: Number.isInteger(c.nvr_channel) ? c.nvr_channel : 0 }));
  } catch (e) {
    console.error('❌ Cannot read cameras-config.json:', e.message);
    return [];
  }
}

// Diff the new device topology against _devices: connect new devices,
// stop removed ones, reconnect devices whose signature changed (identity,
// channel set, or any channel's routing/filter fields).
function syncCameras() {
  const newCams = loadDahuaCameras();
  const newDevices = groupByDevice(newCams.filter(c => c.ip_address && c.username && c.password));

  for (const [key, device] of newDevices) {
    const prev = _devices.get(key);
    const changed = prev && deviceConfigSignature(prev) !== deviceConfigSignature(device);
    if (changed) {
      console.log(`  🔄 [${key}] config changed — reconnecting device (${device.channels.size} channel(s))`);
      stopDeviceConnection(key);
      _snapDisabled.delete(key);
      setTimeout(() => { _destroyed.delete(key); connectDevice(device); }, RECONNECT_BASE_MS);
    } else if (!prev) {
      console.log(`  ➕ [${key}] new device (${device.channels.size} channel(s)) — connecting`);
      connectDevice(device);
    }
  }

  for (const [key] of _devices) {
    if (!newDevices.has(key)) {
      console.log(`  ➖ [${key}] removed from config — stopping`);
      stopDeviceConnection(key);
      _snapDisabled.delete(key);
    }
  }
}

function watchConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return;
  try {
    fs.watch(CONFIG_FILE, { persistent: true }, (eventType) => {   // keep event loop alive even with 0 cameras (GOTCHAS #100)
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

  if (!EDGE_MODE) alertEngine.init(pool);
  const cams = loadDahuaCameras();
  if (cams.length === 0) {
    console.log('  ℹ️  No vendor:"dahua" cameras in cameras-config.json — waiting.');
    console.log('     Add one via the dashboard — no restart needed.');
  }
  const devices = groupByDevice(cams);
  for (const [key, device] of devices) {
    const repCam = device.repCam;
    if (!repCam.ip_address || !repCam.username || !repCam.password) {
      console.error(`  ⚠️  [${key}] missing ip_address/username/password — skipped `
        + `(${device.channels.size} channel(s): ${[...device.channels.values()].map(c => c.camera_id).join(', ')})`);
      continue;
    }
    const names = [...device.channels.values()].map(c => c.camera_id).join(', ');
    console.log(`  → [${key}] ${device.channels.size} channel(s): ${names} (${repCam.ip_address})`);
    connectDevice(device);
  }
  watchConfig();
  if (!EDGE_MODE) listenForClipDone().catch(err => console.error('  🎞️  clip resolver listen:', err.message));
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
