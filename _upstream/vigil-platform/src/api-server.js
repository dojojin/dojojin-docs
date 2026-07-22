// ============================================================
// Vigil Platform — API Server
// CCTV Analytics & Management Suite
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @version   1.0.0
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary — Unauthorized copying, distribution, or use
//            of this file is strictly prohibited.
// ============================================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
require('dotenv').config();
process.env.APP_NAME = 'api-server'; // spool dir isolation (procTag fix)

const app = express();

// 🔐 Trust proxy — สำคัญสำหรับ Cloudflare Tunnel / reverse proxy
// ทำให้ req.secure และ req.ip ทำงานถูกต้องเมื่ออยู่หลัง proxy
// 'loopback' = trust traffic จาก localhost (cloudflared มาจาก localhost)
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
// 🔐 WebSocket — reject the upgrade BEFORE it completes if the request
// carries no valid session. The broadcast stream is PDPA-sensitive (event
// details, Face Capture attributes, snapshot filenames), so an anonymous
// client must never be allowed to subscribe. Token sources mirror the REST
// API: the `session` cookie (sent automatically on a same-origin upgrade)
// or a `?token=` query param (Safari ITP fallback). `auth` is required
// further down — verifyClient is a closure, only invoked at connect time.
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, cb) => {
    let token = null;
    try { token = new URL(info.req.url, 'http://x').searchParams.get('token'); } catch {}
    if (!token && info.req.headers.cookie) {
      for (const c of info.req.headers.cookie.split(';')) {
        const [k, ...v] = c.trim().split('=');
        if (k === 'session') { token = decodeURIComponent(v.join('=')); break; }
      }
    }
    if (!token) return cb(false, 401, 'Unauthorized');
    auth.getUserFromToken(token)
      .then(u => cb(!!u, u ? 200 : 401, u ? 'OK' : 'Unauthorized'))
      .catch(() => cb(false, 500, 'Auth error'));
  },
});

const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');
const CONFIG_FILE = path.join(__dirname, '..', 'cameras-config.json');
const GROUPS_FILE = path.join(__dirname, '..', 'camera-groups.json');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 15,
  application_name: 'api-server',
});

// บังคับ session ทุก connection ให้ใช้ UTC — กันปัญหา timezone mismatch
pool.on('connect', async (client) => {
  try { await client.query("SET TIME ZONE 'UTC'"); } catch (e) { /* ignore */ }
});

// 🔐 CORS — allowlist, not blanket reflection. The dashboard is served
// SAME-ORIGIN by this Express app, so cross-origin access is never needed
// in normal use. Reflecting an arbitrary Origin with credentials:true (the
// old behaviour) let any website the operator visited issue authenticated
// calls and read the responses. We allow: (a) genuine same-origin requests
// — Origin host === Host, so the dashboard keeps working however it's
// reached (Cloudflare domain, LAN IP, localhost); (b) any extra origins
// explicitly listed in ALLOWED_ORIGINS (.env, comma-separated).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  let allow = false;
  if (!origin) {
    allow = true;                          // same-origin nav / curl / native app
  } else {
    try { allow = new URL(origin).host === req.headers.host; } catch {}
    if (!allow && ALLOWED_ORIGINS.includes(origin)) allow = true;
  }
  cb(null, {
    origin: allow ? (origin || true) : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'X-Internal-Token'],
    exposedHeaders: ['Set-Cookie', 'X-Total-Count'],
  });
}));
// 🔒 Security headers — token lives in localStorage for Safari ITP fallback,
// so XSS impact is higher than cookie-only auth. Apply conservative headers:
// nosniff stops MIME-type confusion, DENY blocks clickjacking, same-origin
// limits referrer leakage.
// SEC-006 / Phase 1b–5: CSP enforced on ALL routes (Phase 5 ✅ 2026-06-05).
//   /others/*  → Content-Security-Policy (enforced) — auth-gated, no dashboard deps
//   dashboard  → Content-Security-Policy (enforced) — zero inline scripts/handlers; policy gaps patched
// All inline onclick= / onerror= attrs removed (Phase 1–4). report-uri kept for drift detection.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  const host = req.headers.host || '';
  const p = req.path;

  if (p === '/others' || p.startsWith('/others/')) {
    // SEC-1b: /others is auth-gated + no dashboard deps → enforce CSP now.
    // style-src unsafe-inline stays for inline <style> blocks in static HTML files.
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      // SEC-3T-001: cdn.jsdelivr.net removed — all JS vendored under /vendor/
      "script-src 'self'; " +
      // SEC-3T-005: <style> elements locked to files (inline blocks extracted);
      // style-src-attr stays unsafe-inline — JS templates use style="" attrs.
      // Bare style-src kept as fallback for browsers without -elem/-attr support.
      "style-src 'self' 'unsafe-inline'; " +
      "style-src-elem 'self'; " +
      "style-src-attr 'unsafe-inline'; " +
      "img-src 'self' data: blob:; " +
      "font-src 'self' data:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'"
    );
  } else {
    // Dashboard: Enforced (Phase 5 ✅ 2026-06-05) — zero inline scripts/handlers + policy gaps patched.
    // report-uri kept in enforce mode to catch any future policy drift.
    // SEC-3T-001 (2026-06-10): cdn.jsdelivr.net removed from script-src/style-src —
    // OpenLayers + Chart.js + date-fns adapter vendored under dashboard/vendor/.
    // Policy covers:
    //   script-src: + CF analytics beacon (static.cloudflareinsights.com)
    //   img-src:    + tile.openstreetmap.org (OSM map tiles, both bare + wildcard)
    //   worker-src: blob: (OpenLayers web workers)
    //   connect-src: + cloudflareinsights.com (CF beacon telemetry POST)
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' https://static.cloudflareinsights.com; " +
      // SEC-3T-005: inline <style> blocks extracted to index/login/disclaimer/
      // report-print .css — style-src-elem locks elements to files; attrs stay
      // (790 style="" usages in JS templates); bare style-src = legacy fallback.
      "style-src 'self' 'unsafe-inline'; " +
      "style-src-elem 'self'; " +
      "style-src-attr 'unsafe-inline'; " +
      // SEC-017: api.mapbox.com removed — tiles via /api/map/tiles/mapbox/* proxy
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://api.imgbb.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org; " +
      "font-src 'self' data:; " +
      "connect-src 'self' wss://" + host + " ws://" + host + " https://api.imgbb.com https://cloudflareinsights.com; " +
      "worker-src blob:; " +
      "frame-ancestors 'none'; " +
      "report-uri /api/csp-report"
    );
  }

  // SEC-006: HSTS เฉพาะเมื่อ request มาผ่าน HTTPS (Cloudflare Tunnel inject cf-visitor)
  if (req.secure || (req.headers['cf-visitor'] || '').includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (String(req.originalUrl || '').startsWith('/api/line/webhook')) req.rawBody = Buffer.from(buf);
  },
}));

// 🆕 Cookie parser (simple inline — ไม่ต้องลง package)
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const [k, ...v] = c.trim().split('=');
      if (k) req.cookies[k] = decodeURIComponent(v.join('='));
    });
  }
  next();
});

// 🆕 Init auth module
const auth = require('./auth');
const license = require('./license');
const { decryptCamCreds, encryptCamCreds } = require('./crypto-creds');
const routeError = require('./helpers/routeError');
const { getSystemSetting, getSystemSettings, invalidateSystemSetting } = require('./helpers/getSystemSetting');
const normalizeTimeOfDay = require('./helpers/normalizeTimeOfDay');
const { edgeProxyBaseUrl } = require('./helpers/edgeProxyBaseUrl');
const { OFFLINE_THRESHOLD_SEC } = require('./constants');
auth.init(pool, process.env.SESSION_SECRET);

// 🆕 Helper: get client IP.
// Behind Cloudflare Tunnel every connection arrives from localhost, so a
// forwarded header is required — but the LEFTMOST X-Forwarded-For entry is
// client-controlled (anyone can prepend a fake value), which let an attacker
// rotate fake IPs to dodge the login rate-limit and forge audit-log IPs.
// CF-Connecting-IP is set AND overwritten by Cloudflare, so it's trustworthy;
// req.ip is proxy-aware via `trust proxy`. Raw XFF is no longer trusted.
function getIP(req) {
  return (req.headers['cf-connecting-ip'] || '').trim()
      || req.ip
      || req.socket?.remoteAddress
      || '';
}

// 🆕 Helper: get session token จาก cookie หรือ Authorization header (Safari ITP fallback)
function getSessionToken(req) {
  // Priority 1: Cookie (ปกติ)
  if (req.cookies?.session) return req.cookies.session;
  // Priority 2: Authorization: Bearer header (Safari fallback)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

// 🆕 Public routes (ไม่ต้อง auth)
// ────────────────────────────────────────────────────────────
// Anything OUTSIDE this allowlist requires a valid session.
// Snapshot images are NOT public (PDPA): served by an auth-checked
// route below, not via express.static.
// ────────────────────────────────────────────────────────────
const PUBLIC_HTML_FILES = new Set([
  '/login.html',
  '/disclaimer.html',
  '/login.css',           // externalised from login.html (SEC-3T-005, 2026-06-10)
  '/disclaimer.css',      // externalised from disclaimer.html (SEC-3T-005, 2026-06-10)
  '/i18n.js',             // bilingual engine — login + disclaimer load it pre-auth
  '/disclaimer.js',       // externalised from disclaimer.html (commit 93b1c22) — must be pre-auth
  '/login.js',            // externalised from login.html (commit 93b1c22) — must be pre-auth
  '/theme-init.js',       // sets data-theme before CSS renders (FOUC guard) — pre-auth pages need it
]);
const PUBLIC_PATHS = new Set([
  '/favicon.ico',         // brand logo, served pre-auth so login page can show it
  '/api/auth/login',
  '/api/auth/me',         // returns 401 itself if unauthed; safe pre-auth
  '/api/auth/logout',
  '/api/line/webhook',    // LINE platform callback
  '/api/branding',        // login + disclaimer pages need brand info pre-authg
  '/lpr',                 // Hikvision ITCCAM ANPR HTTP push — camera auth via shared secret not session
  '/others',              // static mount triggers internal redirect to /others/
]);
const PUBLIC_PREFIXES = [
  '/vendor/',             // self-hosted libs (air-datepicker, fonts) — needed by login/disclaimer
  '/branding/',           // brand logo image
  '/tiles/',              // cached map tiles, non-sensitive
  '/face-push/',          // IM3-R cross-site face push — camera auth via per-camera token in path (not session)
  // /others/ removed — SEC-2T-001: default-deny; see OTHERS_PUBLIC below
];

// SEC-2T-001 — /others is default-deny; auth-gating prevents unauthenticated script execution
// on the same origin. Path comparison is lowercased to prevent APFS case-bypass (macOS APFS is case-insensitive).
const OTHERS_PUBLIC = new Set([]);
const OTHERS_PUBLIC_PREFIXES = [];

function isPublicAsset(reqPath) {
  if (PUBLIC_HTML_FILES.has(reqPath)) return true;
  if (PUBLIC_PATHS.has(reqPath)) return true;
  if (PUBLIC_PREFIXES.some(p => reqPath.startsWith(p))) return true;
  if (reqPath === '/others' || reqPath.startsWith('/others/')) {
    const lc = reqPath.toLowerCase();
    return OTHERS_PUBLIC.has(lc) || OTHERS_PUBLIC_PREFIXES.some(pfx => lc.startsWith(pfx));
  }
  return false;
}

// Internal service token — lets server-side code (the report renderer's
// headless Chrome) load auth-gated assets (report-print.html,
// report-template.js) AND call /api/stats/* without a user session.
// Fixed secret from INTERNAL_API_SECRET in src/.env so that report-worker
// (separate process) can share the same token.
// SEC5-MED-005: in production this must not silently degrade — report-worker
// already hard-fails on a missing/short secret (report-worker.js), so an
// api-server that falls back to an ephemeral token would just mean the two
// processes silently disagree on the token forever. Dev/first-boot (no
// NODE_ENV=production) keeps the old ephemeral-fallback convenience.
// Constant-time compare; defined before static-asset middleware.
const INTERNAL_API_TOKEN = (() => {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[security] INTERNAL_API_SECRET not set or too short in src/.env — refusing to start in production');
      process.exit(1);
    }
    console.warn('[security] INTERNAL_API_SECRET not set in src/.env — using ephemeral token; report-worker will not work');
    return require('crypto').randomBytes(32).toString('hex');
  }
  return s;
})();
const WORKER_PORT       = parseInt(process.env.REPORT_WORKER_PORT || '3001', 10);
const ALERT_WORKER_PORT = parseInt(process.env.ALERT_WORKER_PORT  || '3002', 10);

// Poll a worker's /health endpoint (loopback, short timeout).
// Returns parsed JSON on success, { ok: false, error } on any failure.
function fetchWorkerHealth(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 3000 },
      (workerRes) => {
        let data = '';
        workerRes.on('data', c => { data += c; });
        workerRes.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ ok: false, error: 'invalid_json' }); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error',   (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}
function isValidInternalToken(req) {
  const t = req.headers['x-internal-token'];
  if (typeof t !== 'string' || t.length !== INTERNAL_API_TOKEN.length) return false;
  try {
    return require('crypto').timingSafeEqual(Buffer.from(t), Buffer.from(INTERNAL_API_TOKEN));
  } catch { return false; }
}

// 🆕 Auth middleware สำหรับ static assets (HTML/JS/CSS/images served from dashboard/)
// API requests (/api/*) are gated separately by the global /api middleware below.
app.use(async (req, res, next) => {
  if (isPublicAsset(req.path)) return next();
  if (req.path.startsWith('/api/')) return next();  // /api/* has its own auth gate
  // Internal renderer (Puppeteer) — loads report-print.html + its assets.
  if (isValidInternalToken(req)) return next();

  // Treat any GET for an asset under dashboard/ as auth-required
  const isStaticAsset = req.method === 'GET' && (
    req.path === '/' ||
    /\.(html|js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ico)$/i.test(req.path)
  );
  if (!isStaticAsset) return next();

  const token = getSessionToken(req);
  const user = token ? await auth.getUserFromToken(token) : null;
  if (user) return next();

  // Unauthed: redirect HTML navigation to disclaimer/login flow; deny everything else
  if (token) {
    // Bad/expired token — clear cookie before redirecting
    res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
  }
  if (req.path === '/' || req.path === '/index.html' || req.path.endsWith('.html')) {
    return res.redirect('/disclaimer.html');
  }
  return res.status(401).type('text/plain').send('Authentication required');
});

// branding assets (logo) — public so login/disclaimer can fetch without auth
const BRANDING_DIR = path.join(__dirname, '..', 'branding');
if (!fs.existsSync(BRANDING_DIR)) fs.mkdirSync(BRANDING_DIR, { recursive: true });
app.use('/branding', express.static(BRANDING_DIR, { maxAge: '5m', dotfiles: 'deny' }));

// favicon — serve uploaded brand logo if present, otherwise 204
app.get('/favicon.ico', async (req, res) => {
  try {
    const file = (await getSystemSetting(pool, 'brand_logo_path') || '').trim();
    if (file && /^[A-Za-z0-9._-]+$/.test(file)) {
      const full = path.join(BRANDING_DIR, file);
      if (fs.existsSync(full)) {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('Content-Type', 'image/png');
        return res.sendFile(full);
      }
    }
  } catch {}
  res.status(204).end();
});
// ============================================================
// Public HTML Pages (NO AUTH)
// ============================================================

app.use(
  '/others',
  express.static(
    path.join(__dirname, '..', 'public', 'others'),
    {
      index: 'index.html',
      maxAge: '1h',
      dotfiles: 'deny',
    }
  )
);
// Dashboard shell — served through a route (not plain static) so local
// .js AND .css get a cache-busting ?v=<mtime> stamp. Cloudflare caches
// static assets aggressively; a stale dashboard.js silently breaks new UI
// (MV.3c face modal hit exactly this) and a stale index.css leaves new
// styles invisible until a manual purge. index.html itself goes out
// no-cache — it's tiny and must always carry the current ?v.
app.get(['/', '/index.html'], (req, res) => {
  try {
    const dir = path.join(__dirname, '..', 'dashboard');
    let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    // Stamp every local (non-vendor) asset with its own mtime so Cloudflare
    // never serves stale files after a deploy. Each file gets its own ?v=
    // so only changed files get a cache miss.
    const stamp = (attr, p) => {
      try {
        const mtime = Math.floor(fs.statSync(path.join(dir, p.slice(1))).mtimeMs);
        return `${attr}="${p}?v=${mtime}"`;
      } catch { return `${attr}="${p}"`; }
    };
    html = html
      .replace(/src="(\/(?!vendor\/)[\w/-]+\.js)"/g, (_, p) => stamp('src', p))
      .replace(/href="(\/(?!vendor\/)[\w/-]+\.css)"/g, (_, p) => stamp('href', p));
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('index load error');
  }
});
app.use(express.static(path.join(__dirname, '..', 'dashboard'), { dotfiles: 'deny' }));

// ponytail: single SVG served instead of 404 when edge proxy is unreachable,
// so <img> renders a camera-offline placeholder instead of a broken icon.
// Cache-Control: no-store ensures next request retries the live fetch.
const _EDGE_OFFLINE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225">' +
  '<rect width="400" height="225" fill="#1c2030"/>' +
  '<g transform="translate(170,68)" fill="none" stroke="#4a5568" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="0" y="22" width="60" height="42" rx="5"/>' +
  '<circle cx="30" cy="43" r="13"/>' +
  '<rect x="18" y="14" width="16" height="10" rx="2"/>' +
  '</g>' +
  '<text x="200" y="148" text-anchor="middle" fill="#4a5568" font-size="13" font-family="sans-serif">Edge offline</text>' +
  '</svg>'
);
function _serveEdgeOffline(res) {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(_EDGE_OFFLINE_SVG);
}

// 🔐 Auth-gated snapshot serving (PDPA — CCTV images must not be public).
// Replaces the previous express.static('/snapshots') which exposed every file
// to anyone who could guess a filename. Filename is regex-validated to block
// path traversal attempts (../).
// ── Thumbnail resize for snapshot serving (?w=N) ─────────────
// The Camera Status grid + Events/Snapshot grids request a small
// `?w=` thumbnail so the browser isn't pulling full 5MP frames ×N.
// Stored-snapshot thumbnails are cached on disk (lazy — generated on
// first view, pruned with the original by enforceSnapshotRetention);
// live-snapshot thumbnails are resized in-flight (a sharp transform
// stream, no cache — they're transient). Width is restricted to a
// fixed set so the on-disk thumb cache stays bounded. The larger
// widths (>=960) back the Phase 2 per-camera "view full" cap.
const THUMB_WIDTHS = new Set([160, 240, 320, 400, 480, 640, 960, 1280, 1920, 2560]);
// Phase 2 — allowed per-camera "view full" width caps (a subset of
// THUMB_WIDTHS; the camera-settings form offers exactly these). The
// stored original is always kept native — this only caps the
// on-demand "view full" request, non-destructively.
const FULL_VIEW_WIDTHS = new Set([960, 1280, 1920, 2560]);
const THUMBS_DIR = path.join(SNAPSHOT_DIR, '.thumbs');
// OPT5-CEN-006 — edge-site thumbnails skip the disk cache below (PDPA: no
// persistent central copy of edge-owned images), so every repeat view was
// re-fetching the full image from the edge tunnel and re-running sharp.
// In-memory-only cache (never touches disk — the PDPA guarantee holds):
// 60s TTL (thumbnail content is immutable per source file, so this is a
// memory pressure valve, not a staleness control) + hard 500-entry cap,
// evicting the oldest entry on overflow (Map preserves insertion order).
// Worst case ~500 × ~20KB ≈ 10MB resident.
const _edgeThumbCache = new Map();
const EDGE_THUMB_CACHE_TTL_MS = 60_000;
const EDGE_THUMB_CACHE_MAX = 500;
function _edgeThumbGet(key) {
  const hit = _edgeThumbCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > EDGE_THUMB_CACHE_TTL_MS) { _edgeThumbCache.delete(key); return null; }
  return hit.buf;
}
function _edgeThumbSet(key, buf) {
  if (_edgeThumbCache.size >= EDGE_THUMB_CACHE_MAX) {
    _edgeThumbCache.delete(_edgeThumbCache.keys().next().value);
  }
  _edgeThumbCache.set(key, { buf, at: Date.now() });
}
function thumbWidth(q) {
  const n = parseInt(q, 10);
  return THUMB_WIDTHS.has(n) ? n : null;
}
function jpegResizer(w) {
  return sharp({ failOn: 'none' })
    .resize(w, null, { withoutEnlargement: true })
    .jpeg({ quality: 78 });
}

app.get('/snapshots/*path', async (req, res) => {
  try {
    // Normal access requires a logged-in user session (PDPA gate). The internal
    // renderer (Puppeteer) has no session — it carries X-Internal-Token (a
    // server-only secret, never exposed to the browser) to load snapshot
    // thumbnails for the report PDF/PNG. Same trust as /api/stats. GET only.
    if (!isValidInternalToken(req)) {
      const token = getSessionToken(req);
      const user = token ? await auth.getUserFromToken(token) : null;
      if (!user) return res.status(401).end();
    }

    // Support subdirectory paths (e.g. lpr/2026-06-18/file.jpg)
    // Each path segment must be safe: alphanumeric, dot, dash, underscore only
    const filename = decodeURIComponent(req.path.slice('/snapshots/'.length));
    const segments = filename.split('/');
    const validSegment = /^[A-Za-z0-9._-]+$/;
    const validFile    = /\.(jpg|jpeg|png)$/i;
    if (!segments.length || !validFile.test(filename) ||
        segments.some(s => !s || s === '..' || !validSegment.test(s))) {
      return res.status(400).end();
    }
    const file = path.join(SNAPSHOT_DIR, ...segments);
    // T2-B: try local first; if missing, proxy-fetch from the OWNING SITE's
    // edge (no disk copy — PDPA). Per-site (2026-07-15 plan): the camera_id
    // is segments[2] per snapshot-path.js's layout
    // (category/date/camId/slot/file) — look up which site it belongs to
    // and derive that site's tunnel URL, instead of one global edge URL.
    // main-site (or unassigned) cameras never proxy — same as today.
    let proxyBuf = null;
    if (!fs.existsSync(file)) {
      // camId position depends on the path layout:
      //  - deep event/face/lpr: category/date/camId/slot/file → segments[2]
      //  - flat preview tile:    preview/<camId>.jpg           → segments[1] sans ext
      // Both must resolve to the owning camera so the per-site proxy target is
      // found. Regression from 27f10ea (per-site proxy) which only handled the
      // deep layout → preview tiles 404'd silently for every edge-site camera.
      const camId = (segments[0] === 'preview' && segments.length === 2)
        ? segments[1].replace(/\.(jpe?g|png)$/i, '')
        : (segments[2] || null);
      let proxyUrl = null;
      if (camId) {
        try {
          const { rows } = await pool.query(
            `SELECT (c.site_id IS NULL OR s.code = 'main') AS is_local_site, s.code
             FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
             WHERE c.id = $1`,
            [camId]
          );
          const cam = rows[0];
          if (cam && !cam.is_local_site && cam.code) {
            proxyUrl = edgeProxyBaseUrl(cam.code, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');
          }
        } catch (e) { console.warn(`[api] site lookup for snapshot proxy [${camId}]:`, e.message); }
      }
      // Fallback: segments[2] isn't a camera ID for face/ref/<fdLibName>/<humanId> paths.
      // Find the owning edge site via any FaceRecognition event that stored this path.
      if (!proxyUrl) {
        try {
          const { rows: evRows } = await pool.query(
            `SELECT s.code FROM events e
             JOIN cameras c ON c.camera_id = e.camera_id
             JOIN sites s ON s.id = c.site_id
             WHERE e.event_type = 'FaceRecognition'
               AND e.raw_json->>'_snapshot_ref' = $1
               AND s.code IS NOT NULL AND s.code <> 'main'
             LIMIT 1`,
            [filename]
          );
          if (evRows[0]) {
            proxyUrl = edgeProxyBaseUrl(evRows[0].code, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');
          }
        } catch (e) { console.warn(`[api] face-ref fallback lookup for ${filename}:`, e.message); }
      }
      const proxySecret = process.env.SNAPSHOT_PROXY_SECRET;
      if (proxyUrl && proxySecret) {
        try {
          const up = await fetch(
            `${proxyUrl}/snapshots/${encodeURIComponent(filename).replace(/%2F/g, '/')}`,
            { headers: { Authorization: `Bearer ${proxySecret}` }, signal: AbortSignal.timeout(8000) }
          );
          if (!up.ok) {
            console.warn(`[api] edge proxy ${up.status} for ${filename}`);
            // 404 = file genuinely gone (retention-pruned on the edge too) → pass
            // the 404 through so the client-side RF4 fallback (plate plaque /
            // vehicle vector, data-err="hide") shows. The Edge-offline SVG is
            // only for connectivity failures where the file may still exist.
            // no-store: this 404 can flip to 200 after a deploy / when the tile
            // regenerates — a heuristically-cached 404 in the browser would keep
            // showing "no image" until a manual hard-refresh (real incident).
            if (up.status === 404) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); }
            return _serveEdgeOffline(res);
          }
          proxyBuf = Buffer.from(await up.arrayBuffer());
        } catch (e) { console.warn(`[api] edge proxy fetch error for ${filename}:`, e?.message || e); return _serveEdgeOffline(res); }
      } else {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).end();
      }
    }

    // ?w=N → serve a lazily-built, disk-cached thumbnail. The cache
    // file lives in .thumbs/<w>/ and is pruned with the original.
    const w = thumbWidth(req.query.w);
    if (w) {
      // Flatten subdirectory path for thumb cache: lpr/2026-06-18/file.jpg → file.jpg
      const thumbName = segments[segments.length - 1];
      const tdir  = path.join(THUMBS_DIR, String(w));
      const tpath = path.join(tdir, thumbName);
      const edgeThumbKey = proxyBuf ? `${filename}|${w}` : null;
      try {
        let thumb;
        try {
          if (proxyBuf) {
            thumb = _edgeThumbGet(edgeThumbKey);
            if (!thumb) throw new Error('proxy'); // no disk cache for edge images
          } else {
            thumb = await fs.promises.readFile(tpath);
          }
        } catch {
          // cache miss — build thumbnail from local file or proxy buffer
          const src = proxyBuf ?? await fs.promises.readFile(file);
          thumb = await sharp(src, { failOn: 'none' })
            .resize(w, null, { withoutEnlargement: true })
            .jpeg({ quality: 78 }).toBuffer();
          if (proxyBuf) {
            _edgeThumbSet(edgeThumbKey, thumb);
          } else {
            await fs.promises.mkdir(tdir, { recursive: true });
            await fs.promises.writeFile(tpath, thumb).catch(() => {});
          }
        }
        // res.send(Buffer) — not sendFile: the .thumbs dot-folder would
        // trip sendFile's default dotfiles:'ignore' and 404.
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(thumb);
      } catch { /* fall through to the full image */ }
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (proxyBuf) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.send(proxyBuf);
    }
    res.sendFile(file);
  } catch (e) {
    res.status(500).end();
  }
});

// 🎬 Phase 6.1 — Pre-alarm video clip serving (auth-gated, same PDPA pattern as /snapshots)
const MEDIA_DIR = path.join(__dirname, '..', 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// 📅 Phase 7.3 — generated report PDFs land here (email delivery: commit 3)
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

app.get('/media/:filename', async (req, res) => {
  try {
    const token = getSessionToken(req);
    const user = token ? await auth.getUserFromToken(token) : null;
    if (!user) return res.status(401).end();

    const filename = req.params.filename;
    if (!/^[A-Za-z0-9._-]+\.(mp4|webm)$/i.test(filename)) {
      return res.status(400).end();
    }
    const file = path.join(MEDIA_DIR, filename);
    if (!fs.existsSync(file)) return res.status(404).end();
    // No long cache — clip lifecycle is short + may be deleted by retention
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.sendFile(file);
  } catch (e) {
    res.status(500).end();
  }
});

// Authentication routes (→ src/routes/auth.js)
require('./routes/auth')(app, pool, { auth, getIP, getSessionToken });

// User Management + Audit Log + CSP reporter (→ src/routes/users.js)
// NOTE: must remain BEFORE the global /api auth middleware so that
// user management works when the license write-block is active.
require('./routes/users')(app, { auth, getIP });

// 🔐 Global auth middleware for ALL /api/* endpoints below this line
// Endpoints above (login, logout, me, change-password, sessions, users, audit) มี middleware แล้ว
//
// 🚫 /config and /branding intentionally REMOVED from publicApiPaths in 2026-05-08
// security audit. /api/config leaks MAPBOX_TOKEN — must require auth.
// /api/branding stays public (login/disclaimer need brand info pre-auth) but
// is allow-listed in the static-asset middleware above (see PUBLIC_PATHS).

app.use('/api', async (req, res, next) => {
  const publicApiPaths = ['/auth/login', '/auth/logout', '/auth/me', '/line/webhook', '/branding', '/eula'];
  if (publicApiPaths.includes(req.path)) return next();

  // Internal service calls (report renderer) — bypass session auth.
  if (isValidInternalToken(req)) { req.internal = true; return next(); }

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
  const user = await auth.getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' });
  // SEC-004: block ทุก API จาก user ที่ยังไม่เปลี่ยน default password
  if (user.must_change_password &&
      !['/auth/logout', '/auth/change-password'].includes(req.path)) {
    return res.status(403).json({ error: 'Must change password', code: 'MUST_CHANGE_PASSWORD' });
  }
  req.user = user;
  req.user.allowedSites = await auth.getAllowedSites(req.user, pool);
  req.user.isSiteScoped = req.user.allowedSites !== null;
  next();
});

// 🔐 Admin-only middleware for write operations on critical resources
function requireAdminForWrites(resourcePath) {
  return (req, res, next) => {
    if (req.path.startsWith(resourcePath) && req.method !== 'GET') {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin role required for this operation' });
      }
    }
    next();
  };
}

// Apply admin-required middleware for sensitive paths
app.use('/api/cameras', requireAdminForWrites('/'));
app.use('/api/groups', requireAdminForWrites('/'));
app.use('/api/alert-rules', requireAdminForWrites('/'));
app.use('/api/line-config', requireAdminForWrites('/'));
app.use('/api/map', requireAdminForWrites('/'));
app.use('/api/categories', requireAdminForWrites('/'));
app.use('/api/category-rules', requireAdminForWrites('/'));
app.use('/api/settings', requireAdminForWrites('/'));
app.use('/api/report-schedules', requireAdminForWrites('/'));
app.use('/api/license', requireAdminForWrites('/'));
// DELETE /api/alert-logs TRUNCATEs the whole alert_logs table — must be
// admin-only. (GET stays open to viewers; requireAdminForWrites gates
// non-GET methods only.)
app.use('/api/alert-logs', requireAdminForWrites('/'));

// ============================================================
// Phase 8.0 — License enforcement
// ============================================================
// 60-second cache so we don't hit the DB on every API request. Bumped
// to a fresh read whenever activate/deactivate happens.
let _licenseStateCache = null;
let _licenseStateCacheAt = 0;
async function getCurrentLicenseState() {
  if (_licenseStateCache && Date.now() - _licenseStateCacheAt < 60_000) {
    return _licenseStateCache;
  }
  _licenseStateCache = await license.computeLicenseState(pool);
  _licenseStateCacheAt = Date.now();
  return _licenseStateCache;
}
function invalidateLicenseStateCache() { _licenseStateCacheAt = 0; }

// ── Auditor read-only enforcement ────────────────────────────
// The 'auditor' role (ผู้ตรวจสอบระบบ) may GET everything — including
// Settings / Health — but must NEVER write. Hard-blocked here on the
// server; the UI hint is only a convenience. Account self-service
// (/api/auth/* — login, logout, own password) stays allowed.
app.use('/api', (req, res, next) => {
  if (!req.user || req.user.role !== 'auditor') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/auth/')) return next();
  return res.status(403).json({
    error: 'read_only',
    message_th: 'บัญชีผู้ตรวจสอบ (Auditor) เป็นแบบอ่านอย่างเดียว — ไม่สามารถแก้ไขหรือบันทึกได้',
  });
});

// Write-blocking middleware. Reads (GET/HEAD/OPTIONS) always pass. Writes
// (POST/PUT/DELETE/PATCH) are blocked when the license is in a non-active
// state (GRACE/EXPIRED/TRIAL_EXPIRED/INVALID) — read-only mode. The
// license endpoints themselves are always allowed so the operator can
// recover by pasting a fresh key.
app.use('/api', async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/auth/'))    return next();
  if (req.path.startsWith('/license/')) return next();
  if (req.path.startsWith('/line/webhook')) return next();
  // Pre-setup escape hatch: if the operator hasn't pasted a real public
  // key into src/license.js yet (fresh dev clone), don't lock the system
  // out of itself. Production deployments WILL have a real key.
  if (!license.isPublicKeyConfigured()) return next();
  try {
    const state = await getCurrentLicenseState();
    if (state.mode === 'LICENSED' ||
        state.mode === 'TRIAL'    ||
        state.mode === 'TRIAL_NOT_STARTED') return next();
    // Read-only: surface the reason so the UI can show the right banner.
    return res.status(403).json({
      error: 'license_required',
      code: state.mode,
      message_th: 'License หมดอายุหรือไม่ถูกต้อง — ระบบอยู่ในโหมดดูอย่างเดียว กรุณาติดต่อทีมงานเพื่อต่ออายุ',
      machine_id: state.machine_id,
    });
  } catch (e) {
    // If the license check itself errors (e.g. DB down), don't block —
    // operating from the existing state is safer than locking the
    // operator out over an infrastructure hiccup.
    console.error('🔐 license check failed (non-blocking):', e.message);
    return next();
  }
});

// License API endpoints (→ src/routes/license.js)
require('./routes/license')(app, pool, { getCurrentLicenseState, invalidateLicenseStateCache });
// EULA — serve markdown + acceptance status/record (→ src/routes/eula.js)
require('./routes/eula')(app, pool);

// ============================================================
// Config Files
// ============================================================

// In-memory mtime cache — อ่าน disk จริงเฉพาะเมื่อไฟล์เปลี่ยน (Phase 1 opt, F2)
let _configCache = null, _configMtime = 0;
function loadCameraConfig() {
  try {
    const mtime = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0;
    if (mtime !== _configMtime) {
      const raw = mtime ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : { cameras: [] };
      if (raw.cameras) raw.cameras = raw.cameras.map(decryptCamCreds);
      _configCache = raw;
      _configMtime = mtime;
    }
    return _configCache || { cameras: [] };
  } catch (e) { console.error('Config load error:', e.message); return { cameras: [] }; }
}

function saveCameraConfig(config) {
  try {
    const toWrite = {
      ...config,
      cameras: (config.cameras || []).map(encryptCamCreds),
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toWrite, null, 2));
    fs.chmodSync(CONFIG_FILE, 0o600); // writeFileSync preserves mode on existing files — this only bites on fresh creation (umask default), keeping it owner-only always (SEC-013, decision #191)
    _configMtime = 0; // invalidate cache
    return true;
  } catch (e) { return false; }
}

let _groupsCache = null, _groupsMtime = 0;
function loadGroups() {
  try {
    const mtime = fs.existsSync(GROUPS_FILE) ? fs.statSync(GROUPS_FILE).mtimeMs : 0;
    if (mtime !== _groupsMtime) {
      _groupsCache = mtime ? JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')) : { groups: [] };
      _groupsMtime = mtime;
    }
    return _groupsCache || { groups: [] };
  } catch (e) { console.error('Groups load error:', e.message); return { groups: [] }; }
}

function saveGroups(data) {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2));
    fs.chmodSync(GROUPS_FILE, 0o600); // same self-heal as saveCameraConfig — see SEC-013
    _groupsMtime = 0; // invalidate cache
    return true;
  } catch (e) { return false; }
}

if (!fs.existsSync(CONFIG_FILE)) saveCameraConfig({ cameras: [] });
if (!fs.existsSync(GROUPS_FILE)) saveGroups({ groups: [] });

// ============================================================
// WebSocket
// ============================================================

const wsClients = new Set();
wss.on('connection', (ws) => {
  // Auth already enforced at the upgrade by verifyClient above.
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

function broadcast(data) {
  const json = JSON.stringify(data);
  wsClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(json); });
}

// LPR watch-list plate cache — so the new_event broadcast can flag an anprAlarm
// as a watch-list ALERT (vs a plain read) without a DB query per event. Plates
// are normalized (UPPER, spaces stripped) to match on both sides. Refreshed on a
// timer; the watch-list is small and changes rarely.
const _normPlate = (p) => String(p || '').toUpperCase().replace(/\s+/g, '');
let _lprWatchSet = new Set();
async function _refreshLprWatch() {
  try {
    const { rows } = await pool.query('SELECT plate_number FROM lpr_watchlist WHERE active');
    _lprWatchSet = new Set(rows.map(r => _normPlate(r.plate_number)));
  } catch (e) { console.warn('[lpr-watch] refresh:', e.message); }
}
_refreshLprWatch();
setInterval(_refreshLprWatch, 5 * 60 * 1000);

// Phase 6.1.5 — Postgres LISTEN bridge: forward clip_done notifications
// from media-recorder.js to all connected WebSocket clients so the Media
// page can update without polling. Uses a dedicated pg.Client (LISTEN can't
// run on a pooled connection).
(async () => {
  const { Client } = require('pg');
  const listenClient = new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  listenClient.on('error', e => console.error('[ws-bridge] listen error:', e.message));
  listenClient.on('notification', async (msg) => {
    if (msg.channel === 'clip_done') {
      try {
        const payload = JSON.parse(msg.payload);
        broadcast({ type: 'clip_done', ...payload });
      } catch {}
      return;
    }
    if (msg.channel === 'scan_result') {
      // NVR channel scan reply from the edge (Phase 3) — resolve the pending
      // scan so GET /api/cameras/scan-nvr/:id returns it.
      try {
        const p = JSON.parse(msg.payload);
        if (p.scan_id) require('./helpers/scanRegistry').resolve(p.scan_id, p);
      } catch {}
      return;
    }
    if (msg.channel === 'event_snapshot') {
      try { broadcast({ type: 'event_snapshot', ...JSON.parse(msg.payload) }); } catch {}
      return;
    }
    if (msg.channel === 'new_event') {
      // mqtt-subscriber fires pg_notify('new_event', <id>) right after the
      // INSERT. Pull the full row by id — payload stays under the 8KB NOTIFY
      // cap and we get the exact same shape the old poller produced.
      const id = parseInt(msg.payload, 10);
      if (!Number.isFinite(id)) return;
      try {
        const { rows } = await pool.query(
          `SELECT e.*,
             COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
             e.raw_json->>'_snapshot_source' AS snapshot_source
           FROM events e WHERE e.id = $1`,
          [id]
        );
        const row = rows[0];
        if (!row) return;
        // Feed CountAggregation/Counter into the occupancy tracker BEFORE
        // any suppression — these carry the numeric Count we KPI off of.
        if (row.event_type === 'CountAggregation/Counter') {
          const ruleName = row.raw_json?.Source?.Rule;
          const rawCount = parseInt(row.raw_json?.Data?.Count, 10);
          recordOccupancySample(row.camera_id, ruleName, rawCount);
        }
        // Suppress metric events (CountAggregation/*) — sampled many times
        // per second, not incidents. Occupancy tracker above already used it.
        if (isMetricEventType(row.event_type)) return;
        // Suppress disabled camera-automation analytics + the event_state='false'
        // half (matches /api/events so live feed and paginated list agree).
        if (isHiddenAnalyticsEvent(row.event_type, row.event_state)) return;
        // FaceCapture has its own "ภาพใบหน้า" page — keep it out of the
        // incident feed + Snapshot page (matches the /api/events filter),
        // but push it on a SEPARATE channel so the Face page can live-
        // update. The ingester notifies AFTER patching raw_json._snapshot,
        // so the row already carries the face crop here.
        if (row.event_type === 'FaceCapture') {
          broadcast({ type: 'new_face', event: row });
          pushSender.notifyFace(pool, row);   // mobile push (face — ไม่ผ่าน alert-engine)
          return;
        }
        // Flag watch-list ANPR hits so the map keeps a camera-point pulse for
        // alerts while plain reads drop into the side list (frontend routing).
        if (row.event_type === 'anprAlarm') {
          row._lprAlert = _lprWatchSet.has(_normPlate(row.raw_json?.data?.Object?.Text));
        }
        broadcast({ type: 'new_event', event: row });
        // alert push ย้ายไป alert-engine.onEvent (คุมด้วย alert_rules ต้นทาง)
      } catch (e) {
        console.error('[ws-bridge] new_event lookup:', e.message);
      }
      return;
    }
  });
  try {
    await listenClient.connect();
    await listenClient.query('LISTEN clip_done');
    await listenClient.query('LISTEN new_event');
    await listenClient.query('LISTEN event_snapshot');
    await listenClient.query('LISTEN scan_result');
    console.log('🎬 ws-bridge: LISTEN clip_done + new_event + event_snapshot + scan_result → WebSocket broadcast');
  } catch (e) {
    console.warn('🎬 ws-bridge connect failed:', e.message);
  }
})();

// ============================================================
// Occupancy tracker — live "People in Area" KPI
// ============================================================
// Bosch IVA "Counter" / "Crowd" rules emit CountAggregation/Counter events
// with a numeric Count value. Bosch samples at high frequency (several per
// second) and the raw count strobes when tracking briefly loses an object,
// so we apply 2-second median smoothing to produce a stable display number.
// Counters that go silent for > 30s decay to 0 (the area emptied and Bosch
// stopped re-emitting).
const OCC_SMOOTH_WINDOW_MS = 2_000;
const OCC_STALE_TTL_MS     = 30_000;
const _occupancy = new Map();   // camera_id -> Map(rule_name -> entry)

function recordOccupancySample(cameraId, ruleName, rawCount) {
  if (!cameraId || !ruleName) return;
  if (!Number.isFinite(rawCount) || rawCount < 0) return;

  let perCam = _occupancy.get(cameraId);
  if (!perCam) { perCam = new Map(); _occupancy.set(cameraId, perCam); }
  let entry = perCam.get(ruleName);
  if (!entry) { entry = { samples: [], smoothed: 0, raw: 0, lastUpdate: 0 }; perCam.set(ruleName, entry); }

  const now = Date.now();
  entry.samples.push({ ts: now, count: rawCount });
  entry.samples = entry.samples.filter(s => (now - s.ts) <= OCC_SMOOTH_WINDOW_MS);

  const sorted = entry.samples.map(s => s.count).sort((a, b) => a - b);
  const smoothed = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

  const changed = entry.smoothed !== smoothed;
  entry.raw = rawCount;
  entry.smoothed = smoothed;
  entry.lastUpdate = now;

  if (changed) {
    broadcast({
      type: 'occupancy_update',
      camera_id: cameraId,
      rule_name: ruleName,
      current: smoothed,
      raw: rawCount,
      ts: now,
    });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [cid, perCam] of _occupancy.entries()) {
    for (const [rule, entry] of perCam.entries()) {
      if (entry.smoothed > 0 && (now - entry.lastUpdate) > OCC_STALE_TTL_MS) {
        entry.smoothed = 0;
        entry.raw = 0;
        entry.samples = [];
        broadcast({
          type: 'occupancy_update',
          camera_id: cid, rule_name: rule,
          current: 0, raw: 0, ts: now, stale: true,
        });
      }
    }
  }
}, 5_000);


// ============================================================
// API: Cameras + Live Snapshot Proxy (→ src/routes/cameras.js)
// ============================================================

// Mapbox token: DB-first (decision #171), fallback .env, module-level cache
let _cachedMapboxToken = null;
async function getMapboxToken() {
  if (_cachedMapboxToken !== null) return _cachedMapboxToken;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='mapbox_token'");
    _cachedMapboxToken = r.rows[0]?.value || process.env.MAPBOX_TOKEN || '';
  } catch { _cachedMapboxToken = process.env.MAPBOX_TOKEN || ''; }
  return _cachedMapboxToken;
}

async function _logCameraAudit(req, action, cameraId, details) {
  await auth.logAudit(
    req.user?.id,
    req.user?.username,
    action,
    null,
    null,
    getIP(req),
    req.headers['user-agent'],
    details,
    cameraId
  );
}

require('./routes/cameras')(app, pool, {
  auth, getIP,
  loadCameraConfig, saveCameraConfig,
  loadGroups, saveGroups,
  logCameraAudit: _logCameraAudit,
  getMapboxToken,
  license, getCurrentLicenseState,
  thumbWidth, jpegResizer,
  SNAPSHOT_DIR,
});

// Camera Groups (→ src/routes/groups.js)
require('./routes/groups')(app, pool, { auth, getIP, loadGroups, saveGroups, logCameraAudit: _logCameraAudit });

// ============================================================
// API: Events
// ============================================================

// CountAggregation/* (and any other Bosch *Aggregation* event_type) are
// metric samples emitted multiple times per second — they're counts, not
// incidents. They feed the live occupancy tracker but should NOT appear in:
//   - Events Live feed (would strobe at the sample rate)
//   - /api/events lists or X-Total-Count
//   - Today's count badge
//   - rule_name / event_type facets used by editors and Events filters
// They DO remain in the events table for the occupancy tracker and for
// per-camera historical "People Counting" / "Vehicle Counting" stats
// (which already aggregate via the event_category_rules mechanism).
const METRIC_EVENT_TYPE_PATTERN = '%Aggregation%';
function isMetricEventType(eventType) {
  return typeof eventType === 'string' && eventType.includes('Aggregation');
}

// ============================================================
// Camera-side automatic analytics events (Phase 7.1)
// ============================================================
// These fire AUTOMATICALLY from the camera (not IVA rules — no rule_name):
// image-quality diagnostics, scene-change/tamper, and digital I/O triggers.
// They come as pairs — event_state 'true' when the condition starts, 'false'
// when it ends. Option B handling: always STORED, but display is filtered:
//   - operator toggles which types appear in the Events feed (system_settings
//     key 'analytics_event_display', CSV of enabled keys)
//   - the event_state='false' "ended" half is always hidden from the feed
//     (state dedup — otherwise every condition shows twice)
// Image-quality counts are also surfaced on the Health Check page.
// Broad prefix keys — every analytics event is matched by exactly one of
// these. Trigger/DigitalInput catches Input_1 / Input_2 AND the IP-suffixed
// variants Bosch FW 6-7.x emits ('Trigger/DigitalInput/&Input_1__192_168...'),
// so the operator toggles two switches instead of one per physical port.
const ANALYTICS_EVENT_KEYS = [
  'ImageTooBright', 'ImageTooBlurry', 'ImageTooDark', 'GlobalSceneChange',
  'Trigger/DigitalInput', 'Trigger/Relay',
];
// Image quality + scene change ON by default; digital I/O OFF (operator-
// specific — depends what's physically wired).
const ANALYTICS_DEFAULT_ENABLED =
  'ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange';

// SQL CASE that resolves an events row (alias `e`) to its analytics key,
// or NULL if it isn't one of the known camera-automation events. All
// matches are prefix-LIKE so every variant of the same automation type
// folds into the same key (Bosch FW 6-7.x adds an `__<ip>_` suffix to
// the port name; FW 9.x doesn't — same toggle controls both).
const ANALYTICS_KEY_SQL = `
  CASE
    WHEN e.event_type LIKE 'ImageTooBright/%'      THEN 'ImageTooBright'
    WHEN e.event_type LIKE 'ImageTooBlurry/%'      THEN 'ImageTooBlurry'
    WHEN e.event_type LIKE 'ImageTooDark/%'        THEN 'ImageTooDark'
    WHEN e.event_type LIKE 'GlobalSceneChange/%'   THEN 'GlobalSceneChange'
    WHEN e.event_type LIKE 'Trigger/DigitalInput/%' THEN 'Trigger/DigitalInput'
    WHEN e.event_type LIKE 'Trigger/Relay/%'        THEN 'Trigger/Relay'
    ELSE NULL
  END`;

// SQL fragment — TRUE when the row is a camera-automation analytics event
// (ImageToo* / GlobalSceneChange / Trigger/*). `col` = the event_type column
// reference ('event_type' or 'e.event_type'). These fire automatically from
// the camera, aren't incidents, and are already kept out of the Events feed
// (Phase 7.1) — reports/stats that count raw events should exclude them too.
function analyticsEventClause(col) {
  return `(${col} LIKE 'ImageTooBright/%' OR ${col} LIKE 'ImageTooBlurry/%' `
       + `OR ${col} LIKE 'ImageTooDark/%' OR ${col} LIKE 'GlobalSceneChange/%' `
       + `OR ${col} LIKE 'Trigger/%')`;
}

// JS mirror of ANALYTICS_KEY_SQL — used by the WS-broadcast filter.
function analyticsKeyOf(eventType) {
  if (typeof eventType !== 'string') return null;
  for (const key of ANALYTICS_EVENT_KEYS) {
    if (eventType === key || eventType.startsWith(key + '/')) return key;
  }
  return null;
}

// Cached set of analytics keys the operator wants shown in the Events feed.
// Module-level + 60s refresh so the 1s WS-broadcast loop reads it
// synchronously; PUT /api/settings/analytics_event_display refreshes it
// immediately on save.
let _analyticsEnabledSet = new Set(ANALYTICS_DEFAULT_ENABLED.split(','));
async function refreshAnalyticsEnabledSet() {
  try {
    const r = await pool.query(
      "SELECT value FROM system_settings WHERE key='analytics_event_display'"
    );
    if (r.rows[0] && typeof r.rows[0].value === 'string') {
      _analyticsEnabledSet = new Set(
        r.rows[0].value.split(',').map(s => s.trim()).filter(Boolean)
      );
    }
  } catch { /* keep last good set */ }
}
refreshAnalyticsEnabledSet();
setInterval(refreshAnalyticsEnabledSet, 60_000);

// True if this event should be hidden from the live Events feed:
// either a disabled analytics type, or the event_state='false' half of
// any analytics event. Non-analytics events always return false.
function isHiddenAnalyticsEvent(eventType, eventState) {
  const key = analyticsKeyOf(eventType);
  if (!key) return false;
  if (!_analyticsEnabledSet.has(key)) return true;
  if (String(eventState) === 'false') return true;
  return false;
}

// SQL fragment that excludes analytics events the operator has DISABLED
// (e.g. Trigger/DigitalInput when not in analytics_event_display).
// Returns ' AND NOT (…)' ready to be appended to a WHERE clause, or ''
// when nothing is disabled. Used by stats-summary-route + other endpoints
// that aggregate raw event counts and should respect the operator's
// "what counts as an incident" preference. Safe to inline (no SQL
// injection — keys come from the constant ANALYTICS_EVENT_KEYS list).
function disabledAnalyticsClause(col = 'event_type') {
  const disabled = ANALYTICS_EVENT_KEYS.filter(k => !_analyticsEnabledSet.has(k));
  if (disabled.length === 0) return '';
  // All keys are prefix-LIKE — folds Bosch FW 6-7.x IP-suffix variants
  // under the same toggle as FW 9.x clean variants.
  const conditions = disabled
    .map(k => `${col} LIKE '${k.replace(/'/g, "''")}/%'`)
    .join(' OR ');
  return ` AND NOT (${conditions})`;
}

require('./routes/events')(app, pool, {
  getDisplayTz,
  getAnalyticsEnabledSet: () => _analyticsEnabledSet,
  METRIC_EVENT_TYPE_PATTERN, ANALYTICS_EVENT_KEYS, ANALYTICS_KEY_SQL,
});

// ============================================================
// API: Statistics (→ src/routes/stats.js)
// ============================================================
require('./routes/stats')(app, pool, {
  getDisplayTz,
  METRIC_EVENT_TYPE_PATTERN,
  analyticsEventClause,
  occupancy: _occupancy,
  occupancySmoothMs: OCC_SMOOTH_WINDOW_MS,
  loadCameraConfig,
});

// ============================================================
// Map Tile Cache (→ src/routes/map.js)
// ============================================================
require('./routes/map')(app, pool, { getMapboxToken, routeError });

// ============================================================
// API: Alert Rules + LINE Config (LINE Notification System)
// ============================================================

const lineSender = require('./line-sender');
const pushSender = require('./push-sender');

// Push tokens + Alert logs + Backups (→ src/routes/ops.js)
require('./routes/ops')(app, pool, { auth, getIP });

// ============================================================
// LINE Config + Webhook (→ src/routes/line.js)
// ============================================================
require('./routes/line')(app, pool, { auth, getIP, routeError });

// Alert Rules CRUD + suggestions (→ src/routes/alert-rules.js)
require('./routes/alert-rules')(app, pool);

// ============================================================
// Report Schedules (Phase 7.3 — scheduled report delivery)
// ============================================================
require('./routes/report-schedules')(app, pool, { WORKER_PORT, INTERNAL_API_TOKEN });

// ============================================================
// Report History + PDF + Daily/Weekly data (→ src/routes/reports.js)
// ============================================================
require('./routes/reports')(app, pool, {
  routeError,
  REPORTS_DIR, getBrandForReport, INTERNAL_API_TOKEN,
});

// Brand info for report headers — read straight from system_settings.
async function getBrandForReport() {
  const b = {};
  try {
    const s = await getSystemSettings(pool, ['brand_name', 'brand_tagline', 'brand_logo_path', 'brand_primary_color']);
    if (s.brand_name)          b.name = s.brand_name;
    if (s.brand_tagline)       b.tagline = s.brand_tagline;
    if (s.brand_primary_color) b.primary_color = s.brand_primary_color;
    if (s.brand_logo_path)     b.logo_url = `http://localhost:${PORT}/branding/${s.brand_logo_path}`;
  } catch { /* defaults */ }
  return b;
}


// ============================================================
// API: Face Capture gallery (Phase MV.3b)
// ============================================================
// Hikvision Face Capture events (event_type='FaceCapture') with the
// face attributes the ingester flattened into raw_json. Powers the
// "ภาพใบหน้า" page — paginated, filterable by gender / age band / mask.
// Shared WHERE builder for the face endpoints — filters on the
// raw_json face attributes + camera + event_time range. Returns the
// clause string, the params array, and the next free placeholder index.
require('./routes/faces')(app, pool);

// ============================================================
// Stats v2 — category-aware aggregation
// ============================================================

// helpers --------------------------------------------------
// Cached display_timezone lookup (60s TTL) — used to align time buckets
// with the user's local-day boundary instead of UTC-midnight.
let _displayTz = 'Asia/Bangkok';
let _displayTzAt = 0;
async function getDisplayTz() {
  if (Date.now() - _displayTzAt < 60_000) return _displayTz;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='display_timezone'");
    const v = r.rows[0]?.value;
    if (typeof v === 'string' && v.trim()) _displayTz = v.trim();
  } catch {}
  _displayTzAt = Date.now();
  return _displayTz;
}

require('./routes/appearances')(app, pool, { getDisplayTz, getIP });

// LPR push receiver — Hikvision ITCCAM HTTP push → ingest + forward to Phuket server
require('./routes/lpr')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });

// LPR query — gallery / search API
require('./routes/lpr-query')(app, pool);

// LPR watchlist — CRUD for plate alert list
require('./routes/lpr-watchlist')(app, pool, { SNAPSHOT_DIR });
require('./routes/lpr-gates')(app, pool);  // RF4 — gate config CRUD
require('./routes/lpr-alerts')(app, pool); // RF-ALERT — watch-list hit alerts + ack
// IM3-R: cross-site face push receiver — camera auth via per-camera token in path
require('./routes/face-push')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });

// ============================================================
// Sites — multi-site lookup (→ src/routes/sites.js)
// ============================================================
require('./routes/sites')(app, pool, { auth, loadCameraConfig });

// ============================================================
// Event Categories & Mapping Rules (→ src/routes/categories.js)
// ============================================================
require('./routes/categories')(app, pool);

// System Settings (→ src/routes/settings.js)
require('./routes/settings')(app, pool, {
  auth, getIP, ANALYTICS_EVENT_KEYS, refreshAnalyticsEnabledSet,
  invalidateMapboxToken: () => { _cachedMapboxToken = null; },
  invalidateSystemSetting,
});

// Branding (white-label) — public GET + admin-only logo upload (→ src/routes/branding.js)
require('./routes/branding')(app, pool, BRANDING_DIR);

// ============================================================
// Health Check + Service Management + Health Reports (→ src/routes/health.js)
// ============================================================
const _serverStartedAt = Date.now();
require('./routes/health')(app, pool, {
  auth, routeError,
  _serverStartedAt, wss, loadCameraConfig, getSystemSettings,
  SNAPSHOT_DIR, MEDIA_DIR, fetchWorkerHealth,
  ALERT_WORKER_PORT, WORKER_PORT, CONFIG_FILE, INTERNAL_API_TOKEN,
  getBrandForReport, REPORTS_DIR, getDisplayTz,
});

// ============================================================
// Retention enforcement (daily)
// ============================================================

// Delete rows in batches to avoid a long-running table lock at high volume.
// Uses id-IN-subquery pattern so each batch is its own short transaction.
const _RETENTION_BATCH = 10_000;
async function _batchDelete(sql, params, label) {
  let total = 0, count;
  do {
    const res = await pool.query(sql, params);
    count = res.rowCount;
    total += count;
    if (count > 0) await new Promise(r => setTimeout(r, 100)); // yield between batches
  } while (count === _RETENTION_BATCH);
  if (total > 0) console.log(`🧹 Retention: deleted ${total} ${label}`);
  return total;
}

async function enforceRetention() {
  try {
    const _drv = await getSystemSetting(pool, 'data_retention_days');
    const days = Math.min(730, Math.max(1, parseInt(_drv || '365', 10)));
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
    // Explicit child-delete before events — all 5 children (appearances, license_plates,
    // face_event_notes, face_event_acks, lpr_alert_acks) lose their FK cascade
    // (dropped in MANUAL_partition_events_option_a.sql; required for partitioned parent).
    let _totalEventsDeleted = 0, _evBatch;
    do {
      // Class-E decouple: anprAlarm (LPR) is EXCLUDED from general retention — it
      // has its own window (lpr_retention_days, enforceLprRetention) so the slim
      // plate log can outlive general events. IS DISTINCT FROM also deletes
      // NULL-type rows. ⚠️ enforceLprRetention is now the SOLE authority for LPR
      // rows — if it stalls, anprAlarm has no general backstop (surface a metric).
      const _ids = await pool.query(
        `SELECT id FROM events WHERE event_time < $1 AND event_type IS DISTINCT FROM 'anprAlarm'
           ORDER BY event_time LIMIT $2`,
        [cutoff, _RETENTION_BATCH]
      );
      _evBatch = _ids.rowCount;
      if (_evBatch === 0) break;
      const ids = _ids.rows.map(r => r.id);
      await pool.query(`DELETE FROM appearances       WHERE event_id = ANY($1::bigint[])`, [ids]);
      // No-op after the anprAlarm exclusion (non-LPR events have no plates) —
      // kept defensively in case a non-anpr event ever carries a plate row.
      await pool.query(`DELETE FROM license_plates    WHERE event_id = ANY($1::bigint[])`, [ids]);
      await pool.query(`DELETE FROM face_event_notes  WHERE event_id = ANY($1::bigint[])`, [ids]);
      await pool.query(`DELETE FROM face_event_acks   WHERE event_id = ANY($1::bigint[])`, [ids]);
      await pool.query(`DELETE FROM lpr_alert_acks    WHERE event_id = ANY($1::bigint[])`, [ids]);
      const _del = await pool.query(`DELETE FROM events WHERE id = ANY($1::bigint[])`, [ids]);
      _totalEventsDeleted += _del.rowCount;
      if (_evBatch === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
    } while (_evBatch === _RETENTION_BATCH);
    if (_totalEventsDeleted > 0)
      console.log(`🧹 Retention: deleted ${_totalEventsDeleted} events older than ${days} days`);
    // appearances — optional separate retention (partial anonymisation: keep event, drop biometrics)
    // Capped at data_retention_days so it can never be LONGER than the event retention.
    const _arv = await getSystemSetting(pool, 'appearances_retention_days');
    if (_arv) {
      const arDays = Math.min(days, Math.max(1, parseInt(_arv, 10)));
      const arCutoff = new Date(Date.now() - arDays * 86400 * 1000).toISOString();
      await _batchDelete(
        `DELETE FROM appearances WHERE id IN (
           SELECT a.id FROM appearances a
           JOIN events e ON e.id = a.event_id
           WHERE e.event_time < $1 LIMIT $2
         )`,
        [arCutoff, _RETENTION_BATCH],
        `appearance rows older than ${arDays} days`
      );
    }
    // camera_status_log fixed at 90-day retention (Ph.1, decision #134)
    const logCutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    await pool.query(`DELETE FROM camera_status_log WHERE changed_at < $1`, [logCutoff]);
    // report_history rows — 90-day retention (Ph.2)
    const rhCutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    const rhDel = await pool.query(`DELETE FROM report_history WHERE created_at < $1`, [rhCutoff]);
    if (rhDel.rowCount > 0) console.log(`🧹 Retention: deleted ${rhDel.rowCount} report_history rows`);
    // LINE pending recipients — keep abandoned self-service requests for 30d.
    const pendingCutoff = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const prDel = await pool.query(
      `DELETE FROM pending_recipients WHERE status = 'pending' AND first_seen_at < $1`,
      [pendingCutoff]
    ).catch(() => ({ rowCount: 0 }));
    if (prDel.rowCount > 0) console.log(`🧹 Retention: deleted ${prDel.rowCount} pending LINE recipient(s)`);
    // report PNG files — 30-day retention (Ph.2)
    try {
      const pngCutoff = Date.now() - 30 * 86400 * 1000;
      const reportFiles = await fs.promises.readdir(REPORTS_DIR).catch(() => []);
      let pngDeleted = 0, pngFreed = 0;
      for (const fname of reportFiles) {
        if (!fname.toLowerCase().endsWith('.png')) continue;
        const full = path.join(REPORTS_DIR, fname);
        const st = await fs.promises.stat(full).catch(() => null);
        if (st && st.mtimeMs < pngCutoff) {
          pngFreed += st.size;
          await fs.promises.unlink(full).catch(() => {});
          pngDeleted++;
        }
      }
      if (pngDeleted > 0) {
        const mb = (pngFreed / (1024 * 1024)).toFixed(1);
        console.log(`🧹 Report PNG retention: deleted ${pngDeleted} files older than 30 days (~${mb} MB freed)`);
      }
    } catch {}
  } catch (err) {
    console.warn('🧹 Retention error:', err.message);
  }
}
// Run 60s after start, then once every 24h
setTimeout(enforceRetention, 60 * 1000);
setInterval(enforceRetention, 24 * 60 * 60 * 1000);

async function enforceSnapshotRetention() {
  try {
    const _srv = await getSystemSetting(pool, 'snapshot_retention_days');
    const days = Math.min(365, Math.max(1, parseInt(_srv || '30', 10)));
    const cutoffMs = Date.now() - days * 86400 * 1000;
    let scanned = 0, deleted = 0, freedBytes = 0;
    // Flat root files (legacy + non-LPR ingesters not yet migrated)
    const entries = await fs.promises.readdir(SNAPSHOT_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.png')) continue;
      scanned++;
      const full = path.join(SNAPSHOT_DIR, ent.name);
      try {
        const st = await fs.promises.stat(full);
        if (st.mtimeMs < cutoffMs) { freedBytes += st.size; await fs.promises.unlink(full); deleted++; }
      } catch {}
    }
    // Structured subdirs: events/ and face/ (same recursive logic as lpr-retention)
    for (const cat of ['events', 'face']) {
      const catDir = path.join(SNAPSHOT_DIR, cat);
      const dateDirs = await fs.promises.readdir(catDir, { withFileTypes: true }).catch(() => []);
      for (const dd of dateDirs) {
        if (!dd.isDirectory()) continue;
        const dateDir = path.join(catDir, dd.name);
        const camDirs = await fs.promises.readdir(dateDir, { withFileTypes: true }).catch(() => []);
        for (const cd of camDirs) {
          if (!cd.isDirectory()) continue;
          const camDir = path.join(dateDir, cd.name);
          const slotDirs = await fs.promises.readdir(camDir, { withFileTypes: true }).catch(() => []);
          for (const sd of slotDirs) {
            if (!sd.isDirectory()) continue;
            const slotDir = path.join(camDir, sd.name);
            for (const f of await fs.promises.readdir(slotDir).catch(() => [])) {
              const full = path.join(slotDir, f);
              const st = await fs.promises.stat(full).catch(() => null);
              if (st && st.isFile() && st.mtimeMs < cutoffMs) {
                freedBytes += st.size; await fs.promises.unlink(full).catch(() => {}); deleted++;
              }
            }
            const left = await fs.promises.readdir(slotDir).catch(() => ['_']);
            if (left.length === 0) await fs.promises.rmdir(slotDir).catch(() => {});
          }
          const left = await fs.promises.readdir(camDir).catch(() => ['_']);
          if (left.length === 0) await fs.promises.rmdir(camDir).catch(() => {});
        }
        const left = await fs.promises.readdir(dateDir).catch(() => ['_']);
        if (left.length === 0) await fs.promises.rmdir(dateDir).catch(() => {});
      }
    }
    if (deleted > 0) {
      const mb = (freedBytes / (1024 * 1024)).toFixed(1);
      console.log(`🧹 Snapshot retention: deleted ${deleted}/${scanned} flat + structured files older than ${days} days (~${mb} MB freed)`);
    }
    // Prune thumbnails by mtime — same cutoff as originals (works with both flat and subdir originals)
    try {
      for (const wdir of await fs.promises.readdir(THUMBS_DIR).catch(() => [])) {
        const wpath = path.join(THUMBS_DIR, wdir);
        for (const tf of await fs.promises.readdir(wpath).catch(() => [])) {
          const tfull = path.join(wpath, tf);
          const st = await fs.promises.stat(tfull).catch(() => null);
          if (st && st.mtimeMs < cutoffMs) await fs.promises.unlink(tfull).catch(() => {});
        }
      }
    } catch {}
  } catch (err) {
    console.warn('🧹 Snapshot retention error:', err.message);
  }
}
setTimeout(enforceSnapshotRetention, 90 * 1000);
setInterval(enforceSnapshotRetention, 24 * 60 * 60 * 1000);

// 🧹 RF4 — LPR retention: prune anprAlarm rows (lpr_retention_days, def 30) +
// snapshots/lpr/ images (lpr_image_retention_days, def 7). Own try/catch so a
// failure can't abort the other retention passes. (general enforceSnapshotRetention
// skips subdirs → snapshots/lpr/ would otherwise never be pruned.)
const { enforceLprRetention } = require('./lpr-retention');
async function _runLprRetention() {
  try {
    const metaDays  = await getSystemSetting(pool, 'lpr_retention_days');
    const imageDays = await getSystemSetting(pool, 'lpr_image_retention_days');
    const r = await enforceLprRetention({ pool, snapshotDir: SNAPSHOT_DIR, metaDays, imageDays, batch: _RETENTION_BATCH });
    if (r.rowsDeleted > 0)  console.log(`🧹 LPR retention: deleted ${r.rowsDeleted} anprAlarm rows older than ${r.metaDays} days`);
    if (r.filesDeleted > 0 || r.dirsRemoved > 0)
      console.log(`🧹 LPR retention: deleted ${r.filesDeleted} image files + ${r.dirsRemoved} whole expired date-dir(s) older than ${r.imageDays} days (~${(r.bytesFreed/1048576).toFixed(1)} MB freed from per-file path)`);
  } catch (err) {
    console.warn('🧹 LPR retention error:', err.message);
  }
}
setTimeout(_runLprRetention, 120 * 1000);
setInterval(_runLprRetention, 24 * 60 * 60 * 1000);

// 🎬 Phase 6.1.2 — Clip retention (delete old MP4 from media/ by mtime)
async function enforceClipRetention() {
  try {
    const _crv = await getSystemSetting(pool, 'clip_retention_days');
    const days = Math.min(90, Math.max(1, parseInt(_crv || '30', 10)));
    const cutoffMs = Date.now() - days * 86400 * 1000;
    let scanned = 0, deleted = 0, freedBytes = 0;
    const entries = await fs.promises.readdir(MEDIA_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      if (!lower.endsWith('.mp4') && !lower.endsWith('.webm')) continue;
      scanned++;
      const full = path.join(MEDIA_DIR, ent.name);
      try {
        const st = await fs.promises.stat(full);
        if (st.mtimeMs < cutoffMs) {
          freedBytes += st.size;
          await fs.promises.unlink(full);
          deleted++;
        }
      } catch {}
    }
    if (deleted > 0) {
      const mb = (freedBytes / (1024 * 1024)).toFixed(1);
      console.log(`🎬 Clip retention: deleted ${deleted}/${scanned} files older than ${days} days (~${mb} MB freed)`);
    }
  } catch (err) {
    console.warn('🎬 Clip retention error:', err.message);
  }
}
setTimeout(enforceClipRetention, 120 * 1000);
setInterval(enforceClipRetention, 24 * 60 * 60 * 1000);

// 🧹 Class-D retention — strip the raw Hik ANPR XML slice from OLD events while
// keeping the row + parsed columns. rawXml is ~90% of the events table but is
// debug/re-parse-only; the used field (seatbelt) is a column since migration 073,
// so the filter/modal don't need it long-term. The time window is a safety net:
// a newly-enabled camera analytic has `rawxml_retention_days` to be noticed and
// columnised before its data ages out. Only reader is the modal remark, which
// degrades gracefully (no remark on stripped rows — >window old = no image anyway).
// NOTE keep-set: plateType / plateCharBelieve / tailandStateID / licenseBright are
// still rawXml-only → they are LOST on expiry. Columnise before shrinking the window.
async function enforceRawXmlRetention() {
  try {
    const _rrv = await getSystemSetting(pool, 'rawxml_retention_days');
    const days = Math.min(365, Math.max(7, parseInt(_rrv || '90', 10)));  // default 90, clamp 7..365
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
    let total = 0, n;
    // ponytail: `- 'rawXml'` rewrites the whole row (MVCC dead tuple). Fine now;
    // at ~333k/day aging past cutoff, add a partial index
    //   ON events(event_time) WHERE raw_json ? 'rawXml'  (shrinks as rows strip).
    do {
      const ids = await pool.query(
        `SELECT id FROM events WHERE event_time < $1 AND raw_json ? 'rawXml'
           ORDER BY event_time LIMIT $2`,
        [cutoff, _RETENTION_BATCH]);
      n = ids.rowCount;
      if (n === 0) break;
      const arr = ids.rows.map(r => r.id);
      const upd = await pool.query(
        `UPDATE events SET raw_json = raw_json - 'rawXml' WHERE id = ANY($1::bigint[])`, [arr]);
      total += upd.rowCount;
      if (n === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
    } while (n === _RETENTION_BATCH);
    if (total > 0) console.log(`🧹 rawXml retention: stripped ${total} rows older than ${days} days`);
  } catch (err) {
    console.warn('🧹 rawXml retention error:', err.message);
  }
}
setTimeout(enforceRawXmlRetention, 150 * 1000);
setInterval(enforceRawXmlRetention, 24 * 60 * 60 * 1000);

// ============================================================
// Executive Summary route (GET /api/stats/executive-summary)
// Auth is inherited from the global /api gate above (line ~427).
// ============================================================
// Resolve version from git at boot — was hard-coded 'v1.2.0' / '2026-05-07'
// which went stale immediately. Falls back to those if git isn't available
// (e.g. deployed from a tarball without .git).
let _execVersion = 'v1.2.x', _execVersionDate = '';
try {
  const { execSync } = require('child_process');
  const opt = { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  _execVersion = 'git-' + execSync('git rev-parse --short HEAD', opt).trim();
  _execVersionDate = execSync('git log -1 --format=%cd --date=short', opt).trim();
} catch { /* keep fallback */ }

require('./stats-summary-route')(app, pool, {
  snapshotDir: SNAPSHOT_DIR,
  mediaDir:    MEDIA_DIR,
  startedAt:   _serverStartedAt,
  version:     _execVersion,
  versionDate: _execVersionDate,
  // cameras-config.json is the source of truth for the camera LIST + lat/lon
  // (the DB `cameras` table only holds runtime state — last_seen_at, recording
  // status — and auto-registers extra rows from MQTT traffic). The exec-summary
  // route must read the list from here, same as GET /api/cameras does.
  loadCameraConfig,
  // Hand the exec-summary route the live clause builder so its KPI / breakdown
  // / per-camera / by-hour queries honour `analytics_event_display` — Trigger
  // I/O events stay in the DB but no longer pollute Top Rules / Event Breakdown
  // by default (operator opts them in via System Settings).
  disabledAnalyticsClause,
});

// ── Start ──
// Schema migrations run BEFORE accepting traffic so any pending
// db_migration_*.sql files land on the existing volume — this is
// the safety net that replaced the old `down -v` workflow.
const PORT = process.env.API_PORT || 3000;
(async () => {
  console.log('▶ Running schema migrations...');
  try {
    await require('./migrate').runMigrations(pool);
  } catch (e) {
    console.error('❌ Migration failed — aborting startup.');
    console.error('   Restore the latest backup or fix the migration file, then retry.');
    process.exit(1);
  }
  // SEC: bind loopback only — ทุก consumer (Cloudflare Tunnel, report-worker,
  // dashboard same-origin, Vigil Mobile ผ่าน tunnel) เข้าทาง localhost ทั้งหมด
  // การเปิด 0.0.0.0 ทำให้ทั้ง LAN (รวม camera subnet) ยิง API ตรงข้าม
  // Cloudflare Access ได้ — ถ้า deployment ไหนต้องการ LAN ตรง ให้ตั้ง BIND_HOST=0.0.0.0
  const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
  server.listen(PORT, BIND_HOST, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log(`║  🌐 API: http://localhost:${PORT}                   ║`);
    console.log(`║  📸 Snapshots: http://localhost:${PORT}/snapshots/  ║`);
    console.log(`║  📋 Config: ${CONFIG_FILE}`);
    console.log(`║  👥 Groups: ${GROUPS_FILE}`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  });
})();

// ============================================================
// Heartbeat Checker — auto mark กล้องเป็น offline ใน DB
// (Ph.1) + fire LINE alert เมื่อกล้องออฟไลน์ / กลับมาออนไลน์
// ตรวจทุก 30 วินาที, ถ้า last_seen เก่ากว่า OFFLINE_THRESHOLD_SEC
// → update DB + broadcast ผ่าน WebSocket + log + LINE
// ============================================================

// Quiet-hours check for camera offline alerts — same semantics as
// alert-engine's isWithinQuietHours (decision #90): LINE is SILENCED
// while now ∈ [quiet_from, quiet_to); NULL = always fire.
function _camAlertInQuiet(cfg, tz) {
  if (!cfg.quiet_from || !cfg.quiet_to) return false;
  const from = String(cfg.quiet_from).slice(0, 5);
  const to   = String(cfg.quiet_to).slice(0, 5);
  if (from === to) return false;
  const now = new Date().toLocaleTimeString('en-GB', {
    timeZone: tz || 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return from < to ? (now >= from && now < to) : (now >= from || now < to);
}

// Build + send a camera-status LINE message to the appropriate recipients.
// status: 'offline' | 'online'
async function _sendCameraStatusLine({ cameraId, status, offlineSince, camCfg, alertCfg, lineCfg, tz }) {
  if (!lineCfg || !lineCfg.enabled || !lineCfg.channel_access_token) return;
  const roster    = Array.isArray(lineCfg.recipients) ? lineCfg.recipients : [];
  const wanted    = String(alertCfg.recipient_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const targetIds = wanted.length > 0
    ? roster.filter(r => r.enabled && wanted.includes(r.id)).map(r => r.id)
    : roster.filter(r => r.enabled).map(r => r.id);
  if (targetIds.length === 0) return;

  const camName  = camCfg ? (camCfg.camera_name || camCfg.camera_id) : cameraId;
  const location = camCfg ? (camCfg.location || '—') : '—';
  const timeStr  = new Date().toLocaleString('th-TH', { timeZone: tz || 'Asia/Bangkok', hour12: false });

  let text;
  if (status === 'mqtt_silent') {
    // ข้อ 7 (2026-06-12): กล้อง online (HTTP/ONVIF ตอบ) แต่ MQTT ไม่ต่อ EMQX
    // → events เงียบทั้งที่ดูปกติ (เคสจริง: รหัส MQTT บนกล้องหลุด เงียบ 4 ชม.)
    text = `🟠 กล้อง Online แต่ MQTT ขาด — events ไม่เข้า!\n📷 ${camName}\n📍 ${location}\n🕐 ${timeStr}\nตรวจรหัส MQTT บนกล้อง / EMQX (GOTCHAS: Online+ไม่มี events)`;
  } else if (status === 'mqtt_restored') {
    text = `🟢 MQTT กลับมาปกติ\n📷 ${camName}\n📍 ${location}\n🕐 ${timeStr}`;
  } else if (status === 'offline') {
    text = `🔴 กล้องออฟไลน์!\n📷 ${camName}\n📍 ${location}\n🕐 ${timeStr}`;
  } else {
    let dur = '';
    if (offlineSince) {
      const sec = Math.round((Date.now() - new Date(offlineSince).getTime()) / 1000);
      if (sec >= 3600) dur = ` (ออฟไลน์ ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m)`;
      else if (sec >= 60) dur = ` (ออฟไลน์ ${Math.floor(sec / 60)} นาที)`;
      else dur = ` (ออฟไลน์ ${sec} วินาที)`;
    }
    text = `🟢 กล้องกลับมาออนไลน์!${dur}\n📷 ${camName}\n📍 ${location}\n🕐 ${timeStr}`;
  }

  const messages = [{ type: 'text', text }];
  for (const id of targetIds) {
    await lineSender.pushLineMessage(lineCfg.channel_access_token, id, messages).catch(() => {});
  }
}

// ── MQTT-silent watch (ข้อ 7, 2026-06-12) ────────────────────
// ตรวจอาการ "กล้อง online แต่ MQTT ไม่ต่อ EMQX" = events เงียบทั้งที่ดูปกติ
// (ครอบทั้ง auth fail จากรหัสหลุด และ MQTT config พังบนกล้อง). ต้องเห็น
// อาการ 2 รอบติด (กัน reconnect ชั่วคราว) · เตือนซ้ำทุก ≥60 นาที ·
// ใช้ recipients ของ camera offline alert เดิม (ไม่มี config = ไม่เตือน)
const _mqttSilent = new Map();   // camera_id → { streak, lastAlertAt, alerted }
const MQTT_SILENT_REALERT_MS = 60 * 60 * 1000;

const EMQX_API_BASE = 'http://localhost:18083/api/v5';
async function _emqxConnectedUsernames() {
  const dashPass = process.env.EMQX_DASHBOARD_PASSWORD;
  if (!dashPass) return null;
  try {
    const login = await fetch(`${EMQX_API_BASE}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: dashPass }),
    });
    if (!login.ok) return null;
    const { token } = await login.json();
    const r = await fetch(`${EMQX_API_BASE}/clients?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const body = await r.json();
    return new Set((body.data || []).filter(c => c.connected).map(c => c.username).filter(Boolean));
  } catch { return null; }   // EMQX ล่ม/ช้า → null = งดตัดสิน (ห้าม false alarm)
}

async function checkMqttSilent({ cfgCameras, onlineIds, alertMap, lineCfg, tz }) {
  const mqttCams = cfgCameras.filter(c =>
    (c.vendor || 'bosch').toLowerCase() === 'bosch' && c.mqtt_username);
  if (mqttCams.length === 0) return;
  const connected = await _emqxConnectedUsernames();
  if (!connected) return;
  for (const cam of mqttCams) {
    const id = cam.camera_id;
    const st = _mqttSilent.get(id) || { streak: 0, lastAlertAt: 0, alerted: false };
    const silent = onlineIds.has(id) && !connected.has(cam.mqtt_username);
    if (!silent) {
      if (st.alerted && connected.has(cam.mqtt_username)) {
        const alertCfg = alertMap[id];
        if (alertCfg && alertCfg.enabled) {
          _sendCameraStatusLine({ cameraId: id, status: 'mqtt_restored',
            camCfg: cam, alertCfg, lineCfg, tz }).catch(() => {});
        }
        console.log(`  🟢 [${id}] MQTT restored`);
      }
      _mqttSilent.delete(id);
      continue;
    }
    st.streak++;
    if (st.streak >= 2 && Date.now() - st.lastAlertAt >= MQTT_SILENT_REALERT_MS) {
      const alertCfg = alertMap[id];
      if (alertCfg && alertCfg.enabled && !_camAlertInQuiet(alertCfg, tz)) {
        _sendCameraStatusLine({ cameraId: id, status: 'mqtt_silent',
          camCfg: cam, alertCfg, lineCfg, tz }).catch(() => {});
        st.lastAlertAt = Date.now();
        st.alerted = true;
      }
      console.warn(`  🟠 [${id}] online but MQTT not connected (streak ${st.streak})`);
    }
    _mqttSilent.set(id, st);
  }
}

async function checkOfflineCameras() {
  try {
    // Scope to cameras-config.json (decision #86) — DB may have stale rows.
    const cfgCameras = (loadCameraConfig().cameras) || [];
    const cfgIds = cfgCameras.map(c => c.camera_id || c.id).filter(Boolean);
    if (cfgIds.length === 0) return;

    const [camRes, alertRes, lineRes] = await Promise.all([
      pool.query(`
        SELECT id AS camera_id, last_seen_at AS last_seen, enabled, paused
        FROM cameras WHERE id = ANY($1::text[])
      `, [cfgIds]),
      pool.query(`
        SELECT * FROM camera_offline_alerts WHERE camera_id = ANY($1::text[])
      `, [cfgIds]),
      pool.query(`SELECT * FROM line_config WHERE id = 1`),
    ]);

    const alertMap = {};
    alertRes.rows.forEach(r => { alertMap[r.camera_id] = r; });
    const lineCfg = lineRes.rows[0];
    const tz = await getDisplayTz();
    const now = Date.now();
    const changes = [];

    // ข้อ 7 — MQTT-silent watch: ใช้ heartbeat ชุดเดียวกับ watchdog
    const onlineIds = new Set(camRes.rows
      .filter(c => !c.paused && c.last_seen
        && (now - new Date(c.last_seen).getTime()) / 1000 < OFFLINE_THRESHOLD_SEC)
      .map(c => c.camera_id));
    checkMqttSilent({ cfgCameras, onlineIds, alertMap, lineCfg, tz })
      .catch(e => console.warn('[mqtt-silent] check error:', e.message));

    for (const cam of camRes.rows) {
      if (cam.paused) continue; // paused = intentional maintenance; skip watchdog entirely

      const ageSec = cam.last_seen
        ? (now - new Date(cam.last_seen).getTime()) / 1000
        : Infinity;
      const isOnline = ageSec < OFFLINE_THRESHOLD_SEC;
      const computedStatus = isOnline ? 'online' : 'offline';
      const cfgCam = cfgCameras.find(c => (c.camera_id || c.id) === cam.camera_id);
      const alertCfg = alertMap[cam.camera_id];

      // ── Transition detected ──────────────────────────────────
      if (cam.enabled !== isOnline) {
        await pool.query('UPDATE cameras SET enabled = $1 WHERE id = $2', [isOnline, cam.camera_id]);
        await pool.query(
          `INSERT INTO camera_status_log (camera_id, status, reason) VALUES ($1, $2, $3)`,
          [cam.camera_id, computedStatus, isOnline ? 'heartbeat restored' : 'heartbeat timeout']
        );
        changes.push({ camera_id: cam.camera_id, status: computedStatus });
        console.log(`  ${isOnline ? '🟢' : '🔴'} [${cam.camera_id}] → ${computedStatus}`);

        if (isOnline) {
          // Camera came back online — fire recovery alert if one was sent
          const hadAlert = alertCfg && alertCfg.last_alert_at;
          if (hadAlert && alertCfg.enabled) {
            _sendCameraStatusLine({
              cameraId: cam.camera_id, status: 'online',
              offlineSince: alertCfg.offline_since,
              camCfg: cfgCam, alertCfg, lineCfg, tz,
            }).catch(() => {});
          }
          // Clear offline tracking
          await pool.query(
            `INSERT INTO camera_offline_alerts (camera_id, offline_since, last_alert_at, updated_at)
             VALUES ($1, NULL, NULL, NOW())
             ON CONFLICT (camera_id) DO UPDATE
               SET offline_since=NULL, last_alert_at=NULL, updated_at=NOW()`,
            [cam.camera_id]
          );
        } else {
          // Camera just went offline — record offline_since (only if not already tracking)
          await pool.query(
            `INSERT INTO camera_offline_alerts (camera_id, offline_since, updated_at)
             VALUES ($1, NOW(), NOW())
             ON CONFLICT (camera_id) DO UPDATE
               SET offline_since = COALESCE(camera_offline_alerts.offline_since, EXCLUDED.offline_since),
                   updated_at = NOW()`,
            [cam.camera_id]
          );
        }
      } else if (!isOnline) {
        // Still offline (no state change) — ensure offline_since is set
        if (!alertCfg || !alertCfg.offline_since) {
          await pool.query(
            `INSERT INTO camera_offline_alerts (camera_id, offline_since, updated_at)
             VALUES ($1, NOW(), NOW())
             ON CONFLICT (camera_id) DO UPDATE
               SET offline_since = COALESCE(camera_offline_alerts.offline_since, NOW()),
                   updated_at = NOW()`,
            [cam.camera_id]
          );
        }
      }

      // ── Offline alert / escalation ───────────────────────────
      // Re-read alertCfg from DB for the camera (may have been upserted above)
      if (!isOnline && alertCfg && alertCfg.enabled) {
        // Use the DB offline_since (or NOW as a safe fallback)
        const offlineSince = alertCfg.offline_since || new Date();
        const offlineSec = (now - new Date(offlineSince).getTime()) / 1000;

        if (offlineSec >= (alertCfg.notify_after_sec || 300)) {
          const lastAlertAt    = alertCfg.last_alert_at;
          const escalateMs     = (alertCfg.escalate_interval_min || 60) * 60 * 1000;
          const sinceLastAlert = lastAlertAt ? (now - new Date(lastAlertAt).getTime()) : Infinity;

          if (!lastAlertAt || (!alertCfg.escalate_once && sinceLastAlert >= escalateMs)) {
            if (!_camAlertInQuiet(alertCfg, tz)) {
              _sendCameraStatusLine({
                cameraId: cam.camera_id, status: 'offline',
                offlineSince,
                camCfg: cfgCam, alertCfg, lineCfg, tz,
              }).then(async () => {
                await pool.query(
                  `UPDATE camera_offline_alerts SET last_alert_at=NOW() WHERE camera_id=$1`,
                  [cam.camera_id]
                );
              }).catch(() => {});
            }
          }
        }
      }
    }

    // WS broadcast for UI (unchanged behaviour)
    if (changes.length > 0 && typeof wss !== 'undefined') {
      const msg = JSON.stringify({ type: 'camera_status', changes });
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
    }
  } catch (e) {
    // ignore (DB อาจ disconnect ชั่วคราว)
  }
}

// ตรวจทุก 30 วินาที
setInterval(checkOfflineCameras, 30 * 1000);
// Run ครั้งแรกหลัง startup 5 วินาที
setTimeout(checkOfflineCameras, 5000);

// ============================================================
// Recorder-stale Checker — LINE alert เมื่อ media-buffer หยุดไหล
// (GOTCHAS #84 follow-up, 2026-06-10)
// ------------------------------------------------------------
// buffer dir ของกล้องที่ recorder ทำงานปกติจะ churn ทุกวินาที — ถ้า mtime
// แช่แข็งขณะที่กล้องยัง "ออนไลน์" (events ไหลปกติ) = RTSP pull wedged
// (เช่น LNP grant หายหลัง restart ผิดวิธี) ซึ่ง camera-offline alert จับไม่ได้
// — failure mode เดียวกับ incident ที่เงียบไป ~17 ชม. เมื่อ 2026-06-09.
// กล้อง offline → ข้าม (มี camera-offline alert อยู่แล้ว ไม่ส่งซ้ำสองเด้ง)
// Alert ครั้งเดียวต่อ episode + recovery message; state ใน memory.
// ============================================================
const RECORDER_STALE_SEC     = 300;            // buffer แช่แข็ง ≥ 5 นาที → alert
const RECORDER_BOOT_GRACE_MS = 3 * 60 * 1000;  // ข้ามช่วง 3 นาทีแรกหลัง api boot

const _recorderStale = new Map(); // camera_id → { since: ms, alerted: bool }

async function _sendRecorderStaleLine({ cameraId, kind, staleSec, camCfg, alertCfg, lineCfg, tz }) {
  if (!lineCfg || !lineCfg.enabled || !lineCfg.channel_access_token) return;
  const roster = Array.isArray(lineCfg.recipients) ? lineCfg.recipients : [];
  const wanted = String((alertCfg && alertCfg.recipient_ids) || '').split(',').map(s => s.trim()).filter(Boolean);
  const targetIds = wanted.length > 0
    ? roster.filter(r => r.enabled && wanted.includes(r.id)).map(r => r.id)
    : roster.filter(r => r.enabled).map(r => r.id);
  if (targetIds.length === 0) return;
  const camName  = camCfg ? (camCfg.camera_name || camCfg.camera_id) : cameraId;
  const location = camCfg ? (camCfg.location || '—') : '—';
  const timeStr  = new Date().toLocaleString('th-TH', { timeZone: tz || 'Asia/Bangkok', hour12: false });
  const mins = Math.max(1, Math.round(staleSec / 60));
  const text = kind === 'stale'
    ? `🟠 การบันทึกวิดีโอหยุดทำงาน!\n📷 ${camName}\n📍 ${location}\n⏱ buffer ไม่อัปเดต ${mins} นาที (กล้องยังออนไลน์)\n🕐 ${timeStr}`
    : `🟢 การบันทึกวิดีโอกลับมาทำงานแล้ว (หยุดไป ${mins} นาที)\n📷 ${camName}\n📍 ${location}\n🕐 ${timeStr}`;
  for (const id of targetIds) {
    await lineSender.pushLineMessage(lineCfg.channel_access_token, id, [{ type: 'text', text }]).catch(() => {});
  }
}

async function checkStaleRecorders() {
  try {
    if (process.uptime() * 1000 < RECORDER_BOOT_GRACE_MS) return;
    const cfgCameras = (loadCameraConfig().cameras) || [];
    const credMap = {};
    cfgCameras.forEach(c => { credMap[c.camera_id || c.id] = c; });
    const ids = Object.keys(credMap).filter(Boolean);
    if (!ids.length) return;

    const [camRes, alertRes, lineRes] = await Promise.all([
      pool.query(`
        SELECT c.id, c.last_seen_at, c.enabled, c.paused, c.enable_clip_capture, c.enable_snapshot,
               (c.site_id IS NULL OR s.code = 'main') AS is_local_site
        FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
        WHERE c.id = ANY($1::text[])`, [ids]),
      pool.query(`SELECT * FROM camera_offline_alerts WHERE camera_id = ANY($1::text[])`, [ids]),
      pool.query(`SELECT * FROM line_config WHERE id = 1`),
    ]);
    const alertMap = {};
    alertRes.rows.forEach(r => { alertMap[r.camera_id] = r; });
    const lineCfg = lineRes.rows[0];
    const tz = await getDisplayTz();
    const now = Date.now();
    const mbDir = path.join(__dirname, '..', 'media-buffer');

    for (const cam of camRes.rows) {
      // Mirror recorderNeeded() ของ media-recorder: clip capture (ทุก vendor)
      // หรือ Dahua ที่ดึง snapshot จาก buffer; ข้าม disabled/paused/กล้อง edge
      // (media-recorder เองก็กรอง site ทิ้งแล้ว — ไม่งั้นจะ alert ค้างสำหรับกล้องที่
      // ไม่มีทาง reachable จาก central อยู่แล้วโดยดีไซน์)
      const vendor = String((credMap[cam.id] || {}).vendor || 'bosch').toLowerCase();
      const needsRecorder = cam.enabled && !cam.paused && cam.is_local_site &&
        (cam.enable_clip_capture || (vendor === 'dahua' && cam.enable_snapshot));
      const ageSec = cam.last_seen_at ? (now - new Date(cam.last_seen_at).getTime()) / 1000 : Infinity;
      const camOnline = ageSec < OFFLINE_THRESHOLD_SEC;
      if (!needsRecorder || !camOnline) { _recorderStale.delete(cam.id); continue; }

      let mtime = 0;
      try { mtime = (await fs.promises.stat(path.join(mbDir, cam.id))).mtimeMs; }
      catch { /* dir ยังไม่ถูกสร้าง — นับเป็น stale */ }
      const staleSec = mtime ? (now - mtime) / 1000 : Infinity;
      const alertCfg = alertMap[cam.id];

      if (staleSec >= RECORDER_STALE_SEC) {
        if (!_recorderStale.has(cam.id)) _recorderStale.set(cam.id, { since: mtime || now, alerted: false });
        const st = _recorderStale.get(cam.id);
        if (!st.alerted) {
          st.alerted = true;
          console.warn(`  🟠 [${cam.id}] media-buffer stale ${Math.round(Math.min(staleSec, 86400 * 365))}s — recorder wedged?`);
          // เคารพ enabled + quiet hours ของ camera alert config เดิม (decision #90)
          if ((!alertCfg || alertCfg.enabled) && !(alertCfg && _camAlertInQuiet(alertCfg, tz))) {
            _sendRecorderStaleLine({
              cameraId: cam.id, kind: 'stale',
              staleSec: Math.min(staleSec, 86400 * 365),
              camCfg: credMap[cam.id], alertCfg, lineCfg, tz,
            }).catch(() => {});
          }
        }
      } else if (_recorderStale.has(cam.id)) {
        const st = _recorderStale.get(cam.id);
        if (st.alerted) {
          const downSec = (now - st.since) / 1000;
          console.log(`  🟢 [${cam.id}] media-buffer flowing again (หยุดไป ${Math.round(downSec)}s)`);
          if ((!alertCfg || alertCfg.enabled) && !(alertCfg && _camAlertInQuiet(alertCfg, tz))) {
            _sendRecorderStaleLine({
              cameraId: cam.id, kind: 'recovered', staleSec: downSec,
              camCfg: credMap[cam.id], alertCfg, lineCfg, tz,
            }).catch(() => {});
          }
        }
        _recorderStale.delete(cam.id);
      }
    }
  } catch (e) {
    console.warn('recorder-stale check error:', e.message || e);
  }
}
setInterval(checkStaleRecorders, 60 * 1000);

// ============================================================
// Monitor-only camera reachability (ONVIF / Dahua)
// ============================================================
// ONVIF cameras are monitor-only (no event ingester). Dahua has a CGI
// ingester (dahua-cgi.js) that touches last_seen_at on every event chunk,
// but quiet cameras with no VCA activity would show permanently offline
// without this probe. TCP probe every 60s is the fallback heartbeat for
// both: cheap (4s connect, no auth, no payload), covers the quiet-Dahua
// and all-ONVIF cases where the ingester alone is insufficient.
function probeCameraReachable(host, port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: 4000 });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error',   () => done(false));
  });
}
async function checkMonitorCameras() {
  try {
    const cams = (loadCameraConfig().cameras || []).filter(c => {
      const v = String(c.vendor || 'bosch').toLowerCase();
      return (v === 'onvif' || v === 'dahua') && c.ip_address;
    });
    for (const c of cams) {
      const ok = await probeCameraReachable(c.ip_address, parseInt(c.http_port, 10) || 80);
      if (ok) {
        await pool.query(
          `UPDATE cameras SET last_seen_at = NOW() WHERE id = $1`,
          [c.camera_id]
        ).catch(() => {});
      }
    }
  } catch { /* ignore — DB may blip */ }
}
setInterval(checkMonitorCameras, 60 * 1000);
setTimeout(checkMonitorCameras, 8000);
