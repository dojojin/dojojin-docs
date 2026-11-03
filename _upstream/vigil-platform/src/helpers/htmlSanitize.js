// ============================================================
// Vigil Platform — HTML sanitizer for public file uploads
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ที่มา 2026-09-24: เจ้าของขอให้ /api/files (public file host เดิม) รองรับ HTML
// แบบ "เปิดเป็นหน้าเว็บทันทีเมื่อกดลิงก์" (ไม่ใช่บังคับดาวน์โหลดเหมือนไฟล์อื่น) —
// นี่คือจุดที่ต่างจาก PDF/DOCX/XLSX เดิมโดยพื้นฐาน: ไฟล์อื่นถูกบังคับ
// `Content-Disposition: attachment` เสมอ (ดู routes/media-files.js) จึงไม่เคยถูก
// เบราว์เซอร์ตีความเป็นหน้าเว็บ ณ โดเมนของเรา — HTML ที่ต้อง "เปิดแล้วรัน" คือของ
// ที่เบราว์เซอร์ตีความและรันจริง ต้อง sanitize ก่อนเก็บเสมอ ไม่ใช่แค่ตรวจ magic bytes
//
// เหตุผลที่ใช้ไลบรารีแทนเขียนเอง: HTML parsing edge case (nested encoding, tag
// soup, mutation XSS) เป็นคลาสบั๊กที่ regex เขียนเองจับไม่ครบเกือบเสมอ — OWASP
// เตือนตรงๆ ว่าอย่าเขียน HTML sanitizer เอง `sanitize-html` (2.17.7) เป็นไลบรารีที่
// ใช้กันแพร่หลายสำหรับงานนี้ฝั่ง Node โดยเฉพาะ ไม่ต้องพึ่ง jsdom เหมือน DOMPurify
//
// กันสองชั้น ไม่ใช่ชั้นเดียว — sanitize ที่นี่ (ชั้นแรก) + CSP ตอนเสิร์ฟใน
// media-files.js (ชั้นสอง, กัน "เผื่อ sanitizer มีรูรั่วที่ไม่รู้") · โดเมนแยก
// ไม่มี session cookie ยังคงอยู่เหมือนไฟล์ประเภทอื่น (ชั้นที่สาม, กันความเสียหาย
// สูงสุดคือขโมย session ต่อให้สองชั้นแรกรั่วพร้อมกัน)
'use strict';

const sanitizeHtml = require('sanitize-html');

// ── ขยายนโยบาย 2026-09-24 (เจ้าของเลือก) ─────────────────────────────────
// เวอร์ชันแรกตัด <svg>, <style>, <link> ทิ้งหมด แล้วเอกสารที่ต้องการแชร์จริง
// (แผนผังระบบ NRW/HKT ที่เราทำเอง) หายทั้งภาพ — 35 KB เหลือ 18 KB ไม่มีแผนผัง
// ไม่มีสไตล์ · ฟีเจอร์ที่ใช้งานจริงไม่ได้ไม่ได้ปลอดภัยกว่า มันแค่ไม่มีใครใช้
//
// ที่เปิดเพิ่ม: แท็กวาดรูปของ SVG · <style> · <link> ไปยัง Google Fonts เท่านั้น
// ที่ยังตัดเหมือนเดิม: script · on*= ทุกตัว · javascript:/data: ใน href ·
// iframe/object/embed/form/base/meta · และใน SVG: use/image/foreignObject/animate/set
// (ช่องทางดึงของนอก/ฝัง HTML/เปลี่ยน attribute ตอนรันไทม์)
//
// ทำไม <style> ไม่อันตรายอย่างที่ไลบรารีเตือนในบริบทนี้: คำเตือนนั้นคือ CSS
// ขโมยข้อมูลจากหน้าเดียวกัน (selector + url()) — หน้านี้ไม่มีความลับให้ขโมย
// (โดเมนแยก ไม่มี cookie ไม่มีฟอร์ม) และ url() ไป https ทำได้ด้วย <img> อยู่แล้ว
// ชั้นที่กัน JS จริง ๆ คือ CSP `sandbox` + ไม่มี script-src ตอนเสิร์ฟ
// (routes/media-files.js) ไม่ใช่ตัวกรองนี้ — ตัวนี้คือชั้นแรกของสองชั้น
const SVG_TAGS = [
  'svg', 'g', 'defs', 'marker', 'symbol', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'desc',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'pattern',
];
// ชื่อ attribute ตัวเล็กหมด: parser ของไลบรารีแปลงเป็นตัวเล็ก (viewBox → viewbox)
// แล้วเบราว์เซอร์คืนตัวพิมพ์ให้เองตอน parse SVG ใน HTML — ไม่ต้องจัดการเอง
const SVG_ATTRS = [
  'xmlns', 'viewbox', 'preserveaspectratio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight',
  'markerunits', 'refx', 'refy', 'orient', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'clip-path', 'clippathunits', 'patternunits',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'font-family',
  'letter-spacing', 'role', 'aria-label', 'aria-hidden',
];
const FONT_CSS = /^https:\/\/fonts\.googleapis\.com\//;

const OPTIONS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'link', 'title'], SVG_TAGS),
  // ไลบรารีไม่ยอมเปิด <style> ถ้าไม่ยืนยันตรงนี้ — เหตุผลอยู่ในหัวข้อด้านบน
  allowVulnerableTags: true,
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    // style="" ไม่กรองราย property แล้ว: เมื่อ <style> ผ่านได้ การกรอง attribute
    // ไม่กันอะไรเพิ่ม แค่ทำให้เลย์เอาต์พัง (flex/grid ถูกตัดทิ้ง)
    '*': ['style', 'class', 'id', 'lang', 'dir', 'title'],
    a: ['href', 'name', 'target', 'title', 'rel'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    table: ['border', 'cellpadding', 'cellspacing'],
    td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'],
    link: ['rel', 'href'],
    ...Object.fromEntries(SVG_TAGS.map(t => [t, SVG_ATTRS])),
  },
  // href/src ห้ามเป็น javascript:/data:(นอก img)
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'], link: ['https'] },
  // <link> รอดเฉพาะ stylesheet ของ Google Fonts — ที่อื่นทั้งหมดทิ้ง (CSP ก็บล็อก
  // ซ้ำอีกชั้น แต่ไม่เก็บของที่รู้อยู่แล้วว่าจะโหลดไม่ขึ้นไว้ในไฟล์)
  exclusiveFilter: (f) => f.tag === 'link' &&
    !(f.attribs.rel === 'stylesheet' && FONT_CSS.test(f.attribs.href || '')),
  // ลิงก์ออกทุกอันบังคับ noopener/noreferrer กัน tabnabbing
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
  },
};

/**
 * Sanitize HTML ก่อนเก็บลงดิสก์ — เรียกครั้งเดียวตอนอัปโหลด ไม่ใช่ทุกครั้งที่เสิร์ฟ
 * (ผลลัพธ์ที่เก็บคือสิ่งที่ถูกเสิร์ฟจริงเสมอ sha256 จึงตรงกับไฟล์บนดิสก์)
 * @param {Buffer|string} input
 * @returns {string} HTML ที่ sanitize แล้ว เป็น UTF-8 text เสมอ
 */
function sanitizeUploadedHtml(input) {
  const raw = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  return sanitizeHtml(raw, OPTIONS);
}

module.exports = { sanitizeUploadedHtml };
