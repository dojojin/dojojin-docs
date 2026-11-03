// ============================================================
// Vigil Platform — Tests: edge ต้องบอกเหตุผลทุกครั้งที่ event จบลงโดยไม่มีภาพ
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ที่มา (2026-09-11 → 12): เจ้าของทักว่าหน้า Snapshot กับหน้าสถิติตัวเลขไม่ตรงกัน
// ส่วนต่างคือ event ที่ไม่มีไฟล์ภาพ · กว่าจะตอบได้ว่าทำไม ต้องใช้ central + edge
// ไล่ย้อนกันทั้งวัน เพราะ `reuseFrameForObject()` `return false` เงียบ ๆ 5 ทาง แล้ว
// ผู้เรียกก็ `return` เงียบต่อ ⇒ ไม่มีอะไรใน log เลย · และยังเหลือ 19–27% ของที่หาย
// ที่ตอบไม่ได้จนถึงตอนนี้เพราะไม่มีร่องรอยให้อ่าน
//
// เทสต์นี้ยึดไว้ว่า "ทางออกใหม่ต้องมีเหตุผลติดไปด้วยเสมอ" — ตรวจที่ซอร์ส เพราะไฟล์นี้
// เป็น service ที่ต่อ MQTT ตอน require จึงโหลดเข้ามาในเทสต์ตรง ๆ ไม่ได้

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/edge-config-agent.js'), 'utf8');

// ตัวฟังก์ชันตั้งแต่บรรทัดประกาศจนถึง `}` ที่คอลัมน์ 0
const FN = (() => {
  const m = SRC.match(/^function reuseFrameForObject[\s\S]*?^\}/m);
  assert.ok(m, 'หา reuseFrameForObject ใน edge-config-agent.js ไม่เจอ');
  return m[0];
})();

describe('reuseFrameForObject — ทุกทางออกต้องบอกเหตุผล', () => {
  it('ไม่มี return false / return true หลงเหลือ (นั่นคือทางออกเงียบแบบเดิม)', () => {
    assert.equal(/return\s+false\b/.test(FN), false, 'เจอ return false — ทางออกนี้จะเงียบ');
    assert.equal(/return\s+true\b/.test(FN), false, 'เจอ return true — ทางออกนี้จะไม่มีเหตุผล');
  });

  it('ทางออกของฟังก์ชันคืน { ok, reason } ครบทุกทาง', () => {
    const returns = FN.match(/return\s+\{\s*ok:/g) || [];
    assert.ok(returns.length >= 7, `คาดว่ามีอย่างน้อย 7 ทาง ได้ ${returns.length}`);
    // reason ทุกตัวต้องเป็น kebab-case สั้น ๆ grep ได้ และห้ามซ้ำกัน
    const reasons = [...FN.matchAll(/reason:\s*'([^']+)'/g)].map(m => m[1]);
    assert.equal(new Set(reasons).size, reasons.length, `reason ซ้ำกัน: ${reasons.join(', ')}`);
    reasons.forEach(r => assert.match(r, /^[a-z][a-z0-9-]*$/, `reason "${r}" ควรเป็น kebab-case`));
  });

  it('ครอบเหตุผลที่รู้จักครบ — เพิ่มทางใหม่แล้วลืมใส่ reason จะแดงที่นี่', () => {
    const reasons = [...FN.matchAll(/reason:\s*'([^']+)'/g)].map(m => m[1]);
    assert.deepEqual(reasons.slice().sort(), [
      'drifted', 'frame-stale', 'meta-crop-off', 'no-held-frame',
      'no-object-id', 'not-in-frame', 'reused',
    ], 'ชุดเหตุผลเปลี่ยนไป — ถ้าตั้งใจเพิ่ม/ตัด ให้แก้เทสต์นี้พร้อมกัน');
  });
});

describe('ผู้เรียก — จุดที่ event จบลงโดยไม่มีภาพ ต้อง log', () => {
  // สาขาที่ `sinceMs < REFETCH_MIN_MS` คือจุดเดียวในไฟล์ที่ event ไม่ได้ทั้งภาพฉาก
  // และภาพ crop · ถ้าวันหน้ามีคนลด diff แล้วเผลอเอา log ออก เทสต์นี้ต้องแดง
  const BRANCH = (() => {
    const m = SRC.match(/if \(sinceMs < REFETCH_MIN_MS\) \{[\s\S]*?\n    \}/);
    assert.ok(m, 'หาสาขา REFETCH_MIN_MS ไม่เจอ');
    return m[0];
  })();

  it('มี console.log ก่อน return', () => {
    assert.match(BRANCH, /console\.log\(/);
    // หา `return;` ที่เป็นคำสั่งจริง ไม่ใช่คำว่า return ที่อยู่ในคอมเมนต์
    const stmt = BRANCH.search(/\n\s*return;/);
    assert.ok(stmt > -1, 'ไม่เจอ return; ในสาขานี้');
    assert.ok(BRANCH.indexOf('console.log(') < stmt, 'ต้อง log ก่อน return ไม่ใช่หลัง');
  });

  it('บรรทัด log พก reason ของ reuse และระยะเวลาไปด้วย', () => {
    assert.match(BRANCH, /reuse:\$\{reuse\.reason\}/, 'ต้องมี reason ของ reuse');
    assert.match(BRANCH, /\$\{sinceMs\}/, 'ต้องบอกว่าห่างจากภาพล่าสุดกี่ ms');
    assert.match(BRANCH, /\$\{REFETCH_MIN_MS\}/, 'ต้องบอกเกณฑ์ที่ใช้ตัดสินด้วย');
  });

  it('ใช้ค่า reuse ด้วย .ok ไม่ใช่เช็คความจริงของทั้งอ็อบเจกต์', () => {
    // `if (reuseFrameForObject(...))` กับอ็อบเจกต์จะเป็นจริงเสมอ = ไม่เคยถ่ายใหม่เลย
    assert.match(SRC, /const reuse = reuseFrameForObject\([^)]*\);\s*\n\s*if \(reuse\.ok\) return;/);
    assert.equal(/if \(reuseFrameForObject\(/.test(SRC), false,
      'เรียกแล้วเช็คตรง ๆ ไม่ได้ — อ็อบเจกต์เป็น truthy เสมอ');
  });
});

describe('SNAP_REFETCH_MIN_MS', () => {
  it('ยังเป็นค่าที่ตั้งผ่าน env ได้ และ default ในโค้ดกับใน registry ตรงกัน', () => {
    assert.match(SRC, /process\.env\.SNAP_REFETCH_MIN_MS \|\| '1000'/);
    const cfg = fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8');
    assert.match(cfg, /SNAP_REFETCH_MIN_MS:\s*\{\s*type:\s*'int',\s*def:\s*1000/);
  });
});
