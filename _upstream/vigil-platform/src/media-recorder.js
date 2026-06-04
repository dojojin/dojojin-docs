// ============================================================
// DojoJin Tech Dashboard — Media Recorder (Phase 6.1)
// Server-side RTSP rolling buffer for pre-alarm clip capture
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// What it does:
//   1. For each camera with enable_clip_capture=true, spawn an ffmpeg
//      subprocess that pulls RTSP 24/7 and writes 1-sec MPEG-TS
//      segments named "<unix_ts>.ts" into media-buffer/<camera_id>/.
//   2. Listens on Postgres NOTIFY channel 'event_for_clip' (raised
//      by mqtt-subscriber.js after each rule_name event insert).
//   3. On notification: waits clip_post_sec, concatenates segments
//      from [event_time - pre, event_time + post] into media/<id>.mp4,
//      then UPDATEs events.clip_file / clip_status / clip_duration_sec.
//   4. Periodic cleanup deletes segments older than (max_pre + 5)s.
//
// Why segment-on-disk (not in-RAM): leverages ffmpeg native segmenter
// (battle-tested), no NAL parsing, ffmpeg crash isolated to one
// camera, easy debugging by inspecting buffer dir.
// ============================================================

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();
require('./singleton')('media-recorder');   // refuse to run a second copy
const { decryptCamCreds } = require('./crypto-creds');

const BUFFER_DIR = path.join(__dirname, '..', 'media-buffer');
const MEDIA_DIR  = path.join(__dirname, '..', 'media');
const CONFIG_FILE = path.join(__dirname, '..', 'cameras-config.json');

const CLEANUP_INTERVAL_MS = 5_000;
const CAMERA_REFRESH_MS   = 30_000;
const FFMPEG_RESTART_MS   = 5_000;

if (!fs.existsSync(BUFFER_DIR)) fs.mkdirSync(BUFFER_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR))  fs.mkdirSync(MEDIA_DIR,  { recursive: true });

// ============================================================
// Camera credentials (from cameras-config.json — live reload)
// ============================================================

let credMap = {};

function loadCreds() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) { credMap = {}; return; }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    credMap = {};
    (cfg.cameras || []).forEach(c => { credMap[c.camera_id] = decryptCamCreds(c); });
  } catch (e) { console.error('[recorder] config load error:', e.message); }
}
loadCreds();
fs.watch(CONFIG_FILE, { persistent: false }, (et) => {
  if (et === 'change') {
    setTimeout(() => {
      loadCreds();
      syncRecorders().catch(e => console.error('[recorder] config sync failed:', e.message));
    }, 500);
  }
});

// ============================================================
// DB pool
// ============================================================

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ============================================================
// Recorder lifecycle (one ffmpeg subprocess per enabled camera)
// ============================================================

const recorders = new Map();   // camera_id -> { proc, dir, restartTimer }
let cameraConfig = new Map();  // camera_id -> { clip_pre_sec, clip_post_sec, ip_address }

function recorderSignature(cam) {
  const cred = credMap[cam.camera_id] || {};
  return JSON.stringify({
    ip: cred.ip_address || cam.ip_address || '',
    user: cred.username || '',
    pass: cred.password || '',
    vendor: String(cred.vendor || 'bosch').toLowerCase(),
    clip_stream: parseInt(cred.clip_stream, 10) || 2,
  });
}

function buildRtspUrl(cam) {
  const cred = credMap[cam.camera_id] || {};
  const ip = cred.ip_address || cam.ip_address;
  if (!ip) return null;
  const u = encodeURIComponent(cred.username || 'service');
  const p = encodeURIComponent(cred.password || '');
  const vendor = String(cred.vendor || 'bosch').toLowerCase();
  // clip_stream selects which encoder stream feeds the rolling clip
  // buffer. Default 2 = sub-stream (Phase 6.1.9 — ~1080p/2Mbps vs the
  // 4K/9Mbps main, 4-5x less network/disk/RAM). Per-camera override
  // because Hikvision's stream 2 is often lower quality than stream 3.
  const stream = parseInt(cred.clip_stream, 10) || 2;
  if (vendor === 'hikvision') {
    // Hikvision ISAPI RTSP: /Streaming/Channels/<ch><stream>, channel 1 →
    // 101 (main) / 102 (sub) / 103 (third). NOTE: Hikvision clip capture
    // is wired here but media-recorder's ffmpeg path is still Bosch-tuned
    // (GOP timing in decision #77/#79) — full Hikvision clip support is
    // Phase MV.2. The URL is correct; behaviour just isn't soak-tested.
    return `rtsp://${u}:${p}@${ip}:554/Streaming/Channels/10${stream}`;
  }
  if (vendor === 'dahua') {
    // Dahua RTSP: /cam/realmonitor?channel=1&subtype=N (0=main, 1=sub).
    // Map the generic clip_stream (1=main, 2=sub — same convention as
    // Bosch/Hikvision) onto Dahua's 0-based subtype.
    const subtype = Math.max(0, stream - 1);
    return `rtsp://${u}:${p}@${ip}:554/cam/realmonitor?channel=1&subtype=${subtype}`;
  }
  // Bosch: ?inst=N selects encoder instance.
  return `rtsp://${u}:${p}@${ip}/rtsp_tunnel?inst=${stream}`;
}

function spawnRecorder(cam) {
  const url = buildRtspUrl(cam);
  if (!url) {
    console.warn(`[recorder] no RTSP URL for ${cam.camera_id} — skip`);
    return;
  }
  const dir = path.join(BUFFER_DIR, cam.camera_id);
  fs.mkdirSync(dir, { recursive: true });

  // Phase 6.1.9 — RTSP resilience flags
  // Why each one matters:
  //   -timeout 30000000         socket I/O timeout 30s (was: hang forever on
  //                             RTSP stall — auto-restart never fired).
  //                             Note: ffmpeg renamed this option a few times.
  //                             Old: -stimeout (RTSP-specific)
  //                             ffmpeg 5+: -timeout (universal, microseconds)
  //   -rtbufsize 64M            larger jitter buffer (default 3MB is small)
  //   -fflags +discardcorrupt   drop corrupt packets instead of erroring out
  //   -err_detect ignore_err    tolerate minor stream parse errors
  //   -thread_queue_size 1024   prevent input queue overflow during burst
  // All of these belong BEFORE the -i (they're input options).
  const args = [
    '-rtsp_transport', 'tcp',
    '-timeout', '30000000',
    '-rtbufsize', '64M',
    '-fflags', '+discardcorrupt',
    '-err_detect', 'ignore_err',
    '-thread_queue_size', '1024',
    '-i', url,
    '-c', 'copy',
    '-f', 'segment',
    '-segment_time', '1',
    '-segment_format', 'mpegts',
    '-strftime', '1',
    '-reset_timestamps', '1',
    '-loglevel', 'error',
    path.join(dir, '%s.ts'),  // %s = Unix timestamp (1715153400.ts)
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', d => {
    const txt = d.toString().trim();
    if (txt) console.error(`[ffmpeg ${cam.camera_id}] ${txt}`);
  });
  proc.on('exit', code => {
    console.warn(`[recorder] ffmpeg exit cam=${cam.camera_id} code=${code} — restart in ${FFMPEG_RESTART_MS/1000}s`);
    const slot = recorders.get(cam.camera_id);
    if (!slot || slot.proc !== proc) return;
    slot.proc = null;
    slot.restartTimer = setTimeout(() => {
      if (recorders.has(cam.camera_id)) spawnRecorder(cam);
    }, FFMPEG_RESTART_MS);
  });

  recorders.set(cam.camera_id, { proc, dir, restartTimer: null, signature: recorderSignature(cam) });
  console.log(`[recorder] ▶ started ${cam.camera_id} pid=${proc.pid}`);
}

// Read accurate duration from a finalized clip (ffprobe, ~50ms one-shot).
function probeDuration(filePath) {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ff.stdout.on('data', d => { out += d.toString(); });
    ff.on('exit', () => {
      const d = parseFloat(out.trim());
      resolve(Number.isFinite(d) ? d : 0);
    });
    ff.on('error', () => resolve(0));
  });
}

function stopRecorder(camera_id) {
  const slot = recorders.get(camera_id);
  if (!slot) return;
  if (slot.restartTimer) clearTimeout(slot.restartTimer);
  if (slot.proc) {
    try { slot.proc.kill('SIGTERM'); } catch {}
  }
  recorders.delete(camera_id);
  console.log(`[recorder] ■ stopped ${camera_id}`);
}

// ============================================================
// Sync: enable/disable recorders to match DB config
// ============================================================

// A camera needs the RTSP rolling buffer if clip capture is on (any
// vendor) OR — for Dahua — snapshot capture is on: the Dahua ingester
// extracts event snapshots by ffmpeg'ing a frame out of this buffer,
// because the camera's snapshot.cgi is too slow to poll a dense buffer
// (see dahua-cgi.js). The buffer is therefore a SHARED internal
// primitive — a customer enabling only "Snapshot capture" on a Dahua
// camera need NOT also enable "Pre-alarm Video Clip". The .mp4 clip
// output stays separately gated on enable_clip_capture in captureClip().
function recorderNeeded(cam) {
  if (cam.enable_clip_capture) return true;
  const vendor = String((credMap[cam.camera_id] || {}).vendor || 'bosch').toLowerCase();
  return vendor === 'dahua' && !!cam.enable_snapshot;
}

async function syncRecorders() {
  let rows = [];
  try {
    const r = await pool.query(`
      SELECT id AS camera_id, ip_address, clip_pre_sec, clip_post_sec,
             enable_clip_capture, enable_snapshot
        FROM cameras
       WHERE enable_clip_capture = TRUE OR enable_snapshot = TRUE
    `);
    rows = r.rows.filter(recorderNeeded);
  } catch (e) {
    console.error('[recorder] cam query failed:', e.message);
    return;
  }

  cameraConfig = new Map(rows.map(c => [c.camera_id, c]));
  const wanted = new Set(rows.map(c => c.camera_id));

  for (const cid of recorders.keys()) {
    if (!wanted.has(cid)) stopRecorder(cid);
  }
  for (const cam of rows) {
    const slot = recorders.get(cam.camera_id);
    const signature = recorderSignature(cam);
    if (!slot) {
      spawnRecorder(cam);
    } else if (slot.signature !== signature) {
      console.log(`[recorder] 🔄 ${cam.camera_id} RTSP config changed — restarting recorder only`);
      stopRecorder(cam.camera_id);
      spawnRecorder(cam);
    }
  }
}

// ============================================================
// Cleanup — delete segments older than (max_pre_sec + 5)s
// ============================================================

async function cleanupOldSegments() {
  // Keep segments long enough to cover the widest possible capture window.
  // Window is widened by GOP_BUFFER_SEC on both sides (see captureClip) to
  // tolerate Bosch's ~9s sub-stream GOP, so retention must match — otherwise
  // the previous-overlap segment gets GC'd before an in-flight capture reads
  // it, reverting to short truncated clips.
  const GOP_BUFFER_SEC = 10;
  let maxPre = 10;
  let maxPost = 10;
  for (const cfg of cameraConfig.values()) {
    if (cfg.clip_pre_sec  > maxPre)  maxPre  = cfg.clip_pre_sec;
    if (cfg.clip_post_sec > maxPost) maxPost = cfg.clip_post_sec;
  }
  const cutoff = Math.floor(Date.now() / 1000)
    - (maxPre + maxPost + GOP_BUFFER_SEC + 5);

  for (const cid of recorders.keys()) {
    const dir = path.join(BUFFER_DIR, cid);
    if (!fs.existsSync(dir)) continue;
    let deleted = 0;
    try {
      for (const f of await fsp.readdir(dir)) {
        if (!f.endsWith('.ts')) continue;
        const ts = parseInt(f.replace('.ts', ''), 10);
        if (ts && ts < cutoff) {
          await fsp.unlink(path.join(dir, f)).catch(() => {});
          deleted++;
        }
      }
    } catch {}
    // Don't log per-tick — only when something happens unusual
  }
}

// ============================================================
// Clip capture pipeline
// ============================================================

async function captureClip({ event_id, camera_id, event_time, received_at_ms }) {
  const cam = cameraConfig.get(camera_id);
  if (!cam) { console.warn(`[recorder] event_id=${event_id} cam ${camera_id} not in recorder config — skip`); return; }
  // The RTSP buffer may be running only to feed snapshot extraction
  // (a Dahua camera with snapshot ON but clip capture OFF) — no .mp4
  // is wanted in that case. Leave clip_status untouched (NULL).
  if (!cam.enable_clip_capture) return;
  if (!recorders.has(camera_id))   { console.warn(`[recorder] event_id=${event_id} no active ffmpeg for ${camera_id} — skip`); return; }

  const preSec  = cam.clip_pre_sec  || 10;
  const postSec = cam.clip_post_sec || 10;
  // Anchor window to host receive time (matches ffmpeg segment filenames).
  // Camera UtcTime is unreliable: Bosch stamps LineDetector/Crossed with the
  // track-appearance time (often 5-10s before the actual crossing) and camera
  // clock can drift several seconds from host. Falls back to event_time for
  // backwards compatibility with older NOTIFY payloads.
  const anchorMs = Number.isFinite(received_at_ms)
    ? received_at_ms
    : new Date(event_time).getTime();
  const eventTs = Math.floor(anchorMs / 1000);

  // GOP-aware buffer. Bosch sub-stream (inst=2) emits keyframes only every
  // ~8-10s, so even with -segment_time 1 ffmpeg can't slice finer than the
  // GOP (segments must start at keyframes when using -c copy). With small
  // pre/post values and a 9s GOP, often only one segment falls inside the
  // window and that segment may still be mid-write at read time, producing
  // truncated 1-3s clips.
  //
  // Fix: (1) wait an extra GOP_BUFFER_SEC so the segment that overlaps the
  // post edge finishes flushing to disk; (2) widen the segment-name filter
  // by the GOP length so the previous full segment whose content overlaps
  // the pre edge is included. The clip ends up slightly longer than the
  // configured window, which is the right trade-off — better too much
  // footage than to miss the moment.
  const GOP_BUFFER_SEC = 10;

  // Mark pending immediately
  await pool.query(`UPDATE events SET clip_status='pending' WHERE id=$1`, [event_id])
    .catch(e => console.error('[recorder] mark pending failed:', e.message));

  // Wait for post-alarm window + the currently-recording segment to flush.
  await new Promise(r => setTimeout(r, (postSec + GOP_BUFFER_SEC) * 1000));

  const dir = path.join(BUFFER_DIR, camera_id);
  // fromTs widened by GOP so the previous segment whose CONTENT overlaps
  // [eventTs - preSec, ...] is included via filename match.
  const fromTs = eventTs - preSec - GOP_BUFFER_SEC;
  const toTs   = eventTs + postSec;

  let segments = [];
  try {
    segments = (await fsp.readdir(dir))
      .filter(f => f.endsWith('.ts'))
      .map(f => ({ name: f, ts: parseInt(f.replace('.ts', ''), 10) }))
      .filter(s => s.ts && s.ts >= fromTs && s.ts <= toTs)
      .sort((a, b) => a.ts - b.ts);
  } catch (e) {
    console.error(`[recorder] event_id=${event_id} buffer dir read failed:`, e.message);
  }

  if (segments.length === 0) {
    await pool.query(`UPDATE events SET clip_status='failed' WHERE id=$1`, [event_id]).catch(()=>{});
    console.warn(`[recorder] event_id=${event_id} no segments in [${fromTs}, ${toTs}] — failed`);
    return;
  }

  const clipFile = `${event_id}.mp4`;
  const clipPath = path.join(MEDIA_DIR, clipFile);
  const listPath = path.join(dir, `_concat_${event_id}.txt`);
  const listBody = segments.map(s => `file '${s.name}'`).join('\n');

  try {
    await fsp.writeFile(listPath, listBody);

    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        clipPath,
      ]);
      ff.stderr.on('data', d => console.error(`[ffmpeg-clip ${event_id}]`, d.toString().trim()));
      ff.on('exit', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    await fsp.unlink(listPath).catch(() => {});

    const stat = await fsp.stat(clipPath);
    // Real duration via ffprobe — Bosch RTSP often has 2s GOP so segment count
    // doesn't equal seconds. ffprobe reads the actual stream duration from the
    // output file (~50ms cost, run once per clip — acceptable).
    const duration = await probeDuration(clipPath);

    await pool.query(
      `UPDATE events SET clip_file=$1, clip_status='done', clip_duration_sec=$2 WHERE id=$3`,
      [clipFile, duration, event_id]
    );
    // Phase 6.1.5 — notify api-server so it can push to WebSocket clients
    pool.query(
      `SELECT pg_notify('clip_done', $1)`,
      [JSON.stringify({ event_id, camera_id, clip_file: clipFile, clip_duration_sec: duration })]
    ).catch(() => {});
    console.log(`[recorder] ✓ clip event_id=${event_id} cam=${camera_id} ` +
                `${segments.length}seg ${duration.toFixed(1)}s ${(stat.size/1024).toFixed(0)}KB`);
  } catch (e) {
    console.error(`[recorder] event_id=${event_id} concat failed:`, e.message);
    await pool.query(`UPDATE events SET clip_status='failed' WHERE id=$1`, [event_id]).catch(()=>{});
    await fsp.unlink(listPath).catch(() => {});
    await fsp.unlink(clipPath).catch(() => {});
  }
}

// ============================================================
// Postgres LISTEN — wait for mqtt-subscriber to NOTIFY
// ============================================================

async function listenForEvents() {
  // Use a dedicated client for LISTEN (pool clients can't hold long subs)
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  client.on('error', e => {
    console.error('[recorder] LISTEN client error:', e.message);
    setTimeout(listenForEvents, 5_000);
  });
  // Catch subscriber/recorder version skew: a payload missing received_at_ms
  // means the subscriber is running an old build that doesn't provide a
  // host-clock anchor. captureClip falls back to event_time (camera UtcTime),
  // which silently re-opens the pre-Phase-6.1.11 timing bug. Warn loudly so
  // it's caught on first event rather than discovered weeks later.
  let _warnedMissingAnchor = false;
  client.on('notification', (msg) => {
    if (msg.channel !== 'event_for_clip') return;
    let payload;
    try { payload = JSON.parse(msg.payload); } catch { return; }
    if (!payload?.event_id || !payload?.camera_id) return;
    if (payload.received_at_ms == null && !_warnedMissingAnchor) {
      console.warn('[recorder] ⚠️  NOTIFY payload missing received_at_ms — ' +
                   'subscriber may be on an old build. Falling back to camera ' +
                   'event_time (clip windows will be misaligned by camera-host ' +
                   'clock skew). Re-deploy mqtt-subscriber.js.');
      _warnedMissingAnchor = true;
    }
    captureClip(payload).catch(e => console.error('[recorder] captureClip threw:', e.message));
  });

  await client.connect();
  await client.query('LISTEN event_for_clip');
  console.log('[recorder] 👂 LISTEN event_for_clip');
}

// ============================================================
// Boot
// ============================================================

async function bootstrap() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DojoJin Media Recorder — Phase 6.1 (RTSP rolling buffer)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  buffer:  ${BUFFER_DIR}`);
  console.log(`  output:  ${MEDIA_DIR}`);
  console.log('───────────────────────────────────────────────────────────');

  await syncRecorders();
  await listenForEvents();

  // On startup: any 'pending' clips from before the restart are stale → mark failed
  const r = await pool.query(`UPDATE events SET clip_status='failed' WHERE clip_status='pending'`);
  if (r.rowCount > 0) console.log(`[recorder] marked ${r.rowCount} stale 'pending' clips as failed`);

  setInterval(syncRecorders, CAMERA_REFRESH_MS);
  setInterval(cleanupOldSegments, CLEANUP_INTERVAL_MS);
}

bootstrap().catch(e => { console.error('[recorder] bootstrap failed:', e); process.exit(1); });

// Graceful shutdown
function shutdown() {
  console.log('\n[recorder] shutdown...');
  for (const cid of [...recorders.keys()]) stopRecorder(cid);
  pool.end().finally(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
