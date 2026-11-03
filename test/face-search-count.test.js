// ============================================================
// Vigil Platform — test: แท็บค้นหาใบหน้าต้องไม่นับทั้งกองก่อน LIMIT
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เหตุจริง 2026-08-27: หน้า Face Recognition Matches ค้าง วัดบนช่วง "เดือนนี้"
// (FaceCapture 3.1 ล้านแถว):
//   /api/faces มี COUNT(*) OVER()   >200 วินาที (ถูกฆ่าทิ้ง ไม่จบ)
//   ไม่มี                              0.03 วินาที
//   /api/faces/counts นับ capture     29.92 วินาที → เหลือเฉพาะ recog 1.08 วินาที
//
// window function บังคับให้ประเมินทุกแถวที่ตรงเงื่อนไข "ก่อน" จะ LIMIT ⇒ LIMIT
// ไม่มีความหมาย · เป็นบั๊กคลาสเดียวกับที่ /api/face-matches เจอเมื่อ 2026-08-21
// เทสต์นี้กันไม่ให้ COUNT(*) OVER() กลับเข้ามาในเส้นทางที่มีคนนั่งรออยู่
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'faces.js'), 'utf8');

// ตัดบรรทัดคอมเมนต์ทิ้งก่อนเสมอ — คอมเมนต์ที่อธิบายบั๊กนี้พูดถึง COUNT(*) OVER()
// ตรง ๆ ถ้าไม่ตัด เทสต์จะไปจับคำอธิบายแล้วฟ้องว่าบั๊กกลับมา ทั้งที่โค้ดถูกต้อง
// (พลาดแบบนี้มาแล้วกับเทสต์ห้าม emoji ที่ไปจับ emoji ในคอมเมนต์ของตัวเอง)
const stripComments = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

function handlerBody(routePath) {
  const start = SRC.indexOf(`app.get('${routePath}'`);
  assert.ok(start > -1, `หา handler ${routePath} ไม่เจอ`);
  const next = SRC.indexOf('\n  app.', start + 10);
  return stripComments(SRC.slice(start, next > -1 ? next : SRC.length));
}

const faces  = handlerBody('/api/faces');
const counts = handlerBody('/api/faces/counts');

// ── 1. ห้ามมี window count ในเส้นทางที่ผู้ใช้นั่งรอ ──────────────────────────
for (const [name, body] of [['/api/faces', faces], ['/api/faces/counts', counts]]) {
  assert.ok(!/COUNT\(\*\)\s*OVER\s*\(\)/i.test(body),
    `${name}: COUNT(*) OVER() กลับมาแล้ว — LIMIT จะไม่มีความหมายและหน้าจะค้างอีก`);
}

// ── 2. ต้องรู้ว่ามีหน้าถัดไปด้วยการขอเกินมา 1 แถว ไม่ใช่ด้วยการนับ ───────────
assert.ok(/limit \+ 1/.test(faces), 'ต้องขอเกินมา 1 แถวเพื่อรู้ว่ามีหน้าถัดไป');
assert.ok(/X-Has-More/.test(faces), 'ต้องส่ง X-Has-More ให้ pager ใช้แทนยอดรวม');

// ── 3. การนับต้องแยก + มีเพดาน + อยู่ใน transaction ─────────────────────────
// 🔴 SET LOCAL นอก transaction block ไม่มีผล — Postgres เตือนแล้วปล่อยค่าเดิม
//    เคยพลาดมาแล้วที่ /api/face-matches (เพดานไม่เคยทำงานเลย) จนต้องมาห่อ BEGIN
{
  assert.ok(/SET LOCAL statement_timeout/.test(faces), 'การนับต้องมีเพดานเวลา');
  const i = faces.indexOf('SET LOCAL statement_timeout');
  const before = faces.slice(Math.max(0, i - 400), i);
  assert.ok(/BEGIN/.test(before),
    'SET LOCAL ต้องอยู่ใน transaction block ไม่งั้นเพดานไม่ทำงานเลย');
  assert.ok(/with_total !== '0'/.test(faces),
    'ผู้เรียกที่ไม่ต้องใช้ยอดรวมต้องปิดได้ด้วย with_total=0');
}

// ── 4. ป้ายแท็บต้องไม่ไปนับ FaceCapture อีก ─────────────────────────────────
// capture = 3.1 ล้านแถวทั้งประวัติ ไม่มีขอบเขตเวลา · match+miss รวมกัน ~107k
assert.ok(!/CAPTURE_TYPES_SQL/.test(counts),
  'ป้ายแท็บต้องไม่แตะ FaceCapture — นั่นคือ 30 วินาทีที่ทุกคนต้องรอตอนเปิดหน้า');
assert.ok(/RECOG_TYPES_SQL/.test(counts), 'ยังต้องนับฝั่ง recognition อยู่');

// ── 5. สามอย่างที่ยังต้องรอด — ป้ายแท็บแจ้งเตือน / pill ค้าง / สวิตช์กราฟอารมณ์ ──
// ถ้าเผลอลบ endpoint นี้ทิ้งทั้งอัน สามอย่างนี้จะหายไปเงียบ ๆ
for (const k of ['match', 'unacked_watch', 'show_expression']) {
  assert.ok(counts.includes(k), `/api/faces/counts ต้องยังคืน ${k}`);
}
assert.ok(/capture: null/.test(counts),
  'capture ต้องเป็น null ไม่ใช่ 0 — 0 อ่านว่า "ไม่มีใบหน้าเลย" ซึ่งไม่จริง');

// ── 6. แท็บค้นหาต้องไม่ถูกกระตุกด้วย event ที่วิ่งเข้ามา ────────────────────
// ~47k ภาพต่อวัน ⇒ pill กะพริบแทบตลอดเวลาระหว่างที่คนกำลังอ่านผลค้นหา
// แท็บ "สด" ต้องยังวิ่งตามปกติ — มันมีหน้าที่ขยับ
{
  const DASH = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'dashboard.js'), 'utf8');
  const live = DASH.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/faceNoteNew\s*\(\s*\)/.test(live),
    'แท็บค้นหาต้องไม่ประกาศภาพใหม่อีก — เรียก faceNoteNew() จากที่ไหนไม่ได้แล้ว');
  assert.ok(/faceLivePush/.test(live), 'แท็บสดต้องยังได้รับภาพใหม่ตามปกติ');
}

// ── 7. การนับต้องแยกออกมาเป็นคำขอของตัวเอง ──────────────────────────────────
// วัดจริง 2026-08-27: นับพร้อมตารางในคำขอเดียว ช่วงกว้างกว่า 1 ชั่วโมงจะนับไม่ทัน
// ในเพดาน 500ms ⇒ ทุกคนจ่าย 500ms ทิ้งแล้วไม่ได้เลขกลับมา (0.51 วินาที ทั้งที่
// ตัวข้อมูลใช้ 0.01) · พอแยกออกมา ตารางขึ้นทันทีและได้ยอดจริงถึงช่วง 24 ชั่วโมง
{
  assert.ok(/req\.query\.count === 'only'/.test(faces), 'ต้องรับ ?count=only');
  assert.ok(/FACE_COUNT_ONLY_TIMEOUT_MS/.test(faces),
    'คำขอนับอย่างเดียวต้องมีเพดานของตัวเอง (ยาวกว่า เพราะไม่มีใครนั่งรอหน้าเปล่า)');
  const i = faces.indexOf("req.query.count === 'only'");
  const j = faces.indexOf('SET LOCAL statement_timeout', i);
  assert.ok(j > -1 && /BEGIN/.test(faces.slice(i, j)),
    'สาขา count=only ก็ต้องห่อ BEGIN ไม่งั้น SET LOCAL ไม่มีผล');
  assert.ok(/exact: false/.test(faces),
    'นับไม่ทันต้องบอกตรง ๆ ว่าไม่มีเลข ไม่ส่งค่าประมาณ');

  const PAGE = stripComments(fs.readFileSync(
    path.join(__dirname, '..', 'dashboard', 'page-face-matches.js'), 'utf8'));
  assert.ok(/params\.set\('with_total', '0'\)/.test(PAGE),
    'คำขอของตารางต้องปิดการนับ ไม่งั้นตารางไปรอการนับเหมือนเดิม');
  assert.ok(/_faceTab2Seq/.test(PAGE),
    'ต้องมีลำดับกันผลของการค้นหาเก่ามาทับผลใหม่');
  assert.ok(/_faceFetchCount/.test(PAGE), 'ต้องยิงนับแยกหลังตารางขึ้น');
}

// ── 8. ข้อความใหม่ต้องมีครบทั้งสองภาษา (gotcha #42) ─────────────────────────
{
  const I18N = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'i18n.js'), 'utf8');
  const n = (I18N.match(/'face\.counting'/g) || []).length;
  assert.strictEqual(n, 2, `face.counting ต้องมีทั้ง th และ en — เจอ ${n} ชุด`);
}

console.log('✅ face search count: ผ่าน 8 ข้อ');
