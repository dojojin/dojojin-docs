// ============================================================
// Vigil Platform — Face roster reference-photo lookup (single source)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// เงื่อนไข "บุคคลจาก event HCP รายนี้ ภาพอ้างอิงในคลังอยู่ที่ไหน" เคยถูกคัดลอก
// ไว้ 3 ที่ (หน้า Face Matches สองจุด + ตัวส่งการ์ด LINE) แล้วแตกแถวกันจริง:
// fallback ถูกเติมที่หน้าจอ 2026-08-18 แต่ตัวส่ง LINE ไม่ได้ → การ์ดเหลือรูปเดียว
// ทั้งที่หน้าจอโชว์ภาพอ้างอิงครบ (เจ้าของจับได้ 2026-08-29, hcp_person_id 4820)
//
// ไฟล์นี้คือชั้นเดียวของความจริง — แก้เงื่อนไขจับคู่ที่นี่ที่เดียว ทุกทางได้พร้อมกัน
// และมี test ล็อกไม่ให้ใครคัดลอกเงื่อนไขกลับไปฝังในไฟล์อื่นอีก
// (test/face-ref-single-source.test.js)
//
// สองชั้นของการค้น (ลำดับสำคัญ — mirror ก่อนเพราะพกข้อมูลคดี/หมายเหตุครบกว่า):
//   1) face_blacklist  = mirror ที่ enroll มือทีละชุด (enroll_face_blacklist_from_hcp)
//   2) blacklist.source_records ตรง ๆ ผ่าน external_id = 'face:<group>:<person>'
//      (source_id=14 — ทุกแถวที่ HCP import ใช้รูปแบบนี้ ตรวจแล้ว 100% 2026-08-18)
//      จำเป็นเพราะ mirror เป็น "บางส่วน": คนที่ HCP จับคู่ได้เอง (ไม่ต้องมี
//      embedding ฝั่งเรา) อาจไม่มีแถว mirror เลย ทั้งที่ภาพอยู่ในคลังแล้ว
'use strict';

// คู่ mirror: FROM/WHERE/ORDER สำหรับดึงแถว source_records ผ่าน face_blacklist
// ผู้เรียกเลือก SELECT list เอง (photo_path อย่างเดียว หรือคอลัมน์คดีทั้งชุด)
function mirrorPairSql(ev = 'e') {
  return `
      FROM face_blacklist bl
      JOIN blacklist.source_records sr ON sr.id::text = bl.enrolled_ref
     WHERE (bl.hcp_person_id = ${ev}.raw_json->>'hcp_person_id'
            OR bl.label      = ${ev}.raw_json->>'hcp_person_name')
       AND sr.photo_path IS NOT NULL
     ORDER BY (bl.hcp_person_id = ${ev}.raw_json->>'hcp_person_id') DESC NULLS LAST`;
}

// เงื่อนไข fallback ตรงเข้า source_records (alias ปรับได้ — ฝั่ง LINE ใช้ sr2)
function fallbackWhereSql(ev = 'e', sr = 'sr') {
  return `${sr}.source_id = 14 AND ${sr}.data_type = 'face'
       AND ${sr}.external_id = 'face:' || (${ev}.raw_json->>'hcp_group_id') || ':' || (${ev}.raw_json->>'hcp_person_id')
       AND ${sr}.photo_path IS NOT NULL`;
}

// scalar สำหรับวางใน SELECT list — mirror ก่อน แล้วค่อย fallback
function refPhotoScalarSql(ev = 'e') {
  return `COALESCE(
                 (SELECT sr.photo_path ${mirrorPairSql(ev)}
                   LIMIT 1),
                 (SELECT sr.photo_path
                    FROM blacklist.source_records sr
                   WHERE ${fallbackWhereSql(ev, 'sr')}
                   LIMIT 1)
               )`;
}

module.exports = { mirrorPairSql, fallbackWhereSql, refPhotoScalarSql };
