#!/usr/bin/env node
// ============================================================
// Vigil Platform — ยามตรวจพจนานุกรม i18n
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา 2026-09-13: ตอนไล่ดูคีย์กำพร้าสองตัว เจอบั๊กที่ขึ้นจออยู่จริง 7 จุด
//
//   · หัวตารางหน้าประวัติรายงาน 3 จาก 5 คอลัมน์แสดง "rh.colDate" "rh.colType"
//     "rh.colLayout" เป็นตัวอักษรดิบ เพราะคีย์ไม่มีในพจนานุกรม
//   · ช่องค้นหา 3 จุด (Face match / LPR alert / Map) ไม่เคยถูกแปลเลย เพราะเขียน
//     `data-i18n-placeholder` ซึ่ง applyI18n ไม่รองรับ (ของจริงคือ `data-i18n-ph`)
//   · `common.add` ไม่มีในพจนานุกรม รอดเพราะมี fallback แต่ไม่แปลเป็นอังกฤษตลอดกาล
//
// ทั้งเจ็ดจุดนี้ **ไม่มี error ให้เห็น** — `t()` คืนชื่อคีย์เองเมื่อหาไม่เจอ
// และ attribute ที่สะกดผิดก็แค่ถูกเมิน
//
// 🔴 ตั้งใจ **ไม่ทำ** ตัวกวาด "คีย์ที่ไม่มีใครใช้" ให้ commit ตก — วัดแล้ว false
// positive 75% (สุ่ม 12 ตัวจาก 1,070 ที่สแกนว่ากำพร้า พบว่ามีคนใช้จริง 9 ตัว)
// เพราะคีย์ถูกอ้างผ่านฟังก์ชันห่อของแต่ละหน้า (_blT/_hfsT/_lprsT) · ตารางแปลง
// (`const VIEW_KEY = { face: 'cd2.viewFace' }`) · และการประกอบสตริงตอนรัน
// ⇒ ลบตามผลสแกนเมื่อไหร่ ชื่อคีย์ดิบขึ้นจอเมื่อนั้น · ตรงนี้จึงรายงานเป็นตัวเลขเฉย ๆ
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N = path.join(ROOT, 'dashboard', 'i18n.js');

// attribute ที่ applyI18n รองรับจริง — อ่านจากโค้ดไม่ใช่จำไว้เอง เพราะวันหน้ามีคนเพิ่ม
// ตัวใหม่แล้วยามตัวนี้จะต้องรู้ตาม ไม่ใช่เตือนผิด
function handledAttrs(src) {
  const fn = src.match(/function applyI18n[\s\S]*?\n  \}/);
  const found = new Set((fn ? fn[0] : src).match(/data-i18n[a-z-]*/g) || []);
  found.add('data-i18n');
  return found;
}

function dictKeys(src) {
  const th = src.search(/\bth\s*:\s*\{/);
  const en = src.search(/\ben\s*:\s*\{/);
  if (th < 0 || en < 0) { console.error('[check-i18n] หาบล็อก th/en ใน i18n.js ไม่เจอ'); process.exit(2); }
  const grab = (s) => new Set([...s.matchAll(/'([a-zA-Z0-9_.\-]+)'\s*:/g)].map(m => m[1]));
  return { th: grab(src.slice(th, en)), en: grab(src.slice(en)) };
}

function sourceFiles() {
  const out = [];
  const dash = path.join(ROOT, 'dashboard');
  for (const f of fs.readdirSync(dash)) {
    if ((f.endsWith('.js') || f.endsWith('.html')) && f !== 'i18n.js') out.push(path.join(dash, f));
  }
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  })(path.join(ROOT, 'src'));
  return out;
}

const src = fs.readFileSync(I18N, 'utf8');
const { th, en } = dictKeys(src);
const HANDLED = handledAttrs(src);
const all = new Set([...th, ...en]);

const missing = [];   // โค้ดเรียก แต่ไม่มีในพจนานุกรม → ชื่อคีย์ดิบขึ้นจอ
const badAttr = [];   // attribute ที่ applyI18n ไม่รองรับ → ไม่เคยถูกแปล
const referenced = new Set();

// `I18N.t('x')` และฟังก์ชันห่อของแต่ละหน้า เช่น `_blT('x', 'สำรอง')`
const CALL = /(?:I18N\.t|\b_[a-zA-Z]{1,8}T)\(\s*['"]([a-zA-Z0-9_.\-]+)['"]/g;
const ATTR = /(data-i18n[a-z-]*)=["']([a-zA-Z0-9_.\-]+)["']/g;

for (const file of sourceFiles()) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ATTR)) {
      const [, attr, key] = m;
      if (!HANDLED.has(attr)) { badAttr.push({ rel, ln: i + 1, attr, key }); continue; }
      referenced.add(key);
      // คีย์ที่ลงท้ายด้วยจุดคือ prefix ที่ประกอบต่อตอนรัน ไม่ใช่คีย์จริง
      if (!key.endsWith('.') && !all.has(key)) missing.push({ rel, ln: i + 1, how: attr, key });
    }
    for (const m of line.matchAll(CALL)) {
      const key = m[1];
      referenced.add(key);
      if (!key.endsWith('.') && !all.has(key)) missing.push({ rel, ln: i + 1, how: 'I18N.t', key });
    }
  });
}

const onlyTh = [...th].filter(k => !en.has(k));
const onlyEn = [...en].filter(k => !th.has(k));
const unreferenced = [...all].filter(k => !referenced.has(k));

let bad = 0;

// ── A. ครบทั้งสองภาษาไหม (gotcha #42) ────────────────────────────────────
if (onlyTh.length || onlyEn.length) {
  bad = 1;
  console.error(`[check-i18n] 🔴 คีย์ที่มีแค่ภาษาเดียว: ขาดใน en ${onlyTh.length} · ขาดใน th ${onlyEn.length}`);
  for (const k of onlyTh.slice(0, 15)) console.error(`   ขาดใน en: ${k}`);
  for (const k of onlyEn.slice(0, 15)) console.error(`   ขาดใน th: ${k}`);
  console.error('   ทุกคีย์ใหม่ต้องใส่ทั้งบล็อก th และ en เสมอ (gotcha #42)');
}

// ── B. โค้ดเรียกคีย์ที่ไม่มี → ชื่อคีย์ดิบขึ้นจอ ─────────────────────────
if (missing.length) {
  bad = 1;
  console.error(`[check-i18n] 🔴 คีย์ที่โค้ดเรียกแต่ไม่มีในพจนานุกรม: ${missing.length} จุด`);
  for (const m of missing.slice(0, 20)) console.error(`   ${m.rel}:${m.ln}  ${m.how} → ${m.key}`);
  console.error('   t() คืนชื่อคีย์เองเมื่อหาไม่เจอ ⇒ ผู้ใช้จะเห็นตัวอักษรแบบ "rh.colDate" บนหน้าจอ');
}

// ── C. attribute ที่ applyI18n ไม่รองรับ → ไม่เคยถูกแปลเลย ───────────────
if (badAttr.length) {
  bad = 1;
  console.error(`[check-i18n] 🔴 attribute i18n ที่ applyI18n ไม่รองรับ: ${badAttr.length} จุด`);
  for (const b of badAttr) console.error(`   ${b.rel}:${b.ln}  ${b.attr}="${b.key}"`);
  console.error(`   ที่รองรับจริงมีแค่: ${[...HANDLED].sort().join(' ')}`);
}

if (bad) process.exit(1);

console.log(`[check-i18n] ✅ คีย์ ${all.size} ตัว ครบทั้ง th และ en · ไม่มีคีย์ที่เรียกแล้วหาไม่เจอ`
  + ` · attribute ถูกต้องทุกจุด`);
// ℹ️ รายงานเฉย ๆ ไม่ทำให้ตก — ดูเหตุผลในหัวไฟล์ (false positive 75%)
console.log(`[check-i18n] ℹ️  หาการอ้างถึงแบบตรงตัวไม่เจอ ${unreferenced.length} คีย์`
  + ` — ตัวเลขนี้ไม่ใช่ "ของกำพร้า" ห้ามลบตามนี้โดยไม่ตรวจทีละตัว`);
if (process.argv.includes('--list-unreferenced')) {
  for (const k of unreferenced.sort()) console.log('   ' + k);
}
