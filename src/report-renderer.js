// ============================================================
// DojoJin Tech Dashboard — Server-side Report Renderer
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Phase 7.3 commit 2 — generates a report PDF unattended (for the
// scheduler) and on demand (GET /api/reports/pdf).
//
// Approach: gather data by calling our OWN /api/stats/* endpoints with
// the internal service token (so the stats SQL stays single-sourced in
// api-server.js — no duplication), render a self-contained A4 HTML
// string, then Puppeteer setContent → page.pdf().
//
// Tables-only layout by design: prints crisply, no chart-render wait,
// reliable unattended. (Charts could be added later as CSS bars.)
// ============================================================

const puppeteer = require('puppeteer');
const sharp = require('sharp');

// ── Helpers ─────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const num = n => Number(n || 0).toLocaleString();

// Derive [from, to] for a scheduled report from its type — all three are
// "the last N completed days" ending at today 00:00:
//   daily   → last 1 day  (yesterday)
//   weekly  → last 7 days
//   monthly → last 30 days
//
// Originally weekly/monthly used the previous *calendar* week/month. That
// breaks on a young deployment: e.g. tested mid-May with data starting
// May 8, "last completed calendar week" (May 4–10) was almost empty while
// the bulk of the data sat in the current week. Rolling N-day windows
// always cover the recent data regardless of how new the system is, and
// "last 7 / 30 days" is a perfectly natural reading of weekly/monthly.
function computeScheduledRange(type, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const to = new Date(d);                       // today 00:00 — exclusive end
  const from = new Date(d);
  let label;
  if (type === 'weekly') {
    from.setDate(d.getDate() - 7);
    label = `7 วันล่าสุด (${from.toLocaleDateString('th-TH')} – ${new Date(to - 1).toLocaleDateString('th-TH')})`;
  } else if (type === 'monthly') {
    from.setDate(d.getDate() - 30);
    label = `30 วันล่าสุด (${from.toLocaleDateString('th-TH')} – ${new Date(to - 1).toLocaleDateString('th-TH')})`;
  } else { // daily
    from.setDate(d.getDate() - 1);
    label = `ประจำวันที่ ${from.toLocaleDateString('th-TH')}`;
  }
  return { from: from.toISOString(), to: to.toISOString(), label, type };
}

// ── Data gathering — internal fetch to our own stats endpoints ──
async function gatherReportData({ baseUrl, internalToken, from, to, cameras }) {
  const camParam = cameras && cameras.length
    ? `&cameras=${encodeURIComponent(cameras.join(','))}` : '';
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${camParam}`;
  const headers = { 'X-Internal-Token': internalToken };
  const get = async (path) => {
    try {
      const r = await fetch(`${baseUrl}${path}`, { headers });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  const [cats, brk, ppl, veh, top, quiet] = await Promise.all([
    get(`/api/stats/categories?${q}`),
    get(`/api/stats/breakdown-v2?${q}`),
    get(`/api/stats/per-camera-counts?kind=people&${q}`),
    get(`/api/stats/per-camera-counts?kind=vehicle&${q}`),
    get(`/api/stats/top-rules?${q}&limit=10`),
    get(`/api/stats/quiet-cameras?since_hours=24`),
  ]);
  return { cats, brk, ppl, veh, top, quiet };
}


// (The old setContent-based A4 HTML template was removed when renderReportPdf
// was switched to render via /report-print.html — the layout now lives in
// dashboard/report-template.js, shared with the interactive Reports page.)

// ── Compact HTML — phone-friendly summary (for LINE delivery) ──
// ~720px wide so it reads on a phone without zooming. Summary only:
// key category counts + top 5 rules + per-camera totals. The full
// detail (breakdown 15 / quiet cameras) lives in the PDF / 'full' image.
function renderReportCompactHtml(data, { brand = {}, title, rangeLabel }) {
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'DojoJin Tech Dashboard';

  const cats = (data.cats?.categories) || [];
  const top  = ((data.top?.top) || []).slice(0, 5);
  const ppl  = (data.ppl?.per_camera) || [];
  const veh  = (data.veh?.per_camera) || [];
  const totalEvents = cats.reduce((s, c) => s + (c.count || 0), 0);
  const pplTotal = ppl.reduce((s, c) => s + (c.count || 0), 0);
  const vehTotal = veh.reduce((s, c) => s + (c.count || 0), 0);

  const card = (label, value, color) => `
    <div style="flex:1;background:#f7fafc;border-radius:8px;padding:10px 12px;text-align:center">
      <div style="font-size:11px;color:#718096">${esc(label)}</div>
      <div style="font-size:22px;font-weight:800;color:${color}">${num(value)}</div>
    </div>`;

  const catRows = cats.map(c => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #edf2f7;font-size:13px">
      <span>${esc(c.icon || '')} ${esc(c.name)}</span>
      <strong>${num(c.count)}</strong></div>`).join('');

  const topRows = top.map((r, i) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #edf2f7;font-size:13px">
      <span><span style="color:#a0aec0">${i + 1}.</span> ${esc(r.rule_name)}</span>
      <strong>${num(r.count)}</strong></div>`).join('');

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; }
  body { font-family:'Sarabun','Segoe UI',sans-serif; color:#1a202c; margin:0;
         width:720px; padding:22px; background:#fff; }
  h2 { font-size:14px; color:#2d3748; margin:18px 0 6px;
       border-bottom:2px solid ${esc(accent)}; padding-bottom:4px; }
</style></head><body>
  <div style="border-bottom:3px solid ${esc(accent)};padding-bottom:12px;margin-bottom:14px">
    <div style="font-size:20px;font-weight:800">${esc(title || 'รายงานสรุป')}</div>
    <div style="font-size:13px;color:#4a5568;margin-top:3px">${esc(rangeLabel || '')}</div>
    <div style="font-size:11px;color:#a0aec0;margin-top:2px">${esc(brandName)}</div>
  </div>
  <div style="display:flex;gap:8px">
    ${card('เหตุการณ์ทั้งหมด', totalEvents, accent)}
    ${card('คน', pplTotal, '#22c55e')}
    ${card('ยานพาหนะ', vehTotal, '#f59e0b')}
  </div>
  ${cats.length ? `<h2>สรุปตามหมวดหมู่</h2>${catRows}` : ''}
  ${top.length ? `<h2>Rule ที่ทำงานบ่อยสุด (Top 5)</h2>${topRows}` : ''}
  <div style="margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;
              font-size:10px;color:#a0aec0;display:flex;justify-content:space-between">
    <span>สร้างเมื่อ ${new Date().toLocaleString('th-TH', { hour12: false })}</span>
    <span>© 2025-2026 DojoJin Tech</span>
  </div>
</body></html>`;
}

// Puppeteer browser pool — launch Chromium ONCE on first use, hand out fresh
// pages per render. Was launching+closing per call (3–5s cold start each;
// dominated total render time on the scheduler + on-demand PDF path).
// Each render gets a new isolated page (cheap, ~100ms). If Chromium dies
// (`disconnected` event), the next call relaunches.
// --no-sandbox: the renderer feeds its OWN trusted HTML (never arbitrary
// web content), and the eventual Linux production host commonly needs it.
let _browserPromise = null;
function _getBrowser() {
  if (_browserPromise) return _browserPromise;
  _browserPromise = puppeteer
    .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 120000 })
    .then(browser => {
      browser.on('disconnected', () => {
        if (_browserPromise) {
          console.warn('[report-renderer] puppeteer browser disconnected — will relaunch on next call');
          _browserPromise = null;
        }
      });
      console.log('[report-renderer] puppeteer browser pool — launched');
      return browser;
    })
    .catch(err => {
      // Don't pin a failed promise; let the next call try again.
      _browserPromise = null;
      throw err;
    });
  return _browserPromise;
}

function _isPuppeteerProtocolTimeout(err) {
  const msg = String(err?.message || '');
  return msg.includes('ProtocolError')
    || msg.includes('protocolTimeout')
    || msg.includes('Runtime.callFunctionOn timed out')
    || msg.includes('timed out after');
}

function _withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function _closePageQuietly(page) {
  if (!page) return;
  try {
    await _withTimeout(page.close(), 3000, 'puppeteer page close');
  } catch {}
}

async function _resetBrowserPool(reason) {
  const p = _browserPromise;
  _browserPromise = null;
  if (!p) return;
  try {
    const browser = await p;
    await _withTimeout(browser.close(), 3000, 'puppeteer browser close');
  } catch {}
  console.warn(`[report-renderer] puppeteer browser reset${reason ? `: ${reason}` : ''}`);
}

async function _withPage(fn, opts = {}) {
  const retries = Math.max(0, opts.retries || 0);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const browser = await _getBrowser();
    const page = await browser.newPage();
    try {
      return await fn(page);
    } catch (err) {
      if (attempt < retries && _isPuppeteerProtocolTimeout(err)) {
        await _closePageQuietly(page);
        await _resetBrowserPool(err.message);
        continue;
      }
      throw err;
    } finally {
      await _closePageQuietly(page);
    }
  }
}

// Graceful shutdown — close the shared browser on process termination.
async function shutdown() {
  const p = _browserPromise;
  if (!p) return;
  _browserPromise = null;
  try { (await p).close(); } catch {}
}
process.once('SIGINT',  shutdown);
process.once('SIGTERM', shutdown);

// Build the /report-print.html URL with query params (shared by the PDF
// and 'full' image paths — same standalone page renders both).
function _printPageUrl({ baseUrl, from, to, title, rangeLabel, cameras }) {
  const qp = new URLSearchParams({
    from: from || '', to: to || '',
    title: title || '', label: rangeLabel || '',
  });
  if (cameras && cameras.length) qp.set('cameras', cameras.join(','));
  return `${baseUrl}/report-print.html?${qp.toString()}`;
}

// ── Orchestrator: full A4 PDF (on-demand download) ──────────
// Renders from /report-print.html via Puppeteer page.pdf — so the PDF
// matches the interactive Reports page byte-for-byte and uses Chromium's
// real paginator (page-break-inside:avoid actually works, no mid-element
// cuts). Replaces the old setContent-of-a-separate-A4-template approach
// that had a duplicate layout AND fixed-image white-rect masking.
//
// Body padding is zeroed via an injected stylesheet — page.pdf supplies
// the margin (8mm). For the image path, body padding stays so screenshots
// have a small visual border.
async function renderReportPdf({ baseUrl, internalToken, from, to, cameras, brand, title, rangeLabel }) {
  const url = _printPageUrl({ baseUrl, from, to, title, rangeLabel, cameras });
  return _withPage(async (page) => {
    await page.setExtraHTTPHeaders({ 'X-Internal-Token': internalToken });
    await page.setViewport({ width: 820, height: 1100, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForFunction('window.__reportReady === true', { timeout: 20000 });
    await page.addStyleTag({
      content: 'body{padding:0!important;width:auto!important;max-width:100%!important}'
            + ' tr,h2,h3{page-break-inside:avoid}'
            + ' table{page-break-inside:auto}',
    });
    return page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
    });
  });
}

// ── Orchestrator: PNG image (scheduled LINE delivery) ───────
// layout 'compact' → phone-friendly summary template (setContent).
// layout 'full'    → the EXACT interactive web report: Puppeteer loads
//                    /report-print.html, which renders via the shared
//                    report-template.js (same code the Reports page
//                    uses). The internal token is injected as an HTTP
//                    header so the print page's /api/stats fetches
//                    authenticate without the token reaching page JS.
// Returns a PNG Buffer.
async function renderReportImage({ baseUrl, internalToken, from, to, cameras, brand, title, rangeLabel, layout = 'compact' }) {
  if (layout === 'full') {
    const url = _printPageUrl({ baseUrl, from, to, title, rangeLabel, cameras });
    return _withPage(async (page) => {
      await page.setExtraHTTPHeaders({ 'X-Internal-Token': internalToken });
      await page.setViewport({ width: 880, height: 1000, deviceScaleFactor: 2 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
      // report-print.html sets window.__reportReady once data is rendered
      // and Chart.js has painted.
      await page.waitForFunction('window.__reportReady === true', { timeout: 20000 });
      return page.screenshot({ type: 'png', fullPage: true });
    });
  }

  // compact — phone-friendly summary, rendered server-side via setContent.
  const data = await gatherReportData({ baseUrl, internalToken, from, to, cameras });
  const html = renderReportCompactHtml(data, { brand, title, rangeLabel });
  return _withPage(async (page) => {
    await page.setViewport({ width: 720, height: 900, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    return page.screenshot({ type: 'png', fullPage: true });
  });
}

// ── Ph.3 System Health Report ────────────────────────────────
// Sections: camera_status, camera_uptime, alerts, storage, system
// (events removed per Ph.3 fix — overlaps with analytics report)
const ALL_HEALTH_SECTIONS = ['camera_status', 'camera_uptime', 'alerts', 'storage', 'system'];

function normalizeHealthSections(sections) {
  const raw = Array.isArray(sections) && sections.length ? sections : ALL_HEALTH_SECTIONS;
  const out = [];
  for (const s of raw) {
    if (s === 'cameras') {
      out.push('camera_status', 'camera_uptime');
    } else {
      out.push(s);
    }
  }
  return [...new Set(out)].filter(s => ALL_HEALTH_SECTIONS.includes(s));
}

// i18n labels for the rendered HTML report (no I18N runtime — server-side)
const HR_LABELS = {
  th: {
    title:'🏥 รายงานสุขภาพระบบ', generatedAt:'สร้างเมื่อ',
    range24h:'24 ชั่วโมงย้อนหลัง', rangeWeekly:'7 วันล่าสุด',
    rangeMonthly:'30 วันล่าสุด', rangeCustom:'ช่วงกำหนดเอง',
    secCameraStatus:'📷 สถานะกล้อง', secCameraUptime:'📈 Uptime กล้อง',
    camAllOnline:'กล้องทั้งหมดออนไลน์', camOfflineList:'กล้องที่ออฟไลน์',
    camTotal:'กล้องทั้งหมด',
    camOnline:'ออนไลน์ ✓', camOffline:'ออฟไลน์ ✗',
    perCameraHeader:'รายละเอียด Uptime ในช่วงเวลา', uptimeNoData:'— (ไม่มีข้อมูล status log)',
    noOutageRecorded:'100% (ไม่พบ outage ในช่วงนี้)',
    offlineFor:'Offline ', neverOnline:'ไม่เคยออนไลน์',
    dataLoadError:'⚠️ โหลดข้อมูลกล้องไม่สำเร็จ',
    ago:'ที่ผ่านมา', addedAt:'📅 เพิ่มเข้าระบบ', heartbeatLast:'💓 Heartbeat ล่าสุด',
    lastOnline:'Last Seen',
    eventLast:'⚡ Event ล่าสุด', neverEvent:'ไม่เคยมี event',
    snapshotLast:'🖼  Snapshot ล่าสุด', neverSnapshot:'ไม่เคยมี snapshot',
    warnOfflineMany:'⚠️ กล้อง {n}/{t} ออฟไลน์ — ตรวจสอบเครือข่าย/RTSP',
    warnDisk:'⚠️ พื้นที่จัดเก็บใกล้เต็ม ({p}%)',
    warnRam:'⚠️ RAM ใช้งานสูง ({p}%)',
    secAlerts:'🔔 การแจ้งเตือน', alSuccess:'ส่งสำเร็จ', alFailed:'ส่งล้มเหลว',
    alCooldown:'Cooldown / ไม่ส่ง', alTotal:'รวมทั้งหมด',
    secStorage:'💾 พื้นที่จัดเก็บ', stDisk:'Disk ใช้งาน', stFree:'ว่าง',
    stFiles:'ไฟล์', stSnapshots:'Snapshots', stClips:'Clips',
    secSystem:'⚙️ ระบบ', sysRam:'RAM ใช้งาน', sysUptime:'Server uptime',
    sysDb:'DB latency', sysNode:'Node.js',
    sysDataMissing:'⚠️ ดึงข้อมูล system ไม่สำเร็จ — ตรวจสอบสิทธิ์ admin/auditor',
  },
  en: {
    title:'🏥 System Health Report', generatedAt:'Generated at',
    range24h:'Last 24 hours', rangeWeekly:'Last 7 days',
    rangeMonthly:'Last 30 days', rangeCustom:'Custom range',
    secCameraStatus:'📷 Camera Status', secCameraUptime:'📈 Camera Uptime',
    camAllOnline:'All cameras are online', camOfflineList:'Offline cameras',
    camTotal:'Total cameras',
    camOnline:'Online ✓', camOffline:'Offline ✗',
    perCameraHeader:'Uptime details over range', uptimeNoData:'— (no status log data)',
    noOutageRecorded:'100% (no outage recorded)',
    offlineFor:'Offline ', neverOnline:'Never online',
    dataLoadError:'⚠️ Failed to load camera data',
    ago:'ago', addedAt:'📅 Added', heartbeatLast:'💓 Last heartbeat',
    lastOnline:'Last seen',
    eventLast:'⚡ Last event', neverEvent:'No event yet',
    snapshotLast:'🖼  Last snapshot', neverSnapshot:'No snapshot yet',
    warnOfflineMany:'⚠️ {n}/{t} cameras offline — check network/RTSP',
    warnDisk:'⚠️ Disk nearly full ({p}%)',
    warnRam:'⚠️ High RAM usage ({p}%)',
    secAlerts:'🔔 Alerts', alSuccess:'Success', alFailed:'Failed',
    alCooldown:'Cooldown / skipped', alTotal:'Total',
    secStorage:'💾 Storage', stDisk:'Disk used', stFree:'free',
    stFiles:'files', stSnapshots:'Snapshots', stClips:'Clips',
    secSystem:'⚙️ System', sysRam:'RAM used', sysUptime:'Server uptime',
    sysDb:'DB latency', sysNode:'Node.js',
    sysDataMissing:'⚠️ Failed to load system data — check admin/auditor permission',
  },
};

// Format a duration in seconds as a compact human-readable string ("5d 3h",
// "2h 15m", "45m"). Used for "offline for X" in the per-camera list.
function _fmtDuration(sec) {
  if (sec == null || sec < 0) return '';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Absolute timestamp formatted in display locale, optionally appended with
// a relative-time suffix ("(2 days ago)"). Returns '—' on null/missing.
function _fmtTimestamp(iso, lang, agoLabel) {
  if (!iso) return '—';
  const locale = lang === 'en' ? 'en-US' : 'th-TH';
  const ts = new Date(iso);
  const ago = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 1000));
  return `${ts.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} (${_fmtDuration(ago)} ${agoLabel})`;
}

// Normalize a range spec from the caller into { from, to, hours, labelKey, customLabel }
function _normalizeRange(rangeInput) {
  const r = rangeInput || {};
  const now = Date.now();
  if (r.from && r.to) {
    return {
      from: new Date(r.from).toISOString(),
      to:   new Date(r.to).toISOString(),
      hours: (new Date(r.to).getTime() - new Date(r.from).getTime()) / 3600000,
      labelKey: 'rangeCustom', customLabel: r.label || null,
    };
  }
  const preset = (r.preset || '24h').toLowerCase();
  const hours = preset === '7d' ? 168 : preset === '30d' ? 720 : 24;
  const labelKey = preset === '7d' ? 'rangeWeekly' : preset === '30d' ? 'rangeMonthly' : 'range24h';
  return {
    from: new Date(now - hours * 3600 * 1000).toISOString(),
    to:   new Date(now).toISOString(),
    hours, labelKey, customLabel: null,
  };
}

async function gatherHealthData({ baseUrl, internalToken, sections, range }) {
  const enabled = normalizeHealthSections(sections);
  const headers = { 'X-Internal-Token': internalToken };
  const hours = range.hours || 24;
  const needCameraData = enabled.includes('camera_status') || enabled.includes('camera_uptime');
  const get = async (path) => {
    try {
      const r = await fetch(`${baseUrl}${path}`, { headers });
      if (!r.ok) {
        console.warn(`[health-report] ${path} → HTTP ${r.status}`);
        return null;
      }
      return await r.json();
    } catch (e) {
      console.warn(`[health-report] ${path} → fetch error:`, e.message);
      return null;
    }
  };
  // /api/health/details — system + storage + cameras summary (always fetched
  // — small payload, used by 3 of 4 sections + the header chrome).
  const [hrData, camData, alData] = await Promise.all([
    get('/api/health/details'),
    needCameraData ? get(`/api/health/report-data/cameras?range_hours=${hours}`) : Promise.resolve(null),
    enabled.includes('alerts')  ? get(`/api/health/report-data/alerts?range_hours=${hours}`)  : Promise.resolve(null),
  ]);
  return { health: hrData, cameras: camData, alerts: alData };
}

function renderHealthReportHtml(data, { brand = {}, sections, range, lang = 'th' } = {}) {
  const L = HR_LABELS[lang] || HR_LABELS.th;
  const enabled = new Set(normalizeHealthSections(sections));
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'DojoJin Tech Dashboard';
  const h = data.health || {};
  const locale = lang === 'en' ? 'en-US' : 'th-TH';
  const dateLabel = new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const rangeLabel = range?.customLabel || L[range?.labelKey || 'range24h'];

  const sectionHtml = (title, body) => `
    <div style="margin-bottom:16px">
      <h2 style="font-size:13px;font-weight:700;color:#2d3748;margin:0 0 8px;
                 border-bottom:2px solid ${esc(accent)};padding-bottom:4px">${title}</h2>
      ${body}
    </div>`;
  const row2 = (l, v, dim) => `
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #edf2f7;font-size:12px">
      <span style="color:#4a5568">${esc(l)}</span>
      <strong style="color:${esc(dim || '#1a202c')}">${esc(String(v ?? '—'))}</strong>
    </div>`;

  // Warning banners (top of report) — surface critical conditions even if
  // the operator only skims the header. Computed up-front from available data.
  const banners = [];
  if (enabled.has('camera_status') && data.cameras?.summary) {
    const { total, offline } = data.cameras.summary;
    if (total > 0 && offline / total > 0.5) {
      banners.push(L.warnOfflineMany.replace('{n}', offline).replace('{t}', total));
    }
  }
  if (enabled.has('storage') && h.storage?.disk_total_gb > 0) {
    const diskPct = (h.storage.disk_total_gb - h.storage.disk_free_gb) / h.storage.disk_total_gb * 100;
    if (diskPct > 85) banners.push(L.warnDisk.replace('{p}', diskPct.toFixed(1)));
  }
  if (enabled.has('system') && h.server?.total_mem_mb > 0) {
    const memPct = (h.server.total_mem_mb - h.server.free_mem_mb) / h.server.total_mem_mb * 100;
    if (memPct > 85) banners.push(L.warnRam.replace('{p}', memPct.toFixed(1)));
  }
  const bannerHtml = banners.length
    ? `<div style="margin-bottom:16px;padding:10px 12px;background:#fff5e6;border-left:4px solid #f59e0b;border-radius:4px">
        ${banners.map(b => `<div style="font-size:12px;color:#92400e;font-weight:600;padding:2px 0">${esc(b)}</div>`).join('')}
      </div>`
    : '';

  const parts = [];

  // ── Camera Status (current online/offline summary + concise outage list) ──
  if (enabled.has('camera_status')) {
    const c = data.cameras;
    if (c === null) {
      // Endpoint failed → surface the error in the report so the operator knows
      parts.push(sectionHtml(L.secCameraStatus, `<div style="color:#ef4444;padding:8px 0;font-size:12px">${esc(L.dataLoadError)}</div>`));
    } else {
      const summary = c.summary || { total: 0, online: 0, offline: 0 };
      const list = Array.isArray(c.list) ? c.list : [];
      const offlineList = list.filter(cam => cam.status === 'offline');
      const summaryRows = [
        row2(L.camTotal, summary.total),
        row2(L.camOnline, summary.online, '#22c55e'),
        row2(L.camOffline, summary.offline, summary.offline > 0 ? '#ef4444' : '#1a202c'),
      ];
      const offlineRows = offlineList.map(cam => {
        const subStyle = 'font-size:10px;color:#718096;margin-top:2px;padding-left:14px';
        return `<div style="padding:6px 0;border-bottom:1px solid #edf2f7;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:#ef4444">✗ ${esc(cam.name || cam.camera_id)}</span>
            <strong style="color:#ef4444">${esc(L.offlineFor)}${esc(_fmtDuration(cam.offline_for_sec))}</strong>
          </div>
          <div style="${subStyle}">${esc(L.lastOnline)}: ${esc(_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago))}</div>
        </div>`;
      }).join('');
      const body = summaryRows.join('') + (offlineList.length
        ? `<div style="margin-top:8px;font-size:11px;color:#718096">${esc(L.camOfflineList)}</div>${offlineRows}`
        : `<div style="margin-top:8px;padding:8px 10px;background:#f0fdf4;color:#166534;border-radius:6px;font-size:12px">${esc(L.camAllOnline)}</div>`);
      parts.push(sectionHtml(L.secCameraStatus, body));
    }
  }

  // ── Camera Uptime (all cameras + reliability details over selected range) ──
  if (enabled.has('camera_uptime')) {
    const c = data.cameras;
    if (c === null) {
      parts.push(sectionHtml(L.secCameraUptime, `<div style="color:#ef4444;padding:8px 0;font-size:12px">${esc(L.dataLoadError)}</div>`));
    } else {
      const list = Array.isArray(c.list) ? c.list : [];
      const camRows = list.map(cam => {
        const isOnline = cam.status === 'online';
        const upPct = cam.uptime_pct;
        const upText = (upPct === null || upPct === undefined)
          ? (isOnline ? L.noOutageRecorded : L.uptimeNoData)
          : `${upPct}%`;
        const upColor = isOnline ? '#22c55e' : '#ef4444';
        const upColor2 = (upPct === null || upPct === undefined) ? (isOnline ? '#22c55e' : '#a0aec0')
          : (upPct < 90 ? '#ef4444' : upPct < 99 ? '#f59e0b' : '#22c55e');
        const statusIcon = isOnline ? '✓' : '✗';
        const headerRow = `<div style="display:flex;justify-content:space-between">
          <span style="color:${esc(upColor)}">${esc(statusIcon)} ${esc(cam.name || cam.camera_id)}</span>
          <strong style="color:${esc(upColor2)}">${esc(upText)}</strong>
        </div>`;
        // All cameras: compact lifecycle + event/snapshot diagnostics.
        const subStyle = 'font-size:10px;color:#718096;margin-top:2px;padding-left:14px';
        const subLines = [];
        if (cam.offline_for_sec === -1) {
          subLines.push(`<div style="${subStyle};color:#a0aec0">${esc(L.neverOnline)}</div>`);
        }
        subLines.push(`<div style="${subStyle}">${esc(L.addedAt)}: ${esc(_fmtTimestamp(cam.added_at, lang, L.ago))}</div>`);
        subLines.push(`<div style="${subStyle}">${esc(L.heartbeatLast)}: ${esc(_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago))}</div>`);
        if (cam.last_event_at) {
          subLines.push(`<div style="${subStyle}">${esc(L.eventLast)}: ${esc(_fmtTimestamp(cam.last_event_at, lang, L.ago))}</div>`);
        } else {
          subLines.push(`<div style="${subStyle};color:#a0aec0">${esc(L.eventLast)}: ${esc(L.neverEvent)}</div>`);
        }
        if (cam.last_snapshot_at) {
          subLines.push(`<div style="${subStyle}">${esc(L.snapshotLast)}: ${esc(_fmtTimestamp(cam.last_snapshot_at, lang, L.ago))}</div>`);
        } else {
          subLines.push(`<div style="${subStyle};color:#a0aec0">${esc(L.snapshotLast)}: ${esc(L.neverSnapshot)}</div>`);
        }
        return `<div style="padding:5px 0;border-bottom:1px solid #edf2f7;font-size:12px">
          ${headerRow}
          ${subLines.join('')}
        </div>`;
      }).join('');
      parts.push(sectionHtml(L.secCameraUptime,
        (list.length ? `<div style="font-size:11px;color:#718096">${esc(L.perCameraHeader)}</div>` + camRows : '')
      ));
    }
  }

  // ── Alerts (counts over range) ────────────────────────────
  if (enabled.has('alerts') && data.alerts) {
    const al = data.alerts;
    parts.push(sectionHtml(L.secAlerts, [
      row2(L.alSuccess,  num(al.success  || 0), '#22c55e'),
      row2(L.alFailed,   num(al.failed   || 0), al.failed > 0 ? '#ef4444' : '#1a202c'),
      row2(L.alCooldown, num(al.cooldown || 0), '#a0aec0'),
      row2(L.alTotal,    num(al.total    || 0)),
    ].join('')));
  }

  // ── Storage (snapshot) ────────────────────────────────────
  if (enabled.has('storage')) {
    if (!h.storage) {
      parts.push(sectionHtml(L.secStorage, `<div style="color:#ef4444;padding:8px 0;font-size:12px">${esc(L.sysDataMissing)}</div>`));
    } else {
      const st = h.storage;
      const diskPct = st.disk_total_gb > 0 ? (((st.disk_total_gb - st.disk_free_gb) / st.disk_total_gb) * 100).toFixed(1) : '—';
      const diskColor = parseFloat(diskPct) > 85 ? '#ef4444' : parseFloat(diskPct) > 70 ? '#f59e0b' : '#22c55e';
      parts.push(sectionHtml(L.secStorage, [
        row2(L.stDisk, `${diskPct}% (${L.stFree} ${st.disk_free_gb ?? '—'} / ${st.disk_total_gb ?? '—'} GB)`, diskColor),
        row2(L.stSnapshots, `${st.snapshots_mb ?? 0} MB (${st.snapshots_files ?? 0} ${L.stFiles})`),
        row2(L.stClips, `${st.clips_mb ?? 0} MB (${st.clips_files ?? 0} ${L.stFiles})`),
      ].join('')));
    }
  }

  // ── System (snapshot) ─────────────────────────────────────
  if (enabled.has('system')) {
    if (!h.server) {
      parts.push(sectionHtml(L.secSystem, `<div style="color:#ef4444;padding:8px 0;font-size:12px">${esc(L.sysDataMissing)}</div>`));
    } else {
      const sv = h.server;
      const memPct = sv.total_mem_mb > 0 ? (((sv.total_mem_mb - sv.free_mem_mb) / sv.total_mem_mb) * 100).toFixed(1) : '—';
      const memColor = parseFloat(memPct) > 85 ? '#ef4444' : parseFloat(memPct) > 70 ? '#f59e0b' : '#22c55e';
      const uptimeDays = Math.floor((sv.uptime_sec || 0) / 86400);
      const uptimeHrs  = Math.floor(((sv.uptime_sec || 0) % 86400) / 3600);
      parts.push(sectionHtml(L.secSystem, [
        row2(L.sysRam, `${memPct}% (${L.stFree} ${sv.free_mem_mb ?? '—'} / ${sv.total_mem_mb ?? '—'} MB)`, memColor),
        row2(L.sysUptime, `${uptimeDays}d ${uptimeHrs}h`),
        row2(L.sysDb, `${h.db?.latency_ms ?? '—'} ms`, h.db?.latency_ms > 100 ? '#ef4444' : '#22c55e'),
        row2(L.sysNode, sv.node_version || '—'),
      ].join('')));
    }
  }

  return `<!DOCTYPE html><html lang="${esc(lang)}"><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; }
  body { font-family:'Sarabun','Segoe UI',sans-serif; color:#1a202c; margin:0;
         width:720px; padding:22px; background:#fff; }
</style></head><body>
  <div style="border-bottom:3px solid ${esc(accent)};padding-bottom:12px;margin-bottom:18px">
    <div style="font-size:20px;font-weight:800">${esc(L.title)}</div>
    <div style="font-size:12px;color:#4a5568;margin-top:3px">${esc(rangeLabel)} · ${esc(L.generatedAt)} ${esc(dateLabel)}</div>
    <div style="font-size:11px;color:#a0aec0;margin-top:2px">${esc(brandName)}</div>
  </div>
  ${bannerHtml}
  ${parts.join('')}
  <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;
              font-size:10px;color:#a0aec0;display:flex;justify-content:space-between">
    <span>${esc(L.generatedAt)} ${new Date().toLocaleString(locale, { hour12: false })}</span>
    <span>© 2025-2026 DojoJin Tech</span>
  </div>
</body></html>`;
}

function _truncateText(value, max = 72) {
  const s = String(value == null ? '' : value);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function _svgSafeText(value) {
  return String(value == null ? '' : value)
    // librsvg/Pango can abort the Node process if emoji fallback fonts are
    // unavailable. Health PNGs keep the text payload and omit decorative icons.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _renderHealthReportSvg(data, { brand = {}, sections, range, lang = 'th' } = {}) {
  const L = HR_LABELS[lang] || HR_LABELS.th;
  const enabled = new Set(normalizeHealthSections(sections));
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'DojoJin Tech Dashboard';
  const h = data.health || {};
  const c = data.cameras;
  const locale = lang === 'en' ? 'en-US' : 'th-TH';
  const dateLabel = new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const rangeLabel = range?.customLabel || L[range?.labelKey || 'range24h'];
  const width = 720;
  const left = 22;
  const right = width - 22;
  const rows = [];
  let y = 28;

  const add = s => rows.push(s);
  const text = (x, yy, value, opts = {}) => {
    const size = opts.size || 12;
    const weight = opts.weight || 400;
    const fill = opts.fill || '#1a202c';
    const anchor = opts.anchor || 'start';
    add(`<text x="${x}" y="${yy}" font-size="${size}" font-weight="${weight}" fill="${esc(fill)}" text-anchor="${anchor}">${esc(_truncateText(_svgSafeText(value), opts.max || 96))}</text>`);
  };
  const line = (yy, color = '#edf2f7', x1 = left, x2 = right) => {
    add(`<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="${esc(color)}" stroke-width="1"/>`);
  };
  const section = title => {
    y += 16;
    text(left, y, title, { size: 13, weight: 700, fill: '#2d3748', max: 80 });
    line(y + 8, accent);
    y += 22;
  };
  const row = (label, value, color = '#1a202c') => {
    text(left, y, label, { size: 12, fill: '#4a5568', max: 48 });
    text(right, y, value, { size: 12, weight: 700, fill: color, anchor: 'end', max: 34 });
    line(y + 8);
    y += 22;
  };
  const note = (value, color = '#718096') => {
    text(left + 14, y, value, { size: 10, fill: color, max: 90 });
    y += 16;
  };
  const cameraName = cam => cam.name || cam.camera_id || '—';

  text(left, y, L.title, { size: 20, weight: 800, max: 70 });
  y += 22;
  text(left, y, `${rangeLabel} · ${L.generatedAt} ${dateLabel}`, { size: 12, fill: '#4a5568', max: 92 });
  y += 18;
  text(left, y, brandName, { size: 11, fill: '#a0aec0', max: 88 });
  y += 12;
  add(`<rect x="${left}" y="${y}" width="${right - left}" height="3" fill="${esc(accent)}"/>`);
  y += 18;

  if (enabled.has('camera_status') && c?.summary) {
    const { total, offline } = c.summary;
    if (total > 0 && offline / total > 0.5) {
      add(`<rect x="${left}" y="${y}" width="${right - left}" height="34" fill="#fff5e6" rx="4"/>`);
      add(`<rect x="${left}" y="${y}" width="4" height="34" fill="#f59e0b"/>`);
      text(left + 12, y + 21, L.warnOfflineMany.replace('{n}', offline).replace('{t}', total), { size: 12, weight: 700, fill: '#92400e', max: 88 });
      y += 48;
    }
  }

  if (enabled.has('camera_status')) {
    section(L.secCameraStatus);
    if (c === null) {
      text(left, y, L.dataLoadError, { size: 12, fill: '#ef4444' });
      y += 22;
    } else {
      const summary = c?.summary || { total: 0, online: 0, offline: 0 };
      const list = Array.isArray(c?.list) ? c.list : [];
      const offlineList = list.filter(cam => cam.status === 'offline');
      row(L.camTotal, summary.total);
      row(L.camOnline, summary.online, '#22c55e');
      row(L.camOffline, summary.offline, summary.offline > 0 ? '#ef4444' : '#1a202c');
      if (offlineList.length) {
        text(left, y, L.camOfflineList, { size: 11, fill: '#718096' });
        y += 18;
        for (const cam of offlineList) {
          text(left, y, `✗ ${cameraName(cam)}`, { size: 12, fill: '#ef4444', max: 50 });
          text(right, y, `${L.offlineFor}${_fmtDuration(cam.offline_for_sec)}`, { size: 12, weight: 700, fill: '#ef4444', anchor: 'end', max: 28 });
          y += 16;
          note(`${L.lastOnline}: ${_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago)}`);
          line(y - 4);
          y += 8;
        }
      } else {
        add(`<rect x="${left}" y="${y - 3}" width="${right - left}" height="30" fill="#f0fdf4" rx="6"/>`);
        text(left + 10, y + 16, L.camAllOnline, { size: 12, fill: '#166534' });
        y += 38;
      }
    }
  }

  if (enabled.has('camera_uptime')) {
    section(L.secCameraUptime);
    if (c === null) {
      text(left, y, L.dataLoadError, { size: 12, fill: '#ef4444' });
      y += 22;
    } else {
      const list = Array.isArray(c?.list) ? c.list : [];
      if (list.length) {
        text(left, y, L.perCameraHeader, { size: 11, fill: '#718096' });
        y += 18;
      }
      for (const cam of list) {
        const isOnline = cam.status === 'online';
        const upPct = cam.uptime_pct;
        const upText = (upPct === null || upPct === undefined)
          ? (isOnline ? L.noOutageRecorded : L.uptimeNoData)
          : `${upPct}%`;
        const upColor = isOnline ? '#22c55e' : '#ef4444';
        const upColor2 = (upPct === null || upPct === undefined) ? (isOnline ? '#22c55e' : '#a0aec0')
          : (upPct < 90 ? '#ef4444' : upPct < 99 ? '#f59e0b' : '#22c55e');
        text(left, y, `${isOnline ? '✓' : '✗'} ${cameraName(cam)}`, { size: 12, fill: upColor, max: 52 });
        text(right, y, upText, { size: 12, weight: 700, fill: upColor2, anchor: 'end', max: 28 });
        y += 16;
        if (cam.offline_for_sec === -1) note(L.neverOnline, '#a0aec0');
        note(`${L.addedAt}: ${_fmtTimestamp(cam.added_at, lang, L.ago)}`);
        note(`${L.heartbeatLast}: ${_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago)}`);
        note(`${L.eventLast}: ${cam.last_event_at ? _fmtTimestamp(cam.last_event_at, lang, L.ago) : L.neverEvent}`, cam.last_event_at ? '#718096' : '#a0aec0');
        note(`${L.snapshotLast}: ${cam.last_snapshot_at ? _fmtTimestamp(cam.last_snapshot_at, lang, L.ago) : L.neverSnapshot}`, cam.last_snapshot_at ? '#718096' : '#a0aec0');
        line(y - 4);
        y += 8;
        if (y > 15800) break;
      }
    }
  }

  if (enabled.has('alerts') && data.alerts) {
    section(L.secAlerts);
    const al = data.alerts;
    row(L.alSuccess, num(al.success || 0), '#22c55e');
    row(L.alFailed, num(al.failed || 0), al.failed > 0 ? '#ef4444' : '#1a202c');
    row(L.alCooldown, num(al.cooldown || 0), '#a0aec0');
    row(L.alTotal, num(al.total || 0));
  }

  if (enabled.has('storage')) {
    section(L.secStorage);
    if (!h.storage) {
      text(left, y, L.sysDataMissing, { size: 12, fill: '#ef4444' });
      y += 22;
    } else {
      const st = h.storage;
      const diskPct = st.disk_total_gb > 0 ? (((st.disk_total_gb - st.disk_free_gb) / st.disk_total_gb) * 100).toFixed(1) : '—';
      const diskColor = parseFloat(diskPct) > 85 ? '#ef4444' : parseFloat(diskPct) > 70 ? '#f59e0b' : '#22c55e';
      row(L.stDisk, `${diskPct}% (${L.stFree} ${st.disk_free_gb ?? '—'} / ${st.disk_total_gb ?? '—'} GB)`, diskColor);
      row(L.stSnapshots, `${st.snapshots_mb ?? 0} MB (${st.snapshots_files ?? 0} ${L.stFiles})`);
      row(L.stClips, `${st.clips_mb ?? 0} MB (${st.clips_files ?? 0} ${L.stFiles})`);
    }
  }

  if (enabled.has('system')) {
    section(L.secSystem);
    if (!h.server) {
      text(left, y, L.sysDataMissing, { size: 12, fill: '#ef4444' });
      y += 22;
    } else {
      const sv = h.server;
      const memPct = sv.total_mem_mb > 0 ? (((sv.total_mem_mb - sv.free_mem_mb) / sv.total_mem_mb) * 100).toFixed(1) : '—';
      const memColor = parseFloat(memPct) > 85 ? '#ef4444' : parseFloat(memPct) > 70 ? '#f59e0b' : '#22c55e';
      const uptimeDays = Math.floor((sv.uptime_sec || 0) / 86400);
      const uptimeHrs  = Math.floor(((sv.uptime_sec || 0) % 86400) / 3600);
      row(L.sysRam, `${memPct}% (${L.stFree} ${sv.free_mem_mb ?? '—'} / ${sv.total_mem_mb ?? '—'} MB)`, memColor);
      row(L.sysUptime, `${uptimeDays}d ${uptimeHrs}h`);
      row(L.sysDb, `${h.db?.latency_ms ?? '—'} ms`, h.db?.latency_ms > 100 ? '#ef4444' : '#22c55e');
      row(L.sysNode, sv.node_version || '—');
    }
  }

  y += 8;
  line(y);
  y += 18;
  text(left, y, `${L.generatedAt} ${new Date().toLocaleString(locale, { hour12: false })}`, { size: 10, fill: '#a0aec0', max: 58 });
  text(right, y, '(c) 2025-2026 DojoJin Tech', { size: 10, fill: '#a0aec0', anchor: 'end', max: 40 });
  const height = Math.min(16000, Math.max(900, y + 24));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="Sarabun, Segoe UI, Arial, sans-serif">${rows.join('')}</g>
</svg>`;
}

async function renderHealthReportImage({ baseUrl, internalToken, brand, sections, range, lang }) {
  const normalizedRange = _normalizeRange(range);
  const data = await gatherHealthData({ baseUrl, internalToken, sections, range: normalizedRange });
  const svg = _renderHealthReportSvg(data, { brand, sections, range: normalizedRange, lang });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Health Report PDF (A4 + page numbers) ────────────────────
// Same HTML template as the image, but rendered through page.pdf() with
// A4 paper, margins, and Chromium's built-in page-number footer.
// Body width is overridden to fit A4 content area (210mm - 24mm = 186mm).
async function renderHealthReportPdf({ baseUrl, internalToken, brand, sections, range, lang }) {
  const normalizedRange = _normalizeRange(range);
  const data = await gatherHealthData({ baseUrl, internalToken, sections, range: normalizedRange });
  const html = renderHealthReportHtml(data, { brand, sections, range: normalizedRange, lang });
  const pageLabel = lang === 'en' ? 'Page' : 'หน้า';
  return _withPage(async (page) => {
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 820, height: 1100, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Override the 720px image-mode body width so content spans A4 width;
    // hint Chromium to avoid mid-section page breaks where possible.
    await page.addStyleTag({
      content: `
        body { width: auto !important; max-width: 186mm !important;
               padding: 0 !important; margin: 0 auto !important; }
        h2 { page-break-after: avoid; }
        div[style*="margin-bottom:16px"] { page-break-inside: avoid; }
      `,
    });
    return page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '18mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        `<div style="font-size:9px;width:100%;text-align:center;color:#888;` +
        `font-family:'Sarabun','Segoe UI',sans-serif;padding-bottom:4px">` +
        `${pageLabel} <span class="pageNumber"></span> / <span class="totalPages"></span>` +
        `</div>`,
      timeout: 60000,
    });
  });
}

module.exports = {
  computeScheduledRange, renderReportPdf, renderReportImage,
  renderHealthReportImage, renderHealthReportPdf,
  ALL_HEALTH_SECTIONS,
};
