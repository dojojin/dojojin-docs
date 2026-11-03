// ============================================================
// Vigil Platform — test: ยามเฝ้าตัวเลข "ไม่สวมหมวก · พร้อมข้อมูลทะเบียน"
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา: RCA 2026-09-18 ข้อ 8.3 · ยามที่ปลุกผิดคือยามที่ถูกปิดเสียงทิ้ง เทสต์ชุดนี้
// จึงตรวจสองอย่างเท่า ๆ กัน: ต้องดังกับเหตุจริง และต้องเงียบกับวันปกติที่วัดมาแล้ว
// ตัวเลขฐานทุกตัวในไฟล์นี้มาจากการวัด 30 วันจริงบน central 2026-09-18 ไม่ใช่ค่าสมมติ
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const check = require('../src/helpers/helmetMetricCheck');

const cfg = check.settings(null);
const flat = (rate, n = 14, rows = 40000) => Array.from({ length: n }, () => ({ rate, rows }));

// วัดจริง 30 วัน: hkt median 85.4 sd 0.67 · hdy median 57.7 sd 4.88 · rmutr-v 67.8 sd 8.02
const HDY_BASE = [69.2, 62, 58, 57.7, 55, 61, 52, 63, 57, 59, 54, 60, 56, 58]
  .map(rate => ({ rate, rows: 12000 }));

describe('ค่าตั้งต้นของการเตือน', () => {
  it('ต้องปิดอยู่ และไม่มีผู้รับ', () => {
    // ผู้รับ LINE ที่เปิดอยู่รวมกลุ่มลูกค้าและตำรวจ — ตัวเตือนที่ fallback เป็น
    // "ทุกคน" จะยิงเข้ากลุ่มลูกค้าทันทีที่ใครเปิดสวิตช์ (เหตุผลเดียวกับ quiet_alert)
    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.recipient_ids, []);
  });

  it('recipient_ids ที่ไม่ใช่ array ต้องกลายเป็น [] ไม่ใช่ "ทุกคน"', () => {
    assert.deepEqual(check.settings({ recipient_ids: null }).recipient_ids, []);
    assert.deepEqual(check.settings({ recipient_ids: 'all' }).recipient_ids, []);
  });
});

describe('ต้องดังกับเหตุจริง', () => {
  it('เคสภูเก็ต 10-14 ก.ย.: นิ่งที่ 85% แล้วร่วงเป็นศูนย์', () => {
    const r = check.decide({ site: 'hkt', rate: 0, rows: 43591 }, flat(85.4), cfg);
    assert.equal(r.status, 'drop');
    assert.equal(r.threshold, 75.4, 'เส้นเตือนของไซต์ที่นิ่งมากถูกคุมด้วย min_margin_pp');
  });

  it('ไซต์ที่แกว่งเป็นปกติก็ต้องดังถ้าร่วงถึงศูนย์', () => {
    assert.equal(check.decide({ site: 'hdy', rate: 0, rows: 5458 }, HDY_BASE, cfg).status, 'drop');
  });
});

describe('ต้องเงียบกับวันปกติ', () => {
  it('ภูเก็ตที่ค่าต่ำสุดเท่าที่เคยวัดได้ (84.0%)', () => {
    assert.equal(check.decide({ site: 'hkt', rate: 84.0, rows: 43591 }, flat(85.4), cfg).status, 'ok');
  });

  it('หาดใหญ่ที่ค่าต่ำสุดเท่าที่เคยวัดได้ (36.7%) — จุดที่เกณฑ์ตายตัวจะปลุกผิด', () => {
    // "ตก 15 จุดจาก median" จะปลุกที่นี่ เพราะหาดใหญ่แกว่ง 21 จุดเป็นเรื่องปกติ
    assert.equal(check.decide({ site: 'hdy', rate: 36.7, rows: 5458 }, HDY_BASE, cfg).status, 'ok');
  });

  it('RMUTR-V ที่ค่าต่ำสุดเท่าที่เคยวัดได้ (51.3%)', () => {
    const base = [81.7, 67.8, 72, 60, 75, 64, 70, 58, 66, 73, 62, 69, 77, 65]
      .map(rate => ({ rate, rows: 1500 }));
    assert.equal(check.decide({ site: 'rmutr-v', rate: 51.3, rows: 1200 }, base, cfg).status, 'ok');
  });
});

describe('ไซต์ที่ยังเฝ้าไม่ได้ ต้องไม่ถูกนับว่าผ่าน', () => {
  it('ฐานเปรียบเทียบสั้นเกินไป', () => {
    const r = check.decide({ site: 'new', rate: 10, rows: 40000 }, flat(85, 3), cfg);
    assert.equal(r.status, 'not_watchable');
    assert.equal(r.reason, 'baseline_days');
  });

  it('วันที่รถน้อยผิดปกติ — อัตราแกว่งตามตัวหาร ไม่ใช่สัญญาณของเกณฑ์ที่พัง', () => {
    const r = check.decide({ site: 'hkt', rate: 0, rows: 5 }, flat(85.4), cfg);
    assert.equal(r.status, 'not_watchable');
    assert.equal(r.reason, 'today_rows');
  });

  it('วันที่ข้อมูลน้อยในฐาน ต้องไม่ถูกนับเข้าไปคิด median', () => {
    const base = [...flat(85.4, 10), ...flat(5, 10, 3)];   // 10 วันปกติ + 10 วันข้อมูลน้อย
    const r = check.decide({ site: 'hkt', rate: 84, rows: 40000 }, base, cfg);
    assert.equal(r.baseline_days, 10);
    assert.equal(r.median, 85.4, 'วันข้อมูลน้อยต้องถูกคัดออกก่อนคิดฐาน');
  });
});

describe('ตารางเวลา', () => {
  it('ไม่คืน 0 แม้ตอน timer ตื่นตรงเวลาพอดี (กันยิงซ้ำ)', () => {
    for (let h = 0; h < 24; h++) {
      const d = new Date(Date.UTC(2026, 8, 18, h, 30, 0));
      const ms = check.nextRunDelayMs(d);
      assert.ok(ms > 0 && ms <= 24 * 3600 * 1000, `h=${h} ได้ ${ms}`);
    }
  });
});
