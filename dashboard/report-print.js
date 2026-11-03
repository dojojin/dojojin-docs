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
  const rtype   = p.get('rtype') || null;  // CR.5 — summary report type
  const anchor  = p.get('anchor') || null;  // CR.5 — anchor date for summary
  const from    = p.get('from');
  const to      = p.get('to');
  const title   = p.get('title') || I18N.t('rep.summaryTitle');
  const label   = p.get('label') || '';
  const cameras = p.get('cameras') || '';
  const domains = new Set((p.get('domains') || 'events').split(','));
  const site_id = p.get('site_id') || '';
  // ตัวเลือกจากหน้ารายงาน — ไม่ส่งมา = ค่าเริ่มต้น (แสดงครบ / เรียงมาก→น้อย)
  // normalizeOpts ใน report-template.js เป็นคนตรวจค่า ที่นี่แค่ส่งต่อดิบ ๆ
  const rptOpts = { kpis: p.get('kpis'), secs: p.get('secs'), catsort: p.get('catsort'),
                    showDelta: p.get('showDelta'), showPct: p.get('showPct') };
  // หมวดที่ผู้ใช้ติ๊กออก — ว่าง/ไม่ส่ง = ไม่ซ่อนอะไร (พฤติกรรมเดิม)
  // `cats` (รายชื่อที่เลือก) คือรูปแบบเก่าก่อน 2026-08-25 ยังรับไว้เพื่ออ่านลิงก์เดิมได้
  const catHide   = p.get('cats_hide') || null;
  const catLegacy = p.get('cats') || null;

  let q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  if (cameras) q += `&cameras=${encodeURIComponent(cameras)}`;
  const siteQ = site_id ? `&site_id=${encodeURIComponent(site_id)}` : '';
  // ส่งต่อให้ endpoint ที่คืนค่าเป็น rule/ชั่วโมง (ไม่ใช่รายหมวด) กรองให้ที่ SQL
  // ฝั่ง client กรองเองไม่ได้เพราะแถวที่คืนมาไม่มี category_id ติดมาด้วย
  const hideQ = catHide ? `&cats_hide=${encodeURIComponent(catHide)}` : '';
  // ส่งต่อ tod params เฉพาะให้ events endpoints ไม่ใช่ face/lpr/person
  const todQ = (p.get('tod_from') && p.get('tod_to'))
    ? `&tod_from=${encodeURIComponent(p.get('tod_from'))}&tod_to=${encodeURIComponent(p.get('tod_to'))}`
    : '';

  // ความละเอียดของกราฟแนวโน้ม (ส่งมาจากผู้เรนเดอร์เมื่อขอเอง เช่น minute30) · ไม่ส่ง = เซิร์ฟเวอร์เลือกตามความยาวช่วง
  const truncQ = p.get('trunc') ? `&trunc=${encodeURIComponent(p.get('trunc'))}` : '';

  const get = async (path) => {
    try { const r = await fetch(path); return r.ok ? await r.json() : null; }
    catch { return null; }
  };

  // ชื่อหัวข้อที่ตั้งเอง (migration 224) — ต้องโหลด **ก่อน** แยกสาขา summary/ปกติ
  // และก่อน build ทุกตัว เพราะ ReportTemplate อ่านค่านี้ตอนสร้าง HTML
  // ⚠️ ห้ามย้ายเข้าไปในสาขาใดสาขาหนึ่ง — บั๊กแบบเดียวกับ wantDaily7 (2026-09-04)
  // ล้มเหลว = ใช้ชื่อเริ่มต้นตามภาษา ไม่ใช่รายงานพัง
  try {
    const st = await get('/api/settings');
    if (st) ReportTemplate.setSectionTitles(JSON.parse(st.report_section_titles?.value || '{}'));
  } catch { /* ชื่อเริ่มต้นดีกว่ารายงานว่าง */ }

  // CR.5 — Summary report: compute three time windows and fetch each separately
  let cats, tl, brk, heat, quiet, branding, cov, ev, faceData, lprData, personData, summaryMode = false, sumData = null;
  // ⚠️ ตัวแปรของ CR.8 ต้องอยู่นอก if/else — บล็อก "วาดผล" ข้างล่างใช้มันด้วย
  //    ถ้าประกาศไว้ในสาขา else จะได้ ReferenceError: wantDaily7 is not defined
  //    ทำให้รายงานทุกใบพัง (เจอจริงบน prod 2026-09-04 จากรายงานตั้งเวลา)
  let wantDaily7 = false, wantMonthly = false;
  let daily7Windows = null, monthlyWindows = null, daily7Tl = null, monthlyTl = null;

  if (rtype === 'summary' && anchor) {
    summaryMode = true;
    const anchorDate = new Date(anchor);
    const windows = ReportTemplate.summaryWindows(anchorDate);
    const anchorLabel = anchorDate.toLocaleDateString((I18N.getLang && I18N.getLang() === 'en') ? 'en-GB' : 'th-TH');
    const todLabel = p.get('tod_from') && p.get('tod_to') ? `${p.get('tod_from')} – ${p.get('tod_to')}` : '';

    const camerasPart = cameras ? `&cameras=${encodeURIComponent(cameras)}` : '';
    const [dayData, weekData, monthData, weekTl, branding_] = await Promise.all([
      get(`/api/stats/categories?from=${windows.day.from}&to=${windows.day.to}${camerasPart}${siteQ}${todQ}`),
      get(`/api/stats/categories?from=${windows.week.from}&to=${windows.week.to}${camerasPart}${siteQ}${todQ}`),
      get(`/api/stats/categories?from=${windows.month.from}&to=${windows.month.to}${camerasPart}${siteQ}${todQ}`),
      get(`/api/stats/timeline-by-category?from=${windows.week.from}&to=${windows.week.to}${camerasPart}${siteQ}${todQ}`),
      get(`/api/branding`),
    ]);
    // ป้ายช่อง "เดือน" ใช้ชื่อเดือนจริงของ anchor (ก.ย. 2569) ไม่ใช่คำกลาง ๆ
    const monthLabel = new Date(windows.month.from).toLocaleDateString(
      (I18N.getLang && I18N.getLang() === 'en') ? 'en-GB' : 'th-TH', { month: 'long', year: 'numeric' });
    sumData = { anchorLabel, todLabel, monthLabel, title,
                day: dayData, week: weekData, month: monthData, tl: weekTl };
    branding = branding_;
  } else {
    // top-rules ถูกถอดออก 2026-08-21 — หัวข้อ "Rule ที่ทำงานบ่อยสุด" ไม่มีในรายงานแล้ว
    // per-camera-counts ถูกถอดออก 2026-08-21 — หัวข้อ "จำนวนตามกล้อง" ใช้ตัวเลขจาก
    // /api/stats/categories แทนแล้ว (endpoint เดิมบังคับ kind=counter จึงว่างแทบทุกไซต์)
    // ⚠️ ห้ามตั้งชื่อตัวแปรใน destructuring ชนกับ `q` (query string ข้างบน) —
    //    const ใน block เดียวกันจะ shadow แบบ TDZ แล้ว ReferenceError ทั้ง path

    // CR.8 — Check if daily7 or monthly sections are enabled
    const secsRaw = p.get('secs');
    wantDaily7 = !secsRaw || secsRaw.split(',').includes('daily7');
    wantMonthly = !secsRaw || secsRaw.split(',').includes('monthly');

    // Compute windows for daily7 and monthly if needed
    if (wantDaily7 || wantMonthly) {
      const toDate = new Date(to);
      const anchorDate = new Date(toDate);
      anchorDate.setHours(0, 0, 0, 0);
      const windows = ReportTemplate.dailyWindows(anchorDate);
      daily7Windows = windows.daily7;
      monthlyWindows = windows.monthly;
    }

    // Build query for timeline fetches (reuse q but swap from/to)
    const makeTlQ = (fromIso, toIso) => `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}` + (cameras ? `&cameras=${encodeURIComponent(cameras)}` : '') + siteQ + todQ;

    [cats, tl, brk, heat, quiet, branding, cov, ev, faceData, lprData, personData, daily7Tl, monthlyTl] = await Promise.all([
      domains.has('events') ? get(`/api/stats/categories?${q}${siteQ}${todQ}`)                          : null,
      domains.has('events') ? get(`/api/stats/timeline-by-category?${q}${siteQ}${todQ}${truncQ}`)         : null,
      domains.has('events') ? get(`/api/stats/breakdown-v2?${q}${siteQ}${hideQ}${todQ}`)                : null,
      domains.has('events') ? get(`/api/stats/heatmap?${q}${siteQ}${hideQ}&domains=${[...domains].join(',')}${todQ}`) : null,
      domains.has('events') ? get(`/api/stats/quiet-cameras?since_hours=24${siteQ}`)              : null,
      get(`/api/branding`),
      // cov/ev: หมวด coverage/evidence ถูกถอดจากรายงานแล้ว (report-template E3) — เลิกดึง เดิมยิง event-coverage
      // (1 วัน 12.7 วิ · 3 วันเกิน 30 วิ) รอใน Promise.all เดียวกันทำให้ทั้งรายงานช้าตาม (audit 2026-10-02 · D9)
      null,
      null,
      domains.has('face')   ? get(`/api/stats/face/report?period=custom&${q}&min_score=80${siteQ}`) : null,
      domains.has('lpr')    ? get(`/api/stats/lpr/report?period=custom&${q}${siteQ}`)    : null,
      domains.has('person') ? get(`/api/appearances/stats?${q}${siteQ}`)                 : null,
      domains.has('events') && wantDaily7 ? get(`/api/stats/timeline-by-category?${makeTlQ(daily7Windows.from, daily7Windows.to)}`) : null,
      domains.has('events') && wantMonthly ? get(`/api/stats/timeline-by-category?${makeTlQ(monthlyWindows.from, monthlyWindows.to)}`) : null,
    ]);
  }

  const brand = branding || {};
  document.documentElement.style.setProperty('--accent', brand.primary_color || '#5b8def');
  const root  = document.getElementById('root');

  // CR.5 — Summary report render path
  if (summaryMode && sumData) {
    root.innerHTML = ReportTemplate.buildSummaryHtml(sumData, brand, rptOpts);
    ReportTemplate.renderShareChart('summaryShareChart', (sumData.day && sumData.day.categories) || [], 'count', ReportTemplate.normalizeOpts(rptOpts).showPct);
    ReportTemplate.renderSummaryTrendChart('summaryTrendChart', sumData.tl);
  } else if (domains.has('events')) {
    // กรองหมวด **ก่อน** ส่งเข้าทุกตัวที่วาด — การ์ดสรุป กราฟ และตารางจึงอ่านจาก
    // ข้อมูลชุดเดียวกัน ยอดรวมเท่ากับผลบวกของแถวที่เห็นเสมอ
    const raw = { range: { label }, title, cats, tl, brk, heat, quiet, cov, ev };
    // ลิงก์รูปแบบเก่าส่ง `cats` (รายชื่อที่เลือก) มา — แปลงเป็นรายชื่อที่ซ่อนก่อนใช้
    const hideSet = catHide || ReportTemplate.legacyShownToHidden(raw, catLegacy);
    const reportData = ReportTemplate.hideCats(raw, hideSet);

    // CR.8 — Build daily7 and monthly data objects (filtered by category)
    // ⚠️ hideCats ต้องได้ `cats` จริง — timeline endpoint ไม่มี .categories (ถ้าส่ง []
    //    จะคืนของเดิม = หมวดที่ติ๊กออกยังถูกนับ) · ป้ายวันที่อ่านจากแถวที่เติมแล้ว
    //    ไม่ใช่ ISO.split('T') ซึ่งเป็นเวลา UTC (คลาดไป 1 วันที่กรุงเทพ)
    if (wantDaily7 && daily7Tl) {
      const d7Filtered = ReportTemplate.hideCats({ cats, tl: { series: daily7Tl.series || [], trunc: 'day' } }, hideSet);
      const d7 = ReportTemplate.dailySeries(d7Filtered.tl, new Date(daily7Windows.from), new Date(daily7Windows.to));
      reportData.daily7 = { from: d7.days[0] || '', to: d7.days[d7.days.length - 1] || '', prepared: d7 };
    }
    if (wantMonthly && monthlyTl) {
      const mFiltered = ReportTemplate.hideCats({ cats, tl: { series: monthlyTl.series || [], trunc: 'day' } }, hideSet);
      const mPrep = ReportTemplate.dailySeries(mFiltered.tl, new Date(monthlyWindows.from), new Date(monthlyWindows.to));
      const monthDate = new Date(monthlyWindows.from);
      const monthLabel = monthDate.toLocaleDateString(((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB', { month: 'short', year: 'numeric' });
      reportData.monthly = {
        from: mPrep.days[0] || '',
        to:   mPrep.days[mPrep.days.length - 1] || '',
        monthLabel,
        prepared: mPrep,
      };
    }

    const catsShown = (reportData.cats && reportData.cats.categories) || [];
    root.innerHTML = ReportTemplate.buildReportHtml(reportData, brand, rptOpts);
    const t = ReportTemplate.computeTrendPoints(reportData);
    if (t.points.length) ReportTemplate.renderReportTrendChart('reportTrendChart', reportData, brand.primary_color);
    const normOpts = ReportTemplate.normalizeOpts(rptOpts);
    ReportTemplate.renderCategoryChart('reportCategoryChart', catsShown, normOpts.catsort);
    // วงในบล็อกหมวดหมู่ = แยก IN/OUT (merge=false) · วงในบล็อก "สัดส่วน" = รวม IN/OUT
    ReportTemplate.renderShareChart('reportCatShareChart', catsShown, normOpts.catsort, normOpts.showPct, false);
    ReportTemplate.renderShareChart('reportShareChart', catsShown, normOpts.catsort, normOpts.showPct);
    // CR.8 — Render daily7 and monthly bar charts
    if (reportData.daily7) {
      ReportTemplate.renderDailyBarChart('reportDaily7Chart', reportData.daily7.prepared, { labelMode: 'dow' });
    }
    if (reportData.monthly) {
      ReportTemplate.renderDailyBarChart('reportMonthlyChart', reportData.monthly.prepared, { labelMode: 'day' });
    }
  } else {
    root.innerHTML = '';
  }

  if (!summaryMode) {
    if (faceData)   root.insertAdjacentHTML('beforeend', ReportTemplate.buildFaceSection(faceData));
    if (lprData)    root.insertAdjacentHTML('beforeend', ReportTemplate.buildLprSection(lprData));
    if (personData) root.insertAdjacentHTML('beforeend', ReportTemplate.buildPersonSection(personData));
    else if (domains.has('person')) root.insertAdjacentHTML('beforeend', ReportTemplate.buildPersonUnavailable());
  }

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
