// ============================================================
// Vigil Platform — ประทับเวลา "เห็นกล้องล่าสุด" แบบมีคาบ
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ทำไมต้องมี: วัดจาก pg_stat_statements ของจริง 2026-08-27 (ช่วง 9 ชั่วโมง)
//
//   UPDATE cameras SET last_seen_at=NOW() WHERE id=$1
//     836,635 ครั้ง · รวม 19,667 วินาที = 5.5 ชั่วโมงของเวลา DB
//     เป็นคิวรีที่กินระบบมากที่สุด ทิ้งอันดับสองไปเกือบ 3 เท่า
//
// ผลสะสมบนตารางที่มีแค่ 118 แถว:
//   dead tuple 208,307 แถว = 99.9% · ขนาด 2,687 MB (ควรอยู่หลักร้อย KB)
//   HOT update ทำได้แค่ 5.6% เพราะมี index บน last_seen_at + fillfactor 100
//   ⇒ SELECT id, site_id FROM cameras (118 แถว) ใช้เวลา 396 ms
//   autovacuum วิ่งไป 14,411 รอบก็ยังตามไม่ทัน
//
// ความแม่นยำที่เสียไป = ศูนย์: ค่านี้ถูกใช้ตัดสินแค่ว่า "กล้องออนไลน์ไหม" ซึ่งวัด
// ด้วย OFFLINE_THRESHOLD_SEC ระดับ *นาที* การเขียนถี่กว่านั้นไม่มีใครได้ประโยชน์
//
// 🔴 ต้องกรองที่ WHERE ไม่ใช่เช็คในโปรเซสแล้วค่อยยิง — หลาย process (mqtt-subscriber,
// hikvision, dahua, lpr-receiver, api-server) แตะกล้องตัวเดียวกันได้พร้อมกัน
// แคชในหน่วยความจำของใครของมันจึงกันกันเองไม่ได้ · ให้ Postgres เป็นคนตัดสินใจ
// แถวที่ไม่เข้าเงื่อนไขจะไม่ถูกเขียนเลย (ไม่เกิด dead tuple)
// ============================================================
'use strict';

// 30 วินาที — ละเอียดกว่าเกณฑ์ออฟไลน์หลายเท่า แต่ตัดการเขียนทิ้งไปราว 95%
const TOUCH_EVERY_SEC = parseInt(process.env.CAMERA_TOUCH_EVERY_SEC || '30', 10);

/**
 * แตะ last_seen_at (และ last_event_at ถ้าขอ) เฉพาะเมื่อค่าเดิมเก่าเกินคาบ
 * ไม่ throw — ผู้เรียกทุกตัวเป็น ingest path ที่ห้ามล้มเพราะการประทับเวลา
 */
// 🔴 คาบต้องคิดแยกรายคอลัมน์ (แก้ 2026-09-12): ของเดิมกรองด้วย last_seen_at อย่างเดียว
// ⇒ พอ touch แบบไม่มี event มาก่อนภายใน 30 วิ แถวก็หลุดเงื่อนไข แล้ว last_event_at
// ไม่ถูกเขียนเลยทั้งที่ผู้เรียกขอมา · วัดของจริง: 2 จาก 169 กล้องเท่านั้นที่มีค่า
// และค่าใหม่สุดค้างอยู่ที่ 2026-08-17 ⇒ คอลัมน์นี้ตายมา 4 สัปดาห์โดยไม่มีใครรู้
//
// ต้นทุนการเขียนที่เพิ่ม: เพดานเดิม 1 ครั้ง/30 วิ/กล้อง → 2 ครั้ง/30 วิ/กล้อง
// (169 กล้อง = 11.3/วิ ในกรณีแย่สุด) ยังต่ำกว่าของเดิมก่อนใส่คาบ (25/วิ) ครึ่งหนึ่ง
const _stale = (col) => `(${col} IS NULL OR ${col} < NOW() - ($2 || ' seconds')::interval)`;

function touchCamera(pool, cameraId, { event = false } = {}) {
  if (!cameraId) return Promise.resolve();
  const sets = event
    ? 'last_seen_at = NOW(), last_event_at = NOW()'
    : 'last_seen_at = NOW()';
  const where = event
    ? `(${_stale('last_seen_at')} OR ${_stale('last_event_at')})`
    : _stale('last_seen_at');
  return pool.query(
    `UPDATE cameras SET ${sets} WHERE id = $1 AND ${where}`,
    [cameraId, String(TOUCH_EVERY_SEC)],
  ).catch(() => {});
}

module.exports = { touchCamera, TOUCH_EVERY_SEC };
