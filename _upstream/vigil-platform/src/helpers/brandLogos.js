// ============================================================
// Vigil Platform — โลโก้แบรนด์สำหรับฝังลง PDF (base64)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เดิมอยู่ใน routes/traffic.js ที่เดียว พอรายงานวิเคราะห์ต้องใช้ footer แบบเดียวกัน
// (เจ้าของสั่ง 2026-08-21 "ใช้ footer ที่มีในระบบ") จึงย้ายมาไว้ตรงกลาง
//
// ⚠️ ไฟล์หายหรืออ่านไม่ได้ = คืน null ไม่โยน — PDF ต้องออกได้เสมอ ยอมไม่มีโลโก้
//    ดีกว่าปุ่มดาวน์โหลดพัง (เคสจริง: logo-partner.png ยังไม่ได้อัปโหลด)

const fs = require('fs');
const path = require('path');
const { getSystemSettings } = require('./getSystemSetting');

const BRAND_DIR = path.join(__dirname, '..', '..', 'branding');

// cache ตาม mtime — เปลี่ยนโลโก้ใน Settings แล้วเห็นผลทันทีโดยไม่ต้อง restart
const _cache = new Map();

function _readB64(file) {
  if (!file) return null;
  try {
    const fp = path.join(BRAND_DIR, file);
    const key = `${file}:${fs.statSync(fp).mtimeMs}`;
    if (!_cache.has(key)) {
      _cache.set(key, fs.readFileSync(fp).toString('base64'));
      if (_cache.size > 20) _cache.delete(_cache.keys().next().value);
    }
    return _cache.get(key);
  } catch { return null; }
}

// { header, footer } — base64 ล้วน ไม่มี prefix data: (ผู้เรียกเติมเอง)
async function brandLogos(pool) {
  try {
    const m = await getSystemSettings(pool, ['brand_logo_path', 'brand_footer_logo_path']);
    return {
      header: _readB64((m.brand_logo_path || '').trim()),
      footer: _readB64((m.brand_footer_logo_path || '').trim()),
    };
  } catch (err) {
    console.error('brandLogos:', err.message);
    return { header: null, footer: null };
  }
}

module.exports = { brandLogos, BRAND_DIR };
