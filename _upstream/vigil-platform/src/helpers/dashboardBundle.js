// ============================================================
// Vigil Platform — Dashboard script bundle (index.html rewrite)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// P7 — first dashboard load = 108–114 requests / 47 <script> tags. Through
// Cloudflare each request has a ~180 ms floor and the browser opens the local
// classic scripts strictly in dependency order, so the first load after a
// deploy (or on a new device) pays 47 serial round-trips for ~5 MB.
//
// This module is the pure half: given index.html it finds the longest run of
// consecutive local classic <script> tags that may be concatenated and
// replaces that run with one <script src="/dashboard.bundle.js?v=VER">.
//
// Why the LONGEST CONTIGUOUS RUN and not "every eligible tag":
//   index.html documents load-order dependencies in comments —
//     "shared with the server report renderer — must load before i18n.js"
//     (province-names.js) and recipient-picker.js:17 "โหลดก่อน page-alerts.js
//     และ page-face-matches.js ใน index.html"
//   Hoisting a bundle tag over an excluded tag would silently reorder those.
//   A contiguous run can only ever be replaced in place, so order is preserved
//   by construction. The tags outside the run keep their own <script> tag.
//
// Not bundled (each keeps its own tag / cache entry):
//   /theme-init.js  — must stay first and separate (FOUC guard, pre-auth)
//   /i18n.js        — login/disclaimer load it pre-auth; keep it cacheable
//   /vendor/*.js    — third-party, already long-cached, versioned filenames
//
// Kill switch: DASHBOARD_BUNDLE=0 → this returns the HTML untouched.
// ============================================================
'use strict';

const BUNDLE_PATH = '/dashboard.bundle.js';

// Single path segment only → /vendor/... never matches.
const LOCAL_JS = /^\/[\w.-]+\.js$/;
const NEVER_BUNDLE = new Set(['/theme-init.js', '/i18n.js']);

// `<script src="/x.js"></script>` — no defer/async/type/nonce attributes: a tag
// carrying any of those is not a plain classic script and must not be folded in.
const TAG_RE = /<script\s+src="([^"]+)"\s*><\/script>/g;

// Only whitespace and HTML comments may sit between two tags of one run.
// Anything else (an element such as index.html's #toastStack div) ends the run,
// because collapsing across it would move that element in the DOM.
const GAP_ONLY = /^(?:\s|<!--[\s\S]*?-->)*$/;

const isBundleable = (src) => LOCAL_JS.test(src) && !NEVER_BUNDLE.has(src);

/**
 * @param {string} html   dashboard/index.html source
 * @param {{ver?: string}} opts
 * @returns {{html: string, files: string[]}} files = bundle members, in order
 */
function bundleIndexHtml(html, { ver = '0' } = {}) {
  if (process.env.DASHBOARD_BUNDLE === '0') return { html, files: [] };

  const tags = [];
  for (const m of html.matchAll(TAG_RE)) {
    tags.push({ src: m[1], start: m.index, end: m.index + m[0].length });
  }

  // Longest run of adjacent bundleable tags.
  let best = null;
  let run = null;
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const joins = run && GAP_ONLY.test(html.slice(run[run.length - 1].end, t.start));
    if (!isBundleable(t.src)) { run = null; continue; }
    run = joins ? run.concat(t) : [t];
    if (!best || run.length > best.length) best = run;
  }
  if (!best || best.length < 2) return { html, files: [] };

  const tag = `<script src="${BUNDLE_PATH}?v=${ver}"></script>`;
  return {
    html: html.slice(0, best[0].start) + tag + html.slice(best[best.length - 1].end),
    files: best.map((t) => t.src),
  };
}

module.exports = { bundleIndexHtml, BUNDLE_PATH };
