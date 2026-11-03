// ============================================================
// Vigil Platform — test: แจ้งเตือนซ้ำต้องยึดนาฬิกากลุ่มผู้รับ ไม่ใช่ของกล้องตัวเอง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของเห็นการ์ดแจ้งเตือนซ้ำจริงกระจายกันคนละเวลา (แต่ละกล้องดับคนละเวลา ได้
// last_alert_at คนละเวลา) 2026-09-15: "ผมว่าการแจ้งเตือนซ้ำ ควรทำพร้อมกันหมด
// ทุกกล้องดีกว่า กรณีที่ยังหลับอยู่" — ย้ายนาฬิกาแจ้งซ้ำจากระดับกล้องไปเป็นระดับ
// กลุ่มผู้รับ (recipient_ids) แทน
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-server.js'), 'utf8');

describe('แจ้งเตือนซ้ำต้องยึดนาฬิกากลุ่มผู้รับ', () => {
  it('มี _groupEscalation แยกจาก last_alert_at ของกล้องตัวเอง', () => {
    assert.match(src, /const _groupEscalation = new Map\(\)/,
      'ต้องมี Map เก็บนาฬิการะดับกลุ่ม');
  });

  it('ครั้งแรกของกล้องยังเป็นอิสระ ไม่ต้องรอกลุ่ม', () => {
    const i = src.indexOf('let eligible = false;');
    assert.ok(i > 0, 'ไม่พบตรรกะตัดสินใจแจ้งเตือน');
    const body = src.slice(i, i + 500);
    assert.match(body, /if \(!lastAlertAt\) \{\s*eligible = true;/,
      'ครั้งแรกของกล้องต้องยังแจ้งได้ทันทีตาม notify_after_sec ไม่ต้องรอกลุ่ม');
  });

  it('ตั้งแต่ครั้งที่สองต้องเช็คนาฬิกากลุ่ม ไม่ใช่ sinceLastAlert ของตัวเอง', () => {
    const i = src.indexOf('let eligible = false;');
    const body = src.slice(i, i + 500);
    assert.match(body, /_groupEscalation\.get\(groupKey\)/,
      'ต้องเช็คนาฬิกากลุ่ม (recipient_ids) แทนนาฬิกาของกล้องตัวเองตั้งแต่ครั้งที่สอง');
  });

  it('escalate_once ต้องยังกันไม่ให้เข้าทางแจ้งซ้ำเหมือนเดิม', () => {
    const i = src.indexOf('let eligible = false;');
    const body = src.slice(i, i + 500);
    assert.match(body, /!alertCfg\.escalate_once/, 'escalate_once ต้องยังทำงานเหมือนเดิม');
  });
});
