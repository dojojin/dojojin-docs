// ============================================================
// Vigil Platform — Tests: backup files must never be committable
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// cameras-config มีรหัสผ่านกล้องทุกตัว (enc:v1:) ไฟล์สำรองของมันจึงห้ามหลุดขึ้น git
// เด็ดขาด · .gitignore เคยมีกฎที่ "ตั้งใจ" จะครอบไว้ 3 บรรทัด แต่ชื่อไฟล์ที่ใช้จริง
// (cameras-config.bak-<เหตุผล>-<เวลา>) ไม่ลงท้าย .bak และไม่ลงท้าย .json จึงหลุดทุกกฎ
// พบ 2026-08-21 · เทสต์นี้ถามโดยตรงว่า git จะ ignore ชื่อพวกนี้จริงไหม

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const ignored = (p) => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: REPO });
    return true;
  } catch { return false; }
};

describe('ไฟล์สำรองที่มีความลับต้องถูก .gitignore ครอบ', () => {
  const mustIgnore = [
    'cameras-config.json',
    'cameras-config.json.bak',
    'cameras-config.json.bak1',
    'cameras-config.backup-20260820.json',
    'cameras-config.bak-ignoreev-202608200107',   // ชื่อจริงที่เคยหลุด
    'cameras-config.bak-anything',
    'src/.env.bak',
    'src/.env.old.bak',
  ];
  for (const p of mustIgnore) {
    it(p, () => assert.ok(ignored(p), `${p} ต้องถูก ignore — ไฟล์นี้มี credential`));
  }

  it('ไฟล์ปกติต้องไม่โดน ignore ไปด้วย', () => {
    assert.ok(!ignored('src/api-server.js'));
    assert.ok(!ignored('cameras-groups-example.json'));
  });
});
