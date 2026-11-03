// ============================================================
// Vigil Platform — รายการความกว้างของภาพย่อ (แหล่งเดียวของทั้ง central และ edge)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ทำไมต้องเป็นไฟล์เดียว: ค่าที่ไม่อยู่ในรายการ = เสิร์ฟภาพเต็มเงียบ ๆ ไม่ error
// (เคสจริง: หมุดบนแผนที่ขอ `?w=80` ซึ่งไม่อยู่ในรายการ ⇒ ได้ไฟล์เต็ม 741 KB ต่อหมุด)
// พอ edge ต้องย่อภาพเองด้วย ถ้าต่างฝ่ายต่างถือรายการของตัวเอง วันที่รายการไม่ตรงกัน
// central จะขอความกว้างที่ edge ไม่รู้จัก แล้วได้ภาพเต็มกลับมาโดยไม่มีใครรู้
'use strict';

const THUMB_WIDTHS = new Set([160, 240, 320, 400, 480, 640, 960, 1280, 1920, 2560]);

/** คืนความกว้างที่รับได้ หรือ null ถ้าไม่อยู่ในรายการ (ห้ามเดาค่าใกล้เคียง) */
function thumbWidth(q) {
  const n = parseInt(q, 10);
  return THUMB_WIDTHS.has(n) ? n : null;
}

module.exports = { THUMB_WIDTHS, thumbWidth };
