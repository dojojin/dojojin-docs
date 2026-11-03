// ============================================================
// Vigil Platform — สถานะสายกล้องที่ edge รายงานขึ้นมาเอง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// `ingester_camera_status` เคยมีผู้เขียนคนเดียวคือ central และ central เขียนได้แค่
// "ตัวเองต่อกล้องได้ไหม" ซึ่งไร้ความหมายกับกล้องที่อยู่หลัง edge ต่างจังหวัด
// (วัดจริง 2026-08-14: 48 แถวบอก reconnecting ทั้งที่กล้องส่ง event 155 ใบใน 10 นาที)
//
// migration 155 เพิ่ม `reported_by` ⇒ หน้าจอแยกได้ว่าใครพูด · ไฟล์นี้ตรึง 2 อย่าง:
//   1. ตรรกะเลือกแถวใน routes/devices.js — ของ edge ต้องแสดง ของ central ต้องทิ้ง
//   2. allow-list ของคอลัมน์ที่ยอมให้ edge อัปเดต — payload มาจากนอกเครื่อง
//      ห้ามเอา key ไปต่อ SQL ตรง ๆ และห้ามให้แก้ camera_id/reported_by
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

// ตรรกะเดียวกับ routes/devices.js — คัดมาเป็นฟังก์ชันเพื่อตรึงพฤติกรรม
// (route ตัวจริงต้องมี pool + auth จึงเรียกตรงในเทสต์ไม่ได้)
function pickIngester(row, camSiteId, edgeSites) {
  const ing = row || null;
  return (ing && ing.reported_by === 'edge') ? ing
       : (edgeSites.has(camSiteId) ? null : ing);
}

const EDGE_SITES = new Set([2, 3]);   // 2,3 = ไซต์ที่มี edge · 1 = main

describe('เลือกสถานะกล้อง — ใครพูดสำคัญกว่าพูดว่าอะไร', () => {
  it('กล้อง edge + แถวมาจาก edge → ต้องแสดง', () => {
    const r = pickIngester({ reported_by: 'edge', event_stream: 'connected' }, 2, EDGE_SITES);
    assert.ok(r, 'edge รายงานเองคือความจริงเรื่องกล้อง ต้องไม่ถูกทิ้ง');
    assert.strictEqual(r.event_stream, 'connected');
  });

  it('🔴 กล้อง edge + แถวมาจาก central → ต้องทิ้ง (นี่คือบั๊กเดิม)', () => {
    const r = pickIngester({ reported_by: 'central', event_stream: 'reconnecting',
                             last_error_code: 'EHOSTUNREACH' }, 2, EDGE_SITES);
    assert.strictEqual(r, null, 'central ต่อกล้องหลัง edge ไม่ถึงอยู่แล้ว ความเห็นไม่ใช่หลักฐาน');
  });

  it('กล้องของ main + แถวมาจาก central → ต้องแสดง (central poll เองจริง)', () => {
    const r = pickIngester({ reported_by: 'central', event_stream: 'connected' }, 1, EDGE_SITES);
    assert.ok(r);
  });

  it('ไม่มีแถวเลย → null ไม่ใช่ error', () => {
    assert.strictEqual(pickIngester(null, 2, EDGE_SITES), null);
    assert.strictEqual(pickIngester(null, 1, EDGE_SITES), null);
  });

  it('แถวเก่าที่ไม่มี reported_by (ก่อน migration) ต้องถูกปฏิบัติเหมือน central', () => {
    // DEFAULT 'central' ครอบแถวเดิมอยู่แล้ว แต่ถ้าหลุดมาเป็น undefined ก็ต้องไม่แสดง
    assert.strictEqual(pickIngester({ event_stream: 'reconnecting' }, 2, EDGE_SITES), null);
  });
});

// allow-list เดียวกับ mqtt-subscriber.recordEdgeCameraStatus
const EDGE_STATUS_COLS = new Set([
  'event_stream', 'snap_stream', 'retry_count',
  'last_event_http_status', 'last_snap_http_status', 'last_error_code',
]);
const allowed = (patch) => Object.keys(patch).filter(k => EDGE_STATUS_COLS.has(k));

describe('คอลัมน์ที่ยอมให้ edge อัปเดต — allow-list', () => {
  it('คอลัมน์ปกติผ่านครบ', () => {
    assert.deepEqual(allowed({ event_stream: 'connected', retry_count: 0 }),
      ['event_stream', 'retry_count']);
  });

  it('🔴 ห้ามให้ edge แก้ camera_id หรือ reported_by ได้', () => {
    assert.deepEqual(allowed({ camera_id: 'CAM-อื่น', reported_by: 'central' }), [],
      'สองตัวนี้เป็นตัวระบุตัวตนของแถว ปล่อยให้แก้ = ปลอมเป็นกล้องอื่นหรือปลอมเป็น central ได้');
  });

  it('🔴 key แปลกปลอมต้องไม่หลุดไปต่อ SQL', () => {
    assert.deepEqual(allowed({ 'x = 1; DROP TABLE cameras; --': 1, updated_at: 'x' }), []);
  });

  it('patch ที่เหลือศูนย์คอลัมน์ → ต้องไม่เขียนอะไรเลย', () => {
    assert.strictEqual(allowed({ ของแปลก: 1 }).length, 0);
  });
});
