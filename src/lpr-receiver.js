// ============================================================
// Vigil Platform — LPR / Face Push Receiver (standalone process)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CS7 — an INDEPENDENT, always-up process hosting the public push receivers
// (/lpr ANPR, /face-push/:token) that previously rode on api-server. Why split:
// restarting / redeploying api-server (the big dashboard process) currently
// drops the push endpoints, and our /lpr forward is a government system's only
// feed (see lpr-forward.js). This process has no UI, no WS, no auth surface —
// just the two receivers — so it stays up across dashboard work.
//
// It REUSES routes/lpr.js + routes/face-push.js verbatim (same modules
// api-server mounts) — no logic is duplicated. Cross-process pg_notify reaches
// the api-server ws-bridge LISTENer, so the dashboard still updates live.
//
// Bind: 0.0.0.0 (LAN-accessible) so central api-server can proxy-fetch /snapshots
// from this node via SNAPSHOT_PROXY_URL. Public ingress for /lpr + /face-push
// remains the Cloudflare tunnel; override via LPR_BIND_HOST env if needed.
//
// DEPLOY (deferred, user-run): add the PM2 entry (already in ecosystem.config.js),
// start via the LAN-safe Terminal path (GOTCHAS #84 — never from a Claude/ssh
// shell), then flip the cloudflared ingress (^/lpr$ + ^/face-push → :3003).
// Until that flip, api-server still serves both paths (rollback = flip back).
// ============================================================
'use strict';
process.env.APP_NAME = 'lpr-receiver'; // spool dir isolation (procTag fix)

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const { decryptCamCreds } = require('./crypto-creds');
require('dotenv').config();
require('./singleton')('lpr-receiver');   // refuse to run a second copy

const PORT = parseInt(process.env.LPR_RECEIVER_PORT || '3003', 10);
const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');
const CONFIG_FILE  = path.join(__dirname, '..', 'cameras-config.json');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 5,
  application_name: 'lpr-receiver',
});
// Match api-server: every session UTC (date-boundary correctness).
pool.on('connect', async (client) => {
  try { await client.query("SET TIME ZONE 'UTC'"); } catch { /* ignore */ }
});

// Own mtime-cached config loader (advisor #5) — re-reads on file change so
// Web-UI camera edits (saved by api-server) reach this process. Same shape as
// api-server.js / mqtt-subscriber.js (config is the camera source of truth).
let _cfgCache = null, _cfgMtime = 0;
function loadCameraConfig() {
  try {
    const mtime = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0;
    if (mtime !== _cfgMtime) {
      const raw = mtime ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : { cameras: [] };
      if (raw.cameras) raw.cameras = raw.cameras.map(decryptCamCreds);
      _cfgCache = raw;
      _cfgMtime = mtime;
    }
    return _cfgCache || { cameras: [] };
  } catch (e) { console.error('[lpr-receiver] config load error:', e.message); return { cameras: [] }; }
}

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

// Liveness probe (used by the deploy verify + any future monitor).
app.get('/healthz', (req, res) => res.json({ ok: true, app: 'lpr-receiver', port: PORT }));

// Mount the SAME route modules api-server uses — no duplicated logic.
require('./routes/lpr')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });
require('./routes/face-push')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });

// T2-A: proxy endpoint — Central api-server fetches N150 snapshots through here.
// Bearer token matches SNAPSHOT_PROXY_SECRET in both .env files.
const SNAPSHOT_PROXY_SECRET = process.env.SNAPSHOT_PROXY_SECRET || '';
const _serveSnapshots = require('express').static(SNAPSHOT_DIR, { dotfiles: 'deny', index: false });
app.use('/snapshots', (req, res, next) => {
  if (!SNAPSHOT_PROXY_SECRET || req.headers['authorization'] !== `Bearer ${SNAPSHOT_PROXY_SECRET}`)
    return res.status(401).end();
  next();
}, _serveSnapshots);

const BIND_HOST = process.env.LPR_BIND_HOST || '0.0.0.0';
const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`[lpr-receiver] listening on ${BIND_HOST}:${PORT} (/lpr, /face-push/:token, /healthz, /snapshots)`);
});

function shutdown(sig) {
  console.log(`[lpr-receiver] ${sig} — closing`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
