// ============================================================
// Vigil Platform — รอบที่ไม่ได้ถามคำอธิบาย ต้องไม่ลบของเดิมทิ้ง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เหตุจริง 2026-09-08 06:24 UTC (auto-pull รอบ 30 นาที): คำอธิบาย 364 ระเบียน
// และเลขบัตร 364 ใบ กลายเป็น 0 ทั้งหมดภายในรอบเดียว
// ต้นเหตุ: edge ตั้ง `remark: null` ให้ทุกแถวตั้งแต่ต้น แถวที่ central สั่งข้าม
// (haveRemarks) จึงกลับมาหน้าตาเหมือน "ต้นทางไม่ได้กรอก" แล้ว upsert เขียน
// raw_json ทั้งก้อนทับ ⇒ ทั้งข้อความและเลขบัตรที่ derive จากมันหายพร้อมกัน
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHcpFace } = require('../src/helpers/blacklistImport');

const base = { external_id: '1474', group_index: '7', group_name: 'TCC',
  given_name: 'สมชาย', family_name: 'ใจดี', sex: 1 };

test('แถวที่ถูกข้าม + ยกของเดิมมา = คำอธิบายและเลขบัตรอยู่ครบ', () => {
  const n = normalizeHcpFace({ ...base,
    remark: 'มีหมายจับ\nคดีทดสอบ\nเลขบัตรประชาชน 5-XXXX-XXXXX-XX-1\n0919409400',
    id_hash_pre: 'HASHเดิม', id_enc_pre: 'enc:v1:ของเดิม' });
  assert.equal(n.raw_json.hcp_remark_parsed.watch_level, 'warrant');
  assert.equal(n.raw_json.hcp_remark_parsed.case_title, 'คดีทดสอบ');
  assert.equal(n.id_type, 'national_id', 'ต้องไม่ถูกล้างเป็น null');
  assert.equal(n.id_hash_pre, 'HASHเดิม');
  assert.equal(n.id_enc_pre, 'enc:v1:ของเดิม');
  assert.equal(n.id_number, null, 'ข้อความที่ mask แล้วให้เลขจริงกลับมาไม่ได้ ห้ามเดา');
});

test('แถวที่ต้นทางไม่ได้กรอกจริง ๆ ยังได้ค่าว่างตามเดิม', () => {
  const n = normalizeHcpFace({ ...base, remark: null });
  assert.equal(n.id_type, null);
  assert.equal(n.raw_json.hcp_remark, null);
  assert.ok('hcp_remark' in n.raw_json, 'ต้องเขียนคีย์ไว้ ไม่งั้นจะโดนถามซ้ำทุกรอบ');
});

test('เลขบัตรที่อ่านได้จริงยังชนะค่าที่ยกมา', () => {
  const n = normalizeHcpFace({ ...base, remark: 'เลขบัตรประชาชน 5838682146901',
    id_hash_pre: 'HASHเดิม', id_enc_pre: 'enc:v1:ของเดิม' });
  assert.equal(n.id_number, '5838682146901');
});
