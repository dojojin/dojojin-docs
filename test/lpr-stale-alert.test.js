// ============================================================
// Vigil Platform — Tests: ไม่แจ้งเตือน LINE สำหรับเหตุการณ์ที่มาช้าเกิน 1 ชม.
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา 2026-09-12: กล้องภูเก็ต 4 ตัวค้างไม่ส่งข้อมูล 9 ชั่วโมง แล้วคายออกมาทีเดียว
// ⇒ การ์ดตามจับรถ "ชนแล้วหนี" เข้า LINE ตอนหนึ่งทุ่ม สำหรับรถที่ผ่านกล้องตั้งแต่เที่ยง
// เจ้าของตัดสิน: **เกิน 1 ชม. ไม่ต้องส่ง ตำรวจตามไม่ทันอยู่ดี** แต่ **ต้องยังอยู่ใน
// Alarm List บนหน้าจอตามปกติ**
//
// สองอย่างที่เทสต์นี้ยึดไว้ และพังได้เงียบมากถ้าไม่มีใครยึด:
//   1. ปุ่ม "ส่งให้ตำรวจ" ต้องยังส่งเหตุการณ์เก่าได้ (คนตัดสินใจเอง ไม่ใช่ระบบ)
//   2. รายการบนหน้าจอต้องไม่ผูกกับผลการส่ง LINE

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  suppressionReason, STALE_LABEL_SEC_DEFAULT, STALE_MAX_SEC_DEFAULT,
} = require('../src/helpers/lprLineAlert');

const ok = { lineEnabled: true, groupNotify: true, plateNotify: true,
             recipientCount: 2, cooldownRemainingSec: 0, hourlySent: 0 };

describe('เกณฑ์อายุเหตุการณ์', () => {
  it('ค่าเกณฑ์ตรงกับที่เจ้าของสั่ง — ติดป้าย 15 นาที · ไม่ส่ง 1 ชม.', () => {
    assert.equal(STALE_LABEL_SEC_DEFAULT, 900);
    assert.equal(STALE_MAX_SEC_DEFAULT, 3600);
    assert.ok(STALE_LABEL_SEC_DEFAULT < STALE_MAX_SEC_DEFAULT,
      'ป้ายต้องมาก่อนเพดาน ไม่งั้นไม่มีทางเห็นป้ายเลย');
  });

  it('สด ๆ ส่งปกติ · พอดี 1 ชม. ยังส่ง · เกิน 1 วินาทีไม่ส่ง', () => {
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 30 }), null);
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 3600 }), null, 'เป็นเพดาน ไม่ใช่ off-by-one');
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 3601 }), 'stale_skip');
  });

  it('ของจริงวันที่ 12 ก.ย. — สองใบที่ช้า 5-6 ชม. ต้องถูกระงับ', () => {
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 362 * 60 }), 'stale_skip');
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 308 * 60 }), 'stale_skip');
    // ใบที่ช้า 1 ชม. 57 น. ก็เกินเกณฑ์เหมือนกัน
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 117 * 60 }), 'stale_skip');
  });

  it('ไม่รู้เวลาเหตุการณ์ = ไม่เอาเกณฑ์นี้มาตัดสิน (ปล่อยส่ง ดีกว่าเงียบเพราะข้อมูลขาด)', () => {
    assert.equal(suppressionReason({ ...ok, eventAgeSec: null }), null);
    assert.equal(suppressionReason(ok), null, 'ผู้เรียกเก่าที่ไม่ส่งฟิลด์นี้มาต้องทำงานเหมือนเดิม');
  });

  it('มาก่อน cooldown — ใบที่ไม่ส่งต้องไม่กินหน้าต่าง cooldown ของใบสด', () => {
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 7200, cooldownRemainingSec: 300 }), 'stale_skip');
  });

  it('มาหลัง no_recipients — เหตุผลที่บันทึกต้องเป็นตัวที่บล็อกจริงตัวแรก', () => {
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 7200, recipientCount: 0 }), 'no_recipients');
  });

  it('ตั้งเกณฑ์เองได้ เผื่อย้ายไปเป็นค่าตั้งค่าในอนาคต', () => {
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 700, staleMaxSec: 600 }), 'stale_skip');
    assert.equal(suppressionReason({ ...ok, eventAgeSec: 700, staleMaxSec: 1800 }), null);
  });
});

// ── สองข้อนี้ตรวจที่ซอร์ส เพราะเป็นสมบัติของ "การต่อสาย" ไม่ใช่ของฟังก์ชันเดี่ยว ──
const ALERT_SRC = fs.readFileSync(path.join(__dirname, '../src/helpers/lprLineAlert.js'), 'utf8');
const ROUTE_SRC = fs.readFileSync(path.join(__dirname, '../src/routes/lpr-alerts.js'), 'utf8');

describe('ปุ่ม "ส่งให้ตำรวจ" ต้องไม่ถูกเกณฑ์นี้ปิดปาก', () => {
  it('เส้นทางกดส่งเองส่ง force: true', () => {
    assert.match(ROUTE_SRC, /force:\s*true/, 'route กดส่งเองต้องส่ง force:true');
    assert.match(ROUTE_SRC, /manualBy:/, 'และต้องบอกว่าใครเป็นคนกด');
  });

  it('force ข้าม suppressionReason ทั้งก้อน — เกณฑ์อายุจึงไม่แตะการตัดสินใจของคน', () => {
    assert.match(ALERT_SRC, /const reason = force \? null : suppressionReason\(checks\);/);
  });

  it('เช็คอายุอยู่ใน suppressionReason ไม่ใช่ลอยอยู่นอกฟังก์ชัน', () => {
    // ถ้าวันหน้ามีคนย้ายไปเช็คก่อนบรรทัด force จะกลายเป็นปิดปากคนกดส่งเอง
    // `}) {` ปิดรายการพารามิเตอร์ก็ขึ้นต้นบรรทัดด้วย } เหมือนกัน — ต้องบังคับว่า
    // ทั้งบรรทัดเป็น } ตัวเดียว ไม่งั้นจับได้แค่หัวฟังก์ชัน ไม่ถึงเนื้อใน
    const fn = ALERT_SRC.match(/^function suppressionReason\([\s\S]*?^\}$/m)[0];
    assert.match(fn, /stale_skip/, 'stale_skip ต้องอยู่ใน suppressionReason');
    const outside = ALERT_SRC.replace(fn, '');
    assert.equal(/return 'stale_skip'/.test(outside), false,
      'เจอ stale_skip นอก suppressionReason — จะข้าม force ไม่ได้');
  });
});

describe('Alarm List บนหน้าจอต้องไม่ผูกกับผลการส่ง LINE', () => {
  it('คิวรีรายการอ่านจาก events ⨝ license_plates ⨝ lpr_watchlist ไม่ใช่ alert_logs', () => {
    const base = ROUTE_SRC.match(/const BASE =[\s\S]*?`;/)[0];
    assert.match(base, /FROM events e/);
    assert.match(base, /JOIN license_plates lp/);
    assert.match(base, /JOIN lpr_watchlist\s+w/);
    assert.equal(/alert_logs/.test(base), false,
      'รายการห้ามอ่าน alert_logs — ไม่งั้น stale_skip จะทำให้แถวหายจากหน้าจอ');
  });

  it('ตัวจัดการ GET /api/lpr/alerts ไม่กรองด้วยสถานะการส่ง', () => {
    const handler = ROUTE_SRC.match(/app\.get\('\/api\/lpr\/alerts'[\s\S]*?\n  \}\);/)[0];
    assert.equal(/alert_logs|status\s*=\s*'sent'/.test(handler), false,
      'เจอเงื่อนไขผูกกับการส่ง — เหตุการณ์ที่ไม่ได้ส่ง LINE จะหายจากรายการ');
  });
});
