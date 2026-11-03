// ============================================================
// Vigil Platform — Central → Edge HTTPS call helper
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// แยกออกมาจาก src/routes/hcp.js (2026-08-10) เพราะ face-embed-worker.js
// ต้องเรียก edge แบบเดียวกันทุกประการ — ไม่อยากก็อปสำเนาเดิมที่มี gotcha
// ฝังอยู่ (agent:false, Buffer ไม่ใช่ string) ไปวางซ้ำอีกที่
// ============================================================
'use strict';

const https = require('https');
const { edgeProxyBaseUrl } = require('./edgeProxyBaseUrl');

/**
 * @param {string} site      site code เช่น 'hkt'
 * @param {string} path      เช่น '/face-engine-embed'
 * @param {object|null} payload  null = GET, อย่างอื่น = POST JSON
 * @param {number} timeoutMs
 */
function edgeCall(site, path, payload, timeoutMs = 180000) {
  const url = edgeProxyBaseUrl(site, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');
  const secret = process.env.SNAPSHOT_PROXY_SECRET || '';
  if (!secret) return Promise.reject(new Error('SNAPSHOT_PROXY_SECRET not configured'));
  const body = payload === null ? null : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    // agent:false ตั้งใจ — socket keepAlive ที่ค้างทำให้ Cloudflare ตอบ 502 ทันที
    const r = https.request(`${url}${path}`, {
      method: body === null ? 'GET' : 'POST', timeout: timeoutMs, agent: false,
      headers: { Authorization: `Bearer ${secret}`,
                 ...(body === null ? {} : { 'Content-Type': 'application/json',
                                            'Content-Length': Buffer.byteLength(body) }) },
    }, (rs) => {
      // เก็บเป็น Buffer ไม่ใช่ต่อสตริง — บางเส้นทางมีรูป JPEG วิ่งด้วย
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const buf = Buffer.concat(chunks);
        try { resolve({ code: rs.statusCode, body: JSON.parse(buf.toString('utf8')), raw: buf }); }
        catch { resolve({ code: rs.statusCode, body: { error: buf.toString('utf8').slice(0, 300) }, raw: buf }); }
      });
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('edge timeout')); });
    r.on('error', reject);
    if (body !== null) r.write(body);
    r.end();
  });
}

module.exports = { edgeCall };
