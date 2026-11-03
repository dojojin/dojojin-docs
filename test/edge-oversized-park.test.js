// ============================================================
// Vigil Platform — ข้อความที่ถูกกันไว้ ต้องเก็บไว้และนับได้
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ด่านขนาดใน publisher.js กันข้อความที่ใหญ่เกินเพดาน broker ไว้ได้แล้ว แต่ถ้ามันแค่
// เขียน console.error ทิ้งไว้ในล็อกของ edge ก็ **เงียบแบบเดียวกับปัญหาที่มันแก้** —
// ไม่มีใครเปิดล็อกของ edge อ่าน (คิวของ vss ตายเงียบ 2 สัปดาห์ด้วยเหตุผลนี้เป๊ะ)
//
// จึงต้องได้สองอย่าง: (1) ตัวข้อความถูกเก็บไว้บนดิสก์ให้เปิดดูได้ว่าบั๊กมาจากไหน
// (2) จำนวนต้องนับได้จาก process อื่น — bridge อยู่คนละ process กับ ingester
// จึงแชร์ตัวแปรกันไม่ได้ ต้องนับจากไฟล์ · แล้วส่งขึ้น edge_status.bridge_dropped
//
// และต้องมีเพดาน ไม่งั้นบั๊กที่ยิงรัวจะกินดิสก์ของ edge จนเต็ม ซึ่งหนักกว่าเดิม
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

process.env.EDGE_MODE = '1';
process.env.EDGE_SITE_ID = 'testsite';
process.env.EDGE_OVERSIZED_KEEP = '3';        // เพดานต่ำ ๆ เพื่อทดสอบการหมุนไฟล์
// โฟลเดอร์ของตัวเอง — node --test รันไฟล์เทสต์ **ขนานกัน** ถ้าใช้โฟลเดอร์จริงร่วมกับ
// edge-payload-size.test.js ทั้งสองจะเขียนทับกันแล้วผลนับเพี้ยน (เจอจริงตอนเขียน)
process.env.EDGE_OVERSIZED_DIR = require('path').join(
  require('os').tmpdir(), `vigil-oversized-test-${process.pid}`);

const PUB = path.join(__dirname, '..', 'src', 'edge', 'publisher.js');
const DIR = process.env.EDGE_OVERSIZED_DIR;

function loadPublisher() {
  delete require.cache[require.resolve(PUB)];
  const mqttPath = require.resolve('mqtt', { paths: [path.join(__dirname, '..', 'src')] });
  const real = require.cache[mqttPath];
  const published = [];
  require.cache[mqttPath] = {
    id: mqttPath, filename: mqttPath, loaded: true, exports: {
      connect: () => ({ on: () => {},
        publish: (t, b, o, cb) => { published.push(t); cb?.(null); },
        end: (_f, cb) => cb?.() }),
    },
  };
  return { mod: require(PUB), published, restore: () => { if (real) require.cache[mqttPath] = real; } };
}

const evt = (previewRef) => ({
  vendor: 'hikvision', previewRef,
  event: { camera_id: 'TESTCAM', event_category: 'RuleEngine',
           event_type: 'TamperDetection', event_time: new Date().toISOString() },
});

describe('publisher — เก็บข้อความที่ใหญ่เกินไว้บนดิสก์', () => {
  let h;
  const realErr = console.error;
  const before0 = () => { try { return fs.readdirSync(DIR); } catch { return []; } };
  let preexisting = [];

  before(() => {
    preexisting = before0();                 // ของเดิมที่อาจมีอยู่ ห้ามนับรวม ห้ามลบ
    h = loadPublisher();
    console.error = () => {};
  });
  after(() => {
    console.error = realErr;
    h.restore();
    // ลบเฉพาะไฟล์ที่เทสต์นี้สร้างเอง
    for (const f of before0()) {
      if (!preexisting.includes(f) && /TESTCAM|testsite/.test(f)) {
        try { fs.unlinkSync(path.join(DIR, f)); } catch {}
      }
    }
  });

  const mine = () => before0().filter((f) => !preexisting.includes(f));

  it('ข้อความใหญ่ถูกกันไว้ และตัวไฟล์ถูกเก็บลง data/oversized/', () => {
    h.mod.publishEdgeEvent(evt(Buffer.alloc(500 * 1024, 0x41)));
    assert.strictEqual(h.published.length, 0, 'ต้องไม่ถูกส่งขึ้น broker');
    assert.strictEqual(mine().length, 1, 'ต้องมีไฟล์ถูกเก็บไว้ 1 ใบ');
  });

  it('ไฟล์ที่เก็บไว้ต้องอ่านกลับเป็น JSON ได้ และมี topic ให้ตามรอย', () => {
    const f = mine()[0];
    const o = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.ok(o._preview_ref, 'ต้องเก็บเนื้อข้อความจริงไว้ ไม่ใช่แค่ metadata');
    assert.match(f, /TamperDetection/, 'ชื่อไฟล์ต้องบอก topic ให้ตามรอยได้');
  });

  it('เกินเพดานแล้วต้องหมุนไฟล์ทิ้ง ไม่กินดิสก์ไม่จำกัด', () => {
    for (let i = 0; i < 5; i++) h.mod.publishEdgeEvent(evt(Buffer.alloc(500 * 1024, 0x42)));
    assert.ok(before0().length <= 3, `ต้องเหลือไม่เกินเพดาน 3 ใบ แต่ได้ ${before0().length}`);
  });

  it('ข้อความปกติต้องไม่ถูกเก็บลงโฟลเดอร์นี้', () => {
    const n = before0().length;
    h.mod.publishEdgeEvent(evt('events/2026-08-14/TESTCAM/2200/abc.jpg'));
    assert.strictEqual(h.published.length, 1, 'ต้องถูกส่งตามปกติ');
    assert.strictEqual(before0().length, n, 'จำนวนไฟล์ต้องไม่เปลี่ยน');
  });
});
