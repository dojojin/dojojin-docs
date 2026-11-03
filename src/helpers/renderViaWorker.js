// ============================================================
// Vigil Platform — เรนเดอร์รายงานผ่าน report-worker
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ปุ่มดาวน์โหลดรายงานเคยเปิด Chromium ในโปรเซส api-server เอง — เรนเดอร์หนึ่งครั้ง
// กิน RAM เป็นร้อย MB และล้มพา api-server ไปด้วยได้ · report-worker มี Chromium
// อยู่แล้วสำหรับรายงานตามตาราง จึงยืมมาใช้ (VMOD-03)
//
// ⚠️ การดาวน์โหลดด้วยมือตอนนี้ต่อคิวหลังรายงานตามตาราง เพราะ report-renderer
//    บังคับให้ _withPage ทำงานทีละหนึ่ง (report-renderer.js:215/299) · worker
//    ที่กำลังยุ่งจะไม่ตกกลับมาเรนเดอร์ในโปรเซสทันที — ต้องรอจนครบ 120 วินาที
//    แล้วค่อย timeout เข้าทาง fallback
//
// fallback ครอบ worker ตาย / ต่อไม่ติด / ตอบไม่ใช่ 2xx — ปุ่มดาวน์โหลดต้องทำงาน
// ได้แม้ worker ล่ม · ปิดสวิตช์ด้วย REPORT_RENDER_VIA_WORKER=0
'use strict';

const env = require('../config');

// ตรงกับ RENDER_FNS ใน report-worker.js — ตรวจฝั่งนี้ด้วยเพื่อไม่ยิงคำขอที่รู้ว่าจะโดนปฏิเสธ
// และเพื่อไม่ให้ fallback เรียก reportRenderer[<อะไรก็ได้>] ในโปรเซส api-server
const RENDER_FNS = new Set([
  'renderReportPdf', 'renderReportImage',
  'renderFaceReportImage', 'renderFaceReportPdf',
  'renderLprReportImage', 'renderLprReportPdf',
]);

const TIMEOUT_MS = 120000;

/**
 * @param {string} fn   ชื่อ export ของ report-renderer (ต้องอยู่ใน RENDER_FNS)
 * @param {object} args อาร์กิวเมนต์ชุดเดิมที่เคยส่งให้ renderer ตรง ๆ (ต้องเป็น JSON ล้วน)
 * @param {object} [deps] สำหรับเทสต์เท่านั้น — {fetchImpl, renderer}
 * @returns {Promise<Buffer>}
 */
async function render(fn, args, deps = {}) {
  if (!RENDER_FNS.has(fn)) throw new Error(`renderViaWorker: fn ไม่อยู่ใน allowlist: ${fn}`);
  const inProcess = () => (deps.renderer || require('../report-renderer'))[fn](args);

  const token = env.str('INTERNAL_API_SECRET');
  // ไม่มี token = ยิงไปก็โดน 401 · ไม่ต้องเสียเวลาไป-กลับ
  if (!env.bool('REPORT_RENDER_VIA_WORKER') || !token) return inProcess();

  const port = env.int('REPORT_WORKER_PORT');
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      body: JSON.stringify({ fn, args }),
      // fetch ไม่มี timeout ในตัว — ไม่ใส่ signal = ค้างได้ไม่จำกัด
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`worker ตอบ HTTP ${res.status}`);
    // arrayBuffer เท่านั้น — .text() จะทำให้ PNG/PDF เสียเงียบ ๆ แล้วยังดาวน์โหลดได้อยู่
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    // จับรวมทุกกรณี: ECONNREFUSED / timeout (DOMException ไม่มี .code) / non-2xx
    console.warn(`[renderViaWorker] ${fn} ผ่าน worker ไม่สำเร็จ (${e.message}) — เรนเดอร์ในโปรเซสแทน`);
    return inProcess();
  }
}

module.exports = { render, RENDER_FNS };
