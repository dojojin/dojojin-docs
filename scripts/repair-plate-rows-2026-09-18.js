#!/usr/bin/env node
// ============================================================
// Vigil Platform — กู้แถวป้ายที่หายช่วง deploy ผิดพลาด 18 ก.ย. 2026 02:00-02:08
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เกิดอะไรขึ้น: ตอน deploy การตรึงผล "พร้อมข้อมูลทะเบียน" (migration 234) รอบแรก
// นิพจน์ stamp ใช้พารามิเตอร์ร่วมกับคอลัมน์อื่นใน INSERT เดียวกัน ($2/$4) ทำให้
// Postgres ตอบ "inconsistent types deduced for parameter $2" และ **ล้มทั้งคำสั่ง**
// แถว license_plates จึงไม่ถูกเขียนเลย 8 นาที (แถว events ยังเขียนปกติเพราะเป็น
// คนละคำสั่ง) วัดจริง: สัดส่วน event ที่ไม่มีแถวป้ายพุ่งจาก 2% เป็น 85.6% แล้ว
// กลับมา 0% หลังแก้
//
// สคริปต์นี้สร้างแถวที่หายขึ้นใหม่จาก events.raw_json ที่ยังอยู่ครบ โดยใช้
// **parser ตัวเดียวกับ production** ไม่ได้เขียนสูตรแยก:
//   Hikvision → parseAnprXml(raw_json.rawXml)               (lpr-core.js)
//   Dahua     → parseDahuaTrafficJunction(raw_json.data, …) (dahua-protocol.js)
// แถวที่ parser คืน null (ต้นทางอ่านป้ายไม่ออก เช่น Object.Text ว่าง) จะถูกข้าม
// ไม่สร้างแถวปลอมขึ้นมา
//
// ข้อจำกัดที่ยอมรับ: plate_image เป็น null ทุกแถว — ไฟล์ครอปป้ายบนดิสก์จับคู่กลับ
// ไม่ได้เพราะชื่อไฟล์ถูกตั้งตอน insert ที่ล้มไป · ตัวเลขสถิติไม่ได้ใช้คอลัมน์นี้
//
// idempotent — แตะเฉพาะ event ที่ยังไม่มีแถวป้าย รันซ้ำได้
//
//   set -a; . ./src/.env; set +a
//   node scripts/repair-plate-rows-2026-09-18.js            # ดูว่าจะกู้ได้กี่แถว
//   node scripts/repair-plate-rows-2026-09-18.js --apply
// ============================================================
'use strict';

const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'node_modules', 'dotenv')).config({ path: path.join(SRC, '.env') });
const { Pool } = require(path.join(SRC, 'node_modules', 'pg'));
const helmet = require(path.join(SRC, 'helpers', 'helmetCriteria'));
const { plateTypeFromColorName } = require(path.join(SRC, 'helpers', 'plateType'));
const { xyzToColorName } = require(path.join(SRC, 'color-utils'));
const { parseAnprXml } = require(path.join(SRC, 'lpr-core'));
const { parseDahuaTrafficJunction } = require(path.join(SRC, 'ingesters', 'dahua-protocol'));

const APPLY = process.argv.includes('--apply');
const FROM  = '2026-09-18 02:00:00+07';
const TO    = '2026-09-18 02:09:00+07';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// raw_json → รูปแบบกลางที่ตรงกับคอลัมน์ license_plates (null = ไม่มีข้อมูลป้าย)
function normalize(rawJson) {
  const rj = rawJson || {};
  if (typeof rj.rawXml === 'string' && rj.rawXml.length > 50) {
    const p = parseAnprXml(rj.rawXml);
    if (!p || !p.plate) return null;
    return {
      ...p,
      plateType: plateTypeFromColorName(p.plateColor),
      noHelmet: p.helmet === 'no',
      pillion: p.nonMotorManned ?? null,
      riderCount: null,
    };
  }
  if (rj.data && rj.data.Code === 'TrafficJunction') {
    const d = parseDahuaTrafficJunction(rj.data, xyzToColorName);
    if (!d) return null;
    return {
      ...d,
      noHelmet: d.helmet === 'no',
      pillion: d.nonMotorManned ?? null,
      plateCharBelieve: null,
      licenseBright: null,
    };
  }
  return null;
}

const SQL = `INSERT INTO license_plates
    (event_id, camera_id, plate_number, confidence, country, region,
     vehicle_type, vehicle_color, vehicle_brand, plate_type,
     bbox_x, bbox_y, bbox_width, bbox_height,
     vehicle_bbox_x, vehicle_bbox_y, vehicle_bbox_width, vehicle_bbox_height,
     plate_color, no_helmet, plate_char_believe, license_bright,
     lane_no, pillion, no_seatbelt, rider_count, detected_at, plate_identified)
  SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26,$27,
         ${helmet.stampSql('$28', '$29', '$30')}
   WHERE NOT EXISTS (SELECT 1 FROM license_plates x WHERE x.event_id = $1)`;

const paramsFor = (e, p) => [
  e.id, e.camera_id, p.plate, p.confidence ?? null, p.country ?? null, p.region ?? null,
  p.vehicleType ?? null, p.vehicleColor ?? null, p.vehicleBrand ?? null, p.plateType ?? null,
  p.bbox?.x ?? null, p.bbox?.y ?? null, p.bbox?.width ?? null, p.bbox?.height ?? null,
  p.vehicleBbox?.x ?? null, p.vehicleBbox?.y ?? null, p.vehicleBbox?.width ?? null, p.vehicleBbox?.height ?? null,
  p.plateColor ?? null, p.noHelmet, p.plateCharBelieve ?? null, p.licenseBright ?? null,
  p.laneNo != null ? String(p.laneNo) : null, p.pillion, p.noSeatbelt ?? false,
  p.riderCount ?? null, e.event_time,
  // $28-$30 — ค่าสำหรับตรึงผล "พร้อมข้อมูลทะเบียน" (ดูหมายเหตุที่ stampSql)
  helmet.plateMatches(p.plate), p.confidence ?? null, e.camera_id,
];

(async () => {
  const { rows } = await pool.query(
    `SELECT e.id, e.camera_id, e.event_time, e.raw_json
       FROM events e
      WHERE e.event_type = 'anprAlarm'
        AND e.event_time >= $1::timestamptz AND e.event_time < $2::timestamptz
        AND NOT EXISTS (SELECT 1 FROM license_plates lp WHERE lp.event_id = e.id)
      ORDER BY e.id`, [FROM, TO]);
  console.log(`event ที่ยังไม่มีแถวป้ายในช่วง ${FROM} ถึง ${TO}: ${rows.length}`);

  const plan = [];
  let noPlate = 0;
  for (const e of rows) {
    const p = normalize(e.raw_json);
    if (p) plan.push({ e, p }); else noPlate++;
  }
  const bySite = {};
  for (const { e } of plan) {
    const k = String(e.camera_id).split(/[-_]/)[0];
    bySite[k] = (bySite[k] || 0) + 1;
  }
  console.log(`กู้ได้ ${plan.length} แถว · ข้าม ${noPlate} (ต้นทางไม่มีข้อมูลป้ายให้กู้)`);
  console.log('แยกตามกล้อง:', JSON.stringify(bySite));
  if (!APPLY) { console.log('\nโหมดดูอย่างเดียว — ใส่ --apply เมื่อพร้อม'); await pool.end(); return; }

  let ok = 0, fail = 0;
  for (const { e, p } of plan) {
    try { await pool.query(SQL, paramsFor(e, p)); ok++; }
    catch (err) { if (++fail <= 3) console.error(`  event ${e.id}: ${err.message}`); }
  }
  console.log(`เขียนสำเร็จ ${ok} แถว · ล้มเหลว ${fail}`);
  await pool.end();
})().catch((e) => { console.error('ล้มเหลว:', e.message); process.exit(1); });
