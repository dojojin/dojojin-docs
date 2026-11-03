// ============================================================
// Vigil Platform — Tests: จับชื่อกล้องจากประโยค
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchCamera } = require('../src/helpers/lineCommandSites');

const CAMS = [
  { id: 'C2-TCC-SB-01', name: 'ก่อนถึงขาเข้าท่าฉัตรไชย (C2)' },
  { id: 'C6-TCC-SB-03', name: 'ด่านตรวจฉัตรไชยขาเข้า (C6)' },
  { id: 'C10-TCC-SB-04', name: 'ด่านตรวจฉัตรไชยขาออก (C10)' },
  { id: 'C20-PT-SB-10', name: 'หน้าโรงเรียนนาบอน (C20)' },
  { id: 'C44-SKU-SB-18', name: 'สนามบินภูเก็ต Inter (C44)' },
];
const SITES = ['ภูเก็ต', 'Phuket', 'hkt', 'หาดใหญ่', 'HatYai', 'hdy'];

describe('จับชื่อกล้อง', () => {
  it('ชื่อเต็มและรหัสในวงเล็บยังทำงานเหมือนเดิม', () => {
    assert.equal(matchCamera('กล้อง C20 เมื่อวาน', CAMS).exact.id, 'C20-PT-SB-10');
    assert.equal(matchCamera('ด่านตรวจฉัตรไชยขาออก (C10)', CAMS).exact.id, 'C10-TCC-SB-04');
  });

  // เจ้าของพิมพ์ "กล้องท่าฉัตรไชย" แล้วไม่ติดเลย ทั้งที่มีกล้องชื่อนั้นอยู่ (2026-09-09)
  it('ชื่อบางส่วนติด · ตรงหลายตัวคืนมาให้ถามกลับ ไม่ใช่เงียบ', () => {
    assert.equal(matchCamera('กล้องนาบอน', CAMS).exact.id, 'C20-PT-SB-10');
    const many = matchCamera('กล้อง ฉัตรไชย', CAMS).many;
    assert.equal(many.length, 3);
  });

  // 🔴 "กล้องดับกี่ตัว ภูเก็ต" เคยกลายเป็นการถามหากล้อง เพราะ "ภูเก็ต" อยู่ในชื่อกล้อง
  it('ชื่อไซต์ต้องไม่ถูกอ่านเป็นชื่อกล้อง', () => {
    assert.equal(matchCamera('ตอนนี้กล้องดับกี่ตัว ภูเก็ต', CAMS, { stop: SITES }), null);
  });

  it('ประโยคที่ไม่ได้พูดถึงกล้องเลย ต้องไม่จับอะไร', () => {
    assert.equal(matchCamera('ขอยอดอ่านป้ายทะเบียนเมื่อวาน', CAMS, { stop: SITES }), null);
  });
});

// เจ้าของพิมพ์ "กล้องท่าฉัตรไชย ทั้งหมด" — กลุ่มกล้องตามสถานที่มีจริง (ฉัตรไชย 6 ตัว)
describe('คำที่ใช้จับกล้อง', () => {
  it('คืนคำที่ทำให้จับได้ ไว้เขียนบนการ์ดว่าครอบกล้องกลุ่มไหน', () => {
    const r = matchCamera('กล้อง ฉัตรไชย ทั้งหมด', CAMS, { stop: SITES });
    assert.equal(r.word, 'ฉัตรไชย');
    assert.equal(r.many.length, 3);
  });

  it('คำว่า "ทั้งหมด" ต้องไม่ถูกเอาไปใช้เป็นชื่อกล้อง', () => {
    const r = matchCamera('กล้อง ทั้งหมด', CAMS, { stop: SITES });
    assert.equal(r, null);
  });
});
