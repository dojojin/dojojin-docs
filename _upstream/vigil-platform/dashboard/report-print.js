// ============================================================
// Vigil Platform — Report Print Render Script (CSP-safe: externalised from report-print.html)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Puppeteer-only render target — not for human navigation.
// Reads URL params, fetches stats data, and calls ReportTemplate to build
// the report HTML.  Sets window.__reportReady=true when done (or on error)
// so the Puppeteer caller knows when to snapshot.

(async () => {
  const p = new URLSearchParams(location.search);
  const from    = p.get('from');
  const to      = p.get('to');
  const title   = p.get('title') || I18N.t('rep.summaryTitle');
  const label   = p.get('label') || '';
  const cameras = p.get('cameras') || '';   // CSV; empty = all
  let q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  if (cameras) q += `&cameras=${encodeURIComponent(cameras)}`;

  const get = async (path) => {
    try { const r = await fetch(path); return r.ok ? await r.json() : null; }
    catch { return null; }
  };

  const [cats, tl, brk, ppl, veh, heat, top, quiet, branding] = await Promise.all([
    get(`/api/stats/categories?${q}`),
    get(`/api/stats/timeline-by-category?${q}`),
    get(`/api/stats/breakdown-v2?${q}`),
    get(`/api/stats/per-camera-counts?kind=people&${q}`),
    get(`/api/stats/per-camera-counts?kind=vehicle&${q}`),
    get(`/api/stats/heatmap?${q}`),
    get(`/api/stats/top-rules?${q}&limit=10`),
    get(`/api/stats/quiet-cameras?since_hours=24`),
    get(`/api/branding`),
  ]);

  const reportData = { range: { label }, title, cats, tl, brk, ppl, veh, heat, top, quiet };
  // /api/branding already returns { name, tagline, logo_url, primary_color }
  // in the exact shape report-template.js expects — pass through directly.
  const brand = branding || {};

  document.getElementById('root').innerHTML = ReportTemplate.buildReportHtml(reportData, brand);
  const t = ReportTemplate.computeTrendPoints(reportData);
  if (t.points.length) ReportTemplate.renderReportTrendChart('reportTrendChart', t.points, t.trunc);

  // Wait for every <img> in the rendered report (logo, future thumbnails)
  // to finish loading — page.pdf/screenshot snapshots whatever's there,
  // so an unloaded image would render blank.
  await Promise.all([...document.querySelectorAll('#root img')].map(img =>
    img.complete && img.naturalWidth > 0
      ? null
      : new Promise(resolve => { img.onload = img.onerror = resolve; })
  ));
  // Then a brief settle for Chart.js (animation:false → two frames is enough).
  await new Promise(r => setTimeout(r, 200));
  window.__reportReady = true;
})().catch(e => {
  document.getElementById('root').innerHTML =
    '<p style="color:#c00;padding:40px">report render failed: ' + (e && e.message) + '</p>';
  window.__reportReady = true;   // unblock Puppeteer so it captures the error
});
