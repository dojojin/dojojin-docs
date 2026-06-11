// ============================================================
// Vigil Platform — Theme Init (CSP-safe: no inline script)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Runs before CSS loads to apply stored theme — prevents flash.
// Kept minimal on purpose: must not depend on any other module.
(function () {
  var t = localStorage.getItem('dashboard_theme');
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
}());
