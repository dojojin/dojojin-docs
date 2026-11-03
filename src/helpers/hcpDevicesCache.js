// ============================================================
// Vigil Platform — แคชรายการอุปกรณ์ HCP (HC4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// วัดจริง 2026-08-12: edge sweep นิ่งที่ 6.7–7.3 วิ แต่ผ่าน URL สาธารณะจริงได้
// 9.9–16.0 วิ และแกว่งแรง · หน้าเว็บมี timeout กลาง 30 วิ (dashboard.js) จึงมีโอกาส
// ถูกตัดกลางคัน — เจ้าของเจอจริง "ถามไม่สำเร็จ: signal is aborted without reason"
// ต้นทุนมาจาก HCP เอง: กวาด 8 endpoint แบบเรียงตัว (กล้อง 756 · alarm input 1,472)
//
// ทำไม stale-while-revalidate ไม่ใช่ TTL เปล่า: TTL เปล่าแค่ย้ายการรอ 16 วิ ไปให้
// คนที่มาถึงตอนหมดอายุพอดี — คืนของเดิมทันทีแล้วดึงใหม่ข้างหลังแทน ทุกคนได้ทันที
//
// ⚠️ นี่คือ **สถานะ** อุปกรณ์ ไม่ใช่ทะเบียนนิ่ง ๆ จึงจงใจตั้ง fresh สั้น และผู้เรียก
// ต้องส่งอายุข้อมูล (`at`) ต่อให้หน้าเว็บเสมอ ไม่ปล่อยให้ดูเหมือน real-time
// ถ้าดึงใหม่ล้ม (HCP/edge ล่ม) ยังคืนของเดิมได้ แต่ `at` ค้าง = อายุไต่ขึ้นให้เห็น
// ซึ่งเป็นสัญญาณที่มองออก ไม่ใช่ค้างเงียบ (HCP ไม่โยน error — ดู ref_hcp_gotchas)
'use strict';

/**
 * @param {() => Promise<any>} fetcher  ตัวดึงของจริง (คืน body หรือ throw)
 * @param {{ freshMs?: number, onError?: (e: Error) => void }} opts
 */
function createHcpDevicesCache(fetcher, { freshMs = 60_000, onError = () => {} } = {}) {
  let entry = null;        // { body, at }
  let inflight = null;

  function load() {
    if (inflight) return inflight;   // หลายคนเปิดพร้อมกัน = กวาดรอบเดียว
    inflight = Promise.resolve()
      .then(fetcher)
      .then((body) => { entry = { body, at: Date.now() }; return entry; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  return {
    /** คืนของสด · ถ้าเก่าเกิน freshMs คืนของเดิมไปก่อนแล้วดึงใหม่ข้างหลัง */
    get() {
      if (!entry) return load();     // ครั้งแรกเท่านั้นที่ต้องรอจริง
      if (Date.now() - entry.at >= freshMs) load().catch(onError);
      return Promise.resolve(entry);
    },
    /** เติมล่วงหน้าหลังบูต — คนแรกที่เปิดแท็บจะไม่ใช่คนจ่ายค่ากวาดเต็ม ๆ */
    prewarm() { return load().catch(onError); },
  };
}

module.exports = { createHcpDevicesCache };
