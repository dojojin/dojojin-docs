// ============================================================
// Vigil Platform — test: renderTraffic() ต้องไม่เด้ง scroll กลับบนสุด
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของเจอ 2026-09-17 (วัดจริงผ่าน Claude in Chrome): กดปุ่มช่วงเวลาในการ์ด
// "ย้อนหลัง" (หน้ากวดขันวินัยจราจร) แล้วหน้าเด้งขึ้นบนสุดทุกครั้ง เพราะ
// renderTraffic() set #trfBody.innerHTML ใหม่ทั้งก้อน ทำให้ `.content`
// (scroll container ของทั้งแอป) โดน clamp scrollTop กลับเป็น 0 — วัดจริง
// production: scrollTop 754.7 → 0 ทันทีที่คลิก ผู้ใช้มองไม่เห็นว่าการ์ด
// อัปเดตแล้ว คิดว่าปุ่มไม่ทำงาน ทั้งที่ state/กราฟถูกต้องอยู่แล้ว
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-traffic.js'), 'utf8');

describe('renderTraffic() ต้องเก็บ/คืนตำแหน่ง scroll ของ .content', () => {
  it('มีฟังก์ชัน _trfPreserveScroll อ้างอิง .content', () => {
    const i = src.indexOf('function _trfPreserveScroll');
    assert.ok(i > 0, 'ไม่พบฟังก์ชัน _trfPreserveScroll');
    const body = src.slice(i, i + 300);
    assert.match(body, /document\.querySelector\('\.content'\)/,
      'ต้องอ่านตำแหน่ง scroll จาก .content (scroll container จริงของทั้งแอป)');
  });

  it('ทุกจุดที่ set #trfBody.innerHTML ใน renderTraffic() ต้องอยู่ใน _trfPreserveScroll', () => {
    const iFn = src.indexOf('function renderTraffic()');
    assert.ok(iFn > 0, 'ไม่พบฟังก์ชัน renderTraffic');
    const iEnd = src.indexOf('\n// ── แท็บ 1', iFn);
    const body = src.slice(iFn, iEnd > iFn ? iEnd : iFn + 3000);
    const innerHtmlCount = (body.match(/el\.innerHTML\s*=/g) || []).length;
    const preserveCount = (body.match(/_trfPreserveScroll\(\(\) => \{/g) || []).length;
    assert.equal(innerHtmlCount, 2, 'จำนวนจุด el.innerHTML= เปลี่ยนไป — ทบทวน test นี้ใหม่');
    assert.equal(preserveCount, 2, 'ทุกจุดที่ set el.innerHTML ต้องห่อด้วย _trfPreserveScroll ครบ');
  });
});
