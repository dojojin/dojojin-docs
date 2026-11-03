// ============================================================
// Vigil Platform — test: ผล "พร้อมข้อมูลทะเบียน" ต้องถูกตรึงตอน INSERT ทุกจุด
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา: RCA 2026-09-18 (docs/reports/2026-09-18_hkt-helmet-evidence-gap_TH.html)
// เกณฑ์เดิมคิดเพดานสด ๆ จาก max(confidence) 30 วันล่าสุด แล้วใช้กับทุกแถวไม่ว่า
// แถวนั้นบันทึกวันไหน · กล้องภูเก็ตเปลี่ยนสเกลเอง 15 ก.ย. เพดานเด้ง ข้อมูลเก่าตก
// เกณฑ์ทั้งหมด แล้ว reconcile รายคืนเขียนทับตารางสรุปจนเหลือศูนย์ 5 วัน
//
// เทสต์นี้กันสองอย่าง:
//   1. กลับไปคำนวณเกณฑ์ตอน query อีก (ต้นเหตุเดิม)
//   2. ต่อสาย stamp ไม่ครบทุกจุดที่ INSERT — พลาดแบบนี้เคยเกิดจริงมาแล้วตอน
//      ต่อสาย touchCamera ซึ่งต่อแค่ 2 จาก 5 ไฟล์
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const INSERT_FILES = [
  'src/lpr-core.js',
  'src/mqtt-subscriber.js',
  'src/ingesters/dahua-cgi.js',
];

describe('ตรึงผลตอน INSERT ครบทุกจุด', () => {
  it('ทุกไฟล์ที่ INSERT INTO license_plates ต้องเรียก stampSql ให้ครบจำนวนจุด', () => {
    for (const f of INSERT_FILES) {
      const src = read(f);
      const inserts = (src.match(/INSERT INTO license_plates/g) || []).length;
      const stamps  = (src.match(/helmet\.stampSql\(/g) || []).length;
      assert.ok(inserts > 0, `${f}: ไม่พบ INSERT INTO license_plates แล้ว — ทบทวน test นี้`);
      assert.equal(stamps, inserts,
        `${f}: INSERT ${inserts} จุด แต่ stamp ${stamps} จุด — ต่อสายไม่ครบ`);
      assert.match(src, /plate_identified/, `${f}: ต้องมีคอลัมน์ plate_identified ในคำสั่ง INSERT`);
    }
  });

  it('ไม่มีไฟล์อื่นนอกรายการที่ INSERT ลง license_plates', () => {
    // ถ้ามีเส้นทางใหม่เพิ่มเข้ามา ต้องมาเพิ่มใน INSERT_FILES แล้วต่อ stamp ให้ครบ
    const roots = ['src', 'src/routes', 'src/ingesters', 'src/jobs', 'src/helpers'];
    const found = [];
    for (const dir of roots) {
      const full = path.join(__dirname, '..', dir);
      for (const name of fs.readdirSync(full)) {
        if (!name.endsWith('.js')) continue;
        const rel = `${dir}/${name}`;
        if (!fs.statSync(path.join(full, name)).isFile()) continue;
        if (read(rel).includes('INSERT INTO license_plates')) found.push(rel);
      }
    }
    assert.deepEqual(found.sort(), [...INSERT_FILES].sort(),
      'มีไฟล์ที่ INSERT ลง license_plates นอกรายการที่ต่อ stamp ไว้');
  });
});

describe('เกณฑ์กลางต้องอ่านผลที่ตรึงไว้ ไม่คำนวณใหม่', () => {
  const crit = read('src/helpers/helmetCriteria.js');

  it('evidenceSql คืนเงื่อนไข boolean ไม่มีการคิด confidence', () => {
    const helmet = require('../src/helpers/helmetCriteria');
    assert.equal(helmet.evidenceSql('lp'), ' AND lp.plate_identified');
    assert.equal(helmet.evidenceSql(''), ' AND plate_identified');
  });

  it('ถอดกลไกเพดานที่ขยับได้ออกหมดแล้ว', () => {
    for (const gone of ['refreshCeilings', 'ceilingSql', 'REFRESH_MS', '_cache']) {
      assert.ok(!crit.includes(`function ${gone}`) && !crit.includes(`${gone} =`),
        `helmetCriteria ยังมี ${gone} หลงเหลือ — เพดานที่ขยับได้คือต้นเหตุเดิม`);
    }
  });

  it('ไม่มีใครในระบบเรียกกลไกเพดานเดิมอีก', () => {
    // ต้องครอบ scripts/ ด้วย — รอบแรกที่แก้ลืมไป แล้วสคริปต์ backfill สามตัว
    // ล้มตอนรันจริงเพราะยังเรียก helmet.ensure() ที่ถูกถอดไปแล้ว
    const dirs = ['src', 'src/routes', 'src/jobs', 'src/ingesters', 'src/helpers', 'scripts'];
    for (const dir of dirs) {
      const full = path.join(__dirname, '..', dir);
      for (const name of fs.readdirSync(full)) {
        if (!name.endsWith('.js') || name === 'helmetCriteria.js') continue;
        if (!fs.statSync(path.join(full, name)).isFile()) continue;
        const src = read(`${dir}/${name}`);
        for (const gone of ['helmet.ensure(', 'helmet.ceilingSql(', 'helmet.refreshCeilings(']) {
          assert.ok(!src.includes(gone), `${dir}/${name}: ยังเรียก ${gone}`);
        }
      }
    }
  });

  it('หน้าอันดับต้องไม่คิดเพดานเองด้วย CTE อีก (เคยทำแล้วให้เลขไม่ตรงกับหน้าอื่น)', () => {
    const t = read('src/routes/traffic.js');
    assert.ok(!/WITH scale AS MATERIALIZED/.test(t), 'CTE scale กลับมาแล้ว');
    assert.ok(!/max\(confidence\)/.test(t), 'traffic.js กลับไปคิดเพดานเอง');
  });
});
