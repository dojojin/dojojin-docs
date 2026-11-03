// ============================================================
// Vigil Platform — test: badge ของหน้า Blacklist ต้องไม่นับของในถังขยะ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เหตุจริง 2026-08-27: badge บนหน้า Plate Blacklist ขึ้น 334 รายชื่อ / 366 record
// ทั้งที่การ์ดข้างล่างมี 35 ใบ — 306 record ที่เหลือถูกโยนลงถังขยะไปแล้ว
// `/api/blacklist/master` กรอง (ถังขยะ + visibility) ส่วน `/api/blacklist/stats`
// ซึ่งอยู่บนหน้าเดียวกันไม่กรองเลย
//
// เทสต์นี้ไม่ได้ตรวจแค่ว่า "ตอนนี้แก้แล้ว" แต่ตรวจ **ทุกคิวรีใน /stats ที่แตะ
// source_records ต้องใช้นิยามกลาง** — บั๊กคลาสนี้กลับมาทางคิวรีใหม่ที่เขียนเพิ่ม
// ทีหลังแล้วลืมกรอง ไม่ใช่ทางคิวรีเดิมที่เพิ่งแก้
// ============================================================
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const { visibleRecordSql, liveRecordSql } = require(path.join(__dirname, '..', 'src', 'helpers', 'blacklistVisibility'));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'blacklist-sources.js'), 'utf8');

// ── 1. นิยามกลางต้องครอบทั้งสองเรื่อง ────────────────────────────────────────
{
  const sql = liveRecordSql('r');
  assert.ok(/blacklist\.overrides/.test(sql) && /_bo\.excluded/.test(sql), 'ต้องกันของในถังขยะ');
  assert.ok(sql.includes(visibleRecordSql('r')), 'ต้องรวมกฎ visibility เดิมไว้ด้วย ไม่ใช่แยกกันคนละที่');
  // NOT EXISTS ไม่ใช่ JOIN — คิวรีที่ใช้ COUNT(*) + GROUP BY จะได้ไม่เสี่ยงแถวเฟ้อ
  assert.ok(/NOT EXISTS/.test(sql) && !/JOIN/.test(sql.split(visibleRecordSql('r'))[0]),
    'ต้องเป็น NOT EXISTS ผู้เรียกจะได้ไม่ต้องแตะ FROM และไม่มีทางทำแถวเฟ้อ');
  assert.throws(() => liveRecordSql('r; DROP TABLE x'), /bad alias/, 'alias ต้องถูกตรวจ');
  assert.throws(() => liveRecordSql(''), /bad alias/);
}

// ── 2. ทุกคิวรีใน /stats ที่แตะ source_records ต้องกรอง ──────────────────────
// ตัดตัวหนังสือของ handler /api/blacklist/stats ออกมาแล้วไล่ทีละ pool.query
function handlerBody(routePath) {
  const start = SRC.indexOf(`app.get('${routePath}'`);
  assert.ok(start > -1, `หา handler ${routePath} ไม่เจอ`);
  const next = SRC.indexOf('\n  app.', start + 10);
  return SRC.slice(start, next > -1 ? next : SRC.length);
}

const stats = handlerBody('/api/blacklist/stats');
const queries = stats.split(/(?:pool|client)\.query\(/).slice(1);
assert.ok(queries.length >= 6, `คาดว่า /stats มีหลายคิวรี เจอ ${queries.length}`);

let checked = 0;
queries.forEach((q, i) => {
  const body = q.slice(0, q.indexOf('`, ') + 1 || 900);
  if (!/blacklist\.source_records/.test(body)) return;   // คิวรีที่ไม่แตะ record ไม่เกี่ยว
  checked++;
  assert.ok(/liveRecordSql\('r'\)/.test(body),
    `คิวรีที่ ${i + 1} ใน /stats แตะ source_records แต่ไม่ได้กรองด้วย liveRecordSql — ` +
    `badge จะนับของในถังขยะอีกครั้ง:\n${body.slice(0, 300)}`);
});
assert.ok(checked >= 5, `ควรตรวจได้อย่างน้อย 5 คิวรี ตรวจได้ ${checked}`);

// ── 3. คิวรีที่นับซ้ำได้ต้องใช้ COUNT(DISTINCT) ──────────────────────────────
// mergedQ กับ dup ใช้ HAVING COUNT(...) > 1 ตัดสินว่า "ซ้ำ" — ถ้าเป็น COUNT(*)
// แล้ววันหนึ่งมี join ที่ทำแถวเฟ้อ ทั้งสองตัวจะรายงานของไม่ซ้ำว่าซ้ำ
for (const m of stats.matchAll(/HAVING COUNT\(([^)]*)\) > 1/g)) {
  assert.ok(/DISTINCT/.test(m[1]), `HAVING COUNT(${m[1]}) > 1 ต้องเป็น COUNT(DISTINCT ...)`);
}

// ── 4. /master ต้องใช้นิยามเดียวกัน ไม่ใช่เขียนเงื่อนไขเอง ───────────────────
// ต้นเหตุของบั๊กนี้คือสองหน้าที่ควรตรงกันเขียนกฎกันคนละที่
{
  const master = handlerBody('/api/blacklist/master');
  assert.ok(/liveRecordSql\('r'\)/.test(master), '/master ต้องใช้นิยามกลาง');
  assert.ok(!/COALESCE\(o\.excluded, FALSE\) = FALSE/.test(master),
    '/master ต้องเลิกเขียนเงื่อนไขถังขยะเอง — เหลือนิยามเดียวเท่านั้น');
}

// ── 5. SOURCES ต้องนับจากตารางแหล่ง ไม่ใช่จาก record ที่เหลืออยู่ ────────────
// ถ้านับจาก record ที่ join มา แหล่งที่ของถูกโยนถังหมดจะหายจาก badge ทั้งที่ยังมี
// pill ของตัวเองอยู่บนหน้าจอ — badge กับสิ่งที่ตาเห็นจะขัดกันเอง
{
  assert.ok(/FROM blacklist\.sources WHERE \$1 = ANY\(data_types\)/.test(stats),
    'SOURCES ต้องนับจาก blacklist.sources โดยตรง');
  assert.ok(!/COUNT\(DISTINCT s\.id\)\s*AS sources/.test(stats),
    'SOURCES ต้องเลิกนับจาก record ที่ join มา');
  // ต้องไม่รวม kept_types ให้ตรงกับเงื่อนไขที่หน้าจอใช้เลือก pill
  const m = stats.match(/FROM blacklist\.sources WHERE[^`]*/);
  assert.ok(m && !/kept_types/.test(m[0]),
    'ต้องใช้ data_types อย่างเดียว ให้ตรงกับ page-blacklist.js ที่กรอง pill ด้วย data_types');
}

// ── 6. หน้าถังขยะต้องไม่โดนกรอง ไม่งั้นถังจะว่างเปล่าตลอดกาล ────────────────
{
  const removed = handlerBody('/api/blacklist/removed');
  assert.ok(!/liveRecordSql/.test(removed), '/removed ต้องไม่ใช้ liveRecordSql');
  assert.ok(/o\.excluded/.test(removed), '/removed ต้องเลือกเฉพาะของที่ถูกตัดออก');
}

console.log('✅ blacklist stats live-only: ผ่าน 6 ข้อ');
