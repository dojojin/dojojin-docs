// ============================================================
// Vigil Platform — Tests: ทุกแผนที่ใน dashboard ต้องใช้ CARTO ไม่ใช่ OSM ดิบ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา 2026-09-14: แผนที่จิ๋วในหน้าตั้งค่ากล้อง (page-camera-settings.js) ใช้
// `new ol.source.OSM()` ตรง ๆ — ชี้ไปเซิร์ฟเวอร์อาสาสมัครของ OSM ที่ไม่รองรับ
// แอปโปรดักชันที่มีผู้ใช้หลายคนเปิดซ้ำ ๆ โดยไม่มี caching ฝั่งเรา จนโดนบล็อก
// เป็นหน้า "Access blocked" (osm.wiki/Blocked) เจ้าของเห็นบนจอจริง
//
// สาเหตุที่หลุดรอด: ไฟล์นี้ถูกแยกออกจาก dashboard.js เมื่อ 15 มิ.ย. 2569 โดย
// เอาโค้ดเดิมมาทั้งดุ้น ก่อนระบบย้ายแผนที่หลัก + แผนที่จิ๋วหน้าสรุปภาพรวมไปใช้
// CARTO (ผ่าน cartoUrl()/cartoKey()) — ไม่มี test ยึดไว้เลยว่าแผนที่ตัวใหม่ที่
// จะเพิ่มในอนาคตต้องผ่านจุดเดียวกัน จึงไม่มีใครรู้จนกว่าจะโดนบล็อกจริงบน prod
//
// เทสต์นี้สแกนซอร์ส ไม่ใช่รันจริง เพราะ OpenLayers/แผนที่ต้องมี browser DOM —
// การสแกนพอกันการถดถอยได้ เพราะจุดเสี่ยงคือ "ใครไปพิมพ์ ol.source.OSM() ใหม่"
// ไม่ใช่พฤติกรรมรันไทม์ที่ซับซ้อน

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DASH_DIR = path.join(__dirname, '../dashboard');

function jsFiles() {
  return fs.readdirSync(DASH_DIR).filter(f => f.endsWith('.js'));
}

describe('ห้าม ol.source.OSM() หลุดเข้า dashboard อีก', () => {
  it('ทั้ง dashboard ต้องไม่มี ol.source.OSM() หลงเหลือเลยสักไฟล์', () => {
    // 🔴 ต้องตัดคอมเมนต์ก่อนสแกนเสมอ — คอมเมนต์ที่เตือนว่า "ห้ามใช้ X" มีคำว่า X
    // อยู่ในตัวมันเอง จึงชนกับ pattern นี้เอง (โดนมาแล้วหลายรอบ: `return` ใน
    // edge-snap, LATERAL ใน alert-engine, และรอบนี้คือ ol.source.OSM() ในไฟล์นี้เอง)
    const hits = [];
    for (const f of jsFiles()) {
      const src = fs.readFileSync(path.join(DASH_DIR, f), 'utf8')
        .replace(/\/\/.*$/gm, '');
      src.split('\n').forEach((line, i) => {
        if (/ol\.source\.OSM\(\)/.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    assert.deepEqual(hits, [],
      `เจอ ol.source.OSM() ที่: ${hits.join(', ')} — ต้องใช้ cartoUrl()/cartoKey() แทน `
      + `(ดู dashboard/page-executive-summary.js เป็นแบบอย่าง) ไม่งั้นจะโดน OSM บล็อกซ้ำ`);
  });

  it('แผนที่จิ๋วหน้าตั้งค่ากล้องต้องใช้ CARTO ผ่าน cartoUrl()/cartoKey()', () => {
    const src = fs.readFileSync(path.join(DASH_DIR, 'page-camera-settings.js'), 'utf8');
    assert.match(src, /async function initCamFormMap/, 'ต้องเป็น async เพื่อ await cartoKey()');
    assert.match(src, /await cartoKey\(\)/);
    assert.match(src, /cartoUrl\('streets',\s*cartoMapKey\)/);
    assert.match(src, /ol\.source\.XYZ\(/);
  });

  it('ทั้งสามจุดที่มีแผนที่ (หน้าหลัก, สรุปภาพรวม, ตั้งค่ากล้อง) ใช้ cartoUrl() ตรงกัน', () => {
    // ยึดจำนวนไว้ — เพิ่มแผนที่จุดใหม่ในอนาคตแล้วลืมต่อ CARTO เทสต์นี้จะไม่ขยับ
    // ตามอัตโนมัติ (ตั้งใจ) เตือนให้มาแก้เลขนี้พร้อมตรวจจุดใหม่ด้วยมือ
    const files = ['page-map.js', 'page-executive-summary.js', 'page-camera-settings.js'];
    let count = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(DASH_DIR, f), 'utf8');
      if (/cartoUrl\(/.test(src)) count++;
    }
    assert.equal(count, 3, 'ทั้งสามไฟล์ที่มีแผนที่ต้องเรียก cartoUrl()');
  });
});
