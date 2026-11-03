// ============================================================
// Vigil Platform — เฝ้าดู transaction ที่เปิดค้างนานผิดปกติ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมต้องมี: incident 2026-08-27 — transaction เดียวเปิดค้าง 124,712 วินาที
// (~34 ชม.) ตรึง vacuum horizon ไว้ ⇒ autovacuum เก็บ dead tuple ไม่ได้ ⇒
// events บวม 9.4% dead ⇒ ทุก scan ช้าลงจนหน้า Event Statistics ว่างเปล่า
// ตัวเลขบอกความจริงมีอยู่แล้วใน pg_stat_activity แต่ไม่มีใครดู (อาการเดียวกับ
// edge_status.bridge_dropped ที่หายไป 7 สัปดาห์ — ดูคอมเมนต์ checkEdgeDataLoss)
//
// 🔴 ต้องดู xact_start ไม่ใช่ query_start:
//   statement_timeout (migration 181 = 15 นาที ระดับ role) ฆ่า **statement**
//   เดี่ยว ๆ ได้อยู่แล้ว สิ่งที่มันจับไม่ได้คือ transaction ที่ประกอบจาก
//   statement สั้น ๆ หลายอัน หรือ session ที่ค้างที่ idle in transaction —
//   ซึ่งก็คือเคสที่กัดเราจริง ถ้าไปดู query_start จะได้เฝ้าเฉพาะสิ่งที่
//   Postgres จัดการเองได้แล้ว และพลาดตัวที่ทำพัง
//
// เกณฑ์ตั้งต้น 20 นาที — สูงกว่าเพดานทุกชั้น (pool ยาวสุด report-worker 600s ·
// role default 15 นาที) ⇒ ติดไฟเมื่อไหร่แปลว่าเพดานเอาไม่อยู่จริง ไม่ใช่ noise
// ============================================================
'use strict';

const DEFAULT_AGE = process.env.LONG_TX_ALERT_MIN || '20 minutes';

// backend_type = 'client backend' สำคัญ — autovacuum worker รันยาวหลายชั่วโมง
// ได้ตามปกติ ถ้าไม่กรองออกจะกลายเป็น noise ล้วน
// xact_start IS NOT NULL ตัด session ที่ idle เฉย ๆ (ไม่ได้เปิด transaction) ออกให้แล้ว
const SQL = `
  SELECT pid,
         usename,
         coalesce(application_name, '') AS app,
         state,
         extract(epoch FROM now() - xact_start)::int AS tx_age_sec,
         extract(epoch FROM now() - coalesce(state_change, xact_start))::int AS state_age_sec,
         left(regexp_replace(coalesce(query, ''), '\\s+', ' ', 'g'), 160) AS query
    FROM pg_stat_activity
   WHERE backend_type = 'client backend'
     AND xact_start IS NOT NULL
     AND pid <> pg_backend_pid()
     AND now() - xact_start > $1::interval
   ORDER BY xact_start`;

/** คืนแถวของ transaction ที่เปิดนานเกิน age (ค่าเริ่มต้น 20 นาที) */
async function findLongTx(pool, age = DEFAULT_AGE) {
  const { rows } = await pool.query(SQL, [age]);
  return rows;
}

/**
 * เช็ครอบเดียวแล้ว log — ใช้ใน setInterval ของ alert-worker
 * ไม่ throw และไม่แตะ control flow ของใคร (WA #3 ชั้น "ทำได้เลย")
 */
async function checkLongTx(pool, age = DEFAULT_AGE) {
  const rows = await findLongTx(pool, age);
  for (const r of rows) {
    const mins = (r.tx_age_sec / 60).toFixed(1);
    // idle in transaction = อันตรายที่สุด ไม่มีใครทำงาน แต่ยังตรึง vacuum อยู่
    const flag = r.state === 'idle in transaction' ? '🔴 idle in transaction' : r.state;
    console.warn(
      `[long-tx] pid ${r.pid} เปิดค้าง ${mins} นาที · ${flag} · ${r.usename}` +
      `${r.app ? `/${r.app}` : ''} · ${r.query}`);
  }
  if (rows.length) {
    console.warn(`[long-tx] ⚠️ ${rows.length} transaction ค้างเกิน ${age} — ` +
                 'autovacuum เก็บ dead tuple ไม่ได้จนกว่าจะปิด · ' +
                 `ปิดด้วย SELECT pg_terminate_backend(${rows[0].pid});`);
  }
  return rows;
}

module.exports = { findLongTx, checkLongTx, DEFAULT_AGE };
