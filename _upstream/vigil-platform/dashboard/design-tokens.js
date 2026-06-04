// ============================================================
// DojoJin Tech Dashboard — Design Token Helper (Layer 2)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Reads CSS custom properties at runtime so Chart.js and OpenLayers
// (which cannot read CSS vars directly) stay in sync with the token
// system. Part of the tri-layer token design (decision #145, Phase 0).
//
// Usage (Chart.js):
//   import { token } from './design-tokens.js';
//   borderColor: token('--accent')
//
// Usage (OpenLayers):
//   new ol.style.Fill({ color: token('--status-ok') })
// ============================================================

const _tokenCache = {};
let _tokenCacheValid = false;

export function token(name) {
  if (!_tokenCacheValid) {
    _tokenCache[name] = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
  }
  return _tokenCache[name] ||
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Call when theme changes (white-label override) to bust the cache
export function clearTokenCache() {
  for (const k in _tokenCache) delete _tokenCache[k];
  _tokenCacheValid = false;
}
