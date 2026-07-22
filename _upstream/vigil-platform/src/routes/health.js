// ============================================================
// Vigil Platform — Health Check Routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const { OFFLINE_THRESHOLD_SEC, MQTT_HEALTHY_AGE_SEC } = require('../constants');

const PORT                   = process.env.API_PORT || 3000;
const HEALTH_REPORT_TITLE_TH = 'รายงานสุขภาพระบบ';
// Action allowlist — MUST stay in sync with the TRACKED status list below (~L260).
// Drift here = buttons render (service shows in TRACKED) but stop/restart 400s. (GOTCHAS)
const _SVC_NAMES   = new Set(['api-server', 'mqtt-subscriber', 'media-recorder', 'hikvision', 'dahua', 'alert-worker', 'report-worker', 'lpr-receiver']);
const _SVC_ACTIONS = new Set(['restart', 'stop', 'start']);

// Alert delivery health — success/failed/cooldown over a window + last-ever
// success (to tell "quiet" from "broken" when the window count is 0).
// Shared by /api/health/details and /api/health/report-data/alerts.
async function _alertHealth(pool, hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const [win, last] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE status='success')       AS success,
             COUNT(*) FILTER (WHERE status='failed')        AS failed,
             COUNT(*) FILTER (WHERE status='cooldown_skip') AS cooldown,
             COUNT(*)                                        AS total
        FROM alert_logs WHERE sent_at >= $1`, [since]),
    pool.query(`SELECT MAX(sent_at) AS last_sent_at FROM alert_logs WHERE status='success'`),
  ]);
  const w = win.rows[0] || {};
  return {
    success:  parseInt(w.success,  10) || 0,
    failed:   parseInt(w.failed,   10) || 0,
    cooldown: parseInt(w.cooldown, 10) || 0,
    total:    parseInt(w.total,    10) || 0,
    last_sent_at: last.rows[0]?.last_sent_at || null,
  };
}

// OPT5-CEN-001 (2026-07-21 CODEX audit) — /api/health/details recursively
// walks the whole snapshot tree + clips dir + spool dir + spawns `pm2 jlist`
// on EVERY request, and the health page auto-refreshes. A tiny TTL cache on
// just these filesystem/process-spawn sections turns "load generator that
// scales with snapshot count" into a fixed, bounded cost — the DB ping and
// per-request DB aggregates stay live (those already scale with indexes).
const _HEALTH_CACHE_TTL_MS = 10_000;
const _healthCache = new Map();
async function _cached(key, fn) {
  const hit = _healthCache.get(key);
  const now = Date.now();
  if (hit && (now - hit.at) < _HEALTH_CACHE_TTL_MS) return hit.value;
  const value = await fn();
  _healthCache.set(key, { value, at: now });
  return value;
}

async function _dirSize(dir) {
  let bytes = 0, files = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, e.name));
        bytes += st.size;
        files++;
      } catch {}
    }
  } catch {}
  return { bytes, files };
}

// Categorize snapshots by type: face crop/full (top-level), LPR plate/scene (lpr/ tree).
// The lpr/ layout evolved from flat (lpr/DATE/*.jpg) to nested
// (lpr/DATE/CAM/SLOT/*.jpg) once file counts grew — see snapshot-path.js.
// The lpr/ walk recurses to any depth so it counts BOTH layouts by filename
// prefix, not by directory shape.
async function _snapshotStats(snapshotDir) {
  const r = {
    face_crop: { files: 0, bytes: 0 },
    face_full: { files: 0, bytes: 0 },
    lpr_plate: { files: 0, bytes: 0 },
    lpr_scene: { files: 0, bytes: 0 },
    other:     { files: 0, bytes: 0 },
  };
  try {
    for (const e of await fs.promises.readdir(snapshotDir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(path.join(snapshotDir, e.name));
        const n = e.name;
        if (n.includes('_face_'))      { r.face_crop.files++; r.face_crop.bytes += st.size; }
        else if (n.includes('_full_')) { r.face_full.files++; r.face_full.bytes += st.size; }
        else                           { r.other.files++;     r.other.bytes += st.size; }
      } catch {}
    }
  } catch {}
  // lpr/ — recurse the whole tree; bucket by filename prefix at any depth.
  const walkLpr = async (dir) => {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walkLpr(full); continue; }
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(full);
        const n = e.name;
        if (n.startsWith('lpr_plate_'))      { r.lpr_plate.files++; r.lpr_plate.bytes += st.size; }
        else if (n.startsWith('lpr_scene_')) { r.lpr_scene.files++; r.lpr_scene.bytes += st.size; }
        else                                 { r.other.files++;     r.other.bytes += st.size; }
      } catch {}
    }
  };
  await walkLpr(path.join(snapshotDir, 'lpr'));
  // events/ + face/ — nested DATE/CAM/SLOT/*.jpg layout (post flat-root migration).
  // Flat-root readdir above only sees top-level files, so without this the totals
  // (esp. "General events" / other) count ONLY legacy flat files and undercount real
  // storage. Bucket by the same filename rule; mirrors enforceSnapshotRetention's
  // events+face scope.
  const walkStructured = async (dir) => {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walkStructured(full); continue; }
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(full);
        const n = e.name;
        if (n.includes('_face_'))      { r.face_crop.files++; r.face_crop.bytes += st.size; }
        else if (n.includes('_full_')) { r.face_full.files++; r.face_full.bytes += st.size; }
        else                           { r.other.files++;     r.other.bytes += st.size; }
      } catch {}
    }
  };
  await walkStructured(path.join(snapshotDir, 'events'));
  await walkStructured(path.join(snapshotDir, 'face'));
  return r;
}

module.exports = function healthRoutes(app, pool, {
  auth, routeError,
  _serverStartedAt, wss, loadCameraConfig, getSystemSettings,
  SNAPSHOT_DIR, MEDIA_DIR, fetchWorkerHealth,
  ALERT_WORKER_PORT, WORKER_PORT, CONFIG_FILE, INTERNAL_API_TOKEN,
  getBrandForReport, REPORTS_DIR, getDisplayTz,
}) {

  // OPT5-CEN-007 — pool.waitingCount is bursty (sub-second to a few seconds),
  // so a point-in-time read on a periodically-sampled health page would show
  // 0 in virtually every sample (same near-miss-telemetry lesson as GOTCHAS
  // #113's bridge queue). Track a peak instead, reset on each health read so
  // it reports "worst since you last looked", not peak-since-boot.
  let _poolWaitPeak = 0;
  setInterval(() => { _poolWaitPeak = Math.max(_poolWaitPeak, pool.waitingCount); }, 1000).unref();

  app.get('/api/health/details', auth.requireAdminOrAuditor, async (req, res) => {
    const result = {
      timestamp: new Date().toISOString(),
      server: {
        uptime_sec: Math.floor((Date.now() - _serverStartedAt) / 1000),
        node_version: process.version,
        pid: process.pid,
        memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        memory_heap_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        platform: `${os.platform()} ${os.release()}`,
        hostname: os.hostname(),
        load_avg_1m: parseFloat(os.loadavg()[0].toFixed(2)),
        cpu_count: os.cpus().length,
        total_mem_mb: Math.round(os.totalmem() / (1024 * 1024)),
        free_mem_mb: Math.round(os.freemem() / (1024 * 1024)),
      },
      db: { ok: false, latency_ms: null, error: null },
      mqtt_pipeline: { last_event_at: null, age_sec: null, status: 'unknown' },
      cameras: { total: 0, online: 0, offline: 0 },
      events: { last_hour: 0, last_24h: 0, total: 0, face_total: 0, lpr_total: 0 },
      storage: {
        snapshots_files: 0, snapshots_mb: 0,
        face_crop_files: 0, face_crop_mb: 0,
        face_full_files: 0, face_full_mb: 0,
        lpr_plate_files: 0, lpr_plate_mb: 0,
        lpr_scene_files: 0, lpr_scene_mb: 0,
        clips_files: 0, clips_mb: 0, clips_today: 0, clips_oldest_at: null,
        retention_days_events: null, retention_days_snapshots: null, retention_days_clips: null,
        spool_files: 0, spool_mb: 0,
      },
      websocket: { clients: wss.clients ? wss.clients.size : 0 },
      image_quality: [],
      // OPT5-CEN-001 — per-section wall-clock ms for the sections that scan
      // the filesystem or spawn a process, so a slow health page has a
      // pointer instead of "the whole endpoint is slow somehow".
      diagnostics_ms: {},
    };
    const _time = async (section, fn) => {
      const t0 = Date.now();
      try { return await fn(); }
      finally {
        const ms = Date.now() - t0;
        result.diagnostics_ms[section] = ms;
        if (ms > 1000) console.warn(`[health] section "${section}" took ${ms}ms`);
      }
    };

    try {
      const t0 = Date.now();
      await pool.query('SELECT 1');
      result.db.latency_ms = Date.now() - t0;
      result.db.ok = true;
    } catch (e) { result.db.error = e.message; }
    result.db.pool = {
      total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
      waiting_peak: _poolWaitPeak,
    };
    _poolWaitPeak = 0;

    if (result.db.ok) {
      try {
        const r = await pool.query(`SELECT MAX(event_time) AS last FROM events`);
        const last = r.rows[0]?.last;
        if (last) {
          result.mqtt_pipeline.last_event_at = new Date(last).toISOString();
          const age = Math.floor((Date.now() - new Date(last).getTime()) / 1000);
          result.mqtt_pipeline.age_sec = age;
          result.mqtt_pipeline.status = age < MQTT_HEALTHY_AGE_SEC ? 'healthy' : age < 3600 ? 'idle' : 'stale';
        } else {
          result.mqtt_pipeline.status = 'no_events_yet';
        }
      } catch {}
      // Camera totals come from cameras-config.json (the source of truth per
      // decision #86) — the cameras DB table can carry stale rows auto-
      // registered from old MQTT testing that no longer exist in config. We
      // still hit the DB to derive online vs offline from last_seen_at, but
      // scoped to the config's camera ids only.
      try {
        const config = loadCameraConfig();
        const ids = (config.cameras || [])
          .map(c => c.camera_id || c.id)
          .filter(Boolean);
        const total = ids.length;
        let online = 0;
        let dbRows = [];
        if (ids.length) {
          const r = await pool.query(`
            SELECT id, name, ip_address, last_seen_at,
                   EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS age_sec
            FROM cameras WHERE id = ANY($1::text[])`, [ids]);
          dbRows = r.rows;
          online = dbRows.filter(row => row.age_sec != null && row.age_sec < OFFLINE_THRESHOLD_SEC).length;
        }
        const dbMap = new Map(dbRows.map(r => [r.id, r]));
        // offline = total - online so a config camera that has never
        // produced an event (no DB row) still counts as offline, not missing.
        result.cameras.total = total;
        result.cameras.online = online;
        result.cameras.offline = total - online;
        result.cameras.list = (config.cameras || []).map(c => {
          const id = c.camera_id || c.id;
          const db = dbMap.get(id);
          const age = db?.age_sec ?? null;
          const status = db == null ? 'unknown' : (age != null && age < OFFLINE_THRESHOLD_SEC ? 'online' : 'offline');
          return {
            id,
            name: db?.name || id,
            vendor: String(c.vendor || 'bosch').toLowerCase(),
            ip: c.ip_address || db?.ip_address || null,
            status,
            last_seen_sec: age,
          };
        });
      } catch {}
      // media-recorder rolling-buffer freshness — segments churn every second
      // while ffmpeg is healthy, so a buffer dir whose mtime is stale while a
      // recorder is supposed to run means the RTSP pull is wedged (incident
      // 2026-06-09: recording silently down ~17h, see GOTCHAS #84).
      try {
        const mbDir = path.join(__dirname, '../..', 'media-buffer');
        result.media_buffer = [];
        for (const ent of await fs.promises.readdir(mbDir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          const st = await fs.promises.stat(path.join(mbDir, ent.name));
          result.media_buffer.push({
            camera_id: ent.name,
            newest_segment_sec: Math.round((Date.now() - st.mtimeMs) / 1000),
          });
        }
      } catch {}
      try {
        const r = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time > NOW() - INTERVAL '1 hour') AS h1,
            COUNT(*) FILTER (WHERE event_time > NOW() - INTERVAL '24 hours') AS h24,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE event_type IN ('FaceCapture', 'FaceRecognition')) AS face_total,
            COUNT(*) FILTER (WHERE event_type = 'anprAlarm') AS lpr_total
          FROM events`);
        result.events.last_hour  = parseInt(r.rows[0].h1, 10);
        result.events.last_24h   = parseInt(r.rows[0].h24, 10);
        result.events.total      = parseInt(r.rows[0].total, 10);
        result.events.face_total = parseInt(r.rows[0].face_total, 10);
        result.events.lpr_total  = parseInt(r.rows[0].lpr_total, 10);
      } catch {}
      try {
        const s = await getSystemSettings(pool, ['data_retention_days', 'snapshot_retention_days', 'clip_retention_days']);
        if (s.data_retention_days)     result.storage.retention_days_events    = parseInt(s.data_retention_days, 10);
        if (s.snapshot_retention_days) result.storage.retention_days_snapshots = parseInt(s.snapshot_retention_days, 10);
        if (s.clip_retention_days)     result.storage.retention_days_clips     = parseInt(s.clip_retention_days, 10);
      } catch {}
      // Phase 6.1.5 — clip stats from DB (fast — uses idx_events_has_clip)
      try {
        const r = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE event_time > NOW() - INTERVAL '24 hours') AS today,
            MIN(event_time) AS oldest
            FROM events WHERE clip_file IS NOT NULL AND clip_status = 'done'`);
        result.storage.clips_today = parseInt(r.rows[0]?.today || 0, 10);
        result.storage.clips_oldest_at = r.rows[0]?.oldest ? new Date(r.rows[0].oldest).toISOString() : null;
      } catch {}
      // Phase 7.1 — camera image-quality diagnostics (last 24h, state=true only).
      // ImageTooBright/Blurry/Dark are camera-health signals (dirty lens, focus
      // drift, lighting change). Surfaced here so the operator can spot a camera
      // that's degrading. GlobalSceneChange included as a tamper/obstruction hint.
      try {
        const r = await pool.query(`
          SELECT camera_id,
            COUNT(*) FILTER (WHERE event_type LIKE 'ImageTooBright/%')    AS too_bright,
            COUNT(*) FILTER (WHERE event_type LIKE 'ImageTooBlurry/%')    AS too_blurry,
            COUNT(*) FILTER (WHERE event_type LIKE 'ImageTooDark/%')      AS too_dark,
            COUNT(*) FILTER (WHERE event_type LIKE 'GlobalSceneChange/%') AS scene_change
          FROM events
          WHERE event_time > NOW() - INTERVAL '24 hours'
            AND event_state = 'true'
            AND (event_type LIKE 'ImageTooBright/%' OR event_type LIKE 'ImageTooBlurry/%'
                 OR event_type LIKE 'ImageTooDark/%' OR event_type LIKE 'GlobalSceneChange/%')
          GROUP BY camera_id
          ORDER BY (COUNT(*)) DESC`);
        result.image_quality = r.rows.map(row => ({
          camera_id:    row.camera_id,
          too_bright:   parseInt(row.too_bright, 10),
          too_blurry:   parseInt(row.too_blurry, 10),
          too_dark:     parseInt(row.too_dark, 10),
          scene_change: parseInt(row.scene_change, 10),
        }));
      } catch { result.image_quality = []; }
      // Phase 7.5 — camera automation triggers (last 24h, state=true only).
      // Trigger/DigitalInput/Relay events are housekeeping/automation rather
      // than incidents, so they're filtered out of Stats / Executive Summary
      // by default (analytics_event_display setting) — but the operator still
      // wants visibility into "did the I/O fire today?" hence this card.
      try {
        const r = await pool.query(`
          SELECT camera_id,
            COUNT(*) FILTER (WHERE event_type LIKE 'Trigger/DigitalInput/%') AS digital_input,
            COUNT(*) FILTER (WHERE event_type LIKE 'Trigger/Relay/%')        AS relay,
            MAX(event_time) AS last_trigger_at
          FROM events
          WHERE event_time > NOW() - INTERVAL '24 hours'
            AND event_state = 'true'
            AND event_type LIKE 'Trigger/%'
          GROUP BY camera_id
          ORDER BY (COUNT(*)) DESC`);
        result.automation_triggers = r.rows.map(row => ({
          camera_id:       row.camera_id,
          digital_input:   parseInt(row.digital_input, 10),
          relay:           parseInt(row.relay, 10),
          last_trigger_at: row.last_trigger_at ? new Date(row.last_trigger_at).toISOString() : null,
        }));
      } catch { result.automation_triggers = []; }
    }

    try {
      const snap = await _time('snapshot_stats', () => _cached('snapshot_stats', () => _snapshotStats(SNAPSHOT_DIR)));
      const mb = b => Math.round(b / (1024 * 1024));
      result.storage.face_crop_files = snap.face_crop.files;
      result.storage.face_crop_mb    = mb(snap.face_crop.bytes);
      result.storage.face_full_files = snap.face_full.files;
      result.storage.face_full_mb    = mb(snap.face_full.bytes);
      result.storage.lpr_plate_files = snap.lpr_plate.files;
      result.storage.lpr_plate_mb    = mb(snap.lpr_plate.bytes);
      result.storage.lpr_scene_files  = snap.lpr_scene.files;
      result.storage.lpr_scene_mb     = mb(snap.lpr_scene.bytes);
      result.storage.other_files      = snap.other.files;
      result.storage.other_mb         = mb(snap.other.bytes);
      result.storage.snapshots_files = snap.face_crop.files + snap.face_full.files +
                                       snap.lpr_plate.files + snap.lpr_scene.files + snap.other.files;
      result.storage.snapshots_mb    = mb(snap.face_crop.bytes + snap.face_full.bytes +
                                         snap.lpr_plate.bytes + snap.lpr_scene.bytes + snap.other.bytes);
    } catch {}

    // Phase 6.1.5 — clip files on disk
    try {
      const { bytes, files } = await _time('clips_dir', () => _cached('clips_dir', () => _dirSize(MEDIA_DIR)));
      result.storage.clips_files = files;
      result.storage.clips_mb = Math.round(bytes / (1024 * 1024));
    } catch {}

    try {
      const sf = await fs.promises.statfs(SNAPSHOT_DIR);
      result.storage.disk_free_gb  = Math.round((sf.bavail * sf.bsize) / (1024 ** 3));
      result.storage.disk_total_gb = Math.round((sf.blocks * sf.bsize) / (1024 ** 3));
    } catch {}

    // A2 — LPR forward spool queue depth (count .json = number of queued items)
    try {
      const { spoolFiles, spoolBytes } = await _time('spool_dir', () => _cached('spool_dir', async () => {
        const SPOOL_BASE = path.join(SNAPSHOT_DIR, '..', 'spool');
        let spoolFiles = 0, spoolBytes = 0;
        for (const sub of ['lpr-forward-api-server', 'lpr-forward-lpr-receiver']) {
          try {
            const dir = path.join(SPOOL_BASE, sub);
            for (const f of await fs.promises.readdir(dir)) {
              if (!f.endsWith('.json')) continue;
              spoolFiles++;
              try { spoolBytes += (await fs.promises.stat(path.join(dir, f))).size; } catch {}
            }
          } catch {}
        }
        return { spoolFiles, spoolBytes };
      }));
      result.storage.spool_files = spoolFiles;
      result.storage.spool_mb    = Math.round(spoolBytes / (1024 * 1024));
    } catch {}

    // Worker health — poll each worker's /health endpoint for process-level state
    // (db connectivity, listener status, scheduler activity). These go beyond what
    // PM2 provides (restart count) and satisfy S3 observability requirement.
    result.workers = await _time('workers', () => _cached('workers', async () => ({
      alert:  await fetchWorkerHealth(ALERT_WORKER_PORT),
      report: await fetchWorkerHealth(WORKER_PORT),
    })));

    // Service status via PM2 — replaces pgrep count; gives status/restarts/uptime.
    result.services = [];
    {
      const TRACKED = ['api-server', 'mqtt-subscriber', 'media-recorder', 'hikvision', 'dahua', 'alert-worker', 'report-worker', 'lpr-receiver'];
      try {
        const pm2List = await _time('pm2', () => _cached('pm2', async () => {
          const out = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000 });
          return JSON.parse(out);
        }));
        const pm2Map = new Map(pm2List.map(p => [p.name, p]));
        for (const name of TRACKED) {
          const p = pm2Map.get(name);
          result.services.push({
            name,
            status:    p ? p.pm2_env.status : 'stopped',
            restarts:  p ? (p.pm2_env.restart_time || 0) : 0,
            uptime_ms: p && p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
            pid:       p ? p.pid : null,
          });
        }
      } catch {
        // PM2 unavailable — return unknown state
        for (const name of TRACKED) result.services.push({ name, status: 'unknown', restarts: 0, uptime_ms: null, pid: null });
      }
    }

    // SEC-2T-006 — warn if any camera still stores credentials as plaintext
    // Read raw file (bypass loadCameraConfig decryption) so enc:v1: prefix check is correct
    try {
      const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      result.security = {
        plaintext_creds: (rawCfg.cameras || [])
          .filter(c => {
            const pw = c.password || '';
            const mq = c.mqtt_password || '';
            return (pw && pw !== '***' && !pw.startsWith('enc:v1:')) ||
                   (mq && mq !== '***' && !mq.startsWith('enc:v1:'));
          })
          .map(c => c.camera_id || c.id || 'unknown'),
      };
      if (result.security.plaintext_creds.length) {
        console.warn(`[health] ${result.security.plaintext_creds.length} camera(s) have plaintext credentials: ${result.security.plaintext_creds.join(', ')}`);
      }
    } catch { result.security = { plaintext_creds: [] }; }

    // EM4 — edge sites health (reads from edge_status, written by mqtt-subscriber EM3)
    result.edge_sites = [];
    try {
      const EDGE_STALE_SEC = parseInt(process.env.EDGE_HEARTBEAT_STALE_SEC || '180', 10);
      const esRows = await pool.query(`
        SELECT site_id, last_seen_at, disk_free_gb, disk_total_gb,
               bridge_forwarded, bridge_dropped, bridge_remote, bridge_local,
               pm2_json, snapshot_oldest, snapshot_dirs,
               extract(epoch from (now() - last_seen_at)) AS stale_sec
        FROM edge_status
        ORDER BY site_id
      `);
      result.edge_sites = esRows.rows.map(r => ({
        site_id:          r.site_id,
        last_seen_at:     r.last_seen_at,
        stale:            r.stale_sec > EDGE_STALE_SEC,
        stale_sec:        Math.round(r.stale_sec),
        disk_free_gb:     r.disk_free_gb,
        disk_total_gb:    r.disk_total_gb,
        snapshot_oldest:  r.snapshot_oldest,
        snapshot_dirs:    r.snapshot_dirs,
        bridge_forwarded: r.bridge_forwarded,
        bridge_dropped:   r.bridge_dropped,
        // OPT5-EDGE-001 (2026-07-21) — bridge_dropped was already surfaced
        // here but nothing ever looked at it; today's real outage queued to
        // ~88% of the edge's cap with no alert firing. This is a passive
        // flag for now (dashboard/LINE wiring is a separate change) — same
        // scope as the plaintext_creds warn below.
        bridge_alert:     (r.bridge_dropped || 0) > 0,
        bridge_remote:    r.bridge_remote,
        bridge_local:     r.bridge_local,
        services:         r.pm2_json || [],
      }));
      const droppingsSites = result.edge_sites.filter(s => s.bridge_alert);
      if (droppingsSites.length) {
        console.warn(`[health] ${droppingsSites.length} edge site(s) have dropped queued events (bridge_dropped>0): ${droppingsSites.map(s => `${s.site_id}=${s.bridge_dropped}`).join(', ')}`);
      }
    } catch (e) { console.error('[health] edge_sites query failed:', e.message); }

    try { result.alerts = await _alertHealth(pool); } catch { result.alerts = null; }

    res.json(result);
  });

  // Service Management — Start / Stop / Restart per PM2 worker.
  // Admin-only; server-side allowlist prevents injection via URL param.
  // execFile (not exec) — args passed as array, no shell interpolation.
  app.post('/api/services/:name/:action', auth.requireAdmin, async (req, res) => {
    const { name, action } = req.params;
    if (!_SVC_NAMES.has(name) || !_SVC_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'invalid_service_or_action' });
    }
    // api-server stop/start = self-destruction (dashboard bricks, no UI recovery).
    if (name === 'api-server' && (action === 'stop' || action === 'start')) {
      return res.status(400).json({ error: 'api_server_stop_start_disallowed' });
    }
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user.id, req.user.username, `service_${action}`, JSON.stringify({ service: name })]
      );
    } catch (e) { console.error('[audit_log] insert failed for service action:', e.message); }
    execFile('pm2', [action, name], { timeout: 10000 }, (err) => {
      // When api-server restarts itself, this callback may fire after the
      // process has already been replaced by PM2 — attempt to send, ignore error.
      if (name === 'api-server' && action === 'restart') {
        try { res.json({ ok: true, action, service: name, expect_reconnect: true }); } catch {}
      } else if (err) {
        try { routeError(res, err, 'POST /api/services/:name/:action'); } catch {}
      } else {
        try { res.json({ ok: true, action, service: name }); } catch {}
      }
    });
  });

  // B1 — Clear LPR forward spool (admin only; removes queued plate PII)
  // Deletes all files in each spool dir but keeps the dir itself so lpr-forward.js
  // can continue writing without re-init (writeFileSync after rm -rf dir = ENOENT).
  app.delete('/api/lpr/spool/clear', auth.requireAdmin, async (req, res) => {
    const SPOOL_BASE = path.join(SNAPSHOT_DIR, '..', 'spool');
    let cleared = 0;
    for (const sub of ['lpr-forward-api-server', 'lpr-forward-lpr-receiver']) {
      try {
        const dir = path.join(SPOOL_BASE, sub);
        for (const f of fs.readdirSync(dir)) {
          try { fs.unlinkSync(path.join(dir, f)); cleared++; } catch {}
        }
      } catch {}
    }
    try {
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, target_camera_id, details)
         VALUES ($1,$2,$3,NULL,$4)`,
        [req.user.id, req.user.username, 'lpr_spool_clear', JSON.stringify({ files_deleted: cleared })]
      );
    } catch (e) { console.error('[audit_log] lpr_spool_clear failed:', e.message); }
    res.json({ ok: true, files_deleted: cleared });
  });

  // Ph.3 — health report data endpoints (internal token only, called by report-renderer)
  // Cameras: current online/offline status (from cameras.last_seen_at) + uptime % over range
  // + offline duration (NOW - last_seen_at) so the report can show how long offline.
  app.get('/api/health/report-data/cameras', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(8760, parseInt(req.query.range_hours, 10) || 24));
      const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const config = loadCameraConfig();
      // Field is `camera_name` in cameras-config.json (not `name`).
      let cams = (config.cameras || [])
        .map(c => ({
          id:   c.camera_id || c.id,
          name: c.camera_name || c.name || c.camera_id || c.id,
        }))
        .filter(c => c.id);
      const allowedSites = req.user?.allowedSites ?? null;
      if (allowedSites !== null) {
        if (allowedSites.length === 0) return res.json({ summary: { total: 0, online: 0, offline: 0 }, list: [] });
        const { rows: siteRows } = await pool.query('SELECT id FROM cameras WHERE site_id = ANY($1)', [allowedSites]);
        const allowedCamIds = new Set(siteRows.map(r => r.id));
        cams = cams.filter(c => allowedCamIds.has(c.id));
      }
      const ids = cams.map(c => c.id);

      // Current online flag + last_seen_at + created_at (when added to system)
      const onlineSet = new Set();
      const pausedSet = new Set();
      const lastSeenByCamera = {};
      const createdByCamera = {};
      if (ids.length) {
        const r = await pool.query(
          `SELECT c.id, c.last_seen_at, c.created_at, c.paused,
                  (c.last_seen_at > NOW() - INTERVAL '${OFFLINE_THRESHOLD_SEC} seconds') AS is_online
           FROM cameras c
           WHERE c.id = ANY($1::text[])`,
          [ids]
        );
        for (const row of r.rows) {
          if (row.paused) { pausedSet.add(row.id); continue; } // paused cameras excluded from health report
          if (row.is_online) onlineSet.add(row.id);
          if (row.last_seen_at) lastSeenByCamera[row.id] = row.last_seen_at;
          if (row.created_at)   createdByCamera[row.id]  = row.created_at;
        }
      }

      // Last event and last event snapshot per camera. Snapshot is distinct
      // from "latest event": an event can exist even when snapshot capture
      // was disabled or failed.
      const lastEventByCamera = {};
      if (ids.length) {
        const ev = await pool.query(
          `SELECT camera_id, MAX(event_time) AS last_event_at
           FROM events
           WHERE camera_id = ANY($1::text[])
           GROUP BY camera_id`, [ids]
        );
        for (const row of ev.rows) lastEventByCamera[row.camera_id] = row.last_event_at;
      }

      // Last snapshot (event with snapshot) per camera — proxy for "last image
      // the system actually captured from this camera", distinct from heartbeat.
      // Ingester updates keep has_snapshot/snapshot_filename in sync with
      // raw_json._snapshot; the partial index keeps this query cheap.
      const lastSnapshotByCamera = {};
      if (ids.length) {
        const fr = await pool.query(
          `SELECT camera_id, MAX(event_time) AS last_snapshot_at
           FROM events
           WHERE camera_id = ANY($1::text[]) AND has_snapshot = TRUE
           GROUP BY camera_id`, [ids]
        );
        for (const row of fr.rows) lastSnapshotByCamera[row.camera_id] = row.last_snapshot_at;
      }

      // Snapshot quality diagnostics — per camera over query range.
      // Populated only for cameras that set raw_json._snapshot_status (Dahua ingester).
      const snapDiagByCamera = {};
      if (ids.length) {
        const sd = await pool.query(
          `SELECT camera_id, raw_json->>'_snapshot_status' AS snap_status, COUNT(*)::int AS cnt
           FROM events
           WHERE camera_id = ANY($1::text[])
             AND event_time >= $2
             AND raw_json ? '_snapshot_status'
           GROUP BY camera_id, raw_json->>'_snapshot_status'`,
          [ids, sinceIso]
        );
        for (const row of sd.rows) {
          if (!snapDiagByCamera[row.camera_id])
            snapDiagByCamera[row.camera_id] = { ok: 0, low_confidence: 0, missing: 0, failed: 0 };
          const k = row.snap_status;
          if (k in snapDiagByCamera[row.camera_id]) snapDiagByCamera[row.camera_id][k] = row.cnt;
        }
      }

      // Live ingester connection state — written by dahua-cgi.js process, null for other vendors.
      const ingesterStatusByCamera = {};
      if (ids.length) {
        const is = await pool.query(
          `SELECT camera_id, event_stream, snap_stream, retry_count,
                  last_event_http_status, last_snap_http_status, last_error_code, updated_at
           FROM ingester_camera_status
           WHERE camera_id = ANY($1::text[])`,
          [ids]
        );
        for (const row of is.rows) ingesterStatusByCamera[row.camera_id] = row;
      }

      // Uptime % over range from camera_status_log
      const uptimeR = await pool.query(`
        WITH log_range AS (
          SELECT camera_id, status, changed_at,
            LEAD(changed_at) OVER (PARTITION BY camera_id ORDER BY changed_at) AS next_at
          FROM camera_status_log
          WHERE changed_at >= $1
        ),
        durations AS (
          SELECT camera_id,
            SUM(CASE WHEN status='offline' THEN
              EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - changed_at)) ELSE 0 END
            ) AS offline_sec
          FROM log_range GROUP BY camera_id
        )
        SELECT camera_id, ROUND(((1 - offline_sec / ($2::float * 3600.0))*100)::numeric, 1) AS uptime_pct
        FROM durations`, [sinceIso, hours]);
      const uptimeByCamera = {};
      for (const r of uptimeR.rows) uptimeByCamera[r.camera_id] = parseFloat(r.uptime_pct);

      const nowMs = Date.now();
      const list = cams.map(c => {
        const isOnline = onlineSet.has(c.id);
        const lastSeen = lastSeenByCamera[c.id];
        const created  = createdByCamera[c.id];
        const lastEvent = lastEventByCamera[c.id];
        const lastSnapshot = lastSnapshotByCamera[c.id];
        // offline_for_sec: how long this camera has been offline
        //   null  = currently online (irrelevant)
        //   -1    = never seen (no row in `cameras` table at all)
        //   N>=0  = seconds since last_seen_at
        let offline_for_sec = null;
        if (!isOnline) {
          offline_for_sec = lastSeen
            ? Math.max(0, Math.floor((nowMs - new Date(lastSeen).getTime()) / 1000))
            : -1;
        }
        return {
          camera_id: c.id, name: c.name,
          status: pausedSet.has(c.id) ? 'paused' : (isOnline ? 'online' : 'offline'),
          uptime_pct: uptimeByCamera[c.id] === undefined ? null : uptimeByCamera[c.id],
          offline_for_sec,
          added_at:           created   ? new Date(created).toISOString()   : null,
          last_heartbeat_at:  lastSeen  ? new Date(lastSeen).toISOString()  : null,
          last_event_at:      lastEvent ? new Date(lastEvent).toISOString() : null,
          last_snapshot_at:   lastSnapshot ? new Date(lastSnapshot).toISOString() : null,
          snapshot_diag:      snapDiagByCamera[c.id] || null,
          ingester_status:    ingesterStatusByCamera[c.id] || null,
        };
      }).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      res.json({
        summary: {
          total: list.length,
          online: list.filter(c => c.status === 'online').length,
          offline: list.filter(c => c.status === 'offline').length,
        },
        list,
      });
    } catch (e) {
      console.error('[health/report-data/cameras] error:', e.message);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // Ph.3 — On-demand health report preview (PNG)
  // ponytail: renderer fetches data via INTERNAL_API_TOKEN (no user context); site isolation deferred to renderer phase
  // GET /api/health/report/preview
  //   ?sections=camera_status,camera_uptime,alerts,storage,system
  //     (legacy "cameras" expands to camera_status + camera_uptime)
  //   &range=24h|7d|30d|custom    (default 24h)
  //   &from=ISO&to=ISO            (when range=custom)
  //   &lang=th|en                 (default th)
  //   &download=1                 (force download)
  app.get('/api/health/report/preview', async (req, res) => {
    try {
      const reportRenderer = require('../report-renderer');
      const sectionsParam = String(req.query.sections || '').split(',').map(s => s.trim()).filter(Boolean);
      const sections = sectionsParam.length ? sectionsParam : null;
      const range = req.query.range === 'custom' && req.query.from && req.query.to
        ? { from: req.query.from, to: req.query.to, label: req.query.label || null }
        : { preset: req.query.range || '24h' };
      const lang = req.query.lang === 'en' ? 'en' : 'th';
      const png = await reportRenderer.renderHealthReportImage({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(),
        sections, range, lang,
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.download) {
        res.setHeader('Content-Disposition', `attachment; filename="health_report_${Date.now()}.png"`);
      }
      res.send(png);
    } catch (e) {
      console.error('[health/report/preview] error:', e.message);
      routeError(res, e, 'GET /api/health/report/preview');
    }
  });

  // Ph.3 — Health report as A4 PDF with page numbers
  // ponytail: same as preview — INTERNAL_API_TOKEN path; deferred to renderer phase
  // GET /api/health/report/pdf?sections=...&range=...&from=&to=&lang=...
  app.get('/api/health/report/pdf', async (req, res) => {
    try {
      const reportRenderer = require('../report-renderer');
      const sectionsParam = String(req.query.sections || '').split(',').map(s => s.trim()).filter(Boolean);
      const sections = sectionsParam.length ? sectionsParam : null;
      const range = req.query.range === 'custom' && req.query.from && req.query.to
        ? { from: req.query.from, to: req.query.to, label: req.query.label || null }
        : { preset: req.query.range || '24h' };
      const lang = req.query.lang === 'en' ? 'en' : 'th';
      const pdf = await reportRenderer.renderHealthReportPdf({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(),
        sections, range, lang,
        title: String(req.query.title || ''),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="health_report_${Date.now()}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error('[health/report/pdf] error:', e.message);
      routeError(res, e, 'GET /api/health/report/pdf');
    }
  });

  // Ph.3 — Send health report to LINE NOW (admin only) + log to report_history
  // body: { sections: [...], range: {preset|from+to}, recipients: ["U1","C2"], lang: 'th'|'en' }
  //   recipients: optional. If omitted/empty → defaults to all enabled in line_config
  //   (admin can pre-pick a subset on the Reports page)
  app.post('/api/health/report/send-now', async (req, res) => {
    try {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin role required' });
      }
      const reportRenderer = require('../report-renderer');
      const lineSender = require('../line-sender');
      const sectionsParam = Array.isArray(req.body.sections) ? req.body.sections : null;
      const sections = sectionsParam && sectionsParam.length ? sectionsParam : null;
      const range = (req.body.range && req.body.range.from && req.body.range.to)
        ? { from: req.body.range.from, to: req.body.range.to, label: req.body.range.label || null }
        : { preset: (req.body.range && req.body.range.preset) || '24h' };
      const lang = req.body.lang === 'en' ? 'en' : 'th';

      const cfgRes = await pool.query('SELECT * FROM line_config WHERE id = 1');
      const cfg = cfgRes.rows[0];
      if (!cfg || !cfg.enabled || !cfg.channel_access_token) {
        return res.status(400).json({ error: 'LINE is not enabled / no channel access token' });
      }
      const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
      const enabledIds = roster.filter(r => r.enabled).map(r => r.id);
      const requested = Array.isArray(req.body.recipients) ? req.body.recipients.filter(Boolean) : [];
      const recipientIds = requested.length
        ? enabledIds.filter(id => requested.includes(id))  // intersection: enabled + requested
        : enabledIds;
      if (recipientIds.length === 0) {
        return res.status(400).json({ error: 'no enabled LINE recipients selected' });
      }
      const png = await reportRenderer.renderHealthReportImage({
        baseUrl: `http://localhost:${PORT}`,
        internalToken: INTERNAL_API_TOKEN,
        brand: await getBrandForReport(),
        sections, range, lang,
        title: String(req.query.title || ''),
      });
      const tzForName = await getDisplayTz();
      const dateStr = new Date().toLocaleDateString('sv', { timeZone: tzForName });
      const fname = `report_health_${dateStr}_${Date.now()}.png`;
      await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png).catch(() => {});
      const result = await lineSender.sendReportToLine({
        token: cfg.channel_access_token,
        imgbbKey: cfg.imgbb_api_key,
        recipients: recipientIds,
        pngBuffer: png,
        caption: `📊 ${HEALTH_REPORT_TITLE_TH}\n${lang === 'en' ? 'Manual send' : 'ส่งทันที'}`,
      });
      // History row uses the actual rendered range (resolved via the renderer's
      // _normalizeRange — we duplicate the logic here so the row stores real
      // boundaries, not the preset string).
      let rangeFrom, rangeTo;
      if (range.from && range.to) {
        rangeFrom = new Date(range.from).toISOString();
        rangeTo   = new Date(range.to).toISOString();
      } else {
        const h = range.preset === '7d' ? 168 : range.preset === '30d' ? 720 : 24;
        rangeFrom = new Date(Date.now() - h * 3600 * 1000).toISOString();
        rangeTo   = new Date().toISOString();
      }
      await pool.query(
        `INSERT INTO report_history
           (schedule_id, report_type, range_from, range_to, image_layout,
            file_path, recipients_sent, sent_count, total_recipients, status, error_message)
         VALUES (NULL, 'health', $1, $2, NULL, $3, $4, $5, $6, $7, $8)`,
        [rangeFrom, rangeTo, fname, recipientIds.join(','),
         result.sentCount || 0, result.totalRecipients || recipientIds.length,
         result.success ? 'success' : 'failed',
         result.success ? null : String(result.error || 'send failed').slice(0, 500)]
      ).catch(() => {});
      res.json({
        success: result.success,
        sent_count: result.sentCount || 0,
        total_recipients: result.totalRecipients || recipientIds.length,
        error: result.error || null,
      });
    } catch (e) { routeError(res, e, 'POST /api/health/report/send-now'); }
  });

  // Alerts: success/failed/cooldown counts over a range_hours window (default 24h)
  app.get('/api/health/report-data/alerts', async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(8760, parseInt(req.query.range_hours, 10) || 24));
      res.json(await _alertHealth(pool, hours));
    } catch (e) { routeError(res, e, 'GET /api/health/report-data/alerts'); }
  });

};
