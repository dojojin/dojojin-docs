// ============================================================
// Vigil Platform — Tests: helpers/edgeProxyBaseUrl
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { edgeProxyBaseUrl } = require('../src/helpers/edgeProxyBaseUrl');

describe('edgeProxyBaseUrl', () => {
  it('builds the per-site tunnel URL from site code + domain', () => {
    assert.equal(edgeProxyBaseUrl('hdy', 'dojojin.tech'), 'https://hdy.dojojin.tech');
  });

  it('produces a different URL for a different site code (no cross-site leakage)', () => {
    const vss = edgeProxyBaseUrl('vss', 'dojojin.tech');
    const hdy = edgeProxyBaseUrl('hdy', 'dojojin.tech');
    assert.notEqual(vss, hdy);
    assert.equal(vss, 'https://vss.dojojin.tech');
  });

  it('respects a custom base domain (white-label)', () => {
    assert.equal(edgeProxyBaseUrl('hdy', 'example.com'), 'https://hdy.example.com');
  });
});

// 2026-09-08: ภาพ event ของ vss ใบละ ~703 KB · หน้า Events ขอ 20 ใบพร้อมกัน
// = 14 MB ต่อการเปิดหนึ่งครั้ง จน central timeout 8 วิ แล้วขึ้นการ์ด "Edge offline"
// ทั้งที่ไฟล์อยู่ครบ ⇒ ให้ edge ย่อก่อนส่ง
describe('edgeSnapshotUrl', () => {
  const { edgeSnapshotUrl } = require('../src/helpers/edgeProxyBaseUrl');
  const F = 'events/2026-09-08/BOSCH_3100i_02/0800/event_edge_1788859034096.jpg';

  it('ส่ง ?w= ไปให้ edge ย่อเมื่อขอภาพย่อ', () => {
    assert.equal(edgeSnapshotUrl('https://vss.dojojin.tech', F, 400),
      `https://vss.dojojin.tech/snapshots/${F}?w=400`);
  });

  it('ไม่ใส่ ?w= เมื่อไม่ได้ขอภาพย่อ (เช่นตอนต้องเผากรอบลงภาพเต็ม)', () => {
    for (const w of [null, undefined, 0]) {
      assert.equal(edgeSnapshotUrl('https://vss.dojojin.tech', F, w),
        `https://vss.dojojin.tech/snapshots/${F}`);
    }
  });

  it('เว้น "/" ของ path ไว้ แต่ encode อักขระอื่น', () => {
    const u = edgeSnapshotUrl('https://vss.dojojin.tech', 'lpr/2026-06-18/a b.jpg', 160);
    assert.ok(u.includes('/snapshots/lpr/2026-06-18/'), 'path segment ต้องไม่ถูกยุบเป็น %2F');
    assert.ok(u.includes('a%20b.jpg'));
  });
});

describe('รายการความกว้างของภาพย่อ ต้องเป็นชุดเดียวกันทั้ง central และ edge', () => {
  const { thumbWidth, THUMB_WIDTHS } = require('../src/helpers/thumbWidths');
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('ค่าที่ไม่อยู่ในรายการคืน null — ห้ามปัดเป็นค่าใกล้เคียง', () => {
    assert.equal(thumbWidth('80'), null, 'เคสจริงของหมุดแผนที่: 80 ไม่อยู่ในรายการ');
    assert.equal(thumbWidth('abc'), null);
    assert.equal(thumbWidth(400), 400);
  });

  it('ทุกค่าใน SNAP_W ของหน้าเว็บอยู่ในรายการนี้', () => {
    const src = read('dashboard/snapshot-sizes.js');
    for (const m of src.matchAll(/:\s*(\d{2,4})\b/g)) {
      assert.ok(THUMB_WIDTHS.has(Number(m[1])), `SNAP_W มี ${m[1]} ที่เซิร์ฟเวอร์ไม่รับ`);
    }
  });

  it('ทั้งสองฝั่งเรียกจาก helper ตัวเดียว ไม่ประกาศรายการของตัวเอง', () => {
    for (const p of ['src/routes/media-files.js', 'src/lpr-receiver.js']) {
      assert.ok(read(p).includes("helpers/thumbWidths"), `${p} ต้อง require helper กลาง`);
      assert.ok(!/new Set\(\[160, 240/.test(read(p)), `${p} ยังประกาศรายการเองอยู่`);
    }
  });
});
