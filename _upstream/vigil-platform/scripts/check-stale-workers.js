#!/usr/bin/env node
// ============================================================
// Vigil Platform — หา process ที่ยังรันโค้ดเก่ากว่าไฟล์ที่แก้ไป
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เหตุการณ์จริง 2026-08-25 — เจ้าของตั้งค่ารายงานให้ซ่อนหมวดหนึ่งและปิดคอลัมน์
// เทียบก่อนหน้า ค่าถูกบันทึกลง DB ครบถ้วน แต่รายงานที่ส่งเข้า LINE ตอน 08:00
// ยังมีทั้งสองอย่างอยู่
//
//   โค้ดที่แก้            25/8 02:05
//   report-worker เริ่มรัน 24/8 12:35   ← เก่ากว่าโค้ด 13 ชั่วโมง
//   api-server เริ่มรัน    25/8 02:37   ← restart เฉพาะตัวนี้
//
// ตัวที่เรนเดอร์และส่งรายงานตามตารางคือ report-worker ซึ่งเป็นคนละ process
// มันจึงรันไฟล์ฉบับเก่าในหน่วยความจำต่อไป **โดยไม่มีอะไรฟ้อง** — โค้ดถูก
// เทสต์เขียว หน้าจอถูก แต่ของที่ส่งออกไปเป็นของเก่า
//
// สคริปต์นี้เทียบเวลาเริ่มของแต่ละ process กับ mtime ของไฟล์ .js ใต้ src/
// ที่ process นั้น require เข้าไปจริง (ตามที่ Node รายงานใน process.moduleLoadList
// ไม่ได้ — จึงใช้การไล่ require graph แบบสถิตแทน ซึ่งครอบคลุมพอสำหรับงานนี้)
//
// ใช้: node scripts/check-stale-workers.js
// ออก 1 เมื่อมี process ที่ต้อง restart — ใช้ในขั้นตอนหลัง deploy ได้

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DASH = path.join(ROOT, 'dashboard');

// ── เหตุการณ์จริง 2026-09-19 — คลาสเดียวกัน แต่ require graph มองไม่เห็น ──────
// เจ้าของสั่งแก้ข้อความบนหน้ากวดขันวินัยจราจร · commit + push + pull ครบ 5 ไซต์
// แต่หน้าเว็บยังโชว์ข้อความเดิม เจ้าของ purge cache ที่ Cloudflare ก็ไม่หาย
//
// เพราะ DASHBOARD_BUNDLE ตั้งต้นเปิด ⇒ dashboard ไม่ได้โหลด page-*.js ทีละไฟล์
// แต่โหลด /dashboard.bundle.js ซึ่ง **ประกอบในหน่วยความจำครั้งเดียวตอน api-server
// boot** (src/routes/static-shell.js — IIFE buildDashboardBundle) · git pull
// เปลี่ยนไฟล์บนดิสก์แล้ว แต่ process ไม่เคยอ่านซ้ำ
//
// 🔴 และ ?v= ของ bundle ก็คิดตอน boot เหมือนกัน ⇒ URL ไม่เปลี่ยน เนื้อไม่เปลี่ยน
//    แคชปลายทางจึงไม่เกี่ยวเลย purge กี่รอบก็ได้ของเดิมจากต้นทางอยู่ดี
//
// ไฟล์พวกนี้ถูกอ่านด้วย fs ตอน runtime ไม่ได้ require ⇒ collectDeps() มองไม่เห็น
// ต้องเติมเข้าไปเองให้ process ที่ประกอบ bundle
function bundleInputs() {
  const files = [path.join(DASH, 'index.html')];
  try {
    const { bundleIndexHtml } = require(path.join(SRC, 'helpers', 'dashboardBundle'));
    const html = fs.readFileSync(path.join(DASH, 'index.html'), 'utf8');
    for (const f of bundleIndexHtml(html, {}).files) files.push(path.join(DASH, f));
  } catch {
    // ตัวประกอบ bundle เรียกไม่ได้ → เอาทุกไฟล์ .js ใต้ dashboard/ แทน
    // (เป็น superset จึงอาจเตือนเกินจริงบ้าง ดีกว่าเงียบแล้วปล่อยของเก่าขึ้น prod)
    try {
      for (const n of fs.readdirSync(DASH)) if (n.endsWith('.js')) files.push(path.join(DASH, n));
    } catch {}
  }
  return files;
}

// ไล่ require graph แบบสถิต เริ่มจากไฟล์ entry ของ process
function collectDeps(entry, seen = new Set()) {
  const abs = path.resolve(entry);
  if (seen.has(abs) || !fs.existsSync(abs) || abs.includes('node_modules')) return seen;
  seen.add(abs);
  let src = '';
  try { src = fs.readFileSync(abs, 'utf8'); } catch { return seen; }
  for (const m of src.matchAll(/require\(\s*'(\.[^']+)'/g)) {
    let dep = path.resolve(path.dirname(abs), m[1]);
    if (!fs.existsSync(dep) && fs.existsSync(dep + '.js')) dep += '.js';
    else if (fs.existsSync(dep) && fs.statSync(dep).isDirectory()) dep = path.join(dep, 'index.js');
    if (fs.existsSync(dep)) collectDeps(dep, seen);
  }
  return seen;
}

let list;
try {
  list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  console.error('  เรียก pm2 jlist ไม่ได้ — ข้ามการตรวจ');
  process.exit(0);
}

const stale = [];
for (const proc of list) {
  const entry = proc.pm2_env && proc.pm2_env.pm_exec_path;
  if (!entry || !entry.startsWith(SRC)) continue;          // ดูเฉพาะของเราเอง
  const started = proc.pm2_env.pm_uptime;
  let newest = 0, newestFile = null;
  const watched = collectDeps(entry);
  // process ที่ประกอบ bundle ตอน boot ต้องนับไฟล์ใน dashboard/ เป็นอินพุตด้วย
  if ([...watched].some(f => f.endsWith(path.join('routes', 'static-shell.js')))) {
    for (const f of bundleInputs()) watched.add(f);
  }
  for (const f of watched) {
    let mt;
    try { mt = fs.statSync(f).mtimeMs; } catch { continue; }
    if (mt > newest) { newest = mt; newestFile = f; }
  }
  if (newest > started) {
    stale.push({
      name: proc.name,
      started: new Date(started),
      file: path.relative(ROOT, newestFile),
      changed: new Date(newest),
    });
  }
}

if (!stale.length) {
  console.log('  ✅ ทุก process รันโค้ดล่าสุดแล้ว');
  process.exit(0);
}

console.log('  🔴 process ที่ยังรันโค้ดเก่ากว่าไฟล์ที่มันโหลด:\n');
for (const s of stale) {
  console.log(`     ${s.name}`);
  console.log(`       เริ่มรัน   ${s.started.toLocaleString('th-TH', { hour12: false })}`);
  console.log(`       ไฟล์ใหม่สุด ${s.file}`);
  console.log(`       แก้เมื่อ    ${s.changed.toLocaleString('th-TH', { hour12: false })}\n`);
}
console.log(`  restart ได้ด้วย:  pm2 restart ${stale.map(s => s.name).join(' ')} --update-env`);
console.log('\n  หมายเหตุ: ไม่ได้แปลว่าทุกตัวพัง — ถ้าไฟล์ที่เปลี่ยนไม่เกี่ยวกับสิ่งที่ process นั้นทำ');
console.log('  ก็ยังทำงานถูกอยู่ · แต่ตัวที่ "เกี่ยว" แล้วไม่ restart คือกรณีที่หลุดไปแล้วจริง');
console.log('  (25/8/2569: report-worker ส่งรายงานด้วยโค้ดเก่า ทั้งที่ค่าใน DB ถูกต้อง)');
process.exit(1);
