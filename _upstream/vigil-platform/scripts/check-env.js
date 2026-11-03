#!/usr/bin/env node
// ============================================================
// Vigil Platform — ตรวจว่า env ทุกตัวที่โค้ดอ่าน ถูกลงทะเบียนไว้แล้ว
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไม: ก่อนมี src/config.js env 135 ตัวถูกอ่านโดยไม่เคยถูกบันทึกไว้ที่ไหนเลย
// ไม่มีใครรู้ว่า deployment ใหม่ต้องตั้งอะไรบ้าง · ตัวนี้ทำให้ "เพิ่ม env ใหม่แล้ว
// ลืมลงทะเบียน" กลายเป็น commit ที่ commit ไม่ผ่าน (scripts/hooks/pre-commit)
//
//   fail (exit 1) — โค้ดอ่าน env ที่ไม่มีใน DEFS
//   warn (exit 0) — DEFS มีแต่ .env.example ไม่มี / .env.example มีแต่ DEFS ไม่มี
//
// รัน: npm run check:env
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const RE = /process\.env\.([A-Z_0-9]+)/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const used = new Map();   // name -> "file:line" แรกที่เจอ
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(RE)) if (!used.has(m[1])) used.set(m[1], `${rel}:${i + 1}`);
  });
}

const defs = new Set(require(path.join(SRC, 'config.js')).names());
const example = new Set(
  fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    .split('\n').map((l) => (l.match(/^\s*#?\s*([A-Z][A-Z_0-9]*)\s*=/) || [])[1]).filter(Boolean)
);

const missing = [...used.keys()].filter((n) => !defs.has(n)).sort();
const notInExample = [...defs].filter((n) => !example.has(n)).sort();
const notInDefs = [...example].filter((n) => !defs.has(n)).sort();

if (notInExample.length) {
  console.warn(`[check-env] ⚠️  ${notInExample.length} ตัวใน DEFS ไม่มีใน .env.example: ${notInExample.join(', ')}`);
}
if (notInDefs.length) {
  console.warn(`[check-env] ⚠️  ${notInDefs.length} ตัวใน .env.example ไม่มีใน DEFS (ตายแล้ว?): ${notInDefs.join(', ')}`);
}

if (missing.length) {
  console.error(`[check-env] ❌ ${missing.length} env ที่โค้ดอ่านแต่ไม่ได้ลงทะเบียนใน src/config.js DEFS:`);
  for (const n of missing) console.error(`   ${n}  (${used.get(n)})`);
  console.error('   เพิ่มเข้า DEFS พร้อม type/def ก่อน commit');
  process.exit(1);
}

console.log(`[check-env] ✅ env ${used.size} ตัวที่โค้ดอ่าน อยู่ใน DEFS (${defs.size} ตัว) ครบทุกตัว`);
