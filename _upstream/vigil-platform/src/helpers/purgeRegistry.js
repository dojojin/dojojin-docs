// ============================================================
// Vigil Platform — Helper: edge storage purge registry
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ที่พักผลของคำสั่งลบไฟล์บน edge (2026-08-24) โครงเดียวกับ scanRegistry:
// route ลงทะเบียน reqId แล้ว publish คำสั่ง · LISTEN handler ใน api-server
// (ป้อนโดย pg_notify('storage_purge_result') จาก mqtt-subscriber) มา resolve
// ทั้งสองอยู่ใน process เดียวกัน Map ระดับโมดูลจึงพอ ไม่ต้องมีแถวใน DB
// สำหรับ handshake ที่มีอายุไม่ถึงนาที
//
// TTL สั้นกว่า scanRegistry เพราะนี่คือคำสั่งทำลาย ผลที่ค้างอยู่นานเกินจำเป็น
// คือโอกาสที่คนจะกดยืนยันจากตัวเลขที่เก่าไปแล้ว
'use strict';

const _reqs = new Map(); // reqId → { status, data?, error?, at }
const TTL_MS = 90 * 1000;

function register(reqId) { _reqs.set(reqId, { status: 'pending', at: Date.now() }); }

function resolve(reqId, data) {
  const e = _reqs.get(reqId);
  if (!e) return;                       // ตอบมาช้าเกิน TTL หรือไม่รู้จัก — ทิ้ง
  if (data && data.error) { e.status = 'error'; e.error = String(data.error); e.data = data; }
  else { e.status = 'ready'; e.data = data; }
  e.at = Date.now();
}

function get(reqId) {
  const e = _reqs.get(reqId);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { _reqs.delete(reqId); return null; }
  return e;
}

// ผลของคำสั่งทำลายใช้ได้ครั้งเดียว — อ่านแล้วทิ้ง กันคนถือ reqId เดิมมายืนยันซ้ำ
function take(reqId) {
  const e = get(reqId);
  if (e) _reqs.delete(reqId);
  return e;
}

function _sweep() {
  const now = Date.now();
  for (const [id, e] of _reqs) if (now - e.at > TTL_MS) _reqs.delete(id);
}
setInterval(_sweep, TTL_MS).unref();

module.exports = { register, resolve, get, take };
