// ============================================================
// Vigil Platform — test: GuruSquare import ต้อง pre-check ก่อนวนทั้ง 45 windows
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของถาม 2026-09-17 หลัง GuruSquare (HKT) ปิด API key เองโดยไม่ตั้งใจ —
// sync ล้มทั้ง 45/45 window ด้วยข้อความเดิมซ้ำๆ ("bad edge response (HTTP 502):
// error code: 502" — ข้อความของ Cloudflare tunnel เอง ไม่ใช่ error จากแอป)
// อ่านไม่ออกว่าเป็นปัญหาเดียวกันที่จุดเดียว — เพิ่ม probe เบาๆ ก่อนเริ่มวนทั้งชุด
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'helpers', 'blacklistImport.js'), 'utf8');

describe('GuruSquare import: pre-check ก่อนวนทั้ง windows', () => {
  it('มีฟังก์ชัน edgeTest ยิงไปที่ /blacklist-source-test', () => {
    const i = src.indexOf('function edgeTest');
    assert.ok(i > 0, 'ไม่พบฟังก์ชัน edgeTest');
    const body = src.slice(i, i + 500);
    assert.match(body, /\/blacklist-source-test/, 'ต้องยิง probe เบาไปที่ /blacklist-source-test ไม่ใช่ /blacklist-source-fetch');
  });

  it('importGuruSquare เรียก edgeTest ก่อนเข้า for-loop ของ windows', () => {
    const iFn = src.indexOf('async function importGuruSquare');
    assert.ok(iFn > 0, 'ไม่พบฟังก์ชัน importGuruSquare');
    const iProbe = src.indexOf('edgeTest(', iFn);
    const iLoop = src.indexOf('for (const w of windows)', iFn);
    assert.ok(iProbe > 0 && iLoop > 0, 'ต้องมีทั้ง edgeTest() และ for-loop เดิม');
    assert.ok(iProbe < iLoop, 'edgeTest() ต้องอยู่ก่อน for-loop ของ windows เสมอ');
  });

  it('probe ล้มเหลว ต้อง return finishImport ทันที ไม่ไหลเข้า for-loop', () => {
    const iFn = src.indexOf('async function importGuruSquare');
    const iLoop = src.indexOf('for (const w of windows)', iFn);
    const preCheckBody = src.slice(iFn, iLoop);
    assert.match(preCheckBody, /return finishImport\(pool, source, stats, opts\);/,
      'ต้อง return finishImport() ทันทีเมื่อ probe ล้ม ไม่ใช่ตกไปวน windows ต่อ');
    assert.match(preCheckBody, /API key/, 'ข้อความ error ต้องใบ้ผู้อ่านว่าอาจเป็นเรื่อง API key');
  });

  it('ข้อความ error ของ probe ไม่ปนกับ error รายวินโดว์ปกติ (แยกแยะได้)', () => {
    const iFn = src.indexOf('async function importGuruSquare');
    const iLoop = src.indexOf('for (const w of windows)', iFn);
    const preCheckBody = src.slice(iFn, iLoop);
    assert.match(preCheckBody, /probe แรก/, 'ข้อความต้องระบุว่าเป็น probe แรก ให้ต่างจาก error รายเดือนปกติ');
  });
});
