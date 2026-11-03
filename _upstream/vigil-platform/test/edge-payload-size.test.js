// ============================================================
// Vigil Platform — ข้อความที่ใหญ่เกินเพดานต้องไม่ออกจาก edge
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// incident จริง 2026-08-14 — คิวของ vss ตายค้าง 2 สัปดาห์:
//
// `hikvision-isapi.js` เส้นทาง RuleEngine ใส่ **Buffer ของภาพ** ลงช่อง `previewRef`
// ซึ่งสัญญาใน publisher.js บอกว่าเป็น "filename mapping" · JSON.stringify(Buffer)
// กลายเป็น {"type":"Buffer","data":[...]} ⇒ ภาพ ~500KB พองเป็น 4.2MB ⇒ ทะลุเพดาน
// max_packet_size 1MB ของ EMQX ⇒ broker **ตัดสายทิ้ง** (ไม่ใช่แค่ปฏิเสธข้อความ)
// ⇒ ทุกครั้งที่ replay หมุนมาถึงใบนั้น ลิงก์ล้มทั้งเส้น พาข้อความดี ๆ ร่วงตาม
//
// ไฟล์นี้ตรึงสองอย่าง: (1) ด่านขนาดต้องกันไว้ได้จริง (2) ข้อความปกติต้องไม่โดนกัน
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path   = require('path');

// ต้องตั้ง EDGE_MODE ก่อน require — publisher อ่าน env ตอน module-load
process.env.EDGE_MODE = '1';
process.env.EDGE_SITE_ID = 'testsite';

const PUB = path.join(__dirname, '..', 'src', 'edge', 'publisher.js');

/** ดัก console.error + ตัด mqtt ออก เพื่อไม่ให้เทสต์ไปต่อ broker จริง */
function loadPublisher() {
  delete require.cache[require.resolve(PUB)];
  const mqttPath = require.resolve('mqtt', { paths: [path.join(__dirname, '..', 'src')] });
  const realMqtt = require.cache[mqttPath];
  const published = [];
  require.cache[mqttPath] = {
    id: mqttPath, filename: mqttPath, loaded: true, exports: {
      connect: () => ({
        on: () => {},
        publish: (topic, body, opts, cb) => { published.push({ topic, bytes: body.length }); cb?.(null); },
        end: (_f, cb) => cb?.(),
      }),
    },
  };
  const mod = require(PUB);
  return { mod, published, restore: () => { if (realMqtt) require.cache[mqttPath] = realMqtt; } };
}

const baseEvent = (extra = {}) => ({
  vendor: 'hikvision',
  event: { camera_id: 'TESTCAM', event_category: 'RuleEngine',
           event_type: 'TamperDetection', event_time: new Date().toISOString() },
  ...extra,
});

describe('edge publisher — ด่านขนาดข้อความ', () => {
  let h, errs;
  const realErr = console.error;

  before(() => { h = loadPublisher(); errs = []; console.error = (...a) => errs.push(a.join(' ')); });
  after(()  => { console.error = realErr; h.restore(); });

  it('ข้อความปกติ (ชื่อไฟล์เป็น string) ต้องถูกส่งตามปกติ', () => {
    const n = h.published.length;
    h.mod.publishEdgeEvent(baseEvent({ previewRef: 'events/2026-08-14/TESTCAM/2100/abc.jpg' }));
    assert.strictEqual(h.published.length, n + 1, 'ต้องมีการ publish เพิ่ม 1 ครั้ง');
    assert.ok(h.published.at(-1).bytes < 900_000);
  });

  it('🔴 Buffer ที่หลุดเข้ามาแทนชื่อไฟล์ ต้องถูกกันไว้ ไม่ปล่อยขึ้น broker', () => {
    const n = h.published.length;
    errs.length = 0;
    // 500KB JPEG จำลอง — พอ JSON.stringify จะพองเกิน 1MB เหมือนของจริง
    h.mod.publishEdgeEvent(baseEvent({ previewRef: Buffer.alloc(500 * 1024, 0x41) }));
    assert.strictEqual(h.published.length, n, 'ต้องไม่ publish ออกไปเลย');
    assert.ok(errs.some((e) => /ใหญ่เกินเพดาน/.test(e)), 'ต้อง log ให้เห็นว่าถูกกัน');
    assert.ok(errs.some((e) => /_preview_ref/.test(e)), 'ต้องบอกด้วยว่าฟิลด์ไหนที่ใหญ่');
    assert.ok(errs.some((e) => /TamperDetection/.test(e)), 'ต้องบอก topic ให้ตามรอยได้');
  });

  it('ข้อความที่ใหญ่เพราะสาเหตุอื่นก็ต้องถูกกันเหมือนกัน (ไม่ใช่ดักเฉพาะ Buffer)', () => {
    const n = h.published.length;
    h.mod.publishEdgeEvent(baseEvent({ appearance: { blob: 'x'.repeat(1_000_000) } }));
    assert.strictEqual(h.published.length, n);
  });

  it('ยังคืน correlation id เสมอ แม้ข้อความจะถูกกัน — ผู้เรียกไม่ควรพังตาม', () => {
    const corr = h.mod.publishEdgeEvent(baseEvent({ previewRef: Buffer.alloc(600 * 1024) }));
    assert.ok(typeof corr === 'string' && corr.length > 0);
  });
});
