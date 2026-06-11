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
const MAP_CACHE_DIR = path.join(__dirname, '..', 'map-cache');
const MAP_AREAS_FILE = path.join(__dirname, '..', 'map-areas.json');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
if (!fs.existsSync(MAP_CACHE_DIR)) fs.mkdirSync(MAP_CACHE_DIR, { recursive: true });

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
  '/others',              // static mount triggers internal redirect to /others/
]);
const PUBLIC_PREFIXES = [
  '/vendor/',             // self-hosted libs (air-datepicker, fonts) — needed by login/disclaimer
  '/branding/',           // brand logo image
  '/tiles/',              // cached map tiles, non-sensitive
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
// (separate process) can share the same token. Falls back to ephemeral
// random if not set (report-worker will not work in that case).
// Constant-time compare; defined before static-asset middleware.
const INTERNAL_API_TOKEN = (() => {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s || s.length < 32) {
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
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'brand_logo_path' LIMIT 1`
    );
    const file = (r.rows[0]?.value || '').trim();
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
// Dashboard shell — served through a route (not plain static) so
// dashboard.js gets a cache-busting ?v=<mtime> stamp. Cloudflare caches
// static .js aggressively; a stale dashboard.js silently breaks new UI
// (MV.3c face modal hit exactly this). index.html itself goes out
// no-cache — it's tiny and must always carry the current ?v.
app.get(['/', '/index.html'], (req, res) => {
  try {
    const dir = path.join(__dirname, '..', 'dashboard');
    let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const v = Math.floor(fs.statSync(path.join(dir, 'dashboard.js')).mtimeMs);
    html = html.replace('/dashboard.js', `/dashboard.js?v=${v}`);
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('index load error');
  }
});
app.use(express.static(path.join(__dirname, '..', 'dashboard'), { dotfiles: 'deny' }));

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
function thumbWidth(q) {
  const n = parseInt(q, 10);
  return THUMB_WIDTHS.has(n) ? n : null;
}
function jpegResizer(w) {
  return sharp({ failOn: 'none' })
    .resize(w, null, { withoutEnlargement: true })
    .jpeg({ quality: 78 });
}

app.get('/snapshots/:filename', async (req, res) => {
  try {
    const token = getSessionToken(req);
    const user = token ? await auth.getUserFromToken(token) : null;
    if (!user) return res.status(401).end();

    const filename = req.params.filename;
    if (!/^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$/i.test(filename)) {
      return res.status(400).end();
    }
    const file = path.join(SNAPSHOT_DIR, filename);
    if (!fs.existsSync(file)) return res.status(404).end();

    // ?w=N → serve a lazily-built, disk-cached thumbnail. The cache
    // file lives in .thumbs/<w>/ and is pruned with the original.
    const w = thumbWidth(req.query.w);
    if (w) {
      const tdir  = path.join(THUMBS_DIR, String(w));
      const tpath = path.join(tdir, filename);
      try {
        let thumb;
        try {
          thumb = await fs.promises.readFile(tpath);
        } catch {
          // cache miss — build thumbnail
          const src = await fs.promises.readFile(file);
          thumb = await sharp(src, { failOn: 'none' })
            .resize(w, null, { withoutEnlargement: true })
            .jpeg({ quality: 78 }).toBuffer();
          await fs.promises.mkdir(tdir, { recursive: true });
          await fs.promises.writeFile(tpath, thumb).catch(() => {});
        }
        // res.send(Buffer) — not sendFile: the .thumbs dot-folder would
        // trip sendFile's default dotfiles:'ignore' and 404.
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(thumb);
      } catch { /* fall through to the full image */ }
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
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

// ============================================================
// API: Authentication
// ============================================================

// Rate limit map (in-memory, simple)
const loginAttemptsByIP = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (loginAttemptsByIP.get(ip) || []).filter(t => now - t < 60000); // last 1 min
  loginAttemptsByIP.set(ip, arr);
  return arr.length < 10; // max 10 attempts per minute per IP
}
function recordAttempt(ip) {
  const arr = loginAttemptsByIP.get(ip) || [];
  arr.push(Date.now());
  loginAttemptsByIP.set(ip, arr);
}
// Prune stale per-IP buckets every 5 min so a flood of distinct client IPs
// can't grow this Map without bound (memory-exhaustion guard).
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of loginAttemptsByIP) {
    const fresh = arr.filter(t => now - t < 60000);
    if (fresh.length) loginAttemptsByIP.set(ip, fresh);
    else loginAttemptsByIP.delete(ip);
  }
}, 5 * 60 * 1000);

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const ip = getIP(req);
    const ua = req.headers['user-agent'] || '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username + password required' });
    }
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 1 minute.' });
    }
    recordAttempt(ip);

    const result = await auth.login(username, password, ip, ua);
    if (!result.success) return res.status(401).json({ error: result.error });

    // Phase 8.0 — kick the trial clock on the first successful login.
    // Idempotent: subsequent logins don't reset it. Failures here are
    // non-fatal (worst case the trial starts on the next login attempt).
    license.recordFirstLogin(pool).catch(() => {});

    // Set cookie — Safari-friendly + HTTPS-aware (Cloudflare Tunnel)
    // Cloudflare ส่ง x-forwarded-proto: https + cf-visitor header
    const xfp = req.headers['x-forwarded-proto'];
    const cfVisitor = req.headers['cf-visitor'];  // {"scheme":"https"}
    const isHttps = req.secure
                  || xfp === 'https'
                  || (cfVisitor && cfVisitor.includes('https'));

    console.log(`🔐 LOGIN | host=${req.headers.host} | xfp=${xfp} | cf-visitor=${cfVisitor} | isHttps=${isHttps}`);

    const cookieParts = [
      `session=${encodeURIComponent(result.token)}`,
      'Path=/',
      'HttpOnly',
      `Max-Age=${7 * 24 * 60 * 60}`,  // 7 days
    ];
    if (isHttps) {
      cookieParts.push('Secure');
      cookieParts.push('SameSite=Lax');
    } else {
      cookieParts.push('SameSite=Lax');
    }
    res.setHeader('Set-Cookie', cookieParts.join('; '));

    // 🆕 ส่ง token ใน response body ด้วย — สำหรับ Safari ITP fallback
    // Frontend จะเก็บใน localStorage + ส่งผ่าน Authorization header
    res.json({
      success: true,
      user: result.user,
      token: result.token  // <-- เพิ่มบรรทัดนี้
    });
  } catch (e) { routeError(res, e, 'POST /api/auth/login'); }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (token) await auth.logout(token, getIP(req), req.headers['user-agent']);
    // SEC-010: match flags with login cookie — Secure only over HTTPS, SameSite always
    const xfp = req.headers['x-forwarded-proto'];
    const cfv = req.headers['cf-visitor'];
    const isHttps = req.secure || xfp === 'https' || (cfv && cfv.includes('https'));
    const flags = ['session=', 'Path=/', 'HttpOnly', 'Max-Age=0', 'SameSite=Lax'];
    if (isHttps) flags.push('Secure');
    res.setHeader('Set-Cookie', flags.join('; '));
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/auth/logout'); }
});

// Get current user info (สำหรับ frontend check login state)
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (!token) {
      // Debug: note the miss WITHOUT dumping the raw Cookie header — that
      // header can carry session/other cookie values and must not land in logs.
      const hasCookieHeader = !!req.headers.cookie;
      console.log(`🔐 /api/auth/me — NO TOKEN | UA: ${(req.headers['user-agent'] || '').slice(0, 50)} | cookie present: ${hasCookieHeader}`);
      return res.status(401).json({ error: 'Not authenticated', hasCookieHeader });
    }
    const user = await auth.getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    res.json({ user });
  } catch (e) { routeError(res, e, 'GET /api/auth/me'); }
});

// Change own password
app.post('/api/auth/change-password', auth.requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    await auth.changeOwnPassword(req.user.id, oldPassword, newPassword);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get my active sessions
app.get('/api/auth/sessions', auth.requireAuth, async (req, res) => {
  try {
    const sessions = await auth.getActiveSessions(req.user.id);
    // Mark current session
    res.json(sessions.map(s => ({
      ...s,
      id: s.id.slice(0, 8) + '...',  // hide full ID
      is_current: s.id === req.user.session_id,
    })));
  } catch (e) { routeError(res, e, 'GET /api/auth/sessions'); }
});

app.post('/api/auth/sessions/:id/revoke', auth.requireAuth, async (req, res) => {
  try {
    // Find full session ID by prefix (เพราะ frontend เห็นแค่ 8 ตัวแรก)
    const prefix = req.params.id.replace('...', '');
    const { rows } = await pool.query(
      'SELECT id FROM sessions WHERE user_id = $1 AND id LIKE $2',
      [req.user.id, prefix + '%']
    );
    if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
    await auth.revokeSession(rows[0].id, req.user);
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/auth/sessions/:id/revoke'); }
});

// ============================================================
// API: User Management (admin only)
// ============================================================

app.get('/api/users', auth.requireAdminOrAuditor, async (req, res) => {
  try {
    const users = await auth.listUsers();
    res.json(users);
  } catch (e) { routeError(res, e, 'GET /api/users'); }
});

app.post('/api/users', auth.requireAdmin, async (req, res) => {
  try {
    const user = await auth.createUser(req.body, req.user);
    res.json(user);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/users/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user = await auth.updateUser(id, req.body, req.user);
    res.json(user);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/users/:id/reset-password', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { newPassword } = req.body;
    await auth.resetPassword(id, newPassword, req.user);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/users/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await auth.deleteUser(id, req.user);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Audit log (admin only)
app.get('/api/audit-log', auth.requireAdminOrAuditor, async (req, res) => {
  try {
    const { limit = 200, userId, action, targetCameraId } = req.query;
    const logs = await auth.getAuditLog({
      limit: parseInt(limit),
      userId: userId ? parseInt(userId) : null,
      action: action || null,
      targetCameraId: targetCameraId || null,
    });
    res.json(logs);
  } catch (e) { routeError(res, e, 'GET /api/audit-log'); }
});

// CSP violation reporter — public, no auth (browsers POST before auth cookie is checked).
// Parses application/csp-report body; rate-limited to 20 req/min per IP to prevent log-flood.
const _cspRateMap = new Map();
app.post('/api/csp-report',
  express.json({ type: ['application/json', 'application/csp-report'], limit: '4kb' }),
  (req, res) => {
    const ip = getIP(req);
    const now = Date.now();
    const [cnt, win] = _cspRateMap.get(ip) || [0, now];
    const newCnt = now - win > 60_000 ? 1 : cnt + 1;
    _cspRateMap.set(ip, [newCnt, now - win > 60_000 ? now : win]);
    if (newCnt > 20) return res.sendStatus(429);
    const r = (req.body || {})['csp-report'] || req.body || {};
    const dir = r['violated-directive'] || r['effective-directive'] || '?';
    const blocked = r['blocked-uri'] || '?';
    const src = r['source-file'] ? `${r['source-file']}:${r['line-number'] || 0}` : '?';
    console.warn(`[CSP-REPORT] directive=${dir} blocked=${blocked} source=${src}`);
    res.sendStatus(204);
  }
);

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

// ── License API endpoints ────────────────────────────────────
// GET /api/license/machine-id — lightweight, just the fingerprint.
// Used by the UI to display the ID even before activation.
app.get('/api/license/machine-id', async (req, res) => {
  res.json({ machine_id: license.getMachineFingerprint() });
});

// GET /api/license/status — full state, plus license payload if active.
// The UI calls this on Settings → 🔐 License open + every 30s while open.
app.get('/api/license/status', async (req, res) => {
  try {
    const state = await getCurrentLicenseState();
    const out = { mode: state.mode, machine_id: state.machine_id };
    if (state.payload) {
      out.license_info = {
        customer:     state.payload.customer    || null,
        customer_id:  state.payload.customer_id || null,
        tier:         state.payload.tier        || null,
        max_cameras:  state.payload.max_cameras || null,
        features:     state.payload.features    || [],
        issued_at:    state.payload.iat ? new Date(state.payload.iat * 1000).toISOString() : null,
        expires_at:   state.payload.exp ? new Date(state.payload.exp * 1000).toISOString() : null,
        days_left:    state.days_left ?? null,
      };
    }
    if (state.mode === 'TRIAL') {
      out.trial = { started_at: state.trial_started_at, days_left: state.trial_days_left };
    }
    if (state.mode === 'GRACE') {
      out.grace = { days_over: state.days_over, grace_left: state.grace_left };
    }
    if (state.mode === 'EXPIRED') {
      out.expired = { days_over: state.days_over };
    }
    if (state.mode === 'INVALID') {
      out.invalid = { reason: state.reason };
      if (state.current_machine_id) out.invalid.current_machine_id = state.current_machine_id;
    }
    res.json(out);
  } catch (e) { routeError(res, e, 'GET /api/license/status'); }
});

// POST /api/license/activate — { key } → verify + save.
// Returns the new state on success. Same enforcement on failure (the
// stale stored key is left untouched on a bad input).
app.post('/api/license/activate', async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'license key required' });
    const result = await license.verifyLicense(key);
    if (!result.valid) {
      return res.status(400).json({
        error: 'invalid_license',
        reason: result.error,
        current_machine_id: result.current_machine_id || license.getMachineFingerprint(),
      });
    }
    await license.saveLicenseKey(pool, key);
    invalidateLicenseStateCache();
    const state = await getCurrentLicenseState();
    res.json({ success: true, mode: state.mode, payload: state.payload });
  } catch (e) { routeError(res, e, 'POST /api/license/activate'); }
});

// ── EULA endpoints (Phase 8.1) ───────────────────────────────
// EULA files per language. Cached in memory after first read.
// Served as text/markdown; the frontend renders it.
// GET /api/eula?lang=en → EULA-en.md (fallback to th if missing)
// GET /api/eula         → EULA-th.md (default)
const EULA_PATHS = {
  th: path.join(__dirname, '..', 'docs', 'EULA-th.md'),
  en: path.join(__dirname, '..', 'docs', 'EULA-en.md'),
};
const _eulaCache = {};
function getEulaContent(lang = 'th') {
  const key = EULA_PATHS[lang] ? lang : 'th';
  if (_eulaCache[key] != null) return _eulaCache[key];
  try { _eulaCache[key] = fs.readFileSync(EULA_PATHS[key], 'utf8'); }
  catch {
    _eulaCache[key] = key === 'en'
      ? '# EULA not found\n\nPlease contact support.'
      : '# EULA ไม่พบ\n\nกรุณาติดต่อทีมงาน';
  }
  return _eulaCache[key];
}
// Public — login page + disclaimer page may want to link to it.
app.get('/api/eula', (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'th';
  res.type('text/markdown; charset=utf-8').send(getEulaContent(lang));
});

// Whether the operator has accepted the EULA on this deployment. Public
// so the frontend can decide whether to show the acceptance modal even
// before the first admin logs in (the modal fires on login, not on
// page open).
app.get('/api/eula/status', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT key, value FROM system_settings
        WHERE key IN ('eula_accepted_at', 'eula_accepted_by')`);
    const s = {};
    r.rows.forEach(row => { s[row.key] = row.value || ''; });
    res.json({
      accepted:     !!s.eula_accepted_at,
      accepted_at:  s.eula_accepted_at || null,
      accepted_by:  s.eula_accepted_by || null,
    });
  } catch (e) { routeError(res, e, 'GET /api/eula/status'); }
});

// Record acceptance. Admin-only — EULA acceptance binds the legal
// entity that runs the deployment, viewers can't sign on their behalf.
app.post('/api/eula/accept', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required to accept EULA' });
    }
    await pool.query(`UPDATE system_settings SET value=$1 WHERE key='eula_accepted_at'`,
                     [new Date().toISOString()]);
    await pool.query(`UPDATE system_settings SET value=$1 WHERE key='eula_accepted_by'`,
                     [req.user.username || '']);
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/eula/accept'); }
});

// POST /api/license/deactivate — clear the stored key. Admin only.
// Useful for testing + transferring license to another machine (the
// operator runs deactivate on the old machine before issuing a new key
// for the new machine_id).
app.post('/api/license/deactivate', async (req, res) => {
  try {
    await license.saveLicenseKey(pool, '');
    invalidateLicenseStateCache();
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/license/deactivate'); }
});

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
    console.log('🎬 ws-bridge: LISTEN clip_done + new_event → WebSocket broadcast');
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

// GET /api/stats/occupancy — snapshot of current "People in Area" per
// camera/rule. Smoothed `current` is what the UI should display; `raw` is
// the latest unsmoothed sample for diagnostics.
app.get('/api/stats/occupancy', (req, res) => {
  const cams = [];
  const now = Date.now();
  for (const [cameraId, perCam] of _occupancy.entries()) {
    for (const [ruleName, entry] of perCam.entries()) {
      cams.push({
        camera_id: cameraId,
        rule_name: ruleName,
        current: entry.smoothed,
        raw: entry.raw,
        samples: entry.samples.length,
        last_update: entry.lastUpdate ? new Date(entry.lastUpdate).toISOString() : null,
        stale_sec: entry.lastUpdate ? Math.floor((now - entry.lastUpdate) / 1000) : null,
      });
    }
  }
  res.json({ cameras: cams, smoothing_window_ms: OCC_SMOOTH_WINDOW_MS });
});

// GET /api/stats/occupancy/sources?from=ISO&to=ISO
// Distinct (camera_id, rule_name) pairs that have CountAggregation/Counter
// samples in the range — used by the Density charts' camera+rule dropdown.
// Was previously sourced from the in-memory _occupancy tracker, but that
// Map is emptied on every api-server restart and only repopulates when new
// events arrive, so the dropdown looked empty even when DB had thousands of
// historical samples. DB is the source of truth here.
app.get('/api/stats/occupancy/sources', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    if (to.getTime() <= from.getTime()) return res.status(400).json({ error: 'to must be after from' });
    const { rows } = await pool.query(`
      SELECT camera_id,
             (raw_json->'Source'->>'Rule') AS rule_name,
             COUNT(*)::int                 AS samples,
             MAX(event_time)::text         AS last_seen
        FROM events
       WHERE event_type = 'CountAggregation/Counter'
         AND event_time >= $1::timestamptz
         AND event_time <  $2::timestamptz
         AND (raw_json->'Source'->>'Rule') IS NOT NULL
       GROUP BY camera_id, (raw_json->'Source'->>'Rule')
       ORDER BY samples DESC`, [from.toISOString(), to.toISOString()]);
    res.json({ sources: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/sources'); }
});

// GET /api/stats/occupancy/timeline?from=ISO&to=ISO[&camera_id=X][&rule_name=Y]
// Historical density: aggregates CountAggregation/Counter samples into time
// buckets (auto-picked from range length) and returns avg + max per bucket.
// Driven by the raw events already stored — no schema change.
//   - avg = "typical density during that period" (smoothed)
//   - max = "peak density during that period" (worst-case)
//   - samples = how many Bosch fires landed in the bucket (data quality)
// Buckets are aligned to the display_timezone so a Thai user sees their
// own calendar hours, matching the existing Activity Heatmap card.
app.get('/api/stats/occupancy/timeline', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    if (to.getTime() <= from.getTime()) return res.status(400).json({ error: 'to must be after from' });

    const rangeMs = to.getTime() - from.getTime();
    let bucketSec;
    if      (rangeMs <=   4 * 3600 * 1000) bucketSec = 60;     // ≤4h  → 1m
    else if (rangeMs <=  24 * 3600 * 1000) bucketSec = 300;    // ≤24h → 5m
    else if (rangeMs <=   7 * 86400 * 1000) bucketSec = 3600;  // ≤7d  → 1h
    else                                    bucketSec = 86400; // >7d  → 1d

    const cameraId = req.query.camera_id || null;
    const ruleName = req.query.rule_name || null;

    const params = [from.toISOString(), to.toISOString(), `${bucketSec} seconds`];
    let where = `event_type = 'CountAggregation/Counter'
                 AND event_time >= $1::timestamptz
                 AND event_time <  $2::timestamptz`;
    if (cameraId) { params.push(cameraId); where += ` AND camera_id = $${params.length}`; }
    if (ruleName) { params.push(ruleName); where += ` AND raw_json->'Source'->>'Rule' = $${params.length}`; }

    // date_bin (PG14+) buckets timestamps to fixed-width intervals. Anchored
    // at the unix epoch in UTC so buckets align with wall-clock minutes/hours.
    const sql = `
      SELECT date_bin($3::interval, event_time, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket,
             AVG((raw_json->'Data'->>'Count')::int)::numeric(10,2) AS avg_count,
             MAX((raw_json->'Data'->>'Count')::int)                AS max_count,
             COUNT(*)::int                                          AS samples
        FROM events
       WHERE ${where}
       GROUP BY 1
       ORDER BY 1`;
    const { rows } = await pool.query(sql, params);

    res.json({
      from: from.toISOString(),
      to:   to.toISOString(),
      bucket_sec: bucketSec,
      camera_id: cameraId,
      rule_name: ruleName,
      buckets: rows.map(r => ({
        ts: new Date(r.bucket).toISOString(),
        avg: parseFloat(r.avg_count) || 0,
        max: r.max_count,
        samples: r.samples,
      })),
    });
  } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/timeline'); }
});

// GET /api/stats/occupancy/heatmap?from=ISO&to=ISO[&camera_id=X][&rule_name=Y]
// Phase 2 of density viz: 7×24 grid of avg + peak occupancy by
// (day-of-week × hour), aligned to display_timezone. Uses the same source
// rows as /api/stats/occupancy/timeline (CountAggregation/Counter) but
// groups by dow+hour so you can spot weekly patterns ("Mondays at 10am
// are always busy"). dow uses ISO ordering (0=Mon..6=Sun).
app.get('/api/stats/occupancy/heatmap', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    if (to.getTime() <= from.getTime()) return res.status(400).json({ error: 'to must be after from' });
    const cameraId = req.query.camera_id || null;
    const ruleName = req.query.rule_name || null;
    const tz       = await getDisplayTz();

    const params = [from.toISOString(), to.toISOString(), tz];
    let where = `event_type = 'CountAggregation/Counter'
                 AND event_time >= $1::timestamptz
                 AND event_time <  $2::timestamptz`;
    if (cameraId) { params.push(cameraId); where += ` AND camera_id = $${params.length}`; }
    if (ruleName) { params.push(ruleName); where += ` AND raw_json->'Source'->>'Rule' = $${params.length}`; }

    const { rows } = await pool.query(`
      SELECT (EXTRACT(isodow FROM event_time AT TIME ZONE $3)::int - 1) AS dow,
              EXTRACT(hour   FROM event_time AT TIME ZONE $3)::int      AS hour,
              AVG((raw_json->'Data'->>'Count')::int)::numeric(10,2)     AS avg_count,
              MAX((raw_json->'Data'->>'Count')::int)                    AS max_count,
              COUNT(*)::int                                              AS samples
        FROM events
       WHERE ${where}
       GROUP BY dow, hour
       ORDER BY dow, hour`, params);

    res.json({
      from: from.toISOString(),
      to:   to.toISOString(),
      tz,
      camera_id: cameraId,
      rule_name: ruleName,
      cells: rows.map(r => ({
        dow:  r.dow,
        hour: r.hour,
        avg:  parseFloat(r.avg_count) || 0,
        max:  r.max_count,
        samples: r.samples,
      })),
    });
  } catch (err) { routeError(res, err, 'GET /api/stats/occupancy/heatmap'); }
});

// ============================================================
// API: Cameras
// ============================================================

const { OFFLINE_THRESHOLD_SEC } = require('./constants');

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

// API: Frontend Config (expose safe env vars)
app.get('/api/config', async (req, res) => {
  const mapboxToken = await getMapboxToken();
  // SEC-017: never send the raw token to the client — proxy handles it server-side.
  res.json({ mapboxAvailable: !!mapboxToken });
});

app.get('/api/cameras', async (req, res) => {
  try {
    let dbCameras = {};
    try {
      // Alias canonical schema columns back to legacy shape consumed by
      // the dashboard and merge logic below (camera_id / camera_name /
      // last_seen / location / status).
      const dbResult = await pool.query(`
        SELECT id   AS camera_id,
               name AS camera_name,
               ip_address,
               location_label AS location,
               last_seen_at   AS last_seen,
               paused,
               CASE WHEN paused THEN 'paused' WHEN enabled THEN 'online' ELSE 'offline' END AS status,
               sd_status, recording_data_from, recording_data_until,
               recording_count, sd_last_check_at,
               enable_snapshot, enable_vca_overlay, enable_clip_capture,
               clip_pre_sec, clip_post_sec,
               overlay_show_bbox, overlay_show_zone
          FROM cameras
         ORDER BY last_seen_at DESC NULLS LAST
      `);
      dbResult.rows.forEach(c => { dbCameras[c.camera_id] = c; });
    } catch (e) { /* ignore */ }

    const now = Date.now();
    const config = loadCameraConfig();
    const merged = (config.cameras || []).map(c => {
      const db = dbCameras[c.camera_id] || {};

      // 🆕 Heartbeat-based status: paused beats online/offline
      let status = 'offline';
      if (db.paused) {
        status = 'paused';
      } else if (db.last_seen) {
        const ageSec = (now - new Date(db.last_seen).getTime()) / 1000;
        if (ageSec < OFFLINE_THRESHOLD_SEC) status = 'online';
      }

      // recording flag derived from ONVIF GetRecordingSummary.DataUntil:
      // when SD recording is actively writing, DataUntil tracks real time
      // within seconds. When stopped, it freezes. ~90s threshold gives
      // some leeway for clock skew between camera and host.
      const dataUntilMs = db.recording_data_until ? new Date(db.recording_data_until).getTime() : 0;
      const recording = dataUntilMs > 0 && (now - dataUntilMs) < 90 * 1000;

      return {
        ...c,
        status,
        last_seen: db.last_seen || null,
        recording,
        sd_status: db.sd_status || null,
        recording_data_until: db.recording_data_until || null,
        recording_count: db.recording_count ?? null,
        sd_last_check_at: db.sd_last_check_at || null,
        // Phase 6.1 — per-camera media capture toggles
        enable_snapshot:     db.enable_snapshot ?? true,
        enable_vca_overlay:  db.enable_vca_overlay ?? true,
        enable_clip_capture: db.enable_clip_capture ?? false,
        clip_pre_sec:        db.clip_pre_sec ?? 10,
        clip_post_sec:       db.clip_post_sec ?? 5,
        // Migration 043 — client-side overlay display toggles
        overlay_show_bbox:   db.overlay_show_bbox ?? true,
        overlay_show_zone:   db.overlay_show_zone ?? true,
      };
    });

    // SEC-003: admin gets plaintext to prefill the camera-edit form;
    // viewer/auditor have no UI that needs RTSP/MQTT credentials
    const safe = req.user?.role === 'admin' ? merged : merged.map(_redactCameraResponse);
    res.json(safe);
  } catch (err) { routeError(res, err, 'GET /api/cameras'); }
});

// camera_id sanitiser — strips invisible characters that destroy MQTT
// topic matching. Most common offender: Thai phinthu U+0E3A that sneaks
// in from a Thai keyboard layout when typing Latin-looking IDs (we got
// bit by exactly this 2026-05-19 on the BOSCH_8000i_01 entry). Also
// handles zero-width spaces, BOM, control chars, and Thai tone marks
// that have no business being in an ASCII-shaped id.
function _sanitizeCameraId(raw) {
  const original = String(raw || '').trim();
  const cleaned = original.replace(
    /[\x00-\x1f\x7f\u200b-\u200f\ufeff\u0e3a\u0e48-\u0e4e]/g, ''
  );
  return { cleaned, hadDirt: cleaned !== original };
}

function _redactCameraAudit(cam) {
  if (!cam || typeof cam !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(cam)) {
    // mqtt_password also redacted — mqtt_provisioned audit event carries the
    // "new password generated" signal separately, so no audit signal is lost.
    out[key] = ['username', 'password', 'mqtt_password'].includes(key) && value ? '***' : value;
  }
  return out;
}

// Redact for GET /api/cameras response sent to non-admin roles.
// mqtt_password is also redacted (plain-text secret); mqtt_username is left
// visible since it's deterministic (cam-<id>) and not a secret.
function _redactCameraResponse(cam) {
  if (!cam || typeof cam !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(cam)) {
    out[key] = ['username', 'password', 'mqtt_password'].includes(key) && value ? '***' : value;
  }
  return out;
}

// ── EMQX auto-provision (SEC-001 Phase 2 — called on Bosch camera save) ──
const EMQX_API_BASE = 'http://localhost:18083/api/v5';
const EMQX_AUTHN_ID = 'password_based%3Abuilt_in_database';

async function _emqxProvisionCamera(cam) {
  // หมายเหตุ: api-server โหลด env จาก src/.env (PM2 cwd=src) — key นี้ต้องอยู่
  // ที่นั่น ไม่ใช่แค่ root .env ของ docker-compose (incident 2026-06-11:
  // ย้ายมา PM2 แล้ว key หล่น → provision คืน null → UI ค้าง "กำลัง provision")
  const dashPass = process.env.EMQX_DASHBOARD_PASSWORD;
  if (!dashPass) {
    console.warn('[emqx-provision] EMQX_DASHBOARD_PASSWORD not set in src/.env — cannot provision');
    return null;
  }

  // Login to EMQX dashboard API
  const loginRes = await fetch(`${EMQX_API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: dashPass }),
  });
  if (!loginRes.ok) throw new Error(`EMQX login failed: HTTP ${loginRes.status}`);
  const { token } = await loginRes.json();

  const mqttUser = 'cam-' + cam.camera_id.toLowerCase().replace(/_/g, '-');
  // Reuse existing password (idempotent); generate new only for first-time provision
  const isNew = !cam.mqtt_password;
  const mqttPass = cam.mqtt_password || require('crypto').randomBytes(18).toString('base64url');

  const createRes = await fetch(`${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: mqttUser, password: mqttPass, is_superuser: false }),
  });

  if (createRes.status === 409) {
    // User exists — update password only if reusing (keeps EMQX in sync)
    const updRes = await fetch(
      `${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users/${encodeURIComponent(mqttUser)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: mqttPass, is_superuser: false }),
      }
    );
    if (!updRes.ok) throw new Error(`EMQX update user failed: HTTP ${updRes.status}`);
  } else if (!createRes.ok) {
    throw new Error(`EMQX create user failed: HTTP ${createRes.status}`);
  }

  return { mqtt_username: mqttUser, mqtt_password: mqttPass, generated_new: isNew };
}

function _diffAuditObjects(before, after) {
  const a = before || {};
  const b = after || {};
  const changed = {};
  for (const key of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      changed[key] = { before: a[key] ?? null, after: b[key] ?? null };
    }
  }
  return changed;
}

function _cameraGroupIds(groups, cameraId) {
  return (groups?.groups || [])
    .filter(g => (g.cameraIds || []).includes(cameraId))
    .map(g => g.id);
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

app.post('/api/cameras', async (req, res) => {
  try {
    if (!req.body || !req.body.camera_id) return res.status(400).json({ error: 'camera_id is required' });

    const config = loadCameraConfig();
    if (!config.cameras) config.cameras = [];

    // Sanitise camera_id BEFORE anything else writes/looks it up. Three
    // classes of trouble we warn on (decision 2026-05-19, after the
    // BOSCH_8000i Thai-phinthu incident):
    //   1. Invisible/control characters in the id (auto-fixed; operator
    //      should re-type to avoid keyboard-layout repeats).
    //   2. Non-ASCII in the id — legitimate Thai camera_id is allowed,
    //      but operators commonly hit this by accident; flag for review.
    //   3. Same IP already used by a DIFFERENT camera_id — usually means
    //      hardware replacement; the operator should reuse the existing
    //      id, not create a parallel entry that fragments stats/alerts.
    // Operator overrides by re-sending with ?force=1 (frontend turns the
    // "ดำเนินการต่อ" confirm button into that query param).
    const { cleaned: cleanedId, hadDirt } = _sanitizeCameraId(req.body.camera_id);
    if (!cleanedId) return res.status(400).json({ error: 'camera_id is empty after stripping invisible characters' });

    const warnings = [];
    if (hadDirt) {
      warnings.push({
        code: 'invisible_chars_stripped',
        message_th: `camera_id เดิมมีอักขระมองไม่เห็น — แก้เป็น "${cleanedId}" แล้ว (ตรวจ keyboard layout ตอนพิมพ์ — Thai keyboard ค้างมัก typo อักขระเสริมเข้ามา)`,
      });
    }
    if (/[^\x20-\x7e]/.test(cleanedId)) {
      warnings.push({
        code: 'non_ascii_id',
        message_th: `camera_id "${cleanedId}" มีอักขระไม่ใช่ ASCII — ตรวจสอบให้แน่ใจว่าตั้ง MQTT topic prefix ที่ Bosch CM ให้ตรงกันเป๊ะ ๆ`,
      });
    }
    const ip = String(req.body.ip_address || '').trim();
    if (ip) {
      const ipDup = config.cameras.find(c => c.camera_id !== cleanedId && c.ip_address === ip);
      if (ipDup) {
        warnings.push({
          code: 'duplicate_ip',
          message_th: `IP ${ip} ใช้อยู่กับกล้อง "${ipDup.camera_id}" แล้ว — ถ้าเปลี่ยน hardware ตัวเดียวกัน แนะนำใช้ camera_id เดิม "${ipDup.camera_id}" เพื่อรักษา historical events + alert rules + stats`,
          existing_camera_id: ipDup.camera_id,
        });
      }
    }
    // Soft-block on warnings unless the operator passed ?force=1.
    if (warnings.length > 0 && req.query.force !== '1') {
      return res.status(409).json({ warnings, suggested_camera_id: cleanedId });
    }
    // Body looks clean — replace camera_id with the sanitised version so
    // the downstream INSERT/UPDATE uses the canonical form.
    req.body.camera_id = cleanedId;

    // Phase 8.0 — camera-count enforcement against the active license's
    // tier limit. Only enforced when the public key is configured AND we
    // hold a LICENSED state (trial/no-license deployments get unlimited
    // headroom by design — once the operator activates a real license,
    // the cap kicks in). Edits to existing cameras (same id) always pass
    // regardless of count.
    if (license.isPublicKeyConfigured()) {
      const state = await getCurrentLicenseState();
      if (state.mode === 'LICENSED' && state.payload && state.payload.max_cameras) {
        const newId = String(req.body.camera_id).trim();
        const isUpdate = config.cameras.some(c => c.camera_id === newId);
        if (!isUpdate && config.cameras.length >= state.payload.max_cameras) {
          return res.status(403).json({
            error: 'license_camera_limit',
            message_th: `License ปัจจุบัน (${state.payload.tier}) รองรับสูงสุด ${state.payload.max_cameras} กล้อง — ติดต่อทีมงานเพื่ออัพเกรด`,
            max_cameras: state.payload.max_cameras,
            current_count: config.cameras.length,
            tier: state.payload.tier,
          });
        }
      }
    }

    // Existing entry (if this is an edit) — used to preserve optional
    // fields the form may not re-send (http_port / stream selectors).
    const prevIdx = config.cameras.findIndex(c => c.camera_id === cleanedId);
    const prev = prevIdx >= 0 ? (config.cameras[prevIdx] || {}) : {};
    const prevAudit = _redactCameraAudit(prev);

    const VALID_VENDORS = ['bosch', 'hikvision', 'dahua', 'onvif'];
    const vendorRaw = String(req.body.vendor || prev.vendor || 'bosch').toLowerCase();
    const newCam = {
      camera_id: String(req.body.camera_id).trim(),
      camera_name: String(req.body.camera_name || req.body.camera_id).trim(),
      vendor: VALID_VENDORS.includes(vendorRaw) ? vendorRaw : 'bosch',
      ip_address: String(req.body.ip_address || '').trim(),
      username: String(req.body.username || '').trim(),
      password: String(req.body.password || ''),
      latitude: req.body.latitude ? parseFloat(req.body.latitude) : null,
      longitude: req.body.longitude ? parseFloat(req.body.longitude) : null,
      location: String(req.body.location || '').trim(),
      notes: String(req.body.notes || '').trim(),
    };
    // Optional fields — body value wins, else preserve the existing entry's.
    // Omitted entirely (not null) when unset so the JSON stays tidy.
    const httpPort  = parseInt(req.body.http_port, 10)       || prev.http_port;
    const clipStr   = parseInt(req.body.clip_stream, 10)     || prev.clip_stream;
    const snapStr   = parseInt(req.body.snapshot_stream, 10) || prev.snapshot_stream;
    if (httpPort) newCam.http_port      = httpPort;
    if (clipStr)  newCam.clip_stream     = clipStr;
    if (snapStr)  newCam.snapshot_stream = snapStr;
    // snapshot_path — HTTP still-image path for the generic-HTTP vendors
    // (Dahua CGI, generic ONVIF). The form always sends the field, so body
    // value wins (lets the operator clear it); else preserve the entry's.
    const snapPath = req.body.snapshot_path !== undefined
      ? String(req.body.snapshot_path).trim()
      : String(prev.snapshot_path || '').trim();
    if (snapPath) newCam.snapshot_path = snapPath;
    // full_view_width — Phase 2 per-camera cap (px) for the "view full"
    // button. Empty / out-of-set = no cap (serve the native original).
    // The form always sends the field, so body wins (lets the operator
    // clear it back to native).
    const fullW = req.body.full_view_width !== undefined
      ? (FULL_VIEW_WIDTHS.has(parseInt(req.body.full_view_width, 10))
          ? parseInt(req.body.full_view_width, 10) : null)
      : (prev.full_view_width || null);
    if (fullW) newCam.full_view_width = fullW;
    // Preserve MQTT credentials across edits — these are set by auto-provision
    // and must not be erased when the operator edits other camera fields.
    if (prev.mqtt_username) newCam.mqtt_username = prev.mqtt_username;
    if (prev.mqtt_password) newCam.mqtt_password = prev.mqtt_password;

    const idx = prevIdx;
    if (idx >= 0) config.cameras[idx] = newCam;
    else config.cameras.push(newCam);

    if (!saveCameraConfig(config)) throw new Error('Failed to save config');

    // Auto-provision EMQX MQTT credentials for Bosch cameras (sync, 5s timeout)
    let mqttCreds = null;
    let mqttStatus = 'skipped';
    if ((newCam.vendor || 'bosch').toLowerCase() === 'bosch') {
      try {
        const provPromise = _emqxProvisionCamera(newCam);
        const timeoutPromise = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('EMQX provision timeout')), 5000)
        );
        mqttCreds = await Promise.race([provPromise, timeoutPromise]);
        // null = EMQX_DASHBOARD_PASSWORD ไม่ถูกตั้ง — อย่าปล่อยไปตาย
        // ที่ null.mqtt_username ข้างล่าง (error เดิมหลอกทางหาสาเหตุ)
        if (!mqttCreds) throw new Error('EMQX_DASHBOARD_PASSWORD not set in src/.env');
        mqttStatus = 'provisioned';
        // Re-read config from disk (guards against concurrent writes) and
        // merge in the new credentials before writing back.
        const fresh = loadCameraConfig();
        const fi = fresh.cameras.findIndex(c => c.camera_id === newCam.camera_id);
        if (fi >= 0) {
          fresh.cameras[fi].mqtt_username = mqttCreds.mqtt_username;
          fresh.cameras[fi].mqtt_password = mqttCreds.mqtt_password;
          saveCameraConfig(fresh);
        }
        newCam.mqtt_username = mqttCreds.mqtt_username;
        newCam.mqtt_password = mqttCreds.mqtt_password;
      } catch (err) {
        console.warn('[emqx-provision]', newCam.camera_id, err.message);
        mqttStatus = 'pending'; // camera saved; EMQX provision deferred
      }
    }

    // Phase 6.1 — media capture toggles (DB-only, not in JSON config)
    let previousToggles = {};
    try {
      const tr = await pool.query(
        `SELECT enable_snapshot, enable_vca_overlay, enable_clip_capture, clip_pre_sec, clip_post_sec,
                overlay_show_bbox, overlay_show_zone
           FROM cameras WHERE id=$1`,
        [newCam.camera_id]
      );
      previousToggles = tr.rows[0] || {};
    } catch {}
    const toggles = {
      enable_snapshot:     req.body.enable_snapshot     === undefined ? true  : !!req.body.enable_snapshot,
      enable_vca_overlay:  req.body.enable_vca_overlay  === undefined ? true  : !!req.body.enable_vca_overlay,
      enable_clip_capture: req.body.enable_clip_capture === undefined ? false : !!req.body.enable_clip_capture,
      clip_pre_sec:        Math.max(1, Math.min(60, parseInt(req.body.clip_pre_sec,  10) || 10)),
      clip_post_sec:       Math.max(0, Math.min(30, parseInt(req.body.clip_post_sec, 10) ||  5)),
      // Migration 043 — client-side overlay display toggles
      overlay_show_bbox:   req.body.overlay_show_bbox   === undefined ? true  : !!req.body.overlay_show_bbox,
      overlay_show_zone:   req.body.overlay_show_zone   === undefined ? true  : !!req.body.overlay_show_zone,
    };

    try {
      const updateResult = await pool.query(
        `UPDATE cameras SET
           name=$2, ip_address=$3, location_label=$4,
           enable_snapshot=$5, enable_vca_overlay=$6,
           enable_clip_capture=$7, clip_pre_sec=$8, clip_post_sec=$9,
           overlay_show_bbox=$10, overlay_show_zone=$11
         WHERE id=$1`,
        [newCam.camera_id, newCam.camera_name, newCam.ip_address, newCam.location,
         toggles.enable_snapshot, toggles.enable_vca_overlay,
         toggles.enable_clip_capture, toggles.clip_pre_sec, toggles.clip_post_sec,
         toggles.overlay_show_bbox, toggles.overlay_show_zone]
      );
      if (updateResult.rowCount === 0) {
        await pool.query(
          `INSERT INTO cameras (id, name, ip_address, location_label, enabled,
                                 enable_snapshot, enable_vca_overlay,
                                 enable_clip_capture, clip_pre_sec, clip_post_sec,
                                 overlay_show_bbox, overlay_show_zone)
           VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10,$11)`,
          [newCam.camera_id, newCam.camera_name, newCam.ip_address, newCam.location,
           toggles.enable_snapshot, toggles.enable_vca_overlay,
           toggles.enable_clip_capture, toggles.clip_pre_sec, toggles.clip_post_sec,
           toggles.overlay_show_bbox, toggles.overlay_show_zone]
        );
      }
    } catch (dbErr) { console.warn('DB sync warn:', dbErr.message); }

    const action = prevIdx >= 0 ? 'camera_update' : 'camera_create';
    const before = prevIdx >= 0 ? { ...prevAudit, ...previousToggles } : null;
    const after = { ..._redactCameraAudit(newCam), ...toggles };
    await _logCameraAudit(req, action, newCam.camera_id, {
      camera_id: newCam.camera_id,
      changed_fields: before ? _diffAuditObjects(before, after) : after,
    });

    // Separate audit event for MQTT provision (security trail — compensates for
    // the trust boundary change: provisioning now possible from UI, not just SSH)
    if (mqttCreds) {
      await _logCameraAudit(req, 'mqtt_provisioned', newCam.camera_id, {
        mqtt_username: mqttCreds.mqtt_username,
        generated_new_password: mqttCreds.generated_new,
      });
    }

    res.json({
      success: true,
      camera: newCam,
      mqtt_status: mqttStatus,
      mqtt_broker_host: process.env.MQTT_CAMERA_BROKER_HOST || null,
    });
  } catch (err) { routeError(res, err, 'POST /api/cameras'); }
});

// POST /api/cameras/:id/mqtt/regenerate — force-rotate the MQTT password for
// a Bosch camera. Returns the new cleartext password as a one-time reveal so
// the operator can enter it in the camera's own web UI to reconnect.
// NOTE: intentionally NOT passed through _redactCameraResponse — the
// cleartext is the whole point; admin-only, one-time reveal on success.
app.post('/api/cameras/:id/mqtt/regenerate', auth.requireAdmin, async (req, res) => {
  try {
    const rawId = req.params.id;
    if (!/^[a-z0-9-]+$/i.test(rawId)) return res.status(400).json({ error: 'Invalid camera_id format' });
    const cameraId = rawId.toLowerCase();

    const config = loadCameraConfig();
    const idx = config.cameras.findIndex(c => c.camera_id === cameraId);
    if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
    const cam = config.cameras[idx];
    if ((cam.vendor || 'bosch').toLowerCase() !== 'bosch') {
      return res.status(400).json({ error: 'MQTT regenerate is only available for Bosch cameras' });
    }

    // Force-generate new password by stripping the existing one before provisioning
    const camForRegen = { ...cam, mqtt_password: undefined };
    const creds = await _emqxProvisionCamera(camForRegen);
    if (!creds) return res.status(503).json({ error: 'EMQX_DASHBOARD_PASSWORD not configured — cannot regenerate' });

    // Atomic write — re-read to guard against concurrent edits
    const fresh = loadCameraConfig();
    const fi = fresh.cameras.findIndex(c => c.camera_id === cameraId);
    if (fi >= 0) {
      fresh.cameras[fi].mqtt_username = creds.mqtt_username;
      fresh.cameras[fi].mqtt_password = creds.mqtt_password;
      if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');
    }

    await _logCameraAudit(req, 'mqtt_regenerated', cameraId, {
      mqtt_username: creds.mqtt_username,
    });

    res.json({ success: true, mqtt_username: creds.mqtt_username, mqtt_password: creds.mqtt_password });
  } catch (err) {
    console.error('[mqtt-regenerate]', err);
    res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
  }
});

// ── Snapshot-path auto-detect (Phase MV.4b) ──────────────────
// Dahua / generic-ONVIF cameras have no single universal snapshot URL.
// Rather than make the operator hunt for it, probe a list of known
// candidate paths and return the first that answers with a JPEG. The
// camera-settings "🔍 ตรวจหาอัตโนมัติ" button calls this; on a miss the
// operator types the path manually. Digest AND Basic auth are handled.
const SNAPSHOT_CANDIDATES = {
  dahua: [
    '/cgi-bin/snapshot.cgi?channel=1',
    '/cgi-bin/snapshot.cgi?channel=0',
    '/cgi-bin/snapshot.cgi',
    '/cgi-bin/snapshot.cgi?1',
    '/onvif/snapshot',
  ],
  onvif: [
    '/onvif/snapshot',
    '/onvif-http/snapshot?Profile_1',
    '/snapshot.jpg',
    '/snap.jpg',
    '/image/jpeg.cgi',
    '/jpg/image.jpg',
    '/cgi-bin/snapshot.cgi?channel=1',
    '/axis-cgi/jpg/image.cgi',
    '/ISAPI/Streaming/channels/101/picture',
    '/tmpfs/auto.jpg',
  ],
};

// SEC-008: detect private/loopback ranges — used for audit logging only.
// Blocking is intentionally disabled: on-prem admin needs to probe LAN cameras.
// Enable the rejection line below if deploying as multi-tenant cloud SKU.
function _isPrivateIp(ip) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.|::1$|fc[0-9a-f]{2}:|fe80:)/i.test(ip) ||
         /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
}

// Fetch <uri> and resolve true only if it answers 200 with a JPEG
// (Content-Type image/* OR a body starting with the JPEG magic FF D8 —
// guards against cameras that 200 an HTML error page). Handles the
// Digest 401 two-step and a Basic fallback. ~5s timeout.
function _probeHttpImage(host, port, uri, user, pass) {
  return new Promise((resolve) => {
    const crypto = require('crypto');
    const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get({ host, port, path: uri, headers, timeout: 5000 }, (pr) => {
        if (pr.statusCode === 401 && !authHeader) {
          const wa = pr.headers['www-authenticate'] || '';
          pr.resume();
          if (/digest/i.test(wa)) {
            const ch = {};
            for (const m of wa.replace(/^Digest\s+/i, '')
                              .matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
              ch[m[1]] = m[2] !== undefined ? m[2] : m[3];
            }
            const cnonce = crypto.randomBytes(8).toString('hex'), nc = '00000001';
            const qop = ch.qop ? ch.qop.split(',')[0].trim() : null;
            const ha1 = md5(`${user}:${ch.realm}:${pass}`), ha2 = md5(`GET:${uri}`);
            const resp = qop
              ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
              : md5(`${ha1}:${ch.nonce}:${ha2}`);
            let h = `Digest username="${user}", realm="${ch.realm}", `
                  + `nonce="${ch.nonce}", uri="${uri}", response="${resp}"`;
            if (ch.opaque) h += `, opaque="${ch.opaque}"`;
            if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
            return attempt(h);
          }
          if (/basic/i.test(wa)) {
            return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          }
          return finish(false);
        }
        if (pr.statusCode !== 200) { pr.resume(); return finish(false); }
        const ct = String(pr.headers['content-type'] || '').toLowerCase();
        let head = Buffer.alloc(0);
        pr.on('data', (c) => {
          head = Buffer.concat([head, c]);
          if (head.length >= 2) {
            const isJpeg = head[0] === 0xFF && head[1] === 0xD8;
            pr.destroy();
            finish(ct.includes('image') || isJpeg);
          }
        });
        pr.on('end', () => finish(ct.includes('image')));
      });
      r.on('error', () => finish(false));
      r.on('timeout', () => { r.destroy(); finish(false); });
    };
    attempt(null);
  });
}

// POST /api/cameras/test-connection — TCP reachability + HTTP auth check.
// Returns { reachable, auth_status: 'ok'|'failed'|'unknown', latency_ms }.
// HTTP auth attempted only for Hikvision / Dahua (known HTTP camera API);
// Bosch / ONVIF report auth_status='unknown' (they use MQTT / other proto).
app.post('/api/cameras/test-connection', auth.requireAdmin, async (req, res) => {
  try {
    const { ip_address, http_port, vendor, username, password } = req.body || {};
    const ip = String(ip_address || '').trim();
    if (!ip) return res.status(400).json({ error: 'ip_address required' });
    if (_isPrivateIp(ip)) console.warn(`[SEC-008] test-connection targeting ${ip} by ${req.user?.username} (${getIP(req)})`);

    const port = parseInt(http_port, 10) || 80;
    const v = String(vendor || 'bosch').toLowerCase();
    const start = Date.now();

    const reachable = await new Promise(resolve => {
      const sock = new net.Socket();
      sock.setTimeout(3000);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => resolve(false));
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(port, ip);
    });
    const latency_ms = Date.now() - start;

    if (!reachable) return res.json({ reachable: false, auth_status: 'unknown', latency_ms });

    // HTTP auth test for vendors that expose an HTTP API
    let auth_status = 'unknown';
    if ((v === 'hikvision' || v === 'dahua') && username && password) {
      const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      auth_status = await new Promise(resolve => {
        const r = http.get({ host: ip, port, path: '/', headers: { Authorization: authHeader }, timeout: 4000 }, (pr) => {
          pr.resume();
          resolve(pr.statusCode === 401 ? 'failed' : 'ok');
        });
        r.on('error', () => resolve('unknown'));
        r.on('timeout', () => { r.destroy(); resolve('unknown'); });
      });
    }

    res.json({ reachable: true, auth_status, latency_ms });
  } catch (e) { routeError(res, e, 'POST /api/cameras/test-connection'); }
});

// Fetch a snapshot image as base64 with Digest/Basic auth fallback.
// Returns base64 string or null. Max body read 600 KB.
function _fetchImageBase64(host, port, uri, user, pass) {
  return new Promise(resolve => {
    const crypto = require('crypto');
    const md5 = s => crypto.createHash('md5').update(s).digest('hex');
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const MAX_BYTES = 600 * 1024;

    const attempt = authHeader => {
      const headers = authHeader ? { Authorization: authHeader } : {};
      const r = http.get({ host, port, path: uri, headers, timeout: 8000 }, pr => {
        if (pr.statusCode === 401 && !authHeader) {
          const wa = pr.headers['www-authenticate'] || '';
          pr.resume();
          if (/digest/i.test(wa)) {
            const ch = {};
            for (const m of wa.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g))
              ch[m[1]] = m[2] !== undefined ? m[2] : m[3];
            const cnonce = crypto.randomBytes(8).toString('hex'), nc = '00000001';
            const qop = ch.qop ? ch.qop.split(',')[0].trim() : null;
            const ha1 = md5(`${user}:${ch.realm}:${pass}`), ha2 = md5(`GET:${uri}`);
            const resp = qop ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${ch.nonce}:${ha2}`);
            let h = `Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${resp}"`;
            if (ch.opaque) h += `, opaque="${ch.opaque}"`;
            if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
            return attempt(h);
          }
          if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          return finish(null);
        }
        if (pr.statusCode !== 200) { pr.resume(); return finish(null); }
        const ct = String(pr.headers['content-type'] || '').toLowerCase();
        const chunks = [];
        let total = 0;
        pr.on('data', c => {
          total += c.length;
          if (total > MAX_BYTES) { pr.destroy(); return finish(null); }
          chunks.push(c);
        });
        pr.on('end', () => {
          const buf = Buffer.concat(chunks);
          const isJpeg = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8;
          finish((ct.includes('image') || isJpeg) ? buf.toString('base64') : null);
        });
      });
      r.on('error', () => finish(null));
      r.on('timeout', () => { r.destroy(); finish(null); });
    };
    attempt(null);
  });
}

// POST /api/cameras/snapshot-preview — fetch a live JPEG and return as
// base64. Probes candidate paths if snapshot_path is not provided.
// Body: { vendor, ip_address, http_port, username, password, snapshot_path? }
// Response: { found, snapshot_path?, image_base64? }
app.post('/api/cameras/snapshot-preview', auth.requireAdmin, async (req, res) => {
  try {
    const { vendor, ip_address, http_port, username, password, snapshot_path } = req.body || {};
    const ip = String(ip_address || '').trim();
    if (!ip) return res.status(400).json({ error: 'ip_address required' });
    if (_isPrivateIp(ip)) console.warn(`[SEC-008] snapshot-preview targeting ${ip} by ${req.user?.username} (${getIP(req)})`);

    const v = String(vendor || 'onvif').toLowerCase();
    const port = parseInt(http_port, 10) || 80;
    const user = String(username || ''), pass = String(password || '');

    // Use provided path or probe for one
    let pathToUse = String(snapshot_path || '').trim();
    if (!pathToUse) {
      const candidates = SNAPSHOT_CANDIDATES[v] || SNAPSHOT_CANDIDATES.onvif;
      for (const uri of candidates) {
        const ok = await _probeHttpImage(ip, port, uri, user, pass);
        if (ok) { pathToUse = uri; break; }
      }
    }
    if (!pathToUse) return res.json({ found: false });

    const imageBase64 = await _fetchImageBase64(ip, port, pathToUse, user, pass);
    if (!imageBase64) return res.json({ found: false, snapshot_path: pathToUse });

    res.json({ found: true, snapshot_path: pathToUse, image_base64: imageBase64 });
  } catch (e) { routeError(res, e, 'POST /api/cameras/snapshot-preview'); }
});

// POST /api/cameras/probe-snapshot — { vendor, ip_address, http_port,
// username, password } → { found, snapshot_path?, tried[] }. Admin-gated
// by the requireAdminForWrites('/api/cameras') mount above.
app.post('/api/cameras/probe-snapshot', async (req, res) => {
  try {
    const { vendor, ip_address, http_port, username, password } = req.body || {};
    const ip = String(ip_address || '').trim();
    if (!ip) return res.status(400).json({ error: 'ip_address required' });
    // SEC-008: log private-IP probes for audit trail (non-blocking — on-prem admin needs LAN access)
    // To enable blocking for cloud/multi-tenant SKU: uncomment the rejection below
    if (_isPrivateIp(ip)) {
      console.warn(`[SEC-008] probe-snapshot targeting private IP ${ip} by user ${req.user?.username} (${getIP(req)})`);
      // return res.status(400).json({ error: 'private IP not allowed' }); // enable for cloud SKU
    }
    const v = String(vendor || 'onvif').toLowerCase();
    const port = parseInt(http_port, 10) || 80;
    const candidates = SNAPSHOT_CANDIDATES[v] || SNAPSHOT_CANDIDATES.onvif;
    const tried = [];
    for (const uri of candidates) {
      const ok = await _probeHttpImage(ip, port, uri, username || '', password || '');
      tried.push(uri);
      if (ok) return res.json({ found: true, snapshot_path: uri, tried });
    }
    res.json({ found: false, tried });
  } catch (e) { routeError(res, e, 'POST /api/cameras/probe-snapshot'); }
});

// PATCH /api/cameras/:cameraId/pause — set/clear maintenance pause flag
// Dual-write: DB cameras.paused + cameras-config.json .paused (for ingesters)
// On unpause: stamps last_seen_at=NOW() to prevent a transient watchdog offline alert
app.patch('/api/cameras/:cameraId/pause', auth.requireAdmin, async (req, res) => {
  try {
    const { cameraId } = req.params;
    const paused = !!req.body?.paused;

    // RETURNING enabled captures the pre-pause state atomically.
    // `enabled` is frozen while paused (watchdog skips paused cameras),
    // so it reliably reflects whether the camera was online at pause time.
    const { rows } = await pool.query(
      `UPDATE cameras SET paused=$1, updated_at=NOW() WHERE id=$2 RETURNING id, enabled`,
      [paused, cameraId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Camera not found' });

    // On unpause — grace period: only stamp last_seen_at if the camera WAS online
    // when paused (enabled=true). Stamping for an offline camera causes false
    // online→offline churn (watchdog sees grace period then heartbeat timeout).
    const wasOnline = rows[0].enabled;
    if (!paused && wasOnline) {
      await pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`, [cameraId]);
    }

    // Dual-write to cameras-config.json so ingesters pick up change via fs.watch
    const config = loadCameraConfig();
    const idx = (config.cameras || []).findIndex(c => c.camera_id === cameraId);
    if (idx >= 0) {
      config.cameras[idx].paused = paused;
      saveCameraConfig(config);
    }

    // Log status transition
    await pool.query(
      `INSERT INTO camera_status_log (camera_id, status, reason) VALUES ($1,$2,$3)`,
      [cameraId, paused ? 'paused' : 'resumed',
       paused ? 'operator paused (maintenance)' : 'operator resumed']
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, target_camera_id, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.user.id, req.user.username,
       paused ? 'camera_pause' : 'camera_resume',
       cameraId, JSON.stringify({ paused })]
    );

    res.json({ ok: true, paused });
  } catch (e) { routeError(res, e, 'PATCH /api/cameras/:cameraId/pause'); }
});

app.delete('/api/cameras/:cameraId', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const config = loadCameraConfig();
    const prevCamera = (config.cameras || []).find(c => c.camera_id === cameraId) || null;
    const prevGroups = _cameraGroupIds(loadGroups(), cameraId);
    config.cameras = (config.cameras || []).filter(c => c.camera_id !== cameraId);
    saveCameraConfig(config);

    // Also remove from groups
    const groups = loadGroups();
    groups.groups = (groups.groups || []).map(g => ({
      ...g, cameraIds: (g.cameraIds || []).filter(id => id !== cameraId)
    }));
    saveGroups(groups);

    try {
      await pool.query('DELETE FROM appearances WHERE camera_id = $1', [cameraId]);
      await pool.query('DELETE FROM license_plates WHERE camera_id = $1', [cameraId]);
      await pool.query('DELETE FROM events WHERE camera_id = $1', [cameraId]);
      await pool.query('DELETE FROM cameras WHERE id = $1', [cameraId]);
    } catch (e) { /* ignore */ }

    await _logCameraAudit(req, 'camera_delete', cameraId, {
      camera: _redactCameraAudit(prevCamera),
      removed_from_groups: prevGroups,
    });

    res.json({ success: true });
  } catch (err) { routeError(res, err, 'DELETE /api/cameras/:cameraId'); }
});

// ============================================================
// API: Camera Offline Alerts + Status Log (Ph.1)
// ============================================================

// GET /api/camera-offline-alerts/:cameraId — return config (defaults if none)
app.get('/api/camera-offline-alerts/:cameraId', auth.requireAuth, async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM camera_offline_alerts WHERE camera_id = $1`, [cameraId]
    );
    const row = rows[0] || {
      camera_id: cameraId, enabled: false,
      notify_after_sec: 300, escalate_interval_min: 60, escalate_once: false,
      quiet_from: null, quiet_to: null, recipient_ids: '',
    };
    res.json(row);
  } catch (err) { routeError(res, err, 'GET /api/camera-offline-alerts/:cameraId'); }
});

// PUT /api/camera-offline-alerts/:cameraId — upsert config
app.put('/api/camera-offline-alerts/:cameraId', auth.requireAdmin, async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids } = req.body;
    const beforeResult = await pool.query(
      `SELECT enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids
         FROM camera_offline_alerts WHERE camera_id = $1`,
      [cameraId]
    );
    const before = beforeResult.rows[0] || null;

    const notifyAfter  = Math.max(30, Math.min(86400, parseInt(notify_after_sec, 10) || 300));
    const escalateMin  = Math.max(1,  Math.min(1440,  parseInt(escalate_interval_min, 10) || 60));
    const escalateOnce = !!escalate_once;
    let qf = null, qt = null;
    try { qf = normalizeTimeOfDay(quiet_from); } catch {}
    try { qt = normalizeTimeOfDay(quiet_to);   } catch {}

    await pool.query(
      `INSERT INTO camera_offline_alerts
         (camera_id, enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (camera_id) DO UPDATE SET
         enabled=$2, notify_after_sec=$3, escalate_interval_min=$4, escalate_once=$5,
         quiet_from=$6, quiet_to=$7, recipient_ids=$8, updated_at=NOW()`,
      [cameraId, !!enabled, notifyAfter, escalateMin, escalateOnce, qf, qt, String(recipient_ids || '').trim()]
    );
    const after = {
      enabled: !!enabled,
      notify_after_sec: notifyAfter,
      escalate_interval_min: escalateMin,
      escalate_once: escalateOnce,
      quiet_from: qf,
      quiet_to: qt,
      recipient_ids: String(recipient_ids || '').trim(),
    };
    await _logCameraAudit(req, 'camera_offline_alert_update', cameraId, {
      camera_id: cameraId,
      changed_fields: _diffAuditObjects(before, after),
    });
    res.json({ success: true });
  } catch (err) { routeError(res, err, 'PUT /api/camera-offline-alerts/:cameraId'); }
});

// GET /api/cameras/status-current — current operational snapshot for the
// History › Camera Status view. `updated_at` is the DB row update time and may
// include runtime updates, so the UI labels it as data update, not config edit.
app.get('/api/cameras/status-current', auth.requireAdminOrAuditor, async (req, res) => {
  try {
    const cfgCameras = (loadCameraConfig().cameras || []);
    const cfgIds = cfgCameras.map(c => c.camera_id || c.id).filter(Boolean);
    if (cfgIds.length === 0) {
      return res.json({ summary: { total: 0, online: 0, offline: 0 }, cameras: [] });
    }

    const { rows } = await pool.query(`
      WITH last_events AS (
        SELECT camera_id, MAX(event_time) AS last_event_at
        FROM events
        WHERE camera_id = ANY($1::text[])
        GROUP BY camera_id
      )
      SELECT c.id AS camera_id, c.created_at, c.updated_at, c.last_seen_at,
             c.paused, le.last_event_at
      FROM cameras c
      LEFT JOIN last_events le ON le.camera_id = c.id
      WHERE c.id = ANY($1::text[])
    `, [cfgIds]);

    const dbById = {};
    rows.forEach(r => { dbById[r.camera_id] = r; });
    const now = Date.now();
    const camerasCurrent = cfgCameras.map(c => {
      const cameraId = c.camera_id || c.id;
      const db = dbById[cameraId] || {};
      const lastSeenMs = db.last_seen_at ? new Date(db.last_seen_at).getTime() : 0;
      const status = db.paused ? 'paused'
        : (lastSeenMs && (now - lastSeenMs) / 1000 < OFFLINE_THRESHOLD_SEC ? 'online' : 'offline');
      let offlineForSec = null;
      if (status === 'offline') {
        offlineForSec = lastSeenMs ? Math.max(0, Math.round((now - lastSeenMs) / 1000)) : null;
      }
      return {
        camera_id: cameraId,
        camera_name: c.camera_name || cameraId,
        vendor: c.vendor || 'bosch',
        status,
        created_at: db.created_at || null,
        updated_at: db.updated_at || null,
        last_seen_at: db.last_seen_at || null,
        last_event_at: db.last_event_at || null,
        offline_for_sec: offlineForSec,
      };
    });

    res.json({
      summary: {
        total: camerasCurrent.length,
        online: camerasCurrent.filter(c => c.status === 'online').length,
        offline: camerasCurrent.filter(c => c.status === 'offline').length,
        paused: camerasCurrent.filter(c => c.status === 'paused').length,
      },
      cameras: camerasCurrent,
    });
  } catch (err) { routeError(res, err, 'GET /api/cameras/status-current'); }
});

// GET /api/cameras/status-log — paginated transition history
app.get('/api/cameras/status-log', auth.requireAuth, async (req, res) => {
  try {
    const cameraId = req.query.camera_id || null;
    const status   = ['online', 'offline'].includes(req.query.status) ? req.query.status : null;
    const limit    = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset   = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const params = [limit, offset];
    const where = [];
    let paramIndex = 3;
    if (cameraId) {
      where.push(`camera_id = $${paramIndex++}`);
      params.push(cameraId);
    }
    if (status) {
      where.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT id, camera_id, status, changed_at, reason,
              COUNT(*) OVER () AS total_count
       FROM camera_status_log
       ${whereSql}
       ORDER BY changed_at DESC
       LIMIT $1 OFFSET $2`, params
    );
    const total = rows[0]?.total_count ? parseInt(rows[0].total_count, 10) : 0;
    res.set('X-Total-Count', String(total));
    res.json(rows.map(r => ({
      id: r.id, camera_id: r.camera_id, status: r.status,
      changed_at: r.changed_at, reason: r.reason,
    })));
  } catch (err) { routeError(res, err, 'GET /api/cameras/status-log'); }
});

// GET /api/cameras/image-quality-log — paginated camera diagnostics history.
// These are automation/diagnostic signals, not incident/snapshot events.
app.get('/api/cameras/image-quality-log', auth.requireAdminOrAuditor, async (req, res) => {
  try {
    const cameraId = req.query.camera_id || null;
    const type = ['ImageTooBright', 'ImageTooBlurry', 'ImageTooDark', 'GlobalSceneChange'].includes(req.query.type)
      ? req.query.type
      : null;
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const params = [limit, offset];
    const where = [
      `(e.event_type LIKE 'ImageTooBright/%'
        OR e.event_type LIKE 'ImageTooBlurry/%'
        OR e.event_type LIKE 'ImageTooDark/%'
        OR e.event_type LIKE 'GlobalSceneChange/%')`,
    ];
    let paramIndex = 3;
    if (cameraId) {
      where.push(`e.camera_id = $${paramIndex++}`);
      params.push(cameraId);
    }
    if (type) {
      where.push(`e.event_type LIKE $${paramIndex++}`);
      params.push(`${type}/%`);
    }

    const { rows } = await pool.query(
      `SELECT e.id, e.camera_id, e.event_type, e.event_state, e.event_time,
              COUNT(*) OVER () AS total_count
       FROM events e
       WHERE ${where.join(' AND ')}
       ORDER BY e.event_time DESC
       LIMIT $1 OFFSET $2`, params
    );
    const total = rows[0]?.total_count ? parseInt(rows[0].total_count, 10) : 0;
    res.set('X-Total-Count', String(total));
    res.json(rows.map(r => ({
      id: r.id,
      camera_id: r.camera_id,
      event_type: r.event_type,
      event_state: r.event_state,
      event_time: r.event_time,
    })));
  } catch (err) { routeError(res, err, 'GET /api/cameras/image-quality-log'); }
});

// ============================================================
// API: Camera Groups (NEW)
// ============================================================

app.get('/api/groups', (req, res) => {
  res.json(loadGroups().groups || []);
});

app.post('/api/groups', async (req, res) => {
  try {
    const { id, name, color, cameraIds } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const data = loadGroups();
    if (!data.groups) data.groups = [];

    const newGroup = {
      id: id || `g_${Date.now()}`,
      name: String(name).trim(),
      color: color || '#00b4ff',
      cameraIds: Array.isArray(cameraIds) ? cameraIds : [],
      created_at: new Date().toISOString(),
    };

    const idx = data.groups.findIndex(g => g.id === newGroup.id);
    const prevGroup = idx >= 0 ? data.groups[idx] : null;
    if (idx >= 0) {
      newGroup.created_at = data.groups[idx].created_at;
      data.groups[idx] = newGroup;
    } else {
      data.groups.push(newGroup);
    }

    saveGroups(data);
    const beforeIds = new Set(prevGroup?.cameraIds || []);
    const afterIds = new Set(newGroup.cameraIds || []);
    const added = [...afterIds].filter(cameraId => !beforeIds.has(cameraId));
    const removed = [...beforeIds].filter(cameraId => !afterIds.has(cameraId));
    await auth.logAudit(req.user?.id, req.user?.username, idx >= 0 ? 'group_update' : 'group_create', null, null, getIP(req), req.headers['user-agent'], {
      group_id: newGroup.id,
      group_name: newGroup.name,
      camera_count: newGroup.cameraIds.length,
      added_cameras: added,
      removed_cameras: removed,
    });
    for (const cameraId of added) {
      await _logCameraAudit(req, 'camera_group_assign', cameraId, { group_id: newGroup.id, group_name: newGroup.name });
    }
    for (const cameraId of removed) {
      await _logCameraAudit(req, 'camera_group_remove', cameraId, { group_id: newGroup.id, group_name: newGroup.name });
    }
    res.json({ success: true, group: newGroup });
  } catch (err) { routeError(res, err, 'POST /api/groups'); }
});

app.delete('/api/groups/:groupId', async (req, res) => {
  try {
    const data = loadGroups();
    const prevGroup = (data.groups || []).find(g => g.id === req.params.groupId) || null;
    data.groups = (data.groups || []).filter(g => g.id !== req.params.groupId);
    saveGroups(data);
    await auth.logAudit(req.user?.id, req.user?.username, 'group_delete', null, null, getIP(req), req.headers['user-agent'], {
      group_id: req.params.groupId,
      group_name: prevGroup?.name || null,
      camera_count: (prevGroup?.cameraIds || []).length,
    });
    for (const cameraId of prevGroup?.cameraIds || []) {
      await _logCameraAudit(req, 'camera_group_remove', cameraId, { group_id: req.params.groupId, group_name: prevGroup?.name || null });
    }
    res.json({ success: true });
  } catch (err) { routeError(res, err, 'DELETE /api/groups/:groupId'); }
});

// ============================================================
// API: Events
// ============================================================

// Phase 6.1.8 — object class hierarchy. Selecting a parent class expands to
// all children automatically so cameras that emit generic "Vehicle" + cameras
// that emit specific "Car"/"Truck" both match a single "Vehicle" filter.
// `null` is significant — some Counter events have no object_class.
const CLASS_HIERARCHY = {
  Person:  ['Person', 'Face', 'HumanFace', 'HumanBody', 'Pedestrian'],
  Vehicle: ['Vehicle', 'Car', 'Truck', 'Bus', 'Motorcycle', 'Motorbike', 'Van', 'Bicycle', 'Bike'],
  Other:   ['Animal', 'LicensePlate', 'Object'],
};
function expandClasses(input) {
  if (!input) return null;
  const tokens = String(input).split(',').map(s => s.trim()).filter(Boolean);
  const expanded = new Set();
  for (const t of tokens) {
    if (CLASS_HIERARCHY[t]) CLASS_HIERARCHY[t].forEach(c => expanded.add(c));
    else expanded.add(t);
  }
  return [...expanded];
}

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

app.get('/api/events', async (req, res) => {
  const {
    camera, cameras, category, type, cls, object_classes,
    rule_name, rule_names, category_id,
    limit = 100, offset = 0, from, to,
    hasSnapshot, hasClip, tab, q,
    dow, hour,
  } = req.query;
  try {
    // COUNT(*) OVER () returns the row count BEFORE LIMIT/OFFSET — used for
    // X-Total-Count header so the frontend can render pagination without a
    // second roundtrip. Index-friendly: ~5ms overhead vs separate count query.
    let sql = `SELECT e.*,
                 COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
                 e.raw_json->>'_snapshot_source' AS snapshot_source,
                 COUNT(*) OVER () ::int AS _total
               FROM events e
               WHERE e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
                 AND e.event_type <> 'FaceCapture'`;
    const params = [];
    let n = 0;
    // Camera-automation analytics events (Phase 7.1): hide types the
    // operator has toggled off, and always hide the event_state='false'
    // "ended" half (state dedup). Non-analytics rows have a NULL key from
    // ANALYTICS_KEY_SQL and pass both checks untouched.
    const disabledAnalytics = ANALYTICS_EVENT_KEYS.filter(k => !_analyticsEnabledSet.has(k));
    if (disabledAnalytics.length) {
      sql += ` AND COALESCE((${ANALYTICS_KEY_SQL}), '') <> ALL($${++n}::text[])`;
      params.push(disabledAnalytics);
    }
    sql += ` AND NOT ((${ANALYTICS_KEY_SQL}) IS NOT NULL AND e.event_state = 'false')`;
    // FieldDetector fires enter (state='true') + leave (state='false') per detection.
    // Hide the leave half — it has no snapshot and appears as a duplicate in the UI.
    sql += ` AND NOT (e.event_type LIKE 'FieldDetector%' AND e.event_state = 'false')`;
    if (camera)    { sql += ` AND e.camera_id = $${++n}`;      params.push(camera); }
    if (cameras)   {
      const arr = String(cameras).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) { sql += ` AND e.camera_id = ANY($${++n})`; params.push(arr); }
    }
    if (category)  { sql += ` AND e.event_category = $${++n}`; params.push(category); }
    if (type)      { sql += ` AND e.event_type LIKE $${++n}`;  params.push(`%${type}%`); }
    if (cls)       { sql += ` AND e.object_class = $${++n}`;   params.push(cls); }
    if (object_classes) {
      const arr = expandClasses(object_classes);
      if (arr && arr.length > 0) { sql += ` AND e.object_class = ANY($${++n})`; params.push(arr); }
    }
    if (rule_name) { sql += ` AND e.rule_name = $${++n}`;      params.push(rule_name); }
    if (rule_names) {
      const arr = String(rule_names).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) { sql += ` AND e.rule_name = ANY($${++n})`; params.push(arr); }
    }
    if (from)      { sql += ` AND e.event_time >= $${++n}`;    params.push(from); }
    if (to)        { sql += ` AND e.event_time <= $${++n}`;    params.push(to); }
    if (hasSnapshot === 'true') { sql += ` AND e.has_snapshot = TRUE`; }
    if (hasClip === 'true')     { sql += ` AND e.clip_file IS NOT NULL AND e.clip_status = 'done'`; }
    // Phase 6.1.8 — Events Live page tabs (server-side, fixes pagination undercount)
    if (tab === 'snap')    sql += ` AND e.has_snapshot = TRUE`;
    if (tab === 'no_snap') sql += ` AND e.has_snapshot = FALSE`;
    if (tab === 'lpr')     sql += ` AND e.event_type LIKE '%Recognition%'`;
    if (tab === 'clip')    sql += ` AND e.clip_file IS NOT NULL AND e.clip_status = 'done'`;
    // Free-text search: scans rule_name + camera_id + object_class + event_type
    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`;
      sql += ` AND (e.rule_name ILIKE $${++n} OR e.camera_id ILIKE $${n} OR e.object_class ILIKE $${n} OR e.event_type ILIKE $${n})`;
      params.push(term);
    }
    if (category_id) {
      // drill-down: events that match ANY mapping rule of the given category
      sql += ` AND EXISTS (
        SELECT 1 FROM event_category_rules r
         WHERE r.category_id = $${++n}
           AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
           AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
           AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
           AND (r.object_class IS NULL OR r.object_class = e.object_class)
           AND (r.match_state  IS NULL OR r.match_state  = e.event_state))`;
      params.push(category_id);
    }
    // Activity-heatmap drill-down: hour-of-week filter aligned to display_tz.
    // Must be server-side — applying it client-side after the 20-row LIMIT
    // means the filter sees only the current page, almost always missing the
    // cell's events even when they exist. dow encoding mirrors the heatmap
    // query (EXTRACT(isodow) - 1 → 0=Mon..6=Sun).
    const dowInt  = (dow  !== undefined && dow  !== '') ? parseInt(dow,  10) : null;
    const hourInt = (hour !== undefined && hour !== '') ? parseInt(hour, 10) : null;
    const validDow  = Number.isInteger(dowInt)  && dowInt  >= 0 && dowInt  <= 6;
    const validHour = Number.isInteger(hourInt) && hourInt >= 0 && hourInt <= 23;
    if (validDow || validHour) {
      const tz = await getDisplayTz();
      params.push(tz);
      const tzIdx = ++n;
      if (validDow) {
        sql += ` AND (EXTRACT(isodow FROM e.event_time AT TIME ZONE $${tzIdx})::int - 1) = $${++n}`;
        params.push(dowInt);
      }
      if (validHour) {
        sql += ` AND EXTRACT(hour FROM e.event_time AT TIME ZONE $${tzIdx})::int = $${++n}`;
        params.push(hourInt);
      }
    }
    sql += ` ORDER BY e.event_time DESC LIMIT $${++n} OFFSET $${++n}`;
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(sql, params);
    const total = rows.length > 0 ? (rows[0]._total ?? 0) : 0;
    // Strip _total off each row before responding (it's a window-fn artifact)
    rows.forEach(r => { delete r._total; });
    res.set('X-Total-Count', String(total));
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/events'); }
});

// ============================================================
// API: Statistics
// ============================================================

// Time series: TOTAL EVENTS + ALERTS (2 lines)
// Alerts = events with rule_name set (intentional alerts)
app.get('/api/stats/timeline', async (req, res) => {
  const { from, to, cameras, granularity = 'hour' } = req.query;
  try {
    const truncUnit = granularity === 'hour' ? 'hour' : granularity === 'day' ? 'day' : 'week';
    let sql = `SELECT 
                 DATE_TRUNC('${truncUnit}', event_time) AS bucket,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name != '')::int AS alerts
               FROM events WHERE 1=1`;
    const params = [];
    let n = 0;
    if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
    if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
    if (cameras) {
      sql += ` AND camera_id = ANY($${++n})`;
      params.push(cameras.split(','));
    }
    sql += ` GROUP BY bucket ORDER BY bucket ASC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/stats/timeline'); }
});

// Per-camera "today" counts — used by Camera Status dashboard.
// "Today" = midnight in display_timezone (Asia/Bangkok by default) → now.
// Replaces the buggy client-side filter from allEvents (capped at 300 = severe undercount).
// 30s TTL cache: frontend polls every 60s; data doesn't need sub-minute freshness (Phase 3 opt, O6)
let _todayCountsCache = null, _todayCountsCacheAt = 0;
const TODAY_COUNTS_TTL_MS = 30_000;

// appearances/stats runs 8 parallel aggregation queries with no cache.
// 30s TTL keyed by from+to+camera_id — same approach as today-counts (decision #181).
let _appStatsCache = null, _appStatsCacheAt = 0, _appStatsCacheKey = '';
const APP_STATS_TTL_MS = 30_000;

app.get('/api/stats/today-counts', async (req, res) => {
  try {
    const now = Date.now();
    if (_todayCountsCache && now - _todayCountsCacheAt < TODAY_COUNTS_TTL_MS) {
      return res.json(_todayCountsCache);
    }
    const tz = await getDisplayTz();
    const r = await pool.query(`
      SELECT camera_id,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
             COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles,
             MAX(event_time) AS last_event
        FROM events
       WHERE event_time >= date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1
         AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
       GROUP BY camera_id`, [tz]);

    const cameras = {};
    let totalAll = 0;
    for (const row of r.rows) {
      cameras[row.camera_id] = {
        total: row.total,
        persons: row.persons,
        vehicles: row.vehicles,
        last_event: row.last_event ? new Date(row.last_event).toISOString() : null,
      };
      totalAll += row.total;
    }
    _todayCountsCache = { total: totalAll, cameras, tz };
    _todayCountsCacheAt = now;
    res.json(_todayCountsCache);
  } catch (err) { routeError(res, err, 'GET /api/stats/today-counts'); }
});

// KPI Cards
app.get('/api/stats/kpi', async (req, res) => {
  const { from, to, cameras } = req.query;
  try {
    let sql = `
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name != '')::int AS alerts,
        COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
        COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles,
        COUNT(*) FILTER (WHERE event_type LIKE '%Crossed%' OR event_type LIKE '%Recognition%')::int AS traffic_violations
      FROM events WHERE 1=1`;
    const params = [];
    let n = 0;
    if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
    if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
    if (cameras) {
      sql += ` AND camera_id = ANY($${++n})`;
      params.push(cameras.split(','));
    }
    const { rows } = await pool.query(sql, params);
    res.json(rows[0] || {});
  } catch (err) { routeError(res, err, 'GET /api/stats/kpi'); }
});

// Event Breakdown by rule_name
app.get('/api/stats/breakdown', async (req, res) => {
  const { from, to, cameras } = req.query;
  try {
    let sql = `
      SELECT 
        COALESCE(NULLIF(rule_name, ''), event_type) AS name,
        event_type,
        COUNT(*)::int AS count
      FROM events
      WHERE 1=1`;
    const params = [];
    let n = 0;
    if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
    if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
    if (cameras) {
      sql += ` AND camera_id = ANY($${++n})`;
      params.push(cameras.split(','));
    }
    sql += ` GROUP BY name, event_type ORDER BY count DESC LIMIT 20`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/stats/breakdown'); }
});

// Original endpoints (kept for compatibility)
app.get('/api/stats/timeseries-rules', async (req, res) => {
  const { from, to, cameras, rules, granularity = 'day' } = req.query;
  try {
    const truncUnit = granularity === 'hour' ? 'hour' : 'day';
    let sql = `SELECT 
                 DATE_TRUNC('${truncUnit}', event_time) AS bucket,
                 COALESCE(NULLIF(rule_name, ''), event_type) AS rule_name,
                 COUNT(*)::int AS count
               FROM events WHERE rule_name IS NOT NULL`;
    const params = [];
    let n = 0;
    if (from) { sql += ` AND event_time >= $${++n}`; params.push(from); }
    if (to)   { sql += ` AND event_time <= $${++n}`; params.push(to); }
    if (cameras) { sql += ` AND camera_id = ANY($${++n})`; params.push(cameras.split(',')); }
    if (rules) { sql += ` AND rule_name = ANY($${++n})`; params.push(rules.split(',')); }
    sql += ` GROUP BY bucket, rule_name ORDER BY bucket ASC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/stats/timeseries-rules'); }
});

app.get('/api/heatmap', async (req, res) => {
  const { hours = 24 } = req.query;
  try {
    // Exclude metric events so the Map activity intensity reflects real
    // incidents, not 1000+ counter samples/hour from "Crowd" rules.
    const { rows } = await pool.query(`
      SELECT camera_id, COUNT(*)::int AS count
      FROM events
      WHERE event_time > NOW() - ($1 * INTERVAL '1 hour')
        AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
      GROUP BY camera_id
    `, [Math.max(1, parseInt(hours, 10) || 24)]);
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/heatmap'); }
});

// ============================================================
// API: Map Tile Cache (Offline Maps)
// ============================================================

// State สำหรับ download progress (in-memory)
const mapDownloadState = {
  active: false,
  total: 0,
  done: 0,
  failed: 0,
  current: '',
  area: null,
  startedAt: null,
  finishedAt: null,
  errors: [],
  cancelled: false,
};

// Helpers
let _mapAreasCache = null, _mapAreasMtime = 0;
function loadMapAreas() {
  try {
    const mtime = fs.existsSync(MAP_AREAS_FILE) ? fs.statSync(MAP_AREAS_FILE).mtimeMs : 0;
    if (mtime !== _mapAreasMtime) {
      _mapAreasCache = mtime ? JSON.parse(fs.readFileSync(MAP_AREAS_FILE, 'utf8')) : { areas: [] };
      _mapAreasMtime = mtime;
    }
    return _mapAreasCache || { areas: [] };
  } catch (e) { return { areas: [] }; }
}

function saveMapAreas(data) {
  try {
    fs.writeFileSync(MAP_AREAS_FILE, JSON.stringify(data, null, 2));
    _mapAreasMtime = 0; // invalidate cache
    return true;
  } catch (e) { return false; }
}

if (!fs.existsSync(MAP_AREAS_FILE)) saveMapAreas({ areas: [] });

// Convert lat/lon to tile X/Y at given zoom
function lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function latToTileY(lat, z) {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
}

// Bounds + limits for map tile cache jobs. A compromised admin session or
// operator typo could otherwise start a multi-TB world-scale download.
const MAP_TILE_LIMITS = {
  MAX_TILES: 500000,             // ≈7.5GB at ~15KB/tile per style/provider
  MIN_ZOOM: 0, MAX_ZOOM: 22,
  MIN_LAT: -85, MAX_LAT: 85,     // Web Mercator usable range
  MIN_LNG: -180, MAX_LNG: 180,
};

// Returns error message string if invalid, or null if OK.
function validateMapBounds(bbox, zoomMin, zoomMax) {
  if (!bbox || typeof bbox !== 'object') return 'bbox required (north, south, east, west)';
  const { north, south, east, west } = bbox;
  for (const [k, v] of [['north', north], ['south', south], ['east', east], ['west', west]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `bbox.${k} must be a finite number`;
  }
  if (north < MAP_TILE_LIMITS.MIN_LAT || north > MAP_TILE_LIMITS.MAX_LAT
      || south < MAP_TILE_LIMITS.MIN_LAT || south > MAP_TILE_LIMITS.MAX_LAT) {
    return `latitude out of range [${MAP_TILE_LIMITS.MIN_LAT}, ${MAP_TILE_LIMITS.MAX_LAT}]`;
  }
  if (east < MAP_TILE_LIMITS.MIN_LNG || east > MAP_TILE_LIMITS.MAX_LNG
      || west < MAP_TILE_LIMITS.MIN_LNG || west > MAP_TILE_LIMITS.MAX_LNG) {
    return `longitude out of range [${MAP_TILE_LIMITS.MIN_LNG}, ${MAP_TILE_LIMITS.MAX_LNG}]`;
  }
  if (north <= south) return 'bbox.north must be greater than bbox.south';
  const zmin = parseInt(zoomMin, 10);
  const zmax = parseInt(zoomMax, 10);
  if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) return 'zoomMin/zoomMax must be integers';
  if (zmin < MAP_TILE_LIMITS.MIN_ZOOM || zmax > MAP_TILE_LIMITS.MAX_ZOOM) {
    return `zoom out of range [${MAP_TILE_LIMITS.MIN_ZOOM}, ${MAP_TILE_LIMITS.MAX_ZOOM}]`;
  }
  if (zmin > zmax) return 'zoomMin must be <= zoomMax';
  return null;
}

// คำนวณจำนวน tile ในพื้นที่ที่ระบุ
function calculateTiles(bbox, zoomMin, zoomMax) {
  const { north, south, east, west } = bbox;
  let total = 0;
  const perZoom = {};
  for (let z = zoomMin; z <= zoomMax; z++) {
    const xMin = lonToTileX(west, z);
    const xMax = lonToTileX(east, z);
    const yMin = latToTileY(north, z);
    const yMax = latToTileY(south, z);
    const count = (xMax - xMin + 1) * (yMax - yMin + 1);
    perZoom[z] = count;
    total += count;
  }
  return { total, perZoom };
}

// Estimate ขนาดไฟล์ (เฉลี่ย 15 KB ต่อ tile)
function estimateSize(tileCount) {
  const bytesPerTile = 15 * 1024; // 15 KB average
  return tileCount * bytesPerTile;
}

// Download single tile
function downloadTile(url, destPath) {
  return new Promise((resolve) => {
    if (fs.existsSync(destPath)) return resolve({ skipped: true });
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const lib = url.startsWith('https') ? require('https') : http;
    const req = lib.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'BoschCCTVDashboard/4.1 (offline cache)' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ error: `HTTP ${res.statusCode}` });
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          fs.writeFileSync(destPath, Buffer.concat(chunks));
          resolve({ ok: true, size: chunks.reduce((s, c) => s + c.length, 0) });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

// Download tiles in area (background job)
async function downloadAreaTiles(area) {
  const { bbox, zoomMin, zoomMax, styles, providers = ['carto'] } = area;

  // Build tile server matrix: [provider][style] = array of base URLs
  // ใช้ MAPBOX_TOKEN จาก .env (ถ้ามี) สำหรับ mapbox provider
  const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
  const tileServers = {
    carto: {
      streets: ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager`),
      light:   ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/light_all`),
    },
    mapbox: MAPBOX_TOKEN ? {
      streets: ['mapbox/streets-v12'],   // 1 server only — ใช้ token rate limit
      light:   ['mapbox/light-v11'],
    } : null,
  };

  // Build URL fn ตาม provider
  const buildUrl = (provider, style, z, x, y, serverIdx) => {
    if (provider === 'mapbox') {
      const styleId = tileServers.mapbox[style][0];
      return `https://api.mapbox.com/styles/v1/${styleId}/tiles/${z}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;
    }
    // Carto (default)
    const servers = tileServers.carto[style];
    return `${servers[serverIdx % servers.length]}/${z}/${x}/${y}.png`;
  };

  // คำนวณ total = tiles × styles × providers ที่ใช้ได้
  const validProviders = providers.filter(p => tileServers[p]);
  if (validProviders.length === 0) {
    console.error('No valid providers selected (mapbox needs MAPBOX_TOKEN in .env)');
    return;
  }

  // Reset state
  const calc = calculateTiles(bbox, zoomMin, zoomMax);
  mapDownloadState.active = true;
  mapDownloadState.cancelled = false;
  mapDownloadState.total = calc.total * styles.length * validProviders.length;
  mapDownloadState.done = 0;
  mapDownloadState.failed = 0;
  mapDownloadState.area = area;
  mapDownloadState.startedAt = new Date().toISOString();
  mapDownloadState.finishedAt = null;
  mapDownloadState.errors = [];

  for (const provider of validProviders) {
    if (mapDownloadState.cancelled) break;
    for (const style of styles) {
      if (mapDownloadState.cancelled) break;
      if (!tileServers[provider][style]) continue;

      for (let z = zoomMin; z <= zoomMax; z++) {
        if (mapDownloadState.cancelled) break;
        const xMin = lonToTileX(bbox.west, z);
        const xMax = lonToTileX(bbox.east, z);
        const yMin = latToTileY(bbox.north, z);
        const yMax = latToTileY(bbox.south, z);

        // Concurrent downloads — Mapbox จำกัดไว้ 4, Carto 8
        const concurrency = provider === 'mapbox' ? 4 : 8;
        const tiles = [];
        for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) {
            tiles.push({ x, y, z });
          }
        }

        let serverIdx = 0;
        for (let i = 0; i < tiles.length; i += concurrency) {
          if (mapDownloadState.cancelled) break;
          const batch = tiles.slice(i, i + concurrency);
          await Promise.all(batch.map(async (t) => {
            if (mapDownloadState.cancelled) return;
            const url = buildUrl(provider, style, t.z, t.x, t.y, serverIdx++);
            // Cache path: /map-cache/{provider}/{style}/{z}/{x}/{y}.png
            const dest = path.join(MAP_CACHE_DIR, provider, style, String(t.z), String(t.x), `${t.y}.png`);
            mapDownloadState.current = `${provider} ${style} z${t.z} ${t.x}/${t.y}`;
            const result = await downloadTile(url, dest);
            if (result.error) {
              mapDownloadState.failed++;
              if (mapDownloadState.errors.length < 50) {
                mapDownloadState.errors.push({
                  tile: `${provider}/${style}/${t.z}/${t.x}/${t.y}`,
                  error: result.error,
                });
              }
            }
            mapDownloadState.done++;
          }));
        }
      }
    }
  }

  mapDownloadState.active = false;
  mapDownloadState.finishedAt = new Date().toISOString();
  mapDownloadState.current = mapDownloadState.cancelled ? 'cancelled' : 'completed';
  console.log(`🗺️  Map cache download ${mapDownloadState.current}: ${mapDownloadState.done}/${mapDownloadState.total} tiles (${mapDownloadState.failed} failed)`);
}

// API: Calculate tile count + size estimate
app.post('/api/map/estimate', (req, res) => {
  try {
    const { bbox, zoomMin = 8, zoomMax = 16, styles = ['streets', 'light'], providers = ['carto'] } = req.body;
    const boundsErr = validateMapBounds(bbox, zoomMin, zoomMax);
    if (boundsErr) return res.status(400).json({ error: boundsErr });

    // Validate providers (mapbox ต้องมี token)
    const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
    const validProviders = providers.filter(p => p === 'carto' || (p === 'mapbox' && MAPBOX_TOKEN));

    const calc = calculateTiles(bbox, zoomMin, zoomMax);
    const totalTiles = calc.total * styles.length * validProviders.length;
    res.json({
      bbox,
      zoomRange: [zoomMin, zoomMax],
      styles,
      providers: validProviders,
      tilesPerStyle: calc.total,
      totalTiles,
      estimatedSize: estimateSize(totalTiles),
      perZoom: calc.perZoom,
      mapboxAvailable: !!MAPBOX_TOKEN,
    });
  } catch (e) { routeError(res, e, 'POST /api/map/estimate'); }
});

// API: Start download (background)
app.post('/api/map/download', (req, res) => {
  if (mapDownloadState.active) {
    return res.status(409).json({ error: 'Download already in progress' });
  }
  const { name, bbox, zoomMin = 8, zoomMax = 16, styles = ['streets', 'light'], providers = ['carto'] } = req.body;
  const boundsErr = validateMapBounds(bbox, zoomMin, zoomMax);
  if (boundsErr) return res.status(400).json({ error: boundsErr });

  // Cap total tile count BEFORE the background job kicks off so an oversized
  // bbox can't fill the disk silently.
  const MAPBOX_TOKEN_CHECK = process.env.MAPBOX_TOKEN || '';
  const validProvidersForCount = (providers || []).filter(p => p === 'carto' || (p === 'mapbox' && MAPBOX_TOKEN_CHECK));
  const calc = calculateTiles(bbox, zoomMin, zoomMax);
  const totalTiles = calc.total * (styles?.length || 1) * (validProvidersForCount.length || 1);
  if (totalTiles > MAP_TILE_LIMITS.MAX_TILES) {
    return res.status(400).json({
      error: `Too many tiles (${totalTiles.toLocaleString()}). Max allowed: ${MAP_TILE_LIMITS.MAX_TILES.toLocaleString()}. Reduce bbox or zoom range.`,
      totalTiles, maxTiles: MAP_TILE_LIMITS.MAX_TILES,
    });
  }

  const area = {
    id: `area_${Date.now()}`,
    name: name || 'Unnamed Area',
    bbox, zoomMin, zoomMax, styles, providers,
    createdAt: new Date().toISOString(),
  };

  // Save area to history
  const data = loadMapAreas();
  data.areas.push(area);
  saveMapAreas(data);

  // Start in background (don't await)
  downloadAreaTiles(area).catch(err => {
    console.error('Download error:', err);
    mapDownloadState.active = false;
  });

  res.json({ success: true, area });
});

// API: Get download progress
app.get('/api/map/progress', (req, res) => {
  res.json({
    ...mapDownloadState,
    progressPercent: mapDownloadState.total > 0
      ? (mapDownloadState.done / mapDownloadState.total * 100).toFixed(1)
      : 0,
  });
});

// API: Cancel download
app.post('/api/map/cancel', (req, res) => {
  mapDownloadState.cancelled = true;
  res.json({ success: true });
});

// API: List saved areas + cache stats
app.get('/api/map/areas', (req, res) => {
  const areas = loadMapAreas().areas || [];
  // Calculate cache size
  let totalSize = 0;
  let totalTiles = 0;
  try {
    const styles = fs.readdirSync(MAP_CACHE_DIR).filter(f => fs.statSync(path.join(MAP_CACHE_DIR, f)).isDirectory());
    for (const style of styles) {
      const styleDir = path.join(MAP_CACHE_DIR, style);
      const walker = (dir) => {
        let size = 0, count = 0;
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const sub = walker(fp);
              size += sub.size; count += sub.count;
            } else {
              size += fs.statSync(fp).size;
              count++;
            }
          }
        } catch {}
        return { size, count };
      };
      const stat = walker(styleDir);
      totalSize += stat.size;
      totalTiles += stat.count;
    }
  } catch {}
  res.json({ areas, cacheSize: totalSize, cachedTiles: totalTiles });
});

// API: Delete saved area (and optionally its tiles)
app.delete('/api/map/areas/:areaId', (req, res) => {
  const data = loadMapAreas();
  data.areas = (data.areas || []).filter(a => a.id !== req.params.areaId);
  saveMapAreas(data);
  res.json({ success: true });
});

// API: Clear entire cache
app.delete('/api/map/cache', (req, res) => {
  try {
    if (fs.existsSync(MAP_CACHE_DIR)) {
      fs.rmSync(MAP_CACHE_DIR, { recursive: true, force: true });
      fs.mkdirSync(MAP_CACHE_DIR, { recursive: true });
    }
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'DELETE /api/map/cache'); }
});

// SEC-017: Mapbox tile proxy — keeps token server-side; auth-gated (under /api middleware).
// Cache-check first (reuses MAP_CACHE_DIR/mapbox/style/z/x/y.png from download worker).
// On cache miss: fetch from Mapbox with server-side MAPBOX_TOKEN, write cache, return PNG.
app.get('/api/map/tiles/mapbox/:style/:z/:x/:y.png', async (req, res) => {
  const { style, z, x, y } = req.params;
  if (!/^[a-z_]+$/.test(style) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).end();
  }
  const MAPBOX_TOKEN = await getMapboxToken();
  if (!MAPBOX_TOKEN) return res.status(503).json({ error: 'mapbox_not_configured' });

  const cachePath = path.join(MAP_CACHE_DIR, 'mapbox', style, z, x, `${y}.png`);
  if (fs.existsSync(cachePath)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(cachePath);
  }

  const styleId = style === 'light' ? 'mapbox/light-v11' : 'mapbox/streets-v12';
  const upstreamUrl = `https://api.mapbox.com/styles/v1/${styleId}/tiles/${z}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;

  try {
    const result = await new Promise((resolve) => {
      require('https').get(upstreamUrl, { timeout: 10000, headers: { 'User-Agent': 'VigilDashboard/1.5' } }, (upstream) => {
        if (upstream.statusCode !== 200) {
          upstream.resume();
          return resolve({ error: upstream.statusCode });
        }
        const chunks = [];
        upstream.on('data', c => chunks.push(c));
        upstream.on('end', () => {
          const buf = Buffer.concat(chunks);
          fs.mkdirSync(path.dirname(cachePath), { recursive: true });
          fs.writeFileSync(cachePath, buf);
          resolve({ buf });
        });
      }).on('error', e => resolve({ error: e.message }));
    });

    if (result.error) return res.status(502).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(result.buf);
  } catch (e) {
    res.status(500).end();
  }
});

// Static serve cached tiles: /tiles/{style}/{z}/{x}/{y}.png
// Static serve cached tiles
// Format: /tiles/{provider}/{style}/{z}/{x}/{y}.png  (เช่น /tiles/carto/streets/15/...)
// Backward compat: /tiles/{style}/{z}/{x}/{y}.png  → ถือว่าเป็น carto provider
app.get('/tiles/:provider/:style/:z/:x/:y.png', (req, res) => {
  const { provider, style, z, x, y } = req.params;
  if (!/^[a-z_]+$/.test(provider) || !/^[a-z_]+$/.test(style) ||
      !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).end();
  }
  const filePath = path.join(MAP_CACHE_DIR, provider, style, z, x, `${y}.png`);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  } else {
    res.status(404).end();
  }
});

// Backward compat: /tiles/{style}/{z}/{x}/{y}.png → carto provider
app.get('/tiles/:style/:z/:x/:y.png', (req, res) => {
  const { style, z, x, y } = req.params;
  if (!/^[a-z_]+$/.test(style) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).end();
  }
  // ลองหาใน carto folder ก่อน, ถ้าไม่เจอลอง root (สำหรับ cache เก่า)
  let filePath = path.join(MAP_CACHE_DIR, 'carto', style, z, x, `${y}.png`);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(MAP_CACHE_DIR, style, z, x, `${y}.png`);
  }
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  } else {
    res.status(404).end();
  }
});

// ============================================================
// API: Alert Rules + LINE Config (LINE Notification System)
// ============================================================

const lineSender = require('./line-sender');
const pushSender = require('./push-sender');
const QRCode = require('qrcode');

// ── Push notification token registry (mobile app) ───────────
// Mobile ส่ง Expo push token หลัง login. UPSERT by token —
// re-register อัปเดต last_seen + เปิดใหม่ถ้าเคยถูกปิด.
app.post('/api/push/register', auth.requireAuth, async (req, res) => {
  try {
    const { token, platform, notify_alert, notify_face } = req.body || {};
    if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken')) {
      return res.status(400).json({ error: 'invalid token' });
    }
    const nAlert = notify_alert !== false;   // default true
    const nFace  = notify_face  !== false;
    await pool.query(
      `INSERT INTO push_tokens (token, user_id, platform, enabled, notify_alert, notify_face, last_seen_at)
         VALUES ($1, $2, $3, TRUE, $4, $5, NOW())
       ON CONFLICT (token) DO UPDATE
         SET user_id = $2, platform = $3, enabled = TRUE,
             notify_alert = $4, notify_face = $5, last_seen_at = NOW()`,
      [token, req.user?.id ?? null, (platform || '').slice(0, 10), nAlert, nFace]
    );
    res.json({ success: true });
  } catch (err) { routeError(res, err, 'POST /api/push/register'); }
});

// ปิด token (logout) — ไม่ลบ เผื่อ re-login device เดิม
app.post('/api/push/unregister', auth.requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (token) await pool.query(`UPDATE push_tokens SET enabled = FALSE WHERE token = $1`, [token]);
    res.json({ success: true });
  } catch (err) { routeError(res, err, 'POST /api/push/unregister'); }
});

// ── LINE Config (CRUD) ──────────────────────────────────────
app.get('/api/line-config', auth.requireAdminOrAuditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM line_config WHERE id = 1');
    const cfg = rows[0] || { id: 1, channel_access_token: null, recipients: [], enabled: false };
    // Mask token (return เฉพาะ 12 ตัวท้าย)
    const masked = {
      ...cfg,
      channel_access_token: cfg.channel_access_token
        ? '••••••••' + cfg.channel_access_token.slice(-12)
        : null,
      channel_secret: cfg.channel_secret
        ? '••••••••' + cfg.channel_secret.slice(-8)
        : null,
      imgbb_api_key: cfg.imgbb_api_key
        ? '••••••••' + cfg.imgbb_api_key.slice(-6)
        : null,
      _hasToken: !!cfg.channel_access_token,
      _hasSecret: !!cfg.channel_secret,
      _hasImgbb: !!cfg.imgbb_api_key,
    };
    res.json(masked);
  } catch (e) { routeError(res, e, 'GET /api/line-config'); }
});

app.put('/api/line-config', async (req, res) => {
  try {
    const { channel_access_token, channel_secret, imgbb_api_key, enabled, recipients, oa_basic_id } = req.body;
    // Build update query (skip masked tokens — ที่ขึ้นต้นด้วย ••)
    const updates = [];
    const values = [];
    let idx = 1;
    if (channel_access_token !== undefined && !channel_access_token.startsWith('••')) {
      updates.push(`channel_access_token = $${idx++}`); values.push(channel_access_token || null);
    }
    if (channel_secret !== undefined && !channel_secret.startsWith('••')) {
      updates.push(`channel_secret = $${idx++}`); values.push(channel_secret || null);
    }
    if (imgbb_api_key !== undefined && !imgbb_api_key.startsWith('••')) {
      updates.push(`imgbb_api_key = $${idx++}`); values.push(imgbb_api_key || null);
    }
    if (enabled !== undefined) { updates.push(`enabled = $${idx++}`); values.push(enabled); }
    if (recipients !== undefined) { updates.push(`recipients = $${idx++}::jsonb`); values.push(JSON.stringify(recipients)); }
    if (oa_basic_id !== undefined) { updates.push(`oa_basic_id = $${idx++}`); values.push(oa_basic_id || null); }
    if (updates.length === 0) return res.json({ success: true, message: 'No changes' });
    updates.push('updated_at = NOW()');

    // ถ้า recipients เปลี่ยน → หา line_id ที่ถูกลบออก แล้ว reset pending_recipients เป็น 'ignored'
    // เพื่อให้ถ้า user ทักมาอีก webhook จะ reset เป็น 'pending' และขึ้นหน้า "ตรวจพบใหม่"
    let removedIds = [];
    if (recipients !== undefined) {
      const prevRes = await pool.query('SELECT recipients FROM line_config WHERE id = 1');
      const prevIds = new Set((prevRes.rows[0]?.recipients || []).map(r => r?.id).filter(Boolean));
      const newIds = new Set((recipients || []).map(r => r?.id).filter(Boolean));
      removedIds = [...prevIds].filter(id => !newIds.has(id));
    }

    await pool.query(`UPDATE line_config SET ${updates.join(', ')} WHERE id = 1`, values);

    if (removedIds.length > 0) {
      await pool.query(
        `UPDATE pending_recipients SET status = 'ignored' WHERE line_id = ANY($1) AND status = 'approved'`,
        [removedIds]
      );
    }

    pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'PUT /api/line-config'); }
});

// LINE message quota
app.get('/api/line-config/quota', auth.requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT channel_access_token FROM line_config WHERE id = 1');
    const token = rows[0]?.channel_access_token;
    if (!token) return res.json({ connected: false });
    const quota = await lineSender.getLineQuota(token);
    if (!quota) return res.json({ connected: false });
    res.json({ connected: true, ...quota });
  } catch (e) { routeError(res, e, 'GET /api/line-config/quota'); }
});

// Test LINE connection
app.post('/api/line-config/test', auth.requireAdmin, async (req, res) => {
  try {
    const { recipientId } = req.body;
    if (!recipientId) return res.status(400).json({ error: 'recipientId required' });
    const { rows } = await pool.query('SELECT channel_access_token FROM line_config WHERE id = 1');
    const token = rows[0]?.channel_access_token;
    if (!token) return res.status(400).json({ error: 'LINE token ยังไม่ได้ตั้งค่า' });
    const result = await lineSender.testConnection(token, recipientId);
    res.json(result);
  } catch (e) { routeError(res, e, 'POST /api/line-config/test'); }
});

// QR code for LINE OA friend-add (Phase B onboarding)
app.get('/api/line-config/qr', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT oa_basic_id FROM line_config WHERE id = 1');
    const basicId = rows[0]?.oa_basic_id?.trim();
    if (!basicId) return res.status(404).json({ error: 'oa_basic_id ยังไม่ได้ตั้งค่า' });
    const id = basicId.startsWith('@') ? basicId : '@' + basicId;
    const url = `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
    const png = await QRCode.toBuffer(url, { type: 'png', width: 200, margin: 2 });
    res.set('Content-Type', 'image/png').send(png);
  } catch (e) { routeError(res, e, 'GET /api/line-config/qr'); }
});

// ── LINE pending recipients (self-service onboarding Phase A) ─
app.get('/api/line/pending', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT line_id, source_type, display_name, avatar_url,
             first_seen_at, last_message_at, message_count, status
      FROM pending_recipients
      WHERE status = 'pending'
      ORDER BY last_message_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) { routeError(res, e, 'GET /api/line/pending'); }
});

app.post('/api/line/pending/:id/approve', auth.requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const lineId = String(req.params.id || '').trim();
    if (!lineId) return res.status(400).json({ error: 'line_id required' });
    await client.query('BEGIN');
    const pendingRes = await client.query(
      `SELECT * FROM pending_recipients WHERE line_id = $1 FOR UPDATE`, [lineId]
    );
    if (!pendingRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'pending recipient not found' });
    }
    const p = pendingRes.rows[0];
    const cfgRes = await client.query('SELECT recipients FROM line_config WHERE id = 1 FOR UPDATE');
    const recipients = Array.isArray(cfgRes.rows[0]?.recipients) ? cfgRes.rows[0].recipients : [];
    const name = String(req.body?.name || p.display_name || lineId).trim();
    const exists = recipients.some(r => r && r.id === lineId);
    const nextRecipients = exists
      ? recipients.map(r => r && r.id === lineId ? { ...r, type: p.source_type, name, enabled: r.enabled !== false } : r)
      : recipients.concat([{ id: lineId, type: p.source_type, name, enabled: true }]);
    await client.query(
      `UPDATE line_config SET recipients = $1::jsonb, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify(nextRecipients)]
    );
    await client.query(
      `UPDATE pending_recipients SET status = 'approved', display_name = $2 WHERE line_id = $1`,
      [lineId, name]
    );
    await client.query('COMMIT');
    pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
    await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_approve', null, null, getIP(req), req.headers['user-agent'], {
      line_id: lineId, source_type: p.source_type, display_name: name, existing: exists,
    });
    res.json({ success: true, recipient: { id: lineId, type: p.source_type, name, enabled: true } });
    // แจ้ง user ว่าถูก approved แล้ว (async, ไม่บล็อก response)
    pool.query('SELECT channel_access_token FROM line_config WHERE id = 1')
      .then(async ({ rows }) => {
        const token = rows[0]?.channel_access_token;
        if (!token) { console.warn('⚠️ approve notify: no token configured'); return; }
        const result = await lineSender.pushLineMessage(token, lineId, [{
          type: 'text',
          text: '✓ อนุมัติแล้ว\nคุณจะได้รับการแจ้งเตือนจากระบบกล้องวงจรปิดต่อไป\n\n✓ Approved\nYou will now receive CCTV system alerts.',
        }]);
        if (result.success) console.log(`✅ approve notify sent → ${lineId.slice(0, 8)}…`);
        else console.warn(`⚠️ approve notify push failed → ${lineId.slice(0, 8)}… : ${result.error}`);
      })
      .catch(e => console.warn('⚠️ approve notify push error:', e.message));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    routeError(res, e, 'POST /api/line/pending/:id/approve');
  } finally {
    client.release();
  }
});

app.post('/api/line/pending/:id/ignore', auth.requireAdmin, async (req, res) => {
  try {
    const lineId = String(req.params.id || '').trim();
    if (!lineId) return res.status(400).json({ error: 'line_id required' });
    const { rows } = await pool.query(
      `UPDATE pending_recipients SET status = 'ignored'
       WHERE line_id = $1 AND status = 'pending'
       RETURNING line_id, source_type, display_name`,
      [lineId]
    );
    if (!rows.length) return res.status(404).json({ error: 'pending recipient not found' });
    await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_ignore', null, null, getIP(req), req.headers['user-agent'], rows[0]);
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/line/pending/:id/ignore'); }
});

app.post('/api/line/pending/:id/block', auth.requireAdmin, async (req, res) => {
  try {
    const lineId = String(req.params.id || '').trim();
    if (!lineId) return res.status(400).json({ error: 'line_id required' });
    const { rows } = await pool.query(
      `UPDATE pending_recipients SET status = 'blocked'
       WHERE line_id = $1 AND status IN ('pending','ignored')
       RETURNING line_id, source_type, display_name`,
      [lineId]
    );
    if (!rows.length) return res.status(404).json({ error: 'recipient not found or already blocked' });
    await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_block', null, null, getIP(req), req.headers['user-agent'], rows[0]);
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/line/pending/:id/block'); }
});

app.post('/api/line/blocked/:id/unblock', auth.requireAdmin, async (req, res) => {
  try {
    const lineId = String(req.params.id || '').trim();
    if (!lineId) return res.status(400).json({ error: 'line_id required' });
    const { rows } = await pool.query(
      `UPDATE pending_recipients SET status = 'ignored'
       WHERE line_id = $1 AND status = 'blocked'
       RETURNING line_id, source_type, display_name`,
      [lineId]
    );
    if (!rows.length) return res.status(404).json({ error: 'blocked recipient not found' });
    await auth.logAudit(req.user?.id, req.user?.username, 'line_recipient_unblock', null, null, getIP(req), req.headers['user-agent'], rows[0]);
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'POST /api/line/blocked/:id/unblock'); }
});

app.get('/api/line/blocked', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT line_id, source_type, display_name, avatar_url, first_seen_at, last_message_at, message_count
       FROM pending_recipients WHERE status = 'blocked'
       ORDER BY last_message_at DESC`
    );
    res.json(rows);
  } catch (e) { routeError(res, e, 'GET /api/line/blocked'); }
});

// ── Alert Rules (CRUD) ──────────────────────────────────────
app.get('/api/alert-rules', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM alert_rules ORDER BY enabled DESC, id DESC');
    res.json(rows);
  } catch (e) { routeError(res, e, 'GET /api/alert-rules'); }
});

// "HH:MM" or "HH:MM:SS" → "HH:MM" (Postgres TIME accepts it); ''/null → null.
// Throws on malformed input so the route can return 400.
function normalizeTimeOfDay(v) {
  if (v == null || v === '') return null;
  const m = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(String(v).trim());
  if (!m) throw new Error('time must be HH:MM');
  const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) throw new Error('time out of range (00:00–23:59)');
  return `${m[1]}:${m[2]}`;
}

app.post('/api/alert-rules', async (req, res) => {
  try {
    const {
      name, enabled = true,
      camera_ids = [], rule_names = [], recipient_ids = [],
      cooldown_seconds = 60, send_snapshot = true, push_user_ids = [],
      message_template, active_from, active_to
    } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    let af, at;
    try { af = normalizeTimeOfDay(active_from); at = normalizeTimeOfDay(active_to); }
    catch (e) { return res.status(400).json({ error: 'active window: ' + e.message }); }
    // Default template: {camera} now renders the real camera name and
    // {location} the install location (line-sender.formatMessage).
    const tpl = message_template
      || '🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}\n👤 {object_class} ({likelihood})';
    const { rows } = await pool.query(
      `INSERT INTO alert_rules (name, enabled, camera_ids, rule_names, recipient_ids,
        cooldown_seconds, send_snapshot, push_user_ids, message_template, active_from, active_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name.trim(), enabled, camera_ids, rule_names, recipient_ids, cooldown_seconds, send_snapshot, push_user_ids, tpl, af, at]
    );
    pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
    res.json(rows[0]);
  } catch (e) { routeError(res, e, 'POST /api/alert-rules'); }
});

app.put('/api/alert-rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const fields = ['name', 'enabled', 'camera_ids', 'rule_names', 'recipient_ids',
                    'cooldown_seconds', 'send_snapshot', 'push_user_ids', 'message_template'];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${idx++}`);
        values.push(req.body[f]);
      }
    }
    // active_from / active_to need normalization (HH:MM, empty → NULL),
    // so they're handled outside the generic field loop.
    for (const f of ['active_from', 'active_to']) {
      if (req.body[f] !== undefined) {
        let v;
        try { v = normalizeTimeOfDay(req.body[f]); }
        catch (e) { return res.status(400).json({ error: `${f}: ${e.message}` }); }
        updates.push(`${f} = $${idx++}`);
        values.push(v);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
    pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
    res.json(rows[0]);
  } catch (e) { routeError(res, e, 'PUT /api/alert-rules/:id'); }
});

app.delete('/api/alert-rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query('DELETE FROM alert_rules WHERE id = $1', [id]);
    pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'DELETE /api/alert-rules/:id'); }
});

// ── Alert Logs (read + filter) ──────────────────────────────
app.get('/api/alert-logs', async (req, res) => {
  try {
    const { limit = 100, ruleId, cameraId, status, since } = req.query;
    const where = [];
    const values = [];
    let idx = 1;
    if (ruleId) { where.push(`rule_id = $${idx++}`); values.push(parseInt(ruleId)); }
    if (cameraId) { where.push(`camera_id = $${idx++}`); values.push(cameraId); }
    if (status) { where.push(`status = $${idx++}`); values.push(status); }
    if (since) { where.push(`sent_at >= $${idx++}`); values.push(since); }
    const sql = `SELECT * FROM alert_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sent_at DESC LIMIT $${idx}`;
    values.push(parseInt(limit));
    const { rows } = await pool.query(sql, values);
    res.json(rows);
  } catch (e) { routeError(res, e, 'GET /api/alert-logs'); }
});

app.get('/api/alert-logs/stats', async (req, res) => {
  try {
    const WINDOWS = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
    const win = WINDOWS[req.query.window] || '24 hours';
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='success')            AS success,
        COUNT(*) FILTER (WHERE status='failed')             AS failed,
        COUNT(*) FILTER (WHERE status='cooldown_skip')      AS cooldown_skip,
        COUNT(*) FILTER (WHERE status='quiet_hours_skip')   AS quiet_hours_skip,
        COUNT(*) FILTER (WHERE status='no_recipients')      AS no_recipients,
        COUNT(*) FILTER (WHERE status='disabled')           AS disabled,
        COUNT(*)                                            AS total,
        COALESCE(SUM(recipient_count) FILTER (WHERE status='success'), 0) AS line_messages_sent,
        ROUND(AVG(duration_ms) FILTER (WHERE status='success'))           AS avg_duration_ms
      FROM alert_logs
      WHERE sent_at >= NOW() - $1::INTERVAL`, [win]);
    const r = rows[0];
    const success = parseInt(r.success, 10);
    const failed  = parseInt(r.failed,  10);
    const denom   = success + failed;
    res.json({
      window:             req.query.window || '24h',
      success,
      failed,
      cooldown_skip:      parseInt(r.cooldown_skip,    10),
      quiet_hours_skip:   parseInt(r.quiet_hours_skip, 10),
      no_recipients:      parseInt(r.no_recipients,    10),
      disabled:           parseInt(r.disabled,         10),
      total:              parseInt(r.total,             10),
      line_messages_sent: parseInt(r.line_messages_sent, 10),
      avg_duration_ms:    r.avg_duration_ms ? parseInt(r.avg_duration_ms, 10) : null,
      success_rate:       denom > 0 ? Math.round(success / denom * 100) : null,
    });
  } catch (e) { routeError(res, e, 'GET /api/alert-logs/stats'); }
});

app.delete('/api/alert-logs', async (req, res) => {
  try {
    const { olderThanDays } = req.query;
    if (olderThanDays) {
      await pool.query(`DELETE FROM alert_logs WHERE sent_at < NOW() - ($1 * INTERVAL '1 day')`,
        [parseInt(olderThanDays, 10) || 90]);
    } else {
      await pool.query('TRUNCATE alert_logs');
    }
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'DELETE /api/alert-logs'); }
});

// ============================================================
// Report Schedules (Phase 7.3 — scheduled report delivery)
// ============================================================
// Scheduler loop lives in report-worker.js (separate PM2 process).
const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'health'];
const HEALTH_SECTION_KEYS = ['camera_status', 'camera_uptime', 'alerts', 'storage', 'system'];

function normalizeHealthSections(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  const expanded = [];
  for (const key of v) {
    if (key === 'cameras') expanded.push('camera_status', 'camera_uptime');
    else expanded.push(String(key));
  }
  const cleaned = [...new Set(expanded)].filter(k => HEALTH_SECTION_KEYS.includes(k));
  return cleaned.length ? cleaned : null;
}

app.get('/api/report-schedules', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM report_schedules ORDER BY id');
    res.json(rows);
  } catch (e) { routeError(res, e, 'GET /api/report-schedules'); }
});

// Phase 7.4 — day-of-week / day-of-month picker validators.
function normalizeSendDayOfWeek(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 6) {
    throw new Error('send_day_of_week must be 0..6 (0=Mon..6=Sun) or null');
  }
  return n;
}
function normalizeSendDaysOfMonth(v) {
  if (v === undefined || v === null || v === '') return null;
  const tokens = String(v).split(',').map(x => x.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const cleaned = [];
  for (const t of tokens) {
    if (t.toUpperCase() === 'L') { cleaned.push('L'); continue; }
    const n = parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      throw new Error('send_days_of_month tokens must be 1..31 or "L"');
    }
    cleaned.push(String(n));
  }
  // Dedupe + canonical order (numeric asc, L last) so the same selection
  // always stores the same string regardless of UI click order.
  const uniq = [...new Set(cleaned)];
  uniq.sort((a, b) => {
    if (a === 'L') return 1;
    if (b === 'L') return -1;
    return parseInt(a, 10) - parseInt(b, 10);
  });
  return uniq.join(',');
}

app.post('/api/report-schedules', async (req, res) => {
  try {
    const { report_type, enabled = true, send_time, recipients = '', image_layout = 'compact' } = req.body;
    if (!REPORT_TYPES.includes(report_type)) {
      return res.status(400).json({ error: 'report_type must be daily|weekly|monthly|health' });
    }
    const isHealth = report_type === 'health';
    const resolvedLayout = isHealth ? null : (image_layout || 'compact');
    if (!isHealth && !['compact', 'full'].includes(resolvedLayout)) {
      return res.status(400).json({ error: 'image_layout must be compact|full' });
    }
    let st;
    try { st = normalizeTimeOfDay(send_time); }
    catch (e) { return res.status(400).json({ error: 'send_time: ' + e.message }); }
    if (!st) return res.status(400).json({ error: 'send_time required' });
    let sdow, sdom;
    try {
      sdow = normalizeSendDayOfWeek(req.body.send_day_of_week);
      sdom = normalizeSendDaysOfMonth(req.body.send_days_of_month);
    } catch (e) { return res.status(400).json({ error: e.message }); }
    const healthSections = isHealth ? normalizeHealthSections(req.body.health_sections) : null;
    const { rows } = await pool.query(
      `INSERT INTO report_schedules (report_type, enabled, send_time, recipients, image_layout,
                                     send_day_of_week, send_days_of_month, health_sections)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [report_type, !!enabled, st, String(recipients || '').trim(), resolvedLayout, sdow, sdom, healthSections ? JSON.stringify(healthSections) : null]
    );
    res.json(rows[0]);
  } catch (e) { routeError(res, e, 'POST /api/report-schedules'); }
});

app.put('/api/report-schedules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates = [];
    const values = [];
    let idx = 1;
    if (req.body.report_type !== undefined) {
      if (!REPORT_TYPES.includes(req.body.report_type)) {
        return res.status(400).json({ error: 'report_type must be daily|weekly|monthly|health' });
      }
      updates.push(`report_type = $${idx++}`); values.push(req.body.report_type);
    }
    if (req.body.enabled !== undefined) {
      updates.push(`enabled = $${idx++}`); values.push(!!req.body.enabled);
    }
    if (req.body.send_time !== undefined) {
      let st;
      try { st = normalizeTimeOfDay(req.body.send_time); }
      catch (e) { return res.status(400).json({ error: 'send_time: ' + e.message }); }
      if (!st) return res.status(400).json({ error: 'send_time cannot be empty' });
      updates.push(`send_time = $${idx++}`); values.push(st);
    }
    if (req.body.recipients !== undefined) {
      updates.push(`recipients = $${idx++}`); values.push(String(req.body.recipients || '').trim());
    }
    if (req.body.image_layout !== undefined && req.body.image_layout !== null) {
      if (!['compact', 'full'].includes(req.body.image_layout)) {
        return res.status(400).json({ error: 'image_layout must be compact|full' });
      }
      updates.push(`image_layout = $${idx++}`); values.push(req.body.image_layout);
    }
    if (req.body.health_sections !== undefined) {
      const hs = normalizeHealthSections(req.body.health_sections);
      updates.push(`health_sections = $${idx++}`); values.push(hs ? JSON.stringify(hs) : null);
    }
    if (req.body.send_day_of_week !== undefined) {
      let sdow;
      try { sdow = normalizeSendDayOfWeek(req.body.send_day_of_week); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      updates.push(`send_day_of_week = $${idx++}`); values.push(sdow);
    }
    if (req.body.send_days_of_month !== undefined) {
      let sdom;
      try { sdom = normalizeSendDaysOfMonth(req.body.send_days_of_month); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      updates.push(`send_days_of_month = $${idx++}`); values.push(sdom);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE report_schedules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'schedule not found' });
    res.json(rows[0]);
  } catch (e) { routeError(res, e, 'PUT /api/report-schedules/:id'); }
});

app.delete('/api/report-schedules/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM report_schedules WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { routeError(res, e, 'DELETE /api/report-schedules/:id'); }
});

// POST /api/report-schedules/:id/run — manual "run now"
// api-server owns the 404 check; proxies to report-worker (fire-and-forget inside worker).
app.post('/api/report-schedules/:id/run', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query('SELECT * FROM report_schedules WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Schedule not found' });

    await new Promise((resolve, reject) => {
      const workerReq = http.request(
        { host: '127.0.0.1', port: WORKER_PORT, path: `/run/${id}`, method: 'POST',
          headers: { 'X-Internal-Token': INTERNAL_API_TOKEN }, timeout: 5000 },
        (workerRes) => {
          workerRes.resume();
          if (workerRes.statusCode === 200) resolve();
          else reject(Object.assign(new Error(`worker ${workerRes.statusCode}`), { workerStatus: workerRes.statusCode }));
        }
      );
      workerReq.on('timeout', () => {
        workerReq.destroy();
        reject(Object.assign(new Error('worker timeout'), { workerStatus: 503 }));
      });
      workerReq.on('error', (e) => reject(Object.assign(e, { workerStatus: 503 })));
      workerReq.end();
    });

    res.json({ ok: true });
  } catch (e) {
    if (e.workerStatus === 503) {
      return res.status(503).json({ error: 'Report worker is not available — try again shortly' });
    }
    routeError(res, e, 'POST /api/report-schedules/:id/run');
  }
});

// GET /api/report-history/stats — aggregate counts for summary strip
app.get('/api/report-history/stats', async (req, res) => {
  try {
    const WINDOWS = { '30d': '30 days', '90d': '90 days' };
    const win = WINDOWS[req.query.window];
    const whereClause = win ? `WHERE created_at >= NOW() - $1::INTERVAL` : '';
    const values = win ? [win] : [];
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                               AS total,
        COUNT(*) FILTER (WHERE status='success')              AS success,
        COUNT(*) FILTER (WHERE status<>'success')             AS failed,
        COALESCE(SUM(sent_count) FILTER (WHERE status='success'), 0) AS total_recipients_sent,
        COUNT(*) FILTER (WHERE report_type='daily')           AS type_daily,
        COUNT(*) FILTER (WHERE report_type='weekly')          AS type_weekly,
        COUNT(*) FILTER (WHERE report_type='monthly')         AS type_monthly,
        COUNT(*) FILTER (WHERE report_type='health')          AS type_health
      FROM report_history ${whereClause}`, values);
    const r = rows[0];
    const success = parseInt(r.success, 10);
    const failed  = parseInt(r.failed,  10);
    const denom   = success + failed;
    res.json({
      window:                req.query.window || 'all',
      total:                 parseInt(r.total,                  10),
      success,
      failed,
      success_rate:          denom > 0 ? Math.round(success / denom * 100) : null,
      total_recipients_sent: parseInt(r.total_recipients_sent, 10),
      by_type: {
        daily:   parseInt(r.type_daily,   10),
        weekly:  parseInt(r.type_weekly,  10),
        monthly: parseInt(r.type_monthly, 10),
        health:  parseInt(r.type_health,  10),
      },
    });
  } catch (e) { routeError(res, e, 'GET /api/report-history/stats'); }
});

// GET /api/report-history — Ph.2 Report History list (paginated)
app.get('/api/report-history', async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const { rows } = await pool.query(
      `SELECT rh.*, rs.report_type AS schedule_type
       FROM report_history rh
       LEFT JOIN report_schedules rs ON rs.id = rh.schedule_id
       ORDER BY rh.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: cnt } = await pool.query('SELECT COUNT(*) FROM report_history');
    res.json({ items: rows, total: parseInt(cnt[0].count) });
  } catch (e) { routeError(res, e, 'GET /api/report-history'); }
});

// GET /api/report-history/:id/image — stream PNG file (Ph.2)
app.get('/api/report-history/:id/image', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT file_path FROM report_history WHERE id = $1', [parseInt(req.params.id)]
    );
    if (!rows.length || !rows[0].file_path) return res.status(404).json({ error: 'Not found' });
    const full = path.join(REPORTS_DIR, rows[0].file_path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File not found on disk' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].file_path}"`);
    fs.createReadStream(full).pipe(res);
  } catch (e) { routeError(res, e, 'GET /api/report-history/:id/image'); }
});

// Brand info for report headers — read straight from system_settings.
async function getBrandForReport() {
  const b = {};
  try {
    const r = await pool.query("SELECT key, value FROM system_settings WHERE key LIKE 'brand_%'");
    for (const row of r.rows) {
      if (row.key === 'brand_name')          b.name = row.value;
      if (row.key === 'brand_primary_color') b.primary_color = row.value;
      if (row.key === 'brand_logo_path' && row.value) {
        b.logo_url = `http://localhost:${PORT}/branding/${row.value}`;
      }
    }
  } catch { /* defaults */ }
  return b;
}

const REPORT_TITLE_TH = {
  daily: 'รายงานประจำวัน', weekly: 'รายงานรายสัปดาห์', monthly: 'รายงานรายเดือน',
  health: 'รายงานสุขภาพระบบ',
};

// GET /api/reports/pdf?type=daily|weekly|monthly  (or explicit &from=&to=)
//                     [&cameras=csv][&title=...][&label=...][&download=1]
// Returns the report as an application/pdf stream. Used for on-demand
// download/preview; the scheduler calls renderReportPdf directly below.
// Custom title/label override the type-derived defaults — sent by the web
// "ดาวน์โหลด PDF" button so the PDF matches the page's active range view.
app.get('/api/reports/pdf', async (req, res) => {
  try {
    const reportRenderer = require('./report-renderer');
    const type = REPORT_TYPES.includes(req.query.type) ? req.query.type : 'daily';
    let { from, to } = req.query;
    let rangeLabel = req.query.label;
    if (from && to) {
      if (!rangeLabel) rangeLabel = `${new Date(from).toLocaleDateString('th-TH')} – ${new Date(to).toLocaleDateString('th-TH')}`;
    } else {
      const r = reportRenderer.computeScheduledRange(type);
      from = r.from; to = r.to; rangeLabel = rangeLabel || r.label;
    }
    const cameras = req.query.cameras
      ? String(req.query.cameras).split(',').map(s => s.trim()).filter(Boolean)
      : null;
    const pdf = await reportRenderer.renderReportPdf({
      baseUrl: `http://localhost:${PORT}`,
      internalToken: INTERNAL_API_TOKEN,
      from, to, cameras,
      brand: await getBrandForReport(),
      title: req.query.title || REPORT_TITLE_TH[type],
      rangeLabel,
    });
    const disposition = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="report-${type}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('📅 /api/reports/pdf failed:', e.message);
    res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
  }
});

// ── Scheduler loop moved to report-worker.js ──────────────
// runScheduledReport / checkReportSchedules / date helpers / setInterval
// now live in src/report-worker.js (separate PM2 process).
// This isolates Puppeteer crashes from api-server.

// ── LINE Webhook (รับ User ID จากคนที่แอด OA + ส่งข้อความ) ──
// express.json() stores req.rawBody above because HMAC-SHA256 must use raw bytes.
app.post('/api/line/webhook', async (req, res) => {
  try {
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})));
    // ── Signature verification ──────────────────────────────────
    // LINE ส่ง Base64(HMAC-SHA256(rawBody, channel_secret)) มาใน x-line-signature
    // ถ้าไม่มี / ผิด → reject 400 (LINE จะ retry — แต่ 400 หยุด retry ทันที)
    const sig = req.headers['x-line-signature'];
    const cfgRes = await pool.query('SELECT channel_access_token, channel_secret FROM line_config WHERE id = 1');
    const cfg = cfgRes.rows[0] || {};
    if (cfg.channel_secret) {
      if (!sig) {
        console.warn('🔔 LINE webhook: missing signature — rejected');
        return res.status(400).json({ error: 'missing signature' });
      }
      const expected = require('crypto')
        .createHmac('sha256', cfg.channel_secret)
        .update(rawBody)
        .digest('base64');
      if (sig !== expected) {
        console.warn('🔔 LINE webhook: invalid signature — rejected');
        return res.status(400).json({ error: 'invalid signature' });
      }
    }
    // ── Parse JSON from raw buffer ──────────────────────────────
    const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    const events = body.events || [];
    for (const ev of events) {
      const sourceType = ev.source?.type; // 'user' | 'group' | 'room'
      const senderId = sourceType === 'group'
        ? ev.source?.groupId
        : sourceType === 'room'
          ? ev.source?.roomId
          : ev.source?.userId;
      if (!senderId || !['user', 'group', 'room'].includes(sourceType)) continue;

      if (ev.type === 'message' || ev.type === 'follow' || ev.type === 'join') {
        let profile = null;
        if (cfg.channel_access_token && sourceType === 'user') {
          profile = await lineSender.getLineUserProfile(cfg.channel_access_token, senderId);
        } else if (cfg.channel_access_token && sourceType === 'group') {
          profile = await lineSender.getLineGroupSummary(cfg.channel_access_token, senderId);
        }
        const displayName = profile?.displayName || profile?.groupName || null;
        const avatarUrl = profile?.pictureUrl || null;
        const upsertRes = await pool.query(`
          WITH prev AS (SELECT status AS old_status FROM pending_recipients WHERE line_id = $1)
          INSERT INTO pending_recipients
            (line_id, source_type, display_name, avatar_url, first_seen_at, last_message_at, message_count, status)
          VALUES ($1, $2, $3, $4, NOW(), NOW(), 1, 'pending')
          ON CONFLICT (line_id) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            display_name = COALESCE(EXCLUDED.display_name, pending_recipients.display_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, pending_recipients.avatar_url),
            last_message_at = NOW(),
            message_count = pending_recipients.message_count + 1,
            status = CASE
              WHEN pending_recipients.status = 'approved' THEN 'approved'
              WHEN pending_recipients.status = 'blocked'  THEN 'blocked'
              ELSE 'pending'
            END
          RETURNING (xmax = 0) AS inserted, status, (SELECT old_status FROM prev) AS prev_status
        `, [senderId, sourceType, displayName, avatarUrl]);
        const row = upsertRes.rows[0] || {};
        console.log(`🔔 LINE webhook: recipient ${sourceType} ${senderId.slice(0, 6)}… → ${row.status || 'pending'} via ${ev.type}`);
        // ส่ง reply ถ้า: user ใหม่ (inserted) หรือ status เพิ่งเปลี่ยนมาเป็น pending (เช่น deleted user ทักกลับ)
        const shouldReply = row.status === 'pending' && (row.inserted || row.prev_status !== 'pending');
        if (shouldReply && cfg.channel_access_token && ev.replyToken) {
          await lineSender.replyLineMessage(cfg.channel_access_token, ev.replyToken, [{
            type: 'text',
            text: '✓ ลงทะเบียนแล้ว รอแอดมินอนุมัติ\nRegistration received. Waiting for admin approval.',
          }]);
        }

      } else if (ev.type === 'leave' || ev.type === 'unfollow') {
        // Phase C: group/room leave หรือ user unfollow → disable recipient + clear pending
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Disable in line_config.recipients (JSONB array)
          const cfgRow = await client.query('SELECT recipients FROM line_config WHERE id = 1 FOR UPDATE');
          const recipients = Array.isArray(cfgRow.rows[0]?.recipients) ? cfgRow.rows[0].recipients : [];
          const updated = recipients.map(r => r && r.id === senderId ? { ...r, enabled: false } : r);
          const changed = updated.some((r, i) => r.enabled !== recipients[i]?.enabled);
          if (changed) {
            await client.query(
              `UPDATE line_config SET recipients = $1::jsonb, updated_at = NOW() WHERE id = 1`,
              [JSON.stringify(updated)]
            );
          }
          // Mark pending row as ignored (if still pending)
          await client.query(
            `UPDATE pending_recipients SET status = 'ignored'
             WHERE line_id = $1 AND status = 'pending'`,
            [senderId]
          );
          await client.query('COMMIT');
          if (changed) pool.query(`SELECT pg_notify('alert_rules_changed', '')`).catch(() => {});
          console.log(`🔔 LINE webhook: ${ev.type} ${sourceType} ${senderId.slice(0, 6)}… → disabled in recipients (changed=${changed})`);
        } catch (leaveErr) {
          await client.query('ROLLBACK').catch(() => {});
          console.error('🔔 LINE webhook leave/unfollow error:', leaveErr.message);
        } finally {
          client.release();
        }
      }
    }
    res.status(200).end();
  } catch (e) {
    console.error('🔔 Webhook error:', e.message);
    res.status(200).end(); // ต้อง return 200 เสมอ ไม่งั้น LINE retry
  }
});

// ── Helper: ดึง rule_names ที่มีใน DB (สำหรับ UI dropdown) ─
app.get('/api/alert-rules-suggestions', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT rule_name FROM events
      WHERE rule_name IS NOT NULL AND rule_name != ''
        AND event_time > NOW() - INTERVAL '30 days'
      ORDER BY rule_name
    `);
    res.json(rows.map(r => r.rule_name));
  } catch (e) { routeError(res, e, 'GET /api/alert-rules-suggestions'); }
});

// ============================================================
// API: Face Capture gallery (Phase MV.3b)
// ============================================================
// Hikvision Face Capture events (event_type='FaceCapture') with the
// face attributes the ingester flattened into raw_json. Powers the
// "ภาพใบหน้า" page — paginated, filterable by gender / age band / mask.
// Shared WHERE builder for the face endpoints — filters on the
// raw_json face attributes + camera + event_time range. Returns the
// clause string, the params array, and the next free placeholder index.
function _buildFaceFilter(q) {
  const clauses = [`event_type = 'FaceCapture'`];
  const params = [];
  let n = 0;
  const eq = (col, val) => { clauses.push(`${col} = $${++n}`); params.push(val); };
  if (q.gender)     eq(`raw_json->>'gender'`, q.gender);
  if (q.mask)       eq(`raw_json->>'mask'`, q.mask);
  if (q.glass)      eq(`raw_json->>'glass'`, q.glass);
  if (q.hat)        eq(`raw_json->>'hat'`, q.hat);
  if (q.expression) eq(`raw_json->>'faceExpression'`, q.expression);
  if (q.camera)     eq(`camera_id`, q.camera);
  if (q.age_min) { clauses.push(`(raw_json->>'age')::int >= $${++n}`); params.push(parseInt(q.age_min, 10)); }
  if (q.age_max) { clauses.push(`(raw_json->>'age')::int <= $${++n}`); params.push(parseInt(q.age_max, 10)); }
  if (q.from)    { clauses.push(`event_time >= $${++n}`); params.push(q.from); }
  if (q.to)      { clauses.push(`event_time <= $${++n}`); params.push(q.to); }
  return { where: clauses.join(' AND '), params, n };
}

app.get('/api/faces', async (req, res) => {
  const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10)  || 60));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    const f = _buildFaceFilter(req.query);
    let n = f.n;
    const sql = `
      SELECT id, event_time, camera_id,
             raw_json->>'_snapshot'      AS snapshot,
             raw_json->>'_snapshot_full' AS snapshot_full,
             raw_json->>'age'            AS age,
             raw_json->>'ageGroup'       AS age_group,
             raw_json->>'gender'         AS gender,
             raw_json->>'faceExpression' AS expression,
             raw_json->>'glass'          AS glass,
             raw_json->>'mask'           AS mask,
             raw_json->>'hat'            AS hat,
             raw_json->>'stayDuration'   AS stay_duration,
             raw_json->>'faceScore'      AS face_score,
             raw_json->'faceRect'        AS face_rect,
             clip_file, clip_status,
             COUNT(*) OVER() ::int       AS _total
        FROM events
       WHERE ${f.where}
       ORDER BY event_time DESC
       LIMIT $${++n} OFFSET $${++n}`;
    const params = [...f.params, limit, offset];
    const r = await pool.query(sql, params);
    const total = r.rows[0] ? r.rows[0]._total : 0;
    res.set('X-Total-Count', String(total));
    res.json(r.rows.map(row => {
      const { _total, ...rest } = row;
      return rest;
    }));
  } catch (err) {
    routeError(res, err, 'GET /api/faces');
  }
});

// Demographic summary for the Face page header — same filters as
// /api/faces, aggregated: gender split, age bands, mask count.
app.get('/api/faces/summary', async (req, res) => {
  try {
    const f = _buildFaceFilter(req.query);
    const r = await pool.query(`
      SELECT
        COUNT(*)::int                                                         AS total,
        COUNT(*) FILTER (WHERE raw_json->>'gender'='male')::int                AS male,
        COUNT(*) FILTER (WHERE raw_json->>'gender'='female')::int              AS female,
        COUNT(*) FILTER (WHERE raw_json->>'mask'='yes')::int                   AS masked,
        COUNT(*) FILTER (WHERE (raw_json->>'age')::int <= 19)::int             AS age_teen,
        COUNT(*) FILTER (WHERE (raw_json->>'age')::int BETWEEN 20 AND 39)::int  AS age_young,
        COUNT(*) FILTER (WHERE (raw_json->>'age')::int BETWEEN 40 AND 59)::int  AS age_mid,
        COUNT(*) FILTER (WHERE (raw_json->>'age')::int >= 60)::int             AS age_senior
      FROM events WHERE ${f.where}`, f.params);
    res.json(r.rows[0] || {});
  } catch (err) {
    routeError(res, err, 'GET /api/faces/summary');
  }
});

// ============================================================
// API: Live Snapshot Proxy
// ============================================================

// Hikvision ISAPI snapshot proxy — the picture endpoint rejects Basic
// auth, so this does the HTTP Digest two-step (401 challenge → hashed
// retry) and pipes the JPEG through. Same algorithm as the digest
// helper in src/ingesters/hikvision-isapi.js — kept inline for the MVP;
// the MV.2 plugin refactor is the right time to extract a shared lib.
function _hikDigestSnapshot(host, port, uri, user, pass, res, sendError, resizeW) {
  const crypto = require('crypto');
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const attempt = (authHeader) => {
    const headers = {};
    if (authHeader) headers.Authorization = authHeader;
    const r = http.get({ host, port, path: uri, headers, timeout: 5000 }, (pr) => {
      if (pr.statusCode === 401 && !authHeader) {
        const wa = pr.headers['www-authenticate'] || '';
        pr.resume();
        if (!/digest/i.test(wa)) {
          // Some generic ONVIF cameras challenge with Basic instead of
          // Digest — honour that rather than failing.
          if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          return sendError(502, 'Camera 401 — no supported auth challenge');
        }
        const ch = {};
        for (const m of wa.replace(/^Digest\s+/i, '')
                          .matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
          ch[m[1]] = m[2] !== undefined ? m[2] : m[3];
        }
        const cnonce = crypto.randomBytes(8).toString('hex');
        const nc = '00000001';
        const qop = ch.qop ? ch.qop.split(',')[0].trim() : null;
        const ha1 = md5(`${user}:${ch.realm}:${pass}`);
        const ha2 = md5(`GET:${uri}`);
        const resp = qop
          ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
          : md5(`${ha1}:${ch.nonce}:${ha2}`);
        let h = `Digest username="${user}", realm="${ch.realm}", `
              + `nonce="${ch.nonce}", uri="${uri}", response="${resp}"`;
        if (ch.opaque) h += `, opaque="${ch.opaque}"`;
        if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
        return attempt(h);
      }
      if (pr.statusCode !== 200) { pr.resume(); return sendError(502, `Camera returned ${pr.statusCode}`); }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      if (resizeW) {
        const t = jpegResizer(resizeW);
        t.on('error', () => { try { res.end(); } catch {} });
        pr.pipe(t).pipe(res);
      } else {
        pr.pipe(res);
      }
      pr.on('error', () => res.end());
    });
    r.on('error', (e) => sendError(502, e.message));
    r.on('timeout', () => { r.destroy(); sendError(504, 'Timeout'); });
  };
  attempt(null);
}

app.get('/api/snapshot/live/:cameraId', async (req, res) => {
  const { cameraId } = req.params;
  const config = loadCameraConfig();
  const cam = (config.cameras || []).find(c => c.camera_id === cameraId);
  if (!cam || !cam.ip_address) return res.status(404).json({ error: 'Camera IP not configured' });

  // Phase 6.1.4 — honor per-camera VCA overlay toggle for the Live snapshot proxy too
  let withOverlay = true;   // default true (preserves prior visual behaviour)
  try {
    const r = await pool.query(
      `SELECT enable_snapshot, enable_vca_overlay, paused FROM cameras WHERE id=$1`,
      [cameraId]
    );
    if (r.rows[0]) {
      if (r.rows[0].paused === true) {
        return res.status(503).json({ error: 'Camera paused for maintenance', paused: true });
      }
      if (r.rows[0].enable_snapshot === false) {
        return res.status(403).json({ error: 'Snapshot disabled for this camera' });
      }
      withOverlay = r.rows[0].enable_vca_overlay !== false;
    }
  } catch {}

  // Helper: ส่ง response ครั้งเดียวเท่านั้น (กัน ERR_HTTP_HEADERS_SENT)
  let responseSent = false;
  const sendError = (status, msg) => {
    if (responseSent || res.headersSent) return;
    responseSent = true;
    res.status(status).json({ error: msg });
  };

  const vendor = String(cam.vendor || 'bosch').toLowerCase();
  const port = cam.http_port || 80;
  // ?w=N → resize the live frame in-flight (Camera Status grid asks
  // for a small thumbnail; the "view full" path omits ?w).
  const resizeW = thumbWidth(req.query.w);

  if (vendor === 'hikvision') {
    // Pick the ISAPI channel by the requested size:
    //  - small thumbnail (grid ?w<=400, detail hero ?w=640) → the
    //    sub-stream (channel 102, ~720p): the 4K main is ~700KB/frame
    //    and several Camera Status cards at once would stall the page.
    //  - "view full" (large ?w, or no ?w) → the main / snapshot_stream
    //    channel so the requested resolution actually EXISTS.
    // Hard-coding channel 102 here previously capped the "view full"
    // button + the per-camera full_view_width at 720p regardless of
    // the camera settings.
    const big = !resizeW || resizeW > 640;
    const ch  = big ? (parseInt(cam.snapshot_stream, 10) || 1) : 2;
    const uri = `/ISAPI/Streaming/channels/10${ch}/picture`;
    _hikDigestSnapshot(cam.ip_address, port, uri,
      cam.username || '', cam.password || '', res, sendError, resizeW);
    return;
  }

  if (vendor === 'dahua') {
    // Dahua CGI snapshot — digest auth. The default path covers most
    // single-channel models; snapshot_path overrides for NVR / multi-channel.
    const uri = cam.snapshot_path || '/cgi-bin/snapshot.cgi?channel=1';
    _hikDigestSnapshot(cam.ip_address, port, uri,
      cam.username || '', cam.password || '', res, sendError, resizeW);
    return;
  }

  if (vendor === 'onvif') {
    // Generic ONVIF / monitor-only — the still-image URL varies per model,
    // so the operator supplies snapshot_path. _hikDigestSnapshot handles
    // both Digest and Basic auth challenges.
    if (!cam.snapshot_path) {
      return sendError(400, 'ONVIF camera: ตั้งค่า Snapshot URL Path ในหน้าตั้งค่ากล้องก่อน');
    }
    _hikDigestSnapshot(cam.ip_address, port, cam.snapshot_path,
      cam.username || '', cam.password || '', res, sendError, resizeW);
    return;
  }

  // Bosch: snap.jpg endpoint, Basic auth. JpegSize omitted → the camera
  // returns its NATIVE resolution (was hard-coded 1280x720, which capped
  // the "view full" button); the ?w=N resize below scales it down for
  // grid / modal thumbnails server-side.
  const url = `http://${cam.ip_address}:${port}/snap.jpg${withOverlay ? '?VCAOverlay=1' : ''}`;
  const options = { timeout: 5000, headers: {} };
  if (cam.username && cam.password) {
    options.headers['Authorization'] = 'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
  }

  const proxyReq = http.get(url, options, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      proxyRes.resume(); // drain response
      return sendError(502, `Camera returned ${proxyRes.statusCode}`);
    }
    if (responseSent) { proxyRes.resume(); return; }
    responseSent = true;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache');
    if (resizeW) {
      const t = jpegResizer(resizeW);
      t.on('error', () => { try { res.end(); } catch {} });
      proxyRes.pipe(t).pipe(res);
    } else {
      proxyRes.pipe(res);
    }
    proxyRes.on('error', () => res.end());
  });
  proxyReq.on('error', (err) => sendError(502, err.message));
  proxyReq.on('timeout', () => { proxyReq.destroy(); sendError(504, 'Timeout'); });
});

// ============================================================
// API: Reports
// ============================================================

app.get('/api/reports/daily', async (req, res) => {
  const { date = new Date().toISOString().split('T')[0] } = req.query;
  try {
    const summary = await pool.query(`
      SELECT camera_id, event_category, event_type, object_class, COUNT(*)::int AS total
      FROM events WHERE DATE(event_time) = $1
      GROUP BY camera_id, event_category, event_type, object_class
      ORDER BY camera_id, total DESC
    `, [date]);

    const totals = await pool.query(`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(DISTINCT camera_id)::int AS active_cameras,
        COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
        COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles
      FROM events WHERE DATE(event_time) = $1
    `, [date]);

    res.json({ date, totals: totals.rows[0], summary: summary.rows });
  } catch (err) { routeError(res, err, 'GET /api/reports/daily'); }
});

app.get('/api/reports/weekly', async (req, res) => {
  const { endDate = new Date().toISOString().split('T')[0] } = req.query;
  try {
    const daily = await pool.query(`
      SELECT DATE(event_time) AS date,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
        COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles
      FROM events
      WHERE event_time >= ($1::date - INTERVAL '6 days') AND event_time < ($1::date + INTERVAL '1 day')
      GROUP BY DATE(event_time) ORDER BY date
    `, [endDate]);

    const byCamera = await pool.query(`
      SELECT camera_id, COUNT(*)::int AS total FROM events
      WHERE event_time >= ($1::date - INTERVAL '6 days') AND event_time < ($1::date + INTERVAL '1 day')
      GROUP BY camera_id ORDER BY total DESC
    `, [endDate]);

    const totals = await pool.query(`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(DISTINCT camera_id)::int AS active_cameras,
        COUNT(*) FILTER (WHERE object_class = 'Person')::int AS persons,
        COUNT(*) FILTER (WHERE object_class IN ('Car','Truck','Vehicle','Bicycle'))::int AS vehicles
      FROM events
      WHERE event_time >= ($1::date - INTERVAL '6 days') AND event_time < ($1::date + INTERVAL '1 day')
    `, [endDate]);

    res.json({ endDate, totals: totals.rows[0], daily: daily.rows, byCamera: byCamera.rows });
  } catch (err) { routeError(res, err, 'GET /api/reports/weekly'); }
});

// ============================================================
// Stats v2 — category-aware aggregation
// ============================================================

// helpers --------------------------------------------------
function parseRange(q) {
  // Accept (a) explicit from/to ISO  (b) range= "1h"|"1d"|"7d"|"30d"
  let to   = q.to   ? new Date(q.to)   : new Date();
  let from = q.from ? new Date(q.from) : null;
  if (!from) {
    const r = q.range || '1d';
    const map = { '1h': 3600e3, '1d': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
    from = new Date(to.getTime() - (map[r] || map['1d']));
  }
  return { from, to };
}

function pickTruncUnit(fromMs, toMs) {
  const spanH = (toMs - fromMs) / 3600e3;
  if (spanH <= 48)  return 'hour';
  if (spanH <= 24 * 60) return 'day';   // up to 60 days
  return 'week';
}

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

// GET /api/events/facets — distinct rule_name + event_type values seen in events
// Used by the mapping rule editor to suggest values from real data.
app.get('/api/events/facets', async (req, res) => {
  try {
    const params = [];
    // Base WHERE always includes the metric-event filter so dropdowns don't
    // get polluted with CountAggregation rule names like 'คนในพื้นที่ทั้งหมด'.
    let where = ` WHERE event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'`;
    if (req.query.camera_id) {
      params.push(req.query.camera_id);
      where += ` AND camera_id = $${params.length}`;
    }
    const [rules, types, classes] = await Promise.all([
      pool.query(`SELECT DISTINCT rule_name AS v FROM events${where}
                    AND rule_name IS NOT NULL AND rule_name <> ''
                  ORDER BY v LIMIT 500`, params),
      pool.query(`SELECT DISTINCT event_type AS v FROM events${where}
                    AND event_type IS NOT NULL AND event_type <> ''
                  ORDER BY v LIMIT 500`, params),
      pool.query(`SELECT DISTINCT object_class AS v FROM events${where}
                    AND object_class IS NOT NULL AND object_class <> ''
                  ORDER BY v LIMIT 200`, params),
    ]);
    res.json({
      rule_names:     rules.rows.map(r => r.v),
      event_types:    types.rows.map(r => r.v),
      object_classes: classes.rows.map(r => r.v),    // Phase 6.1.8 — DB-driven class facet
    });
  } catch (err) { routeError(res, err, 'GET /api/events/facets'); }
});

// GET /api/events/:id/appearance — IVA Pro appearance attributes for a single event
// Returns the appearances row for this event_id, or null if none exists.
// Used by the Events modal to conditionally render the appearance section.
app.get('/api/events/:id/appearance', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT gender, hair_length, hair_color_xyz, hair_color,
              top_category, top_color_xyz, upper_color,
              bottom_category, bottom_color_xyz, lower_color,
              glasses, bag_category,
              helmet_wear, helmet_subtype,
              overall_color, overall_color_xyz, color_clusters
       FROM appearances WHERE event_id = $1 LIMIT 1`,
      [req.params.id]
    );
    res.json(rows[0] || null);
  } catch (err) { routeError(res, err, 'GET /api/events/:id/appearance'); }
});

// GET /api/events/:id/dwell — zone dwell duration for a single enter event.
// จับคู่กับ event 'false' ตัวแรกของ (camera, rule) เดียวกันหลังเวลานี้
// (semantics เดียวกับ /api/stats/dwell — ตัดคู่ห่างเกิน 24 ชม.)
// คืน null เมื่อ event ไม่ใช่ FieldDetector enter หรือยังไม่มีขาออก.
// หมายเหตุ: ไม่มี object identity ใน payload → ค่าคือ "ช่วงที่โซนมีคนอยู่"
// ไม่ใช่ระยะเวลาของ object รายตัว
app.get('/api/events/:id/dwell', async (req, res) => {
  try {
    const { rows: ev } = await pool.query(
      `SELECT camera_id, rule_name, event_type, event_state, event_time
       FROM events WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const e = ev[0];
    if (!e || e.event_type !== 'FieldDetector/ObjectsInside' || e.event_state !== 'true') {
      return res.json(null);
    }
    const { rows: ex } = await pool.query(
      `SELECT event_time AS exit_time
       FROM events
       WHERE camera_id = $1 AND rule_name = $2
         AND event_type = 'FieldDetector/ObjectsInside'
         AND event_state = 'false'
         AND event_time > $3
         AND event_time <= $3::timestamptz + INTERVAL '24 hours'
       ORDER BY event_time ASC LIMIT 1`,
      [e.camera_id, e.rule_name, e.event_time]
    );
    if (!ex[0]) return res.json({ dwell_sec: null, exit_time: null });  // ยังไม่ปิด
    const dwellSec = Math.round((new Date(ex[0].exit_time) - new Date(e.event_time)) / 1000);
    res.json({ dwell_sec: dwellSec, exit_time: ex[0].exit_time });
  } catch (err) { routeError(res, err, 'GET /api/events/:id/dwell'); }
});

// GET /api/appearances/stats?from=ISO&to=ISO[&camera_id=]
// Returns aggregated appearance data for the stats panel.
// One endpoint, not six — mirrors /api/stats/categories pattern.
app.get('/api/appearances/stats', async (req, res) => {
  try {
    const { from, to, camera_id } = req.query;
    const _cacheKey = `${from||''}|${to||''}|${camera_id||''}`;
    const _now = Date.now();
    if (_appStatsCache && _appStatsCacheKey === _cacheKey && _now - _appStatsCacheAt < APP_STATS_TTL_MS) {
      return res.json(_appStatsCache);
    }

    const tz = await getDisplayTz();
    const where = [], args = [];
    if (camera_id) { args.push(camera_id); where.push(`a.camera_id = $${args.length}`); }
    if (from)      { args.push(from);      where.push(`e.event_time >= $${args.length}`); }
    if (to)        { args.push(to);        where.push(`e.event_time <= $${args.length}`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    args.push(tz);
    const tzIdx = args.length;

    const [genderR, topR, botR, colorR, hairColorR, hairLenR, accessR, volumeR] = await Promise.all([
      pool.query(`SELECT gender, count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause} AND gender IS NOT NULL GROUP BY gender ORDER BY n DESC`, args.slice(0, -1)),
      pool.query(`SELECT top_category, count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause} AND top_category IS NOT NULL
        GROUP BY top_category ORDER BY n DESC LIMIT 8`, args.slice(0, -1)),
      pool.query(`SELECT bottom_category, count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause} AND bottom_category IS NOT NULL
        GROUP BY bottom_category ORDER BY n DESC LIMIT 8`, args.slice(0, -1)),
      pool.query(`SELECT upper_color, lower_color, count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause} AND (upper_color IS NOT NULL OR lower_color IS NOT NULL)
        GROUP BY upper_color, lower_color ORDER BY n DESC LIMIT 50`, args.slice(0, -1)),
      pool.query(`SELECT hair_color, count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause} AND hair_color IS NOT NULL
        GROUP BY hair_color ORDER BY n DESC`, args.slice(0, -1)),
      pool.query(`SELECT hair_length, count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause} AND hair_length IS NOT NULL
        GROUP BY hair_length ORDER BY n DESC`, args.slice(0, -1)),
      pool.query(`SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE a.bag_category IS NOT NULL)::int AS bag_count,
          count(*) FILTER (WHERE a.bag_category = 'Backpack')::int AS backpack_count,
          count(*) FILTER (WHERE a.bag_category = 'ShoulderBag')::int AS shoulder_count,
          count(*) FILTER (WHERE a.glasses = true)::int AS glasses_count,
          count(*) FILTER (WHERE a.helmet_wear = true)::int AS helmet_count
        FROM appearances a JOIN events e ON e.id = a.event_id ${clause}`, args.slice(0, -1)),
      pool.query(`SELECT
          (DATE_TRUNC('day', e.event_time AT TIME ZONE $${tzIdx}) AT TIME ZONE $${tzIdx}) AS day,
          count(*)::int AS n
        FROM appearances a JOIN events e ON e.id = a.event_id
        ${clause}
        GROUP BY 1 ORDER BY 1`, args),
    ]);

    // Aggregate upper_color + lower_color distributions from color results
    const upperMap = {}, lowerMap = {};
    for (const r of colorR.rows) {
      if (r.upper_color) upperMap[r.upper_color] = (upperMap[r.upper_color] || 0) + r.n;
      if (r.lower_color) lowerMap[r.lower_color] = (lowerMap[r.lower_color] || 0) + r.n;
    }
    const sortDesc = m => Object.entries(m).sort((a, b) => b[1] - a[1]);

    const result = {
      gender:      Object.fromEntries(genderR.rows.map(r => [r.gender, r.n])),
      top_cat:     Object.fromEntries(topR.rows.map(r => [r.top_category, r.n])),
      bottom_cat:  Object.fromEntries(botR.rows.map(r => [r.bottom_category, r.n])),
      upper_color: sortDesc(upperMap),
      lower_color: sortDesc(lowerMap),
      hair_color:  sortDesc(Object.fromEntries(hairColorR.rows.map(r => [r.hair_color, r.n]))),
      hair_length: Object.fromEntries(hairLenR.rows.map(r => [r.hair_length, r.n])),
      accessories: accessR.rows[0] || {},
      volume:      volumeR.rows.map(r => ({ day: r.day, n: r.n })),
    };
    _appStatsCache = result;
    _appStatsCacheAt = Date.now();
    _appStatsCacheKey = _cacheKey;
    res.json(result);
  } catch (err) { routeError(res, err, 'GET /api/appearances/stats'); }
});

// GET /api/appearances/search — forensic search by appearance attributes
// Query: gender, top, bottom, hair, glasses, helmet, camera_id, from, to, limit, offset
// Returns event-centric rows (e.*) so result cards can call showSnapshot(ev) directly.
// SELECT e.* to avoid column-name collisions: a.id/camera_id/object_class shadow e.*
app.get('/api/appearances/search', async (req, res) => {
  try {
    const { gender, top, bottom, hair, glasses, helmet, bag,
            upper_color, lower_color,
            camera_id, from, to, limit = 50, offset = 0 } = req.query;
    const where = [], args = [];
    if (gender)          { args.push(gender);    where.push(`a.gender = $${args.length}`); }
    if (top)             { args.push(top);       where.push(`a.top_category = $${args.length}`); }
    if (bottom)          { args.push(bottom);    where.push(`a.bottom_category = $${args.length}`); }
    if (hair)            { args.push(hair);      where.push(`a.hair_length = $${args.length}`); }
    // สี: garment color (กล้อง Pro) หรือ color cluster ใดๆ ของแถว low-fidelity
    // (migration 041/042). upper/lower ไม่ cross กันสำหรับแถว Pro;
    // แถว low-fidelity: ใส่สองสี = ทั้งคู่ต้องอยู่ใน clusters ("คนใส่ดำ-ขาว")
    const clusterMatch = (n) =>
      `a.color_clusters @> jsonb_build_array(jsonb_build_object('name', $${n}::text))`;
    if (upper_color)     { args.push(upper_color); where.push(`(a.upper_color = $${args.length} OR a.overall_color = $${args.length} OR ${clusterMatch(args.length)})`); }
    if (lower_color)     { args.push(lower_color); where.push(`(a.lower_color = $${args.length} OR a.overall_color = $${args.length} OR ${clusterMatch(args.length)})`); }
    if (glasses === 'true')  where.push('a.glasses = TRUE');
    if (helmet  === 'true')  where.push('a.helmet_wear = TRUE');
    if (bag === 'has')      where.push('a.bag_category IS NOT NULL');
    else if (bag)         { args.push(bag); where.push(`a.bag_category = $${args.length}`); }
    if (camera_id) { args.push(camera_id); where.push(`a.camera_id = $${args.length}`); }
    if (from)      { args.push(from);      where.push(`e.event_time >= $${args.length}`); }
    if (to)        { args.push(to);        where.push(`e.event_time <= $${args.length}`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;
    args.push(lim, off);
    const { rows } = await pool.query(
      `SELECT e.*,
              COALESCE(e.snapshot_filename, e.raw_json->>'_snapshot') AS snapshot_file,
              e.raw_json->>'_snapshot_source'                         AS snapshot_source,
              a.gender, a.hair_length, a.hair_color_xyz,
              a.top_category, a.top_color_xyz,
              a.bottom_category, a.bottom_color_xyz,
              a.glasses, a.bag_category,
              a.helmet_wear, a.helmet_subtype,
              a.overall_color, a.overall_color_xyz, a.color_clusters,
              COUNT(*) OVER()::int AS _total
       FROM appearances a JOIN events e ON e.id = a.event_id
       ${clause}
       ORDER BY e.event_time DESC
       LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args
    );
    res.set('X-Total-Count', rows[0]?._total || 0);
    res.json(rows.map(({ _total, ...r }) => r));
  } catch (err) { routeError(res, err, 'GET /api/appearances/search'); }
});

// GET /api/stats/dwell?from=ISO&to=ISO[&camera_id=..][&episodes=true][&limit=50]
// Zone dwell time — จับคู่ FieldDetector/ObjectsInside event_state true→false
// ต่อ (camera, rule) ด้วย window function: "คนอยู่หน้าตู้เย็นนานเท่าไหร่"
// (Data Enrichment Ph.1, 2026-06-10). หมายเหตุ: Dahua ส่งแต่ enter (true)
// จึงยังไม่เกิดคู่ — รองรับอัตโนมัติเมื่อ Ph.2 เพิ่ม leave ฝั่ง Dahua.
// คู่ที่ห่างเกิน 24 ชม. ถือว่า state หลุด (กล้อง reboot ฯลฯ) — ตัดทิ้ง
app.get('/api/stats/dwell', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const args = [from.toISOString(), to.toISOString()];
    let camFilter = '';
    if (req.query.camera_id) { args.push(req.query.camera_id); camFilter = ` AND camera_id = $${args.length}`; }
    const baseCte = `
      WITH z AS (
        SELECT camera_id, rule_name, event_time, event_state,
               LEAD(event_time)  OVER w AS next_time,
               LEAD(event_state) OVER w AS next_state
        FROM events
        WHERE event_type = 'FieldDetector/ObjectsInside'
          AND event_state IN ('true','false')
          AND event_time >= $1 AND event_time <= $2${camFilter}
        WINDOW w AS (PARTITION BY camera_id, rule_name ORDER BY event_time)
      ), ep AS (
        SELECT camera_id, rule_name, event_time AS start_time, next_time AS end_time,
               EXTRACT(EPOCH FROM (next_time - event_time)) AS dwell_sec
        FROM z
        WHERE event_state = 'true' AND next_state = 'false'
          AND next_time - event_time <= INTERVAL '24 hours'
      )`;
    if (req.query.episodes === 'true') {
      const lim = Math.min(parseInt(req.query.limit) || 50, 500);
      args.push(lim);
      const { rows } = await pool.query(
        `${baseCte}
         SELECT camera_id, rule_name, start_time, end_time, ROUND(dwell_sec)::int AS dwell_sec
         FROM ep ORDER BY start_time DESC LIMIT $${args.length}`, args);
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `${baseCte}
       SELECT camera_id, rule_name,
              COUNT(*)::int            AS episodes,
              ROUND(AVG(dwell_sec))::int AS avg_sec,
              MAX(dwell_sec)::int      AS max_sec,
              MIN(dwell_sec)::int      AS min_sec,
              ROUND(SUM(dwell_sec))::int AS total_sec
       FROM ep GROUP BY camera_id, rule_name
       ORDER BY camera_id, rule_name`, args);
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/stats/dwell'); }
});

// GET /api/stats/categories?from=ISO&to=ISO[&cameras=...]
// Returns per-category event count + previous-period count + change_pct
// "previous" = same-length window immediately before [from, to) (rolling)
app.get('/api/stats/categories', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const span = to.getTime() - from.getTime();
    if (span <= 0) return res.status(400).json({ error: 'to must be after from' });
    const prevFrom = new Date(from.getTime() - span);
    const cameras  = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

    const params = [from.toISOString(), to.toISOString(), prevFrom.toISOString()];
    let camFilter = '';
    if (cameras && cameras.length) {
      params.push(cameras);
      camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
    }

    // Subquery pattern: categories with zero rules return 0 (avoid NULL=NULL wildcard footgun)
    const sql = `
      SELECT c.id, c.name, c.icon, c.color, c.kind, c.is_builtin, c.sort_order,
        COALESCE((
          SELECT COUNT(DISTINCT e.id)::int
            FROM events e
            JOIN event_category_rules r ON r.category_id = c.id
                 AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                 AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                 AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                 AND (r.object_class IS NULL OR r.object_class = e.object_class)
                 AND (r.match_state  IS NULL OR r.match_state  = e.event_state)
           WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
             ${camFilter}
        ), 0) AS count,
        COALESCE((
          SELECT COUNT(DISTINCT e.id)::int
            FROM events e
            JOIN event_category_rules r ON r.category_id = c.id
                 AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                 AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                 AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                 AND (r.object_class IS NULL OR r.object_class = e.object_class)
                 AND (r.match_state  IS NULL OR r.match_state  = e.event_state)
           WHERE e.event_time >= $3::timestamptz AND e.event_time < $1::timestamptz
             ${camFilter}
        ), 0) AS prev_count
       FROM event_categories c
      ORDER BY c.sort_order, c.id`;
    const { rows } = await pool.query(sql, params);

    rows.forEach(r => {
      const cur = r.count, prev = r.prev_count;
      r.change_pct = prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10
                   : (cur > 0 ? null : 0);   // null => "no baseline"
    });

    res.json({ from: from.toISOString(), to: to.toISOString(),
               prev_from: prevFrom.toISOString(), prev_to: from.toISOString(),
               categories: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/categories'); }
});

// GET /api/stats/timeline-v2?from=ISO&to=ISO[&category_id=X][&cameras=...]
// Bucketed counts. If category_id provided → only events matching that category.
// Buckets are aligned to display_timezone day boundaries so the frontend's
// local-midnight buckets match the server's. Without this, Daily/Weekly/Monthly
// returned UTC-midnight buckets and the frontend's BKK-midnight buckets never
// matched, leaving the chart empty.
app.get('/api/stats/timeline-v2', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const span = to.getTime() - from.getTime();
    if (span <= 0) return res.status(400).json({ error: 'to must be after from' });
    const trunc   = pickTruncUnit(from.getTime(), to.getTime());
    const catId   = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
    const tz      = await getDisplayTz();

    const params = [from.toISOString(), to.toISOString(), tz];
    let where = `e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz`;
    if (cameras && cameras.length) {
      params.push(cameras);
      where += ` AND e.camera_id = ANY($${params.length}::text[])`;
    }

    // bucket expression: truncate in display TZ, then re-tag as that TZ so the
    // returned timestamptz is the local-midnight (or local-hour) instant in UTC.
    const bucketExpr = `(DATE_TRUNC('${trunc}', e.event_time AT TIME ZONE $3) AT TIME ZONE $3)`;

    let sql;
    if (catId) {
      params.push(catId);
      sql = `
        SELECT ${bucketExpr} AS bucket,
               COUNT(DISTINCT e.id)::int AS total
          FROM events e
          JOIN event_category_rules r ON r.category_id = $${params.length}
                  AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                  AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                  AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                  AND (r.object_class IS NULL OR r.object_class = e.object_class)
                  AND (r.match_state  IS NULL OR r.match_state  = e.event_state)
         WHERE ${where}
         GROUP BY bucket
         ORDER BY bucket ASC`;
    } else {
      sql = `
        SELECT ${bucketExpr} AS bucket,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE rule_name IS NOT NULL AND rule_name <> '')::int AS alerts
          FROM events e
         WHERE ${where}
         GROUP BY bucket
         ORDER BY bucket ASC`;
    }

    const { rows } = await pool.query(sql, params);
    res.json({ from: from.toISOString(), to: to.toISOString(), trunc, tz, buckets: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/timeline-v2'); }
});

// GET /api/stats/per-camera-counts?kind=people|vehicle&from=ISO&to=ISO[&cameras=...]
// For Phase 3 — vertical bar charts of People / Vehicle counts per camera.
// Aggregates events that match ANY mapping rule of categories with the
// given kind (people_counter / vehicle_counter). Same all-match semantics
// as /api/stats/categories: an event is counted once per camera if it
// matches at least one rule for that kind.
app.get('/api/stats/per-camera-counts', async (req, res) => {
  try {
    const kind = req.query.kind === 'vehicle' ? 'vehicle_counter'
               : req.query.kind === 'people'  ? 'people_counter'
               : null;
    if (!kind) return res.status(400).json({ error: 'kind must be people | vehicle' });

    const { from, to } = parseRange(req.query);
    const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

    const params = [from.toISOString(), to.toISOString(), kind];
    let camFilter = '';
    if (cameras && cameras.length) {
      params.push(cameras);
      camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
    }

    const sql = `
      SELECT e.camera_id, COUNT(DISTINCT e.id)::int AS count
        FROM events e
        JOIN event_category_rules r ON
             EXISTS (SELECT 1 FROM event_categories c WHERE c.id = r.category_id AND c.kind = $3)
             AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
             AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
             AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
             AND (r.object_class IS NULL OR r.object_class = e.object_class)
             AND (r.match_state  IS NULL OR r.match_state  = e.event_state)
       WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
         ${camFilter}
       GROUP BY e.camera_id
       ORDER BY count DESC, e.camera_id`;
    const { rows } = await pool.query(sql, params);
    res.json({ kind, from: from.toISOString(), to: to.toISOString(), per_camera: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/per-camera-counts'); }
});

// GET /api/stats/heatmap?from=ISO&to=ISO[&category_id=X][&cameras=...]
// 7×24 grid: day-of-week × hour-of-day. dow uses ISO ordering (0=Mon..6=Sun)
// after a -1 offset, so Monday lines up nicely as the first row.
// Aligned to display_timezone so the cells match a Thai user's calendar.
app.get('/api/stats/heatmap', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    if (to.getTime() - from.getTime() <= 0) return res.status(400).json({ error: 'to must be after from' });
    const catId   = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
    const tz      = await getDisplayTz();

    const params = [from.toISOString(), to.toISOString(), tz];
    let where = `e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz`;
    if (cameras && cameras.length) {
      params.push(cameras);
      where += ` AND e.camera_id = ANY($${params.length}::text[])`;
    }

    let sql;
    if (catId) {
      params.push(catId);
      sql = `
        SELECT (EXTRACT(isodow FROM e.event_time AT TIME ZONE $3)::int - 1) AS dow,
                EXTRACT(hour   FROM e.event_time AT TIME ZONE $3)::int      AS hour,
                COUNT(DISTINCT e.id)::int AS count
          FROM events e
          JOIN event_category_rules r ON r.category_id = $${params.length}
                  AND (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
                  AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
                  AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
                  AND (r.object_class IS NULL OR r.object_class = e.object_class)
                  AND (r.match_state  IS NULL OR r.match_state  = e.event_state)
         WHERE ${where}
         GROUP BY dow, hour
         ORDER BY dow, hour`;
    } else {
      // Generic (no category) heatmap — exclude metric events so the cells
      // reflect real incidents. Category-scoped queries above are unchanged
      // because counter categories legitimately map to CountAggregation.
      sql = `
        SELECT (EXTRACT(isodow FROM e.event_time AT TIME ZONE $3)::int - 1) AS dow,
                EXTRACT(hour   FROM e.event_time AT TIME ZONE $3)::int      AS hour,
                COUNT(*)::int AS count
          FROM events e
         WHERE ${where}
           AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
           AND NOT ${analyticsEventClause('e.event_type')}
         GROUP BY dow, hour
         ORDER BY dow, hour`;
    }

    const { rows } = await pool.query(sql, params);
    res.json({ from: from.toISOString(), to: to.toISOString(), tz, cells: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/heatmap'); }
});

// GET /api/stats/quiet-cameras?since_hours=24
// Cameras that are online but have produced zero events in the last N hours.
// "Online" = last_seen within 90s. Useful for catching cameras whose IVA has
// silently broken (still beating but not detecting).
app.get('/api/stats/quiet-cameras', async (req, res) => {
  try {
    const sinceHours = Math.min(168, Math.max(1, parseInt(req.query.since_hours || '24', 10)));
    // Restrict to cameras in cameras-config.json (decision #86) — the DB
    // cameras table can carry stale rows from old MQTT testing that have
    // 0 events forever and would otherwise dominate this leaderboard.
    const cfgIds = ((loadCameraConfig().cameras) || [])
      .map(c => c.camera_id || c.id).filter(Boolean);
    if (cfgIds.length === 0) return res.json({ since_hours: sinceHours, cameras: [] });
    const { rows } = await pool.query(`
      SELECT c.id   AS camera_id,
             c.name AS camera_name,
             c.last_seen_at AS last_seen,
             EXTRACT(EPOCH FROM (NOW() - c.last_seen_at))::int AS last_seen_ago_sec,
             COALESCE(e.cnt, 0)::int AS event_count
        FROM cameras c
        LEFT JOIN (
          SELECT camera_id, COUNT(*) AS cnt
            FROM events
           WHERE event_time >= NOW() - ($1::int * INTERVAL '1 hour')
             AND event_type NOT LIKE '%Aggregation%'
             AND NOT ${analyticsEventClause('event_type')}
           GROUP BY camera_id
        ) e ON e.camera_id = c.id
       WHERE c.enabled = TRUE
         AND c.id = ANY($2::text[])
         AND COALESCE(e.cnt, 0) = 0
       ORDER BY c.id`,
      [sinceHours, cfgIds]);
    res.json({ since_hours: sinceHours, cameras: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/quiet-cameras'); }
});

// GET /api/stats/top-rules?from=ISO&to=ISO[&limit=10][&cameras=...]
// rule_name leaderboard for the active window — helps tune false positives.
app.get('/api/stats/top-rules', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

    const params = [from.toISOString(), to.toISOString()];
    // Exclude metric events — Counter rules would dominate the leaderboard
    // with thousands of samples, drowning out real alert rules.
    let where = `event_time >= $1::timestamptz AND event_time < $2::timestamptz
                 AND rule_name IS NOT NULL AND rule_name <> ''
                 AND event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'`;
    if (cameras && cameras.length) {
      params.push(cameras);
      where += ` AND camera_id = ANY($${params.length}::text[])`;
    }
    params.push(limit);
    const sql = `
      SELECT rule_name, COUNT(*)::int AS count,
             COUNT(DISTINCT camera_id)::int AS cameras_seen
        FROM events WHERE ${where}
       GROUP BY rule_name
       ORDER BY count DESC
       LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    res.json({ from: from.toISOString(), to: to.toISOString(), top: rows });
  } catch (err) { routeError(res, err, 'GET /api/stats/top-rules'); }
});

// GET /api/stats/timeline-by-category?from=ISO&to=ISO[&cameras=...]
// One time-series per category (driven by event_category_rules).
// Used by the Event Overview chart on the Stats page so each category
// is its own coloured line instead of a single "Total Events" line.
app.get('/api/stats/timeline-by-category', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const span = to.getTime() - from.getTime();
    if (span <= 0) return res.status(400).json({ error: 'to must be after from' });
    const trunc   = pickTruncUnit(from.getTime(), to.getTime());
    const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;
    const tz      = await getDisplayTz();

    const params = [from.toISOString(), to.toISOString(), tz];
    let camFilter = '';
    if (cameras && cameras.length) {
      params.push(cameras);
      camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
    }

    const bucketExpr = `(DATE_TRUNC('${trunc}', e.event_time AT TIME ZONE $3) AT TIME ZONE $3)`;

    const sql = `
      SELECT ${bucketExpr} AS bucket,
             c.id  AS category_id,
             COUNT(DISTINCT e.id)::int AS count
        FROM events e
        JOIN event_category_rules r ON
             (r.camera_id    IS NULL OR r.camera_id    = e.camera_id)
         AND (r.rule_name    IS NULL OR r.rule_name    = e.rule_name)
         AND (r.event_type   IS NULL OR r.event_type   = e.event_type)
         AND (r.object_class IS NULL OR r.object_class = e.object_class)
         AND (r.match_state  IS NULL OR r.match_state  = e.event_state)
        JOIN event_categories c ON c.id = r.category_id
       WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
         ${camFilter}
       GROUP BY bucket, c.id
       ORDER BY bucket ASC, c.id`;

    const [pointsResult, catsResult] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT id, name, icon, color, kind, sort_order FROM event_categories ORDER BY sort_order, id`),
    ]);

    // Pivot: { categoryId → [{bucket, count}, ...] }
    const byCat = {};
    pointsResult.rows.forEach(r => {
      const k = r.category_id;
      if (!byCat[k]) byCat[k] = [];
      byCat[k].push({ bucket: r.bucket, count: r.count });
    });

    const series = catsResult.rows.map(c => ({
      category: { id: c.id, name: c.name, icon: c.icon, color: c.color, kind: c.kind, sort_order: c.sort_order },
      points: byCat[c.id] || [],
    }));

    res.json({ from: from.toISOString(), to: to.toISOString(), trunc, tz, series });
  } catch (err) { routeError(res, err, 'GET /api/stats/timeline-by-category'); }
});

// GET /api/stats/breakdown-v2?from=ISO&to=ISO[&cameras=...]
// Top rule_names within each category (for the breakdown table)
app.get('/api/stats/breakdown-v2', async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const cameras = req.query.cameras ? String(req.query.cameras).split(',').filter(Boolean) : null;

    const params = [from.toISOString(), to.toISOString()];
    let camFilter = '';
    if (cameras && cameras.length) {
      params.push(cameras);
      camFilter = ` AND e.camera_id = ANY($${params.length}::text[])`;
    }

    // Exclude metric (CountAggregation/*) and camera-automation analytics
    // events — neither is an "incident", so they don't belong in the
    // report's event breakdown.
    const sql = `
      SELECT COALESCE(NULLIF(e.rule_name, ''), e.event_type) AS name,
             e.event_type,
             e.camera_id,
             COUNT(*)::int AS count
        FROM events e
       WHERE e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
         AND e.event_type NOT LIKE '${METRIC_EVENT_TYPE_PATTERN}'
         AND NOT ${analyticsEventClause('e.event_type')}
         ${camFilter}
       GROUP BY name, e.event_type, e.camera_id
       ORDER BY count DESC
       LIMIT 30`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { routeError(res, err, 'GET /api/stats/breakdown-v2'); }
});

// ============================================================
// Event Categories & Mapping Rules (→ src/routes/categories.js)
// ============================================================
require('./routes/categories')(app, pool);

// ============================================================
// System Settings (Stats v2)
// ============================================================

// GET /api/settings — list all settings
app.get('/api/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value, description, updated_at FROM system_settings ORDER BY key');
    const obj = {};
    rows.forEach(r => { obj[r.key] = { value: r.value, description: r.description, updated_at: r.updated_at }; });
    res.json(obj);
  } catch (err) { routeError(res, err, 'GET /api/settings'); }
});

// PUT /api/settings/:key — update setting (with validation)
const SETTINGS_VALIDATORS = {
  data_retention_days: v => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('data_retention_days must be 1..730');
    return String(n);
  },
  appearances_retention_days: v => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('appearances_retention_days must be 1..730');
    return String(n);
  },
  snapshot_retention_days: v => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) throw new Error('snapshot_retention_days must be 1..365');
    return String(n);
  },
  clip_retention_days: v => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 90) throw new Error('clip_retention_days must be 1..90');
    return String(n);
  },
  custom_range_max_days: v => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 730) throw new Error('custom_range_max_days must be 1..730');
    return String(n);
  },
  display_timezone: v => {
    if (typeof v !== 'string' || !v.trim()) throw new Error('display_timezone must be a string');
    // Sanity: try Date with the TZ
    try { new Date().toLocaleString('en-US', { timeZone: v }); } catch { throw new Error('invalid timezone'); }
    return v.trim();
  },
  counter_dedup_mode: v => {
    if (!['state', 'object_window', 'none'].includes(v)) throw new Error('counter_dedup_mode must be state|object_window|none');
    return v;
  },
  comparison_mode: v => {
    if (!['rolling', 'calendar'].includes(v)) throw new Error('comparison_mode must be rolling|calendar');
    return v;
  },
  analytics_event_display: v => {
    // CSV of analytics event keys allowed to appear in the Events feed.
    if (typeof v !== 'string') throw new Error('analytics_event_display must be a CSV string');
    const parts = v.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (!ANALYTICS_EVENT_KEYS.includes(p)) throw new Error(`unknown analytics event key: ${p}`);
    }
    // Dedupe + keep canonical order
    return ANALYTICS_EVENT_KEYS.filter(k => parts.includes(k)).join(',');
  },
  brand_name: v => {
    if (typeof v !== 'string') throw new Error('brand_name must be a string');
    const s = v.trim();
    if (s.length < 1 || s.length > 100) throw new Error('brand_name must be 1..100 chars');
    return s;
  },
  brand_tagline: v => {
    if (typeof v !== 'string') throw new Error('brand_tagline must be a string');
    const s = v.trim();
    if (s.length > 200) throw new Error('brand_tagline too long (max 200)');
    return s;
  },
  brand_logo_path: v => {
    if (typeof v !== 'string') throw new Error('brand_logo_path must be a string');
    const s = v.trim();
    // Must be a simple filename (no path traversal); empty allowed (clears logo)
    if (s && !/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('brand_logo_path must be a simple filename');
    return s;
  },
  brand_primary_color: v => {
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.trim())) throw new Error('brand_primary_color must be #RRGGBB');
    return v.trim().toLowerCase();
  },
};

// Map Settings — Mapbox token (admin-only; decision #171)
// Must be before /:key wildcard so Express doesn't treat 'map' as a generic key.
app.put('/api/settings/map', auth.requireAdmin, async (req, res) => {
  const { mapboxToken } = req.body;
  // pk. = public token; reject sk. (secret) — SEC-003
  if (mapboxToken && !/^pk\.[A-Za-z0-9._-]+$/.test(mapboxToken)) {
    return res.status(400).json({ error: 'invalid_token_format' });
  }
  try {
    await pool.query(
      "INSERT INTO system_settings(key,value) VALUES('mapbox_token',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
      [mapboxToken || '']
    );
    _cachedMapboxToken = null; // invalidate cache
    await auth.logAudit(req.user?.id, req.user?.username, 'map_settings_token_update', null, null, getIP(req), req.headers['user-agent'], { tokenSet: !!(mapboxToken) });
    res.json({ success: true });
  } catch (err) { routeError(res, err, 'PUT /api/settings/map'); }
});

app.put('/api/settings/:key', async (req, res) => {
  const key = req.params.key;
  const validator = SETTINGS_VALIDATORS[key];
  if (!validator) return res.status(404).json({ error: 'unknown setting key' });
  let value;
  try { value = validator(req.body?.value); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const { rows } = await pool.query(
      `UPDATE system_settings SET value=$1 WHERE key=$2 RETURNING *`,
      [value, key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'setting row missing' });
    // Refresh the in-memory analytics-display cache immediately so the
    // Events feed reflects the change without waiting for the 60s poll.
    if (key === 'analytics_event_display') refreshAnalyticsEnabledSet();
    res.json(rows[0]);
  } catch (err) { routeError(res, err, 'PUT /api/settings/:key'); }
});

// ============================================================
// Branding (white-label) — public GET + admin-only logo upload
// ============================================================
const multer = require('multer');
const _brandUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/branding — public (login + disclaimer pages call this without auth)
app.get('/api/branding', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT key, value FROM system_settings WHERE key IN ('brand_name','brand_tagline','brand_logo_path','brand_primary_color')`
    );
    const m = {};
    r.rows.forEach(row => { m[row.key] = row.value; });
    const logoPath = (m.brand_logo_path || '').trim();
    res.json({
      name:          m.brand_name    || 'Vigil Platform',
      tagline:       m.brand_tagline || '',
      logo_url:      logoPath ? `/branding/${logoPath}` : null,
      primary_color: m.brand_primary_color || '#5b8def',
    });
  } catch (err) { routeError(res, err, 'GET /api/branding'); }
});

// POST /api/branding/logo — admin only, multipart "logo"
// Resizes to 256×256 (fit:'inside', PNG with alpha) and saves to branding/logo.png
app.post('/api/branding/logo', _brandUpload.single('logo'), async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  if (!req.file) return res.status(400).json({ error: 'logo file required (field name: "logo")' });
  // SEC-005: SVG ถูกตัดออก — librsvg (ใช้ใน sharp) มี CVE history (XXE, infinite loop)
  // ใช้ magic bytes แทน MIME เพราะ Content-Type มาจาก client (spoofable)
  const mime = (req.file.mimetype || '').toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) {
    return res.status(415).json({ error: 'unsupported image type' });
  }
  const buf = req.file.buffer;
  const isPng  = buf.length > 8  && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isJpeg = buf.length > 3  && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  const isWebP = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  const isGif  = buf.length > 6  && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a');
  if (!isPng && !isJpeg && !isWebP && !isGif) {
    return res.status(415).json({ error: 'invalid image magic bytes' });
  }
  try {
    const outFile = 'logo.png';
    const outPath = path.join(BRANDING_DIR, outFile);
    await sharp(req.file.buffer, { failOnError: false })
      .resize(256, 256, { fit: 'inside', withoutEnlargement: false })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    // Update setting (cache-bust handled client-side via timestamp query string)
    await pool.query(
      `UPDATE system_settings SET value = $1 WHERE key = 'brand_logo_path'`,
      [outFile]
    );
    res.json({ ok: true, logo_url: `/branding/${outFile}?v=${Date.now()}` });
  } catch (err) {
    console.error('logo upload:', err);
    res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
  }
});

// DELETE /api/branding/logo — clear logo (revert to default)
app.delete('/api/branding/logo', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  try {
    await pool.query(`UPDATE system_settings SET value = '' WHERE key = 'brand_logo_path'`);
    // We keep the file on disk in case someone wants to undo manually; harmless.
    res.json({ ok: true });
  } catch (err) { routeError(res, err, 'DELETE /api/branding/logo'); }
});

// ============================================================
// Health Check — admin-only deep status
// ============================================================
const _serverStartedAt = Date.now();

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

// ============================================================
// 💾 Backup / Restore (Settings Workspace, Stage 4a) — admin-gated.
// List + trigger pg_dump (scripts/backup.sh). Restore stays CLI-only
// (destructive — see scripts/restore.sh); the UI only shows the
// command. backup.sh resolves the repo root itself.
// ============================================================
const BACKUPS_DIR = path.join(__dirname, '..', 'backups');
const BACKUP_RE = /^vigil_platform_[0-9_-]+\.dump$/;

app.get('/api/backups', auth.requireAdminOrAuditor, (req, res) => {
  try {
    const files = fs.existsSync(BACKUPS_DIR)
      ? fs.readdirSync(BACKUPS_DIR).filter(f => BACKUP_RE.test(f)) : [];
    const list = files.map(f => {
      const st = fs.statSync(path.join(BACKUPS_DIR, f));
      return { filename: f, size: st.size, mtime: st.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    res.json({ backups: list });
  } catch (e) { routeError(res, e, 'GET /api/backups'); }
});

app.post('/api/backups/run', auth.requireAdmin, (req, res) => {
  const { execFile } = require('child_process');
  const script = path.join(__dirname, '..', 'scripts', 'backup.sh');
  execFile('bash', [script], { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[POST /api/backups/run] backup failed:', stderr || err.message);
      return res.status(500).json({ ok: false, error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
    res.json({ ok: true, output: (stdout || '').trim() });
  });
});

app.get('/api/backups/:filename', auth.requireAdmin, async (req, res) => {
  const fn = req.params.filename;
  if (!BACKUP_RE.test(fn)) return res.status(400).end();
  const file = path.join(BACKUPS_DIR, fn);
  if (!fs.existsSync(file)) return res.status(404).end();
  try {
    const stat = fs.statSync(file);
    await auth.logAudit(req.user?.id, req.user?.username, 'backup_download', null, null, getIP(req), req.headers['user-agent'], {
      filename: fn, size_bytes: stat.size,
    });
  } catch (e) {
    console.error('audit log failed for backup download:', e.message);
  }
  res.download(file);
});

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
      total_mem_mb: Math.round(os.totalmem() / (1024 * 1024)),
      free_mem_mb: Math.round(os.freemem() / (1024 * 1024)),
    },
    db: { ok: false, latency_ms: null, error: null },
    mqtt_pipeline: { last_event_at: null, age_sec: null, status: 'unknown' },
    cameras: { total: 0, online: 0, offline: 0 },
    events: { last_hour: 0, last_24h: 0, total: 0 },
    storage: {
      snapshots_files: 0, snapshots_mb: 0,
      clips_files: 0, clips_mb: 0, clips_today: 0, clips_oldest_at: null,
      retention_days_events: null, retention_days_snapshots: null, retention_days_clips: null,
    },
    websocket: { clients: wss.clients ? wss.clients.size : 0 },
    image_quality: [],
  };

  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    result.db.latency_ms = Date.now() - t0;
    result.db.ok = true;
  } catch (e) { result.db.error = e.message; }

  if (result.db.ok) {
    try {
      const r = await pool.query(`SELECT MAX(event_time) AS last FROM events`);
      const last = r.rows[0]?.last;
      if (last) {
        result.mqtt_pipeline.last_event_at = new Date(last).toISOString();
        const age = Math.floor((Date.now() - new Date(last).getTime()) / 1000);
        result.mqtt_pipeline.age_sec = age;
        result.mqtt_pipeline.status = age < 300 ? 'healthy' : age < 3600 ? 'idle' : 'stale';
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
        online = dbRows.filter(row => row.age_sec != null && row.age_sec < 90).length;
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
        const status = db == null ? 'unknown' : (age != null && age < 90 ? 'online' : 'offline');
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
      const mbDir = path.join(__dirname, '..', 'media-buffer');
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
          COUNT(*) AS total
        FROM events`);
      result.events.last_hour = parseInt(r.rows[0].h1, 10);
      result.events.last_24h = parseInt(r.rows[0].h24, 10);
      result.events.total = parseInt(r.rows[0].total, 10);
    } catch {}
    try {
      const r = await pool.query(
        `SELECT key, value FROM system_settings
          WHERE key IN ('data_retention_days','snapshot_retention_days','clip_retention_days')`);
      for (const row of r.rows) {
        if (row.key === 'data_retention_days')     result.storage.retention_days_events    = parseInt(row.value, 10);
        if (row.key === 'snapshot_retention_days') result.storage.retention_days_snapshots = parseInt(row.value, 10);
        if (row.key === 'clip_retention_days')     result.storage.retention_days_clips     = parseInt(row.value, 10);
      }
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
    const { bytes, files } = await _dirSize(SNAPSHOT_DIR);
    result.storage.snapshots_files = files;
    result.storage.snapshots_mb = Math.round(bytes / (1024 * 1024));
  } catch {}

  // Phase 6.1.5 — clip files on disk
  try {
    const { bytes, files } = await _dirSize(MEDIA_DIR);
    result.storage.clips_files = files;
    result.storage.clips_mb = Math.round(bytes / (1024 * 1024));
  } catch {}

  try {
    const sf = await fs.promises.statfs(SNAPSHOT_DIR);
    result.storage.disk_free_gb  = Math.round((sf.bavail * sf.bsize) / (1024 ** 3));
    result.storage.disk_total_gb = Math.round((sf.blocks * sf.bsize) / (1024 ** 3));
  } catch {}

  // Worker health — poll each worker's /health endpoint for process-level state
  // (db connectivity, listener status, scheduler activity). These go beyond what
  // PM2 provides (restart count) and satisfy S3 observability requirement.
  result.workers = {
    alert:  await fetchWorkerHealth(ALERT_WORKER_PORT),
    report: await fetchWorkerHealth(WORKER_PORT),
  };

  // Service status via PM2 — replaces pgrep count; gives status/restarts/uptime.
  result.services = [];
  {
    const { execFileSync } = require('child_process');
    const TRACKED = ['api-server', 'mqtt-subscriber', 'media-recorder', 'hikvision', 'dahua', 'alert-worker', 'report-worker'];
    try {
      const out = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000 });
      const pm2List = JSON.parse(out);
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

  res.json(result);
});

// Service Management — Start / Stop / Restart per PM2 worker.
// Admin-only; server-side allowlist prevents injection via URL param.
// execFile (not exec) — args passed as array, no shell interpolation.
const _SVC_NAMES   = new Set(['api-server', 'mqtt-subscriber', 'media-recorder', 'hikvision', 'dahua']);
const _SVC_ACTIONS = new Set(['restart', 'stop', 'start']);

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
  const { execFile } = require('child_process');
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

// Ph.3 — health report data endpoints (internal token only, called by report-renderer)
// Cameras: current online/offline status (from cameras.last_seen_at) + uptime % over range
// + offline duration (NOW - last_seen_at) so the report can show how long offline.
app.get('/api/health/report-data/cameras', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(8760, parseInt(req.query.range_hours, 10) || 24));
    const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const config = loadCameraConfig();
    // Field is `camera_name` in cameras-config.json (not `name`).
    const cams = (config.cameras || [])
      .map(c => ({
        id:   c.camera_id || c.id,
        name: c.camera_name || c.name || c.camera_id || c.id,
      }))
      .filter(c => c.id);
    const ids = cams.map(c => c.id);

    // Current online flag + last_seen_at + created_at (when added to system)
    const onlineSet = new Set();
    const pausedSet = new Set();
    const lastSeenByCamera = {};
    const createdByCamera = {};
    if (ids.length) {
      const r = await pool.query(
        `SELECT c.id, c.last_seen_at, c.created_at, c.paused,
                (c.last_seen_at > NOW() - INTERVAL '90 seconds') AS is_online
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
// GET /api/health/report/preview
//   ?sections=camera_status,camera_uptime,alerts,storage,system
//     (legacy "cameras" expands to camera_status + camera_uptime)
//   &range=24h|7d|30d|custom    (default 24h)
//   &from=ISO&to=ISO            (when range=custom)
//   &lang=th|en                 (default th)
//   &download=1                 (force download)
app.get('/api/health/report/preview', async (req, res) => {
  try {
    const reportRenderer = require('./report-renderer');
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
// GET /api/health/report/pdf?sections=...&range=...&from=&to=&lang=...
app.get('/api/health/report/pdf', async (req, res) => {
  try {
    const reportRenderer = require('./report-renderer');
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
    const reportRenderer = require('./report-renderer');
    const lineSender = require('./line-sender');
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
    });
    const tzForName = await getDisplayTz();
    const dateStr = new Date().toLocaleDateString('sv', { timeZone: tzForName });
    const fname = `report_health_${dateStr}_${Date.now()}.png`;
    await fs.promises.writeFile(path.join(REPORTS_DIR, fname), png).catch(() => {});
    const titleTh = REPORT_TITLE_TH.health;
    const result = await lineSender.sendReportToLine({
      token: cfg.channel_access_token,
      imgbbKey: cfg.imgbb_api_key,
      recipients: recipientIds,
      pngBuffer: png,
      caption: `📊 ${titleTh}\n${lang === 'en' ? 'Manual send' : 'ส่งทันที'}`,
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
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='success')  AS success,
        COUNT(*) FILTER (WHERE status='failed')   AS failed,
        COUNT(*) FILTER (WHERE status='cooldown_skip') AS cooldown,
        COUNT(*)                                   AS total
      FROM alert_logs WHERE sent_at >= $1`, [since]);
    const row = r.rows[0];
    res.json({
      success:  parseInt(row.success,  10),
      failed:   parseInt(row.failed,   10),
      cooldown: parseInt(row.cooldown, 10),
      total:    parseInt(row.total,    10),
    });
  } catch (e) { routeError(res, e, 'GET /api/health/report-data/alerts'); }
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
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE key='data_retention_days'`
    );
    const days = Math.min(730, Math.max(1, parseInt(r.rows[0]?.value || '365', 10)));
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
    // Explicit child-delete before events — appearances/license_plates have no FK cascade
    // (dropped in MANUAL_partition_events_option_a.sql; required for partitioned parent).
    let _totalEventsDeleted = 0, _evBatch;
    do {
      const _ids = await pool.query(
        `SELECT id FROM events WHERE event_time < $1 ORDER BY event_time LIMIT $2`,
        [cutoff, _RETENTION_BATCH]
      );
      _evBatch = _ids.rowCount;
      if (_evBatch === 0) break;
      const ids = _ids.rows.map(r => r.id);
      await pool.query(`DELETE FROM appearances    WHERE event_id = ANY($1::bigint[])`, [ids]);
      await pool.query(`DELETE FROM license_plates WHERE event_id = ANY($1::bigint[])`, [ids]);
      const _del = await pool.query(`DELETE FROM events WHERE id = ANY($1::bigint[])`, [ids]);
      _totalEventsDeleted += _del.rowCount;
      if (_evBatch === _RETENTION_BATCH) await new Promise(r => setTimeout(r, 100));
    } while (_evBatch === _RETENTION_BATCH);
    if (_totalEventsDeleted > 0)
      console.log(`🧹 Retention: deleted ${_totalEventsDeleted} events older than ${days} days`);
    // appearances — optional separate retention (partial anonymisation: keep event, drop biometrics)
    // Capped at data_retention_days so it can never be LONGER than the event retention.
    const arRow = await pool.query(`SELECT value FROM system_settings WHERE key='appearances_retention_days'`);
    if (arRow.rows[0]?.value) {
      const arDays = Math.min(days, Math.max(1, parseInt(arRow.rows[0].value, 10)));
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
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE key='snapshot_retention_days'`
    );
    const days = Math.min(365, Math.max(1, parseInt(r.rows[0]?.value || '30', 10)));
    const cutoffMs = Date.now() - days * 86400 * 1000;
    let scanned = 0, deleted = 0, freedBytes = 0;
    const entries = await fs.promises.readdir(SNAPSHOT_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.png')) continue;
      scanned++;
      const full = path.join(SNAPSHOT_DIR, ent.name);
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
      console.log(`🧹 Snapshot retention: deleted ${deleted}/${scanned} files older than ${days} days (~${mb} MB freed)`);
    }
    // Prune orphaned thumbnails — a .thumbs/<w>/<file> whose original
    // snapshot is gone (deleted above, or by camera-delete / manual rm).
    try {
      for (const wdir of await fs.promises.readdir(THUMBS_DIR).catch(() => [])) {
        const wpath = path.join(THUMBS_DIR, wdir);
        for (const tf of await fs.promises.readdir(wpath).catch(() => [])) {
          if (!fs.existsSync(path.join(SNAPSHOT_DIR, tf))) {
            await fs.promises.unlink(path.join(wpath, tf)).catch(() => {});
          }
        }
      }
    } catch {}
  } catch (err) {
    console.warn('🧹 Snapshot retention error:', err.message);
  }
}
setTimeout(enforceSnapshotRetention, 90 * 1000);
setInterval(enforceSnapshotRetention, 24 * 60 * 60 * 1000);

// 🎬 Phase 6.1.2 — Clip retention (delete old MP4 from media/ by mtime)
async function enforceClipRetention() {
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE key='clip_retention_days'`
    );
    const days = Math.min(90, Math.max(1, parseInt(r.rows[0]?.value || '30', 10)));
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
  if (status === 'offline') {
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
        SELECT id, last_seen_at, enabled, paused, enable_clip_capture, enable_snapshot
        FROM cameras WHERE id = ANY($1::text[])`, [ids]),
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
      // หรือ Dahua ที่ดึง snapshot จาก buffer; ข้าม disabled/paused
      const vendor = String((credMap[cam.id] || {}).vendor || 'bosch').toLowerCase();
      const needsRecorder = cam.enabled && !cam.paused &&
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
