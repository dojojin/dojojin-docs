// ============================================================
// Vigil Platform — test: ป้าย "ข้อมูล ณ HH:MM" ต้องอยู่เฉพาะกราฟ Realtime
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของทัก 2026-09-16: กราฟ 24 ชม./ย้อนหลัง N วัน/รายเดือน (ข้อมูลวันที่ปิดจบแล้ว)
// ไม่ควรมีป้าย "ข้อมูล ณ HH:MM" เพราะมันคือ generated_at เดียวกันของทั้งหน้า ไม่ได้
// รีเฟรชตอนกดปุ่ม 3/5/7 วัน — ทำให้ดูเหมือนกดปุ่มแล้วข้อมูลไม่อัพเดท ทั้งที่ตัวเลข
// จริงเปลี่ยนถูกต้องอยู่แล้ว มีแต่กราฟ Realtime เท่านั้นที่ควรมีป้ายนี้
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'page-traffic.js'), 'utf8');

describe('ป้าย "ข้อมูล ณ HH:MM" เฉพาะกราฟ Realtime', () => {
  it('_trfHelmetTotalBadge รับพารามิเตอร์ withStamp default true', () => {
    assert.match(src, /function _trfHelmetTotalBadge\(overall, evidence, withStamp = true\)/,
      'ต้องมีสวิตช์ withStamp เพื่อปิดป้ายเฉพาะกราฟที่ไม่ใช่ของสด');
  });

  it('กราฟ 24 ชม. / ย้อนหลัง N วัน / รายเดือน ต้องปิดป้าย (withStamp=false)', () => {
    const i24 = src.indexOf('function _trfHelmetRender24h');
    const iRange = src.indexOf('function _trfHelmetRenderRange');
    const iMonth = src.indexOf('function _trfHelmetRenderMonth');
    for (const [name, i] of [['24h', i24], ['range', iRange], ['month', iMonth]]) {
      assert.ok(i > 0, `ไม่พบฟังก์ชัน ${name}`);
      const body = src.slice(i, i + 900);
      assert.match(body, /_trfHelmetTotalBadge\(overall, overallOk, false\)/,
        `${name}: ต้องเรียก _trfHelmetTotalBadge(..., false) เพื่อปิดป้าย`);
    }
  });

  it('กราฟ Realtime ยังต้องเปิดป้ายไว้ (ค่า default)', () => {
    const iRt = src.indexOf('function _trfHelmetRenderRealtime');
    assert.ok(iRt > 0, 'ไม่พบฟังก์ชัน Realtime');
    const body = src.slice(iRt, iRt + 1500);
    assert.match(body, /_trfHelmetTotalBadge\(overall, overallOk\)/,
      'ไม่พบการเรียก _trfHelmetTotalBadge ในกราฟ Realtime');
    assert.doesNotMatch(body, /_trfHelmetTotalBadge\(overall, overallOk, false\)/,
      'Realtime ต้องไม่ส่ง false เข้าไป — ต้องใช้ default (withStamp=true)');
  });
});
