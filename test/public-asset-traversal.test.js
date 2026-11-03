// ============================================================
// Vigil Platform — Tests: prefix สาธารณะต้องไม่เปิดทางให้ข้าม auth ด้วย path traversal
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// บั๊กจริง 2026-08-24 — reproduce แล้วบน production:
//
//   GET https://dashboard.dojojin.tech/pub/img/../../index.html
//     → 200, 423 KB, dashboard เต็ม ๆ โดยไม่ต้องล็อกอิน
//   GET https://dashboard.dojojin.tech/index.html
//     → 302 เด้งไป login (พฤติกรรมที่ถูก)
//
// เหตุ: `isPublicAsset()` เทียบ prefix ด้วย `startsWith()` กับ path ดิบ
// '/pub/img/../../index.html' ขึ้นต้นด้วย '/pub/img/' จริง จึงถูกตัดสินว่าเป็น public
// แล้วข้าม auth ทั้งก้อน ส่วน Express มา resolve '..' ทีหลังแล้วเสิร์ฟไฟล์ให้
// กระทบ prefix ทุกตัวไม่ใช่แค่ /pub/ — /vendor/ /branding/ /tiles/ /face-push/ ก็โดน
//
// เทสต์นี้ดึงตัวฟังก์ชันจริงออกมาจาก api-server.js มารัน ไม่ใช่ grep หาสตริง
// เพราะกฎที่ตรวจด้วยการ grep จะยังเขียวอยู่แม้ตรรกะจะถูกเขียนใหม่จนพัง

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-server.js'), 'utf8');

// ตัดช่วงที่ประกาศรายชื่อ public ทั้งหมด + ตัวฟังก์ชัน ออกมารันแยก
// ถ้าใครย้าย/เปลี่ยนชื่อของพวกนี้ เทสต์จะพังเสียงดัง ไม่ใช่ผ่านไปเงียบ ๆ
const BEGIN = 'const PUBLIC_HTML_FILES = new Set([';
const END = '\nfunction isPublicAsset(reqPath) {';
const b = SRC.indexOf(BEGIN);
const e = SRC.indexOf(END);
assert.ok(b !== -1, 'หา PUBLIC_HTML_FILES ใน api-server.js ไม่เจอ');
assert.ok(e > b, 'หา isPublicAsset ใน api-server.js ไม่เจอ');

// จบฟังก์ชันที่ '\n}' ตัวแรกหลังหัวฟังก์ชัน (ฟังก์ชันนี้ไม่มี nested function)
const fnEnd = SRC.indexOf('\n}', e);
assert.ok(fnEnd > e, 'หาปลายฟังก์ชัน isPublicAsset ไม่เจอ');

const ctx = { module: {}, exports: {} };
vm.createContext(ctx);
vm.runInContext(SRC.slice(b, fnEnd + 2) + '\nmodule.exports = { isPublicAsset, PUBLIC_PREFIXES };', ctx);
const { isPublicAsset, PUBLIC_PREFIXES } = ctx.module.exports;

describe('isPublicAsset — path traversal ต้องไม่ถูกนับเป็น public', () => {
  it('ดึงฟังก์ชันจริงออกมาได้ และมี prefix ให้ตรวจ', () => {
    assert.equal(typeof isPublicAsset, 'function');
    assert.ok(PUBLIC_PREFIXES.length >= 5, 'PUBLIC_PREFIXES น้อยผิดปกติ');
  });

  // ทุก prefix ต้องกันได้เหมือนกันหมด ไม่ใช่กันเฉพาะ /pub/ ที่เป็นตัวที่เจอบั๊ก
  for (const p of ['/vendor/', '/branding/', '/tiles/', '/face-push/',
                   '/pub/img/', '/pub/ref/', '/pub/rpt/', '/pub/fil/']) {
    it(`${p} + traversal ต้องไม่ public`, () => {
      for (const suffix of [
        '../../index.html',           // เคสที่ reproduce ได้จริงบน production
        '../../dashboard.js',
        '..%2f..%2findex.html',       // encode ครั้งเดียว
        '%2e%2e/index.html',          // encode จุด
        '%252e%252e/index.html',      // encode สองชั้น
        '..;/index.html',             // path parameter trick
        './../index.html',
        '../.env',
      ]) {
        assert.equal(isPublicAsset(p + suffix), false,
          `${p}${suffix} ต้องไม่ถูกนับเป็น public asset`);
      }
    });
  }

  // กันไม่ให้ "แก้จนเกินเลย" — ของจริงต้องยังผ่าน ไม่งั้น LINE ดึงรูปไม่ได้
  // และหน้า login จะโหลด vendor asset ไม่ขึ้น
  it('path ปกติต้องยังเป็น public เหมือนเดิม', () => {
    for (const ok of [
      '/vendor/air-datepicker/air-datepicker.min.js',
      '/branding/logo.png',
      '/pub/img/events/2026-06-24/BOSCH_8100iX_02/0400/event_mqtt_1782274577448.jpg',
      '/pub/fil/11111111-2222-3333-4444-555555555555.pdf',
      '/pub/rpt/report_health_2026-08-24_1756000000000.png',
      '/face-push/abcdef0123456789',
      '/login.html',
      '/disclaimer.html',
    ]) {
      assert.equal(isPublicAsset(ok), true, `${ok} ต้องยังเป็น public asset`);
    }
  });

  it('path ที่ควรต้องล็อกอิน ยังต้องไม่ public', () => {
    // หมายเหตุ: /i18n.js เป็น public โดยตั้งใจ (หน้า login/disclaimer โหลดก่อนล็อกอิน)
    // จึงไม่อยู่ในรายการนี้ — ตรวจแล้วใน PUBLIC_HTML_FILES
    for (const no of ['/index.html', '/dashboard.js', '/index.css', '/api/cameras', '/']) {
      assert.equal(isPublicAsset(no), false, `${no} ต้องไม่เป็น public asset`);
    }
  });
});
