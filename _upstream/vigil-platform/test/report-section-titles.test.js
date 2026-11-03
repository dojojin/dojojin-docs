// ============================================================
// Vigil Platform — Tests: ชื่อหัวข้อรายงานที่ตั้งเองได้ (migration 224)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ค่านี้เดินทางไป 2 ปลายทางที่คนละ process กัน — หน้าจอ (dashboard) และ Puppeteer
// (report-print.html → PDF/PNG ของรายงานอัตโนมัติ) — โดยผ่าน ReportTemplate ตัวเดียว
// เทสต์นี้จึงยึดที่ ReportTemplate กับ validator ฝั่ง server ซึ่งเป็นสองจุดที่ทั้งสอง
// ปลายทางใช้ร่วมกันจริง

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// report-template.js เป็นสคริปต์ของเบราว์เซอร์ — ต้องมี global window/I18N ก่อน require
global.window = global;
global.I18N = {
  getLang: () => 'th',
  t: (k, fb) => ({
    'rt.trendTitle': 'ภาพรวมเหตุการณ์ {label}',
    'rt.byCategory': 'รายละเอียดตามหมวดหมู่',
    'rt.quietCameras': 'กล้องที่ไม่มีกิจกรรม',
  }[k] || fb || k),
};
const RT = require('../dashboard/report-template.js');
const { validateReportSectionTitles, REPORT_SECTION_KEYS } = require('../src/routes/settings');

describe('ReportTemplate.setSectionTitles / secTitle', () => {
  beforeEach(() => RT.setSectionTitles({}));

  it('ยังไม่ตั้งชื่อเอง = ได้ชื่อเริ่มต้นจาก i18n เหมือนเดิมทุกหัวข้อ', () => {
    assert.equal(RT.secTitle('quiet'), 'กล้องที่ไม่มีกิจกรรม');
    assert.equal(RT.secTitle('catchart'), 'รายละเอียดตามหมวดหมู่');
  });

  it('ตั้งชื่อเองแล้วชนะค่าเริ่มต้น', () => {
    RT.setSectionTitles({ quiet: 'กล้องเงียบ' });
    assert.equal(RT.secTitle('quiet'), 'กล้องเงียบ');
    assert.equal(RT.secTitle('catchart'), 'รายละเอียดตามหมวดหมู่', 'หัวข้ออื่นต้องไม่ถูกกระทบ');
  });

  it('ค่าว่าง / ช่องว่างล้วน / ไม่ใช่สตริง = ไม่นับว่าตั้งชื่อ ตกไปที่ค่าเริ่มต้น', () => {
    RT.setSectionTitles({ quiet: '   ', catchart: '', trend: 123 });
    assert.equal(RT.secTitle('quiet'), 'กล้องที่ไม่มีกิจกรรม');
    assert.equal(RT.secTitle('catchart'), 'รายละเอียดตามหมวดหมู่');
    assert.equal(RT.secTitle('trend'), 'ภาพรวมเหตุการณ์ {label}');
  });

  it('คีย์นอกรายการถูกทิ้ง — ตั้งชื่อให้หัวข้อที่ไม่มีจริงไม่ได้', () => {
    RT.setSectionTitles({ notASection: 'x' });
    assert.deepEqual(RT.getSectionTitles(), {});
  });

  it('setSectionTitles(null/สตริง) ไม่พังและล้างค่าเดิมทิ้ง', () => {
    RT.setSectionTitles({ quiet: 'กล้องเงียบ' });
    RT.setSectionTitles(null);
    assert.equal(RT.secTitle('quiet'), 'กล้องที่ไม่มีกิจกรรม');
  });

  it('SECTION_TITLE_DEFS ครบทั้ง 9 หัวข้อ และตรงกับ SECTION_KEYS', () => {
    assert.deepEqual(Object.keys(RT.SECTION_TITLE_DEFS).sort(), RT.SECTION_KEYS.slice().sort());
  });

  // หัวข้อ trend มี {label} (ตามชั่วโมง/ตามวัน/ตามสัปดาห์) ต่อท้าย — โค้ดวาดหัวข้อ
  // ใส่ค่าแทน {label} หลังเลือกชื่อที่ชนะแล้ว ชื่อที่ตั้งเองจึงยังใส่ {label} ได้
  it('ชื่อที่ตั้งเองยังใช้ {label} ของหัวข้อ trend ได้', () => {
    RT.setSectionTitles({ trend: 'แนวโน้ม {label} ประจำสัปดาห์' });
    assert.equal(RT.secTitle('trend').replace('{label}', 'ตามวัน'), 'แนวโน้ม ตามวัน ประจำสัปดาห์');
  });
});

describe('validateReportSectionTitles (ฝั่ง server)', () => {
  it('รับ object และ JSON string ได้เท่ากัน', () => {
    assert.equal(validateReportSectionTitles({ quiet: 'ก' }), '{"quiet":"ก"}');
    assert.equal(validateReportSectionTitles('{"quiet":"ก"}'), '{"quiet":"ก"}');
  });

  it('ตัดช่องว่างหัวท้าย และทิ้งค่าว่าง (ว่าง = คืนค่าเริ่มต้น)', () => {
    assert.equal(validateReportSectionTitles({ quiet: '  ก  ', trend: '   ' }), '{"quiet":"ก"}');
  });

  it('คีย์นอก allowlist ถูกทิ้งเงียบ ไม่ใช่ error', () => {
    assert.equal(validateReportSectionTitles({ evil: 'x', quiet: 'ก' }), '{"quiet":"ก"}');
  });

  it('ยาวเกิน 60 ตัวอักษร = error (หัวข้อ 14px ในคอลัมน์ PDF ตัดบรรทัดเละ)', () => {
    assert.throws(() => validateReportSectionTitles({ quiet: 'ก'.repeat(61) }), /too long/);
    assert.doesNotThrow(() => validateReportSectionTitles({ quiet: 'ก'.repeat(60) }));
  });

  it('ไม่ใช่ object = error (array / null / JSON พัง)', () => {
    assert.throws(() => validateReportSectionTitles('[1,2]'), /must be an object/);
    assert.throws(() => validateReportSectionTitles(null), /must be an object/);
    assert.throws(() => validateReportSectionTitles('{oops'), /must be a JSON object/);
  });

  it('รายชื่อ 9 คีย์ฝั่ง server ตรงกับฝั่ง dashboard เป๊ะ ๆ (ซ้ำกันโดยตั้งใจ)', () => {
    assert.deepEqual(REPORT_SECTION_KEYS.slice().sort(), RT.SECTION_KEYS.slice().sort());
  });
});
