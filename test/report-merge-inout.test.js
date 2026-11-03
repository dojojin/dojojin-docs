// ============================================================
// Vigil Platform — Tests: ยุบหมวด IN/OUT ในโดนัท "สัดส่วนประเภทเหตุการณ์"
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// รถคันเดียวข้ามเส้นขาเข้าหนึ่งครั้ง ขาออกอีกหนึ่งครั้ง ⇒ IN+OUT คือ "จำนวนครั้งที่
// ผ่านเส้น" ไม่ใช่ "จำนวนรถ" · ชิ้นในโดนัทเขียนว่า "รถยนต์" คนอ่านจึงอ่านเป็นจำนวนรถ
// เจ้าของสั่งให้หารสอง 2026-09-10 หลังเห็นเลข 3,403 ในรายงานของ RMUTR-V
//
// เลขในเทสต์ชุดแรกเป็นของจริงจาก /api/stats/categories (site 20, 8–9 ก.ย. 2569)

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.I18N = { getLang: () => 'th', t: (k, fb) => fb || k };
const RT = require('../dashboard/report-template.js');

const cat = (name, count, extra) => Object.assign({ name, count, prev_count: 0 }, extra || {});
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r.count]));

describe('mergeInOut — ยุบ IN/OUT แล้วหารด้วยจำนวนสมาชิก', () => {
  it('ข้อมูลจริงของ RMUTR-V: IN+OUT ถูกยุบเป็นชิ้นเดียวและหารสอง', () => {
    const out = RT.mergeInOut([
      cat('รถยนต์ (IN)', 3536), cat('รถยนต์ (OUT)', 3479),
      cat('รถจักรยานยนต์ (IN)', 7953), cat('รถจักรยานยนต์ (OUT)', 8120),
      cat('รถบรรทุก (IN)', 21), cat('รถบรรทุก (OUT)', 17),
      cat('รถบัส (IN)', 2), cat('รถบัส (OUT)', 4),
    ]);
    assert.equal(out.length, 4, 'ต้องเหลือ 4 ชิ้น');
    assert.deepEqual(byName(out), {
      'รถยนต์': 3508,          // (3536+3479)/2 = 3507.5 → 3508
      'รถจักรยานยนต์': 8037,   // (7953+8120)/2 = 8036.5 → 8037
      'รถบรรทุก': 19,
      'รถบัส': 3,
    });
  });

  // เส้นแบ่งของทั้งฟีเจอร์: หารด้วยจำนวนหมวดที่ยุบเข้าด้วยกัน ไม่ใช่หาร 2 ตายตัว
  it('หมวดที่มีทิศเดียว (มีแต่ IN) ต้องไม่ถูกหาร', () => {
    const out = RT.mergeInOut([
      cat('รถยนต์ (IN)', 100), cat('รถยนต์ (OUT)', 98),
      cat('รถบรรทุก (IN)', 40),
    ]);
    assert.deepEqual(byName(out), { 'รถยนต์': 99, 'รถบรรทุก': 40 });
  });

  it('ไซต์ที่ไม่ได้ตั้งชื่อแบบ IN/OUT ได้ผลเท่าเดิมทุกประการ (คืน array ตัวเดิม)', () => {
    const rows = [cat('คนเข้าพื้นที่ทดสอบ', 500), cat('People Counting', 120)];
    assert.equal(RT.mergeInOut(rows), rows, 'ต้องคืน reference เดิม ไม่ใช่ก๊อปปี้ที่ถูกแก้');
  });

  it('ชื่อที่มีวงเล็บอย่างอื่นห้ามถูกยุบ — "(เลี้ยวเข้าซอย)" ไม่ใช่ทิศทาง', () => {
    const out = RT.mergeInOut([
      cat('รถยนต์ (IN)', 10), cat('รถยนต์ (OUT)', 10),
      cat('รถยนต์ (เลี้ยวเข้าซอย)', 7),
    ]);
    assert.deepEqual(byName(out), { 'รถยนต์': 10, 'รถยนต์ (เลี้ยวเข้าซอย)': 7 });
  });

  it('prev_count ถูกหารด้วยกติกาเดียวกัน จะได้เทียบกับ count ได้', () => {
    const out = RT.mergeInOut([
      cat('รถยนต์ (IN)', 100, { prev_count: 80 }),
      cat('รถยนต์ (OUT)', 100, { prev_count: 84 }),
    ]);
    assert.equal(out[0].count, 100);
    assert.equal(out[0].prev_count, 82);
  });

  it('idempotent — เรียกซ้ำแล้วไม่หารซ้ำจนเลขหด', () => {
    const once = RT.mergeInOut([cat('รถยนต์ (IN)', 3536), cat('รถยนต์ (OUT)', 3479)]);
    const twice = RT.mergeInOut(once);
    assert.deepEqual(byName(twice), byName(once));
  });

  it('สีของชิ้นที่ยุบ = สีของสมาชิกที่ยอดมากที่สุด และไม่มีฟิลด์ภายในหลุดออกไป', () => {
    const out = RT.mergeInOut([
      cat('รถยนต์ (IN)', 10, { color: '#aaa' }),
      cat('รถยนต์ (OUT)', 99, { color: '#bbb' }),
    ]);
    assert.equal(out[0].color, '#bbb');
    assert.equal('_members' in out[0], false);
    assert.equal('_topCount' in out[0], false);
  });

  it('ไม่แก้ array ที่ผู้เรียกส่งมา', () => {
    const rows = [cat('รถยนต์ (IN)', 10), cat('รถยนต์ (OUT)', 20)];
    RT.mergeInOut(rows);
    assert.deepEqual(rows.map((r) => [r.name, r.count]), [['รถยนต์ (IN)', 10], ['รถยนต์ (OUT)', 20]]);
  });
});
