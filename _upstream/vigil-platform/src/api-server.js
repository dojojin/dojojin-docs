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
require('dotenv').config({ quiet: true });
const env = require('./config');     // ทะเบียน env กลาง — default/coercion อยู่ที่เดียว
process.env.APP_NAME = 'api-server'; // spool dir isolation (procTag fix)

const app = express();

// 🔐 Trust proxy — สำคัญสำหรับ Cloudflare Tunnel / reverse proxy
// ทำให้ req.secure และ req.ip ทำงานถูกต้องเมื่ออยู่หลัง proxy
// 'loopback' = trust traffic จาก localhost (cloudflared มาจาก localhost)
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
// WebSocket server + broadcast → src/ws/hub.js (built further down, where the
// WS section used to declare its client set — `auth` / `pool` exist by then and
// nothing between here and there touches `wss`; `server` is still not listening).

const { snapshotDir } = require('./helpers/snapshotDir');
const mediaScope = require('./helpers/mediaScope');
const signedImage = require('./helpers/signedImage');
const { createTtlCache } = require('./helpers/ttlCache');
const { checkSiteAdminWrite } = require('./helpers/siteAdminGate');
const { quietSiteCodes } = require('./helpers/siteStatus');
const { PHOTO_DIR: BLACKLIST_PHOTO_DIR } = require('./helpers/blacklistImport');
const viewRegistry = require('./view-registry');
const { viewGuard, viewAllows, effectiveViews } = require('./helpers/viewGuard');
const { scrubRawJson } = require('./helpers/scrubRawJson');
const { touchCamera } = require('./helpers/touchCamera');
const retentionBeat = require('./helpers/retentionBeat');
const SNAPSHOT_DIR = snapshotDir();
const CONFIG_FILE = path.join(__dirname, '..', 'cameras-config.json');
const GROUPS_FILE = path.join(__dirname, '..', 'camera-groups.json');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

const pool = new Pool({
  ...env.db(),
  max: 15,
  application_name: 'api-server',
  // 2026-08-19 incident: a month-wide, all-site stats query held a pool slot
  // for 5+ min (pg_stat_statements shows this query class already averaging
  // 20-40s with a 656s max — 120s clears the pathological tail while giving
  // real headroom to the merely-slow ones). Set as a startup option, not a
  // `SET` in pool.on('connect'): that handler is fire-and-forget and races
  // the pool's first real query on the same connection — verified empirically
  // that the SET can lose the race and silently leave the session at the
  // Postgres default (unlimited). `-c` on the startup packet applies before
  // Postgres accepts any query, so there's nothing to race.
  options: '-c statement_timeout=120000',
});

// บังคับ session ทุก connection ให้ใช้ UTC — กันปัญหา timezone mismatch
pool.on('connect', async (client) => {
  try { await client.query("SET TIME ZONE 'UTC'"); } catch (e) { /* ignore */ }
});

// 🔴 สถิติ LPR หนัก (~12 คิวรีขนาน/คำขอ + warm loop) มี pool ของตัวเอง — ถ้าใช้ pool หลัก 15 ช่อง
// สองคำขอก็กินหมดและหน้าค้นหา/รายการต้องรอคิว (2026-10-01 · routes/lpr-query.js)
const statsPool = new Pool({
  ...env.db(),
  max: 10,
  application_name: 'api-server-stats',
  connectionTimeoutMillis: 60000,   // รอช่องว่างใน pool นี้ได้ไม่เกิน 60 วิ แล้วตอบ error (ค่าเริ่มต้น pg = รอตลอดไป)
  options: '-c statement_timeout=120000',
});
statsPool.on('connect', async (client) => {
  try { await client.query("SET TIME ZONE 'UTC'"); } catch (e) { /* ignore */ }
});
statsPool.on('error', (e) => console.error('[stats-pool] idle client error:', e.message));
// คำขอ GET ที่ผู้ใช้ทิ้งไปแล้ว → ยกเลิกคิวรีที่ยังรันของคำขอนั้น (helpers/requestDb.js · perf ข้อ 1 ระยะ A)
// ห่อทั้งสอง pool · ไม่มีผลกับงานเบื้องหลัง (ไม่อยู่ในบริบทคำขอ) และคำขอที่ไม่ใช่ GET
const reqDb = require('./helpers/requestDb');
reqDb.wrapPool(pool);
reqDb.wrapPool(statsPool);

// สรุป env ตอน boot — "ตัวไหนมาจาก .env จริง ตัวไหนใช้ default" เคยตอบไม่ได้เลย
// นอกจากไล่อ่านทีละไฟล์ · ชื่อ secret ไม่ถูกพิมพ์ออกมา (แค่ไม่อยู่ในรายการ)
{
  const rows = env.summary();
  const fromEnv = rows.filter((r) => r.source === 'env');
  console.log(`[config] ${fromEnv.length} from env, ${rows.length - fromEnv.length} defaults`);
  const shown = fromEnv.filter((r) => !r.masked).map((r) => r.name);
  if (shown.length) console.log(`[config] from env: ${shown.join(', ')}`);
}

// 🔐 CORS — allowlist, not blanket reflection. The dashboard is served
// SAME-ORIGIN by this Express app, so cross-origin access is never needed
// in normal use. Reflecting an arbitrary Origin with credentials:true (the
// old behaviour) let any website the operator visited issue authenticated
// calls and read the responses. We allow: (a) genuine same-origin requests
// — Origin host === Host, so the dashboard keeps working however it's
// reached (Cloudflare domain, LAN IP, localhost); (b) any extra origins
// explicitly listed in ALLOWED_ORIGINS (.env, comma-separated).
const ALLOWED_ORIGINS = env.list('ALLOWED_ORIGINS');
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
    // X-Total-Capped (2026-09-06): /api/events caps its count at EVENTS_COUNT_CAP;
    // a cross-origin client (vigil-mobile) must be able to see the cap flag or it
    // would show the floor as the real total.
    exposedHeaders: ['Set-Cookie', 'X-Total-Count', 'X-Has-More', 'X-Total-Capped'],
  });
}));
// 🔑 Partner hostname isolation (TP-PUB).
//
// A second hostname pointed at this same process isolates NOTHING on its own —
// verified: with Host: meta.dojojin.tech, /login.html returned 200 and
// /api/branding returned 200. Anyone logging in on the partner hostname would
// receive a `session` cookie scoped to it (Path=/), and that cookie then
// travels to /v1 on every request. Which is exactly the coupling the separate
// hostname exists to remove.
//
// So the hostname only means something if this process refuses to be the
// dashboard on it. First middleware in the chain, before CORS headers, static
// files, or anything that could set a cookie.
//
// Unset PARTNER_HOST is a no-op, so nothing changes for a deployment that has
// not configured one.
const PARTNER_HOST = env.str('PARTNER_HOST').trim().toLowerCase();
if (PARTNER_HOST) {
  app.use((req, res, next) => {
    // req.hostname strips the port; the Host header may carry one.
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    if (host !== PARTNER_HOST) return next();

    // Allow-list the SHAPE of the path rather than trying to sanitise it.
    //
    // The first attempt was startsWith('/v1/'), which '/v1/../login.html'
    // satisfies — Express resolves it afterwards and served the dashboard
    // (302, confirmed). Decoding once and normalising fixed that pair but not
    // '/v1/..;/login.html' or '/v1/%25%32%65%25%32%65/login.html', because how
    // many decode passes happen further down the stack is not something this
    // middleware can know.
    //
    // So: every segment must be plain, starting alphanumeric. '%' cannot
    // appear at all, which kills every encoding trick in one rule; '..' fails
    // on the leading dot; ';' and empty segments fail outright. Nothing the
    // partner API legitimately serves needs any of them.
    const segs = req.path.split('/');
    if (segs.length && segs[segs.length - 1] === '') segs.pop();     // trailing slash
    const shaped = segs[0] === '' && segs[1] === 'v1' &&
      segs.slice(2).every((s) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s));
    if (shaped) return next();
    // 404 rather than 403: on this hostname those paths genuinely do not
    // exist, and saying "forbidden" would confirm the dashboard is behind it.
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = env.str('PUBLIC_ORIGIN') || `${proto}://${req.headers.host}`;
    res.status(404).type('application/problem+json').json({
      type: `${baseUrl}/v1/errors/not-found`,
      title: 'not-found', status: 404,
      detail: `${PARTNER_HOST} serves the partner API only. Everything here lives under /v1/.`,
    });
  });
  console.log(`[partner-api] ${PARTNER_HOST} restricted to /v1/* only`);
}

// FILES_HOST — โดเมนแยกสำหรับไฟล์ที่แอดมินอัปให้ลูกค้า (upl.dojojin.tech)
//
// เหตุผลที่แยกโดเมน: ไม่ให้ไฟล์ที่คนอัปขึ้นมาอยู่บน origin ที่ถือ session cookie
// cookie ของเราเป็น host-only (ไม่มี Domain= — ดู routes/auth.js) การแยกจึงกันได้จริง
// แต่กันได้ก็ต่อเมื่อโดเมนนั้น "ไม่มี" หน้าอื่นให้ล็อกอิน — ถ้าปล่อยให้ /api/auth/login
// ตอบบน upl. ได้ ก็จะมี cookie ของ upl. เกิดขึ้นมาเอง ซึ่งคือสิ่งที่ตั้งใจตัดทิ้ง
//
// Cloudflare public hostname ตั้ง Path เป็น pub/fil/* ไว้แล้วเป็นด่านแรก · ตัวนี้เป็น
// ด่านที่สองสำหรับคนที่ยิงเข้า origin ตรง ๆ ไม่ผ่าน tunnel และเป็นกฎที่เรา audit เองได้
//
// กติกาเดียวกับ PARTNER_HOST ข้างบน — ไม่ sanitize แต่ปฏิเสธรูปทรง เหตุผลเต็มอยู่ที่นั่น
// ชื่อไฟล์ที่ /pub/fil/ เสิร์ฟเป็น uuid ที่เราสร้างเองเสมอ (routes/files.js) จึงล็อกรูปทรง
// ได้แน่นกว่า: สามส่วนพอดี และส่วนสุดท้ายต้องเป็น uuid + นามสกุลใน allowlist
const FILES_HOST = env.str('FILES_HOST').trim().toLowerCase();
if (FILES_HOST) {
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    if (host !== FILES_HOST) return next();
    const segs = req.path.split('/');
    if (segs.length && segs[segs.length - 1] === '') segs.pop();
    const shaped = !req.path.includes('%') &&
      segs.length === 4 && segs[0] === '' && segs[1] === 'pub' && segs[2] === 'fil' &&
      // ⚠️ ต้องตรงกับ allowlist ใน routes/media-files.js /pub/fil/ เสมอ — 2026-09-24
      // เพิ่ม html ที่นั่นแล้วลืมตรงนี้ ลิงก์ .html ตอบ 404 บน upl. ทั้งที่ localhost ได้ 200
      (/^[0-9a-f-]{36}\.(png|jpg|pdf|docx|xlsx|html)$/.test(segs[3]) ||
       // ลิงก์สั้น (migration 266) — ต้องตรงกับ SHORT_CODE_RE ใน routes/media-files.js
       /^[a-z0-9]{8}(\.png)?$/.test(segs[3]));   // + ภาพพรีวิว <code>.png
    if (shaped) return next();
    // 404 ไม่ใช่ 403 — บนโดเมนนี้ path พวกนั้นไม่มีอยู่จริง และการตอบ forbidden
    // เท่ากับยืนยันให้คนนอกรู้ว่ามี dashboard ซ่อนอยู่หลังโดเมนเดียวกัน
    res.status(404).end();
  });
  console.log(`[files-host] ${FILES_HOST} restricted to /pub/fil/* only`);
}

// 🔒 Security headers — token lives in localStorage for Safari ITP fallback,
// so XSS impact is higher than cookie-only auth. Apply conservative headers:
// nosniff stops MIME-type confusion, DENY blocks clickjacking, same-origin
// limits referrer leakage.
// SEC-006 / Phase 1b–5: CSP enforced on ALL routes (Phase 5 ✅ 2026-06-05).
//   /others/*  → Content-Security-Policy (enforced) — auth-gated, no dashboard deps
//   dashboard  → Content-Security-Policy (enforced) — zero inline scripts/handlers; policy gaps patched
// All inline onclick= / onerror= attrs removed (Phase 1–4). report-uri kept for drift detection.
app.disable('x-powered-by');

// ⏱ Slow-request log (2026-09-05 perf audit): api-server had no request-duration
// log at all, so a slow page could only be found by re-measuring everything by
// hand. Log-only — never throws, never touches control flow (WA#3.4).
const SLOW_REQ_LOG_MS = env.int('SLOW_REQ_LOG_MS');
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (ms < SLOW_REQ_LOG_MS) return;
      // Redact before truncating — slicing first can leave a token prefix behind.
      const url = String(req.originalUrl || '').replace(/(token|sig)=[^&]*/gi, '$1=***').slice(0, 200);
      const user = req.user?.username || (req.internal ? 'internal' : '-');
      console.warn(`[slow-req] ${res.statusCode} ${ms.toFixed(0)}ms ${req.method} ${url} user=${user} ip=${getIP(req)}`);
    } catch {}
  });
  next();
});

// ผูกคำขอ GET กับบริบทของ requestDb — ต้องอยู่ก่อน route ทุกตัว (หลัง slow-req log)
app.use(reqDb.middleware);

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
    const url = String(req.originalUrl || '');
    // Both of these authenticate over the bytes as sent, so the parsed object
    // is not good enough — re-serialising it would not reproduce the sender's
    // whitespace or key order and every signature would fail.
    if (url.startsWith('/api/line/webhook') || url.startsWith('/v1/')) req.rawBody = Buffer.from(buf);
  },
}));

// 🆕 Cookie parser (simple inline — ไม่ต้องลง package)
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const [k, ...v] = c.trim().split('=');
      // cookie ที่ % เสีย (เช่นจากเว็บอื่นใต้ .dojojin.tech) ห้ามทำทั้งคำขอล้ม — 31 ต.ค. 01:00 ทุกหน้าเป็น 500
      // เพราะ decodeURIComponent โยน URIError ⇒ ใช้ค่าดิบแทน
      if (k) { const raw = v.join('='); try { req.cookies[k] = decodeURIComponent(raw); } catch { req.cookies[k] = raw; } }
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
const publishSiteRetention = require('./helpers/publishSiteRetention');
const normalizeTimeOfDay = require('./helpers/normalizeTimeOfDay');
const { edgeProxyBaseUrl } = require('./helpers/edgeProxyBaseUrl');
const { edgeCall } = require('./helpers/edgeCall');
const { bundleIndexHtml } = require('./helpers/dashboardBundle');
const { OFFLINE_THRESHOLD_SEC } = require('./constants');
auth.init(pool, env.str('SESSION_SECRET'));

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
  '/pub/img/',            // ภาพแนบการแจ้งเตือน LINE — auth ด้วยลายเซ็น+วันหมดอายุใน URL
  '/pub/ref/',            // ภาพอ้างอิงบัญชีดำ (อยู่คนละโฟลเดอร์กับ snapshots)
                          //   ไม่ใช่ session (LINE เป็นคนมาดึง ไม่มี cookie ของเรา)
                          //   ดู src/helpers/signedImage.js
  '/pub/seek/',           // ภาพผลค้นหาอัจฉริยะที่แนบไปกับคำตอบใน LINE — ไม่ใช่ไฟล์บนดิสก์
                          //   URL ต้นทางถูกปิดผนึก (AES-GCM) + ลายเซ็น + วันหมดอายุ
                          //   และเปิดผนึกแล้วยังต้องผ่าน PIC_RE ซ้ำ ดู routes/acuseek.js
  '/pub/rpt/',            // รายงาน PNG ที่เรนเดอร์ด้วย Puppeteer — auth ด้วยลายเซ็น+วันหมดอายุใน URL
                          //   LINE fetch ผ่าน public URL ไม่มี session cookie
  '/pub/fil/',            // เอกสาร/ภาพอัปโหลดโดยแอดมิน — auth ด้วยลายเซ็น+วันหมดอายุใน URL
                          //   ลิงก์ออกเป็นโดเมนแยก (FILES_PUBLIC_URL = upl.dojojin.tech)
                          //   แต่ prefix ยังต้องเปิดที่นี่ เพราะทั้งสองโดเมนมาที่ origin เดียวกัน
                          //   และลิงก์เก่าที่ mint ก่อนตั้งค่ายังชี้มาที่ dashboard.dojojin.tech
  // /others/ removed — SEC-2T-001: default-deny; see OTHERS_PUBLIC below
];

// SEC-2T-001 — /others is default-deny; auth-gating prevents unauthenticated script execution
// on the same origin. Path comparison is lowercased to prevent APFS case-bypass (macOS APFS is case-insensitive).
const OTHERS_PUBLIC = new Set([]);
const OTHERS_PUBLIC_PREFIXES = [];

function isPublicAsset(reqPath) {
  // SEC — auth bypass ผ่าน path traversal (พบ 2026-08-24, reproduce แล้ว)
  //
  //   GET https://dashboard.dojojin.tech/pub/img/../../index.html
  //     → 200, 423 KB, dashboard เต็ม ๆ โดยไม่ต้องล็อกอิน
  //   GET https://dashboard.dojojin.tech/index.html
  //     → 302 เด้งไป login (พฤติกรรมที่ถูก)
  //
  // เหตุ: การเทียบ prefix ข้างล่างใช้ startsWith() กับ path ดิบ '/pub/img/../../x'
  // ขึ้นต้นด้วย '/pub/img/' จริง จึงถูกตัดสินว่าเป็น public แล้วข้าม auth ทั้งก้อน
  // ส่วน Express มา resolve '..' ทีหลังแล้วเสิร์ฟไฟล์ให้ กระทบ prefix ทุกตัว
  // ไม่ใช่แค่ /pub/ — /vendor/ /branding/ /tiles/ /face-push/ ก็โดนเหมือนกัน
  //
  // วิธีแก้ใช้ตรรกะเดียวกับ PARTNER_HOST ข้างล่าง ซึ่งเคยเจอบั๊กตัวเดียวกันและ
  // สรุปไว้แล้วว่า sanitize เอาไม่อยู่ (decode กี่รอบเราคุมไม่ได้) → ปฏิเสธรูปทรงแทน:
  // ห้ามมี '%' เลยแม้แต่ตัวเดียว (ฆ่าทุกกลเม็ด encoding ในกฎเดียว) และห้ามมี
  // segment ที่เป็น '.' หรือ '..'
  //
  // ตรวจแล้วว่าไม่ตัดของจริงทิ้ง: snapshot_filename 0 จาก 26,729,370 แถวที่มีอักขระ
  // ซึ่ง encodeURIComponent ต้อง escape · face_push_token ทั้ง 67 ตัว URL-safe หมด
  // · ไฟล์ใต้ vendor/ branding/ ก็เป็น [A-Za-z0-9._-] ล้วน
  // ไม่พอถ้าเช็คแค่ segment ที่เป็น '.' หรือ '..' — '..;' ไม่ใช่ทั้งคู่และไม่มี '%'
  // จึงรอดออกไปได้ (เทสต์ public-asset-traversal จับได้) ใช้กติกาเดียวกับ
  // PARTNER_HOST: ทุก segment ต้องขึ้นต้นด้วย alphanumeric ซึ่งตัดทั้ง '.' '..' '..;'
  // และ segment ว่างในคราวเดียว
  //
  // ตรวจแล้วว่าไม่ตัดของจริงทิ้ง: snapshot_filename 0 แถวที่มี segment ขึ้นต้นด้วย
  // ตัวอื่น · ไม่มีไฟล์ใต้ vendor//branding/ ที่ขึ้นต้นไม่ใช่ alphanumeric ·
  // .thumbs/.bboxcache เป็น cache ฝั่งเซิร์ฟเวอร์ ไม่เคยปรากฏใน URL สาธารณะ
  if (reqPath.includes('%')) return false;
  {
    const segs = reqPath.split('/');
    if (segs.length && segs[segs.length - 1] === '') segs.pop();   // trailing slash
    if (!segs.slice(1).every((seg) => /^[A-Za-z0-9]/.test(seg))) return false;
  }

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
  const s = env.str('INTERNAL_API_SECRET');
  if (!s || s.length < 32) {
    if (env.str('NODE_ENV') === 'production') {
      console.error('[security] INTERNAL_API_SECRET not set or too short in src/.env — refusing to start in production');
      process.exit(1);
    }
    console.warn('[security] INTERNAL_API_SECRET not set in src/.env — using ephemeral token; report-worker will not work');
    return require('crypto').randomBytes(32).toString('hex');
  }
  return s;
})();
const WORKER_PORT       = env.int('REPORT_WORKER_PORT');
const ALERT_WORKER_PORT = env.int('ALERT_WORKER_PORT');

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

// path ที่ express.static อาจเสิร์ฟไฟล์ให้ = ต้องล็อกอิน
// 🔴 โฟลเดอร์ (ลงท้าย /) ต้องนับด้วย — express.static เสิร์ฟ index.html ของโฟลเดอร์นั้นให้
//    เดิมเช็คแค่นามสกุล ⇒ /others/demo/<ชื่อ>/ ทุกโฟลเดอร์เปิดได้โดยไม่ล็อกอิน แม้ผ่าน Cloudflare
//    ขณะที่ /others/demo/<ชื่อ>/index.html ถูกกันตามปกติ (พบ 2026-10-20 · 20 โฟลเดอร์ · GOTCHAS #230)
function isGatedStaticPath(p) {
  return p === '/' || p.endsWith('/') ||
    /\.(html|js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ico)$/i.test(p);
}

// 🆕 Auth middleware สำหรับ static assets (HTML/JS/CSS/images served from dashboard/)
// API requests (/api/*) are gated separately by the global /api middleware below.
app.use(async (req, res, next) => {
  if (isPublicAsset(req.path)) return next();
  if (req.path.startsWith('/api/')) return next();  // /api/* has its own auth gate
  // Internal renderer (Puppeteer) — loads report-print.html + its assets.
  if (isValidInternalToken(req)) return next();

  // Treat any GET for an asset under dashboard/ as auth-required
  // HEAD ด้วย — express.static ตอบ HEAD ได้เหมือน GET
  const isStaticAsset = (req.method === 'GET' || req.method === 'HEAD') && isGatedStaticPath(req.path);
  if (!isStaticAsset) return next();

  const token = getSessionToken(req);
  const user = token ? await auth.getUserFromToken(token) : null;
  if (user) return next();

  // Unauthed: redirect HTML navigation to disclaimer/login flow; deny everything else
  if (token) {
    // Bad/expired token — clear cookie before redirecting
    res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
  }
  if (req.path.endsWith('/') || req.path === '/index.html' || req.path.endsWith('.html')) {
    return res.redirect('/disclaimer.html');
  }
  return res.status(401).type('text/plain').send('Authentication required');
});

// Branding assets + dashboard shell + static mounts (→ src/routes/static-shell.js)
// Required HERE, not hoisted with the other requires at the top: the module
// builds the dashboard bundle at load time, and that must still happen at this
// point in boot (after env/CORS setup) — same as the IIFE it replaces.
const ROOT_DIR = path.join(__dirname, '..');
const { BRANDING_DIR } = require('./routes/static-shell')(app, pool, {
  ROOT_DIR, env, getSystemSetting, bundleIndexHtml,
});

// Snapshot / public image / report / uploaded-file serving + bbox burn-in
// (→ src/routes/media-files.js). Returns the pieces still used further down.
const {
  THUMBS_DIR, BBOX_CACHE_DIR, thumbWidth, jpegResizer,
  MEDIA_DIR, REPORTS_DIR, FILES_DIR,
} = require('./routes/media-files')(app, pool, {
  ROOT_DIR, SNAPSHOT_DIR, BLACKLIST_PHOTO_DIR,
  env, sharp, auth, getSessionToken, isValidInternalToken,
  mediaScope, signedImage, viewAllows, edgeProxyBaseUrl, getSystemSetting,
});

// 👤 View allowlist สำหรับ route ที่ mount **เหนือ** global `/api` middleware
// (decision #250) — สามกลุ่มนี้ `req.user` ยังไม่ถูก set guard จึง resolve token เอง
// ต้องมาก่อน `require()` ข้างล่าง ไม่งั้น express ลงทะเบียน handler ไปแล้ว middleware
// ที่เพิ่มทีหลังจะไม่ทำงาน · `/api/auth/sessions` + `/api/audit-log` เป็น route ของแท็บ
// `history:sessions` / `history:audit` จึงต้องถูกกันตามสิทธิ์เหมือน route อื่น
const _viewGuard = viewGuard({ auth, getSessionToken, isValidInternalToken });
app.use(['/api/auth/sessions', '/api/audit-log', '/api/users'], _viewGuard);

// Authentication routes (→ src/routes/auth.js)
require('./routes/auth')(app, pool, { auth, getIP, getSessionToken });

// User Management + Audit Log + CSP reporter (→ src/routes/users.js)
// NOTE: must remain BEFORE the global /api auth middleware so that
// user management works when the license write-block is active.
require('./routes/users')(app, { auth, getIP, pool });

// 🔑 Partner API (→ src/routes/partner-api.js) — mounted at /v1, NOT /api.
// Partners have no session and no cookie; they sign each request with AK/SK.
// The three /api middlewares below all enforce session auth, so putting these
// routes under /api would either lock partners out or force a hole in the
// session check. Separate prefix, separate auth, no interaction.
require('./routes/partner-api')(app, pool);

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
  // site_admin ที่ยังไม่ผูก Site: scope ว่าง [] ถูกหลาย query ตีความเป็น "ไม่จำกัด" (พฤติกรรมเดิมของ viewer)
  // → admin เฉพาะไซต์ที่ไม่มีไซต์จะเห็น/แก้ได้ทุกไซต์ ปฏิเสธทั้งบัญชีไว้ก่อน (เว้น login/logout/เปลี่ยนรหัส)
  if (req.user.role === 'site_admin' && !(req.user.allowedSites && req.user.allowedSites.length)
      && !req.path.startsWith('/auth/')) {
    return res.status(403).json({ error: 'Site admin has no site assigned', code: 'NO_SITE_ASSIGNED' });
  }
  // แกนที่ 2 — จำกัดรายกล้อง (`user_cameras`, decision #253) · null = ไม่จำกัด
  // ค่าเดียวกันนี้ติดอยู่กับ allowedSites ในรูป property `cameras` ให้ siteWhere() ใช้
  req.user.allowedCameras = req.user.allowedSites ? (req.user.allowedSites.cameras || null) : null;
  next();
});

// 👤 View allowlist ของ route ทั้งหมดใต้ `/api` — default DENY สำหรับ user ที่ถูกจำกัด
// วางหลัง middleware ที่ set `req.user` (ไม่เสีย DB round-trip เพิ่ม) และก่อน
// `requireAdminForWrites` เพื่อให้ "ไม่มีสิทธิ์เห็นหน้านี้" ตอบก่อน "ต้องเป็น admin"
app.use('/api', _viewGuard);

// ทุกการเขียนของ Site Admin (ผ่านหรือถูกปฏิเสธ) ลง audit_log — เก็บแค่ชื่อช่องใน body ไม่เก็บค่า (รหัสผ่านกล้อง)
// เจ้าของขอ 2026-10-14: "ต้องมี audit logs ให้รู้ว่าใครเป็นคนเซ็ต เป็นคนเปลี่ยน" · fire-and-forget
function _auditSiteAdminWrite(req, deniedReason = null) {
  auth.logAudit(req.user?.id, req.user?.username, deniedReason ? 'site_admin_write_denied' : 'site_admin_write',
    null, null, getIP(req), req.headers['user-agent'], {
      method: req.method, path: (req.baseUrl || '') + req.path,
      body_fields: Object.keys(req.body || {}).slice(0, 40),
      site_id: req.body?.site_id ?? null,
      ...(deniedReason ? { reason: deniedReason } : {}),
    }).catch(() => {});
}

// 🔐 Admin-only middleware for write operations on critical resources
function requireAdminForWrites(resourcePath) {
  return async (req, res, next) => {
    if (req.path.startsWith(resourcePath) && req.method !== 'GET') {
      // Admin เฉพาะไซต์: เปิดเฉพาะ route ใน siteAdminGate.RULES + ตรวจไซต์ของเป้าหมาย
      // ทุก prefix ที่ครอบด้วยฟังก์ชันนี้ แต่ route ที่ไม่อยู่ใน RULES = 403 เหมือน viewer
      if (req.user?.role === 'site_admin') {
        const g = await checkSiteAdminWrite(req, { pool, loadGroups, loadCameraConfig });
        if (g.ok) { req.siteAdminWriteOk = true; _auditSiteAdminWrite(req); return next(); }
        _auditSiteAdminWrite(req, g.reason);
        return res.status(403).json({ error: 'Admin role required for this operation', code: 'SITE_ADMIN_SCOPE', reason: g.reason });
      }
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
app.use('/api/reports', requireAdminForWrites('/'));   // POST /send-now pushes to LINE; GETs (render/download) unaffected
app.use('/api/license', requireAdminForWrites('/'));
app.use('/api/storage', requireAdminForWrites('/'));
// DELETE /api/alert-logs TRUNCATEs the whole alert_logs table — must be
// admin-only. (GET stays open to viewers; requireAdminForWrites gates
// non-GET methods only.)
app.use('/api/alert-logs', requireAdminForWrites('/'));
// Blacklist source test-connection touches real external credentials against
// classified/government-operated systems — admin-only, not just any viewer.
// 🔴 /api/lpr เขียนได้เฉพาะ admin ยกเว้นงานของเจ้าหน้าที่ (ack · notify · mute) — helpers/lprWriteGuard.js
// site_admin: ตรวจไซต์ของรายการเฝ้าระวังก่อน (siteAdminGate) แล้วให้ lprWriteGuard อ่านผล — ตั้งธงฝั่งเซิร์ฟเวอร์เท่านั้น
app.use('/api/lpr', async (req, res, next) => {
  if (req.user?.role === 'site_admin' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const g = await checkSiteAdminWrite(req, { pool, loadGroups, loadCameraConfig });
    req.siteAdminWriteOk = g.ok === true;
    _auditSiteAdminWrite(req, g.ok ? null : g.reason);
  }
  next();
});
app.use('/api/lpr', require('./helpers/lprWriteGuard').lprWriteGuard);
app.use('/api/blacklist', requireAdminForWrites('/'));
app.use('/api/face-blacklist', requireAdminForWrites('/'));

// 👤 View registry — หน้า/แท็บทั้งหมดที่จำกัดสิทธิ์ต่อ user ได้ + สิทธิ์ของคนที่ถามมาเอง
// (decision #250) client ใช้สร้างเมนู/ตัดสินใจว่าจะโชว์หน้าไหน ส่วนการกันจริงอยู่ที่
// allowlist ฝั่ง server — endpoint นี้จึงเป็น "ความสะดวก" ไม่ใช่ "ความปลอดภัย"
// อยู่ใน CORE_ROUTES เสมอ ไม่งั้น user ที่ถูกจำกัดจะไม่มีเมนูให้กดเลย
app.get('/api/views', async (req, res) => {
  try {
    let message = 'อยู่ระหว่างการปรับปรุงการให้บริการ';
    try {
      const r = await pool.query("SELECT value FROM system_settings WHERE key='restricted_view_message'");
      if (r.rows[0]?.value) message = r.rows[0].value;
    } catch { /* ใช้ค่า default — ข้อความบล็อกไม่ควรทำให้ทั้ง endpoint ล้ม */ }
    res.json({
      views: viewRegistry.clientRegistry(),
      // auditor = เห็นทุกหน้า (อ่านอย่างเดียว) จึงต้องได้ null เหมือน server ตัดสิน
      // ไม่งั้นหน้าจอจะซ่อนเมนูเองทั้งที่ยิง API ได้จริง (แบนเนอร์บอกว่าดูได้ทุกหน้า)
      allowed: effectiveViews(req.user),         // null = ไม่จำกัด
      landing: req.user?.landing_view ?? null,
      message,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Phase 8.0 — License enforcement
// ============================================================
// 60-second cache so we don't hit the DB on every API request. Bumped
// to a fresh read whenever activate/deactivate happens.
const _licenseStateCache = createTtlCache({ name: 'license:state', ttlMs: 60_000, max: 1 });
const getCurrentLicenseState = () =>
  _licenseStateCache.wrap('state', () => license.computeLicenseState(pool));
function invalidateLicenseStateCache() { _licenseStateCache.clear(); }

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

const { wss, broadcast } = require('./ws/hub')({
  server, WebSocket, auth, pool,
  mediaScope, viewRegistry, viewAllows, scrubRawJson,
});

// LPR watch-list plate cache — so the new_event broadcast can flag an anprAlarm
// as a watch-list ALERT (vs a plain read) without a DB query per event. Plates
// are normalized (UPPER, spaces stripped) to match on both sides. Refreshed on a
// timer; the watch-list is small and changes rarely.
const lprLineAlert = require('./helpers/lprLineAlert');
const _normPlate = (p) => String(p || '').toUpperCase().replace(/\s+/g, '');
// Keys are "PLATE" for plate-only rows and "PLATE|Province" for plate_region
// ones, so the flag obeys the same rule the alert queries do. The old set held
// bare plates while every one of the 482 active rows is plate_region, which
// meant a plate matching in the wrong province was flagged as a watch-list hit
// — the exact false-collision #130 measured at 93% and removed from the alert
// path. Both key shapes live in one set because a list can hold both modes.
// ค่าของ Map = site_id ของกลุ่ม (null = Global) — กลุ่มเฉพาะ Site จับคู่เฉพาะกล้องของ Site นั้น
// กฎเดียวกับ helpers/watchScope.js ที่ query ฝั่งหน้าจอ/สถิติใช้ (migration 261)
let _lprWatchSet = new Map();
async function _refreshLprWatch() {
  try {
    const { rows } = await pool.query(
      `SELECT w.plate_number, w.alert_mode, w.region, g.site_id
         FROM lpr_watchlist w LEFT JOIN lpr_watchlist_groups g ON g.id = w.group_id
        WHERE w.active`);
    _lprWatchSet = new Map(rows.map(r => [r.alert_mode === 'plate_region'
      ? `${_normPlate(r.plate_number)}|${r.region || ''}`
      : _normPlate(r.plate_number), r.site_id ?? null]));
  } catch (e) {
    // บรรทัดนี้รันตอนโหลดโมดูล ก่อน migration 261 จะเพิ่ม g.site_id (เจอจริงตอน deploy 2026-10-14) —
    // ถ้าปล่อยให้ล้ม เซ็ตจะว่างจนรอบถัดไป 5 นาที = ป้ายเฝ้าระวังไม่แจ้ง LINE เลย · ถอยไปใช้แบบเดิม (ทุกกลุ่ม = Global)
    console.warn('[lpr-watch] refresh:', e.message, '— fallback ไม่มีขอบเขต Site');
    try {
      const { rows } = await pool.query('SELECT plate_number, alert_mode, region FROM lpr_watchlist WHERE active');
      _lprWatchSet = new Map(rows.map(r => [r.alert_mode === 'plate_region'
        ? `${_normPlate(r.plate_number)}|${r.region || ''}` : _normPlate(r.plate_number), null]));
    } catch (e2) { console.warn('[lpr-watch] fallback refresh:', e2.message); }
  }
}
let _watchChangedTimer = null;
async function _lprWatchHit(plate, region, cameraId) {
  if (!plate) return false;
  const key = _lprWatchSet.has(plate) ? plate : (_lprWatchSet.has(`${plate}|${region}`) ? `${plate}|${region}` : null);
  if (key === null) return false;
  const site = _lprWatchSet.get(key);
  if (site == null) return true;
  const { rows } = await pool.query('SELECT site_id FROM cameras WHERE id = $1', [cameraId]);
  return rows[0]?.site_id === site;
}
_refreshLprWatch();
setInterval(() => { _refreshLprWatch(); }, 5 * 60 * 1000);

// Phase 6.1.5 — Postgres LISTEN bridge: forward clip_done notifications
// from media-recorder.js to all connected WebSocket clients so the Media
// page can update without polling. Uses a dedicated pg.Client (LISTEN can't
// run on a pooled connection).
{
  const { Client } = require('pg');
  const { listenForever } = require('./helpers/pgListen');
  const onWsBridgeNotification = async (msg) => {
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
    if (msg.channel === 'storage_purge_result') {
      // ผลลบไฟล์จาก edge — resolve คำสั่งที่ค้างอยู่ให้ GET /api/storage/purge/:reqId อ่านได้
      try {
        const p = JSON.parse(msg.payload);
        if (p.reqId) require('./helpers/purgeRegistry').resolve(p.reqId, p);
      } catch {}
      return;
    }
    if (msg.channel === 'camera_mqtt_result') {
      // ผลส่งค่า MQTT เข้ากล้อง Bosch จาก edge — resolve คำสั่งที่ POST
      // /api/cameras/:id/push-mqtt กำลัง waitFor() ค้างอยู่
      try {
        const p = JSON.parse(msg.payload);
        if (p.req_id) require('./helpers/cameraMqttRegistry').resolve(p.req_id, p);
      } catch {}
      return;
    }
    if (msg.channel === 'watchlist_changed') {
      // migration 262 — รายการ/กลุ่มป้ายเปลี่ยน: โหลดชุดที่ใช้ยิง LINE ใหม่ทันที (เดิมรอรอบ 5 นาที)
      // และล้างแคชสถิติ LPR ให้ตัวเลข "ตรงเฝ้าระวัง" ตามทัน · debounce กัน bridge sync ยิงรัว
      if (/^lpr_watchlist/.test(msg.payload)) {
        clearTimeout(_watchChangedTimer);
        _watchChangedTimer = setTimeout(() => {
          _refreshLprWatch();
          try { app.locals.clearLprStatsCache?.(); } catch {}
        }, 1000);
      }
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
          // data.Object is Dahua's TrafficJunction envelope and Hikvision has
          // none, so reading only that flagged nothing from Phuket: 11 of 32
          // real watch-list hits in a week (34%) were silently treated as
          // ordinary reads and dropped into a side list carrying 300 plates a
          // minute. Both ingesters normalise `plate` and `region` to the top
          // level, and `region` is already a Thai province name from both, so
          // no code lookup is needed here.
          const _rj = row.raw_json || {};
          const _pl = _normPlate(_rj.plate || _rj.data?.Object?.Text);
          const _rg = _rj.region || '';
          row._lprAlert = await _lprWatchHit(_pl, _rg, row.camera_id);
          // LINE for watch-list hits. Fire-and-forget on purpose: this path
          // carries ~300 plate reads a minute and must not wait on LINE, or
          // stall behind it when LINE is slow. The helper never throws and
          // records every outcome — sent or suppressed — in alert_logs.
          if (row._lprAlert) {
            (async () => {
              try {
                const { rows: gr } = await pool.query(
                  `SELECT group_id FROM lpr_watchlist
                    WHERE plate_number = $1 AND active LIMIT 1`, [_pl]);
                const groupId = gr[0]?.group_id;
                if (!groupId) return;   // ungrouped plate has no notify switch to read
                // No siteCode passed: the helper resolves it from the same
                // join it needs anyway for the camera name in the message, so
                // a cache here would be a second copy to keep in sync.
                await lprLineAlert.sendLprAlert({
                  pool, lineSender, event: row, plate: _pl, region: _rg, groupId,
                });
              } catch (e) { console.error('[lpr-line]', e.message); }
            })();
          }
        }
        broadcast({ type: 'new_event', event: row });
        // alert push ย้ายไป alert-engine.onEvent (คุมด้วย alert_rules ต้นทาง)
      } catch (e) {
        console.error('[ws-bridge] new_event lookup:', e.message);
      }
      return;
    }
  };
  // 🔴 ต้องต่อกลับเองเมื่อหลุด — เดิมมีแค่ on('error', log) หลุดตอน Postgres crash 2026-09-26 แล้ว
  // dashboard ไม่ได้ event สด ~29 ชม. จน restart (GOTCHAS #217 · helpers/pgListen.js)
  // สถานะการเชื่อมต่อให้หน้า Health อ่าน (routes/health.js → integrity.ws_bridge_connected)
  app.locals.wsBridgeListen = listenForever({
    label: 'ws-bridge',
    channels: ['clip_done', 'new_event', 'event_snapshot', 'scan_result', 'storage_purge_result', 'camera_mqtt_result', 'watchlist_changed'],
    onNotification: onWsBridgeNotification,
    makeClient: () => new Client({ ...env.db() }),
  });
}

// Occupancy tracker — live "People in Area" KPI (→ src/helpers/occupancy.js).
// คืน Map ตัวจริงกลับมา ไม่ใช่สำเนา — routes/stats อ่านก้อนเดียวกับที่ตัวบันทึกเขียน
const {
  OCC_SMOOTH_WINDOW_MS, occupancy: _occupancy, recordOccupancySample,
} = require('./helpers/occupancy')({ broadcast });


// ============================================================
// API: Cameras + Live Snapshot Proxy (→ src/routes/cameras.js)
// ============================================================

// Mapbox token: DB-first (decision #171), fallback .env, module-level cache
let _cachedMapboxToken = null;
async function getMapboxToken() {
  if (_cachedMapboxToken !== null) return _cachedMapboxToken;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='mapbox_token'");
    _cachedMapboxToken = r.rows[0]?.value || env.str('MAPBOX_TOKEN');
  } catch { _cachedMapboxToken = env.str('MAPBOX_TOKEN'); }
  return _cachedMapboxToken;
}

// CARTO API key: DB-first, fallback .env, module-level cache
// This one is sent to the browser intentionally (not proxied like Mapbox) — CARTO keys are
// public by design (not billable, documented in browser URLs). Direct CDN load preserves
// parallelism and avoids cache/disk bloat from proxying. (Decision #2 in carto-plan.md)
let _cachedCartoKey = null;
async function getCartoKey() {
  if (_cachedCartoKey !== null) return _cachedCartoKey;
  try {
    const r = await pool.query("SELECT value FROM system_settings WHERE key='carto_api_key'");
    _cachedCartoKey = r.rows[0]?.value || env.str('CARTO_API_KEY');
  } catch { _cachedCartoKey = env.str('CARTO_API_KEY'); }
  return _cachedCartoKey;
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
  getMapboxToken, getCartoKey,
  license, getCurrentLicenseState,
  thumbWidth, jpegResizer,
  SNAPSHOT_DIR,
});

// Camera Groups (→ src/routes/groups.js)
require('./routes/groups')(app, pool, { auth, getIP, loadGroups, saveGroups, logCameraAudit: _logCameraAudit });

// ============================================================
// API: Events
// ============================================================

// ชนิดของ event ที่ไม่นับเป็น "เหตุการณ์" — metric samples (CountAggregation/*)
// กับ camera-automation analytics (→ src/helpers/analyticsEvents.js)
// คืน getter ของ enabled set กลับมา ไม่ใช่ตัว Set เพราะตัวรีเฟรชแทนที่ทั้งก้อนทุกรอบ
const {
  METRIC_EVENT_TYPE_PATTERN, isMetricEventType,
  ANALYTICS_EVENT_KEYS, ANALYTICS_KEY_SQL,
  analyticsEventClause, getAnalyticsEnabledSet, refreshAnalyticsEnabledSet,
  isHiddenAnalyticsEvent, disabledAnalyticsClause,
} = require('./helpers/analyticsEvents')({ pool });

require('./routes/events')(app, pool, {
  getDisplayTz,
  getAnalyticsEnabledSet,
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
require('./routes/map')(app, pool, { getMapboxToken, getCartoKey, routeError });

// ============================================================
// API: Alert Rules + LINE Config (LINE Notification System)
// ============================================================

const lineSender = require('./line-sender');
const pushSender = require('./push-sender');

// Push tokens + Alert logs + Backups (→ src/routes/ops.js)
require('./routes/ops')(app, pool, { auth, getIP });

// 3rd Party Integration console (→ src/routes/integrations.js) — the operator's
// view of who can read what. Under /api and admin-gated, the mirror image of
// routes/partner-api.js which is the partners' view of us.
require('./routes/integrations')(app, pool, { auth, getIP });

// ============================================================
// LINE Config + Webhook (→ src/routes/line.js)
// ============================================================
require('./routes/line')(app, pool, { auth, getIP, routeError });
// ตั้งค่าคำสั่งผ่าน LINE (ผู้มีสิทธิ์สั่ง / คำสั่ง / ปูม / ทดลองสั่ง)
require('./routes/line-commands')(app, pool, { auth, routeError });

// ============================================================
// Telegram Config + Pending Chats (→ src/routes/telegram.js) — T1
// ============================================================
require('./routes/telegram')(app, pool, { auth, getIP, routeError });
// poller (long-poll getUpdates) เริ่มหน่วงตอน boot — ดูจุดเริ่มจริงข้าง
// LINE push-quota watcher ด้านล่าง (เหตุผลเดียวกัน: กัน boot storm + ให้ migration
// 240 มีเวลารันก่อนที่ตัวแรกจะ SELECT ตาราง telegram_config)

// Alert Rules CRUD + suggestions (→ src/routes/alert-rules.js)
require('./routes/alert-rules')(app, pool);

// ช่องทางแจ้งเตือนประจำระบบ — HCP Face · AuraFace · LPR (migration 146)
// แยกจาก Alert Rules เพราะเป็นส่วนหนึ่งของระบบ ลบไม่ได้ และมีหน้า config ของตัวเอง
require('./routes/alert-channels')(app, pool, { auth, routeError });

// ============================================================
// Report Schedules (Phase 7.3 — scheduled report delivery)
// ============================================================
require('./routes/report-schedules')(app, pool, { WORKER_PORT, INTERNAL_API_TOKEN });

// ============================================================
// Report History + PDF + Daily/Weekly data (→ src/routes/reports.js)
// ============================================================
require('./routes/reports')(app, pool, {
  routeError,
  REPORTS_DIR, getBrandForReport, INTERNAL_API_TOKEN, getDisplayTz,
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

// AuraFace-v1 hits + roster (Internal Test & Development) — kept off the
// faces.js routes above on purpose, see routes/face-blacklist.js header.
require('./routes/face-blacklist')(app, pool, { SNAPSHOT_DIR });

// HC2 — ค้นใบหน้าด้วยรูปผ่าน HCP (ขอบเขต HKT เท่านั้น)
require('./routes/hcp')(app, pool, { auth });

// ค้นหาอัจฉริยะ — พิมพ์ไทยแล้วค้นวิดีโอย้อนหลัง (AcuSeek, ขอบเขต HKT เท่านั้น)
require('./routes/acuseek')(app, pool, { auth });

// หน้ากวดขันวินัยจราจร — อ่านจากตารางสรุป traffic_hourly_stats (migration 142)
require('./routes/traffic')(app, pool, { auth, routeError });
// ตัวเติมตารางสรุป รันในตัว api-server เอง ไม่ต้องตั้ง pm2 process ใหม่
// เจ้าของเดียวของทั้งสี่งาน (helmet criteria · traffic · kpi · category rollup)
// พร้อมตารางเวลาบูตแบบเหลื่อม, advisory lock กันสอง process ทำซ้ำ และ status()
// ที่ /api/health/details อ่าน → src/jobs/rollups.js (VMOD-05)
require('./jobs/rollups').start({ pool });
// ยามรายสัปดาห์ของนิยาม "ไม่ทราบทะเบียน" (migration 199) — ไม่ใช่ตัวเติมตาราง
// เทียบ predicate `plate` ว่าง กับ anti-join license_plates เดิม แล้วเก็บผลไว้ให้
// /api/health/details อ่าน · อาทิตย์ 04:30 น. ไม่รันตอนบูต
require('./helpers/noreadCheck').start(pool);
// ยามรายวันของตัวเลข "ไม่สวมหมวก · พร้อมข้อมูลทะเบียน" (RCA 2026-09-18 ข้อ 8.3) —
// ทั้งไซต์เคยเป็นศูนย์ 5 วันโดยไม่มีอะไรร้อง · 05:30 น. หลัง reconcile รายคืนจบ
require('./helpers/helmetMetricCheck').start(pool);
// ยามเฝ้าความเร็วรายวัน 18:25 — เทียบ pg_stat_statements กับ 7 วันก่อน (preventive P2 · 2026-10-06)
require('./helpers/perfWatch').start(pool);
// ยามเฝ้า partner API รายวัน 08:30 — ข้อตกลงครบทบทวน/หมดอายุ + ใช้งานผิดรูป → LINE ถึงผู้รับ perf_alert (OpenAPI R3 · 2026-10-22)
require('./helpers/partnerWatch').start(pool);

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
require('./routes/lpr-query')(app, pool, statsPool);

// LPR watchlist — CRUD for plate alert list
require('./routes/lpr-watchlist')(app, pool, { SNAPSHOT_DIR });
require('./routes/lpr-gates')(app, pool);  // RF4 — gate config CRUD
require('./routes/lpr-alerts')(app, pool); // RF-ALERT — watch-list hit alerts + ack
require('./routes/lpr-gs-alarms')(app, pool); // GuruSquare (HKT) Events Alarm feed — read-only
// Blacklist reservoir — sources CRUD/discover/import + master read side (migration 093/094)
require('./routes/blacklist-sources')(app, pool);
// IM3-R: cross-site face push receiver — camera auth via per-camera token in path
require('./routes/face-push')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });

// ============================================================
// Sites — multi-site lookup (→ src/routes/sites.js)
// ============================================================
require('./routes/sites')(app, pool, { auth, loadCameraConfig, saveCameraConfig, loadGroups, saveGroups, SNAPSHOT_DIR });

// ── งานลบไซต์ที่ค้าง (process ตายกลางทาง) → รันใหม่จากต้น · ทุกขั้น idempotent (S5) ──
// หน่วง 60s แบบเดียวกับงาน boot อื่น กัน boot storm
setTimeout(() => {
  require('./helpers/sitePurge').resumePendingPurge(pool, {
    loadCameraConfig, saveCameraConfig, loadCameraGroups: loadGroups, saveCameraGroups: saveGroups, snapshotDir: SNAPSHOT_DIR,
  }).catch((e) => console.error('[site-purge] resume failed:', e.message));
}, 60_000).unref?.();

// ============================================================
// Event Categories & Mapping Rules (→ src/routes/categories.js)
// ============================================================
require('./routes/categories')(app, pool);

// System Settings (→ src/routes/settings.js)
require('./routes/settings')(app, pool, {
  auth, getIP, ANALYTICS_EVENT_KEYS, refreshAnalyticsEnabledSet,
  invalidateMapboxToken: () => { _cachedMapboxToken = null; },
  invalidateCartoKey: () => { _cachedCartoKey = null; },
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

// สั่งรันงาน rollup ด้วยมือ (→ src/routes/jobs.js) — สถานะอ่านที่ /api/health/details
require('./routes/jobs')(app, pool, { auth, routeError });

// Host performance series for the Performance tab (→ src/routes/metrics.js).
// Kept out of health/details deliberately — see that file's header for why.
require('./routes/metrics')(app, pool, { auth, routeError });

// Device + integration inventory for the Maintenance tab (→ src/routes/devices.js).
require('./routes/devices')(app, pool, { auth, routeError, loadCameraConfig });

// REPORTS_DIR ใช้ตัวที่ประกาศไว้แล้วด้านบน ห้ามคำนวณใหม่ — ประกาศซ้ำแล้ว resolve
// ไปคนละที่คือ 404 ถาวรที่ดูเหมือนบั๊กอื่น (เจอมาแล้วตอนทำ /pub/rpt)
// ── ส่งค่า retention ให้ทุก edge ตอน boot ─────────────────────────
// เดิม publishSiteRetention ถูกเรียกจาก PUT /api/sites/:id/retention ที่เดียว คือ
// ต่อเมื่อมีคนกด save ตั้งค่าไซต์ ไซต์ที่ไม่เคยมีใครกด จึงไม่เคยได้รับค่าเลย
//
// ผลจริงที่เจอ 2026-08-24: ไม่มี retained _config/retention บน EMQX แม้แต่ข้อความเดียว
// → _retention.lpr_days/face_days เป็น undefined ทุก edge → edge/bridge.js:447
// ข้ามการ prune ทั้งสองโฟลเดอร์ ("if (!Number.isFinite(days)) continue")
// → ภาพ LPR ที่ hkt สะสมมา 27 วันโดยไม่มีอะไรลบ จนดิสก์ที่เก็บ snapshot เต็ม 93%
// ส่วน events รอดเพราะมี fallback เป็น EDGE_IMG_DAYS ในโค้ด
//
// ส่งซ้ำตอน boot ทำให้สถานะนี้ซ่อมตัวเองได้ ข้อความเป็น retained อยู่แล้ว
// edge ที่ต่อเข้ามาทีหลังจึงได้ค่าทันทีโดยไม่ต้องรอ boot รอบถัดไป
setTimeout(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code FROM sites WHERE retention_events_days IS NOT NULL
          OR retention_lpr_days IS NOT NULL OR retention_face_days IS NOT NULL
          OR status <> 'active'`);   // 🧊 ไซต์ปิดปรับปรุงต้องได้ hold:true แม้ไม่ได้ตั้ง retention
    for (const s of rows) {
      try { await publishSiteRetention(s.id, pool); }
      catch (e) { console.warn(`[edge-config] ส่ง retention ให้ ${s.code} ไม่สำเร็จ:`, e.message); }
    }
    if (rows.length) console.log(`[edge-config] ส่งค่า retention ให้ ${rows.length} ไซต์ตอน boot`);
  } catch (e) { console.warn('[edge-config] อ่านรายชื่อไซต์ไม่สำเร็จ:', e.message); }
}, 45_000).unref?.();

// ── LINE push-quota watcher (migration 239) ─────────────────────
// ตรวจทุก 2 นาที: ตัวเลข consumption ของ LINE เอง + error "monthly limit" จริงใน
// alert_logs ของเดือนนี้ · ส่งคำเตือนได้อย่างมากเดือนละ 1 ครั้ง — ดู
// src/helpers/lineQuotaWatch.js. หน่วง 60s แรกกัน boot storm ชนกับ query อื่น
const { checkQuota: _checkLineQuota } = require('./helpers/lineQuotaWatch');
setTimeout(() => {
  setInterval(() => { _checkLineQuota(pool).catch((e) => console.error('[line-quota-watch]', e.message)); },
    2 * 60 * 1000).unref?.();
}, 60_000).unref?.();

// ── Telegram long-poll getUpdates() (migration 240 T1 · migration 242 T4) ────
// ตัวเดียวต่อ process (pm2 fork เดียว) — poll_offset/enabled/token อ่านสดจาก DB
// ทุกรอบเองอยู่แล้ว จึงไม่ต้อง restart หลังเปิด/ตั้ง token จากหน้าเว็บ — ดู
// src/helpers/telegramPoller.js. หน่วง 60s แรกเหมือน LINE quota watcher ข้างบน
// (กัน boot storm + ให้ migration 240 รันก่อนที่ตัวแรกจะ query ตาราง telegram_config)
// auth/baseUrl (T4): คำสั่งผ่าน Telegram ยิง endpoint ในนามผู้สั่งจริงผ่าน loopback
// ตัวเดียวกับที่ routes/line.js ทำให้ webhook ของ LINE
setTimeout(() => {
  require('./helpers/telegramPoller').startTelegramPoller(pool,
    { auth, baseUrl: `http://127.0.0.1:${env.int('API_PORT')}` });
}, 60_000).unref?.();

require('./routes/storage')(app, pool, {
  SNAPSHOT_DIR, REPORTS_DIR, FILES_DIR, MEDIA_DIR,
  PHOTO_DIR: require('./helpers/blacklistImport').PHOTO_DIR,
});

// Files (admin-only file host for sharing docs/images with customers)
require('./routes/files')(app, pool, auth);

// ============================================================
// Retention enforcement (daily)
// ============================================================
// ทุกการกวาดของรอบวัน + ตารางเวลาบูตแบบเหลื่อม → src/jobs/retention.js
// เรียก ณ จุดเดิมที่ timer เคยถูกประกาศ ค่าหน่วงทุกตัวจึงไม่เปลี่ยน
require('./jobs/retention').start({
  pool, getSystemSetting, retentionBeat,
  SNAPSHOT_DIR, THUMBS_DIR, BBOX_CACHE_DIR, MEDIA_DIR, REPORTS_DIR, FILES_DIR,
});

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
const PORT = env.int('API_PORT');
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
  const BIND_HOST = env.str('BIND_HOST');
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

// 🔴 GOTCHAS #76 ต่อยอด (2026-09-15, ปมเดียวกับรายงาน HKT hourly-dropout):
// กล้อง Hikvision push ส่ง `videoloss` heartbeat ทุก ~10 วิ เป็น keep-alive
// (hikvision-isapi.js:250) — เครือข่ายที่หลุดเป็นรอบ (ทุกชั่วโมง) บางทีมี
// heartbeat แค่ 1 แพ็กเก็ตหลุดผ่านมาได้ ระบบเดิมพลิกเป็น "online" ทันทีจาก
// heartbeat เดียว ไม่มีการยืนยันซ้ำเลย ⇒ ยิง "กลับมาออนไลน์!" หลอก แล้ว 90s
// ให้หลัง offline คืน (ยืนยันจริงจาก camera_status_log ของ C2-KML-SB-02:
// online→offline ห่างกันแค่ 90 วิ 3 รอบติดในวันเดียว, last_event_at เป็น NULL
// ตลอด — ไม่เคยมี event จริงเกิดขึ้นเลยระหว่าง "online" นั้น) ยืนยันจากภาคสนาม
// ด้วยว่ากล้องไม่เคยกลับมาใช้งานได้จริง (Louis 2026-09-15)
// ⇒ ต้องเห็น heartbeat สดต่อเนื่องข้าม poll cycle ที่สอง (นี่คือ 2) ก่อนถึงจะ
// พลิกเป็น "online" จริง — เฉพาะกล้องที่ DB ยังคิดว่า offline อยู่เท่านั้น
// (กล้องที่ online อยู่แล้วไม่ต้องรอ ไม่งั้นทุกกล้องจะดีเลย์ 30s โดยไม่จำเป็น)
const _onlineConfirm = new Map();   // camera_id → จำนวน poll ติดกันที่ heartbeat สด
const ONLINE_CONFIRM_POLLS = 2;

// ── แจ้งเตือนซ้ำ (escalation) ให้เป็นนาฬิกาเดียวกันทั้งกลุ่มผู้รับ (เจ้าของสั่ง
// 2026-09-15) ────────────────────────────────────────────────────────────
// ของเดิม: sinceLastAlert คำนวณจาก last_alert_at ของกล้อง**ตัวเอง** — กล้องแต่ละ
// ตัวดับคนละเวลา ได้ alert ครั้งแรกคนละเวลา ⇒ รอบแจ้งซ้ำกระจายกันไปเรื่อย ๆ ไม่มี
// วันมาตรงกัน (เจ้าของเห็นจริง: "เห็นพฤติกรรมเตือนเป็นระยะๆ แบบกระจายกัน")
// ⇒ ย้ายนาฬิกา "แจ้งซ้ำ" จากระดับกล้องไปเป็นระดับ**กลุ่มผู้รับ** (recipient_ids)
// แทน — ครั้งแรกของแต่ละกล้องยังเป็นอิสระเหมือนเดิม (ตาม notify_after_sec ของ
// ตัวเอง) แต่พอจะแจ้ง "ซ้ำ" ครั้งต่อไป ให้ยึดนาฬิกากลุ่มแทนนาฬิกาตัวเอง — กล้อง
// ที่ยังดับอยู่ทุกตัวในกลุ่มเดียวกันจะถูกดึงมาแจ้งพร้อมกันในข้อความเดียว
// (_sendGroupedCameraAlerts จัดกลุ่มตาม recipient_ids อยู่แล้ว)
const _groupEscalation = new Map();  // recipient_ids → เวลาที่ควรแจ้งซ้ำรอบถัดไป (ms epoch)

// ── ด่านที่สอง: ยืนยันด้วยการยิงไปเอา snapshot จริงจากกล้อง (เจ้าของสั่ง 2026-09-15) ──
// heartbeat สดต่อเนื่อง 2 รอบ (ด่านแรกข้างบน) บอกได้แค่ว่า "มีแพ็กเก็ตหลุดมาถึง"
// ไม่ได้ยืนยันว่ากล้องใช้งานได้จริง — เจ้าของขอให้ก่อนประกาศ online ต้องยิงไปขอ
// snapshot จริงจากกล้อง ถ้าไม่ได้ภาพกลับมา = ยังไม่ถือว่าติด
//
// 🔴 central ต่อ IP กล้องที่ site ไม่ได้เลย (ทดสอบจริง 2026-09-15: ping/curl ไปหา
// กล้อง HKT timeout ทั้งคู่ ไม่มี route ไปวง LAN ของไซต์) ⇒ ต้องให้ edge ของไซต์
// นั้นเป็นคนยิงแทน (มันอยู่ LAN เดียวกับกล้อง) ผ่าน edgeCall() ตัวเดียวกับที่ใช้
// เรียก edge อยู่แล้วหลายที่ (face-engine, blacklist push) endpoint ใหม่อยู่ที่
// src/lpr-receiver.js: POST /probe-camera-snapshot
//
// 🔴 กันบัญชีกล้องถูกล็อก (feedback_hik_digest_lockout, GOTCHAS #144 —
// Hikvision ล็อก ~30 นาทีถ้า digest auth fail ซ้ำ ๆ): เรียกเฉพาะตอน heartbeat
// ยืนยันครบ 2 รอบแล้วเท่านั้น (ไม่ใช่ทุก poll ให้ทุกกล้องที่ดับอยู่) + มี cooldown
// กันยิงถี่ตอน heartbeat ค้างจริงแต่ probe ล้มซ้ำ + auth fail ติดกัน 2 ครั้ง =
// เลิกยิงชั่วคราว 35 นาที (mirror AUTH_GIVEUP_AFTER ของ edge-config-agent.js
// เป๊ะ) แล้วตกกลับไปเชื่อ heartbeat อย่างเดียวแทน ไม่ใช่ค้าง offline ถาวร
const _snapshotConfirm = new Map();  // camera_id → { nextAttemptAt, authFailStreak, authHeldUntil }
const SNAPSHOT_CONFIRM_COOLDOWN_MS = 2 * 60_000;   // อย่างน้อย 2 นาทีระหว่างครั้งที่ยิงจริง
const SNAPSHOT_AUTH_GIVEUP_AFTER = 2;
const SNAPSHOT_AUTH_BACKOFF_MS = 35 * 60_000;      // เท่ากับ edge-config-agent.js เป๊ะ

async function _confirmCameraViaSnapshot(pool, cameraId, siteCode) {
  // site 'main' (central เอง) หรือไม่รู้ site — ไม่มี edge ให้ยิงแทน ตกกลับไปเชื่อ
  // heartbeat อย่างเดียวเหมือนก่อนมีด่านนี้ ไม่บล็อกอะไร
  if (!siteCode || siteCode === 'main') return true;

  const st = _snapshotConfirm.get(cameraId) || { nextAttemptAt: 0, authFailStreak: 0, authHeldUntil: 0 };
  const nowMs = Date.now();

  // auth fail ติดกันครบแล้ว — พักการยิง 35 นาที กันบัญชีกล้องถูกล็อกซ้ำ แล้วเชื่อ
  // heartbeat แทนระหว่างนี้ (ไม่ใช่ปฏิเสธ online ถาวรเพราะ credential ผิด)
  if (st.authHeldUntil && nowMs < st.authHeldUntil) return true;
  // cooldown จากครั้งก่อนที่ยิงแล้วไม่เจอภาพ (ไม่ใช่ auth) — ยังไม่ถึงเวลาลองใหม่
  if (nowMs < st.nextAttemptAt) return false;

  let result;
  try {
    // 🔴 timeout ต้องเผื่อ worst case ของฝั่ง edge เอง (แก้ 2026-09-15 หลังทดสอบจริง
    // กับ C2 ที่ออฟไลน์แท้ ๆ แล้วเจอ "edge timeout" ทั้งที่ยังไม่ผิดพลาด) —
    // lpr-receiver.js ลอง candidate URI สูงสุด 5 เส้น (snapshot_path + 4 fallback)
    // ทีละเส้น เส้นละ 4s = worst case ~20s ตั้ง 25s กันพอดีเป๊ะจนพลาดบ่อย
    const r = await edgeCall(siteCode, '/probe-camera-snapshot', { camera_id: cameraId }, 25000);
    result = r.body || {};
  } catch (e) {
    console.warn(`[camera-snapshot-confirm] เรียก edge ${siteCode} ไม่สำเร็จ (${cameraId}):`, e.message);
    result = { found: false, reason: 'edge_unreachable' };
  }

  if (result.found) {
    _snapshotConfirm.delete(cameraId);
    return true;
  }

  if (result.reason === 'auth') {
    const authFailStreak = st.authFailStreak + 1;
    if (authFailStreak >= SNAPSHOT_AUTH_GIVEUP_AFTER) {
      console.warn(`[camera-snapshot-confirm] ${cameraId} auth fail ติดกัน ${authFailStreak} ครั้ง — `
        + `พักการยิง 35 นาที (กันบัญชีกล้องถูกล็อก) เช็ค username/password ในตั้งค่ากล้อง`);
      _snapshotConfirm.set(cameraId, { nextAttemptAt: 0, authFailStreak: 0, authHeldUntil: nowMs + SNAPSHOT_AUTH_BACKOFF_MS });
    } else {
      _snapshotConfirm.set(cameraId, { ...st, authFailStreak, nextAttemptAt: nowMs + SNAPSHOT_CONFIRM_COOLDOWN_MS });
    }
    return false;
  }

  // เหตุอื่น (unreachable/timeout/ไม่ใช่ภาพ) — ไม่นับเป็น auth fail streak แค่พัก
  // cooldown ปกติก่อนลองใหม่
  // log เมื่อเหตุผลเปลี่ยน — เดิมเงียบทั้งหมด กล้อง Bosch 8 ตัวจึงติด offline ถาวร 2 สัปดาห์
  // (ตอบ http_400 เพราะไม่มี path ของ Bosch) โดยไม่มีใครเห็น (GOTCHAS #217)
  if (result.reason !== st.lastReason) {
    console.warn(`[camera-snapshot-confirm] ${cameraId} ยืนยันด้วยภาพไม่ผ่าน: ${result.reason || 'unknown'} — ยังไม่ประกาศ online`);
  }
  _snapshotConfirm.set(cameraId, { ...st, authFailStreak: 0, lastReason: result.reason, nextAttemptAt: nowMs + SNAPSHOT_CONFIRM_COOLDOWN_MS });
  return false;
}

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

  // เจ้าของสั่ง 2026-09-15: เอา emoji ออกจากการ์ดสถานะกล้องทั้งหมด ("ดูเป็น AI")
  // — ใช้ป้ายข้อความแทน (กล้อง:/ตำแหน่ง:/เวลา:) ยังคงเว้นไว้ให้การ์ด LPR/ใบหน้า/
  // watchlist ตามข้อยกเว้นเดิมของ CLAUDE.md (norm ของ LINE ไทย)
  let text;
  if (status === 'mqtt_silent') {
    // ข้อ 7 (2026-06-12): กล้อง online (HTTP/ONVIF ตอบ) แต่ MQTT ไม่มีข้อความเข้า
    // → events เงียบทั้งที่ดูปกติ (เคสจริง: รหัส MQTT บนกล้องหลุด เงียบ 4 ชม.)
    text = `กล้อง Online แต่ MQTT ขาด — events ไม่เข้า!\nกล้อง: ${camName}\nตำแหน่ง: ${location}\nเวลา: ${timeStr}\nตรวจรหัส MQTT บนกล้อง / broker (GOTCHAS: Online+ไม่มี events)`;
  } else if (status === 'mqtt_restored') {
    text = `MQTT กลับมาปกติ\nกล้อง: ${camName}\nตำแหน่ง: ${location}\nเวลา: ${timeStr}`;
  } else if (status === 'offline') {
    text = `กล้องออฟไลน์!\nกล้อง: ${camName}\nตำแหน่ง: ${location}\nเวลา: ${timeStr}`;
  } else {
    let dur = '';
    if (offlineSince) {
      const sec = Math.round((Date.now() - new Date(offlineSince).getTime()) / 1000);
      if (sec >= 3600) dur = ` (ออฟไลน์ ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m)`;
      else if (sec >= 60) dur = ` (ออฟไลน์ ${Math.floor(sec / 60)} นาที)`;
      else dur = ` (ออฟไลน์ ${sec} วินาที)`;
    }
    text = `กล้องกลับมาออนไลน์!${dur}\nกล้อง: ${camName}\nตำแหน่ง: ${location}\nเวลา: ${timeStr}`;
  }

  // 🔴 เดิม `.catch(() => {})` กลืนผลทิ้งเงียบสนิท — เจ้าของถามหลังเปิดแจ้งเตือนกล้อง
  // LPR ที่ HKT (2026-09-14) ว่ายืนยันได้ไหมว่าข้อความไปถึงจริง คำตอบตอนนั้นคือ "ไม่มี
  // หลักฐานฝั่งเซิร์ฟเวอร์เลย" เพราะ pushLineMessage() ไม่เคย throw — resolve
  // ({success:false,error}) เสมอแม้ LINE ตอบ 4xx/5xx (บั๊กคลาสเดียวกับที่ alert-engine.js
  // ของ _pushToAll เคยแก้ไปแล้ว — จุดนี้เป็นโค้ดเก่าคนละไฟล์ที่ยังไม่ได้ตาม)
  //
  // ⚠️ ตั้งใจไม่เปลี่ยนพฤติกรรมอื่นใด — last_alert_at ที่ผู้เรียกอัปเดตยังทำงานเหมือนเดิม
  // ทุกกรณี (อัปเดตแม้ส่งไม่สำเร็จ) ไม่ใช่ของที่ขอวันนี้ เป็นคนละประเด็นที่ต้องตัดสินใจแยก
  const messages = [{ type: 'text', text }];
  const results = [];
  for (const id of targetIds) {
    const r = await lineSender.pushLineMessage(lineCfg.channel_access_token, id, messages)
      .catch((e) => ({ success: false, error: e.message }));
    // id_tail เท่านั้น ไม่ log LINE user/group id เต็ม — ตามแบบ _pushToAll ใน alert-engine.js
    results.push({ id_tail: id ? String(id).slice(-4) : null, ok: !!r?.success,
                   error: r?.success ? null : (r?.error || 'unknown') });
  }
  const okCount = results.filter((r) => r.ok).length;
  if (okCount < targetIds.length) {
    console.warn(`[camera-alert] ส่ง LINE ไม่สำเร็จ ${targetIds.length - okCount}/${targetIds.length} `
      + `(${status}) ${cameraId}:`, JSON.stringify(results));
  }
  return { sent: okCount > 0, okCount, total: targetIds.length, results };
}

// ── MQTT-silent watch (ข้อ 7, 2026-06-12) ────────────────────
// ตรวจอาการ "กล้อง online แต่ MQTT ไม่ต่อ EMQX" = events เงียบทั้งที่ดูปกติ
// (ครอบทั้ง auth fail จากรหัสหลุด และ MQTT config พังบนกล้อง). ต้องเห็น
// อาการ 2 รอบติด (กัน reconnect ชั่วคราว) · เตือนซ้ำทุก ≥60 นาที ·
// ใช้ recipients ของ camera offline alert เดิม (ไม่มี config = ไม่เตือน)
const _mqttSilent = new Map();   // camera_id → { streak, lastAlertAt, alerted }
const MQTT_SILENT_REALERT_MS = 60 * 60 * 1000;
// เกณฑ์ "เงียบ" — ทุกกล้อง Bosch ส่ง <cam>/onvif-ej/... ทุก ~60 วิ (วัดจริง,
// plan §8 A1) · 5 นาทีให้เผื่อ reconnect/GC blip โดยไม่แจ้งเตือนไว
const MQTT_SILENT_STALE_MS = 5 * 60 * 1000;

// ข้อ 7 เดิมพึ่ง brokerAdmin.listConnectedUsers() (รายชื่อที่ต่อ Central) ซึ่ง
// ใช้ไม่ได้กับกล้อง Bosch เลย — กล้องทุกตัวต่อ broker ที่ EDGE ไม่ใช่ Central จึง
// ไม่เคยอยู่ในรายชื่อนั้น ⇒ log ผิด "online but MQTT not connected" สะสม 904,783
// บรรทัด (plan §8 ข้อเท็จจริงใหม่). เปลี่ยนมาใช้ cameras.last_mqtt_at
// (migration 247, เขียนโดย mqtt-subscriber.js _flushMqttHeartbeats ทุก 60 วิ
// จากข้อความ onvif-ej จริง) — broker-neutral ใช้ได้ทั้งสองโหมด BROKER_KIND
async function checkMqttSilent({ cfgCameras, onlineIds, lastMqttAtById, alertMap, lineCfg, tz }) {
  const mqttCams = cfgCameras.filter(c =>
    (c.vendor || 'bosch').toLowerCase() === 'bosch' && c.mqtt_username);
  if (mqttCams.length === 0) return;
  const now = Date.now();
  for (const cam of mqttCams) {
    const id = cam.camera_id;
    const st = _mqttSilent.get(id) || { streak: 0, lastAlertAt: 0, alerted: false };
    const lastMqttAt = lastMqttAtById.get(id);
    const stale = !lastMqttAt || (now - new Date(lastMqttAt).getTime()) >= MQTT_SILENT_STALE_MS;
    const silent = onlineIds.has(id) && stale;
    if (!silent) {
      if (st.alerted && !stale) {
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
    let cfgCameras = (loadCameraConfig().cameras) || [];
    const cfgIds = cfgCameras.map(c => c.camera_id || c.id).filter(Boolean);
    if (cfgIds.length === 0) return;

    const [camRes, alertRes, lineRes] = await Promise.all([
      pool.query(`
        SELECT c.id AS camera_id, c.last_seen_at AS last_seen, c.enabled, c.paused, s.code AS site_code,
               c.last_mqtt_at
        FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
        WHERE c.id = ANY($1::text[])
      `, [cfgIds]),
      pool.query(`
        SELECT * FROM camera_offline_alerts WHERE camera_id = ANY($1::text[])
      `, [cfgIds]),
      pool.query(`SELECT * FROM line_config WHERE id = 1`),
    ]);

    // ไซต์ maintenance/archived เงียบทุกแจ้งเตือน (sites.status · migration 285)
    const quiet = await quietSiteCodes(pool);
    const quietIds = new Set(camRes.rows.filter(c => quiet.has(c.site_code)).map(c => c.camera_id));
    camRes.rows = camRes.rows.filter(c => !quietIds.has(c.camera_id));
    cfgCameras = cfgCameras.filter(c => !quietIds.has(c.camera_id)); // checkMqttSilent ไม่เห็นกล้องไซต์เงียบ

    const alertMap = {};
    alertRes.rows.forEach(r => { alertMap[r.camera_id] = r; });
    const lineCfg = lineRes.rows[0];
    const tz = await getDisplayTz();
    const now = Date.now();
    const changes = [];
    // 🔴 จัดกลุ่มก่อนส่ง (แก้ 2026-09-14) — เจ้าของเจอ C9/C10-KAR-SB-04 กะพริบพร้อมกัน
    // ทุกชั่วโมงเป๊ะ ๆ (คาดว่า maintenance แต่ระบบไม่รู้แน่ชัด) ได้ข้อความแยก 4 ใบ/รอบ
    // (offline C9, offline C10, online C9, online C10) ทั้งที่เป็นเหตุการณ์เดียวกัน
    // ⇒ เก็บรายชื่อกล้องที่ "ควรแจ้ง" ไว้ก่อนระหว่างวนลูป แล้วค่อยส่งรวมทีเดียวหลังจบ
    // ลูป ไม่เปลี่ยน logic การตัดสินใจ "ควรแจ้งไหม" เลยสักบรรทัด แค่เลื่อนจุดส่งออกไป
    const wentOffline = [];   // { cam, cfgCam, alertCfg, offlineSince }
    const cameBack = [];      // { cam, cfgCam, alertCfg, offlineSince }

    // ข้อ 7 — MQTT-silent watch: ใช้ heartbeat ชุดเดียวกับ watchdog
    const onlineIds = new Set(camRes.rows
      .filter(c => !c.paused && c.last_seen
        && (now - new Date(c.last_seen).getTime()) / 1000 < OFFLINE_THRESHOLD_SEC)
      .map(c => c.camera_id));
    const lastMqttAtById = new Map(camRes.rows.map(c => [c.camera_id, c.last_mqtt_at]));
    checkMqttSilent({ cfgCameras, onlineIds, lastMqttAtById, alertMap, lineCfg, tz })
      .catch(e => console.warn('[mqtt-silent] check error:', e.message));

    for (const cam of camRes.rows) {
      if (cam.paused) { _onlineConfirm.delete(cam.camera_id); continue; } // paused = intentional maintenance; skip watchdog entirely

      const ageSec = cam.last_seen
        ? (now - new Date(cam.last_seen).getTime()) / 1000
        : Infinity;
      const rawOnline = ageSec < OFFLINE_THRESHOLD_SEC;
      let isOnline;
      if (!rawOnline) {
        _onlineConfirm.delete(cam.camera_id);
        isOnline = false;
      } else if (cam.enabled) {
        isOnline = true;   // กล้องที่ online อยู่แล้ว ไม่ต้องรอยืนยันซ้ำ
      } else {
        const streak = (_onlineConfirm.get(cam.camera_id) || 0) + 1;
        _onlineConfirm.set(cam.camera_id, streak);
        const heartbeatConfirmed = streak >= ONLINE_CONFIRM_POLLS;
        // ด่านที่สอง: heartbeat ยืนยันครบแล้ว ก่อนประกาศ online จริงต้องยิงไปขอ
        // snapshot จากกล้องผ่าน edge ของไซต์นั้นก่อน (ดูเหตุผล/กัน lockout ที่
        // คอมเมนต์ของ _confirmCameraViaSnapshot ด้านบน)
        isOnline = heartbeatConfirmed
          && await _confirmCameraViaSnapshot(pool, cam.camera_id, cam.site_code);
      }
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
            cameBack.push({ cam, cfgCam, alertCfg, offlineSince: alertCfg.offline_since });
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
          const lastAlertAt = alertCfg.last_alert_at;
          const escalateMs  = (alertCfg.escalate_interval_min || 60) * 60 * 1000;
          const groupKey    = String(alertCfg.recipient_ids || '').trim();

          // ครั้งแรกของกล้องตัวนี้ยังเป็นอิสระเสมอ (ตาม notify_after_sec ของตัวเอง
          // ไม่ต้องรอกลุ่ม) — ตั้งแต่ครั้งที่สองเป็นต้นไปยึดนาฬิกากลุ่มแทน
          let eligible = false;
          if (!lastAlertAt) {
            eligible = true;
          } else if (!alertCfg.escalate_once) {
            const groupNextAt = _groupEscalation.get(groupKey);
            eligible = !groupNextAt || now >= groupNextAt;
          }

          if (eligible) {
            if (!_camAlertInQuiet(alertCfg, tz)) {
              wentOffline.push({ cam, cfgCam, alertCfg, offlineSince });
            }
            // เลื่อนนาฬิกากลุ่มไปข้างหน้าเฉพาะตอนที่เป็นรอบ "แจ้งซ้ำ" จริง (ไม่ใช่
            // ครั้งแรก) — กันไม่ให้กล้องที่เพิ่งดับใหม่มาเลื่อนนาฬิการอบถัดไปของ
            // กล้องอื่นที่รออยู่แล้วออกไปเรื่อย ๆ
            if (lastAlertAt && !alertCfg.escalate_once) {
              _groupEscalation.set(groupKey, now + escalateMs);
            }
          }
        }
      }
    }

    // ส่งรวมทีเดียวหลังวนครบทุกกล้องแล้ว — ไม่ใช่ทันทีในลูป (ดูเหตุผลด้านบน)
    await _sendGroupedCameraAlerts({ status: 'offline', items: wentOffline, lineCfg, tz, pool });
    await _sendGroupedCameraAlerts({ status: 'online',  items: cameBack,    lineCfg, tz, pool });

    // WS broadcast for UI (unchanged behaviour)
    if (changes.length > 0 && typeof wss !== 'undefined') {
      const msg = JSON.stringify({ type: 'camera_status', changes });
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
    }
  } catch (e) {
    // ignore (DB อาจ disconnect ชั่วคราว)
  }
}

// ── Flex card + ภาพประกอบ สำหรับกล้องที่เปิด send_snapshot (opt-in ต่อกล้อง,
//    เจ้าของอนุมัติ 2026-09-15) ────────────────────────────────────────────
// ภาพ: ออฟไลน์ = event จริงล่าสุดก่อนดับ · กลับมาออนไลน์ = event จริงแรกหลังกลับมา
// (ถ้ายังไม่มี — กล้อง LPR มีรถผ่านถี่ โอกาสมีสูงภายในไม่กี่นาที ถ้าไม่มีก็ตัดรูปออก
// ไม่ใช่ error) ใช้ตาราง events ตัวเดียวกับที่การ์ด LPR/ใบหน้าใช้อยู่แล้ว
//
// 🔴 กล้องใบหน้า: events.snapshot_filename เป็นภาพ**ครอปใบหน้า** ไม่ใช่ scene เต็ม
// (ยืนยันจากภาพจริงที่เจ้าของส่งมา — หน้าคนเต็มเฟรม) เจ้าของขอภาพ full scene
// เสมอ (2026-09-15) — hikvision-isapi.js เก็บภาพเต็มไว้แยกที่
// raw_json._snapshot_full เมื่อดึงได้ (ยืนยันไฟล์จริงมีอยู่จาก preflight)
// ใช้ COALESCE เอา full scene ก่อนเสมอถ้ามี ไม่มีค่อยตกไปใช้ตัวครอป (LPR ไม่มี
// ฟิลด์นี้อยู่แล้ว เพราะ snapshot_filename ของ LPR เป็น scene เต็มมาแต่ต้น)
async function _lastCameraEventSnapshot(pool, cameraId, cutoff, direction) {
  const cmp = direction === 'after' ? '>' : '<';
  const ord = direction === 'after' ? 'ASC' : 'DESC';
  const r = await pool.query(
    `SELECT received_at, COALESCE(raw_json->>'_snapshot_full', snapshot_filename) AS snapshot_filename
       FROM events
      WHERE camera_id = $1 AND snapshot_filename IS NOT NULL AND received_at ${cmp} $2
      ORDER BY received_at ${ord} LIMIT 1`,
    [cameraId, cutoff]
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

// "ครั้งก่อน" — รอบ offline ก่อนหน้ารอบนี้ (ดู GOTCHAS #209-adjacent HKT hourly-dropout
// report) ให้เห็นตั้งแต่การ์ดแรกว่ากล้องนี้ดับซ้ำเป็นรอบไหม ไม่มีปูมก่อนหน้า = ไม่ใส่แถวนี้
// เลย (ห้ามขึ้น "-" ตามกฎห้ามใส่ช่องที่รู้อยู่แล้วว่าจะว่าง)
async function _prevOfflineCycleLabel(pool, cameraId, cutoff) {
  // 🔴 คัดข้อความ log ของรอบปัจจุบันเองออก (แก้ 2026-09-15 หลังตรวจกับ C2 จริง):
  // offline_since (คิวรีนี้ใช้เป็น cutoff) กับ camera_status_log.changed_at ของ
  // รอบเดียวกันมาจากคนละ NOW() call ห่างกันแค่ระดับ ms ⇒ ถ้าใช้ "< cutoff" ตรง ๆ
  // จะหยิบปูมของ**รอบปัจจุบัน**มาแสดงเป็น "ครั้งก่อน" ผิด ๆ (เห็นจริง: "ดับเมื่อ
  // 0 วิก่อนหน้า") ต้องเผื่อช่องว่างขั้นต่ำ — รอบก่อนหน้าจริงห่างกันเป็นนาที/ชม.
  // เสมอตามรายงาน HKT hourly-dropout ไม่มีทางห่างกัน <10 วิ
  const r = await pool.query(
    `SELECT changed_at FROM camera_status_log
      WHERE camera_id = $1 AND status = 'offline'
        AND changed_at < $2::timestamptz - INTERVAL '10 seconds'
      ORDER BY changed_at DESC LIMIT 1`,
    [cameraId, cutoff]
  ).catch(() => ({ rows: [] }));
  const prev = r.rows[0]?.changed_at;
  if (!prev) return null;
  const sec = Math.round((new Date(cutoff).getTime() - new Date(prev).getTime()) / 1000);
  if (sec < 60) return `ดับเมื่อ ${sec} วิก่อนหน้า`;
  if (sec < 3600) return `ดับเมื่อ ${Math.floor(sec / 60)} นาทีก่อนหน้า`;
  if (sec < 86400) return `ดับเมื่อ ${Math.floor(sec / 3600)} ชม. ก่อนหน้า`;
  return `ดับเมื่อ ${Math.floor(sec / 86400)} วันก่อนหน้า`;
}

function _durPlain(offlineSince) {
  if (!offlineSince) return null;
  const sec = Math.round((Date.now() - new Date(offlineSince).getTime()) / 1000);
  if (sec >= 3600) return `${Math.floor(sec / 3600)} ชม. ${Math.floor((sec % 3600) / 60)} นาที`;
  if (sec >= 60) return `${Math.floor(sec / 60)} นาที`;
  return `${sec} วินาที`;
}

async function _buildCameraSnapshotBubble({ status, it, tz, pool }) {
  const camName  = it.cfgCam?.camera_name || it.cam.camera_id;
  const location = it.cfgCam?.location || '—';
  const timeStr  = new Date().toLocaleString('th-TH', { timeZone: tz || 'Asia/Bangkok', hour12: false });
  const cutoff   = it.offlineSince || new Date();
  // 🔴 เจ้าของเจอจริง 2026-09-15: การ์ดแจ้งเตือน**ซ้ำ** (escalation, ไม่ใช่ครั้งแรก)
  // ขึ้น "เพิ่งดับ" ทั้งที่จริงดับมาเป็นชั่วโมงแล้ว (offlineSince เก่ากว่าตอนแจ้ง
  // มาก — เห็นภาพประกอบเก่า 9 ชม. แล้วงงว่าทำไม "เพิ่งดับ") เดิม hardcode ข้อความนี้
  // ไว้ไม่สนว่าเป็นครั้งแรกหรือครั้งที่เท่าไหร่ ⇒ คำนวณระยะเวลาจริงเสมอทั้ง 2 สถานะ
  // (ครั้งแรกจริง ๆ ตัวเลขก็จะเล็ก ~notify_after_sec เองอยู่แล้ว ไม่ต้องแยก branch)
  const dur = _durPlain(it.offlineSince);

  const [snap, prevCycle] = await Promise.all([
    _lastCameraEventSnapshot(pool, it.cam.camera_id, cutoff, status === 'offline' ? 'before' : 'after'),
    _prevOfflineCycleLabel(pool, it.cam.camera_id, cutoff),
  ]);

  let heroUrl = null;
  if (snap?.snapshot_filename) {
    const ttlH = await getSystemSetting(pool, 'signed_image_expire_hours');
    const signed = await signedImage.usableSignedUrl(snap.snapshot_filename, signedImage.ttlSecFromHours(ttlH));
    heroUrl = signed?.url || null;
  }
  const snapTimeStr = snap
    ? new Date(snap.received_at).toLocaleTimeString('th-TH', { timeZone: tz || 'Asia/Bangkok', hour12: false })
    : null;

  const rows = [['เวลา', timeStr]];
  rows.push(['ดับมา', dur || 'เพิ่งดับ']);
  if (prevCycle) rows.push(['ครั้งก่อน', prevCycle]);

  const accent = status === 'offline' ? '#c92a2a' : '#2f9e44';
  const chipBg = status === 'offline' ? '#fff0f0' : '#ebfbee';
  const chip = status === 'offline'
    ? 'กล้องออฟไลน์'
    : `กลับมาออนไลน์${dur ? ` · ออฟไลน์ ${dur}` : ''}`;

  return lineSender.buildCompareFlexAlert({
    accent, chipBg, chip,
    title: camName,
    subtitle: location,
    hero: heroUrl ? { url: heroUrl, ratio: '16:9',
      caption: status === 'offline'
        ? `ภาพล่าสุดก่อนดับ · ${snapTimeStr}`
        : `event แรกหลังกลับมา · ${snapTimeStr}` } : null,
    sections: [{ title: 'รายละเอียด', rows }],
    altText: `${status === 'offline' ? 'กล้องออฟไลน์' : 'กล้องกลับมาออนไลน์'} · ${camName}`,
  });
}

// กล้องที่ควรแจ้งสถานะเดียวกันในรอบตรวจเดียวกัน (offline หรือ online) → รวมเป็น
// ข้อความเดียวถ้าผู้รับเป็นชุดเดียวกันเป๊ะ ๆ ตาม recipient_ids ของ camera_offline_alerts
// (คนละกล้องอาจตั้งผู้รับไม่เหมือนกัน — ห้ามยำรวมข้ามผู้รับ) มีกล้องเดียวในกลุ่ม =
// ข้อความหน้าตาเหมือนเดิมทุกประการ ไม่เปลี่ยนอะไรเลย
//
// กล้องที่เปิด send_snapshot (opt-in ต่อกล้อง) แยกไปเป็น Flex card+ภาพต่างหาก
// จากกล้องที่ยังไม่เปิด (ยังได้ข้อความเปล่าเดิมทุกตัวอักษร) — อาจส่ง 2 ข้อความ
// ต่อรอบถ้ากลุ่มเดียวกันมีกล้องทั้งสองแบบปนกัน
async function _sendGroupedCameraAlerts({ status, items, lineCfg, tz, pool }) {
  if (!items.length || !lineCfg || !lineCfg.enabled || !lineCfg.channel_access_token) return;
  const roster = Array.isArray(lineCfg.recipients) ? lineCfg.recipients : [];

  const groups = new Map();   // recipient_ids ดิบ (string) → items[]
  for (const it of items) {
    const key = String(it.alertCfg?.recipient_ids || '').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  for (const [recipientKey, groupItems] of groups) {
    const wanted = recipientKey.split(',').map((s) => s.trim()).filter(Boolean);
    const targetIds = wanted.length > 0
      ? roster.filter((r) => r.enabled && wanted.includes(r.id)).map((r) => r.id)
      : roster.filter((r) => r.enabled).map((r) => r.id);
    if (targetIds.length === 0) continue;

    const timeStr = new Date().toLocaleString('th-TH', { timeZone: tz || 'Asia/Bangkok', hour12: false });
    // ระยะเวลาออฟไลน์ต่อกล้อง — ก็อปตรรกะจาก _sendCameraStatusLine เดิมเป๊ะ (เคยเขียน
    // ตกไปรอบแรก ไม่มี dur เลย ตรวจทานก่อนส่งจริงถึงจับได้ว่าขาดของเดิมไปหนึ่งบรรทัด)
    const durLabel = (offlineSince) => {
      if (!offlineSince) return '';
      const sec = Math.round((Date.now() - new Date(offlineSince).getTime()) / 1000);
      if (sec >= 3600) return ` (ออฟไลน์ ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m)`;
      if (sec >= 60) return ` (ออฟไลน์ ${Math.floor(sec / 60)} นาที)`;
      return ` (ออฟไลน์ ${sec} วินาที)`;
    };
    // บรรทัดกล้อง/ตำแหน่งต่อกล้อง — รูปแบบเดียวกับ _sendCameraStatusLine เดิมเป๊ะ
    // (กล้องเดียวต้องได้ข้อความหน้าตาเหมือนเดิมทุกตัวอักษร ไม่ใช่แค่ความหมายใกล้เคียง)
    // ไม่มี emoji (เจ้าของสั่ง 2026-09-15 — เฉพาะการ์ดสถานะกล้อง)
    const camBlock = (it, dur = '') =>
      `กล้อง: ${it.cfgCam?.camera_name || it.cam.camera_id}${dur}\nตำแหน่ง: ${it.cfgCam?.location || '—'}`;

    // กล้องที่เปิด send_snapshot (opt-in) แยกไปทาง Flex card+ภาพ — แต่เฉพาะตอนดับ
    // ทีละตัวเท่านั้น (เจ้าของสั่ง 2026-09-15 หลังเห็น carousel 10 ใบพร้อมภาพหน้าคน
    // ตอนกล้อง face หลายตัวดับพร้อมกัน: "ดับเยอะแบบนี้ ไม่ต้องส่งรูปก็ได้ สรุปมาเลย
    // ทีเดียว") ⇒ ถ้ามีมากกว่า 1 ตัวในกลุ่มเดียวกัน ยุบกลับไปใช้ข้อความสรุปเปล่า
    // เหมือนกล้องที่ไม่เปิด send_snapshot เลย ไม่ส่งรูปเลยสักใบ
    const snapCandidates = groupItems.filter((it) => it.alertCfg?.send_snapshot);
    const snapItems  = snapCandidates.length === 1 ? snapCandidates : [];
    const plainItems = snapCandidates.length === 1
      ? groupItems.filter((it) => !it.alertCfg?.send_snapshot)
      : groupItems;

    const _push = async (ids, messages) => {
      const results = [];
      for (const id of ids) {
        const r = await lineSender.pushLineMessage(lineCfg.channel_access_token, id, messages)
          .catch((e) => ({ success: false, error: e.message }));
        results.push({ id_tail: id ? String(id).slice(-4) : null, ok: !!r?.success,
                       error: r?.success ? null : (r?.error || 'unknown') });
      }
      return results;
    };
    const _markSent = async (camIds) => {
      if (status !== 'offline' || !camIds.length) return;
      await pool.query(
        `UPDATE camera_offline_alerts SET last_alert_at=NOW() WHERE camera_id = ANY($1::text[])`,
        [camIds]
      ).catch(() => {});
    };

    // เจ้าของสั่ง 2026-09-15 หลังเห็นจริง: กล้องดับพร้อมกันหลายตัวที่ตำแหน่งเดียวกัน
    // (เช่น C49/C50/C48 ที่ "ท้ายซอยบางลา" ทั้งสามตัว) ข้อความเดิมพิมพ์ตำแหน่งซ้ำทุก
    // กล้อง — "สังเกตุว่าตำแหน่งมันอยู่เดียวกัน 3-4 กล้อง แต่แจ้งตำแหน่งทุกกล้อง
    // ผมว่าไม่โอเค" — จัดกลุ่มตามตำแหน่งก่อน แสดงตำแหน่งครั้งเดียวต่อกลุ่ม ตามด้วย
    // รหัสกล้องสั้น ๆ (ตัวหน้าสุดของ camera_id ก่อนขีด — "C49-PT-SB-20" → "C49")
    const shortCode = (it) => String(it.cam.camera_id).split('-')[0];
    // เจ้าของสั่ง 2026-09-15 หลังดู mockup แล้วอนุมัติ: หลายกล้องพร้อมกัน = การ์ด Flex
    // ไม่มีรูป (ตัวเดียวกับการ์ดกล้องเดี่ยว แค่ไม่ส่ง hero/title) จัดกลุ่มตามตำแหน่ง
    // เป็นคนละ section — ตำแหน่งเดียวกันไม่พิมพ์ซ้ำ (ดูเหตุผลเดิมด้านบน)
    const multiSections = (items, dur = () => '') => {
      const groups = new Map();   // ตำแหน่ง → items[]
      for (const it of items) {
        const loc = it.cfgCam?.location || '—';
        if (!groups.has(loc)) groups.set(loc, []);
        groups.get(loc).push(it);
      }
      return [...groups.entries()].map(([loc, its]) => ({
        title: loc,
        rows: [['กล้อง', its.map((it) => `${shortCode(it)}${dur(it.offlineSince)}`).join(', ')]],
      }));
    };

    if (plainItems.length === 1) {
      const it0 = plainItems[0];
      const text = status === 'offline'
        ? `กล้องออฟไลน์!\n${camBlock(it0)}\nเวลา: ${timeStr}`
        : `กล้องกลับมาออนไลน์!${durLabel(it0.offlineSince)}\n${camBlock(it0)}\nเวลา: ${timeStr}`;
      const results = await _push(targetIds, [{ type: 'text', text }]);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount < targetIds.length) {
        console.warn(`[camera-alert] กล้อง ${it0.cam.camera_id} ส่งไม่สำเร็จ `
          + `${targetIds.length - okCount}/${targetIds.length} (${status}):`, JSON.stringify(results));
      }
      // last_alert_at อัปเดตเฉพาะตอนส่งสำเร็จจริงอย่างน้อยหนึ่งคน (กฎเดียวกับที่แก้ไปก่อนหน้า)
      // — ไม่สำเร็จเลยสักคน รอบตรวจถัดไป (30 วิ) จะลองส่งใหม่ทันที แทนรอ escalate_interval_min
      if (okCount > 0) await _markSent([it0.cam.camera_id]);
    } else if (plainItems.length > 1) {
      const accent = status === 'offline' ? '#c92a2a' : '#2f9e44';
      const chipBg = status === 'offline' ? '#fff0f0' : '#ebfbee';
      const chip = status === 'offline'
        ? `กล้องออฟไลน์พร้อมกัน ${plainItems.length} ตัว`
        : `กลับมาออนไลน์พร้อมกัน ${plainItems.length} ตัว`;
      const bubble = lineSender.buildCompareFlexAlert({
        accent, chipBg, chip,
        subtitle: `เวลา ${timeStr}`,
        // เจ้าของเจอจริง 2026-09-15: การ์ดแจ้งเตือนซ้ำ (escalation) ไม่ควรดูเหมือน
        // "เพิ่งดับ" ทั้งที่ดับมาเป็นชั่วโมงแล้ว — โชว์ระยะเวลาจริงต่อกล้องเสมอทั้ง
        // สองสถานะ เหมือนที่แก้ไปแล้วในการ์ดกล้องเดี่ยว (_buildCameraSnapshotBubble)
        sections: multiSections(plainItems, durLabel),
        altText: chip,
      });
      const results = await _push(targetIds, [bubble]);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount < targetIds.length) {
        console.warn(`[camera-alert] กลุ่ม ${plainItems.length} กล้อง ส่งไม่สำเร็จ `
          + `${targetIds.length - okCount}/${targetIds.length} (${status}):`, JSON.stringify(results));
      }
      if (okCount > 0) await _markSent(plainItems.map((it) => it.cam.camera_id));
    }

    if (snapItems.length) {
      // snapItems มีได้แค่ 0 หรือ 1 เสมอ (ดูเหตุผลตอนแยก snapCandidates ด้านบน)
      const bubble = await _buildCameraSnapshotBubble({ status, it: snapItems[0], tz, pool });
      const results = await _push(targetIds, [bubble]);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount < targetIds.length) {
        console.warn(`[camera-alert] กลุ่ม ${snapItems.length} กล้อง (snapshot) ส่งไม่สำเร็จ `
          + `${targetIds.length - okCount}/${targetIds.length} (${status}):`, JSON.stringify(results));
      }
      if (okCount > 0) await _markSent(snapItems.map((it) => it.cam.camera_id));
    }
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
    ? `การบันทึกวิดีโอหยุดทำงาน!\nกล้อง: ${camName}\nตำแหน่ง: ${location}\nbuffer ไม่อัปเดต ${mins} นาที (กล้องยังออนไลน์)\nเวลา: ${timeStr}`
    : `การบันทึกวิดีโอกลับมาทำงานแล้ว (หยุดไป ${mins} นาที)\nกล้อง: ${camName}\nตำแหน่ง: ${location}\nเวลา: ${timeStr}`;
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
        await touchCamera(pool, c.camera_id);
      }
    }
  } catch { /* ignore — DB may blip */ }
}
setInterval(checkMonitorCameras, 60 * 1000);
setTimeout(checkMonitorCameras, 8000);
