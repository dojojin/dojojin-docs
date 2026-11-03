// ============================================================
// Vigil Platform — Server-side Report Renderer
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

// SVG→PNG rasterisation DPI. The SVGs are authored at 720px logical width;
// librsvg re-renders the vector at this density (200 ≈ 2.8× → ~2000px), so the
// PNG download and the PNG embedded in the PDF stay crisp when scaled up to A4.
// Calibration knob: raise for sharper/larger files, lower for smaller.
const REPORT_PNG_DENSITY = 200;
// librsvg refuses anything over 32767px on either axis, and sharp rasterises at
// REPORT_PNG_DENSITY rather than SVG's nominal 72dpi — so a document is scaled
// by 200/72 ≈ 2.78x on the way in. The old cap of 15800 was written against the
// logical height and let through an SVG that rasterised to ~44000px, which is
// how the health report PNG came to fail outright while the PDF was fine
// (reproduced 2026-08-03). Derived from the density so the two cannot drift.
const SVG_MAX_Y = Math.floor(32767 / (REPORT_PNG_DENSITY / 72)) - 500;

// ── Helpers ─────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const num = n => Number(n || 0).toLocaleString();

// Derive [from, to] for a scheduled report from its type.
// Daily/weekly use rolling windows ending at today 00:00.
// Monthly changed 2026-09-03: now uses the previous calendar month
// (from 1st to end of previous month at 00:00 local, aligned with manual UI).
//
// Originally weekly/monthly used rolling N-day windows. That broke on young
// deployments: e.g. mid-May with data starting May 8, "last 7 days" was almost
// empty while bulk data sat in current week. BUT for monthly, the previous
// calendar month is more intuitive: report sent Sept 1 covers all of August.
function computeScheduledRange(type, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const to = new Date(d);                       // today 00:00 — exclusive end
  const from = new Date(d);
  let label, anchor;
  if (type === 'weekly') {
    from.setDate(d.getDate() - 7);
    label = `7 วันล่าสุด (${from.toLocaleDateString('th-TH')} – ${new Date(to - 1).toLocaleDateString('th-TH')})`;
  } else if (type === 'monthly') {
    // Previous calendar month: from 1st of prev month, to 1st of current month (exclusive)
    const prevMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    from.setFullYear(prevMonthStart.getFullYear(), prevMonthStart.getMonth(), prevMonthStart.getDate());
    to.setFullYear(d.getFullYear(), d.getMonth(), 1);  // Set to to 1st of current month
    const fromLabel = from.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    label = `ประจำเดือน ${fromLabel}`;
  } else if (type === 'summary') {
    // Summary: anchor = yesterday (the day being summarized).
    // from/to = yesterday's whole day (same as daily); the print page computes 3 windows from anchor.
    from.setDate(d.getDate() - 1);
    anchor = new Date(from);  // save anchor for later use
    const anchorLabel = anchor.toLocaleDateString('th-TH');
    label = `รายงานสรุป ประจำวันที่ ${anchorLabel}`;
  } else { // daily
    from.setDate(d.getDate() - 1);
    label = `ประจำวันที่ ${from.toLocaleDateString('th-TH')}`;
  }
  const result = { from: from.toISOString(), to: to.toISOString(), label, type };
  if (anchor) result.anchor = anchor.toISOString();
  return result;
}

// ── Data gathering — internal fetch to our own stats endpoints ──
async function gatherReportData({ baseUrl, internalToken, from, to, cameras, site_id, todFrom, todTo }) {
  const camParam = cameras && cameras.length
    ? `&cameras=${encodeURIComponent(cameras.join(','))}` : '';
  const siteParam = site_id ? `&site_id=${encodeURIComponent(site_id)}` : '';
  const todParam = (todFrom && todTo) ? `&tod_from=${encodeURIComponent(todFrom)}&tod_to=${encodeURIComponent(todTo)}` : '';
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${camParam}${siteParam}${todParam}`;
  const headers = { 'X-Internal-Token': internalToken };
  const get = async (path) => {
    try {
      const r = await fetch(`${baseUrl}${path}`, { headers });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  // per-camera-counts ถูกถอดออก 2026-08-21 — ดูเหตุผลใน _compactHtml
  const [cats, brk, top, quiet] = await Promise.all([
    get(`/api/stats/categories?${q}`),
    get(`/api/stats/breakdown-v2?${q}`),
    get(`/api/stats/top-rules?${q}&limit=10`),
    // quiet-cameras does not take a time range, so it cannot reuse `q` — append site filter independently
    get(`/api/stats/quiet-cameras?since_hours=24${siteParam}`),
  ]);
  return { cats, brk, top, quiet };
}


// (The old setContent-based A4 HTML template was removed when renderReportPdf
// was switched to render via /report-print.html — the layout now lives in
// dashboard/report-template.js, shared with the interactive Reports page.)

// ── Compact HTML — phone-friendly summary (for LINE delivery) ──
// ~720px wide so it reads on a phone without zooming. Summary only:
// key category counts + top 5 rules + per-camera totals. The full
// detail (breakdown 15 / quiet cameras) lives in the PDF / 'full' image.
function renderReportCompactHtml(data, { brand = {}, title, rangeLabel, kpis = null, catsort = null,
                                        catsHide: catPick = null, showDelta = true }) {
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'Vigil Platform';

  // กรองหมวดที่ผู้ใช้เลือกไม่ให้แสดง — กรองที่นี่จุดเดียว การ์ดสรุป (totalEvents,
  // pplTotal, vehTotal) กับตารางจึงอ่านจากชุดเดียวกัน ยอดรวมเท่ากับผลบวกของแถวเสมอ
  // ไม่มี/ว่าง = ทุกหมวด · id ที่ไม่ตรงกับข้อมูลชุดนี้เลย = ถือว่าไม่กรอง ไม่ใช่ส่งรายงานเปล่า
  // (เลย์เอาต์สรุปย่อไม่มีคอลัมน์ "เทียบก่อนหน้า" อยู่แล้ว showDelta จึงไม่มีผลที่นี่)
  const _allCats = (data.cats?.categories) || [];
  const _hideCats = Array.isArray(catPick) && catPick.length ? new Set(catPick.map(Number)) : null;
  const _keptCats = _hideCats ? _allCats.filter(c => !_hideCats.has(c.id)) : _allCats;
  const cats = _keptCats.length ? _keptCats : _allCats;
  const top  = ((data.top?.top) || []).slice(0, 5);
  const totalEvents = cats.reduce((s, c) => s + (c.count || 0), 0);
  // ⚠️ เดิมดึงจาก /api/stats/per-camera-counts ซึ่งบังคับ kind=people_counter /
  //    vehicle_counter — ทั้งระบบมีหมวดแบบนั้นอยู่หมวดเดียว ⇒ การ์ด "ยานพาหนะ"
  //    ขึ้น 0 ทุกไซต์มาตลอด (reproduce จริง 2026-08-21: เหตุการณ์ 528,410 แต่
  //    ยานพาหนะ 0) · บั๊กเดียวกับรายงานหลักที่แก้ไปแล้วใน a31031e แต่คนละเทมเพลต
  //    ตอนนี้บวกจาก object_group ที่ /api/stats/categories ส่งมาให้ — ตัวเลขชุด
  //    เดียวกับรายการหมวดด้านล่าง ยอดจึงตรงกันเสมอ
  const sumGroup = (g) => cats.filter(c => c.object_group === g)
                              .reduce((s, c) => s + (c.count || 0), 0);
  const pplTotal = sumGroup('Person');
  const vehTotal = sumGroup('Vehicle');

  // kpis === null means "no restriction" — that is how the interactive form and the
  // scheduler both signal it, and it is what every schedule saved before 2026-08-23
  // sends. An explicit array restricts. 'cameras' is a valid choice on the full
  // layout but compact has no such card, so it simply has no effect here.
  const showKpi = (k) => !kpis || kpis.includes(k);

  // catsort unset = leave the endpoint's own order alone. /api/stats/categories
  // returns rows ordered by sort_order, so re-sorting by count here would silently
  // reorder every schedule saved before this option existed.
  const sortedCats = !catsort ? cats
    : catsort === 'name'   ? [...cats].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'))
    : catsort === 'manual' ? [...cats].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    :                        [...cats].sort((a, b) => (b.count || 0) - (a.count || 0));

  const card = (label, value, color) => `
    <div style="flex:1;background:#f7fafc;border-radius:8px;padding:10px 12px;text-align:center">
      <div style="font-size:11px;color:#718096">${esc(label)}</div>
      <div style="font-size:22px;font-weight:800;color:${color}">${num(value)}</div>
    </div>`;

  // ทั้งแถวหายไปเลยเมื่อไม่เหลือการ์ด — ไม่ปล่อย flex container ว่างไว้ให้กินระยะห่าง
  const kpiCards = [
    ['events',   'เหตุการณ์ทั้งหมด', totalEvents, accent],
    ['people',   'คน',               pplTotal,    '#22c55e'],
    ['vehicles', 'ยานพาหนะ',         vehTotal,    '#f59e0b'],
  ].filter(([k]) => showKpi(k)).map(([, label, value, color]) => card(label, value, color)).join('');
  const kpiRow = kpiCards ? `<div style="display:flex;gap:8px">${kpiCards}</div>` : '';

  const catRows = sortedCats.map(c => `
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
  ${kpiRow}
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

// Serialize Puppeteer renders: only one _withPage body runs at a time per
// process. Prevents concurrent HTTP requests (e.g. /api/reports/pdf and
// /api/health/report/pdf arriving simultaneously) from opening multiple
// Chromium pages in parallel and spiking memory.
let _renderTail = Promise.resolve();

// Idle close: a single render pins ~700 MB of Chromium RSS inside api-server
// for the rest of the process lifetime. Reports are bursty (scheduled + manual),
// so drop the browser after an idle gap and pay the relaunch on the next one.
const BROWSER_IDLE_MS = Number(process.env.REPORT_BROWSER_IDLE_MS || 5 * 60 * 1000);
let _idleTimer = null;
function _disarmIdleClose() {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
}
function _armIdleClose() {
  _disarmIdleClose();
  _idleTimer = setTimeout(() => {
    _idleTimer = null;
    _resetBrowserPool(`idle ${BROWSER_IDLE_MS}ms`);
  }, BROWSER_IDLE_MS);
  _idleTimer.unref?.(); // never hold the process open
}

function _getBrowser() {
  if (_browserPromise) return _browserPromise;
  // `mine` identity-guards the async handlers below: _resetBrowserPool() nulls
  // _browserPromise synchronously but closes asynchronously, so a render can
  // launch a NEW browser before the old one's `disconnected` fires. A bare
  // truthiness check would then null the new browser and orphan it (~700 MB,
  // never closed). Idle-close makes that window a routine event.
  const mine = _browserPromise = puppeteer
    .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 120000 })
    .then(browser => {
      browser.on('disconnected', () => {
        if (_browserPromise === mine) {
          console.warn('[report-renderer] puppeteer browser disconnected — will relaunch on next call');
          _browserPromise = null;
        }
      });
      console.log('[report-renderer] puppeteer browser pool — launched');
      return browser;
    })
    .catch(err => {
      // Don't pin a failed promise; let the next call try again.
      if (_browserPromise === mine) _browserPromise = null;
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
  // Acquire render slot: wait for the previous render to finish, then extend
  // the chain so the next caller waits for this one.
  const ticket = _renderTail;
  let release;
  _renderTail = new Promise(r => { release = r; });
  await ticket;
  try {
    // Disarm only after winning the slot: disarming before `await ticket` would
    // let the previous render's finally re-arm the timer underneath us.
    _disarmIdleClose();
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
  } finally {
    release(); // Always release — prevents deadlock even when fn() throws.
    _armIdleClose(); // next render (already queued or later) disarms first
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
function _printPageUrl({ baseUrl, from, to, title, rangeLabel, cameras, domains, site_id,
                        kpis, secs, catsort, catsHide, catsLegacyShown, showDelta, showPct,
                        todFrom = null, todTo = null, rtype = null, anchor = null, trunc = null }) {
  const qp = new URLSearchParams({
    from: from || '', to: to || '',
    title: title || '', label: rangeLabel || '',
  });
  if (cameras && cameras.length) qp.set('cameras', cameras.join(','));
  if (domains) qp.set('domains', domains);
  if (site_id) qp.set('site_id', site_id);
  if (todFrom && todTo) {
    qp.set('tod_from', todFrom);
    qp.set('tod_to', todTo);
  }
  // ความละเอียดของกราฟแนวโน้ม (เช่น minute30 = ทุก 30 นาที) · ไม่ส่ง = ให้เซิร์ฟเวอร์เลือกตามความยาวช่วง (เดิม)
  if (trunc) qp.set('trunc', trunc);
  // CR.5 — summary reports need anchor date for the print page to compute windows
  if (rtype === 'summary' && anchor) {
    qp.set('rtype', 'summary');
    qp.set('anchor', anchor);
  }
  // ตัวเลือกของหน้ารายงาน — ไม่ส่ง = หน้าพิมพ์ใช้ค่าเริ่มต้น (แสดงครบ / เรียงมาก→น้อย)
  // ซึ่งเท่ากับพฤติกรรมเดิมทุกประการ ตารางเวลา LINE จึงไม่กระทบ
  if (kpis != null) qp.set('kpis', kpis);   // '' คือค่าที่มีความหมาย ห้ามตกหล่น
  if (secs != null) qp.set('secs', secs);   // '' คือค่าที่มีความหมาย ห้ามตกหล่น
  if (catsort) qp.set('catsort', catsort);
  // cats ไม่ส่ง = ทุกหมวด · showDelta/showPct ส่งเฉพาะตอนปิด ค่าเริ่มต้นคือเปิด
  if (catsHide && catsHide.length) qp.set('cats_hide', Array.isArray(catsHide) ? catsHide.join(',') : catsHide);
  if (catsLegacyShown && catsLegacyShown.length) qp.set('cats', Array.isArray(catsLegacyShown) ? catsLegacyShown.join(',') : catsLegacyShown);
  if (showDelta === false) qp.set('showDelta', 'false');
  if (showPct === false) qp.set('showPct', 'false');
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
async function renderReportPdf({ baseUrl, internalToken, from, to, cameras, brand, title,
                                rangeLabel, domains, site_id, footerLogoB64 = null,
                                kpis = null, secs = null, catsort = null, catsHide = null, catsLegacyShown = null, showDelta = true, showPct = true,
                                todFrom = null, todTo = null, rtype = null, anchor = null }) {
  const url = _printPageUrl({ baseUrl, from, to, title, rangeLabel, cameras, domains, site_id, kpis, secs, catsort, catsHide, catsLegacyShown, showDelta, showPct, todFrom, todTo, rtype, anchor });
  const brandName = (brand && brand.name) || 'Vision Meta Hub';
  return _withPage(async (page) => {
    await page.setExtraHTTPHeaders({ 'X-Internal-Token': internalToken });
    await page.setViewport({ width: 820, height: 1100, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForFunction('window.__reportReady === true', { timeout: 20000 });
    await page.addStyleTag({ url: `${baseUrl}/report-print-override.css` });
    return page.pdf({
      format: 'A4',
      printBackground: true,
      // bottom กว้างขึ้นเป็น 14mm เพื่อเปิดที่ให้ footer — ถ้าใช้ 8mm เท่าเดิม
      // footer จะทับเนื้อหาบรรทัดสุดท้ายของทุกหน้า
      margin: { top: '8mm', bottom: '14mm', left: '8mm', right: '8mm' },
      // footer ชุดเดียวกับ PDF ของหน้ากวดขันวินัยจราจร — แบรนด์ + โลโก้พาร์ตเนอร์
      // + เลขหน้า/จำนวนหน้า ซ้ำทุกหน้า (เจ้าของสั่ง 2026-08-21)
      // ⚠️ footerTemplate เป็นเอกสารแยกของ Chromium — สืบทอด CSS จากหน้าไม่ได้
      //    ต้องเขียน font-size/family ลงไปเอง ไม่งั้นได้ตัวจิ๋วค่า default
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#8894a6;padding:0 8mm;
        font-family:'Noto Sans Thai','Sarabun',sans-serif;display:flex;justify-content:space-between">
        <span style="display:flex;align-items:center;gap:7px">
          ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:6mm">` : ''}
          <span>${esc(brandName)}${title ? ` · ${esc(title)}` : ''}</span></span>
        <span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
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
async function renderReportImage({ baseUrl, internalToken, from, to, cameras, brand, title, rangeLabel,
                                  layout = 'compact', domains, site_id, kpis = null, secs = null, catsort = null,
                                  catsHide = null, catsLegacyShown = null, showDelta = true, showPct = true,
                                  todFrom = null, todTo = null, rtype = null, anchor = null, trunc = null }) {
  // Summary มีแต่ layout เต็ม (หน้าพิมพ์เป็นคนคำนวณ 3 ช่วง) — compact ไม่มีสาขา summary
  if (rtype === 'summary') layout = 'full';
  if (layout === 'full') {
    // domains/site_id were accepted by _printPageUrl and by renderReportPdf but
    // never forwarded from here, so the full-layout PNG silently ignored the
    // domain checkboxes and the site filter while the PDF of the same report
    // honoured them. Found 2026-08-03 while giving the Events tab a PNG button.
    // kpis/secs/catsort เพิ่ม 2026-08-21 ด้วยเหตุผลเดียวกัน — PNG กับ PDF ต้องหน้าตาเหมือนกัน
    const url = _printPageUrl({ baseUrl, from, to, title, rangeLabel, cameras, domains, site_id, kpis, secs, catsort, catsHide, catsLegacyShown, showDelta, showPct, todFrom, todTo, rtype, anchor, trunc });
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
  const data = await gatherReportData({ baseUrl, internalToken, from, to, cameras, site_id, todFrom, todTo });
  const html = renderReportCompactHtml(data, { brand, title, rangeLabel, kpis, catsort, catsHide, showDelta });
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
    uptimeAvg:'Uptime เฉลี่ยทั้งระบบ', uptimeWorstHeader:'กล้องที่ Uptime ต่ำสุด (ต่ำกว่า 99%)',
    camNeverOnlineHead:'ยังไม่เคยออนไลน์ {n} กล้อง (รอติดตั้ง/ตั้งค่า)', camNoOutage:'ไม่มีกล้องที่หลุดจากระบบในช่วงนี้',
    stEdgeSystem:'ดิสก์ระบบ', stEdgeMedia:'ดิสก์เก็บภาพ', stSnapDirs:'ภาพที่เก็บไว้', stDays:'วัน', stOldest:'เก่าสุด',
    raidOk:'ปกติ', raidDegraded:'ผิดปกติ (degraded)',
    sysEdgeLastSeen:'Edge ติดต่อล่าสุด', sysEdgeServices:'บริการบน Edge', sysEdgeOnline:'ทำงาน',
    sysEdgeBridge:'Bridge (local / remote)', sysEdgeForwarded:'ส่งต่อสะสม', sysEdgeDropped:'ตกหล่น',
    uptimeRestOk:'อีก {n} กล้องอยู่ที่ 99% ขึ้นไป', uptimeAllGood:'ทุกกล้อง Uptime 99% ขึ้นไปในช่วงนี้',
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
    uptimeAvg:'Fleet average uptime', uptimeWorstHeader:'Lowest uptime (below 99%)',
    camNeverOnlineHead:'{n} cameras have never come online (pending install/config)', camNoOutage:'No camera dropped out in this range',
    stEdgeSystem:'System disk', stEdgeMedia:'Media disk', stSnapDirs:'Snapshots retained', stDays:'days', stOldest:'oldest',
    raidOk:'healthy', raidDegraded:'DEGRADED',
    sysEdgeLastSeen:'Edge last seen', sysEdgeServices:'Edge services', sysEdgeOnline:'online',
    sysEdgeBridge:'Bridge (local / remote)', sysEdgeForwarded:'Forwarded total', sysEdgeDropped:'Dropped',
    uptimeRestOk:'{n} more cameras at 99% or above', uptimeAllGood:'Every camera at 99% or above in this range',
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

async function gatherHealthData({ baseUrl, internalToken, sections, range, site_id, site_code }) {
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
    needCameraData ? get(`/api/health/report-data/cameras?range_hours=${hours}${site_id ? `&site_id=${encodeURIComponent(site_id)}` : ''}`) : Promise.resolve(null),
    enabled.includes('alerts')  ? get(`/api/health/report-data/alerts?range_hours=${hours}`)  : Promise.resolve(null),
  ]);
  // A site-scoped report is about that site's edge box, not about central.
  // /api/health/details already returns edge_sites[] (EM4) keyed by site code,
  // so nothing new is fetched — the storage and system sections just read from
  // here instead when a site is picked. Null for the all-sites report, which is
  // genuinely about the central platform.
  const edge = site_code && Array.isArray(hrData?.edge_sites)
    ? (hrData.edge_sites.find(e => e.site_id === site_code) || null)
    : null;
  return { health: hrData, cameras: camData, alerts: alData, edge };
}

function renderHealthReportHtml(data, { brand = {}, sections, range, lang = 'th', title } = {}) {
  // Strip emoji/✓✗ from labels so this HTML (PDF) matches the SVG (PNG),
  // which runs every string through _svgSafeText. Single source of truth →
  // both renderers drop the same decorative icons (decision #144, GOTCHAS #25a).
  const L0 = HR_LABELS[lang] || HR_LABELS.th;
  const L = Object.fromEntries(Object.entries(L0).map(([k, v]) => [k, typeof v === 'string' ? _svgSafeText(v) : v]));
  const enabled = new Set(normalizeHealthSections(sections));
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'Vigil Platform';
  const h = data.health || {};
  const locale = lang === 'en' ? 'en-US' : 'th-TH';
  const dateLabel = new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const rangeLabel = range?.customLabel || L[range?.labelKey || 'range24h'];
  const genStr = new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { hour12: false });

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
      // A camera that dropped out and one that has never reported are different
      // problems: the first is an outage to chase now, the second is an install
      // that was never finished. They were printed as one list, so 34 cameras
      // that have never once been online (measured 2026-08-03 — every offline
      // camera in the fleet) filled three pages and buried any real outage.
      // Outages keep their per-camera detail; the never-online set collapses to
      // a count and a name list, which is all a provisioning backlog needs.
      const neverOnline = offlineList.filter(cam => cam.offline_for_sec === -1);
      const droppedOut  = offlineList.filter(cam => cam.offline_for_sec !== -1);
      const offlineRows = droppedOut.map(cam => {
        const subStyle = 'font-size:10px;color:#718096;margin-top:2px;padding-left:14px';
        return `<div style="padding:6px 0;border-bottom:1px solid #edf2f7;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:#ef4444">${esc(cam.name || cam.camera_id)}</span>
            <strong style="color:#ef4444">${esc(L.offlineFor)}${esc(_fmtDuration(cam.offline_for_sec))}</strong>
          </div>
          <div style="${subStyle}">${esc(L.lastOnline)}: ${esc(_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago))}</div>
        </div>`;
      }).join('');
      const neverBlock = neverOnline.length
        ? `<div style="margin-top:10px;padding:8px 10px;background:#f7fafc;border-left:3px solid #a0aec0;border-radius:4px">
             <div style="font-size:11px;color:#4a5568;font-weight:700">${esc(L.camNeverOnlineHead.replace('{n}', neverOnline.length))}</div>
             <div style="font-size:10px;color:#718096;margin-top:4px;line-height:1.6">${esc(neverOnline.map(cam => cam.name || cam.camera_id).join(' · '))}</div>
           </div>`
        : '';
      const body = summaryRows.join('') + (droppedOut.length
        ? `<div style="margin-top:8px;font-size:11px;color:#718096">${esc(L.camOfflineList)}</div>${offlineRows}`
        : `<div style="margin-top:8px;padding:8px 10px;background:#f0fdf4;color:#166534;border-radius:6px;font-size:12px">${esc(L.camNoOutage)}</div>`)
        + neverBlock;
      parts.push(sectionHtml(L.secCameraStatus, body));
    }
  }

  // ── Camera Uptime (worst offenders + fleet summary) ───────
  // Was: every camera, five detail lines each. At 143 cameras that is ~700
  // lines — 19 A4 pages, and the SVG the PNG renderer builds from the same
  // model blew past librsvg's 32767px ceiling and failed outright ("Input SVG
  // image exceeds 32767x32767 pixel limit", reproduced 2026-08-03 and visible
  // in the live log from the operator's own clicks). A report nobody can open
  // as an image and nobody reads to page 19 is not serving anyone.
  //
  // A health report answers "is anything wrong, and where". Cameras sitting at
  // 100% answer it by being absent. So: fleet numbers, then the ones actually
  // dragging the average down, with the diagnostic lines kept for exactly those.
  // The full per-camera register belongs in a CSV export, not in a picture sent
  // to LINE.
  if (enabled.has('camera_uptime')) {
    const c = data.cameras;
    if (c === null) {
      parts.push(sectionHtml(L.secCameraUptime, `<div style="color:#ef4444;padding:8px 0;font-size:12px">${esc(L.dataLoadError)}</div>`));
    } else {
      const list = Array.isArray(c.list) ? c.list : [];
      const withPct = list.filter(cam => typeof cam.uptime_pct === 'number');
      const avg = withPct.length
        ? (withPct.reduce((a, cam) => a + cam.uptime_pct, 0) / withPct.length)
        : null;
      // Worst first. "No uptime_pct" means two different things and ranking them
      // together was wrong: an ONLINE camera with no status-log entries never
      // went down, which is 100%, while an OFFLINE one has never reported at
      // all and belongs at the bottom. The first version sorted both to -1, so
      // the "below 99%" list filled up with cameras labelled 100% — caught by
      // reading the rendered page, 2026-08-03.
      const WORST_N = 10;
      const rank = (cam) => (typeof cam.uptime_pct === 'number' ? cam.uptime_pct
                            : cam.status === 'online' ? 100 : -1);
      const worst = [...list].sort((a, b) => rank(a) - rank(b))
        .filter(cam => rank(cam) < 99).slice(0, WORST_N);
      const healthy = list.length - worst.length;

      const headline = [
        row2(L.camTotal, list.length),
        row2(L.uptimeAvg, avg === null ? '—' : `${avg.toFixed(1)}%`,
          avg === null ? '#a0aec0' : avg < 90 ? '#ef4444' : avg < 99 ? '#f59e0b' : '#22c55e'),
      ].join('');

      const worstRows = worst.map(cam => {
        const upPct = cam.uptime_pct;
        const upText = (upPct === null || upPct === undefined)
          ? (cam.status === 'online' ? L.noOutageRecorded : L.uptimeNoData)
          : `${upPct}%`;
        const upColor2 = (upPct === null || upPct === undefined) ? '#a0aec0'
          : (upPct < 90 ? '#ef4444' : upPct < 99 ? '#f59e0b' : '#22c55e');
        const subStyle = 'font-size:10px;color:#718096;margin-top:2px;padding-left:14px';
        const subLines = [];
        if (cam.offline_for_sec === -1) subLines.push(`<div style="${subStyle};color:#a0aec0">${esc(L.neverOnline)}</div>`);
        subLines.push(`<div style="${subStyle}">${esc(L.heartbeatLast)}: ${esc(_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago))}</div>`);
        subLines.push(`<div style="${subStyle}${cam.last_event_at ? '' : ';color:#a0aec0'}">${esc(L.eventLast)}: ${cam.last_event_at ? esc(_fmtTimestamp(cam.last_event_at, lang, L.ago)) : esc(L.neverEvent)}</div>`);
        return `<div style="padding:5px 0;border-bottom:1px solid #edf2f7;font-size:12px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:${cam.status === 'online' ? '#2d3748' : '#ef4444'}">${esc(cam.name || cam.camera_id)}</span>
            <strong style="color:${esc(upColor2)}">${esc(upText)}</strong>
          </div>
          ${subLines.join('')}
        </div>`;
      }).join('');

      const body = headline + (worst.length
        ? `<div style="margin-top:8px;font-size:11px;color:#718096">${esc(L.uptimeWorstHeader)}</div>${worstRows}`
          + (healthy > 0 ? `<div style="margin-top:6px;font-size:11px;color:#718096">${esc(L.uptimeRestOk).replace('{n}', healthy)}</div>` : '')
        : `<div style="margin-top:8px;padding:8px 10px;background:#f0fdf4;color:#166534;border-radius:6px;font-size:12px">${esc(L.uptimeAllGood)}</div>`);
      parts.push(sectionHtml(L.secCameraUptime, body));
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
  // A report about one site describes that site's edge box. The central figures
  // below answer "how is the platform", which is not the question a Phuket
  // report is asking — reported 2026-08-03, where picking Phuket still showed
  // central's 937 GB disk and 15 GB of RAM.
  const edge = data.edge;

  if (enabled.has('storage') && edge) {
    const mounts = Array.isArray(edge.storage?.mounts) ? edge.storage.mounts : [];
    const rows = mounts.map(m => {
      const pct = m.used_pct ?? (m.total_gb > 0 ? ((m.total_gb - m.free_gb) / m.total_gb * 100) : null);
      const col = pct === null ? '#a0aec0' : pct > 85 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
      const label = m.role === 'media' ? L.stEdgeMedia : L.stEdgeSystem;
      return row2(`${label} (${m.mount})`,
        `${pct === null ? '—' : pct.toFixed(1) + '%'} (${L.stFree} ${m.free_gb ?? '—'} / ${m.total_gb ?? '—'} GB)`, col);
    });
    if (!rows.length) {
      // Older edge builds ship disk_free/total without the mount breakdown.
      const pct = edge.disk_total_gb > 0 ? ((edge.disk_total_gb - edge.disk_free_gb) / edge.disk_total_gb * 100) : null;
      rows.push(row2(L.stDisk, `${pct === null ? '—' : pct.toFixed(1) + '%'} (${L.stFree} ${edge.disk_free_gb ?? '—'} / ${edge.disk_total_gb ?? '—'} GB)`,
        pct === null ? '#a0aec0' : pct > 85 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e'));
    }
    // RAID state belongs here rather than in a footnote: a degraded array is the
    // one storage fact worth waking someone for.
    for (const r of (edge.storage?.raid || [])) {
      rows.push(row2(`RAID ${r.dev} (${r.level})`,
        `${r.degraded ? L.raidDegraded : L.raidOk} · ${r.devices_active}/${r.devices_total} · ${r.size_gb} GB`
        + (r.sync_action && r.sync_pct != null ? ` · ${r.sync_action} ${r.sync_pct}%` : ''),
        r.degraded ? '#ef4444' : '#22c55e'));
    }
    if (edge.snapshot_dirs != null) {
      rows.push(row2(L.stSnapDirs, `${edge.snapshot_dirs} ${L.stDays}`
        + (edge.snapshot_oldest ? ` (${L.stOldest} ${String(edge.snapshot_oldest).slice(0, 10)})` : '')));
    }
    parts.push(sectionHtml(L.secStorage, rows.join('')));
  } else if (enabled.has('storage')) {
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
  // An edge has no database and no API server, so RAM/DB latency/Node version
  // are not its facts to report. What it does have — and what an operator would
  // ask about — is whether its processes are up and when it last checked in.
  if (enabled.has('system') && edge) {
    const svc = Array.isArray(edge.services) ? edge.services : [];
    const down = svc.filter(x => x.status !== 'online');
    const rows = [
      row2(L.sysEdgeLastSeen, _fmtTimestamp(edge.last_seen_at, lang, L.ago), edge.stale ? '#ef4444' : '#22c55e'),
      row2(L.sysEdgeServices, `${svc.length - down.length}/${svc.length} ${L.sysEdgeOnline}`, down.length ? '#ef4444' : '#22c55e'),
      row2(L.sysEdgeBridge, `${edge.bridge_local || '—'} / ${edge.bridge_remote || '—'}`,
        (edge.bridge_local === 'up' && edge.bridge_remote === 'up') ? '#22c55e' : '#ef4444'),
      row2(L.sysEdgeForwarded, num(edge.bridge_forwarded || 0)),
    ];
    if (edge.bridge_dropped) rows.push(row2(L.sysEdgeDropped, num(edge.bridge_dropped), '#ef4444'));
    for (const x of down) rows.push(row2(`↳ ${x.name}`, x.status, '#ef4444'));
    parts.push(sectionHtml(L.secSystem, rows.join('')));
  } else if (enabled.has('system')) {
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
  <div style="border-bottom:3px solid ${esc(accent)};padding-bottom:14px;margin-bottom:20px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:14px">
        ${brand.logo_b64 ? `<img src="${brand.logo_b64}" alt="logo" style="width:56px;height:56px;object-fit:contain">` : ''}
        <div>
          <div style="font-size:22px;font-weight:700;color:#1a202c">${esc((title && String(title).trim()) || L.title)}</div>
          <div style="font-size:13px;color:#4a5568;margin-top:4px">${esc(rangeLabel)}</div>
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:#a0aec0">
        <div style="font-weight:700;color:#1a202c">${esc(brandName)}</div>
        ${brand.tagline ? `<div style="font-size:10px;color:#a0aec0">${esc(brand.tagline)}</div>` : ''}
        <div style="margin-top:3px">${esc(L.generatedAt)} ${esc(genStr)}</div>
      </div>
    </div>
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

// Shared report header for the SVG reports (Face / LPR / Health). Mirrors the
// analytics report header (dashboard/report-template.js) so every report type
// is identical apart from the title: logo + title + subtitle (left) ·
// brand / tagline / generated-at (right) · accent rule below. Draws via the
// caller's add()/text() closures and returns the next y.
function _svgReportHeader({ add, text, left, right, accent, logoB64, brandName, tagline, title, subtitle, generatedLabel, genStr, y }) {
  const logoSz = 56;
  if (logoB64) add(`<image x="${left}" y="${y}" width="${logoSz}" height="${logoSz}" href="${logoB64}" xlink:href="${logoB64}" preserveAspectRatio="xMidYMid meet"/>`);
  const tx = logoB64 ? left + logoSz + 14 : left;
  text(tx, y + 24, title, { size: 22, weight: 700, fill: '#1a202c', max: 46 });
  text(tx, y + 44, subtitle, { size: 13, fill: '#4a5568', max: 46 });
  text(right, y + 16, brandName, { size: 13, weight: 700, fill: '#1a202c', anchor: 'end', max: 30 });
  let ry = y + 31;
  if (tagline) { text(right, ry, tagline, { size: 11, fill: '#a0aec0', anchor: 'end', max: 34 }); ry += 15; }
  text(right, ry, `${generatedLabel} ${genStr}`, { size: 11, fill: '#a0aec0', anchor: 'end', max: 40 });
  const barY = y + 62;
  add(`<rect x="${left}" y="${barY}" width="${right - left}" height="3" fill="${esc(accent)}"/>`);
  return barY + 16;
}

function _renderHealthReportSvg(data, { brand = {}, sections, range, lang = 'th', title } = {}) {
  const L = HR_LABELS[lang] || HR_LABELS.th;
  const enabled = new Set(normalizeHealthSections(sections));
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'Vigil Platform';
  const h = data.health || {};
  const edge = data.edge || null;
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

  // Header (shared across all report types — see _svgReportHeader)
  const genStr = new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { hour12: false });
  y = _svgReportHeader({ add, text, left, right, accent, logoB64: brand.logo_b64, brandName, tagline: brand.tagline, title: (title && String(title).trim()) || L.title, subtitle: rangeLabel, generatedLabel: L.generatedAt, genStr, y });

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
      // Same split as the HTML branch: an outage is chased today, a camera that
      // never reported is a pending install. See the note there.
      const neverOnline = offlineList.filter(cam => cam.offline_for_sec === -1);
      const droppedOut  = offlineList.filter(cam => cam.offline_for_sec !== -1);
      row(L.camTotal, summary.total);
      row(L.camOnline, summary.online, '#22c55e');
      row(L.camOffline, summary.offline, summary.offline > 0 ? '#ef4444' : '#1a202c');
      if (droppedOut.length) {
        text(left, y, L.camOfflineList, { size: 11, fill: '#718096' });
        y += 18;
        for (const cam of droppedOut) {
          text(left, y, cameraName(cam), { size: 12, fill: '#ef4444', max: 50 });
          text(right, y, `${L.offlineFor}${_fmtDuration(cam.offline_for_sec)}`, { size: 12, weight: 700, fill: '#ef4444', anchor: 'end', max: 28 });
          y += 16;
          note(`${L.lastOnline}: ${_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago)}`);
          line(y - 4);
          y += 8;
          if (y > SVG_MAX_Y) break;
        }
      } else {
        add(`<rect x="${left}" y="${y - 3}" width="${right - left}" height="30" fill="#f0fdf4" rx="6"/>`);
        text(left + 10, y + 16, L.camNoOutage, { size: 12, fill: '#166534' });
        y += 38;
      }
      if (neverOnline.length) {
        y += 6;
        text(left, y, L.camNeverOnlineHead.replace('{n}', neverOnline.length), { size: 11, weight: 700, fill: '#4a5568' });
        y += 16;
        // Wrapped by hand: SVG text does not reflow, so a single long line would
        // run straight off the right edge of the image.
        const names = neverOnline.map(cam => cameraName(cam));
        let buf = [];
        for (const n of names) {
          buf.push(n);
          if (buf.join(' · ').length > 90) { note(buf.join(' · '), '#718096'); buf = []; }
        }
        if (buf.length) note(buf.join(' · '), '#718096');
        y += 6;
      }
    }
  }

  if (enabled.has('camera_uptime')) {
    section(L.secCameraUptime);
    if (c === null) {
      text(left, y, L.dataLoadError, { size: 12, fill: '#ef4444' });
      y += 22;
    } else {
      // Mirrors the HTML branch above: fleet numbers, then only the cameras
      // below 99%. Listing all 143 pushed this past librsvg's raster ceiling —
      // see SVG_MAX_Y for why the old y>15800 guard did not catch it.
      const list = Array.isArray(c?.list) ? c.list : [];
      const withPct = list.filter(cam => typeof cam.uptime_pct === 'number');
      const avg = withPct.length ? (withPct.reduce((a, cam) => a + cam.uptime_pct, 0) / withPct.length) : null;
      // Same ranking rule as the HTML branch — see the note there.
      const rank = (cam) => (typeof cam.uptime_pct === 'number' ? cam.uptime_pct
                            : cam.status === 'online' ? 100 : -1);
      const worst = [...list].sort((a, b) => rank(a) - rank(b)).filter(cam => rank(cam) < 99).slice(0, 10);
      const healthy = list.length - worst.length;

      row(L.camTotal, list.length);
      row(L.uptimeAvg, avg === null ? '—' : `${avg.toFixed(1)}%`,
        avg === null ? '#a0aec0' : avg < 90 ? '#ef4444' : avg < 99 ? '#f59e0b' : '#22c55e');

      if (!worst.length) {
        text(left, y, L.uptimeAllGood, { size: 12, fill: '#166534' });
        y += 22;
      } else {
        text(left, y, L.uptimeWorstHeader, { size: 11, fill: '#718096' });
        y += 18;
        for (const cam of worst) {
          const isOnline = cam.status === 'online';
          const upPct = cam.uptime_pct;
          const upText = (upPct === null || upPct === undefined)
            ? (isOnline ? L.noOutageRecorded : L.uptimeNoData) : `${upPct}%`;
          const upColor2 = (upPct === null || upPct === undefined) ? '#a0aec0'
            : (upPct < 90 ? '#ef4444' : upPct < 99 ? '#f59e0b' : '#22c55e');
          text(left, y, cameraName(cam), { size: 12, fill: isOnline ? '#2d3748' : '#ef4444', max: 52 });
          text(right, y, upText, { size: 12, weight: 700, fill: upColor2, anchor: 'end', max: 28 });
          y += 16;
          if (cam.offline_for_sec === -1) note(L.neverOnline, '#a0aec0');
          note(`${L.heartbeatLast}: ${_fmtTimestamp(cam.last_heartbeat_at, lang, L.ago)}`);
          note(`${L.eventLast}: ${cam.last_event_at ? _fmtTimestamp(cam.last_event_at, lang, L.ago) : L.neverEvent}`, cam.last_event_at ? '#718096' : '#a0aec0');
          line(y - 4);
          y += 8;
          if (y > SVG_MAX_Y) break;
        }
        if (healthy > 0) {
          text(left, y, L.uptimeRestOk.replace('{n}', healthy), { size: 11, fill: '#718096' });
          y += 20;
        }
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

  if (enabled.has('storage') && edge) {
    section(L.secStorage);
    const mounts = Array.isArray(edge.storage?.mounts) ? edge.storage.mounts : [];
    if (!mounts.length) {
      const pct = edge.disk_total_gb > 0 ? ((edge.disk_total_gb - edge.disk_free_gb) / edge.disk_total_gb * 100) : null;
      row(L.stDisk, `${pct === null ? '—' : pct.toFixed(1) + '%'} (${L.stFree} ${edge.disk_free_gb ?? '—'} / ${edge.disk_total_gb ?? '—'} GB)`,
        pct === null ? '#a0aec0' : pct > 85 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e');
    }
    for (const m of mounts) {
      const pct = m.used_pct ?? (m.total_gb > 0 ? ((m.total_gb - m.free_gb) / m.total_gb * 100) : null);
      row(`${m.role === 'media' ? L.stEdgeMedia : L.stEdgeSystem} (${m.mount})`,
        `${pct === null ? '—' : pct.toFixed(1) + '%'} (${L.stFree} ${m.free_gb ?? '—'} / ${m.total_gb ?? '—'} GB)`,
        pct === null ? '#a0aec0' : pct > 85 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e');
    }
    for (const r of (edge.storage?.raid || [])) {
      row(`RAID ${r.dev} (${r.level})`,
        `${r.degraded ? L.raidDegraded : L.raidOk} · ${r.devices_active}/${r.devices_total} · ${r.size_gb} GB`
        + (r.sync_action && r.sync_pct != null ? ` · ${r.sync_action} ${r.sync_pct}%` : ''),
        r.degraded ? '#ef4444' : '#22c55e');
    }
    if (edge.snapshot_dirs != null) {
      row(L.stSnapDirs, `${edge.snapshot_dirs} ${L.stDays}`
        + (edge.snapshot_oldest ? ` (${L.stOldest} ${String(edge.snapshot_oldest).slice(0, 10)})` : ''));
    }
  } else if (enabled.has('storage')) {
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

  if (enabled.has('system') && edge) {
    // Mirrors the HTML branch — an edge has no database or API server, so its
    // health is process state and heartbeat, not RAM and Node version.
    section(L.secSystem);
    const svc = Array.isArray(edge.services) ? edge.services : [];
    const down = svc.filter(x => x.status !== 'online');
    row(L.sysEdgeLastSeen, _fmtTimestamp(edge.last_seen_at, lang, L.ago), edge.stale ? '#ef4444' : '#22c55e');
    row(L.sysEdgeServices, `${svc.length - down.length}/${svc.length} ${L.sysEdgeOnline}`, down.length ? '#ef4444' : '#22c55e');
    row(L.sysEdgeBridge, `${edge.bridge_local || '—'} / ${edge.bridge_remote || '—'}`,
      (edge.bridge_local === 'up' && edge.bridge_remote === 'up') ? '#22c55e' : '#ef4444');
    row(L.sysEdgeForwarded, num(edge.bridge_forwarded || 0));
    if (edge.bridge_dropped) row(L.sysEdgeDropped, num(edge.bridge_dropped), '#ef4444');
    for (const x of down) row(`  ${x.name}`, x.status, '#ef4444');
  } else if (enabled.has('system')) {
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
  // The other hardcoded ceiling, and the one that actually sets the raster size:
  // 16000 logical x 2.78 (density 200 vs 72dpi) is ~44000px, past librsvg's
  // 32767 limit. Same derivation as SVG_MAX_Y so both move together.
  const height = Math.min(SVG_MAX_Y + 400, Math.max(900, y + 24));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="Sarabun, Segoe UI, Arial, sans-serif">${rows.join('')}</g>
</svg>`;
}

async function renderHealthReportImage({ baseUrl, internalToken, brand, sections, range, lang, title, site_id, site_code }) {
  const normalizedRange = _normalizeRange(range);
  const data = await gatherHealthData({ baseUrl, internalToken, sections, range: normalizedRange, site_id, site_code });
  const logo_b64 = await _fetchLogoDataUri(brand?.logo_url, internalToken);
  const svg = _renderHealthReportSvg(data, { brand: { ...brand, logo_b64 }, sections, range: normalizedRange, lang, title });
  return sharp(Buffer.from(svg), { density: REPORT_PNG_DENSITY }).png().toBuffer();
}

// ── Health Report PDF (A4 + page numbers) ────────────────────
// Same HTML template as the image, but rendered through page.pdf() with
// A4 paper, margins, and Chromium's built-in page-number footer.
// Body width is overridden to fit A4 content area (210mm - 24mm = 186mm).
async function renderHealthReportPdf({ baseUrl, internalToken, brand, sections, range, lang, title, site_id, site_code }) {
  const normalizedRange = _normalizeRange(range);
  const data = await gatherHealthData({ baseUrl, internalToken, sections, range: normalizedRange, site_id, site_code });
  const logo_b64 = await _fetchLogoDataUri(brand?.logo_url, internalToken);
  const html = renderHealthReportHtml(data, { brand: { ...brand, logo_b64 }, sections, range: normalizedRange, lang, title });
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

// Fetch the system logo and inline it as a base64 data URI — librsvg/sharp
// won't pull a remote http href, so the SVG must carry the bytes itself.
async function _fetchLogoDataUri(logoUrl, internalToken) {
  if (!logoUrl) return null;
  try {
    const r = await fetch(logoUrl, { headers: { 'X-Internal-Token': internalToken } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2_000_000) return null; // ponytail: skip absurd logos
    const ct = r.headers.get('content-type') || 'image/png';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch (e) { console.warn('[report] logo fetch:', e.message); return null; }
}

// ── Face / Person Report ─────────────────────────────────────
// Renders via HTML→Puppeteer (report-face-print.html) so the PNG/PDF match the
// on-screen preview exactly — suspect face cards included, paginated cleanly
// across A4 pages. (The old SVG path was removed once this shipped.)
function _facePrintUrl({ baseUrl, period, group, min_score, sections, lang, site_id, title, from, to }) {
  const qp = new URLSearchParams({ period: period || 'today', lang: lang || 'th' });
  if (group && group !== 'all') qp.set('group', group);
  if (min_score) qp.set('min_score', String(min_score));
  if (sections && Object.keys(sections).length) {
    const on = Object.keys(sections).filter(k => sections[k]);
    if (on.length) qp.set('sections', on.join(','));
  }
  if (period === 'custom' && from && to) { qp.set('from', from); qp.set('to', to); }
  if (site_id) qp.set('site_id', String(site_id));
  if (title) qp.set('title', String(title));
  return `${baseUrl}/report-face-print.html?${qp.toString()}`;
}

async function renderFaceReportImage({ baseUrl, internalToken, period, group, min_score, sections, lang, site_id, title, from, to }) {
  const url = _facePrintUrl({ baseUrl, period, group, min_score, sections, lang, site_id, title, from, to });
  return _withPage(async (page) => {
    await page.setExtraHTTPHeaders({ 'X-Internal-Token': internalToken });
    await page.setViewport({ width: 880, height: 1000, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // First render builds up to ~334 snapshot thumbnails server-side; the page
    // sets __reportReady once every <img> has loaded (cached on later renders).
    await page.waitForFunction('window.__reportReady === true', { timeout: 90000 });
    return page.screenshot({ type: 'png', fullPage: true });
  });
}

async function renderFaceReportPdf({ baseUrl, internalToken, period, group, min_score, sections, lang, site_id, title, from, to }) {
  const url = _facePrintUrl({ baseUrl, period, group, min_score, sections, lang, site_id, title, from, to });
  const pageLabel = lang === 'en' ? 'Page' : 'หน้า';
  return _withPage(async (page) => {
    await page.setExtraHTTPHeaders({ 'X-Internal-Token': internalToken });
    await page.setViewport({ width: 820, height: 1100, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction('window.__reportReady === true', { timeout: 90000 });
    return page.pdf({ format: 'A4', printBackground: true,
      margin: { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888;font-family:'Sarabun','Segoe UI',sans-serif;padding-bottom:4px">${pageLabel} <span class="pageNumber"></span></div>`,
      timeout: 90000 });
  });
}

// ── LPR Report ────────────────────────────────────────────────
const LPR_LABELS = {
  th: {
    title: 'รายงานป้ายทะเบียน', generatedAt: 'สร้างเมื่อ',
    pToday: 'วันนี้', pYesterday: 'เมื่อวาน', pWeek: 'สัปดาห์นี้', pMonth: 'เดือนนี้',
    secKpi: 'ภาพรวม', kpiTotal: 'ผ่านทั้งหมด', kpiUnique: 'ป้ายไม่ซ้ำ',
    kpiNoRead: 'อ่านไม่ได้', kpiIdentified: 'ระบุได้', kpiWatch: 'เฝ้าระวัง',
    secPeak: 'ช่วงเวลาหนาแน่น', peakNoData: 'ไม่มีข้อมูล',
    secProvince: 'จังหวัดสูงสุด 10 อันดับ', times: 'ครั้ง',
    secVtype: 'ประเภทรถ',
    secDirection: 'ทิศทางเข้า/ออก', dirIn: 'เข้า', dirOut: 'ออก',
    secWatch: 'รถเฝ้าระวัง', watchNoData: 'ไม่พบรายการ',
  },
  en: {
    title: 'LPR Report', generatedAt: 'Generated at',
    pToday: 'Today', pYesterday: 'Yesterday', pWeek: 'This week', pMonth: 'This month',
    secKpi: 'Overview', kpiTotal: 'Total', kpiUnique: 'Unique plates',
    kpiNoRead: 'No read', kpiIdentified: 'Identified', kpiWatch: 'Watch hits',
    secPeak: 'Peak hours', peakNoData: 'No data',
    secProvince: 'Top 10 provinces', times: 'times',
    secVtype: 'Vehicle types',
    secDirection: 'Direction in/out', dirIn: 'In', dirOut: 'Out',
    secWatch: 'Watch vehicles', watchNoData: 'None found',
  },
};

// Province + vehicle-type localization for the exported report.
//
// province-names.js is the SAME file the dashboard loads as a <script>, so the
// PNG and the on-screen preview cannot end up calling สงขลา two different
// things. Guarded: if the dashboard directory is ever absent from a deployment,
// reports keep rendering with Thai names instead of failing outright.
let _provinceNameEn = (n) => n;
try {
  ({ provinceNameEn: _provinceNameEn } = require('../dashboard/province-names.js'));
} catch (e) {
  console.warn('[report-renderer] province-names.js unavailable — provinces stay Thai:', e.message);
}
const _provName = (name, lang) => _provinceNameEn(name, lang);

// Moved to helpers/lprLabels.js — the LINE alert needs the same map, and having
// printed raw detector codes at an operator once already was enough.
const { vtypeLabel: _vtypeLabel } = require('./helpers/lprLabels');

function _renderLprReportSvg(data, { brand = {}, sections = {}, period = 'today', lang = 'th', title } = {}) {
  const L = LPR_LABELS[lang] || LPR_LABELS.th;
  const accent = brand.primary_color || '#5b8def';
  const brandName = brand.name || 'Vigil Platform';
  const locale = lang === 'en' ? 'en-US' : 'th-TH';
  const dateLabel = new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const width = 720, left = 22, right = 698;
  const rows = [];
  let y = 28;

  const add = s => rows.push(s);
  const text = (x, yy, value, opts = {}) => {
    const size = opts.size || 12, weight = opts.weight || 400;
    const fill = opts.fill || '#1a202c', anchor = opts.anchor || 'start';
    add(`<text x="${x}" y="${yy}" font-size="${size}" font-weight="${weight}" fill="${esc(fill)}" text-anchor="${anchor}">${esc(_truncateText(_svgSafeText(value), opts.max || 96))}</text>`);
  };
  const hline = (yy, color = '#edf2f7') =>
    add(`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="${esc(color)}" stroke-width="1"/>`);
  const section = title => {
    y += 16;
    text(left, y, title, { size: 13, weight: 700, fill: '#2d3748', max: 80 });
    hline(y + 8, accent);
    y += 22;
  };
  const row = (label, value, color = '#1a202c') => {
    text(left, y, label, { size: 12, fill: '#4a5568', max: 52 });
    text(right, y, value, { size: 12, weight: 700, fill: color, anchor: 'end', max: 34 });
    hline(y + 8);
    y += 22;
  };

  // Header (shared across all report types — see _svgReportHeader)
  const periodMap = { today: L.pToday, yesterday: L.pYesterday, week: L.pWeek, month: L.pMonth };
  const genStr = new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { hour12: false });
  y = _svgReportHeader({ add, text, left, right, accent, logoB64: brand.logo_b64, brandName, tagline: brand.tagline, title: (title && String(title).trim()) || L.title, subtitle: periodMap[period] || period, generatedLabel: L.generatedAt, genStr, y });

  const kpi = data.kpi || {};
  section(L.secKpi);
  row(L.kpiTotal,      num(kpi.total      || 0));
  row(L.kpiUnique,     num(kpi.unique     || 0), '#22c55e');
  row(L.kpiNoRead,     num(kpi.noread     || 0), (kpi.noread || 0) > 0 ? '#ef4444' : '#1a202c');
  row(L.kpiIdentified, num(kpi.identified || 0), '#5b8def');
  row(L.kpiWatch,      num(kpi.watch      || 0), (kpi.watch || 0) > 0 ? '#ef4444' : '#1a202c');

  if (sections.peak !== false && data.peak) {
    section(L.secPeak);
    const peak = data.peak;
    if (peak.max > 0) {
      const barW = right - left - 60;
      for (let i = 0; i < peak.labels.length; i++) {
        const v = peak.values[i] || 0;
        if (v === 0) continue;
        const bLen = Math.max(2, Math.round(v / peak.max * barW));
        add(`<rect x="${left + 50}" y="${y - 11}" width="${bLen}" height="13" fill="${esc(i === peak.index ? accent : '#cbd5e0')}" rx="2"/>`);
        text(left, y, String(peak.labels[i] || i), { size: 11, fill: '#4a5568', max: 8 });
        text(left + 50 + bLen + 4, y, String(v), { size: 10, fill: '#718096', max: 10 });
        y += 16;
        if (y > 15600) break;
      }
    } else { text(left, y, L.peakNoData, { size: 11, fill: '#a0aec0' }); y += 16; }
  }

  if (sections.province !== false) {
    section(L.secProvince);
    const provs = Array.isArray(data.province) ? data.province.slice(0, 10) : [];
    if (!provs.length) { text(left, y, '—', { size: 11, fill: '#a0aec0' }); y += 16; }
    // The API returns `name`; `region` was never on this payload, so every row
    // rendered as '—'. Both are read now so neither shape can silently blank out.
    else for (const p of provs) row(_svgSafeText(_provName(p.name || p.region, lang) || '—'), `${num(p.n)} ${L.times}`);
  }

  if (sections.vtype !== false) {
    section(L.secVtype);
    const vtypes = Array.isArray(data.vehicle_type) ? data.vehicle_type.slice(0, 8) : [];
    if (!vtypes.length) { text(left, y, '—', { size: 11, fill: '#a0aec0' }); y += 16; }
    // Raw detector codes (twoWheelVehicle, SUVMPV) were printed verbatim — not a
    // language the operator reads in either locale.
    else for (const v of vtypes) row(_svgSafeText(_vtypeLabel(v.type || v.vehicle_type, lang)), `${num(v.n)} ${L.times}`);
  }

  if (sections.direction !== false && data.direction) {
    section(L.secDirection);
    const d = data.direction;
    const inTotal  = (d.in  || []).reduce((s, v) => s + v, 0);
    const outTotal = (d.out || []).reduce((s, v) => s + v, 0);
    row(L.dirIn,  num(inTotal));
    row(L.dirOut, num(outTotal));
  }

  if (sections.watch !== false) {
    section(L.secWatch);
    const hits = Array.isArray(data.watch_hits) ? data.watch_hits.slice(0, 10) : [];
    if (!hits.length) {
      text(left, y, L.watchNoData, { size: 11, fill: '#22c55e' }); y += 16;
    } else {
      for (const h of hits) {
        const plate = _svgSafeText(h.plate_number || '—');
        const grp   = _svgSafeText(h.group_name || 'Watchlist');
        text(left, y, plate, { size: 12, fill: '#ef4444', weight: 700, max: 20 });
        text(left + 120, y, grp, { size: 11, fill: '#718096', max: 30 });
        hline(y + 8);
        y += 18;
        if (y > 15600) break;
      }
    }
  }

  y += 8; hline(y); y += 18;
  text(left, y, `${L.generatedAt} ${new Date().toLocaleString(locale, { hour12: false })}`, { size: 10, fill: '#a0aec0', max: 58 });
  text(right, y, '(c) 2025-2026 DojoJin Tech', { size: 10, fill: '#a0aec0', anchor: 'end', max: 40 });
  const height = Math.min(16000, Math.max(600, y + 24));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="Sarabun, Segoe UI, Arial, sans-serif">${rows.join('')}</g></svg>`;
}

async function renderLprReportImage({ baseUrl, internalToken, brand, period, group, sections, lang, site_id, title, from, to }) {
  const qs = new URLSearchParams({ period: period || 'today', lang: lang || 'th' });
  if (group && group !== 'all') qs.set('group', group);
  if (period === 'custom' && from && to) { qs.set('from', from); qs.set('to', to); }
  if (site_id) qs.set('site_id', String(site_id));
  let data = {};
  try {
    const r = await fetch(`${baseUrl}/api/stats/lpr/report?${qs}`, { headers: { 'X-Internal-Token': internalToken } });
    if (r.ok) data = await r.json();
    // ไม่งั้นรูปออกมาเป็นศูนย์ทั้งหน้าเงียบ ๆ — 18 ก.ย.–6 ต.ค. API ตอบ 500 โดยไม่มีใครเห็น
    else console.warn(`[lpr-report] /api/stats/lpr/report ${r.status} — rendering empty report`);
  } catch (e) { console.warn('[lpr-report] fetch:', e.message); }
  const logo_b64 = await _fetchLogoDataUri(brand?.logo_url, internalToken);
  const svg = _renderLprReportSvg(data, { brand: { ...brand, logo_b64 }, sections: sections || {}, period: period || 'today', lang: lang || 'th', title });
  return sharp(Buffer.from(svg), { density: REPORT_PNG_DENSITY }).png().toBuffer();
}

async function renderLprReportPdf(opts) {
  const png = await renderLprReportImage(opts);
  const b64 = png.toString('base64');
  const pageLabel = opts.lang === 'en' ? 'Page' : 'หน้า';
  return _withPage(async (page) => {
    // max-height keeps the whole image on ONE A4 page (object-fit:contain
    // scales it down a hair instead of spilling a near-blank page 2).
    // ponytail: report content is capped (~1 page) so contain never over-shrinks.
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0"><img src="data:image/png;base64,${b64}" style="display:block;width:100%;height:auto;max-height:273mm;object-fit:contain;margin:0 auto"></body></html>`, { waitUntil: 'domcontentloaded' });
    return page.pdf({ format: 'A4', printBackground: true, margin: { top: '8mm', bottom: '12mm', left: '8mm', right: '8mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#888;font-family:'Sarabun','Segoe UI',sans-serif;padding-bottom:4px">${pageLabel} <span class="pageNumber"></span></div>`,
      timeout: 60000 });
  });
}

// ── รายงาน "อันดับไม่สวมหมวกนิรภัย" สำหรับเจ้าหน้าที่ใช้ประกอบการออกใบสั่ง ──
// หน้า 1 = สรุปอันดับ · หน้าถัดไป = หลักฐานคันละ 1 หน้า
// ภาพดึงผ่าน /snapshots ของเราเอง โดย Puppeteer แนบ X-Internal-Token
// (viewGuard ปล่อยผ่านเมื่อเป็น internal — ดู helpers/viewGuard.js)
async function renderHelmetTopPdf({ baseUrl, internalToken, rows, periodLabel, brand = {},
                                   logoB64 = null, footerLogoB64 = null, totalInRanks = null }) {
  const th = (d) => new Date(d).toLocaleString('th-TH', { day: '2-digit', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const PC = { white: 'ขาว (รถส่วนบุคคล)', yellow: 'เหลือง (รับจ้าง)', green: 'เขียว',
    red: 'แดง (ป้ายแดง)', black: 'ดำ', blue: 'น้ำเงิน' };
  const img = (p) => (p ? `${baseUrl}/snapshots/${encodeURI(p)}` : null);
  // ภาพหลักฐานต้องมีกรอบรอบตัวรถ เหมือนที่เห็นใน modal — server ฝังกรอบให้เมื่อขอ
  // ?bbox=1&eid=<event id> (api-server.js:695) · alarm=1 ทำให้กรอบเป็นสีแดง
  // ถ้าไม่ส่งพารามิเตอร์นี้จะได้ภาพเปล่า แล้วเจ้าหน้าที่ต้องไล่หาเองว่าคันไหน
  const scenePath = (p, eid) => (p
    ? `${baseUrl}/snapshots/${encodeURI(p)}?bbox=1&alarm=1${eid != null ? `&eid=${encodeURIComponent(eid)}` : ''}`
    : null);

  // จังหวัดบนเอกสารนี้เป็นเสียงข้างมากของสิ่งที่กล้องอ่านได้ ไม่ใช่ทะเบียนราษฎร์
  // ถ้าคันไหนกล้องยังอ่านไม่ตรงกันจนมีนัยสำคัญ ต้องกำกับไว้ — ระบุจังหวัดผิดในใบสั่ง
  // = ไปโดนคนละคัน · ใช้ * แล้วอธิบายท้ายตาราง เพราะเอกสารพิมพ์ออกมาไม่มี hover
  const provCell = (r) => esc(r.province || '-') + (r.provinceAlt ? '<sup class="amb">*</sup>' : '');
  const ambRows = rows.filter((r) => r.provinceAlt);
  const ambNote = ambRows.length
    ? `<div class="ambnote"><b>* จังหวัดยังไม่นิ่ง</b> — กล้องอ่านจังหวัดของคันที่มีเครื่องหมายนี้
        ไม่ตรงกันอย่างมีนัยสำคัญ <b>ต้องยืนยันจังหวัดก่อนออกใบสั่ง</b><br>${
        ambRows.map((r) => `${esc(r.plate)}: ${esc(r.province)} แต่อ่านเป็น ${esc(r.provinceAlt)}
          อยู่ ${r.provinceAltPct}% ของครั้งที่อ่านจังหวัดออก`).join(' · ')}</div>`
    : '';

  const summary = rows.map((r, i) => `<tr>
    <td class="c">${i + 1}</td><td class="pl">${esc(r.plate)}</td>
    <td class="c">${provCell(r)}</td>
    <td class="c hit">${r.hits}</td><td class="c">${r.cams}</td>
    <td>${esc(r.camName || '-')}<br><span class="dim">${esc(r.camera || '')}</span></td>
    <td class="nw">${r.at ? th(r.at) : '-'}</td></tr>`).join('');

  const pages = rows.map((r, i) => {
    // route ดึงภาพมาให้แล้วเป็น base64 (กรอบรถฝังมาแล้ว) — ไม่ให้ Puppeteer ไปโหลดเอง
    const scene = r.sceneB64 ? `data:image/jpeg;base64,${r.sceneB64}` : scenePath(r.scene, r.eventId);
    const plate = r.plateB64 ? `data:image/jpeg;base64,${r.plateB64}` : img(r.plateImg);
    return `<section class="ev">
      <div class="evh"><span class="rk">อันดับ ${i + 1}</span><span class="pl2">${esc(r.plate)}</span>
        <span class="meta"><b>ทำผิดซ้ำ ${r.hits} ครั้ง</b> ใน ${r.cams} จุดตรวจจับ</span></div>
      <div class="shot"><div class="lab">ภาพหลักฐาน — ผู้ขับขี่ไม่สวมหมวกนิรภัย
        <span class="hint">ตรวจสอบศีรษะผู้ขับขี่ก่อนยืนยัน</span></div>
        ${scene ? `<img class="big" src="${scene}">` : '<div class="no">ไม่พบภาพเต็มในระบบ</div>'}</div>
      <div class="low">
        <div class="shot"><div class="lab">ภาพป้ายทะเบียนจากกล้อง</div>
          ${plate ? `<img src="${plate}">` : '<div class="no">ไม่พบภาพป้าย</div>'}</div>
        <table class="facts">
          <tr><th>ป้ายทะเบียน</th><td><b>${esc(r.plate)}</b></td><th>สีป้าย</th>
              <td>${esc(PC[r.plateColor] || r.plateColor || '-')}</td></tr>
          <tr><th>ประเภทรถ</th><td>รถจักรยานยนต์</td><th>จังหวัด</th><td>${esc(r.province || '-')}${
            r.provinceAlt ? `<br><span class="amb">ยังไม่นิ่ง — อ่านเป็น ${esc(r.provinceAlt)}
              อยู่ ${r.provinceAltPct}% ต้องยืนยันก่อนออกใบสั่ง</span>` : ''}</td></tr>
          <tr><th>วันเวลาที่ตรวจพบ</th><td colspan="3"><b>${r.at ? th(r.at) : '-'}</b></td></tr>
          <tr><th>จุดตรวจจับ</th><td colspan="3">${esc(r.camName || '-')}
              <span class="dim">· ${esc(r.camera || '')}</span></td></tr>
          <tr><th>ข้อกล่าวหา</th><td colspan="3">ขับขี่รถจักรยานยนต์โดย<b>ไม่สวมหมวกนิรภัย</b>
              <span class="dim">· พ.ร.บ.จราจรทางบก พ.ศ. 2522 มาตรา 122</span></td></tr>
          <tr><th>เลขอ้างอิง</th><td colspan="3">${esc(String(r.eventId ?? '-'))}
              <span class="dim">· ใช้ค้นในหน้าป้ายทะเบียนได้โดยพิมพ์เลขนี้ในช่องค้นหา</span></td></tr>
        </table>
      </div>
      <div class="sign">ผู้ตรวจสอบภาพ ............................................. วันที่ ................
        <div class="chk">☐ ข้อมูลถูกต้อง &nbsp;&nbsp;&nbsp; ☐ ข้อมูลไม่ชัดเจน</div></div>
    </section>`;
  }).join('');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 12mm 11mm 14mm; }
    *{box-sizing:border-box} body{margin:0;font-family:"Noto Sans Thai","Sarabun",sans-serif;
      font-size:10.5pt;color:#16202b;line-height:1.55}
    h1{font-size:16pt;margin:0 0 3px} .sub{font-size:9.5pt;color:#55627a}
    .hd{border-bottom:3px solid #1678d4;padding-bottom:9px;margin-bottom:11px}
    .hdrow{display:flex;align-items:center;gap:12px}
    .hdrow .lg{height:40px;width:auto}
    .bn{font-size:13pt;font-weight:800}
    .warn{border:1px solid #a32626;background:#fbe9e9;color:#7d1d1d;border-radius:5px;
      padding:8px 11px;font-size:9pt;margin:10px 0 12px;line-height:1.7}
    /* จังหวัดยังไม่นิ่ง — สีเตือน ไม่ใช่สีผิด: ป้ายถูก แต่จังหวัดยังต้องยืนยัน */
    .amb{color:#8a5a00;font-weight:700}
    .ambnote{border:1px solid #e6c98a;background:#fdf7ea;color:#6b4600;border-radius:5px;
      padding:7px 10px;font-size:8.5pt;margin:8px 0 12px;line-height:1.6}
    table{width:100%;border-collapse:collapse;font-size:9.5pt}
    th,td{border:1px solid #d8dee6;padding:5px 7px;text-align:left;vertical-align:top}
    thead th{background:#eef3fb;font-weight:700}
    td.c{text-align:center} td.nw{white-space:nowrap}
    .hit{font-weight:800;color:#a32626} .pl{font-weight:800;font-size:11pt}
    .dim{color:#55627a;font-size:8.5pt;font-weight:400}
    .ev{page-break-before:always}
    .evh{display:flex;align-items:baseline;gap:12px;border-bottom:2px solid #1678d4;
      padding-bottom:7px;margin-bottom:10px}
    .rk{background:#a32626;color:#fff;font-weight:800;font-size:10pt;padding:3px 10px;border-radius:4px}
    .pl2{font-size:20pt;font-weight:800;letter-spacing:1px}
    .meta{margin-left:auto;font-size:9pt;color:#55627a}
    .shot{border:1px solid #d8dee6;border-radius:5px;padding:7px}
    .lab{font-size:8pt;font-weight:700;color:#55627a;margin-bottom:5px;text-transform:uppercase}
    .hint{font-weight:400;text-transform:none;color:#a32626;margin-left:6px}
    .shot img{width:100%;display:block;border-radius:3px}
    img.big{max-height:118mm;object-fit:contain;background:#f3f5f8}
    .low{display:grid;grid-template-columns:178px 1fr;gap:9px;align-items:start;margin-top:9px}
    .facts{table-layout:fixed} .facts th{width:88px;background:#f6f8fa;font-size:8.5pt}
    .facts td{font-size:9pt;word-break:break-word}
    .no{padding:26px 8px;text-align:center;font-size:8.5pt;color:#55627a;background:#f3f5f8;border-radius:3px}
    .sign{margin-top:11px;border-top:1px dashed #b9c2ce;padding-top:9px;font-size:9pt}
    .chk{margin-top:6px}
  </style></head><body>
  <div class="hd"><div class="hdrow">
    ${logoB64 ? `<img class="lg" src="data:image/png;base64,${logoB64}">` : ''}
    <div><div class="bn">${esc(brand.name || 'Vision Meta Hub')}</div>
    <h1>รายงานผู้ทำผิดซ้ำ — ไม่สวมหมวกนิรภัย</h1>
    <div class="sub">สำหรับเจ้าหน้าที่ใช้ประกอบการพิจารณาออกใบสั่ง · ช่วงข้อมูล ${esc(periodLabel)}
      · <b>เจาะลึก ${rows.length} คันที่ทำผิดถี่ที่สุด</b>${totalInRanks && totalInRanks > rows.length
        ? ` จากทั้งหมด ${totalInRanks} คันใน 10 อันดับ — ต้องการครบทุกคันให้ใช้ปุ่ม “ตารางพร้อมภาพ”` : ''}</div>
    </div></div></div>
  <div class="warn"><b>ข้อควรทราบก่อนใช้รายงานนี้</b><br>
    1. ข้อมูลนี้มาจาก<b>การตรวจจับอัตโนมัติ</b> ยังไม่ใช่การยืนยันความผิด
       ต้อง<b>ตรวจสอบภาพหลักฐานทุกใบอีกครั้ง</b>
       (ระบบอาจอ่านป้ายผิด หรือระบุผู้ไม่สวมหมวกคลาดเคลื่อนได้)<br>
    2. เอกสารนี้มี<b>ข้อมูลส่วนบุคคล</b> — จำกัดการเผยแพร่ตาม PDPA</div>
  <table><thead><tr><th style="width:34px" class="c">อันดับ</th><th style="width:92px">ป้ายทะเบียน</th>
    <th style="width:70px" class="c">จังหวัด</th>
    <th style="width:48px" class="c">ครั้ง</th><th style="width:44px" class="c">จุดที่พบ</th>
    <th>จุดตรวจจับ</th><th style="width:140px">วันเวลาที่ตรวจพบ</th></tr></thead>
    <tbody>${summary}</tbody></table>
  ${ambNote}
  ${pages}</body></html>`;

  return _withPage(async (page) => {
    if (internalToken) await page.setExtraHTTPHeaders({ 'X-Internal-Token': internalToken });
    // ภาพฝังเป็น base64 มาแล้ว ไม่มี request ออกนอก จึงรอแค่ DOM
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 90000 });
    return page.pdf({ format: 'A4', printBackground: true,
      margin: { top: '12mm', right: '11mm', bottom: '14mm', left: '11mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#8894a6;padding:0 11mm;
        font-family:'Noto Sans Thai',sans-serif;display:flex;justify-content:space-between">
        <span style="display:flex;align-items:center;gap:7px">
          ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:6mm">` : ''}
          <span>${esc(brand.name || 'Vision Meta Hub')} · รายงานไม่สวมหมวกนิรภัย</span></span>
        <span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
      timeout: 90000 });
  }, { timeout: 120000 });
}


// ============================================================
// รายงานแบบตาราง — 2 แบบในตัวเดียว (ข้อความล้วน / มีภาพ)
// แนวนอน A4 · หนึ่งแถวต่อหนึ่งคัน · ครอบคลุมทุกคันใน 10 อันดับ ไม่ใช่แค่ 10 คัน
// โลโก้ 2 ตัวตามที่เจ้าของกำหนด: หัวกระดาษ = โลโก้ของแพลตฟอร์มเอง (branding/logo.png)
// ท้ายกระดาษมุมขวา = โลโก้คู่ค้า (branding/logo-partner.png) ถ้าไม่มีไฟล์ให้เว้นว่าง
// ห้ามปล่อยเป็นกรอบรูปแตก
// ============================================================
async function renderHelmetTablePdf({ rows, periodLabel, brand = {}, withImages = false, total = null,
                                      logoB64 = null, footerLogoB64 = null, criteriaNote = '' }) {
  const th = (d) => new Date(d).toLocaleString('th-TH', { day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const PC = { white: 'ป้ายขาว (รถส่วนบุคคล)', yellow: 'ป้ายเหลือง (รับจ้าง)', green: 'ป้ายเขียว',
    red: 'ป้ายแดง', black: 'ป้ายดำ', blue: 'ป้ายน้ำเงิน' };
  const cell = (b64, cls) => (b64
    ? `<img class="${cls}" src="data:image/jpeg;base64,${b64}">`
    : '<span class="nodata">ไม่มีภาพ</span>');

  const head = [
    ['วัน-เวลาที่ตรวจพบ', 'w-dt'], ['ป้ายทะเบียน', 'w-pl'], ['จังหวัด', 'w-pv'],
    ['ประเภทรถ', 'w-vt'], ['สีป้าย', 'w-pc'], ['หมวกนิรภัย', 'w-hm'], ['คนซ้อนท้าย', 'w-ps'],
    ['ทำผิดซ้ำ', 'w-n'], ['จุดตรวจจับที่พบ', 'w-cn'],
    ['จุดตรวจจับ', 'w-cam'], ['Camera ID', 'w-cid'],
  ].concat(withImages ? [['รูปป้ายทะเบียน', 'w-i1'], ['รูปตัวรถ', 'w-i2'], ['รูปเต็ม', 'w-i3']] : []);

  const body = rows.map((r, i) => `<tr>
    <td class="nw">${r.at ? th(r.at) : '-'}</td>
    <td class="pl">${esc(r.plate)}</td>
    <td>${esc(r.province || '-')}${r.provinceAlt ? '<sup class="amb">*</sup>' : ''}</td>
    <td>รถจักรยานยนต์</td>
    <td>${esc(PC[r.plateColor] || r.plateColor || '-')}</td>
    <td class="bad">ไม่สวม</td>
    <td class="c">${r.pillion === 'yes' ? 'มี' : '-'}</td>
    <td class="c"><b>${r.hits}</b> ครั้ง</td>
    <td class="c">${r.cams} จุด</td>
    <td>${esc(r.camName || '-')}</td>
    <td class="dim">${esc(r.camera || '-')}</td>
    ${withImages ? `<td class="im">${cell(r.plateB64, 'ip')}</td>
    <td class="im">${cell(r.vehicleB64, 'iv')}</td>
    <td class="im">${cell(r.sceneB64, 'is')}</td>` : ''}
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
  <style>
    @page{size:A4 landscape}
    *{box-sizing:border-box}
    body{font-family:'Noto Sans Thai','Sarabun',sans-serif;color:#16191d;margin:0;font-size:8pt}
    .hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1678d4;
        padding-bottom:8px;margin-bottom:9px}
    .hd img{height:34px;width:auto}
    .hd .tx{flex:1}
    .bn{font-size:9.5pt;font-weight:700;color:#1678d4;letter-spacing:.3px}
    h1{font-size:15pt;margin:1px 0 2px;font-weight:800}
    .sub{font-size:8pt;color:#55627a}
    .warn{border:1px solid #f0c2c2;background:#fdf4f4;border-radius:5px;padding:7px 10px;
      font-size:7.5pt;color:#7a2020;margin-bottom:9px;line-height:1.5}
    .amb{color:#8a5a00;font-weight:700}
    .ambnote{border:1px solid #e6c98a;background:#fdf7ea;color:#6b4600;border-radius:5px;
      padding:7px 10px;font-size:7.5pt;margin-top:9px;line-height:1.5}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th{background:#eef4fb;color:#20456e;font-size:7.5pt;font-weight:700;
       border:1px solid #c9d6e4;padding:5px 4px;text-align:center}
    td{border:1px solid #dbe2ea;padding:4px 5px;vertical-align:middle;font-size:7.5pt;
       word-break:break-word}
    tbody tr:nth-child(even) td{background:#fafbfc}
    .c{text-align:center} .nw{white-space:nowrap;text-align:center}
    .pl{font-weight:800;font-size:9pt;letter-spacing:.4px;text-align:center}
    .bad{color:#c62828;font-weight:800;text-align:center}
    .dim{color:#8894a6;font-size:7pt;text-align:center}
    .nodata{color:#aab3c0;font-size:6.5pt}
    .im{text-align:center;padding:3px}
    .im img{display:block;margin:0 auto;border-radius:2px;background:#eef1f4}
    .ip{max-width:100%;max-height:16mm;object-fit:contain}
    .iv{max-width:100%;max-height:26mm;object-fit:contain}
    .is{max-width:100%;max-height:26mm;object-fit:contain}
    .w-dt{width:74px}.w-pl{width:62px}.w-pv{width:52px}.w-vt{width:56px}.w-pc{width:70px}
    .w-hm{width:42px}.w-ps{width:38px}.w-n{width:44px}.w-cn{width:44px}
    .w-cam{width:120px}.w-cid{width:82px}
    .w-i1{width:74px}.w-i2{width:66px}.w-i3{width:104px}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
  </style></head><body>
  <div class="hd">
    ${logoB64 ? `<img src="data:image/png;base64,${logoB64}">` : ''}
    <div class="tx"><div class="bn">${esc(brand.name || 'Vision Meta Hub')}</div>
      <h1>รายงานผู้ทำผิดซ้ำ — ไม่สวมหมวกนิรภัย${withImages ? ' (พร้อมภาพหลักฐาน)' : ''}</h1>
      <div class="sub">สำหรับเจ้าหน้าที่ใช้ประกอบการพิจารณาออกใบสั่ง · ช่วงข้อมูล ${esc(periodLabel)}
        · ${total && total > rows.length
             ? `แสดง <b>${rows.length}</b> คันแรก จากทั้งหมด <b>${total}</b> คัน`
             : `ทั้งหมด <b>${rows.length}</b> คัน`}</div></div>
  </div>
  <div class="warn"><b>ข้อควรทราบ</b> — ข้อมูลจาก<b>การตรวจจับอัตโนมัติ</b> ยังไม่ใช่การยืนยันความผิด
    ต้องตรวจสอบภาพหลักฐานอีกครั้งก่อนออกใบสั่ง (ระบบอาจอ่านป้ายผิด หรือระบุผู้ไม่สวมหมวกคลาดเคลื่อนได้)
    · เอกสารนี้มี<b>ข้อมูลส่วนบุคคล</b> จำกัดการเผยแพร่ตาม PDPA</div>
  <table><thead><tr>${head.map(([t, c]) => `<th class="${c}">${esc(t)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table>
  ${rows.some((r) => r.provinceAlt)
    ? `<div class="ambnote"><b>* จังหวัดยังไม่นิ่ง</b> — กล้องอ่านจังหวัดของคันที่มีเครื่องหมายนี้
        ไม่ตรงกันอย่างมีนัยสำคัญ <b>ต้องยืนยันจังหวัดก่อนออกใบสั่ง</b><br>${
        rows.filter((r) => r.provinceAlt).map((r) => `${esc(r.plate)}: ${esc(r.province)}
          แต่อ่านเป็น ${esc(r.provinceAlt)} อยู่ ${r.provinceAltPct}% ของครั้งที่อ่านจังหวัดออก`)
          .join(' · ')}</div>`
    : ''}
  </body></html>`;

  return _withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 120000 });
    return page.pdf({ format: 'A4', landscape: true, printBackground: true,
      margin: { top: '10mm', right: '8mm', bottom: '15mm', left: '8mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:7pt;color:#8894a6;padding:0 8mm;
        font-family:'Noto Sans Thai',sans-serif;display:flex;align-items:center;
        justify-content:space-between">
        <span style="display:flex;align-items:center;gap:7px">
          ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:6mm">` : ''}
          <span>${esc(brand.name || 'Vision Meta Hub')} · รายงานไม่สวมหมวกนิรภัย</span></span>
        <span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
      timeout: 120000 });
  }, { timeout: 240000 });
}


// ============================================================
// รายงาน "รถบรรทุกวิ่งในช่วงห้าม" (demo /others/demo/truck-ban/ · เจ้าของสั่ง 2026-11-02)
// โครงเดียวกับรายงานหมวกนิรภัยสองตัวข้างบน (เจาะลึก 10 คัน · ตารางข้อความ/พร้อมภาพ) — light เสมอ
// แถว (routes/lpr-list.js tbPdf): plate · n · cams[] · camNames[] · region · last · ev (ใบหลักฐาน) · *B64
// ============================================================
const TB_TITLE = 'รายงานรถบรรทุกวิ่งในช่วงห้าม';
const TB_WIN_TH = { am: 'ช่วงเช้า 06:00–09:00', pm: 'ช่วงเย็น 16:00–19:00' };
const TB_VT_TH = { truck: 'รถบรรทุก', buggy: 'รถบรรทุกเล็ก' };
const TB_PC_TH = { white: 'ขาว (ส่วนบุคคล)', yellow: 'เหลือง (รับจ้าง)', green: 'เขียว', red: 'แดง (ป้ายแดง)', black: 'ดำ', blue: 'น้ำเงิน' };
const tbFmtPlate = (p) => (/^\d{6}$/.test(p) ? p.slice(0, 2) + '-' + p.slice(2) : /^\d{7}$/.test(p) ? p.slice(0, 3) + '-' + p.slice(3) : String(p || ''));
const tbTh = (d) => new Date(d).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const tbCams = (r, max = 3) => esc(r.camNames.slice(0, max).join(', ')) + (r.camNames.length > max ? ` +${r.camNames.length - max}` : '');
const tbFooter = (brand, footerLogoB64, pad) => `<div style="width:100%;font-size:7.5pt;color:#8894a6;padding:0 ${pad};
  font-family:'Noto Sans Thai',sans-serif;display:flex;align-items:center;justify-content:space-between">
  <span style="display:flex;align-items:center;gap:7px">
    ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:6mm">` : ''}
    <span>${esc(brand.name || 'Vision Meta Hub')} · ${TB_TITLE}</span></span>
  <span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
// ระบบแยกจำนวนเพลา/ล้อไม่ได้ ⇒ ต้องบอกบนกระดาษทุกฉบับ (truck-ban-data.js) — กันออกใบสั่งให้รถหกล้อ
const TB_WARN = `ข้อมูลจาก<b>การตรวจจับอัตโนมัติ</b> ยังไม่ใช่การยืนยันความผิด — ระบบ<b>แยกจำนวนเพลา/ล้อไม่ได้</b>
  ต้องตรวจจากภาพว่าเป็นรถบรรทุกที่อยู่ในข้อห้ามจริง และระบบอาจอ่านป้ายผิดได้
  · เอกสารนี้มี<b>ข้อมูลส่วนบุคคล</b> จำกัดการเผยแพร่ตาม PDPA`;

async function renderTruckBanTopPdf({ rows, periodLabel, criteriaNote = '', brand = {},
                                      logoB64 = null, footerLogoB64 = null, totalInRanks = null }) {
  const summary = rows.map((r, i) => `<tr>
    <td class="c">${i + 1}</td><td class="pl">${esc(tbFmtPlate(r.plate))}</td>
    <td class="c">${esc(r.region || '-')}</td>
    <td class="c hit">${r.n}</td><td>${tbCams(r)}</td>
    <td class="nw">${r.last ? tbTh(r.last) : '-'}</td></tr>`).join('');

  const pages = rows.map((r, i) => {
    const ev = r.ev || {};
    const scene = r.sceneB64 ? `data:image/jpeg;base64,${r.sceneB64}` : null;
    const plate = r.plateB64 ? `data:image/jpeg;base64,${r.plateB64}` : null;
    return `<section class="ev">
      <div class="evh"><span class="rk">อันดับ ${i + 1}</span><span class="pl2">${esc(tbFmtPlate(r.plate))}</span>
        <span class="meta"><b>วิ่งในช่วงห้าม ${r.n} ครั้ง</b> · ${r.cams.length} จุดตรวจจับ</span></div>
      <div class="shot"><div class="lab">ภาพหลักฐาน — รถบรรทุกวิ่งในช่วงห้าม
        <span class="hint">ตรวจขนาดรถ (จำนวนเพลา/ล้อ) ก่อนยืนยัน</span></div>
        ${scene ? `<img class="big" src="${scene}">` : '<div class="no">ไม่พบภาพเต็มในระบบ</div>'}</div>
      <div class="low">
        <div class="shot"><div class="lab">ภาพป้ายทะเบียนจากกล้อง</div>
          ${plate ? `<img src="${plate}">` : '<div class="no">ไม่พบภาพป้าย</div>'}</div>
        <table class="facts">
          <tr><th>ป้ายทะเบียน</th><td><b>${esc(tbFmtPlate(r.plate))}</b></td><th>สีป้าย</th>
              <td>${esc(TB_PC_TH[ev.plateColor] || ev.plateColor || '-')}</td></tr>
          <tr><th>ประเภทรถ</th><td>${esc(TB_VT_TH[ev.vt] || ev.vt || '-')}</td><th>จังหวัด</th><td>${esc(r.region || '-')}</td></tr>
          <tr><th>วันเวลาในภาพ</th><td colspan="3"><b>${ev.at ? tbTh(ev.at) : '-'}</b>
              <span class="dim">· ${esc(TB_WIN_TH[ev.win] || '')}</span></td></tr>
          <tr><th>จุดตรวจจับ</th><td colspan="3">${esc(ev.camName || '-')}
              <span class="dim">· ${esc(ev.camera || '')}</span></td></tr>
          <tr><th>จุดที่พบทั้งหมด</th><td colspan="3">${esc(r.camNames.join(', '))}</td></tr>
          <tr><th>เลขอ้างอิง</th><td colspan="3">${esc(String(ev.eventId ?? '-'))}
              <span class="dim">· ใช้ค้นในหน้าป้ายทะเบียนได้โดยพิมพ์เลขนี้ในช่องค้นหา</span></td></tr>
        </table>
      </div>
      <div class="sign">ผู้ตรวจสอบภาพ ............................................. วันที่ ................
        <div class="chk">[ &nbsp; ] ข้อมูลถูกต้อง &nbsp;&nbsp;&nbsp; [ &nbsp; ] ข้อมูลไม่ชัดเจน</div></div>
    </section>`;
  }).join('');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 12mm 11mm 14mm; }
    *{box-sizing:border-box} body{margin:0;font-family:"Noto Sans Thai","Sarabun",sans-serif;
      font-size:10.5pt;color:#16202b;line-height:1.55;background:#fff}
    h1{font-size:16pt;margin:0 0 3px} .sub{font-size:9.5pt;color:#55627a}
    .hd{border-bottom:3px solid #1678d4;padding-bottom:9px;margin-bottom:11px}
    .hdrow{display:flex;align-items:center;gap:12px} .hdrow .lg{height:40px;width:auto}
    .bn{font-size:13pt;font-weight:800}
    .warn{border:1px solid #a32626;background:#fbe9e9;color:#7d1d1d;border-radius:5px;
      padding:8px 11px;font-size:9pt;margin:10px 0 12px;line-height:1.7}
    .crit{font-size:8.5pt;color:#55627a;margin:0 0 10px}
    table{width:100%;border-collapse:collapse;font-size:9.5pt}
    th,td{border:1px solid #d8dee6;padding:5px 7px;text-align:left;vertical-align:top}
    thead th{background:#eef3fb;font-weight:700}
    td.c{text-align:center} td.nw{white-space:nowrap}
    .hit{font-weight:800;color:#a32626} .pl{font-weight:800;font-size:11pt;white-space:nowrap}
    .dim{color:#55627a;font-size:8.5pt;font-weight:400}
    .ev{page-break-before:always}
    .evh{display:flex;align-items:baseline;gap:12px;border-bottom:2px solid #1678d4;padding-bottom:7px;margin-bottom:10px}
    .rk{background:#a32626;color:#fff;font-weight:800;font-size:10pt;padding:3px 10px;border-radius:4px}
    .pl2{font-size:20pt;font-weight:800;letter-spacing:1px}
    .meta{margin-left:auto;font-size:9pt;color:#55627a}
    .shot{border:1px solid #d8dee6;border-radius:5px;padding:7px}
    .lab{font-size:8pt;font-weight:700;color:#55627a;margin-bottom:5px}
    .hint{font-weight:400;color:#a32626;margin-left:6px}
    .shot img{width:100%;display:block;border-radius:3px}
    img.big{max-height:118mm;object-fit:contain;background:#f3f5f8}
    .low{display:grid;grid-template-columns:178px 1fr;gap:9px;align-items:start;margin-top:9px}
    .facts{table-layout:fixed} .facts th{width:96px;background:#f6f8fa;font-size:8.5pt}
    .facts td{font-size:9pt;word-break:break-word}
    .no{padding:26px 8px;text-align:center;font-size:8.5pt;color:#55627a;background:#f3f5f8;border-radius:3px}
    .sign{margin-top:11px;border-top:1px dashed #b9c2ce;padding-top:9px;font-size:9pt}
    .chk{margin-top:6px}
  </style></head><body>
  <div class="hd"><div class="hdrow">
    ${logoB64 ? `<img class="lg" src="data:image/png;base64,${logoB64}">` : ''}
    <div><div class="bn">${esc(brand.name || 'Vision Meta Hub')}</div>
    <h1>${TB_TITLE}</h1>
    <div class="sub">สำหรับเจ้าหน้าที่ใช้ประกอบการพิจารณา · ช่วงข้อมูล ${esc(periodLabel)}
      · <b>เจาะลึก ${rows.length} คันที่วิ่งในช่วงห้ามถี่ที่สุด</b>${totalInRanks && totalInRanks > rows.length
        ? ` จากทั้งหมด ${totalInRanks} คันใน 10 อันดับ — ต้องการครบทุกคันให้ใช้ปุ่ม “ตารางพร้อมภาพ”` : ''}</div>
    </div></div></div>
  <div class="warn"><b>ข้อควรทราบก่อนใช้รายงานนี้</b><br>${TB_WARN}</div>
  ${criteriaNote ? `<div class="crit">เกณฑ์: ${esc(criteriaNote)}</div>` : ''}
  <table><thead><tr><th style="width:34px" class="c">อันดับ</th><th style="width:92px">ทะเบียน</th>
    <th style="width:80px" class="c">จังหวัด</th><th style="width:56px" class="c">จำนวนครั้ง</th>
    <th>กล้อง</th><th style="width:140px">ครั้งล่าสุด</th></tr></thead>
    <tbody>${summary}</tbody></table>
  ${pages}</body></html>`;

  return _withPage(async (page) => {
    // ภาพฝังเป็น base64 มาแล้ว ไม่มี request ออกนอก จึงรอแค่ DOM
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 90000 });
    return page.pdf({ format: 'A4', printBackground: true,
      margin: { top: '12mm', right: '11mm', bottom: '14mm', left: '11mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: tbFooter(brand, footerLogoB64, '11mm'), timeout: 90000 });
  }, { timeout: 120000 });
}

async function renderTruckBanTablePdf({ rows, periodLabel, criteriaNote = '', brand = {}, withImages = false, total = null,
                                        logoB64 = null, footerLogoB64 = null }) {
  const cell = (b64, cls) => (b64 ? `<img class="${cls}" src="data:image/jpeg;base64,${b64}">` : '<span class="nodata">ไม่มีภาพ</span>');
  const head = [['ทะเบียน', 'w-pl'], ['จังหวัด', 'w-pv'], ['จำนวนครั้ง', 'w-n'], ['กล้อง', 'w-cam'], ['ครั้งล่าสุด', 'w-dt']]
    .concat(withImages ? [['ภาพรถ', 'w-i2'], ['ภาพป้าย', 'w-i1']] : []);
  const body = rows.map((r) => `<tr>
    <td class="pl">${esc(tbFmtPlate(r.plate))}</td>
    <td class="c">${esc(r.region || '-')}</td>
    <td class="c"><b>${r.n}</b> ครั้ง</td>
    <td>${esc(r.camNames.join(', '))}</td>
    <td class="nw">${r.last ? tbTh(r.last) : '-'}</td>
    ${withImages ? `<td class="im">${cell(r.vehicleB64, 'iv')}${r.ev && r.ev.at
      ? `<div class="cap">${esc(tbTh(r.ev.at))} · ${esc(r.ev.camName || r.ev.camera || '')}</div>` : ''}</td>
    <td class="im">${cell(r.plateB64, 'ip')}</td>` : ''}
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
  <style>
    @page{size:A4 landscape}
    *{box-sizing:border-box}
    body{font-family:'Noto Sans Thai','Sarabun',sans-serif;color:#16191d;margin:0;font-size:8pt;background:#fff}
    .hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1678d4;padding-bottom:8px;margin-bottom:9px}
    .hd img{height:34px;width:auto} .hd .tx{flex:1}
    .bn{font-size:9.5pt;font-weight:700;color:#1678d4;letter-spacing:.3px}
    h1{font-size:15pt;margin:1px 0 2px;font-weight:800}
    .sub{font-size:8pt;color:#55627a}
    .warn{border:1px solid #f0c2c2;background:#fdf4f4;border-radius:5px;padding:7px 10px;
      font-size:7.5pt;color:#7a2020;margin-bottom:6px;line-height:1.5}
    .crit{font-size:7.5pt;color:#55627a;margin:0 0 8px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th{background:#eef4fb;color:#20456e;font-size:7.5pt;font-weight:700;border:1px solid #c9d6e4;padding:5px 4px;text-align:center}
    td{border:1px solid #dbe2ea;padding:4px 5px;vertical-align:middle;font-size:7.5pt;word-break:break-word}
    tbody tr:nth-child(even) td{background:#fafbfc}
    .c{text-align:center} .nw{white-space:nowrap;text-align:center}
    .pl{font-weight:800;font-size:9pt;letter-spacing:.4px;text-align:center;white-space:nowrap}
    .nodata{color:#aab3c0;font-size:6.5pt}
    .im{text-align:center;padding:3px}
    .im img{display:block;margin:0 auto;border-radius:2px;background:#eef1f4}
    .ip{max-width:100%;max-height:16mm;object-fit:contain}
    .iv{max-width:100%;max-height:30mm;object-fit:contain}
    .cap{font-size:6.5pt;color:#55627a;margin-top:2px}
    .w-pl{width:78px}.w-pv{width:80px}.w-n{width:60px}.w-dt{width:96px}
    .w-i2{width:200px}.w-i1{width:130px}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
  </style></head><body>
  <div class="hd">
    ${logoB64 ? `<img src="data:image/png;base64,${logoB64}">` : ''}
    <div class="tx"><div class="bn">${esc(brand.name || 'Vision Meta Hub')}</div>
      <h1>${TB_TITLE}${withImages ? ' (พร้อมภาพหลักฐาน)' : ''}</h1>
      <div class="sub">สำหรับเจ้าหน้าที่ใช้ประกอบการพิจารณา · ช่วงข้อมูล ${esc(periodLabel)}
        · ${total && total > rows.length
             ? `แสดง <b>${rows.length}</b> คันแรก จากทั้งหมด <b>${total}</b> คันใน 10 อันดับ`
             : `ทั้งหมด <b>${rows.length}</b> คัน`}</div></div>
  </div>
  <div class="warn"><b>ข้อควรทราบ</b> — ${TB_WARN}</div>
  ${criteriaNote ? `<div class="crit">เกณฑ์: ${esc(criteriaNote)}</div>` : ''}
  <table><thead><tr>${head.map(([t, c]) => `<th class="${c}">${esc(t)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table>
  </body></html>`;

  return _withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 120000 });
    return page.pdf({ format: 'A4', landscape: true, printBackground: true,
      margin: { top: '10mm', right: '8mm', bottom: '15mm', left: '8mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: tbFooter(brand, footerLogoB64, '8mm'), timeout: 120000 });
  }, { timeout: 240000 });
}


// ============================================================
// หน้าแจ้งว่า "ไม่มีรายการเข้าเกณฑ์" — ยังเป็น PDF เหมือนเดิม
// ปุ่มรายงานเปิดแท็บใหม่ ถ้าตอบเป็น JSON 404 คนกดจะเห็นข้อความ error ดิบ ๆ เต็มจอ
// แล้วเข้าใจว่าระบบพัง ทั้งที่แค่ยังไม่มีใครเข้าเกณฑ์ · เกิดทุกเช้าหลังใส่กฎ
// "ต้องผ่านกล้องอย่างน้อย 10 ครั้ง" เพราะต้นช่วงยังไม่มีใครผ่านครบ (2026-08-17)
// ============================================================
async function renderNoticePdf({ title, message, periodLabel, brand = {},
                                 logoB64 = null, footerLogoB64 = null,
                                 heading = 'รายงานผู้ทำผิดซ้ำ — ไม่สวมหมวกนิรภัย', footerLabel = 'รายงานไม่สวมหมวกนิรภัย' }) {
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 14mm; }
    *{box-sizing:border-box}
    body{margin:0;font-family:"Noto Sans Thai","Sarabun",sans-serif;color:#16202b}
    .hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1678d4;
        padding-bottom:9px;margin-bottom:22px}
    .hd img{height:40px;width:auto}
    .bn{font-size:13pt;font-weight:800}
    h1{font-size:16pt;margin:2px 0 3px}
    .sub{font-size:9.5pt;color:#55627a}
    .box{border:1px solid #d8dee6;border-radius:8px;padding:26px;text-align:center;background:#f8fafc}
    .big{font-size:14pt;font-weight:700;margin-bottom:8px}
    .msg{font-size:10pt;color:#42506a;line-height:1.8}
  </style></head><body>
  <div class="hd">
    ${logoB64 ? `<img src="data:image/png;base64,${logoB64}">` : ''}
    <div><div class="bn">${esc(brand.name || 'Vision Meta Hub')}</div>
      <h1>${esc(heading)}</h1>
      <div class="sub">ช่วงข้อมูล ${esc(periodLabel || '')}</div></div>
  </div>
  <div class="box"><div class="big">${esc(title)}</div>
    <div class="msg">${message}</div></div>
  </body></html>`;

  return _withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return page.pdf({ format: 'A4', printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '15mm', left: '12mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:7pt;color:#8894a6;padding:0 12mm;
        font-family:'Noto Sans Thai',sans-serif;display:flex;align-items:center;gap:7px">
        ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:6mm">` : ''}
        <span>${esc(brand.name || 'Vision Meta Hub')} · ${esc(footerLabel)}</span></div>`,
      timeout: 60000 });
  }, { timeout: 90000 });
}

// ============================================================
// Export PDF จาก DOM ของหน้าจอ (owner ask 2026-09-03) — ฝั่งหน้าเว็บส่ง HTML ของแท็บ
// ที่แสดงอยู่มา (กราฟ canvas ถูกแทนด้วย <img data:> จากจอจริงแล้ว) เอามาห่อด้วย CSS
// ของ dashboard เอง (บังคับ light theme = กระดาษ) แล้วพิมพ์เป็น A4 · ความปลอดภัย:
// HTML มาจากผู้ใช้ที่ login แล้วก็จริง แต่ยังห้ามให้มันสั่งอะไรได้ — ปิด JS ทั้งหน้า
// และบล็อกทุก network request (กัน SSRF ผ่าน <img src=http://...>/CSS url())
// ============================================================
async function renderDomSnapshotPdf({ html, title = '', scope = '', brand = {},
                                      logoB64 = null, footerLogoB64 = null }) {
  const fs = require('fs');
  const path = require('path');
  const indexCss = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'index.css'), 'utf8');
  // JS ปิดอยู่แล้ว — ลอก <script> ทิ้งอีกชั้นเป็น belt-and-braces
  const safeHtml = String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                               .replace(/<script\b[^>]*\/?>/gi, '');
  const genAt = new Date().toLocaleString('th-TH', { day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const doc = `<!doctype html><html lang="th" data-theme="light"><head><meta charset="utf-8">
  <style>${indexCss}</style>
  <style>
    @page { size: A4; margin: 21mm 9mm 12mm; }
    /* 🔴 index.css ตั้ง html,body height:100% — ใน Puppeteer print มันตัดเอกสารเหลือ
       "หน้าเดียวแล้วทิ้งที่เหลือเงียบๆ" (เจอจริง 2026-09-03: การ์ดรายเดือนหายทั้งใบ
       และ totalPages นับได้ 1) — ต้องปลดก่อนกฎอื่นทั้งหมด */
    html, body { height: auto !important; overflow: visible !important; margin: 0; background: #fff !important; }
    body { font-family: "Noto Sans Thai", "Sarabun", sans-serif; }
    .xbody { overflow: visible !important; padding: 0 !important; }
    .trf-card { page-break-inside: avoid; box-shadow: none !important; margin-bottom: 6mm; }
    /* กล่องกราฟบนจอ fix ความสูง (220/300px) ให้ canvas ลอย absolute — พอแทนที่ด้วย
       <img> ตามสัดส่วนจริง กล่องเดิมจะเหลือช่องว่างใหญ่ใต้กราฟ → ปล่อยสูงตามเนื้อภาพ */
    .trf-chart, .trf-chart.lg { height: auto !important; overflow: visible !important; }
    .trf-chart .cx { height: auto !important; width: 100% !important; }
    .trf-chart img { display: block; width: 100%; height: auto; }
    canvas { display: none; }   /* เศษ canvas ที่ฝั่งหน้าเว็บแปลงเป็นภาพไม่สำเร็จ */
    img { max-width: 100%; }
  </style></head><body>
  <div class="xbody">${safeHtml}</div></body></html>`;

  return _withPage(async (page) => {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('data:') || u.startsWith('about:')) r.continue(); else r.abort();
    });
    await page.setContent(doc, { waitUntil: 'domcontentloaded', timeout: 90000 });
    return page.pdf({ format: 'A4', printBackground: true,
      // หัวกระดาษทุกหน้า (เจ้าของขอ 2 พ.ย. — หน้าที่ 2 เป็นต้นไปโล่ง ไม่รู้ว่าเป็นรายงานอะไร)
      // เดิมหัวอยู่ในเนื้อหน้าแรกอย่างเดียว · headerTemplate ไม่รัน JS จึงซ่อนเฉพาะหน้าแรกไม่ได้ → ใช้หัวเดียวกันทุกหน้า
      margin: { top: '21mm', right: '9mm', bottom: '12mm', left: '9mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;margin:0 9mm;padding-bottom:5px;border-bottom:2px solid #1678d4;
        font-family:'Noto Sans Thai',sans-serif;display:flex;align-items:center;gap:8px;-webkit-print-color-adjust:exact">
        ${logoB64 ? `<img src="data:image/png;base64,${logoB64}" style="height:9mm;width:auto">` : ''}
        <div><div style="font-size:11pt;font-weight:800;color:#16202b">${esc(title)}</div>
          <div style="font-size:7.5pt;color:#55627a">${esc(brand.name || 'Vision Meta Hub')} · ${esc(scope)} · จัดทำเมื่อ ${genAt}</div></div></div>`,
      footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#8894a6;padding:0 9mm;
        font-family:'Noto Sans Thai',sans-serif;display:flex;justify-content:space-between">
        <span style="display:flex;align-items:center;gap:7px">
          ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:4mm">` : ''}
          <span>${esc(brand.name || 'Vision Meta Hub')} · ${esc(title)}</span></span>
        <span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
      timeout: 90000 });
  }, { timeout: 120000 });
}

// ============================================================
// รายงาน Relay → ระบบภายนอก (CIB) — A4 แนวตั้ง โทน/โครงเดียวกับรายงานหมวกนิรภัย
// (owner ask 2026-09-03) · หนึ่ง section ต่อ site · ตาราง mapping รายกล้อง:
// ปลายทาง (UUID ของผู้รับ) คู่กับหลักฐานว่าข้อมูลวิ่งจริงใน 24 ชม. — เอกสารที่
// ยื่นให้ฝั่ง CIB ใช้ไล่เทียบรายกล้องแทนการเถียงกันด้วยยอดรวม
// ============================================================
async function renderRelayPdf({ sites, brand = {}, logoB64 = null, footerLogoB64 = null }) {
  const th = (d) => new Date(d).toLocaleString('th-TH', { day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // เก็บดิบ (ขีดกลาง ตัวเล็ก) แปลงแค่ตอนแสดง — เหมือนฝั่งหน้าเว็บ
  const fmtMac = (m) => m ? esc(String(m).toUpperCase().replace(/[^0-9A-F]/g, '').replace(/(.{2})(?=.)/g, '$1:')) : '';
  const ST = {
    relay:        { t: 'relay → CIB',        cls: 'ok' },
    ingest_only:  { t: 'รับเข้า ไม่ส่งต่อ',  cls: 'warn' },
    unconfigured: { t: 'ยังไม่ได้ตั้งค่า',   cls: 'bad' },
  };
  const ROLE = { face: 'กล้อง Face (UUID เฉพาะกล้อง)', lpr: 'กล้อง LPR / ANPR' };
  const now = Date.now();

  const siteBlocks = sites.map((s, si) => {
    const sum = s.summary || {};
    const groups = ['face', 'lpr'].map((role) => {
      const rows = (s.rows || []).filter(r => r.role === role);
      if (!rows.length) return '';
      const body = rows.map((r, i) => {
        const st = ST[r.status] || ST.unconfigured;
        const online = r.last_seen_at && (now - new Date(r.last_seen_at).getTime()) < 120000;
        return `<tr>
          <td class="c">${i + 1}</td>
          <td><span class="dot ${online ? 'on' : 'off'}"></span><b>${esc(r.camera_id)}</b>
            <br><span class="dim">${esc(r.name || '')}</span></td>
          <td class="c nw mac">${fmtMac(r.mac) || '<span class="dim">-</span>'}</td>
          <td class="c"><span class="st ${st.cls}">${esc(st.t)}</span></td>
          <td class="url">${r.dest_url ? esc(r.dest_url) : '<span class="dim">-</span>'}</td>
          <td class="c num">${(r.events_24h || 0).toLocaleString('en-US')}</td>
          <td class="c nw ${r.events_24h ? '' : 'bad'}">${r.last_event_at ? th(r.last_event_at) : '-'}</td>
        </tr>`;
      }).join('');
      return `<div class="grp">${ROLE[role]} (${rows.length})</div>
        <table><thead><tr>
          <th style="width:22px" class="c">#</th><th style="width:112px">กล้อง</th>
          <th style="width:74px" class="c">MAC Address</th>
          <th style="width:60px" class="c">การส่ง</th><th>ปลายทาง (ตาม UUID ที่ผู้รับกำหนด)</th>
          <th style="width:50px" class="c">Event 24 ชม. (ครั้ง)</th><th style="width:74px" class="c">ล่าสุด</th>
        </tr></thead><tbody>${body}</tbody></table>`;
    }).join('');
    return `<section${si > 0 ? ' class="brk"' : ''}>
      <div class="sh">Site: ${esc(s.name || s.code)} <span class="dim">(${esc(s.code)})</span></div>
      <div class="chips">กล้องทั้งหมด <b>${sum.total || 0}</b> ·
        relay → CIB <b class="okc">${sum.relay || 0}</b> ·
        มี event ใน 24 ชม. <b class="okc">${sum.active_24h || 0}</b> ·
        รับเข้าไม่ส่งต่อ <b class="warnc">${sum.ingest_only || 0}</b> ·
        ยังไม่ตั้งค่า <b class="badc">${sum.unconfigured || 0}</b></div>
      ${groups}</section>`;
  }).join('');

  const genAt = th(new Date());
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 12mm 11mm 14mm; }
    *{box-sizing:border-box} body{margin:0;font-family:"Noto Sans Thai","Sarabun",sans-serif;
      font-size:9.5pt;color:#16202b;line-height:1.5}
    h1{font-size:16pt;margin:0 0 3px} .sub{font-size:9.5pt;color:#55627a}
    .hd{border-bottom:3px solid #1678d4;padding-bottom:9px;margin-bottom:11px}
    .hdrow{display:flex;align-items:center;gap:12px}
    .hdrow .lg{height:40px;width:auto}
    .bn{font-size:13pt;font-weight:800}
    .warn{border:1px solid #a32626;background:#fbe9e9;color:#7d1d1d;border-radius:5px;
      padding:8px 11px;font-size:9pt;margin:10px 0 12px;line-height:1.7}
    .sh{font-size:12pt;font-weight:800;border-bottom:2px solid #1678d4;padding-bottom:5px;margin:4px 0 6px}
    .chips{font-size:9pt;color:#55627a;margin:0 0 8px}
    .okc{color:#1e7a34} .warnc{color:#8a5a00} .badc{color:#a32626}
    .grp{font-size:9.5pt;font-weight:700;margin:9px 0 4px;color:#22344c}
    table{width:100%;border-collapse:collapse;font-size:8.5pt;page-break-inside:auto}
    tr{page-break-inside:avoid}
    th,td{border:1px solid #d8dee6;padding:3.5px 5px;text-align:left;vertical-align:top}
    thead th{background:#eef3fb;font-weight:700;font-size:8pt}
    td.c{text-align:center} td.nw{white-space:nowrap;font-size:7.8pt} td.bad{color:#a32626}
    td.num{font-variant-numeric:tabular-nums;font-weight:700}
    .url{font-family:"DejaVu Sans Mono",monospace;font-size:7pt;word-break:break-all;color:#22344c}
    .mac{font-family:"DejaVu Sans Mono",monospace;font-size:7.5pt;color:#22344c}
    .dim{color:#55627a;font-size:7.5pt;font-weight:400}
    .dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:middle}
    .dot.on{background:#1e7a34} .dot.off{background:#a32626}
    .st{font-weight:700;font-size:7.8pt;padding:1px 6px;border-radius:3px;white-space:nowrap}
    .st.ok{background:#e7f4ea;color:#1e7a34} .st.warn{background:#fdf7ea;color:#8a5a00}
    .st.bad{background:#fbe9e9;color:#a32626}
    .brk{page-break-before:always}
  </style></head><body>
  <div class="hd"><div class="hdrow">
    ${logoB64 ? `<img class="lg" src="data:image/png;base64,${logoB64}">` : ''}
    <div><div class="bn">${esc(brand.name || 'Vision Meta Hub')}</div>
    <h1>รายงานการส่งต่อข้อมูลกล้อง (Relay) ไปยังระบบ CIB</h1>
    <div class="sub">ตาราง mapping รายกล้อง: ปลายทางตาม UUID ที่ผู้รับกำหนด คู่กับจำนวน event จริงใน 24 ชั่วโมงล่าสุด
      · จัดทำเมื่อ ${genAt}</div>
    </div></div></div>
  <div class="warn"><b>ข้อควรทราบ</b><br>
    1. คอลัมน์ "Event 24 ชม." คือ<b>จำนวนเหตุการณ์ (ครั้ง)</b> ที่กล้องตรวจจับและถูกส่งต่อในรอบ 24 ชั่วโมงล่าสุด — กล้อง Face นับเป็นจำนวนใบหน้า/บุคคลที่ตรวจพบ · กล้อง LPR นับเป็นจำนวนป้ายทะเบียนที่อ่านได้
       — กล้องที่ยอดเป็น 0 อาจออฟไลน์หรือไม่มีเหตุการณ์ในช่วงนั้น<br>
    2. เอกสารนี้มี URL ปลายทางและ UUID ของระบบผู้รับ — จำกัดการเผยแพร่เฉพาะผู้เกี่ยวข้อง</div>
  ${siteBlocks}</body></html>`;

  return _withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 90000 });
    return page.pdf({ format: 'A4', printBackground: true,
      margin: { top: '12mm', right: '11mm', bottom: '14mm', left: '11mm' },
      displayHeaderFooter: true, headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#8894a6;padding:0 11mm;
        font-family:'Noto Sans Thai',sans-serif;display:flex;justify-content:space-between">
        <span style="display:flex;align-items:center;gap:7px">
          ${footerLogoB64 ? `<img src="data:image/png;base64,${footerLogoB64}" style="height:6mm">` : ''}
          <span>${esc(brand.name || 'Vision Meta Hub')} · รายงาน Relay → CIB</span></span>
        <span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
      timeout: 90000 });
  }, { timeout: 120000 });
}

module.exports = {
  renderRelayPdf, renderDomSnapshotPdf,
  renderHelmetTopPdf, renderHelmetTablePdf, renderNoticePdf,
  renderTruckBanTopPdf, renderTruckBanTablePdf,
  computeScheduledRange, renderReportPdf, renderReportImage,
  renderHealthReportImage, renderHealthReportPdf,
  renderFaceReportImage, renderFaceReportPdf,
  renderLprReportImage, renderLprReportPdf,
  ALL_HEALTH_SECTIONS,
};
