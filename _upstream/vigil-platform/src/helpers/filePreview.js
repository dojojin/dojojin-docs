// ============================================================
// Vigil Platform — ภาพพรีวิว (Open Graph) ของไฟล์ที่แชร์ผ่าน upl.dojojin.tech
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// เจ้าของสั่ง 2026-10-17: ลิงก์ที่โพสต์ลง Social ต้องมีภาพพรีวิว
// • HTML → ถ่ายหน้าจอ 1200×630 ด้วย headless Chrome อัตโนมัติ
// • ไฟล์ชนิดอื่น → แอดมินอัปภาพเอง (ย่อ/ครอปเป็น 1200×630 ด้วย sharp)
// 🔴 หน้า HTML ที่ถ่ายรันใน Chrome บนเครื่อง central — สคริปต์ในหน้า (ไฟล์ allow_scripts) จะยิง localhost / LAN ได้
//    ถ้าไม่กั้น · จึงดักทุก request: ให้ผ่านแค่ตัวไฟล์เอง + data: + Google Fonts · อย่างอื่น abort หมด
//    ไฟล์ที่ไม่ได้ติ๊กสคริปต์ ปิด JavaScript ไปเลย (เหมือนตอนเสิร์ฟจริง)

const W = 1200, H = 630;
const ALLOWED = /^(data:|https:\/\/fonts\.googleapis\.com\/|https:\/\/fonts\.gstatic\.com\/)/;

async function screenshotHtml(filePath, allowScripts) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setJavaScriptEnabled(!!allowScripts);
    const self = 'file://' + filePath;
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u === self || ALLOWED.test(u)) r.continue(); else r.abort();
    });
    await page.goto(self, { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));        // ให้กราฟ/ฟอนต์วาดเสร็จ
    return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ภาพที่แอดมินอัป → 1200×630 PNG (ครอปกลาง) · ตรวจ magic bytes ก่อนเรียก
async function normalizeImage(buf) {
  return require('sharp')(buf).resize(W, H, { fit: 'cover', position: 'centre' }).png().toBuffer();
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ogTags({ title, description, image, url }) {
  const t = [
    ['og:type', 'website'], ['og:title', title], ['og:description', description],
    ['og:url', url], ['og:image', image], ['og:image:width', image ? String(W) : null], ['og:image:height', image ? String(H) : null],
  ].filter(([, v]) => v).map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`);
  t.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`);
  if (title) t.push(`<meta name="twitter:title" content="${esc(title)}">`);
  if (description) t.push(`<meta name="twitter:description" content="${esc(description)}">`);
  if (image) t.push(`<meta name="twitter:image" content="${esc(image)}">`);
  return t.join('\n');
}

// ใส่แท็กต่อจาก <head> (ถ้าไม่มี <head> ใส่ไว้หน้าสุด) · ไม่แตะแท็ก og เดิมในไฟล์ — ตัวที่มาก่อนชนะในแพลตฟอร์มส่วนใหญ่
function injectOg(html, tags) {
  const s = String(html);
  const m = s.match(/<head[^>]*>/i);
  return m ? s.slice(0, m.index + m[0].length) + '\n' + tags + '\n' + s.slice(m.index + m[0].length) : tags + '\n' + s;
}

// หน้าเล็กสำหรับตัวดึงพรีวิวของ Social เมื่อไฟล์ไม่ใช่ HTML (PDF/DOCX/XLSX/รูป เปิดเป็นดาวน์โหลด ใส่แท็กไม่ได้)
function landingHtml({ title, description, image, url }) {
  return `<!doctype html><html><head><meta charset="utf-8">\n${ogTags({ title, description, image, url })}\n<title>${esc(title)}</title></head>` +
    `<body><p>${esc(title)}</p>${description ? `<p>${esc(description)}</p>` : ''}</body></html>`;
}

module.exports = { screenshotHtml, normalizeImage, ogTags, injectOg, landingHtml, W, H };
