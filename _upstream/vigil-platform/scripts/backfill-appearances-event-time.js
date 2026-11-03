#!/usr/bin/env node
// ============================================================
// Vigil Platform — backfill appearances.event_time + rj_* (migration 255 · D6)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เติมแถวเก่าที่เกิดก่อน trigger ของ migration 255 · ทำทีละ 6 ชม. ของ detected_at จากเก่าไปใหม่
// รันซ้ำได้/หยุดกลางทางได้ — แตะเฉพาะแถวที่ event_time ยัง NULL
//
// ขั้นที่ 1 ต่อก้อน: หา event ในช่วง [ก้อน − 7 วัน, ก้อน + 1 วัน] — ตัด partition ได้ เร็ว
//   (detected_at คือเวลาบันทึก มักช้ากว่า event_time ไม่กี่นาที · ส่งย้อนหลังได้หลายวัน)
// ขั้นที่ 2: แถวที่ยังเหลือ (event มาช้ากว่า 7 วัน) ค้นด้วย id อย่างเดียว — ช้าต่อแถวแต่ตรงเสมอ
// แถวที่ event ถูกลบไปแล้วจะค้างเป็น NULL (นับแยกในสรุป ไม่ใช่ error)
//
// ใช้: node scripts/backfill-appearances-event-time.js [--pause-ms 500]
'use strict';
const path = require('path');
const { Pool } = require(path.join(__dirname, '..', 'src', 'node_modules', 'pg'));
const env = require(path.join(__dirname, '..', 'src', 'config'));

const CHUNK_MS = 6 * 3600_000;
const pauseIdx = process.argv.indexOf('--pause-ms');
const PAUSE_MS = pauseIdx > 0 ? Number(process.argv[pauseIdx + 1]) : 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SET_COLS = `event_time = e.event_time,
       rj_mask = e.raw_json->>'mask', rj_hat = e.raw_json->>'hat',
       rj_age_group = e.raw_json->>'ageGroup', rj_expression = e.raw_json->>'faceExpression'`;

async function main() {
  const pool = new Pool({ ...env.db(), max: 2, application_name: 'backfill-appearances',
                          statement_timeout: 300_000 });
  const { rows: [b] } = await pool.query(
    `SELECT min(detected_at) AS lo, max(detected_at) AS hi FROM appearances WHERE event_time IS NULL`);
  if (!b.lo) { console.log('ไม่มีแถวค้าง'); await pool.end(); return; }
  let t = Math.floor(new Date(b.lo).getTime() / CHUNK_MS) * CHUNK_MS;
  const end = new Date(b.hi).getTime();
  let done = 0, slow = 0;
  const t0 = Date.now();
  for (; t <= end; t += CHUNK_MS) {
    const lo = new Date(t), hi = new Date(t + CHUNK_MS);
    const s = Date.now();
    const r1 = await pool.query(
      `UPDATE appearances a SET ${SET_COLS}
         FROM events e
        WHERE a.event_time IS NULL AND a.detected_at >= $1 AND a.detected_at < $2
          AND e.id = a.event_id
          AND e.event_time >= $1::timestamptz - interval '7 days' AND e.event_time < $2::timestamptz + interval '1 day'`,
      [lo, hi]);
    // ขั้นที่ 2 รันเฉพาะเมื่อมีแถวเหลือจริง และบังคับ nested loop — ไม่งั้น planner (สถิติ event_time IS NULL
    // ยังเก่า) อาจเลือก hash join ที่สแกน events ทั้งตาราง ~40 ล้านแถวต่อก้อน
    const { rows: [rest] } = await pool.query(
      `SELECT count(*)::int AS n FROM appearances
        WHERE event_time IS NULL AND detected_at >= $1 AND detected_at < $2 AND event_id IS NOT NULL`, [lo, hi]);
    let r2 = { rowCount: 0 };
    if (rest.n > 0) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL enable_hashjoin = off');
        await c.query('SET LOCAL enable_mergejoin = off');
        r2 = await c.query(
          `UPDATE appearances a SET ${SET_COLS}
             FROM events e
            WHERE a.event_time IS NULL AND a.detected_at >= $1 AND a.detected_at < $2
              AND a.event_id IS NOT NULL AND e.id = a.event_id`,
          [lo, hi]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    }
    done += r1.rowCount + r2.rowCount; slow += r2.rowCount;
    console.log(`${lo.toISOString().slice(0, 13)}h  +${r1.rowCount} (+${r2.rowCount} นอกช่วง)  ${Date.now() - s} ms`
      + `  รวม ${done.toLocaleString()}  ${Math.round((Date.now() - t0) / 1000)} วิ`);
    if (PAUSE_MS) await sleep(PAUSE_MS);
  }
  const { rows: [left] } = await pool.query(
    `SELECT count(*)::int AS n FROM appearances WHERE event_time IS NULL`);
  console.log(`เสร็จ: เติม ${done.toLocaleString()} แถว (นอกช่วง 7 วัน ${slow}) · ยังเป็น NULL ${left.n} แถว (event ถูกลบไปแล้ว)`);
  await pool.end();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
