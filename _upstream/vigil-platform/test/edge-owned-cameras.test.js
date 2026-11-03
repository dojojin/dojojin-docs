// ============================================================
// Vigil Platform — central ต้องไม่ไล่ poll กล้องที่ edge ดูแลอยู่แล้ว
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// central ถือ `cameras-config.json` ของทุกไซต์ (ถูกต้อง เพราะเป็นต้นทางที่ push
// ลงไปให้ edge) แต่ ingester บน central ก็อ่านไฟล์เดียวกันไปไล่ poll ด้วย ⇒ ยิง
// `EHOSTUNREACH` ใส่วง LAN ของกล้องต่างจังหวัดทุก 2-3 วินาที · retry_count 3,506
// · และเพราะมีแต่ central ที่เขียน `ingester_camera_status` ⇒ ความเห็นของ central
// กลายเป็นสถานะที่หน้า Health แสดง ⇒ กล้องที่ทำงานอยู่ถูกป้ายว่า `reconnecting`
//
// 🔴 กับดักที่ต้องมีเทสต์คุม: fail-open ต้องไม่กลายเป็น fail-silent
// คีย์ของตาราง `cameras` คือ **`id`** ไม่ใช่ `camera_id` — ถ้าเขียน SQL ผิดคอลัมน์
// query จะ throw แล้ว fail-open จะกลืน error นั้นเป็น "ไม่กรองอะไรเลย" อย่างเงียบ ๆ
// ซึ่งดูเหมือนทำงานปกติทุกประการ · เทสต์นี้จึงตรึงทั้งเส้นทางปกติและเส้นทางพัง
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const m = require('../src/helpers/edgeOwnedCameras');

const fakePool = (rows) => ({ query: async () => ({ rows }) });
const deadPool = (msg) => ({ query: async () => { throw new Error(msg); } });

describe('edgeOwnedCameras', () => {
  beforeEach(() => m._reset());

  it('คืนรายชื่อกล้องของไซต์ที่มี edge', async () => {
    const s = await m.refreshEdgeOwned(fakePool([
      { camera_id: 'hdy-motor-1082', site: 'hdy' },
      { camera_id: 'HIKVISION_CAM01', site: 'vss' },
    ]));
    assert.strictEqual(s.size, 2);
    assert.ok(s.has('hdy-motor-1082'));
    assert.strictEqual(m.edgeOwnedCameras().size, 2, 'ตัวอ่าน sync ต้องเห็นค่าเดียวกัน');
  });

  it('🔴 query พัง → ต้องไม่ throw และต้องคืนชุดเดิม (fail-open)', async () => {
    await m.refreshEdgeOwned(fakePool([{ camera_id: 'A', site: 'hdy' }]));
    const s = await m.refreshEdgeOwned(deadPool('column c.camera_id does not exist'));
    assert.strictEqual(s.size, 1, 'ต้องคงค่าเดิม ไม่ล้างทิ้ง');
    assert.ok(s.has('A'), 'DB สะดุดชั่วคราวต้องไม่ทำให้ central กลับไป poll ทุกกล้องพร้อมกัน');
  });

  it('พังตั้งแต่ครั้งแรก → ชุดว่าง = ไม่กรองอะไรเลย = พฤติกรรมเดิม', async () => {
    const s = await m.refreshEdgeOwned(deadPool('connection refused'));
    assert.strictEqual(s.size, 0);
  });

  it('ผลลัพธ์ว่าง (ยังไม่มี edge สักไซต์) → ชุดว่าง ไม่พัง', async () => {
    const s = await m.refreshEdgeOwned(fakePool([]));
    assert.strictEqual(s.size, 0);
  });

  it('รีเฟรชแล้วกล้องหายจากไซต์ → ชุดต้องหดตาม ไม่ค้างของเก่า', async () => {
    await m.refreshEdgeOwned(fakePool([
      { camera_id: 'A', site: 'hdy' }, { camera_id: 'B', site: 'hdy' },
    ]));
    const s = await m.refreshEdgeOwned(fakePool([{ camera_id: 'A', site: 'hdy' }]));
    assert.strictEqual(s.size, 1);
    assert.ok(!s.has('B'), 'กล้องที่ถูกถอด edge ออกแล้ว central ต้องกลับมา poll ได้');
  });

  it('SQL ต้องอ้างคอลัมน์ `c.id` ไม่ใช่ `c.camera_id` — ตารางนี้ไม่มีคอลัมน์นั้น', async () => {
    let sql = '';
    await m.refreshEdgeOwned({ query: async (q) => { sql = q; return { rows: [] }; } });
    assert.match(sql, /c\.id\s+AS\s+camera_id/i);
    assert.ok(!/c\.camera_id/.test(sql), 'cameras ไม่มีคอลัมน์ camera_id — เขียนแบบนั้นจะ throw แล้วเงียบ');
    assert.match(sql, /edge_status/, 'ต้องดูจากไซต์ที่มี edge ส่ง heartbeat จริง');
  });
});
