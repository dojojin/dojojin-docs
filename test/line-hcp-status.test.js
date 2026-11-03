// ============================================================
// Vigil Platform — Tests: สถานะกล้องบน HikCentral ผ่าน LINE
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// รูปร่าง payload ตัดมาจากการยิงจริง 2026-09-09 (13 ดับ จาก 758 ตัว)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SOURCES } = require('../src/line-answer-sources');

const DATA = {
  ok: true, fetched_at: '2026-09-08T19:19:00.000Z',
  summary: { cameras: { total: 758, online: 745, offline: 13, unknown: 0 } },
  cameras: [
    { index_code: '1', name: 'IP Camera1', status: 2, ours: null },
    { index_code: '2', name: 'HIKVISION', status: 2,
      ours: { camera_id: 'C6-TCC-SB-03', name: 'ด่านตรวจฉัตรไชยขาเข้า (C6)' } },
    { index_code: '3', name: 'IP Camera9', status: 1, ours: null },
    { index_code: '4', name: 'IP Camera8', status: 0, ours: null },
  ],
};

describe('สถานะกล้องบน HikCentral', () => {
  it('นับเฉพาะ status = 2 (ออฟไลน์) · 1 = ออนไลน์ · 0 = ไม่ทราบ', () => {
    const out = SOURCES.hcp_camera_status.format(DATA);
    assert.equal(out.big, '13', 'ยอดหลักมาจาก summary ของ HCP ไม่ใช่จำนวนแถวที่ส่งมา');
    assert.equal(out.rows.length, 2, 'แถวที่โชว์คือกล้องที่ดับเท่านั้น');
  });

  it('ใช้ชื่อกล้องฝั่งเราถ้าแมปไว้ · ไม่งั้นบอกว่า HCP ดูแลตัวเดียว', () => {
    const out = SOURCES.hcp_camera_status.format(DATA);
    assert.equal(out.rows[1][0], 'ด่านตรวจฉัตรไชยขาเข้า (C6)');
    assert.equal(out.rows[0][1], 'HCP ดูแลตัวเดียว');
  });

  // 🔴 คนละชุดกับ "กล้องออฟไลน์" ของเรา (นับจาก event ที่ไหลเข้าระบบ) สองเลข
  //    ไม่มีทางเท่ากันและไม่ควรเท่า ⇒ ต้องเขียนที่มาไว้บนการ์ดเสมอ
  it('การ์ดบอกที่มาของตัวเลข และอายุข้อมูล', () => {
    const out = SOURCES.hcp_camera_status.format(DATA);
    assert.match(out.note, /HikCentral มองเห็น/);
    assert.match(out.note, /ข้อมูล ณ/);
    assert.match(out.note, /ออนไลน์ 745/);
  });

  it('ไม่มีกล้องดับ ต้องบอกให้ตรง ไม่ใช่การ์ดเปล่า', () => {
    const out = SOURCES.hcp_camera_status.format(
      { summary: { cameras: { total: 758, online: 758, offline: 0 } }, cameras: [] });
    assert.equal(out.empty, true);
    assert.match(out.emptyText, /ออนไลน์ครบทุกตัว/);
  });
});
