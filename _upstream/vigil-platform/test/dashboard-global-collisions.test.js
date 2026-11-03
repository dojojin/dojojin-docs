// ============================================================
// Vigil Platform — Tests: สคริปต์ของ dashboard ต้องไม่ประกาศชื่อชนกัน
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// บั๊กจริง 2026-08-24 — `formatBytes` ถูกประกาศเป็น top-level function ทั้งใน
// page-storage.js และ page-files.js · index.html โหลดทั้งคู่เป็น classic script
// จึงอยู่ global scope เดียวกัน ตัวที่โหลดทีหลัง **ทับตัวแรกเงียบ ๆ** ไม่มี error
//
// วันนั้นสองสำเนาเหมือนกันเป๊ะจึงยังไม่เพี้ยน แต่วันที่ใครแก้ฝั่งเดียว อีกหน้าจะ
// เปลี่ยนพฤติกรรมตามโดยไม่มีใครรู้ตัว — และจะไล่หาสาเหตุยากมากเพราะไฟล์ที่แก้
// กับหน้าที่พังเป็นคนละไฟล์กัน
//
// ทางแก้ที่บ้านนี้ใช้: helper ที่ใช้ร่วมกันอยู่ที่ dashboard.js ที่เดียว
// ในรูป `window.x = ...` (แบบเดียวกับ window.escapeHtml)

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DASH = path.join(ROOT, 'dashboard');
const HTML = fs.readFileSync(path.join(DASH, 'index.html'), 'utf8');

// เฉพาะไฟล์ที่ index.html โหลดเป็น classic script — พวกนี้เท่านั้นที่แชร์ global scope
const loaded = [...HTML.matchAll(/<script src="\/([^"]+\.js)"/g)]
  .map((m) => m[1])
  .filter((f) => fs.existsSync(path.join(DASH, f)));

// ประกาศระดับบนสุดเท่านั้น (ไม่มีการเยื้อง) — ในไฟล์ตัวข้างในฟังก์ชันจะถูกเยื้องเสมอ
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;

describe('dashboard classic scripts — ชื่อระดับบนสุดต้องไม่ชนกัน', () => {
  it('index.html โหลดสคริปต์อยู่จริง', () => {
    assert.ok(loaded.length >= 5, `เจอสคริปต์แค่ ${loaded.length} ไฟล์ — น้อยผิดปกติ`);
  });

  it('ไม่มีชื่อไหนถูกประกาศระดับบนสุดในสองไฟล์', () => {
    const owner = new Map();
    const clashes = [];
    for (const f of loaded) {
      for (const line of fs.readFileSync(path.join(DASH, f), 'utf8').split('\n')) {
        const m = line.match(DECL);
        if (!m) continue;
        const name = m[1] || m[2];
        if (owner.has(name) && owner.get(name) !== f) {
          clashes.push(`${name}: ${owner.get(name)} ↔ ${f}`);
        } else {
          owner.set(name, f);
        }
      }
    }
    assert.deepEqual(clashes, [],
      'ชื่อที่ประกาศซ้ำข้ามไฟล์ (ตัวที่โหลดทีหลังจะทับตัวแรกเงียบ ๆ) — ' +
      'ย้ายไปไว้ที่ dashboard.js ที่เดียวในรูป window.x:\n  ' + clashes.join('\n  '));
  });
});
