// ============================================================
// Vigil Platform — Tests: helpers/dashboardBundle
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { bundleIndexHtml } = require('../src/helpers/dashboardBundle');

const HTML = [
  '<head>',
  '<script src="/theme-init.js"></script>',
  '<script src="/vendor/ol/ol-9.2.4.js"></script>',
  '</head><body>',
  '<!-- shared with the server report renderer — must load before i18n.js -->',
  '<script src="/i18n.js"></script>',
  '<script src="/page-a.js"></script>',
  '<script src="/page-b.js"></script>',
  '<script src="/page-c.js"></script>',
  '<script src="/dashboard.js"></script>',
  '</body>',
].join('\n');

afterEach(() => { delete process.env.DASHBOARD_BUNDLE; });

describe('bundleIndexHtml', () => {
  it('collapses the run of local page scripts into one tag, order preserved', () => {
    const { html, files } = bundleIndexHtml(HTML, { ver: 'abc123' });
    assert.deepEqual(files, ['/page-a.js', '/page-b.js', '/page-c.js', '/dashboard.js']);
    assert.equal(html.match(/<script/g).length, 4);   // theme-init, vendor, i18n, bundle
  });

  it('emits the bundle tag already carrying ?v= (the shell stamp pass cannot add it)', () => {
    const { html } = bundleIndexHtml(HTML, { ver: 'abc123' });
    assert.match(html, /<script src="\/dashboard\.bundle\.js\?v=abc123"><\/script>/);
    // ...and api-server's stamp regex must then leave that tag alone (it needs
    // the closing quote right after `.js`), or the ?v= would be overwritten.
    const stamped = html.replace(/src="(\/[\w/.-]+\.js)"/g, 'src="STAMPED"');
    assert.match(stamped, /<script src="\/dashboard\.bundle\.js\?v=abc123"><\/script>/);
  });

  it('leaves theme-init, vendor and i18n as their own tags', () => {
    const { html } = bundleIndexHtml(HTML, { ver: 'v' });
    for (const src of ['/theme-init.js', '/vendor/ol/ol-9.2.4.js', '/i18n.js']) {
      assert.ok(html.includes(`<script src="${src}"></script>`), src);
    }
  });

  it('replaces the run in place — nothing is hoisted past a non-bundled tag', () => {
    const { html } = bundleIndexHtml(HTML, { ver: 'v' });
    assert.ok(html.indexOf('/i18n.js') < html.indexOf('/dashboard.bundle.js'));
    assert.ok(html.indexOf('</head>') < html.indexOf('/dashboard.bundle.js'));
  });

  it('stops the run at intervening markup (index.html has a div before dashboard.js)', () => {
    const split = HTML.replace('<script src="/dashboard.js">', '<div id="toastStack"></div>\n<script src="/dashboard.js">');
    const { html, files } = bundleIndexHtml(split, { ver: 'v' });
    assert.deepEqual(files, ['/page-a.js', '/page-b.js', '/page-c.js']);
    assert.ok(html.includes('<script src="/dashboard.js"></script>'));
    assert.ok(html.indexOf('toastStack') < html.indexOf('/dashboard.js'));
  });

  it('DASHBOARD_BUNDLE=0 → HTML untouched (kill switch)', () => {
    process.env.DASHBOARD_BUNDLE = '0';
    const { html, files } = bundleIndexHtml(HTML, { ver: 'v' });
    assert.equal(html, HTML);
    assert.deepEqual(files, []);
  });

  it('does not bundle a lone eligible tag', () => {
    const one = '<script src="/theme-init.js"></script>\n<script src="/only.js"></script>';
    const { html, files } = bundleIndexHtml(one, { ver: 'v' });
    assert.equal(html, one);
    assert.deepEqual(files, []);
  });
});

describe('real dashboard/index.html', () => {
  it('bundles the long run and keeps every other script tag', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'index.html'), 'utf8');
    const before = src.match(/<script/g).length;
    const { html, files } = bundleIndexHtml(src, { ver: 'v' });
    assert.ok(files.length > 30, `expected a long run, got ${files.length}`);
    assert.equal(html.match(/<script/g).length, before - files.length + 1);
    assert.ok(!files.includes('/i18n.js') && !files.includes('/theme-init.js'));
    assert.ok(!files.some((f) => f.startsWith('/vendor/')));
    // every bundled member must exist on disk, or the boot concat throws
    for (const f of files) {
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'dashboard', f.slice(1))), f);
    }
  });

  // Without this, a syntax error (or a cross-file duplicate top-level const) in
  // any page-*.js degrades silently in prod: api-server warns at boot and falls
  // back to unbundled, and the suite stays green. Fail here instead.
  it('the concatenated bundle parses as one script', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '..', 'dashboard');
    const { files } = bundleIndexHtml(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), {});
    const code = files
      .map((f) => `\n;/* ==== ${f} ==== */\n${fs.readFileSync(path.join(dir, f.slice(1)), 'utf8')}\n`)
      .join('');
    assert.doesNotThrow(() => new (require('node:vm').Script)(code, { filename: 'dashboard.bundle.js' }));
  });
});
