// ============================================================
// Vigil Platform — Tests: โฟลเดอร์ (ลงท้าย /) ใต้ static mount ต้องล็อกอิน
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// บั๊กจริง 2026-10-20 (reproduce แล้วผ่าน Cloudflare โดยไม่มี session):
//   GET https://dashboard.dojojin.tech/others/demo/vehiclecount/            → 200 หน้า demo
//   GET https://dashboard.dojojin.tech/others/demo/vehiclecount/index.html  → 302 ไป login (ถูก)
// เหตุ: middleware นับเป็น static asset เฉพาะ '/' กับ path ที่มีนามสกุล · path โฟลเดอร์จึงหลุดไป
// express.static ซึ่งเสิร์ฟ index.html ให้ · ดึงฟังก์ชันจริงจาก api-server.js มารัน ไม่ใช่ grep
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-server.js'), 'utf8');
const m = SRC.match(/\nfunction isGatedStaticPath\(p\) \{[\s\S]*?\n\}\n/);
assert.ok(m, 'หา isGatedStaticPath ใน api-server.js ไม่เจอ');
const ctx = {};
vm.runInNewContext(m[0] + '\nthis.f = isGatedStaticPath;', ctx);
const gated = ctx.f;

test('directory paths are gated like the files they serve', () => {
  for (const p of ['/', '/others/', '/others/demo/', '/others/demo/vehiclecount/', '/others/vigil-docs-v2/',
                   '/others/demo/blacklist/settings/']) assert.equal(gated(p), true, p);
});

test('file paths keep the old behaviour', () => {
  for (const p of ['/index.html', '/others/demo/x/app.js', '/a.css', '/b.PNG', '/f.woff2']) assert.equal(gated(p), true, p);
  for (const p of ['/others', '/api/auth/me', '/lpr', '/healthz']) assert.equal(gated(p), false, p);
});

test('the middleware uses it for GET and HEAD, and sends unauthed directory navigation to login', () => {
  assert.match(SRC, /const isStaticAsset = \(req\.method === 'GET' \|\| req\.method === 'HEAD'\) && isGatedStaticPath\(req\.path\);/);
  assert.match(SRC, /if \(req\.path\.endsWith\('\/'\) \|\| req\.path === '\/index\.html' \|\| req\.path\.endsWith\('\.html'\)\) \{\n\s*return res\.redirect\('\/disclaimer\.html'\);/);
});
