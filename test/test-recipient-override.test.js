// ============================================================
// Vigil Platform — ผู้รับเฉพาะครั้งนี้ (ปุ่มทดสอบ / ส่งเอง)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เจ้าของขอ 2026-08-27: อยากดูหน้าตาการ์ดโดยไม่ต้องยิงหาทีมจริงทุกครั้ง
//
// 🔒 สิ่งที่ต้องกันจริง ๆ ไม่ใช่ "เลือกได้ไหม" แต่คือ **เลือกได้แค่ไหน** — ถ้า id
// ที่ส่งมาผ่านไปถึงตัวส่งโดยไม่กรอง endpoint นี้จะกลายเป็นช่องยิงข้อความหา LINE id
// ใดก็ได้ ด้วย channel access token ของลูกค้า

const test = require('node:test');
const assert = require('node:assert');
const { resolveTestRecipients } = require('../src/routes/alert-channels');

// pool ปลอมที่คืนรายชื่อผู้รับชุดเดียว — ไม่แตะฐานข้อมูลจริง
const ROSTER = [
  { id: 'U_dojo',   name: 'Dojo-mAn',      enabled: true },
  { id: 'C_vssdev', name: 'VSS Dev & Test', enabled: true },
  { id: 'U_off',    name: 'คนที่ถูกปิด',     enabled: false },
];
const pool = { query: async () => ({ rows: [{ recipients: ROSTER }] }) };

test('ไม่ระบุมา = null → ผู้เรียกใช้ผู้รับที่ตั้งไว้ตามปกติ', async () => {
  assert.equal(await resolveTestRecipients(pool, undefined), null);
  assert.equal(await resolveTestRecipients(pool, null), null);
  assert.equal(await resolveTestRecipients(pool, []), null, 'array ว่าง = ไม่ได้ระบุ');
});

test('id ที่ระบบไม่รู้จัก ต้องถูกทิ้ง ไม่ใช่ส่งไปหา', async () => {
  const out = await resolveTestRecipients(pool, ['U_dojo', 'Uxxxxxxxxxxxxxxxxx']);
  assert.deepEqual(out, ['U_dojo'], 'เหลือเฉพาะคนที่อยู่ในรายชื่อจริง');
});

test('ผู้รับที่ถูกปิดอยู่ ต้องส่งไม่ได้แม้จะติ๊กมา', async () => {
  assert.deepEqual(await resolveTestRecipients(pool, ['U_off']), []);
});

test('ระบุมาแต่ใช้ไม่ได้สักคน → [] ไม่ใช่ null', async () => {
  // ต่างกันมาก: [] แปลว่า "เลือกมาแล้วแต่ใช้ไม่ได้" ผู้เรียกต้องตอบ error
  // ส่วน null แปลว่า "ไม่ได้เลือก" ซึ่งจะตกไปใช้ผู้รับจริงทั้งกลุ่ม
  const out = await resolveTestRecipients(pool, ['ไม่มีจริง']);
  assert.deepEqual(out, []);
  assert.notEqual(out, null);
});

test('id เป็นตัวเลข/สตริงปนกัน ต้องเทียบได้ ไม่หลุดเพราะชนิดข้อมูล', async () => {
  const numPool = { query: async () => ({ rows: [{ recipients: [{ id: 12345, enabled: true }] }] }) };
  assert.deepEqual(await resolveTestRecipients(numPool, ['12345']), ['12345']);
});

test('line_config ว่าง → [] ไม่ใช่ throw', async () => {
  const empty = { query: async () => ({ rows: [] }) };
  assert.deepEqual(await resolveTestRecipients(empty, ['U_dojo']), []);
});
