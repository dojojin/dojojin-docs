// ============================================================
// Vigil Platform — Person Report Print Script (CSP-safe external)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Puppeteer-only. Reads URL params, fetches the face-report stats + branding,
// builds the report via FaceReport, inits charts (animation:false), waits for
// every snapshot thumbnail to load, then sets window.__reportReady=true so the
// renderer knows when to screenshot / print.

(async () => {
  const p = new URLSearchParams(location.search);
  const period    = p.get('period') || 'today';
  const group     = p.get('group') || 'all';
  const min_score = p.get('min_score') || '80';
  const lang      = p.get('lang') === 'en' ? 'en' : 'th';
  const site_id   = p.get('site_id') || '';
  const title     = p.get('title') || '';
  const from      = p.get('from') || '';
  const to        = p.get('to') || '';
  const sections  = p.get('sections')
    ? Object.fromEntries(p.get('sections').split(',').map(s => [s.trim(), true]))
    : { peak: true, demographics: true, trend: true, persons: true, suspects: true };

  // Set the language WITHOUT I18N.setLang() — that calls location.reload(),
  // which would put this render-only page into an infinite reload loop.
  // getLang() reads this localStorage key ('dashboard_lang') on every t() call.
  try { localStorage.setItem('dashboard_lang', lang); } catch (e) { /* ignore */ }

  const q = new URLSearchParams({ period, min_score });
  if (group && group !== 'all') q.set('group', group);
  if (period === 'custom' && from && to) { q.set('from', from); q.set('to', to); }
  if (site_id) q.set('site_id', site_id);

  const get = async (path) => {
    try { const r = await fetch(path); return r.ok ? await r.json() : null; }
    catch { return null; }
  };

  const [data, branding] = await Promise.all([
    get(`/api/stats/face/report?${q}`),
    get(`/api/branding`),
  ]);

  const brand = branding || {};
  document.documentElement.style.setProperty('--accent', brand.primary_color || '#5b8def');
  const root = document.getElementById('root');

  if (!data) {
    root.innerHTML = '<p style="padding:40px;color:#c00">no report data</p>';
    window.__reportReady = true;
    return;
  }

  root.innerHTML = FaceReport.buildHtml(data, brand, { mode: 'print', lang, sections, title });
  FaceReport.initCharts(data, { animation: false, sections });

  // Wait for every snapshot thumbnail (the whole point — cards with faces).
  // `complete` is true once an image has loaded OR errored — treat both as done,
  // otherwise an already-errored image (missing snapshot / 401) waits forever on
  // an onerror that already fired. Hard 60s cap so __reportReady always fires.
  const imgWait = Promise.all([...document.querySelectorAll('#root img')].map(img =>
    img.complete ? null : new Promise(res => { img.onload = img.onerror = res; })));
  await Promise.race([imgWait, new Promise(r => setTimeout(r, 60000))]);
  // Let Chart.js paint its (animation-less) frame before capture.
  await new Promise(r => setTimeout(r, 250));
  window.__reportReady = true;
})().catch(e => {
  document.getElementById('root').innerHTML =
    '<p style="padding:40px;color:#c00">report render failed: ' + (e && e.message) + '</p>';
  window.__reportReady = true;
});
