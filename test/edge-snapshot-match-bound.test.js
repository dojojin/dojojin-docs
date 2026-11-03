// Vigil Platform — ตัวจับคู่ภาพ edge กับ event (Bosch ไม่มี event_id): ฝั่ง UPDATE ต้องมีขอบเวลาจากพารามิเตอร์
// เหตุ 2026-10-07: ขอบมาจาก CTE อย่างเดียว ⇒ ไม่ตัด partition · คิวรีหนักที่สุดของ DB (56 ms × ~22k ครั้ง/วัน)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('edge snapshot UPDATE carries a parameter time bound covering target ± 250 ms', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/mqtt-subscriber.js'), 'utf8');
  const i = s.indexOf('WITH target AS (');
  const sql = s.slice(i, s.indexOf('RETURNING events.id', i));
  // target ค้นใน [ts-5s, ts+10s] → ขอบฝั่ง UPDATE ต้องกว้างกว่าอย่างน้อย 250 ms ทั้งสองข้าง
  assert.match(sql, /event_time BETWEEN \(\$3::timestamptz - interval '5s'\) AND \(\$3::timestamptz \+ interval '10s'\)/);
  assert.match(sql, /events\.event_time BETWEEN \(\$3::timestamptz - interval '5250 milliseconds'\)\s+AND \(\$3::timestamptz \+ interval '10250 milliseconds'\)/);
  assert.match(sql, /events\.event_time BETWEEN target\.t - interval '250 milliseconds'/);
});
