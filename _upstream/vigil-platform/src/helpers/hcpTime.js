// ============================================================
// Vigil Platform — HCP time format
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// HCP รับเวลาแบบ ISO-8601 **ไม่มีมิลลิวินาที** และต้องเป็นเวลากรุงเทพจริง —
// เอา UTC ไปแปะ `+07:00` เฉย ๆ = หน้าต่างเลื่อน 7 ชั่วโมงโดยไม่มี error
// (พลาดมาแล้วตอน HC1 backfill · ผลที่ได้คือ "วันนั้นเงียบ" ซึ่งอ่านเหมือนจริง)
// ============================================================
'use strict';

const hcpTime = (d) =>
  new Date(d.getTime() + 7 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '') + '+07:00';

module.exports = { hcpTime };
