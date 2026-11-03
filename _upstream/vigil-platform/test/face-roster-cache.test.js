// ============================================================
// Vigil Platform — test: โรสเตอร์ใบหน้าต้องไม่ถูกดึงใหม่ทุกใบหน้า
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// วัดจาก pg_stat_statements ของจริง 2026-08-27 (9 ชั่วโมง):
//   SELECT fb.id, fb.label, fb.embedding, ... FROM face_blacklist ...
//     75,502 ครั้ง · รวม 6,501 วินาที = อันดับ 2 ของทั้งระบบ
//   โรสเตอร์: 1,696 แถว · 3.4 MB · แก้ไขล่าสุดเมื่อ 17 วันก่อน
//   คิวรีเดียว 241 ms ⇒ 807 นาทีของเวลา DB ต่อวัน เพื่อดึงของเดิมซ้ำ
//
// เทสต์นี้อ่านซอร์ส ไม่ต่อ DB — กันไม่ให้ใครเผลอย้ายคิวรีกลับเข้าไปในลูปต่อใบหน้า
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'face-embed-worker.js'), 'utf8');
const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ── 1. checkBlacklist ต้องไม่ยิงคิวรีเอง ────────────────────────────────────
// มันถูกเรียกหนึ่งครั้งต่อใบหน้า — คิวรีที่อยู่ในนั้นคือคิวรีต่อใบหน้า
{
  const i = code.indexOf('async function checkBlacklist');
  assert.ok(i > -1, 'หา checkBlacklist ไม่เจอ');
  const body = code.slice(i, code.indexOf('\nasync function', i + 10));
  assert.ok(!/pool\.query/.test(body),
    'checkBlacklist ต้องไม่ยิงคิวรีเอง — มันทำงานหนึ่งครั้งต่อใบหน้า');
  assert.ok(/loadRoster\(\)/.test(body), 'ต้องอ่านโรสเตอร์ผ่านตัวที่มี cache');
}

// ── 2. loadRoster ต้องมี TTL จริง ──────────────────────────────────────────
{
  const i = code.indexOf('async function loadRoster');
  assert.ok(i > -1, 'หา loadRoster ไม่เจอ');
  const body = code.slice(i, code.indexOf('\nasync function', i + 10));
  assert.ok(/Date\.now\(\) - _roster\.at < ROSTER_TTL_MS/.test(body),
    'ต้องคืนค่าที่แคชไว้เมื่อยังไม่หมดอายุ');
  assert.ok(/_roster = \{ at: Date\.now\(\)/.test(body), 'ต้องบันทึกเวลาโหลด');
  assert.ok(/console\.log/.test(body),
    'ต้อง log ตอนโหลดจริง — ถ้าวันหนึ่งโรสเตอร์โตจนช้า จะได้รู้จากบรรทัดนี้');
}

// ── 3. TTL ต้องตั้งได้และมีค่าเริ่มต้นที่สมเหตุผล ───────────────────────────
{
  const m = /ROSTER_TTL_MS = parseInt\(process\.env\.FACE_ROSTER_TTL_MS \|\| '(\d+)'/.exec(code);
  assert.ok(m, 'TTL ต้องตั้งผ่าน env ได้');
  const ms = Number(m[1]);
  // สั้นเกินไป = ไม่ได้ประโยชน์ · ยาวเกินไป = คนที่เพิ่งถูกเพิ่มเข้าโรสเตอร์
  // ไม่ถูกจับได้นานเกินรับ
  assert.ok(ms >= 10000 && ms <= 300000, `TTL ${ms}ms อยู่นอกช่วงที่สมเหตุผล`);
}

// ── 4. คิวรีโรสเตอร์ต้องมีที่เดียวในไฟล์ ──────────────────────────────────
// สองที่เมื่อไร อีกที่จะกลายเป็นทางที่ไม่ผ่าน cache แบบเงียบ ๆ
{
  const n = (code.match(/FROM face_blacklist fb/g) || []).length;
  assert.strictEqual(n, 1, `คิวรีโรสเตอร์ปรากฏ ${n} ที่ — ต้องมีที่เดียว`);
}

console.log('✅ face roster cache: ผ่าน 4 ข้อ');
