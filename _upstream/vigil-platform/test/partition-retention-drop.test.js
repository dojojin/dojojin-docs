// ============================================================
// Vigil Platform — test: เส้นทางลบ partition ต้องใช้งานได้จริง
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เหตุจริง 2026-08-27: ทดสอบเส้นทาง "ลบจริง" ด้วยการสร้าง partition ปี 2019
// ขึ้นมาแล้วให้กลไกจริงลบ — **มันลบไม่ได้**
//   cannot drop table events_y2019m03 because other objects depend on it
//
// สาเหตุ: CHILD_TABLES เป็นลิสต์ที่เขียนด้วยมือ และขาด 3 ตารางที่มี FK ชี้มาที่
// partition (face_blacklist_hits, face_embed_queue, face_embeddings) · Postgres
// กระจาย FK ของตารางแม่ลงไปสร้าง constraint หนึ่งตัวต่อ partition ซึ่งตัว
// constraint เองขึ้นกับ partition ⇒ DROP ธรรมดาล้มแม้ลบแถวลูกครบแล้ว
//
// 🔴 ที่อันตรายคือเส้นทางนี้จะถูกใช้ครั้งแรกอีกราว 10 เดือน (ข้อมูล 66 วัน ·
// retention 365 วัน) ถ้าไม่ทดสอบก่อน จะไปเจอตอนดิสก์ใกล้เต็ม ซึ่งเป็นเวลาที่
// แย่ที่สุดที่จะมาแก้ — คลาสเดียวกับ reconcile ที่ล้มทุกคืนโดยไม่มีใครรู้
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const PR     = require(path.join(__dirname, '..', 'src', 'helpers', 'partitionRetention'));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'helpers', 'partitionRetention.js'), 'utf8');
const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const fakePool = (rows = []) => {
  const seen = [];
  return { seen, query: async (sql, params) => { seen.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows, rowCount: 0 }; } };
};

(async () => {
  // ── 1. ต้องถามตารางลูกจาก catalog ไม่ใช่จากลิสต์ที่จำไว้ ────────────────────
  // ลิสต์ที่เขียนด้วยมือดริฟต์แล้วหนึ่งครั้ง และจะดริฟต์อีกทันทีที่มีคนเพิ่ม FK ใหม่
  {
    assert.ok(typeof PR.referencingTables === 'function', 'ต้องมีตัวค้นตารางลูกจาก catalog');
    const p = fakePool([{ t: 'license_plates' }, { t: 'face_embeddings' }]);
    const out = await PR.referencingTables(p, 'events_y2026m08');
    assert.deepStrictEqual(out, ['license_plates', 'face_embeddings']);
    assert.ok(/pg_constraint/.test(p.seen[0].sql) && /confrelid/.test(p.seen[0].sql),
      'ต้องถามจาก pg_constraint ว่าใครมี FK ชี้มาที่ partition นี้');
  }

  // ── 2. catalog ไม่ตอบ = ถอยไปใช้ลิสต์เดิม ไม่ใช่ลบไม่ครบ ───────────────────
  {
    const out = await PR.referencingTables(fakePool([]), 'events_y2026m08');
    assert.ok(out.length >= 5, 'ไม่เจออะไรเลยต้องถอยไปใช้ลิสต์ fallback');
    for (const t of ['face_blacklist_hits', 'face_embed_queue', 'face_embeddings']) {
      assert.ok(out.includes(t), `ลิสต์ fallback ต้องมี ${t} — ตัวที่เคยขาดจนทำให้ DROP ล้ม`);
    }
  }

  // ── 3. ชื่อ partition ผิดรูป = ปฏิเสธก่อนยิง SQL ตัวแรก ────────────────────
  // relname ถูกต่อเข้า SQL ตรง ๆ (identifier ใส่ parameter ไม่ได้)
  for (const bad of ['events; DROP TABLE users', 'events_default', 'x', '']) {
    await assert.rejects(() => PR.dropPartition(fakePool(), bad), /ไม่ถูกรูปแบบ/,
      `ชื่อ "${bad}" ต้องถูกปฏิเสธ`);
  }

  // ── 4. DROP ต้องเป็น CASCADE ───────────────────────────────────────────────
  // ไม่ใช่ความมักง่าย: constraint ที่ Postgres สร้างต่อ partition ขึ้นกับตัว
  // partition เอง DROP ธรรมดาจึงล้มแม้ข้อมูลลูกถูกลบครบแล้ว
  assert.ok(/DROP TABLE \$\{relname\} CASCADE/.test(code),
    'DROP ต้องมี CASCADE ไม่งั้นล้มด้วย "other objects depend on it"');

  // ── 5. ต้องลบแถวลูกก่อน DROP เสมอ ─────────────────────────────────────────
  {
    const iDel = code.indexOf('DELETE FROM ${t}');
    const iDrop = code.indexOf('DROP TABLE ${relname}');
    assert.ok(iDel > -1 && iDrop > iDel,
      'ต้องลบแถวในตารางลูกก่อน DROP — CASCADE ทิ้งแค่ constraint ไม่ได้ลบแถวให้');
  }

  // ── 6. ไม่มีอะไรถึงกำหนดก็ต้องทิ้งร่องรอยไว้ ───────────────────────────────
  // เดิม `if (!due.length) return` เงียบสนิท ⇒ "รันแล้วไม่มีงาน" กับ "ไม่เคยรัน"
  // แยกกันไม่ออก ซึ่งคือวิธีที่ reconcile ล้มเงียบมาหลายเดือน
  assert.ok(/beat\.beat\('partition'/.test(code),
    'ต้องรายงานทุกครั้งแม้ไม่มี partition ถึงกำหนด');
  assert.ok(/beat\.beatFail\('partition'/.test(code), 'ล้มเหลวต้องดังกว่าสำเร็จ');

  // ── 7. งาน retention อื่นก็ต้องไม่เงียบตอนไม่มีงาน ────────────────────────
  {
    // งาน retention ย้ายจาก api-server.js ไป src/jobs/retention.js (decision #276, 2026-09-07)
    const API = fs.readFileSync(path.join(__dirname, '..', 'src', 'jobs', 'retention.js'), 'utf8');
    const live = API.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/if \(total > 0\) console\.log\(`🧹 rawXml/.test(live),
      'rawXml retention ต้องไม่เงียบเมื่อ total = 0');
    for (const job of ['rawXml', 'api_log', 'events']) {
      assert.ok(new RegExp(`retentionBeat\\.beat\\('${job}'`).test(live),
        `งาน retention "${job}" ต้องเต้นทุกครั้งแม้ไม่มีอะไรต้องลบ`);
      assert.ok(new RegExp(`retentionBeat\\.beatFail\\('${job}'`).test(live),
        `งาน "${job}" ต้องรายงานเมื่อล้มเหลวด้วย ไม่ใช่ console.warn เฉย ๆ`);
    }
  }

  console.log('✅ partition retention drop: ผ่าน 7 ข้อ');
})().catch((e) => { console.error('🔴', e.message); process.exit(1); });
