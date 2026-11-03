// ============================================================
// Vigil Platform — อ่าน event_dim_bucket แล้วเทียบกับกฎหมวดหมู่
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// `event_dim_bucket` เก็บ "มิติดิบ" ไม่เก็บ category_id (เหตุผลอยู่ใน migration 163)
// ไฟล์นี้คือจุดเดียวที่แปลงมิติ → หมวดหมู่ ให้ทั้ง 3 endpoint ที่เคย join event
// ทุกแถวกับตารางกฎ: /api/stats/categories · /timeline-by-category · /per-camera-counts
//
// ⚠️ เงื่อนไขการจับคู่ต้องตรงกับของเดิมเป๊ะ ไม่งั้นตัวเลขเปลี่ยนไปเงียบ ๆ ตอนสลับมาอ่าน
// ตารางสรุป — 2 จุดที่พลาดง่ายและมีเทสต์เทียบไว้แล้ว:
//
//   1) ใช้ EXISTS ไม่ใช่ JOIN — event หนึ่งอาจเข้าเงื่อนไขได้หลายกฎ "ในหมวดเดียวกัน"
//      ถ้า JOIN จะถูกนับซ้ำตามจำนวนกฎที่ตรง ของเดิมกันด้วย COUNT(DISTINCT e.id)
//      ที่นี่กันด้วย EXISTS ⇒ แถวสรุปหนึ่งแถวนับเข้าหมวดหนึ่งได้ครั้งเดียว
//
//   2) '' ในตารางสรุปคือ NULL ของเดิม — กฎที่เก็บ NULL แปลว่า "อะไรก็ได้"
//      ส่วนค่าที่เป็น NULL ฝั่ง event แปลว่า "ไม่มีค่า" ซึ่งจับคู่กับกฎที่ระบุค่าไม่ได้
//      จึงต้องเทียบ r.<col> IS NULL OR r.<col> = NULLIF(b.<col>, '')

// เทียบแถวสรุป (alias b) กับกฎ (alias r) — สะท้อนเงื่อนไขเดิมใน routes/stats.js ทีละบรรทัด
const MATCH_SQL = `
      (r.camera_id    IS NULL OR r.camera_id    = b.camera_id)
  AND (r.rule_name    IS NULL OR r.rule_name    = NULLIF(b.rule_name, ''))
  AND (r.event_type   IS NULL OR r.event_type   = NULLIF(b.event_type, ''))
  AND (r.object_class IS NULL OR r.object_class = NULLIF(b.object_class, ''))
  AND (r.vehicle_type IS NULL OR r.vehicle_type = NULLIF(b.vehicle_type, ''))
  AND (r.match_state  IS NULL OR r.match_state  = NULLIF(b.event_state, '')
       OR b.event_type = 'anprAlarm')`;

// SQL ชิ้นเดียวที่ endpoint เอาไปประกอบต่อ — คืน "แถวสรุปนี้เข้าหมวด c หรือไม่"
function categoryMatchExists(catAlias = 'c') {
  return `EXISTS (SELECT 1 FROM event_category_rules r
                   WHERE r.category_id = ${catAlias}.id AND ${MATCH_SQL})`;
}

// ⚠️ /per-camera-counts ของเดิม **ไม่ได้เทียบ vehicle_type** ต่างจากอีก 2 endpoint
// (ตรวจแล้วว่าเป็นแบบนี้มาก่อนหน้านี้ ไม่ใช่ของที่เพิ่งหาย) ตรงนี้จึงคัดลอกพฤติกรรมเดิม
// มาเป๊ะ ๆ ไม่ "แก้ให้ถูก" เอง เพราะจะทำให้ตัวเลขหน้าจอเปลี่ยนโดยไม่มีใครสั่ง
// — ในทางปฏิบัติแทบไม่ต่าง เพราะกฎที่ระบุ vehicle_type (หมวด 28–34) เป็น kind='event'
//   ซึ่งถูกกรองออกด้วย c.kind = people_counter/vehicle_counter อยู่แล้ว
const MATCH_SQL_NO_VTYPE = `
      (r.camera_id    IS NULL OR r.camera_id    = b.camera_id)
  AND (r.rule_name    IS NULL OR r.rule_name    = NULLIF(b.rule_name, ''))
  AND (r.event_type   IS NULL OR r.event_type   = NULLIF(b.event_type, ''))
  AND (r.object_class IS NULL OR r.object_class = NULLIF(b.object_class, ''))
  AND (r.match_state  IS NULL OR r.match_state  = NULLIF(b.event_state, '')
       OR b.event_type = 'anprAlarm')`;

// สำหรับ /per-camera-counts — "แถวสรุปนี้เข้ากฎของหมวดชนิด kindParam หรือไม่"
function kindMatchExists(kindParam) {
  return `EXISTS (SELECT 1 FROM event_category_rules r
                   WHERE EXISTS (SELECT 1 FROM event_categories c
                                  WHERE c.id = r.category_id AND c.kind = ${kindParam})
                     AND ${MATCH_SQL_NO_VTYPE})`;
}

// ── ขอบเขตเวลา ────────────────────────────────────────────────────────
// ตารางสรุปรู้จักเวลาเป็น "ถัง 30 นาที" เท่านั้น ถ้าเอาช่วงที่ไม่ตรงขอบถังไปถาม
// จะได้ตัวเลขไม่ตรงกับการนับ event ดิบ (ถังหัว-ท้ายถูกนับทั้งใบหรือหายทั้งใบ)
// จึงต้อง "snap" ช่วงให้ตรงขอบก่อนเสมอ: หัวปัดลง ท้ายปัดขึ้น
//   - ปัดลงที่หัว = ไม่ทำข้อมูลต้นช่วงหาย
//   - ปัดขึ้นที่ท้าย = ถังที่กำลังนับอยู่ตอนนี้ยังถูกรวม (ช้ากว่าจริง ≤5 นาทีตามรอบ
//     refresher) ถ้าปัดลงจะช้าได้ถึง 30 นาที ซึ่งเห็นชัดบน KPI "วันนี้"
const BUCKET_MS = 30 * 60 * 1000;
const snapFrom = (d) => new Date(Math.floor(d.getTime() / BUCKET_MS) * BUCKET_MS);
const snapTo   = (d) => new Date(Math.ceil (d.getTime() / BUCKET_MS) * BUCKET_MS);

// ช่วงสั้นกว่า 2 ชม. ยังอ่าน event ดิบเหมือนเดิม เพราะ:
//   1. หน้าจอวาดถัง 5 นาทีในช่วงนั้น (pickTruncUnit) — ถัง 30 นาทีตอบไม่ได้
//   2. ช่วงสั้นไม่เคยเป็นปัญหา performance อยู่แล้ว (1 ชม. ≈ 35k แถว)
// ใช้เกณฑ์เดียวกับ pickTruncUnit เพื่อไม่ให้ endpoint ต่าง ๆ ตัดสินไม่ตรงกัน
const ROLLUP_MIN_SPAN_MS = 2 * 60 * 60 * 1000;
const canUseRollup = (fromMs, toMs) => (toMs - fromMs) >= ROLLUP_MIN_SPAN_MS;

// ── กรอง "หมวดที่ผู้ใช้ติ๊กออก" ออกจากคิวรีที่นับ event รายแถว (alias e) ──
//
// ใช้กับ /breakdown-v2 และ /heatmap ซึ่งคืนค่าเป็น rule/กล้อง/ชั่วโมง ไม่ใช่รายหมวด
// จึงกรองฝั่ง client ไม่ได้ ต้องกรองที่ SQL
//
// ทำไมเป็น "ซ่อนหมวดที่ติ๊กออก" ไม่ใช่ "แสดงเฉพาะหมวดที่เลือก":
//   วัดจริง 2026-08-25 — event **9.28%** (96,764 ใน 24 ชม.) ไม่เข้าหมวดไหนเลย
//   ถ้าใช้แบบ "แสดงเฉพาะที่เลือก" ของพวกนั้นจะหายไปด้วยทั้งที่ผู้ใช้ไม่ได้สั่งซ่อน
//
// ทำไมต้องมีเงื่อนไขที่สอง (OR EXISTS ที่ไม่ได้ถูกซ่อน):
//   event เดียวเข้าได้หลายหมวด เช่น "รถจักรยานยนต์" (28) กับ "รถจักรยานยนต์ (IN)" (37)
//   ถ้าซ่อนแค่ตัวใดตัวหนึ่ง event นั้นต้องยังอยู่ เพราะยังเป็นสมาชิกของหมวดที่ยังแสดง
function hideCategoriesClause(paramRef, eventAlias = 'e') {
  const e = eventAlias;
  const preds = `
        (r.camera_id    IS NULL OR r.camera_id    = ${e}.camera_id)
    AND (r.rule_name    IS NULL OR r.rule_name    = ${e}.rule_name)
    AND (r.event_type   IS NULL OR r.event_type   = ${e}.event_type)
    AND (r.object_class IS NULL OR r.object_class = ${e}.object_class)
    AND (r.vehicle_type IS NULL OR r.vehicle_type = ${e}.vehicle_type)
    AND (r.match_state  IS NULL OR r.match_state  = ${e}.event_state
         OR ${e}.event_type = 'anprAlarm')`;
  return `(
        NOT EXISTS (SELECT 1 FROM event_category_rules r
                     WHERE r.category_id = ANY(${paramRef}) AND ${preds})
     OR EXISTS (SELECT 1 FROM event_category_rules r
                 WHERE r.category_id <> ALL(${paramRef}) AND ${preds})
  )`;
}

// ── แหล่ง "event รายแถว" ที่อ่านจากตารางสรุปได้ (รายงาน breakdown-v2 / heatmap / event-coverage) ─────────
// ถังเต็มจาก event_dim_bucket (n = จำนวน event) + เศษหัว/ท้ายที่ไม่เต็มถังนับดิบ (n = 1) ⇒ ผลเท่าการนับ event ดิบทุกช่วง
// ไม่ใช่แค่ช่วงที่ตรงขอบถัง (ต่างจาก snap ของหน้าสถิติที่ปัดขอบ) · ผู้เรียกแทน "events e" ด้วย SQL นี้ แล้วนับ SUM(e.n)
// ค่าว่างในตารางสรุปเก็บเป็น '' → แปลงกลับเป็น NULL ให้เทียบกฎหมวดได้เหมือน event ดิบ (ตรวจ 2026-10-26: ไม่มีกฎที่ใช้ '' ·
// ไม่มี event ที่ camera_id ว่าง — ตารางสรุปตัดแถวพวกนั้นทิ้ง) · event_time ของแถวสรุป = ต้นถัง (ช่วงเวลาในวันที่ตัดทีละ
// 30 นาทีจึงตรง) · ⚠️ ต้องมี reconcile ของ event_dim_bucket (category-rollup-refresher) ไม่งั้นของที่มาช้าหาย
// 📏 ตรวจคิวรีทุกหน้า 2026-10-25: รายงานเดือน breakdown 45 วิ · coverage 45.7 วิ · heatmap ชนเพดาน 120 วิ (อ่านทั้ง partition)
// ขอบของส่วนที่อ่านจากตารางสรุป [a, b):
//   a ≥ ถังแรกที่หลังจาก event ตัวเก่าสุดที่ยังอยู่ — ตารางสรุปเก็บ 400 วัน แต่ events ~100 วัน · ช่วงที่ event ถูกลบไปแล้ว
//     ทางเดิมได้ 0 ⇒ ต้องได้ 0 เหมือนเดิม (ตรวจ 2026-10-26: ตารางสรุปเริ่ม 22 มิ.ย. · event ตัวเก่าสุด 17 ก.ค.)
//   b ≤ ถังของ (now − 1 ชม.) — ถังล่าสุดที่ refresher (ทุก 5 นาที) ยังเติมไม่ทัน นับดิบแทน (แบบ heatmap แผนที่)
// ข้อจำกัด: event ที่มาถึงช้ากว่า 3 ชม. แต่ยังไม่ถึงรอบเก็บตก 05:00 ยังไม่อยู่ในตารางสรุป (เหมือน heatmap แผนที่ · GOTCHAS #237)
async function eventSource(pool, params, from, to, now = Date.now()) {
  const { rows: [{ oldest }] } = await pool.query('SELECT min(event_time) AS oldest FROM events');   // index ทุก partition ~3 ms
  const lo = oldest ? Math.max(snapTo(from).getTime(), snapTo(new Date(oldest)).getTime()) : to.getTime();
  const hi = Math.min(snapFrom(to).getTime(), snapFrom(new Date(now - 3600e3)).getTime());
  return sourceSql(params, from, to, new Date(lo), new Date(hi));
}

function sourceSql(params, from, to, a, b) {          // ถังเต็มอยู่ใน [a, b) · a ≥ b = ไม่มีถังเต็ม นับดิบทั้งช่วง
  params.push(from.toISOString(), to.toISOString(), a.toISOString(), b.toISOString());
  const [f, t, A, B] = [params.length - 3, params.length - 2, params.length - 1, params.length].map((i) => `$${i}::timestamptz`);
  return `(SELECT d.camera_id, NULLIF(d.rule_name, '') AS rule_name, NULLIF(d.event_type, '') AS event_type,
                  NULLIF(d.object_class, '') AS object_class, NULLIF(d.vehicle_type, '') AS vehicle_type,
                  NULLIF(d.event_state, '') AS event_state, d.bucket AS event_time, d.n
             FROM event_dim_bucket d WHERE d.bucket >= ${A} AND d.bucket < ${B}
           UNION ALL
           SELECT ev.camera_id, ev.rule_name, ev.event_type, ev.object_class, ev.vehicle_type, ev.event_state, ev.event_time, 1
             FROM events ev WHERE ev.event_time >= ${f} AND ev.event_time < ${t} AND (ev.event_time < ${A} OR ev.event_time >= ${B})) e`;
}

module.exports = {
  eventSource, sourceSql,
  MATCH_SQL, MATCH_SQL_NO_VTYPE, categoryMatchExists, kindMatchExists,
  hideCategoriesClause,
  BUCKET_MS, snapFrom, snapTo, canUseRollup, ROLLUP_MIN_SPAN_MS,
};
