// ============================================================
// Vigil Platform — นับผลค้นหาป้ายทะเบียนจากตารางสรุปรายชั่วโมง (lpr_hourly_stats)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่มา 2026-10-21: หน้าค้นหา LPR นับจำนวนผลด้วย count(*) จริง · ไม่ระบุช่วงเวลา = นับทั้งตาราง 67 ล้านแถว
// (8–12 วิ ต่อครั้ง · 17 ครั้งในบ่ายวันเดียว ทำให้หน้าอื่นช้าตาม)
//
// lpr_hourly_stats.n_total = count(*) ของ license_plates ต่อกล้องต่อชั่วโมง (traffic-stats-refresher.js)
// ⇒ เมื่อเงื่อนไขมีแค่ กล้อง/ไซต์/ช่วงเวลา ยอดเท่ากับ:
//      ผลรวม n_total ของชั่วโมงเต็ม [A, B)  +  นับสดเฉพาะเศษหัว (ก่อน A) และเศษท้าย (ตั้งแต่ B)
//    A = หัวชั่วโมงถัดจาก max(from, แถวเก่าสุดที่ยังอยู่) — retention ลบ license_plates กลางชั่วโมงได้
//        แต่ไม่ลบตารางสรุป ชั่วโมงแรกจึงต้องนับสดเสมอ ไม่งั้นยอดเกิน
//    B = ต้นชั่วโมงของ to หรือ (ชั่วโมงปัจจุบัน − 1 ชม.) แล้วแต่อันไหนก่อน — refresher เดินทุก 15 นาที
//        ชั่วโมงที่ยังไม่นิ่งจึงนับสด (แบบเดียวกับ noreadSplit ใน lpr-query.js)
// ข้อจำกัด: แถวที่กล้องส่งย้อนหลังเกิน ~3 ชม. เข้าตารางสรุปในรอบ reconcile ตี 5 ถัดไป — ช่วงนั้นยอดอาจขาดเล็กน้อย
//           (ข้อจำกัดเดียวกับยอด noread ของหน้า LPR ที่ใช้อยู่แล้ว)
// เงื่อนไขอื่นใด (ป้าย จังหวัด ประเภทรถ ฯลฯ) หรือมี JOIN events → คืน null ให้ผู้เรียกนับสดตามเดิม
// ============================================================
'use strict';

const H = 3600_000;
const CAM = [
  /^lp\.camera_id = \$\d+$/,
  /^lp\.camera_id = ANY\(\$\d+\)$/,
  /^lp\.camera_id IN \(SELECT id FROM cameras WHERE site_id = ANY\(\$\d+\)( AND id = ANY\(\$\d+\))?\)$/,
  /^FALSE$/,
];
const TIME = [/^lp\.detected_at >= \$\d+$/, /^lp\.detected_at <= \$\d+$/];

/**
 * @returns {{sql:string, args:any[]}|null}  null = ใช้ตารางสรุปไม่ได้ (นับสดตามเดิม)
 */
function buildRollupCount({ where, args, from, to, platesMin, hasEventFilter = false, now = Date.now() }) {
  if (hasEventFilter || !platesMin) return null;
  const cams = [];
  for (const w of where) {
    if (CAM.some((re) => re.test(w))) cams.push(w);
    else if (!TIME.some((re) => re.test(w))) return null;
  }
  const lo = Math.max(from ? Date.parse(from) : -Infinity, Date.parse(platesMin));
  const hiEdge = Math.floor(now / H) * H - H;
  const hi = to ? Math.min(Math.floor(Date.parse(to) / H) * H, hiEdge) : hiEdge;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const A = Math.ceil(lo / H) * H;
  const B = hi;
  if (A >= B) return null;                         // ไม่มีชั่วโมงเต็ม — นับสดถูกกว่า
  const all = [...args, new Date(A).toISOString(), new Date(B).toISOString()];
  const iA = all.length - 1, iB = all.length;
  const camR = cams.map((w) => w.replace(/\blp\.camera_id\b/g, 'r.camera_id'));
  const live = [...where, `(lp.detected_at < $${iA}::timestamptz OR lp.detected_at >= $${iB}::timestamptz)`];
  return {
    sql: `SELECT ((SELECT COALESCE(SUM(r.n_total), 0) FROM lpr_hourly_stats r
                    WHERE ${[...camR, `r.bucket_hour >= $${iA}::timestamptz`, `r.bucket_hour < $${iB}::timestamptz`].join(' AND ')})
                + (SELECT count(*) FROM license_plates lp WHERE ${live.join(' AND ')}))::int AS n`,
    args: all,
  };
}

module.exports = { buildRollupCount };
