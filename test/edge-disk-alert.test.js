// ============================================================
// Vigil Platform — test: เตือนเมื่อดิสก์ edge ตึงหรือตัวลบหยุดทำงาน
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// วัดจริง 2026-08-27: hdy เก็บ snapshot 683 GB หมุนเวียน ~114 GB/วัน โดยเหลือ
// ว่าง 190 GB · การลบ 6 วันทำงานถูกต้อง (ตรวจแล้วไม่มีไฟล์เกิน 6 วันสักไฟล์)
// แต่ถ้ามันหยุดเมื่อไร **มีเวลาไม่ถึง 2 วันก่อนดิสก์เต็ม**
//
// ตัวเลขที่บอกความจริงถูกส่งกลับมาที่ edge_status ทุกรอบ heartbeat อยู่ก่อนแล้ว
// (disk_free_gb, last_prune_json) แต่ disk_free_gb ถูกใช้แค่ประกอบข้อความตอน
// ไซต์เงียบ ส่วน last_prune_json **ไม่เคยมีใครอ่านเลย** — รูปแบบเดียวกับ
// bridge_dropped ที่หายไป 7 สัปดาห์
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const SRC  = fs.readFileSync(path.join(__dirname, '..', 'src', 'alert-engine.js'), 'utf8');
const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const WORKER = fs.readFileSync(path.join(__dirname, '..', 'src', 'alert-worker.js'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const engine = require(path.join(__dirname, '..', 'src', 'alert-engine'));

// ── 1. ฟังก์ชันต้องมีจริงและถูก export ─────────────────────────────────────
assert.strictEqual(typeof engine.checkEdgeDiskLow, 'function',
  'ต้อง export checkEdgeDiskLow ให้ alert-worker เรียกได้');

// ── 2. ต้องอ่านทั้งพื้นที่ว่าง **และ** ผลการลบล่าสุด ────────────────────────
// อ่านแค่พื้นที่ = รู้ตอนที่สายไปแล้ว · อ่านผลการลบด้วย = รู้ตั้งแต่ตัวลบเพิ่งตาย
// ซึ่งบน hdy คือส่วนต่างระหว่าง "มีเวลาแก้" กับ "ไม่มี"
{
  const i = code.indexOf('async function checkEdgeDiskLow');
  assert.ok(i > -1, 'หา checkEdgeDiskLow ไม่เจอ');
  const body = code.slice(i, code.indexOf('\nasync function', i + 10));
  assert.ok(/disk_free_gb/.test(body), 'ต้องอ่านพื้นที่ว่าง');
  assert.ok(/last_prune_json/.test(body), 'ต้องอ่านผลการลบล่าสุด — นี่คือสัญญาณที่มาก่อน');
  assert.ok(/retention_json/.test(body),
    'เกณฑ์ต้องมาจาก min_free_gb ที่ส่งให้ไซต์นั้น ไม่ใช่ค่าที่ตั้งเองคนละมาตรฐานกับตัวลบ');

  // ไซต์ที่ heartbeat เงียบอยู่แล้วต้องปล่อยให้ checkEdgeStale เตือน ไม่ยิงซ้ำสองใบ
  assert.ok(/heartbeat_age/.test(body), 'ต้องข้ามไซต์ที่ heartbeat เงียบ');

  // ต้องมี cooldown เหมือน alert ตัวอื่น ไม่งั้นดิสก์ตึงหนึ่งครั้ง = LINE ทุก 15 นาที
  assert.ok(/_edgeDiskLastSent/.test(body) && /cooldown_ms/.test(body),
    'ต้องมี cooldown ไม่งั้นเตือนซ้ำจนคนปิดการแจ้งเตือนทิ้ง');

  // เคารพสวิตช์ปิดรายไซต์เหมือน alert edge ตัวอื่น
  assert.ok(/disabled_sites/.test(body), 'ต้องเคารพรายการไซต์ที่ปิดการเตือนไว้');
}

// ── 3. ต้องบันทึกลง alert_logs เหมือน alert ตัวอื่น ────────────────────────
{
  const i = code.indexOf('async function checkEdgeDiskLow');
  const body = code.slice(i, code.indexOf('\nasync function', i + 10));
  assert.ok(/INSERT INTO alert_logs/.test(body),
    'ต้องบันทึก alert_logs ไม่งั้นตรวจย้อนไม่ได้ว่าเคยเตือนไปแล้ว');
}

// ── 4. ต้องถูกเรียกจาก alert-worker เท่านั้น ───────────────────────────────
// alert-engine ถูก require ในหลาย process — ถ้าตั้ง interval ในตัว engine เอง
// จะยิง LINE ซ้ำทุก process (เหตุผลเดียวกับที่คอมเมนต์ในไฟล์นั้นเขียนไว้)
{
  assert.ok(/alertEngine\.checkEdgeDiskLow\(\)/.test(WORKER),
    'alert-worker ต้องเป็นคนเรียก');
  assert.ok(!/setInterval[^;]*checkEdgeDiskLow/.test(code),
    'ห้ามตั้ง interval ในตัว engine — จะยิงซ้ำทุก process ที่ require มัน');
}

// ── 5. เกณฑ์ "ตัวลบเงียบ" ต้องยาวกว่าคาบการลบจริง ─────────────────────────
// edge ลบทุก 1 ชั่วโมง · ถ้าตั้งเกณฑ์สั้นกว่านั้นจะเตือนหลอกทุกวัน
{
  const m = /EDGE_PRUNE_STALE_MS \|\| String\((\d+) \* 3600 \* 1000\)/.exec(code);
  assert.ok(m, 'เกณฑ์ต้องตั้งผ่าน env ได้');
  assert.ok(Number(m[1]) >= 2, `เกณฑ์ ${m[1]} ชม. สั้นเกินไป — edge ลบทุก 1 ชม.`);
}

console.log('✅ edge disk alert: ผ่าน 5 ข้อ');
