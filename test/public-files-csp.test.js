// Vigil Platform — CSP ของไฟล์ HTML ที่ /pub/fil/ (migration 265 · ไฟล์ HTML แบบโต้ตอบได้)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { htmlFileCsp } = require('../src/routes/media-files');

test('default HTML: no scripts at all (unchanged from before migration 265)', () => {
  const c = htmlFileCsp(false);
  assert.equal(c, "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src https: data:; font-src https://fonts.gstatic.com data:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
  assert.doesNotMatch(c, /allow-scripts|script-src/);
});

test('interactive HTML: scripts run, but isolated and cannot talk to anything', () => {
  const c = htmlFileCsp(true);
  assert.match(c, /sandbox allow-scripts/);
  assert.doesNotMatch(c, /allow-same-origin/, 'ห้ามมี allow-same-origin — สคริปต์ต้องอยู่ใน origin ลับ');
  for (const d of ["connect-src 'none'", "form-action 'none'", "frame-ancestors 'none'", "base-uri 'none'", "default-src 'none'"]) assert.ok(c.includes(d), d);
});

test('upload keeps the sanitizer for every HTML file that is not explicitly flagged', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/files.js'), 'utf8');
  assert.match(src, /fileType\.ext === 'html' && !allowScripts\s*\?\s*Buffer\.from\(sanitizeUploadedHtml/);
  assert.match(src, /const allowScripts = fileType\.ext === 'html' &&/);
});
