// ============================================================
// Vigil Platform — partial index ของหน้าเหตุการณ์ (idx_events_page_time, migration 264)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// หน้าเหตุการณ์ตัดป้ายทะเบียน/ใบหน้าออก (มีหน้าของตัวเอง) = 97.6% ของแถว (1,036,426 → 24,728 ต่อ 24 ชม.
// วัด 2026-10-16) · ตัวกรองแบบ "ตัดออก" (<> ALL, NOT LIKE) ใช้ index ธรรมดาไม่ได้ จึงต้องอ่านทั้งล้านแถว
// → partial index เฉพาะแถวที่หน้านี้แสดง · planner ใช้ได้ต่อเมื่อ WHERE มีเงื่อนไข "ตัวอักษรเดียวกัน" กับ
// predicate ของ index (ค่าคงที่ ไม่ใช่ $n) — ห้ามแก้รายการนี้โดยไม่สร้าง index ใหม่ให้ตรง
// (test/events-page-index.test.js เทียบกับไฟล์ migration)
const EXCLUDED = ['anprAlarm', 'FaceRecognition', 'FaceCapture', 'FaceDetector/Recognized', 'FaceDetector/Comparison'];

/** เงื่อนไขที่ต้องต่อท้าย WHERE เพื่อให้ planner เลือก idx_events_page_time ได้ */
const pageIndexSql = (alias = 'e') => `${alias}.event_type <> ALL ('{${EXCLUDED.join(',')}}'::text[])`;

/** ผู้เรียกขอตัดออกครบทุกตัวในรายการ index ไหม (ถ้าไม่ครบ ใส่เงื่อนไขนี้จะตัดแถวที่ผู้เรียกต้องการทิ้ง) */
const coversPageIndex = (excludeList) => EXCLUDED.every((t) => excludeList.includes(t));

module.exports = { EXCLUDED, pageIndexSql, coversPageIndex };
