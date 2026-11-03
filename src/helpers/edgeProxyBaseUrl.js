// ============================================================
// Vigil Platform — Edge Proxy Base URL Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Per-site snapshot proxy (2026-07-15 plan, docs/superpowers/plans/
// 2026-07-15-...-per-site-snapshot-proxy). Central proxy-fetches a camera's
// snapshot from the edge site it belongs to at `<site_code>.<domain>` — the
// same Cloudflare Tunnel public hostname each site already exposes for its
// lpr-receiver (`/snapshots`, port 3003 — see docs/REF_edge-site-checklist.md).
// No URL is stored per site; it's derived from `sites.code` at request time.

/**
 * @param {string} siteCode  e.g. 'hdy', 'vss' — from sites.code
 * @param {string} domain    base domain, e.g. 'dojojin.tech'
 * @returns {string} e.g. 'https://hdy.dojojin.tech'
 */
function edgeProxyBaseUrl(siteCode, domain) {
  return `https://${siteCode}.${domain}`;
}

/**
 * URL ที่ central ใช้ดึงภาพจาก edge — ใส่ `?w=` ไปด้วยเมื่อต้องการภาพย่อ
 * เพื่อให้ **edge เป็นคนย่อ** ก่อนส่งข้ามอุโมงค์ (ของจริง 703 KB → ~25 KB ต่อภาพ
 * · หน้า Events โหลด 20 ใบพร้อมกัน = 14 MB ต่อการเปิดหน้าหนึ่งครั้ง จน timeout 8 วิ)
 * edge รุ่นเก่าที่ยังไม่รู้จัก `?w=` จะไม่พังเพราะ express.static ไม่สนใจ query string
 * — มันส่งไฟล์เต็มกลับมาเหมือนเดิม แล้ว central ย่อเองตามทางเดิม
 *
 * ⚠️ ห้ามใส่ `?w=` เมื่อจะเผากรอบ (`bbox=1`) — กรอบถูกคำนวณบนภาพเต็ม
 * @param {string} base      จาก edgeProxyBaseUrl()
 * @param {string} filename  path ใต้ /snapshots (มี `/` คั่นได้)
 * @param {number|null} w    ความกว้างที่ผ่าน thumbWidth() แล้วเท่านั้น
 */
function edgeSnapshotUrl(base, filename, w) {
  const p = encodeURIComponent(filename).replace(/%2F/g, '/');
  return `${base}/snapshots/${p}${w ? `?w=${w}` : ''}`;
}

module.exports = { edgeProxyBaseUrl, edgeSnapshotUrl };
