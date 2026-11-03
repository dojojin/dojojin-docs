// ============================================================
// Vigil Platform — test: fallback ของ /api/snapshot/live ต้องเอาภาพ full scene
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของถาม 2026-09-15 หลังเห็นภาพ preview ของกล้องใบหน้าใน modal รายละเอียด
// กล้องเป็นภาพครอปหน้าคน (มีแถบดำซ้าย-ขวา) แทนที่จะเป็นภาพเต็มฉาก — ตรวจแล้วพบ
// สาเหตุจริง: ตอนนั้น cameras.tile_snap_file ยังว่างอยู่ (periodic job ยังไม่รัน
// รอบแรกให้กล้องนั้น) จึงตกไปที่ fallback สุดท้าย (events.snapshot_filename)
// ซึ่งของกล้องใบหน้าเป็นภาพครอปเสมอ ไม่ใช่ full scene — เคสเดียวกับที่แก้ไปแล้ว
// ใน src/api-server.js _lastCameraEventSnapshot() (การ์ดแจ้งเตือนกล้องดับ)
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'cameras-status.js'), 'utf8');

describe('/api/snapshot/live fallback ต้องเอา _snapshot_full ก่อน ไม่ใช่ครอปหน้าคน', () => {
  it('query สุดท้าย (เมื่อไม่มี tile_snap_file) ต้อง COALESCE เอา _snapshot_full ก่อน', () => {
    const i = src.indexOf("app.get('/api/snapshot/live/:cameraId'");
    assert.ok(i > 0, 'ไม่พบ route /api/snapshot/live');
    const body = src.slice(i, i + 6000);
    assert.match(body, /COALESCE\(raw_json->>'_snapshot_full', snapshot_filename\)/,
      'ต้องเอา _snapshot_full (scene เต็ม) ก่อนเสมอ ไม่งั้นกล้องใบหน้าจะโชว์ภาพครอปหน้าคนตอน tile ยังไม่มี');
  });

  it('ยังต้องเช็ค tile_snap_file ก่อนเป็นลำดับแรก ไม่ใช่แทนที่กัน', () => {
    const i = src.indexOf("app.get('/api/snapshot/live/:cameraId'");
    const body = src.slice(i, i + 6000);
    assert.match(body, /tile_snap_file IS NOT NULL/,
      'tile_snap_file ยังต้องเป็นตัวเลือกแรก (ภาพเต็มฉากที่แน่นอนกว่า) — แค่เพิ่ม fallback ให้ดีขึ้น ไม่ใช่รื้อของเดิม');
  });
});
