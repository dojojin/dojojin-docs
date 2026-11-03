// ============================================================
// Vigil Platform — test: ตาราง cameras ต้องไม่กลับไปมี index ที่ทำให้บวม
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// วัดจริง 2026-08-27 ก่อนแก้: ตาราง 144 แถว กิน 2,687 MB · dead 99.9% ·
// HOT update 5.6% · SELECT * ใช้ 409 ms
// หลัง migration 182 + VACUUM FULL: 344 kB · SELECT * 4 ms
//
// ต้นเหตุคือ index บน last_seen_at ซึ่งเป็นคอลัมน์ที่ถูกเขียนทุก heartbeat —
// index บังคับให้ UPDATE เป็น non-HOT ทุกครั้ง แถวเก่าจึงกลายเป็น dead tuple สะสม
//
// เทสต์นี้อ่านไฟล์ ไม่ต่อ DB — กันไม่ให้ใครเผลอเติม index กลับเข้า init.sql
// หรือ migration ใหม่ โดยไม่รู้ว่าเคยเกิดอะไรขึ้น
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const DB = path.join(__dirname, '..', 'db');
const files = fs.readdirSync(DB).filter((f) => f.endsWith('.sql'));

// SQL ใช้ -- เป็นคอมเมนต์ · ต้องตัดทิ้งก่อน ไม่งั้นไปจับคำอธิบายของตัวเอง
const stripSql = (t) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const BANNED = [
  ['idx_cameras_lastseen', 'ทำให้ UPDATE เป็น non-HOT ทุกครั้ง = ต้นเหตุที่ตารางบวม 2.7 GB'],
  ['idx_cameras_group',    'ตลอดอายุฐานถูกใช้ 1 ครั้ง'],
  ['idx_cameras_paused',   'ไม่เคยถูกใช้'],
  ['idx_cameras_device',   'ไม่เคยถูกใช้'],
  ['idx_cameras_sd_state', 'ไม่เคยถูกใช้'],
];

// ── 1. ห้ามสร้าง index เหล่านี้ใน init.sql หรือ migration ที่ใหม่กว่า 182 ────
//
// migration เก่า (เช่น 037 ที่สร้าง idx_cameras_paused) เป็นประวัติที่ถูกต้อง
// ของมันในตอนนั้น ห้ามย้อนไปแก้ — ไฟล์ที่ apply ไปแล้วถูกบันทึก checksum ไว้
// สิ่งที่ต้องกันคือ **ของใหม่** ที่จะสร้างกลับมาหลังจากเราเพิ่งทิ้งมันไป
const numOf = (f) => { const m = /^db_migration_(\d+)_/.exec(f); return m ? Number(m[1]) : null; };

for (const f of files) {
  const n = numOf(f);
  if (n !== null && n <= 182) continue;          // ประวัติเก่า ปล่อยไว้ตามเดิม
  const body = stripSql(fs.readFileSync(path.join(DB, f), 'utf8'));
  for (const [idx, why] of BANNED) {
    const creates = new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX[^;]*\\b${idx}\\b`, 'i').test(body);
    assert.ok(!creates, `${f} สร้าง ${idx} กลับมา — ${why}\n` +
      '  ถ้าจำเป็นจริง ต้องแก้ migration 182 ด้วย ไม่งั้นสร้างแล้วโดนลบทันทีตอนบูต');
  }
}

// ── 2. migration 182 ต้องยังอยู่และทิ้งครบทั้ง 5 ตัว ────────────────────────
{
  const m = files.find((f) => /^db_migration_182_/.test(f));
  assert.ok(m, 'migration 182 หายไป — ฐานที่ติดตั้งใหม่จะได้ index ชุดเก่ากลับมา');
  const body = stripSql(fs.readFileSync(path.join(DB, m), 'utf8'));
  for (const [idx] of BANNED) {
    assert.ok(new RegExp(`DROP INDEX IF EXISTS ${idx}`, 'i').test(body), `${m} ต้องทิ้ง ${idx}`);
  }
  assert.ok(/fillfactor\s*=\s*70/i.test(body), 'ต้องตั้ง fillfactor ให้ HOT update มีที่ทำงาน');
  // 🔴 VACUUM รันใน transaction block ไม่ได้ และ migrate.js ห่อ BEGIN/COMMIT ให้ทุกไฟล์
  //    migration ที่ throw = api-server บูตไม่ขึ้น (STUBBORN_FACT #81)
  assert.ok(!/\bVACUUM\b/i.test(body),
    `${m} มี VACUUM — จะ error ใน transaction block แล้วทำให้ api-server บูตไม่ขึ้น`);
}

// ── 3. ไม่มี migration ไหนใส่ VACUUM เลย ────────────────────────────────────
for (const f of files) {
  const body = stripSql(fs.readFileSync(path.join(DB, f), 'utf8'));
  assert.ok(!/\bVACUUM\b/i.test(body),
    `${f} มี VACUUM — migrate.js ห่อทุกไฟล์ด้วย BEGIN/COMMIT จะ error ทันทีตอนบูต\n` +
    '  ถ้าต้องคืนพื้นที่จริง ให้เป็นขั้นตอนปฏิบัติการแยก (ดู scripts/vacuum-cameras.js)');
}

// ── 4. init.sql ต้องตั้ง fillfactor ให้ตรงกัน ───────────────────────────────
// ไม่งั้นเครื่องที่ติดตั้งใหม่จะเริ่มด้วย fillfactor 100 แล้วบวมซ้ำรอยเดิม
{
  const init = stripSql(fs.readFileSync(path.join(DB, 'init.sql'), 'utf8'));
  assert.ok(/ALTER TABLE cameras SET \(fillfactor = 70\)/i.test(init),
    'init.sql ต้องตั้ง fillfactor 70 ให้ตาราง cameras ด้วย');
}

console.log('✅ cameras index diet: ผ่าน 4 ข้อ');
