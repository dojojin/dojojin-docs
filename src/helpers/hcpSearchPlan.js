// ============================================================
// Vigil Platform — HC2 · วางแผนการค้นใบหน้าก่อนยิง HCP
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// รูปหนึ่งใบ + ช่วงเวลา + รายชื่อกล้อง → กลายเป็น "กี่คำขอถึง HCP" ตามข้อจำกัด
// ของ HCP เอง: ครั้งละไม่เกิน 7 วัน · cameraIndexCodes ≤1024 ตัวอักษร
//
// อยู่ตรงนี้เพราะมีสองประตูเข้า — central (`routes/hcp.js`) และ edge
// (`lpr-receiver.js`) — ที่ต้องใช้ "เพดานตัวเดียวกัน" ถ้าตัวเลขอยู่คนละไฟล์
// วันหนึ่งมันจะไม่ตรงกัน แล้ว central จะปล่อยผ่านสิ่งที่ edge ปฏิเสธ
//
// ทุกข้อคืนค่า `{ error, ...ตัวเลขจริง }` — ปฏิเสธพร้อมบอกว่าเกินเท่าไหร่
// **ไม่ตัดเงียบ** เพราะผลค้นที่ถูกตัดเงียบอ่านไม่ต่างจาก "ไม่พบ"
// ============================================================
'use strict';

const MAX_RANGE_DAYS = 31;    // เพดานช่วงเวลาต่อการค้นหนึ่งครั้ง
const MAX_CALLS      = 40;    // เพดานจำนวนคำขอถึง HCP ต่อการค้นหนึ่งครั้ง
const BATCH_CHARS    = 1000;  // HCP รับ cameraIndexCodes ≤1024 ตัวอักษร — เผื่อขอบไว้
const WEEK_MS        = 7 * 86400000;
const DAY_MS         = 86400000;

// ตรวจเฉพาะช่วงเวลา — central เรียกตัวนี้ก่อนเขียน audit และก่อนข้าม tunnel
// (ตอนนั้นยังไม่รู้ว่ามีกี่กล้อง เพราะยังไม่ได้ query แมป)
function checkRange(since, until) {
  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs))
    return { error: 'รูปแบบเวลาไม่ถูกต้อง', since: String(since), until: String(until) };
  // ถ้าปล่อยผ่าน จะได้ windows = [] → ยิง HCP 0 ครั้ง → หน้าจอขึ้น "ไม่พบ"
  // ซึ่งคือ false negative ของงานสืบสวน ไม่ใช่แค่ผลว่าง
  if (untilMs <= sinceMs)
    return { error: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น', since: String(since), until: String(until) };
  const requested_days = Math.ceil((untilMs - sinceMs) / DAY_MS);
  if (requested_days > MAX_RANGE_DAYS)
    return { error: `ช่วงเวลาต้องไม่เกิน ${MAX_RANGE_DAYS} วัน`, requested_days, limit_days: MAX_RANGE_DAYS };
  return { sinceMs, untilMs };
}

// แผนเต็ม — edge เรียกตัวนี้ เพราะรู้ครบทั้งช่วงเวลาและรายชื่อกล้องแล้ว
function planHcpSearch({ since, until, cameraIndexCodes }) {
  const range = checkRange(since, until);
  if (range.error) return range;

  const camList = String(cameraIndexCodes || '').split(',').map((x) => x.trim()).filter(Boolean);
  const camBatches = [];
  let cur = [];
  for (const c of camList) {
    // `cur.length &&` กันกรณีรหัสเดียวยาวเกินเพดาน — ถ้าไม่กัน จะ push batch ว่าง
    // ออกไปหนึ่งใบ แล้วยิง HCP ด้วย cameraIndexCodes ว่าง
    if (cur.length && cur.join(',').length + c.length + 1 > BATCH_CHARS) {
      camBatches.push(cur.join(','));
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) camBatches.push(cur.join(','));
  if (!camBatches.length) return { error: 'ต้องระบุกล้องอย่างน้อยหนึ่งตัว' };

  const windows = [];
  for (let t = range.sinceMs; t < range.untilMs; t += WEEK_MS)
    windows.push([new Date(t), new Date(Math.min(t + WEEK_MS, range.untilMs))]);

  const total_calls = windows.length * camBatches.length;
  if (total_calls > MAX_CALLS)
    return {
      error: `จำนวนการเรียก HCP รวมต้องไม่เกิน ${MAX_CALLS}`,
      windows: windows.length, camera_batches: camBatches.length,
      total_calls, limit_calls: MAX_CALLS,
    };

  return { windows, camBatches };
}

module.exports = { checkRange, planHcpSearch, MAX_RANGE_DAYS, MAX_CALLS, BATCH_CHARS };
