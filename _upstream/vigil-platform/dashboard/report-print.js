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
  const p       = new URLSearchParams(location.search);
  const from    = p.get('from');
  const to      = p.get('to');
  const title   = p.get('title') || I18N.t('rep.summaryTitle');
  const label   = p.get('label') || '';
  const cameras = p.get('cameras') || '';
  const domains = new Set((p.get('domains') || 'events').split(','));
  const site_id = p.get('site_id') || '';

  let q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  if (cameras) q += `&cameras=${encodeURIComponent(cameras)}`;
  const siteQ = site_id ? `&site_id=${encodeURIComponent(site_id)}` : '';

  const get = async (path) => {
    try { const r = await fetch(path); return r.ok ? await r.json() : null; }
    catch { return null; }
  };

  const [cats, tl, brk, ppl, veh, heat, top, quiet, branding, cov, ev, faceData, lprData, personData] = await Promise.all([
    domains.has('events') ? get(`/api/stats/categories?${q}${siteQ}`)                          : null,
    domains.has('events') ? get(`/api/stats/timeline-by-category?${q}${siteQ}`)                : null,
    domains.has('events') ? get(`/api/stats/breakdown-v2?${q}${siteQ}`)                        : null,
    domains.has('events') ? get(`/api/stats/per-camera-counts?kind=people&${q}${siteQ}`)       : null,
    domains.has('events') ? get(`/api/stats/per-camera-counts?kind=vehicle&${q}${siteQ}`)      : null,
    domains.has('events') ? get(`/api/stats/heatmap?${q}${siteQ}&domains=${[...domains].join(',')}`) : null,
    domains.has('events') ? get(`/api/stats/top-rules?${q}${siteQ}&limit=10`)                  : null,
    domains.has('events') ? get(`/api/stats/quiet-cameras?since_hours=24${siteQ}`)              : null,
    get(`/api/branding`),
    domains.has('events') ? get(`/api/stats/event-coverage?${q}${siteQ}`)                      : null,
    domains.has('events') ? get(`/api/stats/evidence?${q}${siteQ}`)                            : null,
    domains.has('face')   ? get(`/api/stats/face/report?period=custom&${q}&min_score=80${siteQ}`) : null,
    domains.has('lpr')    ? get(`/api/stats/lpr/report?period=custom&${q}${siteQ}`)    : null,
    domains.has('person') ? get(`/api/appearances/stats?${q}${siteQ}`)                 : null,
  ]);

  const brand = branding || {};
  document.documentElement.style.setProperty('--accent', brand.primary_color || '#5b8def');
  const root  = document.getElementById('root');

  if (domains.has('events')) {
    const reportData = { range: { label }, title, cats, tl, brk, ppl, veh, heat, top, quiet, cov, ev };
    root.innerHTML = ReportTemplate.buildReportHtml(reportData, brand);
    const t = ReportTemplate.computeTrendPoints(reportData);
    if (t.points.length) ReportTemplate.renderReportTrendChart('reportTrendChart', t.points, t.trunc, brand.primary_color);
    ReportTemplate.renderCategoryChart('reportCategoryChart', (cats && cats.categories) || []);
  } else {
    root.innerHTML = '';
  }

  if (faceData)   root.insertAdjacentHTML('beforeend', ReportTemplate.buildFaceSection(faceData));
  if (lprData)    root.insertAdjacentHTML('beforeend', ReportTemplate.buildLprSection(lprData));
  if (personData) root.insertAdjacentHTML('beforeend', ReportTemplate.buildPersonSection(personData));

  await Promise.all([...document.querySelectorAll('#root img')].map(img =>
    img.complete && img.naturalWidth > 0
      ? null
      : new Promise(resolve => { img.onload = img.onerror = resolve; })
  ));
  await new Promise(r => setTimeout(r, 200));
  window.__reportReady = true;
})().catch(e => {
  document.getElementById('root').innerHTML =
    '<p style="color:#c00;padding:40px">report render failed: ' + (e && e.message) + '</p>';
  window.__reportReady = true;
});
