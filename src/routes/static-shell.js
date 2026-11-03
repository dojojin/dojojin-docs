// ============================================================
// Vigil Platform — Routes: Static Shell (dashboard HTML + assets)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const path    = require('path');
const fs      = require('fs');
const express = require('express');

// Returns { BRANDING_DIR } — routes/branding.js is mounted later in
// api-server.js and needs the same directory this module creates.
module.exports = function staticShellRoutes(app, pool, deps) {
  const { ROOT_DIR, env, getSystemSetting, bundleIndexHtml } = deps;

  // branding assets (logo) — public so login/disclaimer can fetch without auth
  const BRANDING_DIR = path.join(ROOT_DIR, 'branding');
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
      path.join(ROOT_DIR, 'public', 'others'),
      {
        index: 'index.html',
        maxAge: '1h',
        dotfiles: 'deny',
        // The 1h above is right for the .css/.js next to a demo page and wrong
        // for the page itself: those assets are cache-busted with ?v=, and the
        // only thing carrying the current ?v is the HTML. Cache the HTML too and
        // an edit reaches nobody until the hour is up — the browser keeps serving
        // an old page that keeps asking for the old asset URLs, so bumping ?v
        // does nothing (hit 2026-08-06 on the 3rd-party integration demo, and the
        // reason every demo here has needed a hard refresh after every change).
        // Same rule the dashboard shell below already follows, for the same
        // reason — this mount just never got it.
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }
    )
  );
  // Dashboard shell — served through a route (not plain static) so local
  // .js AND .css get a cache-busting ?v=<mtime> stamp. Cloudflare caches
  // static assets aggressively; a stale dashboard.js silently breaks new UI
  // (MV.3c face modal hit exactly this) and a stale index.css leaves new
  // styles invisible until a manual purge. index.html itself goes out
  // no-cache — it's tiny and must always carry the current ?v.
  // P4.2 — หน้า pre-auth (login/disclaimer) เดินเส้นเดียวกัน: มันโหลด
  // theme-init.js / i18n.js / fonts.css ชุดเดียวกับ dashboard ถ้าไม่ stamp
  // ไฟล์พวกนี้จะตกถังไม่มี ?v= (1 ชม.) ทั้งที่ dashboard เก็บได้ทั้งปี
  // ชื่อไฟล์มาจาก allowlist ข้างล่าง ไม่ใช่ req.path ตรง ๆ (กัน traversal)
  const SHELL_HTML = {
    '/':               'index.html',
    '/index.html':     'index.html',
    '/login.html':     'login.html',
    '/disclaimer.html': 'disclaimer.html',
  };

  // P7 — concatenate the dashboard's own classic scripts into one file at boot.
  // Rationale + which files are left out: src/helpers/dashboardBundle.js.
  // Built once at startup; a deploy restarts api-server, so no file watching.
  // DASHBOARD_BUNDLE=0 (or any failure below) → _BUNDLE stays null and the shell
  // route serves the original 40-odd tags, i.e. exactly today's behaviour.
  let _BUNDLE = null;   // { code, ver, files, bytes }
  (function buildDashboardBundle() {
    if (!env.bool('DASHBOARD_BUNDLE')) return;
    try {
      const dir = path.join(ROOT_DIR, 'dashboard');
      const { files } = bundleIndexHtml(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), {});
      if (!files.length) return;
      // Leading `;` guards a member file that ends without one; the marker keeps
      // stack traces readable (Chrome reports the offset, the comment names the file).
      //
      // ⚠️ That same `;` also ends the Program's directive prologue, so a member's
      // own top-level `'use strict'` degrades to a no-op expression statement:
      // 11 members run SLOPPY inside the bundle (views-acl, recipient-picker,
      // page-stats / -traffic / -storage / -files / -smart-search /
      // -hcp-face-search / -hcp-events / -auraface-blacklist / -blacklist-manual).
      // The P7 spec called for aborting the bundle here, on the premise that one
      // file's 'use strict' would leak forward onto the rest. Measured with a
      // `new Function` probe: the opposite is true — strict never leaks forward,
      // it is lost. strict→sloppy only ever loosens (undeclared assignment
      // creates a global instead of throwing; frozen writes fail silently), so
      // code that works today keeps working. Aborting would have disabled the
      // feature for all 39 files, since 11 of them are strict.
      // Kill switch if this ever bites: DASHBOARD_BUNDLE=0.
      //
      // Top-level `let`/`const` are unaffected: classic scripts already share one
      // global lexical environment, so a cross-file redeclaration was a SyntaxError
      // before the bundle too — the vm.Script check below still catches it, earlier.
      const code = files
        .map((f) => `\n;/* ==== ${f} ==== */\n${fs.readFileSync(path.join(dir, f.slice(1)), 'utf8')}\n`)
        .join('');
      // A syntax error in ONE member now breaks every script after it, so refuse
      // to ship a bundle that doesn't parse. vm.Script (not `new Function`) —
      // Function compiles a function body, which accepts a stray top-level
      // `return` that the browser would reject, and it is one call away from
      // executing all of the dashboard server-side.
      new (require('vm').Script)(code, { filename: 'dashboard.bundle.js' });
      _BUNDLE = {
        code,
        ver: require('crypto').createHash('sha1').update(code).digest('hex').slice(0, 12),
        files,
        bytes: Buffer.byteLength(code),
      };
      // ponytail: a top-level throw in one member now aborts the rest of the
      // bundle, where separate tags would have isolated it. Ceiling accepted —
      // upgrade path is the DASHBOARD_BUNDLE=0 kill switch, not per-file try/catch
      // (wrapping would hide each file's top-level declarations).
      console.log(`[bundle] /dashboard.bundle.js v=${_BUNDLE.ver} — ${files.length} files, ${(_BUNDLE.bytes / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.warn('[bundle] disabled — serving unbundled dashboard:', e.message);
      _BUNDLE = null;
    }
  })();

  // Auth: NOT in PUBLIC_HTML_FILES → isPublicAsset() returns false → this sits
  // behind the session gate like every other dashboard script.
  app.get('/dashboard.bundle.js', (req, res) => {
    if (!_BUNDLE) return res.status(404).end();
    res.set('Content-Type', 'text/javascript; charset=utf-8');
    res.set('ETag', `"${_BUNDLE.ver}"`);
    res.set('Cache-Control', req.query.v
      ? 'private, max-age=31536000, immutable'
      : 'no-cache');
    res.send(_BUNDLE.code);
  });

  app.get(Object.keys(SHELL_HTML), (req, res) => {
    try {
      const dir = path.join(ROOT_DIR, 'dashboard');
      const file = SHELL_HTML[req.path];
      if (!file) return res.status(404).end();
      let html = fs.readFileSync(path.join(dir, file), 'utf8');
      // Must run BEFORE the stamp pass below: the bundle has no file on disk, so
      // stamp()'s statSync would fall into its catch and emit the tag with no
      // ?v= at all — which _staticCacheControl then reads as no-cache, silently
      // throwing away the whole caching win (GOTCHAS #34 class). Emitting
      // ?v=<ver> here is also what makes the stamp regex skip the tag: it
      // requires the closing quote immediately after `.js`.
      if (_BUNDLE && file === 'index.html') {
        html = bundleIndexHtml(html, { ver: _BUNDLE.ver }).html;
      }
      // Stamp every local asset with its own mtime so Cloudflare never serves
      // stale files after a deploy. Each file gets its own ?v= so only changed
      // files get a cache miss.
      // P4.1 — vendor/ ก็ stamp ด้วยแล้ว (เดิม lookahead ตัดทิ้ง) และ char class
      // ต้องรับจุดด้วย เพราะชื่อไฟล์ vendor ติดเวอร์ชัน (ol-9.2.4.js,
      // chart-4.4.1.umd.min.js) — ถ้าไม่รับ regex จะไม่ match เลยแล้วเงียบ ๆ
      const stamp = (attr, p) => {
        try {
          const mtime = Math.floor(fs.statSync(path.join(dir, p.slice(1))).mtimeMs);
          return `${attr}="${p}?v=${mtime}"`;
        } catch { return `${attr}="${p}"`; }
      };
      html = html
        .replace(/src="(\/[\w/.-]+\.js)"/g, (_, p) => stamp('src', p))
        .replace(/href="(\/[\w/.-]+\.css)"/g, (_, p) => stamp('href', p));
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(html);
    } catch (e) {
      res.status(500).send('index load error');
    }
  });

  // P4.4 — cache policy ของ static ทั้ง dashboard dir
  // `private` เสมอ ห้าม `public`: ไฟล์ชุดนี้อยู่หลัง session gate (~บรรทัด 500)
  //   ถ้าประกาศ public เมื่อไหร่ Cloudflare จะ edge-cache แล้วเสิร์ฟให้คนที่
  //   ยังไม่ล็อกอินได้ — เท่ากับเปิดโค้ด dashboard ทิ้งไว้หน้าประตู
  // `.html` → no-cache (GOTCHAS #34): HTML คือตัวเดียวที่ถือ ?v= ปัจจุบัน
  //   ถ้ามันค้างที่ edge การ bump ?v ไม่มีผล เบราว์เซอร์ยังขอ URL ชุดเก่าอยู่ดี
  // มี `?v=<mtime>` → URL เปลี่ยนทุกครั้งที่ไฟล์เปลี่ยน จึงประกาศ immutable 1 ปีได้
  //   (นี่คือส่วนที่ตัดการ revalidate 100+ URL ต่อการเปิดหน้าหนึ่งครั้ง)
  // ไม่มี `?v=` → ฟอนต์ที่ CSS เรียกด้วย url(), รูป, ไฟล์ที่ route ข้างบนไม่ได้ stamp
  //   ให้ 1 ชม. พอ ไม่ยาวจนแก้แล้วไม่เห็นผล
  // internal renderer (Puppeteer ถือ x-internal-token) → no-cache: Chromium ถูก
  //   pool ไว้ยาว (report-renderer.js) ถ้าติด 1 ชม. รายงานจะเรนเดอร์ด้วย
  //   report-template.js ตัวเก่าหลังแก้โค้ด — บั๊กคลาสเดียวกับ #34
  function _staticCacheControl(filePath, hasVersionQuery, isInternalRenderer) {
    if (isInternalRenderer) return 'no-cache';
    if (/\.html?$/i.test(filePath)) return 'no-cache';
    if (hasVersionQuery) return 'private, max-age=31536000, immutable';
    return 'private, max-age=3600';
  }
  app.use(express.static(path.join(ROOT_DIR, 'dashboard'), {
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', _staticCacheControl(
        filePath,
        !!res.req?.query?.v,
        !!res.req?.headers?.['x-internal-token'],
      ));
    },
  }));

  return { BRANDING_DIR };
};
