// ============================================================
// Vigil Platform — test: การประทับเวลา "เห็นกล้องล่าสุด" ต้องมีคาบ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// วัดจาก pg_stat_statements ของจริง 2026-08-27 (9 ชั่วโมง):
//   UPDATE cameras SET last_seen_at=NOW() WHERE id=$1
//     836,635 ครั้ง · รวม 19,667 วินาที = คิวรีที่กินระบบมากที่สุดของทั้งระบบ
// ผลบนตารางที่มี 118 แถว: dead tuple 99.9% · ขนาด 2,687 MB · HOT update แค่ 5.6%
//   ⇒ SELECT id, site_id FROM cameras (118 แถว) ใช้ 396 ms
//
// เทสต์นี้กันไม่ให้ใครเผลอกลับไปเขียนทุก event · ไม่ต่อ DB จริง — ใช้ fake pool
// ดักดูว่าคิวรีที่ส่งออกไปมีเงื่อนไขคาบจริงไหม
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const { touchCamera, TOUCH_EVERY_SEC } = require(path.join(__dirname, '..', 'src', 'helpers', 'touchCamera'));
const { OFFLINE_THRESHOLD_SEC } = require(path.join(__dirname, '..', 'src', 'constants'));

const fakePool = () => {
  const seen = [];
  return { seen, query: async (sql, params) => { seen.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [], rowCount: 1 }; } };
};

(async () => {
  // ── 1. ต้องกรองที่ WHERE ไม่ใช่ตัดสินใจในโปรเซส ─────────────────────────────
  // หลาย process แตะกล้องตัวเดียวกันพร้อมกันได้ แคชในหน่วยความจำของใครของมัน
  // จึงกันกันเองไม่ได้ · ต้องให้ Postgres เป็นคนตัดสิน
  {
    const p = fakePool();
    await touchCamera(p, 'CAM01');
    assert.strictEqual(p.seen.length, 1, 'ต้องยิงคิวรีเดียว');
    const { sql, params } = p.seen[0];
    assert.ok(/UPDATE cameras SET/.test(sql));
    assert.ok(/last_seen_at IS NULL/.test(sql),
      'ครั้งแรกที่ค่าเดิมยังเป็น NULL ต้องเขียน ไม่งั้นกล้องใหม่จะไม่มีวันขึ้นออนไลน์');
    assert.ok(/last_seen_at < NOW\(\) - \(\$2 \|\| ' seconds'\)::interval/.test(sql),
      'ต้องมีเงื่อนไขคาบใน WHERE — ถ้าหายไปคือกลับไปเขียนทุก event');
    assert.strictEqual(params[0], 'CAM01');
    assert.strictEqual(params[1], String(TOUCH_EVERY_SEC));
  }

  // ── 2. โหมด event ต้องแตะ last_event_at ด้วย และยังมีคาบเหมือนกัน ───────────
  {
    const p = fakePool();
    await touchCamera(p, 'CAM01', { event: true });
    const { sql } = p.seen[0];
    assert.ok(/last_event_at = NOW\(\)/.test(sql), 'โหมด event ต้องเขียน last_event_at');
    assert.ok(/ seconds'\)::interval/.test(sql), 'โหมด event ก็ต้องมีคาบ');
  }

  // ── 3. ไม่มี id = ไม่ยิงคิวรี ────────────────────────────────────────────────
  {
    const p = fakePool();
    await touchCamera(p, null);
    await touchCamera(p, undefined);
    assert.strictEqual(p.seen.length, 0, 'id ว่างต้องไม่ยิงคิวรีทิ้ง');
  }

  // ── 4. ห้าม throw — ผู้เรียกทุกตัวอยู่บนเส้นทาง ingest ─────────────────────
  // ถ้าการประทับเวลาล้มแล้วโยนขึ้นไป จะพา event ที่กำลังบันทึกร่วงไปด้วย
  await touchCamera({ query: async () => { throw new Error('db down'); } }, 'CAM01');

  // ── 5. คาบต้องห่างจากเกณฑ์ออฟไลน์พอ ────────────────────────────────────────
  // ถ้าคาบเขียนใกล้เกณฑ์ออฟไลน์ กล้องที่ยังส่งข้อมูลอยู่จะกะพริบเป็นออฟไลน์เอง
  assert.ok(OFFLINE_THRESHOLD_SEC > TOUCH_EVERY_SEC * 2,
    `คาบเขียน ${TOUCH_EVERY_SEC} วิ ใกล้เกณฑ์ออฟไลน์ ${OFFLINE_THRESHOLD_SEC} วิ เกินไป`);

  // ── 6. เส้นทาง ingest ต้องไม่มี UPDATE ดิบหลงเหลือ ─────────────────────────
  // จุดเดียวที่ยกเว้นได้คือตอนปลด pause ซึ่งหน้าที่ของมันคือรีเซ็ตนาฬิกา
  // ถ้าโดนคาบกรองทิ้งจะไม่ทำงานพอดีในเคสที่ต้องการมันที่สุด
  {
    const ROOT = path.join(__dirname, '..', 'src');
    const files = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name === 'node_modules') continue;
        const full = path.join(d, f.name);
        if (f.isDirectory()) walk(full);
        else if (f.name.endsWith('.js')) files.push(full);
      }
    })(ROOT);

    // ไม่ผูกกับเลขบรรทัด — เลขเลื่อนทุกครั้งที่แก้ไฟล์ เทสต์จะพังโดยไม่มีอะไรผิดจริง
    // ยึดไฟล์ + บริบทรอบบรรทัดว่าเป็นทางปลด pause จริงแทน
    const offenders = [];
    for (const f of files) {
      if (f.endsWith(path.join('helpers', 'touchCamera.js'))) continue;
      const body = fs.readFileSync(f, 'utf8').split('\n');
      body.forEach((line, i) => {
        if (line.trim().startsWith('//')) return;
        if (!/UPDATE cameras SET last_seen_at\s*=?\s*NOW\(\)/.test(line)) return;
        const around = body.slice(Math.max(0, i - 8), i + 2).join('\n');
        const isUnpause = /paused/.test(around) && f.endsWith(path.join('helpers', 'cameraPause.js'));
        if (!isUnpause) offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
      });
    }
    assert.deepStrictEqual(offenders, [],
      'มี UPDATE last_seen_at ดิบบนเส้นทาง ingest — ต้องใช้ helpers/touchCamera:\n  ' + offenders.join('\n  '));
  }

  console.log('✅ camera touch throttle: ผ่าน 6 ข้อ');
})().catch((e) => { console.error('🔴', e.message); process.exit(1); });
