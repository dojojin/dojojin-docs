// ============================================================
// Vigil Platform — Blacklist record visibility rule
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// One rule, one place. A source_record counts as live only while the source it
// came from still imports that data type, or the operator explicitly chose to
// keep it after deselecting the type.
//
// It lives here rather than being written out at each call site because the
// same shape has already bitten this project twice: the Events feed's LPR
// exclusion was applied by the fetch and ignored by the live WebSocket push, so
// the filter existed and never reached the operator's eyes. A visibility rule
// that appears in three queries will eventually mean three different things.
//
// Callers: the roster listing (/api/blacklist/master) and the alert bridge
// (helpers/blacklistBridge.js). The bridge matters most — a record that is
// hidden from the roster but still feeds lpr_watchlist would make hiding
// cosmetic while alerts kept firing on it.
//
// Correlated EXISTS rather than a JOIN so callers can drop it into a WHERE
// array without touching their FROM clause; `blacklist.sources.id` is the PK,
// so it is a single index probe per row.
// ============================================================
'use strict';

// SQL predicate. `rAlias` is whatever the caller called blacklist.source_records.
// Pass the alias you actually used — there is no default on purpose, so a
// rename cannot silently produce a predicate that references a missing table.
function visibleRecordSql(rAlias) {
  if (!rAlias || !/^[a-z_][a-z0-9_]*$/i.test(rAlias)) {
    throw new Error(`visibleRecordSql: bad alias ${JSON.stringify(rAlias)}`);
  }
  return `EXISTS (
    SELECT 1 FROM blacklist.sources _vs
     WHERE _vs.id = ${rAlias}.source_id
       AND (${rAlias}.data_type = ANY(_vs.data_types)
            OR ${rAlias}.data_type = ANY(COALESCE(_vs.kept_types, '{}')))
  )`;
}

/**
 * "record ที่ operator มองเห็นได้จริง" — ยังไม่ถูกโยนลงถังขยะ **และ** source ยัง
 * import ชนิดข้อมูลนั้นอยู่ · นิยามเดียวสำหรับทุกที่ที่ต้องนับหรือแสดง roster
 *
 * ทำไมต้องรวมสองเงื่อนไขไว้ด้วยกัน: 2026-08-27 พบว่า `/api/blacklist/master`
 * (การ์ดที่แสดงจริง) กรองทั้งสองอย่าง แต่ `/api/blacklist/stats` (badge ด้านบน
 * หน้าเดียวกัน) ไม่กรองเลย ⇒ badge ขึ้น 334 รายชื่อ ทั้งที่การ์ดมี 35 —
 * 306 record ที่เหลือถูกโยนถังไปแล้ว · นี่คือ drift แบบเดียวกับที่คอมเมนต์
 * ข้างบนเตือนไว้ทุกประการ ("a visibility rule that appears in three queries
 * will eventually mean three different things") แค่คราวนี้เป็นฝั่งนับ ไม่ใช่ฝั่งแสดง
 *
 * เขียนเป็น NOT EXISTS ไม่ใช่ LEFT JOIN โดยตั้งใจ: คิวรีที่ต้องแก้บางตัวใช้
 * COUNT(*) กับ GROUP BY อยู่ — การเพิ่ม join เข้าไปเสี่ยงทำแถวเฟ้อถ้าวันหนึ่ง
 * overrides ไม่ unique อีก (ตอนนี้ (source_id, external_id) เป็น PK) ส่วน
 * NOT EXISTS ไม่มีทางเพิ่มแถวไม่ว่าตารางจะเป็นอย่างไร
 *
 * ⚠️ ไม่ใช้กับหน้าถังขยะ (`/api/blacklist/removed`) ซึ่งต้องเห็นเฉพาะของที่ถูกตัดออก
 */
function liveRecordSql(rAlias) {
  if (!rAlias || !/^[a-z_][a-z0-9_]*$/i.test(rAlias)) {
    throw new Error(`liveRecordSql: bad alias ${JSON.stringify(rAlias)}`);
  }
  return `NOT EXISTS (
    SELECT 1 FROM blacklist.overrides _bo
     WHERE _bo.source_id = ${rAlias}.source_id
       AND _bo.external_id = ${rAlias}.external_id
       AND _bo.excluded
  ) AND ${visibleRecordSql(rAlias)}`;
}

module.exports = { visibleRecordSql, liveRecordSql };
