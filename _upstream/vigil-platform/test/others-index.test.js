// ============================================================
// Vigil Platform — Tests: /others/ demo index lists every demo
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// 2026-10-20: demo หน้าใหม่ถูกทำไว้แล้วไม่มีใครหาเจอ (vehiclecount ค้างไม่ commit 6 วัน) ·
// ทำ demo ใหม่ = ต้องเพิ่มลิงก์ใน public/others/index.html ไม่งั้นเทสต์นี้ตก
// ============================================================
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public', 'others');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const hrefs = new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));

// ทุกหน้า .html ใต้ demo/ ที่เป็นหน้าเข้า (index.html ของโฟลเดอร์ หรือไฟล์ .html เดี่ยว)
function entryPages(dir, rel = '/others/demo/') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...entryPages(path.join(dir, e.name), `${rel}${e.name}/`));
    else if (e.name === 'index.html') out.push(rel);
    else if (e.name.endsWith('.html')) out.push(rel + e.name);
  }
  return out;
}

test('every demo page under public/others/demo/ is linked from the /others/ index', () => {
  const missing = entryPages(path.join(ROOT, 'demo')).filter((p) => !hrefs.has(p));
  assert.deepEqual(missing, [], `เพิ่มลิงก์ใน public/others/index.html: ${missing.join(', ')}`);
});

test('every link in the index points to a file that exists', () => {
  const broken = [...hrefs].filter((h) => h.startsWith('/others/')).filter((h) => {
    const f = path.join(ROOT, h.replace(/^\/others\//, ''));
    return !fs.existsSync(h.endsWith('/') ? path.join(f, 'index.html') : f);
  });
  assert.deepEqual(broken, []);
});

test('index keeps to the /others CSP: no inline <script> or <style>', () => {
  const code = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(code, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(code, /<style[\s>]/i);
});
