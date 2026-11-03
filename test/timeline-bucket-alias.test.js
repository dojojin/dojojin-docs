// ============================================================
// Vigil Platform — Tests: alias ของ bucket ต้องไม่ชนกับคอลัมน์จริงในตาราง
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// บั๊กจริง 2026-08-25 — เจ้าของทักว่า "กราฟตรงนี้ดูพัง" จากภาพบนหน้าจอ:
//
//   SELECT (DATE_TRUNC('hour', b.bucket ...)) AS bucket   -- ชื่อชนกับ b.bucket
//     FROM event_dim_bucket b ...
//    GROUP BY bucket, c.id
//
// `event_dim_bucket` มีคอลัมน์ชื่อ `bucket` อยู่จริง · เมื่อชื่อกำกวม PostgreSQL
// ตีความ GROUP BY เป็น **input column ก่อน output alias** (พฤติกรรมตามสเปก)
// GROUP BY จึงจับถัง 30 นาทีดิบ แทนที่จะเป็นชั่วโมง/วันที่ truncate แล้ว
//
//   หนึ่งชั่วโมง → 2 แถว · หนึ่งวัน → 48 แถว
//   ช่วง 30 วัน: พล็อต 1,441 จุด แทนที่จะเป็น 31
//
// Chart.js ได้ค่า y หลายค่าที่ x เดียวกัน เส้นจึงย้อนกลับไปมา และตัวเลขที่พล็อต
// เป็นเพียงเศษเสี้ยวของยอดจริง · **ไม่มี error ใด ๆ ให้เห็น** ทั้ง SQL และ JS
// ทำงานสำเร็จทุกครั้ง กระทบทั้งกราฟในรายงานและกราฟ "ภาพรวมเหตุการณ์" หน้าสถิติ
//
// เทสต์นี้อ่าน SQL จริงจากไฟล์ เพราะการทดสอบเชิงพฤติกรรมต้องต่อ DB ซึ่งชุดเทสต์นี้
// ไม่ทำ · สิ่งที่ตรึงไว้คือกติกา: ห้ามตั้ง alias ชื่อเดียวกับคอลัมน์ของตารางที่
// SELECT อยู่ แล้ว GROUP BY ด้วยชื่อนั้น

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'stats.js'), 'utf8');

// คอลัมน์ของตารางที่ถูก SELECT บ่อยและมีชื่อ "น่าใช้เป็น alias" — ชนเมื่อไหร่เงียบเมื่อนั้น
const RISKY = ['bucket'];

describe('stats.js — alias ของช่วงเวลาต้องไม่ชนกับคอลัมน์ต้นทาง', () => {
  it('ไม่มี `AS bucket` ในคิวรีที่อ่านจาก event_dim_bucket', () => {
    // ตัดเป็นก้อน ๆ ตามตำแหน่งของ FROM event_dim_bucket แล้วดูรอบ ๆ
    const offenders = [];
    let i = 0;
    while ((i = SRC.indexOf('FROM event_dim_bucket', i)) !== -1) {
      // ขอบเขตคิวรี: ถอยไปหา SELECT ที่ใกล้ที่สุด และเดินหน้าไปจนจบ template literal
      const start = SRC.lastIndexOf('SELECT', i);
      const end = SRC.indexOf('`', i);
      const q = SRC.slice(start, end === -1 ? i + 800 : end);
      for (const col of RISKY) {
        if (new RegExp(`AS\\s+${col}\\b`, 'i').test(q)) {
          offenders.push(`${col} @ ตำแหน่ง ${start}`);
        }
      }
      i += 20;
    }
    assert.deepEqual(offenders, [],
      'ตั้ง alias ชื่อเดียวกับคอลัมน์ของ event_dim_bucket — Postgres จะให้ GROUP BY ' +
      'จับคอลัมน์ต้นทางแทน alias เงียบ ๆ:\n  ' + offenders.join('\n  '));
  });

  // กติกาคือ "ห้ามชนกับคอลัมน์ของตารางที่ SELECT อยู่" ไม่ใช่ "ห้ามใช้คำว่า bucket"
  // คิวรีที่อ่านจาก events ใช้ GROUP BY bucket ได้ถูกต้อง เพราะ events ไม่มีคอลัมน์
  // ชื่อนี้ (ยืนยันกับ information_schema แล้ว = 0) — บังคับให้เปลี่ยนตามด้วยจะเป็น
  // การไล่แก้ของที่ไม่ได้พัง แล้วเทสต์จะกลายเป็นภาระแทนที่จะเป็นตัวกัน
  it('คิวรีที่อ่านจาก event_dim_bucket ต้องไม่ GROUP BY bucket', () => {
    const bad = [];
    let i = 0;
    while ((i = SRC.indexOf('FROM event_dim_bucket', i)) !== -1) {
      const start = SRC.lastIndexOf('SELECT', i);
      const end = SRC.indexOf('`', i);
      const q = SRC.slice(start, end === -1 ? i + 800 : end);
      if (/GROUP BY\s+bucket\b/i.test(q)) bad.push(SRC.slice(0, start).split('\n').length);
      i += 20;
    }
    assert.deepEqual(bad, [],
      `คิวรีที่บรรทัด ${bad.join(', ')} GROUP BY bucket ขณะอ่านจาก event_dim_bucket — ` +
      'Postgres จะจับคอลัมน์ต้นทางแทน alias เงียบ ๆ');
  });

  it('timeline-by-category ใช้ alias เดียวกันทั้งสองสาขา (pivot อ่านคีย์เดียว)', () => {
    // สาขา rollup กับ non-rollup ต้องคืนชื่อคอลัมน์เดียวกัน ไม่งั้น pivot จะได้
    // undefined ในสาขาใดสาขาหนึ่งโดยไม่มี error — จุดที่พล็อตจะกลายเป็น null เงียบ ๆ
    const seg = SRC.slice(SRC.indexOf("app.get('/api/stats/timeline-by-category'"));
    const block = seg.slice(0, seg.indexOf('routeError'));
    const aliases = [...block.matchAll(/\$\{bucketExpr\}\s+AS\s+(\w+)/g)].map(m => m[1]);
    assert.equal(aliases.length, 2, `คาดว่ามี 2 สาขา แต่เจอ ${aliases.length}`);
    assert.equal(aliases[0], aliases[1], `สองสาขาใช้ alias ต่างกัน: ${aliases.join(' vs ')}`);
    assert.ok(new RegExp(`byCat\\[k\\]\\.push\\(\\{ bucket: r\\.${aliases[0]}\\b`).test(block),
      `pivot ไม่ได้อ่าน r.${aliases[0]} — จุดที่พล็อตจะเป็น undefined`);
  });
});
