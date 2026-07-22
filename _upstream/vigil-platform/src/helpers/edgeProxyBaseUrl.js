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

module.exports = { edgeProxyBaseUrl };
