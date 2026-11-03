// ============================================================
// Vigil Platform — Helper: retain gate (stale replay vs live retained event)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ปัญหา (GOTCHAS #103): Bosch publish detector ที่เป็น "สถานะ"
// (`FieldDetector/ObjectsInside`) เป็น MQTT retained message และ NanoMQ ส่งต่อ
// โดยคง `retain=1` ไว้แม้เป็นการ publish สด — `edge-config-agent` จึง `return`
// ทิ้งทั้งหมด ทำให้ zone-occupancy rule ไม่เคยได้ snapshot เลย ส่วน
// LineDetector/Crossed (momentary) ได้ครบ
//
// ที่เคยลองแล้วไม่เวิร์ก: เทียบ `UtcTime` ของกล้องกับ `Date.now()` ของ edge เพื่อดู
// ว่าสด — พังเพราะนาฬิกากล้อง 3100i เดินช้ากว่าจริง ~3.5 ชม. (commit 49f0464 →
// revert dbfb008)
//
// วิธีนี้ไม่แตะนาฬิกาของกล้องเลย ใช้สองด่านที่เป็นเวลาของ edge ล้วน:
//   1) หน้าต่างหลัง (re)connect — retained ที่ broker ยิงมาเพราะเรา "เพิ่ง subscribe"
//      มาเป็นชุดในไม่กี่ร้อย ms แรก ช่วงนี้ทิ้งทั้งหมด (คือ stale replay ของจริง)
//   2) หลังจากนั้น เทียบ payload กับข้อความล่าสุดของ topic เดียวกัน — ซ้ำไบต์ต่อไบต์
//      = ข้อความเดิมที่ถูกส่งซ้ำ (replay) ทิ้ง · ต่างออกไป = เหตุการณ์ใหม่จริง ปล่อยผ่าน
//      (payload ของ Bosch มี `UtcTime` อยู่ในตัว ทุกเหตุการณ์จึงต่างกันเสมอ)
'use strict';

const crypto = require('crypto');

/**
 * @param {object} [opts]
 * @param {number} [opts.graceMs] ทิ้ง retained ทุกตัวในช่วงนี้หลัง connect (ms)
 * @param {number} [opts.max]     จำนวน topic ที่จำ signature ไว้
 * @param {() => number} [opts.now] นาฬิกา (ฉีดได้ตอนเทสต์)
 */
function createRetainGate({ graceMs = 5000, max = 500, now = Date.now } = {}) {
  const seen = new Map();          // topic -> signature ของ payload ล่าสุดที่ปล่อยผ่าน
  let readyAt = 0;                 // 0 = ยังไม่เคย connect → ทิ้ง retained ไว้ก่อน
  const s = { passed: 0, skippedGrace: 0, skippedDuplicate: 0 };

  /** เรียกทุกครั้งที่ MQTT connect (รวม reconnect) — เริ่มนับหน้าต่าง replay ใหม่ */
  const ready = () => { readyAt = now(); seen.clear(); };

  /** true = ให้ทิ้งข้อความนี้ (เป็น replay) · เรียกเฉพาะเมื่อ packet.retain เป็นจริง */
  function skip(topic, buf) {
    if (!readyAt || now() - readyAt < graceMs) { s.skippedGrace++; return true; }
    const sig = crypto.createHash('sha1').update(buf).digest('base64');
    if (seen.get(topic) === sig) { s.skippedDuplicate++; return true; }
    seen.delete(topic); seen.set(topic, sig);         // re-insert = LRU
    while (seen.size > max) seen.delete(seen.keys().next().value);
    s.passed++;
    return false;
  }

  return { ready, skip, stats: () => ({ ...s, topics: seen.size }) };
}

module.exports = { createRetainGate };
