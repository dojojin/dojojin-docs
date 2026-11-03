// ============================================================
// Vigil Platform — test: กล้องต้องยืนยัน heartbeat ซ้ำก่อนพลิกเป็น online
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// GOTCHAS #76 ต่อยอด 2026-09-15: กล้อง Hikvision push (`videoloss` heartbeat
// ทุก ~10 วิ) ที่อยู่หลังเครือข่ายหลุดเป็นรอบ (ปมเดียวกับรายงาน HKT
// hourly-dropout) บางทีมี heartbeat แค่ 1 แพ็กเก็ตหลุดผ่านมาได้ต่อชั่วโมง —
// ของเดิมพลิกเป็น "online" ทันทีจาก heartbeat เดียว ไม่ยืนยันซ้ำ ⇒ ยิง
// "กลับมาออนไลน์!" หลอกแล้ว offline คืนใน 90 วิ (ยืนยันจริงจาก camera_status_log
// ของ C2-KML-SB-02: online→offline ห่างกัน 90 วิ 3 รอบติดในวันเดียว)
//
// checkOfflineCameras() ไม่ได้ export (อยู่ใน api-server.js ทั้งก้อน ผูกกับ
// pool/loadCameraConfig ของโปรเซสจริง) — เทสต์นี้จึงตรวจ source text แบบเดียว
// กับ test/line-webhook-command.test.js แทนการ import มารันตรง ๆ
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'api-server.js'), 'utf8');

describe('watchdog ต้องยืนยัน heartbeat ซ้ำก่อนประกาศ online', () => {
  it('มีตัวนับ streak แยกจาก isOnline ดิบ', () => {
    assert.match(src, /_onlineConfirm/, 'ต้องมี Map นับ poll ติดกันที่ heartbeat สด');
    assert.match(src, /ONLINE_CONFIRM_POLLS\s*=\s*2/,
      'ต้องรออย่างน้อย 2 poll ติดกัน (heartbeat เดียวไม่พอ)');
  });

  it('กล้องที่ online อยู่แล้วไม่ต้องรอยืนยันซ้ำ (กันดีเลย์ที่ไม่จำเป็น)', () => {
    const i = src.indexOf('const rawOnline');
    assert.ok(i > 0, 'ไม่พบ loop การตัดสินใจ online/offline');
    const loop = src.slice(i, i + 700);
    assert.match(loop, /else if \(cam\.enabled\) \{\s*isOnline = true;/,
      'cam.enabled=true (online อยู่แล้ว) ต้อง short-circuit ไม่เข้า streak logic');
  });

  it('rawOnline เท็จต้องล้าง streak ทันที ไม่ปล่อยค้าง', () => {
    const i = src.indexOf('const rawOnline');
    const loop = src.slice(i, i + 700);
    assert.match(loop, /if \(!rawOnline\) \{\s*_onlineConfirm\.delete\(cam\.camera_id\);/,
      'ออฟไลน์ต้องล้าง streak ไม่งั้นรอบถัดไปนับต่อผิด ๆ');
  });

  it('กล้อง paused ต้องล้าง streak ด้วย (กันของค้างข้ามช่วง maintenance)', () => {
    assert.match(src, /if \(cam\.paused\) \{ _onlineConfirm\.delete\(cam\.camera_id\); continue; \}/);
  });
});

// เจ้าของอนุมัติ 2026-09-15: การ์ดกล้องดับ/กลับมาออนไลน์แบบมีภาพประกอบ (opt-in
// ต่อกล้อง, send_snapshot) — ตรวจกับข้อมูลจริงของ C2-KML-SB-02 พบว่าแถว "ครั้งก่อน"
// หยิบปูมของรอบปัจจุบันเองมาแสดงผิด ("ดับเมื่อ 0 วิก่อนหน้า") เพราะ offline_since
// กับ camera_status_log.changed_at ของรอบเดียวกันมาจากคนละ NOW() ห่างกันแค่ ms
describe('"ครั้งก่อน" ต้องไม่หยิบปูมของรอบปัจจุบันเองมาแสดง', () => {
  it('มีช่องว่างขั้นต่ำกันปูมรอบปัจจุบัน', () => {
    const i = src.indexOf('async function _prevOfflineCycleLabel');
    assert.ok(i > 0, 'ไม่พบฟังก์ชันหาครั้งก่อนดับ');
    const body = src.slice(i, i + 1500);
    assert.match(body, /INTERVAL '10 seconds'/,
      'ต้องเผื่อช่องว่างขั้นต่ำ ไม่งั้นจะหยิบ log ของรอบปัจจุบันเองมาแสดงเป็น "ครั้งก่อน"');
  });
});

// เจ้าของสั่ง 2026-09-15 หลังเห็น carousel 10 ใบพร้อมภาพหน้าคนตอนกล้อง face หลายตัว
// ดับพร้อมกัน: "ดับเยอะแบบนี้ ไม่ต้องส่งรูปก็ได้ สรุปมาเลยทีเดียว" — และรูปของกล้อง
// ใบหน้าต้องเป็น full scene ไม่ใช่ครอปหน้าคน ("รูปขอเป็นรูป full scene")
describe('การ์ดมีภาพประกอบ (send_snapshot) เฉพาะตอนดับทีละตัว + ต้องเป็น full scene', () => {
  it('ดับพร้อมกันหลายตัว ต้องยุบกลับไปเป็นข้อความสรุปเปล่า ไม่ส่งรูปเลย', () => {
    const i = src.indexOf('const snapCandidates');
    assert.ok(i > 0, 'ไม่พบตัวกรอง snapCandidates');
    const body = src.slice(i, i + 400);
    assert.match(body, /snapCandidates\.length === 1 \? snapCandidates : \[\]/,
      'snapItems ต้องว่างเมื่อมีมากกว่า 1 ตัวในกลุ่มเดียวกัน — ห้ามส่งรูปตอนดับพร้อมกันหลายตัว');
  });

  it('ภาพกล้องใบหน้าต้องดึง full scene (_snapshot_full) ก่อน ไม่ใช่ครอปหน้าคน', () => {
    const i = src.indexOf('async function _lastCameraEventSnapshot');
    assert.ok(i > 0, 'ไม่พบฟังก์ชันหา snapshot ล่าสุด');
    const body = src.slice(i, i + 800);
    assert.match(body, /COALESCE\(raw_json->>'_snapshot_full', snapshot_filename\)/,
      'ต้องเอา _snapshot_full (scene เต็ม) ก่อนเสมอ ไม่งั้นกล้องใบหน้าจะได้ภาพครอปหน้าคนแทน');
  });
});

// เจ้าของสั่ง 2026-09-15: ก่อนประกาศกล้อง "กลับมาออนไลน์" ต้องยิงไปขอ snapshot
// จริงจากกล้อง (ผ่าน edge — central ต่อ IP กล้องไม่ได้เลย ทดสอบแล้ว) ไม่ใช่เชื่อ
// heartbeat อย่างเดียว — เสี่ยงบัญชีกล้องถูกล็อกถ้ายิงถี่เกิน (Hikvision digest
// auth lockout ~30 นาที, feedback_hik_digest_lockout / GOTCHAS #144) จึงต้องมี
// cooldown + auth-giveup mirror ของ edge-config-agent.js's AUTH_GIVEUP_AFTER
describe('ด่านที่สองก่อนประกาศ online: ยิงขอ snapshot จริงผ่าน edge ต้องกัน lockout', () => {
  it('เรียกเฉพาะหลัง heartbeat ยืนยันครบแล้วเท่านั้น ไม่ใช่ทุก poll', () => {
    const i = src.indexOf('const heartbeatConfirmed');
    assert.ok(i > 0, 'ไม่พบตัวแปร heartbeatConfirmed');
    const body = src.slice(i, i + 500);
    assert.match(body, /isOnline = heartbeatConfirmed/,
      'ต้อง short-circuit ด้วย heartbeatConfirmed ก่อนเสมอ — ห้ามยิง snapshot ก่อน heartbeat ยืนยัน');
    assert.match(body, /&&\s*await _confirmCameraViaSnapshot/,
      'ต้องเรียก _confirmCameraViaSnapshot ต่อจาก heartbeatConfirmed ด้วย && (short-circuit)');
  });

  it('auth fail ติดกันครบ SNAPSHOT_AUTH_GIVEUP_AFTER ต้องพัก 35 นาที ไม่ใช่ยิงต่อ', () => {
    assert.match(src, /SNAPSHOT_AUTH_GIVEUP_AFTER\s*=\s*2/);
    assert.match(src, /SNAPSHOT_AUTH_BACKOFF_MS\s*=\s*35\s*\*\s*60_000/,
      'ต้อง mirror ค่า backoff เดียวกับ edge-config-agent.js (35 นาที) ไม่ใช่คิดใหม่');
    const i = src.indexOf("if (result.reason === 'auth')");
    assert.ok(i > 0, 'ไม่พบเงื่อนไขจัดการ auth fail แยกจากเหตุอื่น');
  });

  it('พัก auth-held แล้วต้องเชื่อ heartbeat ต่อ ไม่ใช่ค้าง offline ถาวร', () => {
    const i = src.indexOf('async function _confirmCameraViaSnapshot');
    assert.ok(i > 0);
    const body = src.slice(i, i + 900);
    assert.match(body, /if \(st\.authHeldUntil && nowMs < st\.authHeldUntil\) return true;/,
      'ระหว่างพัก auth-held ต้อง return true (เชื่อ heartbeat) ไม่ใช่ false ค้างตลอดไป');
  });

  it("site 'main' หรือไม่รู้ site ต้องไม่บล็อก — ไม่มี edge ให้ยิงแทน", () => {
    const i = src.indexOf('async function _confirmCameraViaSnapshot');
    const body = src.slice(i, i + 400);
    assert.match(body, /if \(!siteCode \|\| siteCode === 'main'\) return true;/);
  });
});

describe('edge endpoint /probe-camera-snapshot ต้องไม่ลอง path อื่นซ้ำด้วยรหัสผิด', () => {
  const lprSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lpr-receiver.js'), 'utf8');

  it('เจอ auth fail ต้องหยุดทันที ไม่วนลอง candidate path ที่เหลือ', () => {
    const i = lprSrc.indexOf("app.post('/probe-camera-snapshot'");
    assert.ok(i > 0, 'ไม่พบ endpoint /probe-camera-snapshot');
    const body = lprSrc.slice(i, i + 1500);
    assert.match(body, /if \(r\.reason === 'auth'\) break;/,
      'ยิงรหัสผิดกับ path เดิมซ้ำ ๆ ในคำขอเดียวไม่ช่วยอะไร มีแต่เพิ่มความเสี่ยง lockout');
  });

  it('ป้องกันด้วย SNAPSHOT_PROXY_SECRET เหมือน endpoint อื่นในไฟล์เดียวกัน', () => {
    const i = lprSrc.indexOf("app.post('/probe-camera-snapshot'");
    const body = lprSrc.slice(i, i + 300);
    assert.match(body, /SNAPSHOT_PROXY_SECRET/);
  });
});

// เจ้าของสั่ง 2026-09-15 หลังเห็นจริง: "สังเกตุว่าตำแหน่งมันอยู่เดียวกัน 3-4 กล้อง
// แต่แจ้งตำแหน่งทุกกล้อง ผมว่าไม่โอเค" — ข้อความสรุปหลายกล้องต้องจัดกลุ่มตามตำแหน่ง
// ก่อน ไม่พิมพ์ตำแหน่งซ้ำทุกกล้อง — ต่อมาอัปเกรดเป็น Flex การ์ดไม่มีรูป (ดู mockup
// ที่เจ้าของอนุมัติ) แทนข้อความเปล่า แต่หลักการจัดกลุ่มตามตำแหน่งเหมือนเดิม
describe('ข้อความสรุปหลายกล้องต้องจัดกลุ่มตามตำแหน่ง ไม่พิมพ์ตำแหน่งซ้ำ', () => {
  it('มี multiSections จัดกลุ่มตาม location ก่อนส่งเป็น section ของการ์ด', () => {
    const i = src.indexOf('const multiSections =');
    assert.ok(i > 0, 'ไม่พบ multiSections — ยังไม่จัดกลุ่มตามตำแหน่ง');
    const body = src.slice(i, i + 700);
    assert.match(body, /groups\.set\(loc, \[\]\)/, 'ต้อง group ตาม location');
  });

  it('หลายกล้องพร้อมกัน (>1) ต้องส่งเป็น Flex ไม่มีรูป ไม่ใช่ข้อความเปล่า', () => {
    const i = src.indexOf('} else if (plainItems.length > 1) {');
    assert.ok(i > 0, 'ไม่พบเงื่อนไขแยกกรณีหลายกล้อง');
    const body = src.slice(i, i + 900);
    assert.match(body, /buildCompareFlexAlert\(\{/, 'ต้องใช้ buildCompareFlexAlert ตัวเดียวกับการ์ดกล้องเดี่ยว');
    assert.match(body, /sections: multiSections\(plainItems/, 'ต้องส่ง sections จาก multiSections ไม่ใช่ text ต่อกัน');
    assert.ok(!/hero:/.test(body), 'หลายกล้องพร้อมกันต้องไม่มี hero (ไม่ส่งรูป)');
  });

  it('กล้องเดียว (solo) ยังเป็นข้อความเปล่าเหมือนเดิม ไม่เปลี่ยนเป็น Flex', () => {
    const i = src.indexOf('if (plainItems.length === 1) {');
    assert.ok(i > 0);
    const body = src.slice(i, i + 400);
    assert.match(body, /type: 'text', text/, 'กล้องเดียวต้องยังส่งข้อความเปล่าแบบเดิม ไม่เปลี่ยนพฤติกรรม');
  });

  it('เวลาต้องอยู่บนสุด (subtitle ใต้ chip) ไม่ใช่บรรทัดสุดท้าย', () => {
    const i = src.indexOf('} else if (plainItems.length > 1) {');
    const body = src.slice(i, i + 900);
    assert.match(body, /subtitle: `เวลา \$\{timeStr\}`/,
      'เจ้าของสั่ง "เวลาควรเอาไว้ด้านบนนะครับ จะได้รู้ว่ากี่โมง" — ต้องอยู่ subtitle ไม่ใช่ต่อท้าย sections');
  });
});

// เจ้าของเจอจริง 2026-09-15: การ์ดแจ้งเตือนซ้ำ (escalation) ขึ้น "เพิ่งดับ" ทั้งที่
// ดับมาเป็นชั่วโมงแล้ว (offlineSince เก่ากว่าตอนแจ้งมาก) — เพราะ "ดับมา" hardcode
// ข้อความนี้ไว้ไม่สนว่าเป็นครั้งแรกหรือครั้งที่เท่าไหร่
describe('การ์ดกล้องดับต้องโชว์ระยะเวลาจริง ไม่ใช่ "เพิ่งดับ" เสมอ', () => {
  it('การ์ดเดี่ยวต้องคำนวณ _durPlain ทั้งสองสถานะ ไม่ใช่แค่ online', () => {
    const i = src.indexOf('async function _buildCameraSnapshotBubble');
    assert.ok(i > 0);
    const body = src.slice(i, i + 1000);
    assert.match(body, /const dur = _durPlain\(it\.offlineSince\);/,
      'ต้องคำนวณระยะเวลาจริงทั้งสองสถานะ (offline ก็ต้องรู้ว่าดับมานานแค่ไหนแล้ว)');
    assert.ok(!/status === 'online' \? _durPlain/.test(body),
      'ห้ามคำนวณเฉพาะตอน online เหมือนเดิม — offline ก็ต้องได้ค่าจริงด้วย');
  });

  it('แถว "ดับมา" ต้องใช้ dur จริง ไม่ hardcode "เพิ่งดับ" ตาม status', () => {
    const i = src.indexOf("rows.push(['ดับมา'");
    assert.ok(i > 0);
    const line = src.slice(i, i + 80);
    assert.match(line, /dur \|\| 'เพิ่งดับ'/,
      '"เพิ่งดับ" ควรเป็นแค่ fallback ตอนไม่มี offlineSince เลย ไม่ใช่ค่าเริ่มต้นของทุกการ์ดออฟไลน์');
  });

  it('การ์ดหลายกล้อง (multiSections) ต้องส่ง durLabel ทั้งสองสถานะเหมือนกัน', () => {
    const i = src.indexOf('sections: multiSections(plainItems');
    assert.ok(i > 0);
    const line = src.slice(i, i + 60);
    assert.match(line, /multiSections\(plainItems, durLabel\)/,
      'ต้องส่ง durLabel ตรง ๆ ทั้งสองสถานะ ไม่ใช่ undefined ตอน offline');
  });
});
