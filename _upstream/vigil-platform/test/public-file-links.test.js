// Vigil Platform — ลิงก์สั้น + บันทึกการกด + ภาพพรีวิว (migration 266)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { uaInfo } = require('../src/helpers/uaInfo');
const { ogTags, injectOg, landingHtml } = require('../src/helpers/filePreview');
const ROOT = path.join(__dirname, '..');

test('short-link regex is the same in both allowlists (FILES_HOST + /pub/fil route)', () => {
  // เคยแก้ที่เดียวแล้วอีกที่ตอบ 404 (2026-09-24) — สองที่ต้องไปด้วยกันเสมอ
  const api = fs.readFileSync(path.join(ROOT, 'src/api-server.js'), 'utf8');
  const mf = fs.readFileSync(path.join(ROOT, 'src/routes/media-files.js'), 'utf8');
  assert.match(api, /\/\^\[a-z0-9\]\{8\}\(\\\.png\)\?\$\/\.test\(segs\[3\]\)/);
  assert.match(mf, /const SHORT_CODE_RE = \/\^\[a-z0-9\]\{8\}\$\/;/);
  assert.match(mf, /const OG_IMAGE_RE = \/\^\(\[a-z0-9\]\{8\}\)\\\.png\$\/;/);
});

test('click log ignores HEAD and never blocks serving', () => {
  const mf = fs.readFileSync(path.join(ROOT, 'src/routes/media-files.js'), 'utf8');
  assert.match(mf, /if \(req\.method !== 'GET'\) return;/);
  assert.match(mf, /\.catch\(\(e\) => console\.warn\('\[pub\/fil\] click log:'/);
});

test('uaInfo', () => {
  const iphoneLine = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0';
  assert.deepEqual(uaInfo(iphoneLine), { bot: false, app: 'LINE', browser: null, os: 'iOS', device: 'mobile' });
  const fb = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]';
  assert.equal(uaInfo(fb).app, 'Facebook');
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
  assert.deepEqual(uaInfo(chromeWin), { bot: false, app: null, browser: 'Chrome', os: 'Windows', device: 'desktop' });
  assert.equal(uaInfo('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129 Safari/537.36 Edg/129.0').browser, 'Edge');
  assert.equal(uaInfo('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)').bot, true);
  assert.equal(uaInfo('curl/8.5.0').bot, true);
  assert.equal(uaInfo('').bot, true);
});

test('Open Graph tags are escaped and injected into <head>', () => {
  const t = ogTags({ title: 'a "b" <c>', description: 'd', image: 'https://x/abc.png', url: 'https://x/abc' });
  assert.match(t, /og:title" content="a &quot;b&quot; &lt;c&gt;"/);
  assert.match(t, /twitter:card" content="summary_large_image"/);
  assert.match(injectOg('<html><head lang="th"><title>x</title>', t), /<head lang="th">\n<meta property="og:type"/);
  assert.match(landingHtml({ title: 'x', url: 'u' }), /twitter:card" content="summary"/);
});

test('archived versions (<uuid>.v<N>.<ext>) are never served by /pub/fil (migration 267)', () => {
  // การแทนที่ไฟล์เก็บเนื้อหาเก่าไว้ข้างไฟล์จริง — ถ้า regex ชื่อไฟล์ของ /pub/fil หลวมขึ้น เวอร์ชันเก่าจะเปิดได้จากลิงก์ลงชื่อ
  const mf = fs.readFileSync(path.join(ROOT, 'src/routes/media-files.js'), 'utf8');
  const fj = fs.readFileSync(path.join(ROOT, 'src/routes/files.js'), 'utf8');
  const re = new RegExp(mf.match(/if \(!\/(\^\[0-9a-f-\]\{36\}[^/]+\$)\/\.test\(rel\)\)/)[1]);
  const archName = eval(fj.match(/const archName = (\(stored, v\) => [^;]+);/)[1]);
  const stored = '6f1c2a3b-1111-4222-8333-944455556666.html';
  assert.ok(re.test(stored));
  assert.equal(archName(stored, 3), '6f1c2a3b-1111-4222-8333-944455556666.v3.html');
  assert.ok(!re.test(archName(stored, 3)));
});
