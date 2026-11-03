// ============================================================
// Vigil Platform — Health Check Routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const os     = require('os');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { execFile } = require('child_process');
// `pm2 jlist` used to run through execFileSync and blocked the event loop on
// every cache miss (~80ms measured, 5s worst case) — the whole API stalled while
// health rendered. Promisified so the spawn is awaited like any other probe.
const execFileP = promisify(execFile);
const emqxPublish = require('../helpers/emqxPublish');
const { rebootCamera, supportsReboot } = require('../helpers/cameraReboot');
const { sampleStorage } = require('../helpers/storageHealth');
const { hostSpec } = require('../helpers/hostMetrics');
const { spoolStats, clipsStats } = require('../helpers/storageStats');
const longTx = require('../helpers/longTxWatch');
const { createTtlCache, listCaches } = require('../helpers/ttlCache');
const rollupJobs = require('../jobs/rollups');
const { archivedCameraIds } = require('../helpers/siteStatus');
const healthReportingRoutes = require('./health-reporting');

const { OFFLINE_THRESHOLD_SEC, MQTT_HEALTHY_AGE_SEC } = require('../constants');
const env = require('../config');

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
// 35s, not 10s. The Health page polls this endpoint every 15s
// (page-health.js:15), so a 10s TTL expired before every single refresh: the
// cache never once served the page it exists for, and every poll paid 1.86s
// instead of 0.87s, forever, while the page was open.
//
// The TTL has to clear TWO poll intervals, not one. An entry is stamped when it
// is computed and not refreshed on a hit, so with a 15s poll a 20s TTL still
// misses every other time — measured, alternating 1.89s / 0.53s. 35s covers
// ages 15 and 30 and only misses at 45: measured miss/hit/hit, averaging 0.99s
// against 1.86s before. These two numbers are COUPLED: change the poll interval
// in page-health.js and this TTL silently degrades back to alternating misses.
// The trade is a figure up to 35s old on a page that
// redraws every 15s, which no operator can perceive — and the one number where
// staleness would actually matter, the MAX(event_time) ingest-liveness probe,
// is deliberately left uncached.
const _HEALTH_CACHE_TTL_MS = 35_000;
// helpers/ttlCache holds the PENDING promise, not just the settled value: caching
// only completed values meant N concurrent misses each ran the loader N times (the
// page polls while /api/health/report-data and any manual curl hit the same
// keys), which is exactly the stampede this cache exists to stop. TTL still
// counts from when the load STARTED, and a rejection evicts its own entry so the
// next call retries instead of the key staying poisoned for the full 35s.
// Module-level on purpose — shared by /api/health/details and
// /api/health/report-data/alerts, not one instance per mount.
const _healthCache = createTtlCache({ name: 'health:sections', ttlMs: _HEALTH_CACHE_TTL_MS });
const _cached = (key, fn) => _healthCache.wrap(key, fn);
// I/O error ของดิสก์จาก kernel log 24 ชม. — เหตุจริง 26 ก.ย. 2569: NVMe เขียน WAL ไม่สำเร็จ Postgres crash
// แล้วไม่มีอะไรบนหน้าจอบอก (GOTCHAS #217) · อ่าน journal ได้โดยไม่ต้อง sudo · แคช 10 นาที · อ่านไม่ได้ = null
const _diskIoCache = createTtlCache({ name: 'health:disk-io', ttlMs: 10 * 60 * 1000 });
// push token ไม่รู้จัก รอบ 10 นาทีล่าสุด — รวม api-server กับ lpr-receiver บนเครื่องนี้ (GOTCHAS #220)
// /face-push ที่ token ค้างวิ่งเข้า lpr-receiver · ถ้าอ่านจากโปรเซสนี้อย่างเดียวจะเห็น 0 ตลอด · lpr-receiver ไม่ตอบ = นับเฉพาะของเรา
async function _unknownPushTokens() {
  const out = { ...require('../helpers/unknownTokenLog').lastWindows() };
  try {
    const r = await fetch(`http://127.0.0.1:${env.int('LPR_RECEIVER_PORT')}/healthz`, { signal: AbortSignal.timeout(1500) });
    for (const [k, n] of Object.entries((await r.json()).unknown_push_tokens || {})) out[k] = (out[k] || 0) + n;
  } catch { /* lpr-receiver ไม่ได้รันบนเครื่องนี้ */ }
  return out;
}
// สุขภาพฐานข้อมูล — อ่านผลที่ perfWatch เก็บไว้ (ไม่คิดซ้ำ) + index ที่ไม่ถูกใช้ (เล็กกว่า 100 MB ไม่นับ:
// partition events ของอนาคตมี index ว่างหลายสิบตัว) · ⚠️ ตัวนับ idx_scan เริ่มใหม่เมื่อ Postgres crash/restart
async function _dbHealth(pool) {
  const [pw, idx] = await Promise.all([
    pool.query(`SELECT value FROM system_settings WHERE key = 'perf_watch'`),
    pool.query(`SELECT count(*)::int AS n, coalesce(sum(pg_relation_size(s.indexrelid)), 0)::bigint AS bytes
                  FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
                 WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
                   AND pg_relation_size(s.indexrelid) > 100 * 1024 * 1024`),
  ]);
  let p = null;
  try { p = JSON.parse(pw.rows[0]?.value || 'null'); } catch { p = null; }
  const h = Array.isArray(p?.db_history) ? p.db_history : [];
  let growth = null;
  if (h.length >= 2) {
    const days = (Date.parse(h[h.length - 1].day) - Date.parse(h[0].day)) / 86_400_000;
    if (days > 0) growth = +((h[h.length - 1].gb - h[0].gb) / days).toFixed(2);
  }
  return {
    checked_day: p?.day ?? null,
    db_gb: p?.db_gb ?? null,
    growth_gb_per_day: growth,
    slow_req: p?.slow_req ?? null, slow_req_limit: p?.slow_req_limit ?? null,
    regressions: (p?.regressions || []).length, fresh: (p?.fresh || []).length,
    stale_tables: (p?.stale_tables || []).map(t => t.table),
    unused_indexes: idx.rows[0].n, unused_index_gb: +(Number(idx.rows[0].bytes) / 1024 ** 3).toFixed(1),
  };
}
const _diskIoErrors24h = () => _diskIoCache.wrap('n', async () => {
  try {
    const { stdout } = await execFileP('journalctl',
      ['-k', '--since', '-24h', '--no-pager', '-o', 'cat', '-g', 'I/O error'], { timeout: 10000, maxBuffer: 4 << 20 });
    return stdout.split('\n').filter(Boolean).length;
  } catch (e) {
    return e.code === 1 ? 0 : null;   // journalctl -g ไม่เจอ = exit 1
  }
});

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
  let _futureWarnAt = 0;   // rate-limit ของคำเตือน event เวลาอนาคต (ชั่วโมงละครั้ง)
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
        load_avg_5m: parseFloat(os.loadavg()[1].toFixed(2)),
        load_avg_15m: parseFloat(os.loadavg()[2].toFixed(2)),
        host_uptime_sec: Math.floor(os.uptime()),
        cpu_count: os.cpus().length,
        total_mem_mb: Math.round(os.totalmem() / (1024 * 1024)),
        free_mem_mb: Math.round(os.freemem() / (1024 * 1024)),
        spec: hostSpec(),
      },
      // long_transactions ตั้งค่าเริ่มต้นไว้ที่นี่ด้วย เพราะมันถูกเติมข้างใน
      // บล็อก long_running_queries — ถ้าบล็อกนั้นพัง (pool ตัน) จะได้เป็น []
      // ไม่ใช่ undefined ที่หน้าเว็บอ่านแล้วพัง
      db: { ok: false, latency_ms: null, error: null, long_transactions: [] },
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
      // ตั้งค่าเริ่มต้นไว้ตรงนี้ด้วยเหตุผลเดียวกับ long_transactions ข้างบน — ถ้า DB
      // ล่มหรือยังไม่เคยมีผลตรวจ หน้าเว็บจะได้ null ไม่ใช่ key ที่หายไปเฉย ๆ
      lpr: { noread_check: null, helmet_metric_check: null },
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
    // 2026-08-19 incident: a stats query held a pool slot for 5+ min before
    // anyone noticed — pool counts above show symptoms (slots busy) but not
    // the cause (which query, how long). This surfaces that directly. Runs
    // on its own short-lived client with a 2s cap so a saturated pool can't
    // make the health check itself hang — the exact failure mode it exists
    // to catch.
    result.db.long_running_queries = await _time('longRunningQueries', async () => {
      let client;
      // pool.connect() has no per-call timeout and the main pool never set
      // connectionTimeoutMillis — with all 15 slots busy (the scenario this
      // exists to detect) it would otherwise queue and wait right alongside
      // everything else it's meant to report on. Race it against a timer
      // instead of trusting the pool to hand back a client promptly.
      const connectPromise = pool.connect();
      try {
        client = await Promise.race([
          connectPromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('pool exhausted (connect timed out)')), 2000)),
        ]);
        await client.query('SET statement_timeout = 2000');
        const { rows } = await client.query(`
          SELECT pid, round(EXTRACT(epoch FROM (now() - query_start)) * 1000)::int AS duration_ms,
                 left(query, 200) AS query
            FROM pg_stat_activity
           WHERE application_name = 'api-server' AND state = 'active'
             AND now() - query_start > interval '10 seconds'
           ORDER BY duration_ms DESC LIMIT 10`);
        // ── transaction ที่เปิดค้าง (คนละเรื่องกับ query ข้างบน) ───────────
        // query ข้างบนดู query_start + state='active' ⇒ มองไม่เห็นเคสที่กัดจริง
        // เมื่อ 2026-08-27: transaction เปิดค้าง 34 ชม. ในสถานะ idle in
        // transaction (ไม่มี query รันอยู่เลย แต่ตรึง vacuum horizon ไว้)
        // ใช้ client เดิมที่ SET statement_timeout=2000 ไปแล้ว — ไม่ขอ slot เพิ่ม
        result.db.long_transactions = await longTx.findLongTx(client);
        return rows;
      } catch (e) {
        // If connect() wins the race AFTER our timeout already rejected, it
        // still hands back a real client that nothing else will ever release
        // — that's a permanent stolen slot, worse than the problem this is
        // meant to catch. Grab it and release it the moment it resolves.
        if (!client) connectPromise.then(c => c.release()).catch(() => {});
        return { error: e.message };
      } finally { client?.release(); }
    });
    _poolWaitPeak = 0;

    if (result.db.ok) {
      try {
        // 🔴 ขอบบนกันเวลาอนาคต: กล้องนาฬิกาเพี้ยนเคยส่ง event ปี 2032 เข้ามา 7 แถว (2026-09-15)
        // MAX ได้ 2032 → อายุติดลบ → สถานะ "healthy" ตลอดแม้ข้อมูลหยุดจริง (GOTCHAS #217)
        const r = await pool.query(
          `SELECT MAX(event_time) AS last FROM events WHERE event_time <= now() + interval '5 minutes'`);
        // นับ event เวลาอนาคต (เกิน 1 ชม.) ให้เห็นในหน้าสุขภาพ — ตัด partition เหลือแค่ของอนาคต + default จึงถูก
        const fut = await pool.query(
          `SELECT count(*)::int AS n FROM events WHERE event_time > now() + interval '1 hour'`);
        result.mqtt_pipeline.future_events = fut.rows[0]?.n || 0;
        if (result.mqtt_pipeline.future_events && Date.now() - _futureWarnAt > 3600_000) {
          _futureWarnAt = Date.now();
          console.warn(`[health] ${result.mqtt_pipeline.future_events} event(s) dated more than 1 h in the future — camera clock?`);
        }
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
        // ไซต์ archived ไม่ใช่ส่วนของระบบที่ทำงานอยู่ — ซ่อนจากหน้าสด (ค้นหา/รายงานยังเห็น)
        const archived = await archivedCameraIds(pool);
        const config = loadCameraConfig();
        const liveCams = (config.cameras || []).filter(c => !archived.has(c.camera_id || c.id));
        const ids = liveCams
          .map(c => c.camera_id || c.id)
          .filter(Boolean);
        const total = ids.length;
        let online = 0;
        let paused = 0;
        let dbRows = [];
        if (ids.length) {
          const r = await pool.query(`
            SELECT id, name, ip_address, last_seen_at, paused,
                   EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS age_sec
            FROM cameras WHERE id = ANY($1::text[])`, [ids]);
          dbRows = r.rows;
          // กล้องที่ pause (หยุดชั่วคราวโดยแอดมิน) ไม่ใช่กล้องดับ — เดิมนับรวมเป็น offline
          // ทั้งหน้า Health และคำสั่ง LINE "กล้องที่ออฟไลน์" (ตรวจ 31 ต.ค.)
          online = dbRows.filter(row => !row.paused && row.age_sec != null && row.age_sec < OFFLINE_THRESHOLD_SEC).length;
          paused = dbRows.filter(row => row.paused).length;
        }
        const dbMap = new Map(dbRows.map(r => [r.id, r]));
        // offline = total - online so a config camera that has never
        // produced an event (no DB row) still counts as offline, not missing.
        result.cameras.total = total;
        result.cameras.online = online;
        result.cameras.paused = paused;
        result.cameras.offline = total - online - paused;
        result.cameras.list = liveCams.map(c => {
          const id = c.camera_id || c.id;
          const db = dbMap.get(id);
          const age = db?.age_sec ?? null;
          const status = db == null ? 'unknown' : db.paused ? 'paused' : (age != null && age < OFFLINE_THRESHOLD_SEC ? 'online' : 'offline');
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
        // Cached like the filesystem walks above, and for the same reason: this
        // single query is 408ms because COUNT(*) over events reads all 5.35M
        // rows, and it was being paid on every poll. Caching keeps the figures
        // EXACT — the alternative considered was reltuples/n_live_tup at 2-3ms,
        // rejected because an estimate can fall between two refreshes with
        // nothing deleted, and a total that ticks downward on the health page
        // reads as data loss. Cost also grows with the table: 408ms today,
        // ~1.2s at the 3x volume the new sites imply, so amortising it matters
        // more later than it does now.
        // NOT cached: the MAX(event_time) liveness probe above — that one is
        // the "is ingest alive" signal and must never be served stale.
        // Cache rows[0], not the pg Result — every other _cached key in this
        // file holds plain data, and a driver object living in a module-level
        // Map for 35s is a shape the next reader would have to stop and check.
        // ⚡ 10,130ms → ~1.7s (วัดจริง 2026-08-12) — บั๊กคลาสเดียวกับ clipStats ใน
        // stats-summary-route.js (decision #256): `COUNT(*) FILTER` บน `FROM events`
        // ที่ไม่มี WHERE ต้องอ่านครบทั้ง 15.3 ล้านแถวเพื่อประเมิน FILTER ทุกตัว
        // แม้ 2 ใน 5 ตัวจะถามแค่ช่วงเวลาสั้น ๆ ที่มี index อยู่แล้วก็ตาม
        //
        // แยกเป็น subquery ที่มี WHERE ของตัวเอง → แต่ละตัวเข้า index ที่เหมาะกับมัน
        // วัดทีละตัว: 1 ชม. 31ms · 24 ชม. 45ms · face 116ms · lpr 435ms · total 1,059ms
        // (`total` ยังต้องนับทั้งตาราง — ตัวเลขบนการ์ดเป็นยอดสะสมจริง ไม่ใช่ค่าประมาณ
        //  reltuples เร็วกว่ามาก (2ms) แต่คลาดเคลื่อน 0.24% ซึ่งดูเหมือนตัวเลขผิดบนหน้าจอ)
        //
        // ⚡ 2026-09-06 — **กลับคำตัดสินเรื่อง exact count ข้างบน**. ตาราง events โต
        // เป็น 40.5 ล้านแถว (partitioned): cold หลัง restart วัดได้ **40.5 วินาที**
        // (Postgres log) และ query ยังวิ่งต่อใน DB หลังจาก route timeout 2 วิ ยอมแพ้
        // ไปแล้ว — คือจ่ายค่า full scan ทิ้งเปล่า ๆ. 3 ตัวที่ไม่มีขอบเขตเวลา
        // (total / face_total / lpr_total) จึงเปลี่ยนไปใช้แหล่งประมาณ:
        //   · total     → SUM(reltuples) ของ partition ทุกใบ (pg_class + pg_inherits)
        //   · face/lpr  → SUM(n) จาก `event_dim_bucket` (rollup 30 นาที, migration 163)
        // วัดจริง 2026-09-06 เทียบกับ exact count: total 40,520,084 vs 40,527,319
        // (ต่ำไป 0.02%) · face 4,985,065 vs 4,985,374 (0.006%) · lpr 32,778,131 vs
        // 32,893,006 (0.35% — dim เริ่มเก็บ 2026-06-22 และไม่ได้ event ที่มาช้ากว่า 3 ชม.)
        // เหตุผลเดิมที่ปฏิเสธ reltuples (ตัวเลขกระตุกลงดูเหมือนข้อมูลหาย) แก้ด้วย
        // `totals_approx` → หน้าจอเติม `≈` นำหน้าเอง ผู้ใช้จึงรู้ว่าเป็นค่าประมาณ
        // GREATEST(reltuples,0) — PG13+ ให้ -1 กับ relation ที่ยังไม่เคย ANALYZE
        // (partition เดือนอนาคตที่เพิ่งสร้าง) ห้ามเอาไปลบยอดรวม
        // reltuples เป็น float4 → SUM() คืน real: ที่สเกล 4×10⁷ ULP = 4 ตัวเลข `total`
        // จึงขยับเป็นสเต็ปละ ~4 (เช่น ผลรวมเลขคณิตจริง 40,520,082 แต่ query คืน
        // 40,520,084) และอาจกระตุกลงได้แม้ยอดจริงเพิ่ม — จงใจไม่ cast ::numeric
        // ต่อค่า เพราะเป็นค่าประมาณอยู่แล้ว และ `≈` บนหน้าจอสื่อสารเรื่องนี้แทน
        // `SUM(n) FILTER` บน event_dim_bucket ทั้งตารางไม่ใช่บั๊กแบบ decision #256
        // ข้างบน: rollup มีแค่ ~300k แถว และเราต้องการ "ทั้งตาราง" อยู่แล้ว → สแกน
        // รอบเดียวจ่ายทั้งสองตัวเลข (สองรอบแยก 785ms → รอบเดียว 208ms)
        // h1 / h24 ไม่แตะ — เข้า index เวลาอยู่แล้ว (31ms / 45ms) และเป็นตัวเลข exact
        const r = await _time('event_counts', () => _cached('event_counts', async () => (await pool.query(`
          SELECT
            (SELECT count(*) FROM events WHERE event_time > NOW() - INTERVAL '1 hour')  AS h1,
            (SELECT count(*) FROM events WHERE event_time > NOW() - INTERVAL '24 hours') AS h24,
            (SELECT COALESCE(SUM(GREATEST(c.reltuples, 0)), 0)::bigint
               FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
              WHERE i.inhparent = 'events'::regclass AND c.relkind = 'r')                AS total,
            d.face_total,
            d.lpr_total
          FROM (
            SELECT
              COALESCE(SUM(n) FILTER (WHERE event_type IN ('FaceCapture', 'FaceRecognition')), 0)::bigint AS face_total,
              COALESCE(SUM(n) FILTER (WHERE event_type = 'anprAlarm'), 0)::bigint                        AS lpr_total
              FROM event_dim_bucket
          ) d
        `)).rows[0]));
        result.events.last_hour  = parseInt(r.h1, 10);
        result.events.last_24h   = parseInt(r.h24, 10);
        result.events.total      = parseInt(r.total, 10);
        result.events.face_total = parseInt(r.face_total, 10);
        result.events.lpr_total  = parseInt(r.lpr_total, 10);
        // ตั้งตรงนี้ ไม่ใช่ที่ default shape — query พังแล้วค่าเป็น 0 จะกลายเป็น "≈0"
        // ซึ่งอ้างว่าประมาณค่าของตัวเลขที่จริง ๆ แล้วแค่ดึงไม่สำเร็จ
        result.events.totals_approx = true;
      } catch {}
      try {
        const s = await getSystemSettings(pool, ['data_retention_days', 'snapshot_retention_days', 'clip_retention_days']);
        if (s.data_retention_days)     result.storage.retention_days_events    = parseInt(s.data_retention_days, 10);
        if (s.snapshot_retention_days) result.storage.retention_days_snapshots = parseInt(s.snapshot_retention_days, 10);
        if (s.clip_retention_days)     result.storage.retention_days_clips     = parseInt(s.clip_retention_days, 10);
      } catch {}
      // ผลตรวจรายสัปดาห์ของนิยาม "ไม่ทราบทะเบียน" (src/helpers/noreadCheck.js) —
      // อ่านแถวเดียวผ่าน cache 60 วิ ตัวเดียวกับ retention ข้างบน จึงแทบไม่มีต้นทุน
      // ตัวงานตรวจกิน ~16 วินาที แต่รันสัปดาห์ละครั้งนอก request นี้ ไม่ใช่ตรงนี้
      try {
        const s = await getSystemSettings(pool, ['lpr_noread_check', 'helmet_metric_check']);
        if (s.lpr_noread_check) result.lpr.noread_check = JSON.parse(s.lpr_noread_check);
        // ยามรายวันของตัวเลข "พร้อมข้อมูลทะเบียน" (src/helpers/helmetMetricCheck.js)
        // ok=false แปลว่ามีไซต์ที่อัตราตกต่ำกว่าช่วงปกติของตัวเอง หรือมีกล้องที่ยัง
        // ไม่มีเส้นแบ่งแล้วเริ่มรายงาน no_helmet (แถวผ่านเกณฑ์ 100% โดยไม่ถูกกรอง)
        if (s.helmet_metric_check) result.lpr.helmet_metric_check = JSON.parse(s.helmet_metric_check);
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
      //
      // ⚡ 2026-09-05 — ย้ายจาก `FROM events` (24 ชม. × LIKE สี่ตัว, วัดจริงรวมกับ
      // automation_triggers 9–10s บน endpoint ที่หน้า Health poll ทุก 15 วิ) มาอ่าน
      // event_dim_bucket แทน (rollup 30 นาที · migration 163) → 16 ms
      // ตัวเลขตามหลังของจริง ≤ ~5 นาที (รอบ refresher) ซึ่งเป็นการ์ดสรุป 24 ชม.
      // จึงไม่มีผล · ใส่ _cached ให้เหมือน event_counts เพราะ poll ถี่กว่า TTL
      // ⚠️ ต้อง COALESCE: `SUM(n) FILTER` คืน NULL (ไม่ใช่ 0) เมื่อกล้องนั้นไม่มี
      // type นั้นเลย — ปล่อยไว้จะกลายเป็น NaN → null ใน JSON ผิดจากของเดิม
      try {
        const r = await _time('image_quality', () => _cached('image_quality', async () => (await pool.query(`
          SELECT camera_id,
            COALESCE(SUM(n) FILTER (WHERE event_type LIKE 'ImageTooBright/%'), 0)    AS too_bright,
            COALESCE(SUM(n) FILTER (WHERE event_type LIKE 'ImageTooBlurry/%'), 0)    AS too_blurry,
            COALESCE(SUM(n) FILTER (WHERE event_type LIKE 'ImageTooDark/%'), 0)      AS too_dark,
            COALESCE(SUM(n) FILTER (WHERE event_type LIKE 'GlobalSceneChange/%'), 0) AS scene_change
          FROM event_dim_bucket
          WHERE bucket > NOW() - INTERVAL '24 hours'
            AND event_state = 'true'
            AND (event_type LIKE 'ImageTooBright/%' OR event_type LIKE 'ImageTooBlurry/%'
                 OR event_type LIKE 'ImageTooDark/%' OR event_type LIKE 'GlobalSceneChange/%')
          GROUP BY camera_id
          ORDER BY SUM(n) DESC`)).rows));
        result.image_quality = r.map(row => ({
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
      // ⚡ 2026-09-05 — ย้ายมา event_dim_bucket เหมือน image_quality ข้างบน
      // ⚠️ `last_trigger_at` = MAX(bucket) จึงมีความละเอียดแค่ 30 นาที (ปัดลงตาม
      // ขอบ bucket) — เก่ากว่าเวลาที่ I/O ยิงจริงได้ถึง 30 นาที. การ์ดนี้ตอบแค่
      // "วันนี้ I/O ทำงานไหม" จึงพอ · ต้องการเวลาแม่นวินาทีให้ไปดูหน้า Events
      try {
        const r = await _time('automation_triggers', () => _cached('automation_triggers', async () => (await pool.query(`
          SELECT camera_id,
            COALESCE(SUM(n) FILTER (WHERE event_type LIKE 'Trigger/DigitalInput/%'), 0) AS digital_input,
            COALESCE(SUM(n) FILTER (WHERE event_type LIKE 'Trigger/Relay/%'), 0)        AS relay,
            MAX(bucket) AS last_trigger_at
          FROM event_dim_bucket
          WHERE bucket > NOW() - INTERVAL '24 hours'
            AND event_state = 'true'
            AND event_type LIKE 'Trigger/%'
          GROUP BY camera_id
          ORDER BY SUM(n) DESC`)).rows));
        result.automation_triggers = r.map(row => ({
          camera_id:       row.camera_id,
          digital_input:   parseInt(row.digital_input, 10),
          relay:           parseInt(row.relay, 10),
          last_trigger_at: row.last_trigger_at ? new Date(row.last_trigger_at).toISOString() : null,
        }));
      } catch { result.automation_triggers = []; }
    }

    try {
      // เดินไฟล์ทั้งต้น (153k ไฟล์ 1.4 วิ วัด 2026-10-03) ทุกครั้งที่ cache 35 วิพลาด → ให้อายุ 10 นาที
      // + ตอบค่าเก่าระหว่างโหลดใหม่ (O10) · ยอดไฟล์บนการ์ดพื้นที่ไม่ต้องสดระดับวินาที
      const snap = await _time('snapshot_stats', () => _healthCache.wrap('snapshot_stats',
        () => _snapshotStats(SNAPSHOT_DIR), { ttlMs: 10 * 60_000, staleWhileRevalidate: true }));
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

    // Phase 6.1.5 — clip files on disk (shared with storage.js)
    try {
      const data = await _time('clips_dir', () => clipsStats(MEDIA_DIR));
      result.storage.clips_files = data.clips_files;
      result.storage.clips_mb = data.clips_mb;
    } catch {}

    // Storage/RAID health (2026-07-29) — same sampler the edge heartbeat rides
    // (src/helpers/storageHealth.js), called directly here since central is
    // local. disk_free_gb/disk_total_gb keep coming from the 'system' mount so
    // existing rows above are untouched; disk_health is the new mounts+raid detail.
    try {
      const st = await _time('storage_health', () => sampleStorage(SNAPSHOT_DIR));
      const sys = st.mounts.find(m => m.role === 'system');
      if (sys) {
        result.storage.disk_free_gb  = Math.round(sys.free_gb);
        result.storage.disk_total_gb = Math.round(sys.total_gb);
      }
      result.disk_health = st;
    } catch {}

    // A2 — LPR forward spool queue depth (shared with storage.js)
    try {
      const data = await _time('spool_dir', () => spoolStats(SNAPSHOT_DIR));
      result.storage.spool_files = data.spool_files;
      result.storage.spool_mb    = data.spool_mb;
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
          const { stdout } = await execFileP('pm2', ['jlist'],
            { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
          return JSON.parse(stdout);
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
      const EDGE_STALE_SEC = env.int('EDGE_HEARTBEAT_STALE_SEC');
      const esRows = await pool.query(`
        SELECT es.site_id, es.last_seen_at, es.disk_free_gb, es.disk_total_gb,
               es.bridge_forwarded, es.bridge_dropped, es.bridge_remote, es.bridge_local,
               es.pm2_json, es.snapshot_oldest, es.snapshot_dirs, es.storage_json, es.inventory_json, es.host_spec_json,
               extract(epoch from (now() - es.last_seen_at)) AS stale_sec,
               COALESCE(st.status, 'active') AS site_status
        FROM edge_status es
        LEFT JOIN sites st ON st.code = es.site_id
        ORDER BY es.site_id
      `);
      // The edge_status snapshot_oldest/_dirs columns are events-only (from
      // snapshotInventory, which scans events/). A face/LPR site (hkt) keeps
      // nothing under events/ and would read "—" despite days of face/lpr
      // snapshots. inventory_json carries the per-folder date-dirs, so fold the
      // oldest across events+lpr+face and count the union of date-dirs; fall
      // back to the events-only columns when no inventory has shipped yet.
      const _invAgg = (inv) => {
        const dates = new Set(); let oldest = null;
        for (const f of Object.values(inv || {})) {
          ((f && f.dates) || []).forEach(d => dates.add(d));
          if (f && f.oldest && (!oldest || f.oldest < oldest)) oldest = f.oldest;
        }
        return { oldest, dirs: dates.size };
      };
      result.edge_sites = esRows.rows.map(r => ({
        site_id:          r.site_id,
        last_seen_at:     r.last_seen_at,
        stale:            r.stale_sec > EDGE_STALE_SEC,
        // sites.status — dashboard แสดงป้ายปิดปรับปรุงแทนป้ายขาดการติดต่อ (migration 285)
        status:           r.site_status,
        stale_sec:        Math.round(r.stale_sec),
        disk_free_gb:     r.disk_free_gb,
        disk_total_gb:    r.disk_total_gb,
        snapshot_oldest:  _invAgg(r.inventory_json).oldest || r.snapshot_oldest,
        snapshot_dirs:    _invAgg(r.inventory_json).dirs   || r.snapshot_dirs,
        // storage_json — mounts + mdraid state (src/helpers/storageHealth.js),
        // null until the site's edge-bridge has shipped it at least once.
        storage:          r.storage_json || null,
        // host_spec_json — static host info (CPU, RAM, OS), null until edge-bridge ships it
        host_spec:        r.host_spec_json || null,
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

    // แคชในโปรเซสทุกตัว (hit/miss/inflight/stale/evictions) — อ่านจาก registry
    // ของ helpers/ttlCache ไม่มีคิวรี ไม่มี I/O
    result.caches = listCaches();

    // งาน rollup รายคาบ (helmet · traffic · kpi · category) — รันอยู่ไหม สำเร็จ
    // ล่าสุดเมื่อไหร่ ล้มด้วยอะไร รอบหน้าเมื่อไหร่ · ในหน่วยความจำล้วน ไม่มีคิวรี
    // เหตุผลที่ต้องมี: reconcile ของ traffic ล้มทุกคืนหลายเดือนโดยไม่มีใครรู้
    // เพราะ "รันแล้วไม่มีงาน" กับ "พัง" เงียบเหมือนกันใน log (VMOD-05)
    result.jobs = rollupJobs.status();

    // ความถูกต้องของระบบ — สัญญาณของบั๊กเงียบ 4 ประเภทที่เจอจากการตรวจ 2026-10-02 (GOTCHAS #217)
    // ทุกตัวเป็นการอ่านล้วน คิวรีละ <5 ms · ok=false คือมีเรื่องต้องดู
    try {
      const [base, stuck] = await Promise.all([
        pool.query(`SELECT max(computed_at) AS at FROM camera_event_baseline`),
        // heartbeat สดแต่ยังถูกนับ offline เกิน 1 ชม. = ด่านยืนยันกล้องไม่ผ่าน (เคส Bosch D5)
        pool.query(`SELECT c.id FROM cameras c
                     WHERE NOT c.enabled AND NOT COALESCE(c.paused, false)
                       AND c.last_mqtt_at > now() - interval '10 minutes'
                       AND COALESCE((SELECT max(changed_at) FROM camera_status_log l WHERE l.camera_id = c.id),
                                    'epoch') < now() - interval '1 hour'
                     ORDER BY 1 LIMIT 20`),
      ]);
      const baseAt = base.rows[0]?.at || null;
      const wsb = req.app.locals.wsBridgeListen;
      result.integrity = {
        future_events: result.mqtt_pipeline.future_events ?? null,          // D4
        baseline_computed_at: baseAt,                                          // D2
        baseline_stale: !baseAt || Date.now() - new Date(baseAt).getTime() > 26 * 3600_000,
        ws_bridge_connected: wsb ? wsb.isConnected() : null,                   // D3
        cameras_stuck_offline: stuck.rows.map((r) => r.id),                    // D5
        disk_io_errors_24h: await _diskIoErrors24h(),                          // D1
        // push ที่ token ไม่ตรงกล้องไหน รอบ 10 นาทีล่าสุด — มัก = slot ในกล้องค้าง token เก่า (D15 · GOTCHAS #220)
        unknown_push_tokens: await _unknownPushTokens(),
      };
    } catch (e) {
      console.error('[health] integrity checks failed:', e.message);
      result.integrity = null;
    }

    // สุขภาพฐานข้อมูล (preventive P3 · 2026-10-06) — ผลของยามรายวัน helpers/perfWatch.js (18:25)
    // + ขนาด/อัตราโต + index ใหญ่ที่ไม่ถูกใช้ · แคช 10 นาที (ตัวเลขรายวัน ไม่ต้องสดระดับวินาที)
    try {
      result.db_health = await _healthCache.wrap('db_health', () => _dbHealth(pool),
        { ttlMs: 10 * 60_000, staleWhileRevalidate: true });
      const g = result.db_health.growth_gb_per_day, free = result.storage?.disk_free_gb;
      result.db_health.disk_free_gb = free ?? null;
      result.db_health.disk_days_left = g > 0 && free != null ? Math.floor(free / g) : null;
    } catch (e) {
      console.error('[health] db_health failed:', e.message);
      result.db_health = null;
    }

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

  // Edge service control (H2, 2026-07-27). Same idea as the route above, but the
  // process is on another machine, so the "run it" step is an MQTT command on the
  // channel the config push / NVR scan / model detect / media delete already use.
  //
  // The allowlists below are a duplicate of the edge agent's on purpose. The edge
  // is the real gate — anything that can publish to its broker reaches it without
  // passing through here — but a request that will be refused there should not
  // travel at all, and rejecting it here is what puts a reason in front of the
  // operator and a row in audit_log.
  const _EDGE_SVC_NAMES   = new Set(['nanomq', 'mosquitto', 'hikvision', 'dahua', 'lpr-receiver',
                                     'edge-config-agent', 'edge-bridge', 'pm2-logrotate']);
  const _EDGE_SVC_ACTIONS = new Set(['restart', 'start', 'stop']);
  // Stopping these cuts the only path back in: nanomq/mosquitto is whichever
  // broker the site runs (EDGE_BROKER — only one at a time), edge-bridge is
  // the link to central, edge-config-agent is the listener. Recovery would be
  // a site visit. Restart is fine — they come back.
  const _EDGE_SVC_NO_STOP = new Set(['nanomq', 'mosquitto', 'edge-bridge', 'edge-config-agent']);

  app.post('/api/edge/:site/services/:name/:action', auth.requireAdmin, async (req, res) => {
    const { site, name, action } = req.params;
    if (!_EDGE_SVC_NAMES.has(name) || !_EDGE_SVC_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'invalid_service_or_action' });
    }
    if (action === 'stop' && _EDGE_SVC_NO_STOP.has(name)) {
      return res.status(400).json({ error: 'stop_would_cut_command_channel' });
    }
    try {
      // Only sites that have actually reported. Stops a typo'd or invented site
      // from publishing a pm2 command into a namespace nobody is watching.
      const { rows } = await pool.query('SELECT 1 FROM edge_status WHERE site_id = $1', [site]);
      if (!rows.length) return res.status(404).json({ error: 'unknown_site' });

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user.id, req.user.username, `edge_service_${action}`,
         JSON.stringify({ site, service: name })]
      ).catch(e => console.error('[audit_log] edge service action:', e.message));

      const reqId = crypto.randomUUID();
      await emqxPublish(`projects/${site}/_config/svc`, {
        req_id: reqId, name, action,
        secret: env.str('CAMERA_SECRET_KEY'),   // edge-config-agent command gate
      });
      // 202, not 200: the command has been handed to the broker, not carried out.
      // The edge replies on _config/svc-result within a second or so and
      // mqtt-subscriber parks it on edge_status.last_svc_result, which the page
      // is already polling — that, not this response, is the confirmation.
      res.status(202).json({ accepted: true, req_id: reqId, site, service: name, action });
    } catch (e) { routeError(res, e, 'POST /api/edge/:site/services/:name/:action'); }
  });

  // Camera reboot (2026-07-27). The most destructive action the dashboard has:
  // the camera is blind for 60-90 seconds and nothing can call it back. Approved
  // with an explicit guard list, all of which is enforced here:
  //   admin only ......... auth.requireAdmin (auditors cannot)
  //   typed confirmation . the client must echo the camera's exact name
  //   one at a time ...... the route takes a single id, there is no bulk form
  //   audited ............ audit_log before the command leaves
  //   supported vendors .. Dahua, Hikvision and Bosch (RCP+ CONF_BOARD_RESET);
  //                        anything else is refused rather than silently
  //                        doing nothing
  // Edge cameras go over the same MQTT command channel as everything else,
  // because central cannot route to a site LAN — and the credential never
  // travels: the edge reads it from its own decrypted config.
  app.post('/api/cameras/:id/reboot', auth.requireAdmin, async (req, res) => {
    const camId = req.params.id;
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.name, c.ip_address, c.http_port, c.site_id, s.code AS site_code
         FROM cameras c LEFT JOIN sites s ON s.id = c.site_id WHERE c.id = $1`, [camId]);
      const cam = rows[0];
      if (!cam) return res.status(404).json({ error: 'unknown_camera' });

      // Typed confirmation is checked server-side too. A confirm dialog only
      // protects the person who sees it; this also covers anything replaying or
      // scripting the endpoint.
      if (String(req.body?.confirm_name || '').trim() !== String(cam.name || '').trim()) {
        return res.status(400).json({ error: 'confirm_name_mismatch' });
      }

      const cfg = (loadCameraConfig()?.cameras || []).find(c => (c.camera_id || c.id) === camId);
      const vendor = cfg ? String(cfg.vendor || 'bosch').toLowerCase() : '';
      if (!supportsReboot(vendor)) {
        return res.status(400).json({ error: 'reboot_not_supported', vendor: vendor || null });
      }

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user.id, req.user.username, 'camera_reboot',
         JSON.stringify({ camera_id: camId, name: cam.name, site: cam.site_code, vendor })]
      ).catch(e => console.error('[audit_log] camera reboot:', e.message));

      if (cam.site_code && cam.site_code !== 'main') {
        const reqId = crypto.randomUUID();
        await emqxPublish(`projects/${cam.site_code}/_config/reboot-device`, {
          req_id: reqId, camera_id: camId, secret: env.str('CAMERA_SECRET_KEY'),
        });
        // 202: handed to the broker. The edge does the HTTP call and the camera
        // going offline in the Devices tab is the real confirmation.
        return res.status(202).json({ accepted: true, via: 'edge', site: cam.site_code, req_id: reqId });
      }

      const r = await rebootCamera({
        ip_address: cam.ip_address, http_port: cam.http_port,
        username: cfg?.username, password: cfg?.password, vendor,
      });
      console.warn(`[camera-reboot] ${camId} by ${req.user.username}: ${r.ok ? 'accepted' : r.error}`);
      return res.status(r.ok ? 200 : 502).json({ ...r, via: 'central' });
    } catch (e) { routeError(res, e, 'POST /api/cameras/:id/reboot'); }
  });

  // NVR chassis reboot (2026-07-27). Same destructive action as the single-
  // camera reboot above, aimed at a device_id instead of a cameras.id — an
  // NVR's channels are logical channels of ONE physical box (confirmed via DB:
  // every channel sharing a device_id shares the same ip_address/http_port),
  // so the vendor's device-level reboot command (same rebootCamera(), same
  // magicBox.cgi / ISAPI System/reboot) reboots the whole chassis — every
  // channel on it goes dark together, not just one. This needed its own route
  // rather than a device_id fallback on /api/cameras/:id/reboot because the
  // confirm-name semantics differ: there is no single "camera name" for a
  // chassis, so the operator is shown and must type the device_id itself.
  app.post('/api/devices/nvr/:deviceId/reboot', auth.requireAdmin, async (req, res) => {
    const deviceId = req.params.deviceId;
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.ip_address, c.http_port, c.site_id, s.code AS site_code,
                count(*) OVER() AS channel_count
           FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
          WHERE c.device_id = $1
          LIMIT 1`, [deviceId]);
      const rep = rows[0];
      if (!rep) return res.status(404).json({ error: 'unknown_device' });

      if (String(req.body?.confirm_name || '').trim() !== deviceId.trim()) {
        return res.status(400).json({ error: 'confirm_name_mismatch' });
      }

      const cfg = (loadCameraConfig()?.cameras || []).find(c => (c.camera_id || c.id) === rep.id);
      const vendor = String(cfg?.vendor || '').toLowerCase();
      if (!supportsReboot(vendor)) {
        return res.status(400).json({ error: 'reboot_not_supported', vendor: vendor || null });
      }

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user.id, req.user.username, 'nvr_reboot',
         JSON.stringify({ device_id: deviceId, channel_count: rep.channel_count, site: rep.site_code, vendor })]
      ).catch(e => console.error('[audit_log] nvr reboot:', e.message));

      if (rep.site_code && rep.site_code !== 'main') {
        const reqId = crypto.randomUUID();
        await emqxPublish(`projects/${rep.site_code}/_config/reboot-device`, {
          req_id: reqId, camera_id: rep.id, secret: env.str('CAMERA_SECRET_KEY'),
        });
        return res.status(202).json({ accepted: true, via: 'edge', site: rep.site_code, req_id: reqId, channel_count: rep.channel_count });
      }

      const r = await rebootCamera({
        ip_address: rep.ip_address, http_port: rep.http_port,
        username: cfg?.username, password: cfg?.password, vendor,
      });
      console.warn(`[nvr-reboot] ${deviceId} (rep ${rep.id}) by ${req.user.username}: ${r.ok ? 'accepted' : r.error}`);
      return res.status(r.ok ? 200 : 502).json({ ...r, via: 'central', channel_count: rep.channel_count });
    } catch (e) { routeError(res, e, 'POST /api/devices/nvr/:deviceId/reboot'); }
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

  // ── กลุ่ม route ที่แยกออกไปเป็นไฟล์ย่อย — เรียกตรงตำแหน่งที่ route กลุ่มนั้น
  //    เคยลงทะเบียนตอนไฟล์นี้ถือครบทั้ง 13 ตัว (ลำดับคือพฤติกรรม) ──
  healthReportingRoutes(app, pool, {
    auth, routeError,
    loadCameraConfig, getBrandForReport, REPORTS_DIR, getDisplayTz,
    INTERNAL_API_TOKEN,
    _alertHealth,
  });

};
