// ============================================================
// Vigil Platform — เดินหน้ารายการของ HCP
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// รันบน **edge ที่ต่อ HCP ได้เท่านั้น** (central ไปไม่ถึง 10.0.10.9)
//
// ⚠️ **`data.total` ของ HCP ไม่ได้แปลว่าเดียวกันทุกเส้น** (วัดจริง 2026-08-08):
//   `frs/v1/face`         → total = จำนวนทั้งคลัง (ขอ pageSize 1 ก็ยังได้ 65)
//   `vehicle/vehicleList` → total = **จำนวนแถวในหน้านี้** (pageSize 1 ได้ 1 · 5 ได้ 5)
// ⇒ ใช้ `total` เป็นเงื่อนไขหยุดวนหน้าไม่ได้ · ถ้าใช้ วันที่ข้อมูลเกินหนึ่งหน้าจะได้
// หน้าแรกหน้าเดียวแล้วหยุด **โดยไม่มี error** · เงื่อนไขที่เชื่อได้ทุกเส้นคือ
// "หน้าไหนได้น้อยกว่า pageSize = หน้าสุดท้าย"
// ============================================================
'use strict';

const HCP_PAGE = 500;         // 1000 ถูกปฏิเสธบางเส้น (บทเรียนจาก HC1)
const HCP_MAX_PAGES = 200;    // กันวนไม่รู้จบถ้า HCP ตอบเพี้ยน (= 100,000 แถว)

// HCP ตอบ HTTP 200 เสมอ — สถานะจริงอยู่ที่ body.code และเป็น **สตริง**
async function hcpCall(path, body) {
  const hcp = require('../hcp-client');
  await hcp.init();
  const r = await hcp.call('POST', path, body, {});
  const b = r.body || {};
  if (String(b.code) !== '0') throw new Error(`${path} code=${b.code} ${b.msg || ''}`);
  return b.data || {};
}

async function hcpPageAll(path, body, onRow) {
  let page = 1, reported = null, got = 0, truncated = false;
  for (;;) {
    const d = await hcpCall(path, { ...body, pageNo: page, pageSize: HCP_PAGE });
    const list = d.list || [];
    if (reported === null) reported = Number(d.total) || 0;
    list.forEach(onRow);
    got += list.length;
    if (list.length < HCP_PAGE) break;
    if (++page > HCP_MAX_PAGES) { truncated = true; break; }
  }
  return { got, reported, truncated };
}

module.exports = { hcpCall, hcpPageAll, HCP_PAGE, HCP_MAX_PAGES };
