// ============================================================
// Vigil Platform — Alert Worker
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Standalone process: LISTENs on two pg_notify channels
//   • alert_event        — JSON payload from mqtt-subscriber; calls alertEngine.onEvent()
//   • alert_rules_changed — signals cache invalidation; calls alertEngine.invalidateCache()
//
// Isolated from api-server + mqtt-subscriber so LINE/push failures
// never crash ingestion or the web API.
// ============================================================

const { Pool, Client } = require('pg');
const http = require('http');
require('dotenv').config();
require('./singleton')('alert-worker');  // refuse to run a second copy

const alertEngine = require('./alert-engine');

const _workerStartedAt = Date.now();
const ALERT_WORKER_PORT = parseInt(process.env.ALERT_WORKER_PORT || '3002', 10);

// ── DB pool for alert-engine (queries, cooldown updates, logs) ──
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 3,
  application_name: 'alert-worker',
});

pool.on('error', (e) => console.error('[alert-worker] pool error:', e.message));

alertEngine.init(pool);
console.log('[alert-worker] ✅ Alert engine initialized');

// ── LISTEN loop ─────────────────────────────────────────────────
let _listenerConnected = false;

async function listenForAlerts() {
  const client = new Client({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  client.on('error', (e) => {
    _listenerConnected = false;
    console.error('[alert-worker] LISTEN client error:', e.message);
    setTimeout(listenForAlerts, 5_000);
  });

  client.on('notification', (msg) => {
    if (msg.channel === 'alert_event') {
      let payload;
      try { payload = JSON.parse(msg.payload); } catch { return; }
      if (!payload?.event_id || !payload?.camera_id) return;
      alertEngine.onEvent(payload).catch((e) =>
        console.error('[alert-worker] onEvent error:', e.message)
      );
      return;
    }
    if (msg.channel === 'alert_rules_changed') {
      alertEngine.invalidateCache().catch((e) =>
        console.error('[alert-worker] invalidateCache error:', e.message)
      );
    }
  });

  await client.connect();
  await client.query('LISTEN alert_event');
  await client.query('LISTEN alert_rules_changed');
  _listenerConnected = true;
  console.log('[alert-worker] 👂 LISTEN alert_event + alert_rules_changed');
}

listenForAlerts().catch((e) => {
  console.error('[alert-worker] Fatal startup error:', e.message);
  process.exit(1);
});

// ── Dwell alert loop (migration 044) ─────────────────────────────
// เช็ค "อยู่นานผิดปกติ" ทุก 60s — อยู่ที่ worker นี้ตัวเดียวเท่านั้น
// (alert-engine ถูก init ใน api-server/ingesters ด้วย ถ้า engine ตั้ง
// interval เองทุก process จะยิงซ้ำ). cooldown ของ rule กันเตือนถี่อยู่แล้ว
setInterval(() => {
  alertEngine.checkDwellRules()
    .catch((e) => console.error('[alert-worker] dwell check error:', e.message || e));
}, 60 * 1000);
console.log('[alert-worker] ⏱️ dwell alert loop every 60s');

// ── Edge stale alert loop (EM6) ───────────────────────────────────
// เช็คทุก 5 นาที — site ที่ไม่ส่ง heartbeat > EDGE_HEARTBEAT_STALE_SEC ส่ง LINE
setInterval(() => {
  alertEngine.checkEdgeStale()
    .catch((e) => console.error('[alert-worker] edge stale check error:', e.message || e));
}, 5 * 60 * 1000);
console.log('[alert-worker] ⏱️ edge stale alert loop every 5m');

// ── Health endpoint ──────────────────────────────────────────────
// Bound to loopback only; no auth required (no secrets exposed).
http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  const t0 = Date.now();
  pool.query('SELECT 1')
    .then(() => {
      const body = {
        ok: _listenerConnected,
        worker: 'alert-worker',
        uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
        pid: process.pid,
        memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        db: { ok: true, latency_ms: Date.now() - t0 },
        listener: { connected: _listenerConnected },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    })
    .catch((e) => {
      const body = {
        ok: false,
        worker: 'alert-worker',
        uptime_sec: Math.floor((Date.now() - _workerStartedAt) / 1000),
        pid: process.pid,
        memory_rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        db: { ok: false, latency_ms: null, error: e.message },
        listener: { connected: _listenerConnected },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
}).listen(ALERT_WORKER_PORT, '127.0.0.1', () => {
  console.log(`[alert-worker] health on 127.0.0.1:${ALERT_WORKER_PORT}`);
});
