// ============================================================
// Vigil Platform — การ์ดแจ้งเตือนใบหน้าใน LINE ต้องแสดงคำอธิบายจาก HCP แยกช่อง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เจ้าหน้าที่เห็นการ์ด LINE ก่อนหน้าจอเสมอ — "มีหมายจับ" แปลว่าจับได้ทันที
// ถ้าข้อมูลนั้นไม่ถึงการ์ด คนหน้างานจะไม่รู้ว่าต้องทำอะไรต่างจากเคสเฝ้าระวัง
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _faceSections } = require('../src/line-sender');

const ev = { camera_name: 'C7-TCC-SB-03', event_time: '2026-09-08T10:00:00Z' };
const rows = (info) => {
  const secs = _faceSections(ev, 'นาย พงษ์กร คนทดสอบ', 'TEST VSS', info) || [];
  const ref = secs.find((s) => /อ้างอิง/.test(s.title));
  return new Map((ref ? ref.rows : []).map((r) => [r[0], r[1]]));
};

test('หมายจับได้ธงนำหน้า และช่องอื่นแยกกันคนละแถว', () => {
  const r = rows({ hcp_parsed: {
    watch_type: 'หมายจับ', watch_level: 'warrant', case_title: 'คดีทดสอบแจ้งเตือน',
    case_no: '1-2569', contact: 'สภอ.วิชั่น พตท.วิชั่น', phone: '0919409400' } });
  assert.equal(r.get('ประเภท'), '🚨 หมายจับ');
  assert.equal(r.get('เหตุการณ์'), 'คดีทดสอบแจ้งเตือน');
  assert.equal(r.get('เลขคดี'), '1-2569');
  assert.equal(r.get('ติดต่อ'), 'สภอ.วิชั่น พตท.วิชั่น 0919409400');
});

test('เฝ้าระวังไม่ติดธง — ธงสงวนไว้ให้กรณีที่จับได้ทันทีเท่านั้น', () => {
  const r = rows({ hcp_parsed: { watch_type: 'เฝ้าระวัง', watch_level: 'watch' } });
  assert.equal(r.get('ประเภท'), 'เฝ้าระวัง');
});

test('บันทึกดิบขึ้นเฉพาะตอนไม่มีชุดที่แยกช่องแล้ว', () => {
  const withParsed = rows({ hcp_parsed: { watch_type: 'หมายจับ' }, case_note: 'ข้อความดิบ' });
  assert.equal(withParsed.get('บันทึก'), undefined, 'มีชุดแยกช่องแล้วต้องไม่ซ้ำด้วยข้อความดิบ');
  const noParsed = rows({ case_note: 'ข้อความดิบ' });
  assert.equal(noParsed.get('บันทึก'), 'ข้อความดิบ');
});

test('ไม่มีคำอธิบายเลย = ไม่มีแถวเปล่าโผล่มา', () => {
  const r = rows({});
  for (const k of ['ประเภท', 'เหตุการณ์', 'เลขคดี', 'ติดต่อ']) assert.equal(r.get(k), undefined, k);
});

test('ระเบียนเก่าที่เป็นประโยคยาว ยังได้ป้าย "มีหมายจับ" พร้อมธง', () => {
  // parser ไม่ยกประโยคยาวมาเป็น watch_type แล้ว (ป้ายจะยาวข้ามจอ) แต่ระดับยังอยู่
  // การ์ดจึงต้องเติมคำมาตรฐานเอง ไม่ใช่ปล่อยแถว "ประเภท" หายไปทั้งที่มีหมายจับ
  const r = rows({ hcp_parsed: {
    watch_type: null, watch_level: 'warrant',
    case_title: 'หมายจับศาลเยาวชน หากพบเจอ แจ้ง ร.ต.อ.สมชาย 0812345678' } });
  assert.equal(r.get('ประเภท'), '🚨 มีหมายจับ');
  assert.equal(r.get('เหตุการณ์'), 'หมายจับศาลเยาวชน หากพบเจอ แจ้ง ร.ต.อ.สมชาย 0812345678');
});

test('ระเบียนที่แยกได้แค่ "ติดต่อ" ไม่ต้องขึ้นแถวบันทึกว่า "เพศชาย"', () => {
  // 335 จาก 697 ระเบียนเป็นแบบนี้ — คำอธิบายทั้งบรรทัดขึ้นต้นด้วย "แจ้ง …"
  // parser จึงได้แค่ contact/phone แล้ว case_note ถอยไปใช้เพศตามเดิม
  const r = rows({ hcp_parsed: { contact: 'พ.ต.อ.เอกลักษณ์', phone: '0963615553' },
    case_note: 'เพศชาย' });
  assert.equal(r.get('ติดต่อ'), 'พ.ต.อ.เอกลักษณ์ 0963615553');
  assert.equal(r.get('บันทึก'), undefined);
});
