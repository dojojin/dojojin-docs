// ============================================================
// Vigil Platform — Shared Report Template (Phase 7.3)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// The ONE report layout — used by both:
//   • dashboard.js renderReportPreviewV2()  (interactive Reports page)
//   • report-print.html                     (Puppeteer → "full" image)
// Extracted here so the two never drift. Pure: takes reportData + brand
// as arguments, returns an HTML string (no globals, no DOM writes).
// ============================================================
(function (global) {
  'use strict';

  // สีสำรองเมื่อหมวดไม่ได้ตั้งสีเอง — ชุดเดียวกับหน้า "สถิติเหตุการณ์" แต่เป็นค่า hex
  // ตรง ๆ ไม่ใช่ CSS token เพราะหน้าพิมพ์ (report-print.html) ไม่ได้โหลด theme ของ dashboard
  const SERIES_PALETTE = [
    '#5b8def', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ชื่อเทคนิคที่กล้องส่งมา → ชื่อที่คนอ่านรายงานเข้าใจ (เจ้าของสั่ง 2026-08-22)
  // "anprAlarm" ไม่บอกอะไรกับตำรวจหรือผู้บริหารที่ถือเอกสารนี้
  // ⚠️ ใช้เฉพาะตอนที่ event ไม่มี rule_name — ถ้ากล้องตั้งชื่อกฎไว้เอง ให้ชื่อนั้นชนะ
  //    เพราะเป็นคำที่ผู้ใช้ตั้งเองและสื่อความเฉพาะจุดนั้นมากกว่า
  const EVENT_LABEL = {
    'anprAlarm':                       ['ป้ายทะเบียน', 'License Plate'],
    'FaceCapture':                     ['ใบหน้า', 'Face'],
    'FaceRecognition':                 ['บุคคลเฝ้าระวัง', 'Watchlist Match'],
    'FaceDetector/Comparison':         ['บุคคลเฝ้าระวัง', 'Watchlist Match'],
    'CountAggregation/PeopleCounting': ['นับคน', 'People Counting'],
    'CountAggregation/Counter':        ['ตัวนับ', 'Counter'],
    'LineDetector/Crossed':            ['ข้ามเส้น', 'Line Crossed'],
    'FieldDetector/ObjectsInside':     ['เข้าพื้นที่', 'Object In Area'],
    'FieldDetector/ObjectIsLoitering': ['วนเวียนในพื้นที่', 'Loitering'],
    'GlobalSceneChange':               ['ภาพเปลี่ยน', 'Scene Change'],
  };
  function _eventLabel(row) {
    // rule_name ที่ผู้ใช้ตั้งเอง ชนะเสมอ — name จะเท่ากับ event_type ก็ต่อเมื่อไม่มี rule_name
    if (row.name && row.name !== row.event_type) return row.name;
    const m = EVENT_LABEL[row.event_type];
    if (!m) return row.event_type || '—';
    const isEn = (typeof I18N !== 'undefined' && I18N.getLang && I18N.getLang() === 'en');
    return isEn ? m[1] : `${m[0]} · ${m[1]}`;
  }

  function _fmt(n) { return (Number(n) || 0).toLocaleString(); }
  function _label(key, fallback) { return (typeof I18N !== 'undefined') ? I18N.t(key, fallback) : (fallback || key); }
  function _kpis(items) {
    // t.raw ให้ผ่าน _fmt ไปเลย — _fmt แปลงอะไรที่ไม่ใช่ตัวเลขเป็น 0 ซึ่งกลายเป็น
    // การยืนยันว่า "ไม่มี" ทั้งที่ความจริงคือ "ไม่รู้" ในรายงานที่ส่งถึงลูกค้า
    // ความต่างนี้สำคัญ
    return `<div class="rpt-execrow">${items.map(t =>
      `<div class="rpt-exec" style="--ka:${esc(t.color)}"><div class="rpt-exec-v">${t.raw ? esc(t.value) : _fmt(t.value)}</div><div class="rpt-exec-k">${esc(t.label)}</div></div>`
    ).join('')}</div>`;
  }
  function _personsSection(rows) {
    const body = rows.length
      ? rows.map(p => `<tr><td><span class="rpt-ava">${esc((p.name||'?').slice(0,1))}</span>${esc(p.name||'Unknown')} <span class="rpt-muted">${esc(p.group_name||'')}</span></td><td class="rpt-num">${_fmt(p.hits)}</td></tr>`).join('')
      : `<tr><td colspan="2" class="rpt-muted">${esc(_label('rpt.noData','ไม่มีข้อมูล'))}</td></tr>`;
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent-muted)"></span>${esc(_label('rpt.topPersons','บุคคลที่พบบ่อย'))}</div><table class="rpt-table">${body}</table></div>`;
  }

  // Build the full report HTML from reportData (the _reportData shape:
  // { range:{label}, title, cats, tl, brk, ppl, veh, heat, top, quiet, cov, ev })
  // and brand ({ name, tagline, logo_url, primary_color }).
  // ตัวเลือกของหน้ารายงาน — เลือกครั้งต่อครั้ง ไม่ได้เก็บไว้ (เจ้าของตัดสิน 2026-08-21)
  // ⚠️ ค่า default ต้องเท่ากับพฤติกรรมเดิมเป๊ะ ๆ — ผู้เรียกเก่าที่ไม่ส่ง opts มา
  //    (report-worker / ตารางเวลา LINE) ต้องได้รายงานหน้าตาเดิมทุกประการ
  const KPI_KEYS = ['events', 'people', 'vehicles', 'cameras'];
  // เรียงตามลำดับที่ปรากฏในรายงานจริง — คนอ่านโค้ดจะได้เดาลำดับหน้ากระดาษได้
  const SECTION_KEYS = ['trend', 'catchart', 'share', 'percam', 'detail', 'heatmap', 'quiet', 'daily7', 'monthly'];
  // ชื่อหัวข้อที่ตั้งเองได้ (เจ้าของสั่ง 2026-09-10) — ทะเบียนเดียวสำหรับ 3 ที่ที่ใช้ชื่อหัวข้อ:
  //   1. หัวข้อในรายงานจริง (ไฟล์นี้)  2. รายการติ๊กในหน้า Report Builder
  //   3. รายการติ๊กในหน้ารายงานอัตโนมัติ
  // titleKey = คีย์ i18n ของหัวข้อในรายงาน · labelKey = คีย์ i18n ของป้ายในรายการติ๊ก
  // (สองคีย์นี้คนละคำกันมาแต่เดิม เช่น "กราฟภาพรวมเหตุการณ์" vs "แนวโน้ม{label}")
  // ⚠️ ฝั่ง server (src/routes/settings.js) มีรายชื่อ 9 คีย์นี้ซ้ำไว้เป็น allowlist —
  //    route ห้าม require ไฟล์ของ dashboard เพิ่มหัวข้อใหม่ต้องแก้สองที่
  const SECTION_TITLE_DEFS = {
    trend:    { labelKey: 'rpt.secTrend',    titleKey: 'rt.trendTitle' },
    catchart: { labelKey: 'rpt.secCatchart', titleKey: 'rt.byCategory' },
    share:    { labelKey: 'rpt.secShare',    titleKey: 'rt.shareTitle' },
    percam:   { labelKey: 'rpt.secPercam',   titleKey: 'rt.perCamera' },
    detail:   { labelKey: 'rpt.secDetail',   titleKey: 'rt.eventDetail' },
    heatmap:  { labelKey: 'rpt.secHeatmap',  titleKey: 'rt.heatmapTitle' },
    quiet:    { labelKey: 'rpt.secQuiet',    titleKey: 'rt.quietCameras' },
    daily7:   { labelKey: 'rpt.secDaily7',   titleKey: 'rt.daily7Title' },
    monthly:  { labelKey: 'rpt.secMonthly',  titleKey: 'rt.monthlyTitle' },
  };
  // ค่าที่ตั้งเองจาก system_settings.report_section_titles — ว่าง = ใช้ค่าเริ่มต้นตามภาษา
  let SEC_TITLES = {};
  function setSectionTitles(obj) {
    SEC_TITLES = {};
    if (!obj || typeof obj !== 'object') return;
    for (const k of SECTION_KEYS) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) SEC_TITLES[k] = v.trim();
    }
  }
  function getSectionTitles() { return Object.assign({}, SEC_TITLES); }
  // ชื่อหัวข้อที่ต้องแสดงจริง — ค่าที่ตั้งเองชนะเสมอ ไม่มีก็ตกไปที่ i18n เดิม
  function secTitle(key, fallback) {
    const def = SECTION_TITLE_DEFS[key];
    return SEC_TITLES[key] || _label(def ? def.titleKey : key, fallback);
  }
  function normalizeOpts(o) {
    o = o || {};
    const kpis = o.kpis == null ? KPI_KEYS
               : (o.kpis instanceof Set ? [...o.kpis] : String(o.kpis).split(','));
    const secs = o.secs == null ? SECTION_KEYS
               : (o.secs instanceof Set ? [...o.secs] : String(o.secs).split(','));
    return {
      kpis: new Set(kpis.map(s => String(s).trim()).filter(k => KPI_KEYS.includes(k))),
      secs: new Set(secs.map(s => String(s).trim()).filter(k => SECTION_KEYS.includes(k))),
      catsort: ['name', 'manual'].includes(o.catsort) ? o.catsort : 'count',
      // ไม่ส่งมา = แสดง (พฤติกรรมเดิมของรายงานทุกใบที่ทำไว้ก่อนหน้านี้)
      showDelta: !(o.showDelta === false || o.showDelta === 'false' || o.showDelta === '0'),
      showPct: !(o.showPct === false || o.showPct === 'false' || o.showPct === '0'),
    };
  }
  // กรองหมวดที่ผู้ใช้เลือกไม่ให้แสดง (เจ้าของสั่ง 2026-08-25)
  //
  // กรองที่ **ข้อมูล** ไม่ใช่ที่ตอนวาด เพราะ cats ถูกใช้ทั้งการ์ดสรุป (totalEvents,
  // sumGroup), กราฟแท่ง, โดนัท และตาราง — ถ้าไปกรองเฉพาะตาราง ยอดรวมจะไม่เท่ากับ
  // ผลบวกของแถวที่เห็น ซึ่งเป็นรายงานที่ลูกค้าจะทักทันที
  //
  // ⚠️ ใช้กับ "หน้ารายงาน" เท่านั้น — หน้าสถิติของแดชบอร์ดเรียก /api/stats/categories
  // ตรง ๆ และไม่ได้ผ่านไฟล์นี้เลย (ยืนยันแล้ว: ReportTemplate.* ถูกเรียกจาก
  // report-print.js กับ page-reports.js สองไฟล์เท่านั้น)
  //
  // เก็บเป็น "หมวดที่ติ๊กออก" ไม่ใช่ "หมวดที่เลือก" — เหตุผลสองข้อ (2026-08-25):
  //   1. หมวดที่สร้างใหม่ทีหลังจะ **โผล่ในรายงานเอง** ถ้าเก็บรายชื่อที่เลือกไว้
  //      หมวดใหม่จะไม่อยู่ในรายชื่อ แล้วหายจากรายงานเงียบ ๆ ทั้งที่ไม่มีใครสั่งซ่อน
  //   2. ตรงกับเกณฑ์ที่ฝั่ง SQL ใช้กับ /breakdown-v2 และ /heatmap (cats_hide)
  //      ทุกหัวข้อในรายงานจึงตัดสินด้วยรายการเดียวกันจริง ๆ
  //
  // ids ว่าง/null = ไม่ซ่อนอะไร · ถ้าซ่อนจนไม่เหลือสักหมวดจะคืนข้อมูลเดิมทั้งชุด
  // ไม่ใช่ส่งรายงานเปล่าให้ลูกค้า
  function hideCats(d, hideIds) {
    if (!d || !hideIds) return d;
    // ดูความสามารถ ไม่ใช่ instanceof — Set ที่ข้าม realm มา (เช่นจาก vm ตอนเทสต์
    // หรือจาก iframe) จะ instanceof ไม่ผ่านแล้วตกไปทาง String() เงียบ ๆ
    // ซึ่งได้ "[object Set]" → NaN → กลายเป็น "ไม่ซ่อนอะไร" โดยไม่มีใครรู้
    const hide = (hideIds && typeof hideIds.has === 'function')
      ? hideIds
      : new Set(String(hideIds).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite));
    if (!hide.size) return d;
    const all = (d.cats && d.cats.categories) || [];
    const kept = all.filter(c => !hide.has(c.id));
    if (!kept.length) return d;              // ซ่อนหมดจนไม่เหลืออะไร
    if (kept.length === all.length) return d;
    const out = Object.assign({}, d);
    out.cats = Object.assign({}, d.cats, { categories: kept });
    if (d.tl && Array.isArray(d.tl.series)) {
      out.tl = Object.assign({}, d.tl, {
        series: d.tl.series.filter(x => !hide.has(x.category && x.category.id)),
      });
    }
    return out;
  }

  // ตารางเก่าที่บันทึกไว้ก่อน 2026-08-25 เก็บเป็น "หมวดที่เลือก" — แปลงให้เป็น
  // "หมวดที่ซ่อน" โดยเทียบกับรายชื่อหมวดของข้อมูลชุดนั้น จะได้อ่านของเดิมได้ต่อ
  function legacyShownToHidden(d, shownIds) {
    if (!shownIds) return null;
    const shown = (shownIds && typeof shownIds.has === 'function')
      ? shownIds
      : new Set(String(shownIds).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite));
    if (!shown.size) return null;
    const all = (d && d.cats && d.cats.categories) || [];
    return new Set(all.filter(c => !shown.has(c.id)).map(c => c.id));
  }

  // เรียงหมวด — ใช้ตัวเดียวกันทั้งตาราง กราฟแท่ง และโดนัท ทั้งสามอันจะได้ไม่เรียงคนละแบบ
  // (ของเดิมเรียงคนละแบบจริง: ตารางตาม sort_order ส่วนกราฟแท่งเรียงมาก→น้อย)
  function sortCats(cats, mode) {
    const rows = [...(cats || [])];
    // 'manual' = ลำดับที่ตั้งไว้ในหน้าหมวดหมู่ (ช่อง "ลำดับการแสดง") — API ส่งมา
    // เรียงตาม sort_order, id ให้อยู่แล้ว จึงคืนตามลำดับเดิมโดยไม่ต้องเรียงซ้ำ
    if (mode === 'manual') return rows;
    return mode === 'name'
      ? rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'))
      : rows.sort((a, b) => (b.count || 0) - (a.count || 0));
  }

  // "สัดส่วนประเภทเหตุการณ์" นับ IN/OUT ของหมวดเดียวกันรวมเป็นชิ้นเดียว
  // (เจ้าของสั่ง 2026-09-04) — บล็อกนี้คือ *ภาพรวม* ถ้าแยก IN/OUT มันจะซ้ำกับ
  // ตาราง "รายละเอียดตามหมวดหมู่" ด้านบนที่แยกอยู่แล้ว
  // จับคู่จาก **ชื่อ** เท่านั้น (schema ไม่มีคอลัมน์ทิศทาง) — ตัด suffix " (IN)"/" (OUT)"
  // ท้ายชื่อ · ชื่อที่ไม่มี suffix นี้ (เช่น "รถยนต์ (เลี้ยวเข้าซอย)", ทุกหมวดของ vss)
  // จะไม่ถูกยุบ ⇒ ไซต์ที่ไม่ได้ตั้งชื่อแบบ IN/OUT ได้ผลเท่าเดิมทุกประการ
  // สีของชิ้นที่ยุบแล้ว = สีของสมาชิกที่ยอดมากที่สุด (เป็นตัวแทนที่คนจำได้)
  // idempotent — เรียกซ้ำได้ เพราะชื่อที่ยุบแล้วไม่มี suffix ให้ตัดอีก
  //
  // **ยุบแล้วต้องหารด้วยจำนวนสมาชิก ไม่ใช่บวกกันเฉย ๆ** (เจ้าของสั่ง 2026-09-10)
  // รถคันเดียวข้ามเส้นขาเข้าหนึ่งครั้ง ขาออกอีกหนึ่งครั้ง ⇒ IN+OUT = จำนวน *ครั้งที่ผ่านเส้น*
  // ไม่ใช่จำนวน *รถ* · ชิ้นในโดนัทเขียนว่า "รถยนต์" คนอ่านจึงอ่านเป็นจำนวนรถ
  // วัดจริงที่ RMUTR-V 8–9 ก.ย. 2569: รถยนต์ IN 3,536 / OUT 3,479 · จักรยานยนต์
  // IN 7,953 / OUT 8,120 — สองทิศต่างกันไม่ถึง 2% ยืนยันว่าเป็นรถชุดเดียวกันวิ่งเข้าแล้วออก
  //
  // หารด้วย "จำนวนหมวดที่ยุบเข้าด้วยกัน" ไม่ใช่หาร 2 ตายตัว — หมวดที่มีทิศเดียว
  // (มีแต่ (IN) ไม่มี (OUT)) จะหารด้วย 1 คือไม่ถูกแตะ · หาร 2 ตายตัวจะสร้างตัวเลข
  // ที่ไม่มีอยู่จริงให้หมวดแบบนั้นแบบเงียบ ๆ
  //
  // ⚠️ กระทบเฉพาะ "สัดส่วนประเภทเหตุการณ์" (โดนัท + ตารางกำกับข้าง ๆ) ซึ่งเป็นที่เดียว
  //    ที่เรียกตัวนี้ · การ์ด "ยานพาหนะ" · "จำนวนตามกล้อง" · ตาราง "รายละเอียดตามหมวดหมู่"
  //    ยังนับครั้งที่ผ่านเส้นเหมือนเดิม (เจ้าของตัดสิน 2026-09-10 ให้แก้จุดนี้จุดเดียว)
  //    ⇒ การ์ด "ยานพาหนะ" จะมากกว่าผลรวมของโดนัทราวสองเท่าที่ RMUTR-V โดยตั้งใจ
  // ⚠️ change_pct ของแถวที่ยุบเป็นค่าของสมาชิกตัวแรก ไม่ได้คำนวณใหม่ (เป็นแบบนี้มาแต่เดิม)
  //    ตอนนี้ไม่มีใครแสดงมันในบล็อกโดนัท — ถ้าวันหน้าจะโชว์ ต้องคิดใหม่ตรงนี้ก่อน
  const _INOUT_RE = /\s*\((?:in|out)\)\s*$/i;
  function mergeInOut(cats) {
    const rows = cats || [];
    if (!rows.some(c => _INOUT_RE.test(String(c.name || '')))) return rows;
    const byKey = new Map();
    rows.forEach((c) => {
      const key = String(c.name || '').replace(_INOUT_RE, '').trim() || String(c.name || '');
      const hit = byKey.get(key);
      if (!hit) {
        byKey.set(key, Object.assign({}, c, { name: key, _topCount: c.count || 0, _members: 1 }));
        return;
      }
      hit.count = (hit.count || 0) + (c.count || 0);
      hit.prev_count = (hit.prev_count || 0) + (c.prev_count || 0);
      hit._members += 1;
      if ((c.count || 0) > hit._topCount) { hit._topCount = c.count || 0; hit.color = c.color; hit.icon = c.icon; }
    });
    return [...byKey.values()].map((c) => {
      const n = c._members || 1;
      const out = Object.assign({}, c, {
        count: n > 1 ? Math.round((c.count || 0) / n) : (c.count || 0),
        prev_count: n > 1 ? Math.round((c.prev_count || 0) / n) : (c.prev_count || 0),
      });
      delete out._members;
      delete out._topCount;
      return out;
    });
  }

  function buildReportHtml(d, brand, options) {
    brand = brand || {};
    const opts = normalizeOpts(options);
    const brandName    = brand.name    || 'Vigil Platform';
    const brandTagline = brand.tagline || '';
    const brandLogoUrl = brand.logo_url ? `${brand.logo_url}?v=${Date.now()}` : null;

    // — colour tokens (E1) — defaults match previous hardcoded values so existing
    //   reports look identical; brand can override via future brand.color_* fields.
    const accent    = brand.primary_color || '#5b8def';
    const clrText   = '#2d3748';   // heading / value text
    const clrDark   = '#1a202c';   // title / darkest text
    const clrMid    = '#4a5568';   // axis ticks / footer brand name
    const clrDim    = '#718096';   // labels / secondary text
    const clrDim2   = '#a0aec0';   // tagline
    const clrOk     = '#22c55e';   // people / status-ok
    const clrWarn   = '#f59e0b';   // vehicles / warn
    const clrPurple = '#a78bfa';   // cameras
    const clrSurf   = '#f7fafc';   // table row bg / card bg
    const clrDiv    = '#f1f5f9';   // table row border
    const clrBord   = '#e2e8f0';   // chart border / heatmap cell
    const clrWarm   = '#fff7e6';   // quiet-cameras thead bg

    const headerHtml = `
      <div style="border-bottom:3px solid ${esc(accent)};padding-bottom:14px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:14px">
            ${brandLogoUrl ? `<img src="${esc(brandLogoUrl)}" alt="logo" style="width:64px;height:64px;object-fit:contain">` : ''}
            <div>
              <div style="font-size:22px;font-weight:700;color:${clrDark}">${esc(d.title)}</div>
              <div style="font-size:13px;color:${clrMid};margin-top:4px">${esc(d.range && d.range.label)}</div>
            </div>
          </div>
          <div style="text-align:right;font-size:11px;color:${clrDim}">
            <div style="font-weight:700;color:${clrText}">${esc(brandName)}</div>
            ${brandTagline ? `<div style="font-size:10px;color:${clrDim2}">${esc(brandTagline)}</div>` : ''}
            <div style="margin-top:3px">${esc(I18N.t('rt.generatedAt').replace('{d}', new Date().toLocaleString(((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB', { hour12: false })))}</div>
          </div>
        </div>
      </div>`;

    // เรียงตั้งแต่ตรงนี้ที่เดียว ทุกส่วนที่ใช้ cats จึงเรียงตรงกันหมดโดยอัตโนมัติ
    const cats = sortCats((d.cats && d.cats.categories) || [], opts.catsort);
    const totalEvents  = cats.reduce((s, c) => s + (c.count || 0), 0);
    // การ์ด 3 ใบนี้ต้องบวกจาก "ตัวเลขชุดเดียวกับกราฟ" เสมอ ยอดถึงจะตรงกัน
    // ⚠️ เดิมไปหาหมวดที่ kind = people_counter / vehicle_counter ซึ่งทั้งระบบมีอยู่
    //    หมวดเดียว (People Counting ของ vss) ⇒ การ์ดขึ้น 0 แทบทุกไซต์มาตลอด
    // ⚠️ และห้ามไปนับ object_class ดิบเองด้วย — วัดจริงที่ RMUTR-V ช่วง 17–24 ส.ค.
    //    ได้ 15,545 ขณะที่กราฟแสดง 15,492 ต่างกัน 53 ตัว = event ของ rule ชื่อเดิม
    //    "Vehicle Count" ก่อนถูกแยกเป็น IN/OUT ซึ่งมี object_class แต่ไม่เข้าหมวดไหน
    const sumGroup = (g) => cats.filter(c => c.object_group === g)
                                .reduce((s, c) => s + (c.count || 0), 0);
    const peopleTotal  = sumGroup('Person');
    const vehicleTotal = sumGroup('Vehicle');
    // cameras_seen = [{camera_id, count}] ต่อหมวด — ยุบข้ามหมวดในกลุ่มเดียวกัน
    // กล้องหนึ่งตัวยิงได้หลายหมวด (รถยนต์ IN + OUT) ต้องบวกกัน ไม่ใช่นับซ้ำ
    const camAgg = (group) => {
      const acc = new Map();
      cats.filter(c => c.object_group === group).forEach(c =>
        (c.cameras_seen || []).forEach(x => {
          acc.set(x.camera_id, (acc.get(x.camera_id) || 0) + (x.count || 0));
        }));
      return [...acc.entries()]
        .map(([camera_id, count]) => ({ camera_id, count }))
        .sort((a, b) => b.count - a.count);
    };
    const camPerson  = camAgg('Person');
    const camVehicle = camAgg('Vehicle');
    const cameraSet = new Set([...camPerson, ...camVehicle].map(x => x.camera_id));
    // การ์ดที่ผู้ใช้ติ๊กเอาไว้เท่านั้น — ติ๊กออกหมด = ซ่อนทั้งหัวข้อ ไม่ใช่เหลือกรอบว่าง
    // และคอลัมน์ปรับตามจำนวนที่เหลือ ไม่งั้นเหลือใบเดียวจะยืดยาวทั้งแถวดูประหลาด
    const kpiCard = (color, label, value) => `<div style="background:${clrSurf};padding:14px;border-radius:8px;border-left:3px solid ${color}"><div style="font-size:10px;color:${clrDim};text-transform:uppercase;font-weight:700">${esc(label)}</div><div style="font-size:24px;font-weight:700;color:${clrText}">${value.toLocaleString()}</div></div>`;
    const kpiCards = [
      ['events',   () => kpiCard(accent,    I18N.t('rt.totalEvents'),     totalEvents)],
      ['people',   () => kpiCard(clrOk,     I18N.t('cam.people'),         peopleTotal)],
      ['vehicles', () => kpiCard(clrWarn,   I18N.t('rt.vehicles'),        vehicleTotal)],
      ['cameras',  () => kpiCard(clrPurple, I18N.t('rt.camerasDetected'), cameraSet.size)],
    ].filter(([key]) => opts.kpis.has(key)).map(([, build]) => build());
    const kpiTopHtml = kpiCards.length ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.summary'))}</h3>
      <div style="display:grid;grid-template-columns:repeat(${kpiCards.length},1fr);gap:12px;margin-top:12px">
        ${kpiCards.join('')}
      </div>` : '';

    // E3 — coverage/evidence section removed (low value); d.cov/d.ev still
    // returned by the backend but no longer rendered.

    const { points: trendPoints, trunc } = computeTrendPoints(d);
    const trendLabel = trunc === 'hour' ? I18N.t('rt.byHour') : trunc === 'minute30' ? I18N.t('rt.byHalfHour') : trunc === 'day' ? I18N.t('rt.byDay') : I18N.t('rt.byWeek');
    // เส้นแยกตามหมวด แบบเดียวกับหน้า "สถิติเหตุการณ์" (เจ้าของสั่ง 2026-08-21)
    // เดิมรวมทุกหมวดเป็นเส้นเดียว ซึ่งบอกได้แค่ "ช่วงไหนคนเยอะ" แต่ไม่บอกว่าเยอะเพราะอะไร
    // ⚠️ page-break-inside:avoid — กราฟกับคำอธิบายสีต้องอยู่หน้าเดียวกันตอนพิมพ์
    //    ไม่งั้นได้กราฟท้ายหน้าหนึ่ง แล้วคำอธิบายไปโผล่หน้าถัดไปโดด ๆ
    const tlSeries = (d.tl && d.tl.series) || [];
    const trendChartHtml = (trendPoints.length && opts.secs.has('trend')) ? `
      <div style="page-break-inside:avoid">
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('trend').replace('{label}', trendLabel))}</h3>
      <div style="position:relative;height:220px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="reportTrendChart"></canvas>
      </div>
      ${tlSeries.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:8px;font-size:10px;color:${clrDim}">
        ${tlSeries.map((s, i) => {
          const c = s.category || {};
          return `<span style="display:inline-flex;align-items:center;gap:5px">
            <span style="width:9px;height:9px;border-radius:2px;background:${esc(c.color || SERIES_PALETTE[i % SERIES_PALETTE.length])};display:inline-block"></span>${esc(c.name || '')}</span>`;
        }).join('')}</div>` : ''}
      </div>` : '';

    // CR.8 — daily7: bar chart of last 7 days
    const daily7Data = d.daily7 || null;
    // แท่งซ้อนแยกประเภท — เกณฑ์ "มีข้อมูล" ดูจากยอดรวมรายวันที่ dailySeries คำนวณไว้
    const daily7Totals = (daily7Data && daily7Data.prepared && daily7Data.prepared.totals) || [];
    const daily7HasData = daily7Totals.some(v => (v || 0) > 0);
    const daily7Html = (daily7HasData && opts.secs.has('daily7')) ? `
      <div style="page-break-inside:avoid">
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('daily7', 'ย้อนหลัง 7 วัน'))}</h3>
      <div style="font-size:11px;color:${clrDim};margin-top:4px">${esc(daily7Data && daily7Data.from ? daily7Data.from + ' – ' + daily7Data.to : '')}</div>
      <div style="position:relative;height:230px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="reportDaily7Chart"></canvas>
      </div>
      </div>` : '';

    // CR.8 — monthly: bar chart of current month
    const monthlyData = d.monthly || null;
    const monthlyTotals = (monthlyData && monthlyData.prepared && monthlyData.prepared.totals) || [];
    const monthlyHasData = monthlyTotals.some(v => (v || 0) > 0);
    const monthlyHtml = (monthlyHasData && opts.secs.has('monthly')) ? `
      <div style="page-break-inside:avoid">
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('monthly', 'รายเดือน (วันที่ 1 ถึงสิ้นเดือน)'))}</h3>
      <div style="font-size:11px;color:${clrDim};margin-top:4px">${esc(monthlyData && monthlyData.from ? monthlyData.from + ' – ' + monthlyData.to + ' · ' + (monthlyData.monthLabel || '') : '')}</div>
      <div style="position:relative;height:230px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="reportMonthlyChart"></canvas>
      </div>
      </div>` : '';

    // สัดส่วนประเภทเหตุการณ์ — โดนัท + ตารางกำกับ (%) เจ้าของสั่ง 2026-08-21
    // ใช้ตัวเลขชุดเดียวกับ catKpiHtml ยอดจึงตรงกันโดยโครงสร้าง ไม่ได้ไปนับใหม่
    // cats ถูกเรียงตามตัวเลือกมาแล้ว — ที่นี่แค่ตัดหมวดที่ยอดเป็น 0 ทิ้ง
    // (ชิ้นพายกว้าง 0 องศา แต่ยังกินบรรทัดในตารางกำกับ)
    // ยุบ IN/OUT ก่อนแล้วค่อยเรียงใหม่ — ไม่งั้นลำดับจะยังเป็นของก่อนยุบ
    const shareRows = sortCats(mergeInOut(cats), opts.catsort).filter(c => (c.count || 0) > 0);
    const shareTotal = shareRows.reduce((s, c) => s + (c.count || 0), 0);
    const shareHtml = (shareRows.length && opts.secs.has('share')) ? `
      <div style="page-break-inside:avoid">
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('share', 'สัดส่วนประเภทเหตุการณ์'))}</h3>
      <div style="display:flex;gap:16px;margin-top:10px;align-items:flex-start">
        <div style="position:relative;width:210px;height:210px;flex:0 0 auto;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
          <canvas id="reportShareChart"></canvas>
        </div>
        <table style="flex:1;border-collapse:collapse;font-size:11px">
          <tbody>${shareRows.map((c, i) => {
            const pct = shareTotal ? (c.count / shareTotal * 100) : 0;
            return `<tr>
              <td style="padding:4px 6px;border-bottom:1px solid ${clrDiv};width:14px">
                <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${esc(c.color || SERIES_PALETTE[i % SERIES_PALETTE.length])}"></span></td>
              <td style="padding:4px 6px;border-bottom:1px solid ${clrDiv}">${esc(c.name)}</td>
              <td style="padding:4px 6px;text-align:right;border-bottom:1px solid ${clrDiv};font-weight:700">${_fmt(c.count)}</td>
              <td style="padding:4px 6px;text-align:right;border-bottom:1px solid ${clrDiv};color:${clrDim};width:46px">${pct.toFixed(1)}%</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      </div>` : '';

    // ไซต์ที่ยังไม่ได้ตั้งหมวดหมู่ (main/bma ตอนนี้) → ซ่อนทั้งหัวข้อ ไม่ใช่วาดหัวตาราง
    // เปล่าออกมา · ทุกหัวข้ออื่นในรายงานทำแบบนี้อยู่แล้ว (kpiTop/trend/share/brk/quiet)
    // catKpi เป็นหัวข้อเดียวที่ไม่มีเงื่อนไข — เอกสารนี้ถึงมือลูกค้า ไม่ควรมีที่ว่าง
    const catChartHeight = Math.max(120, cats.length * 28);
    // ฐานของ % = ผลรวมหมวดที่แสดงจริง ตัวเลขจึงบวกได้ 100% เสมอแม้ซ่อนบางหมวด
    // (เจ้าของสั่ง 2026-09-04 — ปิด % บนโดนัทแล้วต้องยังอ่าน % ได้จากตาราง)
    const catTotal = cats.reduce((a, c) => a + (c.count || 0), 0);
    const catKpiHtml = (!cats.length || !opts.secs.has('catchart')) ? '' : `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('catchart'))}</h3>
      ${cats.length ? `<div style="position:relative;height:${catChartHeight}px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="reportCategoryChart"></canvas>
      </div>` : ''}
      <div style="display:flex;gap:14px;margin-top:10px;align-items:flex-start">
      <table style="flex:1;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:${clrSurf}"><th style="padding:8px;text-align:left" colspan="2">${esc(I18N.t('rt.colCategory'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th><th style="padding:8px;text-align:right;width:52px">%</th>${opts.showDelta ? `<th style="padding:8px;text-align:right">${esc(I18N.t('rt.colVsPrev'))}</th>` : ''}</tr></thead>
        <tbody>${cats.map((c, i) => {
          const cmpRaw = c.change_pct;
          let cmp = '—';
          if (c.prev_count === 0 && c.count > 0) cmp = '↑ NEW';
          else if (c.prev_count > 0 && c.count === 0) cmp = '▼ STOPPED';
          else if (cmpRaw == null) cmp = '—';
          else cmp = (cmpRaw >= 0 ? '▲ ' : '▼ ') + Math.abs(cmpRaw).toFixed(1) + '%';
          // จุดสี = legend ของวงกลมที่อยู่ขวามือ (วงไม่มีป้ายชื่อในตัว)
          return `<tr>
            <td style="padding:6px 4px 6px 8px;border-bottom:1px solid ${clrDiv};width:14px">
              <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${esc(c.color || SERIES_PALETTE[i % SERIES_PALETTE.length])}"></span></td>
            <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(c.icon || '')} ${esc(c.name)}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(c.count || 0).toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;border-bottom:1px solid ${clrDiv};color:${clrDim}">${(catTotal ? (c.count || 0) / catTotal * 100 : 0).toFixed(1)}%</td>
            ${opts.showDelta ? `<td style="padding:6px 8px;text-align:right;border-bottom:1px solid ${clrDiv};color:#666">${cmp}</td>` : ''}
          </tr>`;
        }).join('')}</tbody></table>
        <div style="position:relative;width:200px;height:200px;flex:0 0 auto;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
          <canvas id="reportCatShareChart"></canvas>
        </div>
      </div>`;

    // "Rule ที่ทำงานบ่อยสุด" ถูกถอดออก 2026-08-21 ตามคำสั่งเจ้าของ — ผู้ใช้ทั่วไป
    // ไม่ได้ต้องการชื่อ rule ในกล้อง และมันซ้ำกับ "รายละเอียดเหตุการณ์" ด้านล่างอยู่แล้ว
    // (/api/stats/top-rules เลิกเรียกจากทั้งหน้าจอและหน้าพิมพ์ด้วย)

    // ไซต์ที่มีแต่ยานพาหนะ (หรือมีแต่คน) จะเหลือตารางเดียว — ให้กินเต็มความกว้าง
    // ไม่งั้นครึ่งขวาว่างเปล่าทั้งหน้า
    const camTableW = (camPerson.length && camVehicle.length) ? '48%' : '100%';
    const camTable = (rows, header) => rows.length ? `
      <table style="width:${camTableW};border-collapse:collapse;margin-top:8px;font-size:12px;display:inline-table;vertical-align:top">
        <thead><tr style="background:${clrSurf}"><th colspan="2" style="padding:8px;text-align:left">${header}</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(r.camera_id)}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';
    // ⚠️ เดิมดึงจาก /api/stats/per-camera-counts ซึ่งบังคับ kind=people_counter /
    //    vehicle_counter — ทั้งระบบมีหมวดแบบนั้นอยู่หมวดเดียว ⇒ หัวข้อนี้ว่างแทบทุกไซต์
    //    มาตลอด (ที่ hdy มี 40 กล้องแต่ได้ 0) · ตอนนี้ใช้ตัวเลขชุดเดียวกับกราฟ
    //    ยอดต่อกล้องจึงบวกได้เท่ากับการ์ดสรุปด้านบนเสมอ
    const pplRows = camPerson;
    const vehRows = camVehicle;
    const perCamHtml = ((pplRows.length || vehRows.length) && opts.secs.has('percam')) ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('percam'))}</h3>
      <div style="display:flex;gap:14px;margin-top:10px">
        ${camTable(pplRows, esc(I18N.t('stats.peopleByCam') || 'People'))}
        ${camTable(vehRows, esc(I18N.t('rt.vehicles') || 'Vehicle'))}
      </div>` : '';

    const brk = (d.brk || []).slice(0, 15);
    const brkHtml = (brk.length && opts.secs.has('detail')) ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('detail'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:${clrSurf}"><th style="padding:8px;text-align:left">${esc(I18N.t('rt.colEvent'))}</th><th style="padding:8px;text-align:left">${esc(I18N.t('common.camera'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th></tr></thead>
        <tbody>${brk.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(_eventLabel(r))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(r.camera_name || r.camera_id || '')}${
            r.camera_location ? `<br><span style="color:#999;font-size:10px">${esc(r.camera_location)}</span>` : ''
          }<br><span style="color:#aaa;font-size:9.5px">${esc(r.camera_id || '')}</span></td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';

    const heatCells = (d.heat && d.heat.cells) || [];
    let heatHtml = '';
    if (heatCells.length && opts.secs.has('heatmap')) {
      const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
      let max = 0;
      heatCells.forEach(c => { matrix[c.dow][c.hour] = c.count; if (c.count > max) max = c.count; });
      const days = I18N.t('stats.dowShort').split(',');
      // ⚠️ ห่อด้วย avoid — ตารางนี้อ่านเป็นภาพรวม 7×24 ถ้าถูกตัดคร่อมหน้าเหลือ 3 แถว
      //    หน้าหนึ่ง 4 แถวอีกหน้า จะเทียบวันกันไม่ได้เลย (เจอจริงตอนทำ 2026-08-21)
      heatHtml = `
        <div style="page-break-inside:avoid">
        <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(secTitle('heatmap'))}</h3>
        <table style="border-collapse:collapse;font-size:9px;font-family:monospace;margin-top:10px;width:100%">
          <thead><tr><th></th>${[...Array(24)].map((_, h) => `<th style="text-align:center;color:#666;font-weight:normal;padding:2px">${h.toString().padStart(2, '0')}</th>`).join('')}</tr></thead>
          <tbody>${matrix.map((row, dy) => `<tr>
            <th style="text-align:right;padding:2px 6px;color:#666;font-weight:normal">${days[dy]}</th>
            ${row.map(v => {
              const ratio = max > 0 ? v / max : 0;
              // ponytail: heatmap rgba hardcoded to accent default; parameterize if custom-theme heatmap needed
              let bg = clrSurf;
              if (v > 0) {
                if (ratio < 0.2) bg = 'rgba(91,141,239,0.25)';
                else if (ratio < 0.5) bg = 'rgba(91,141,239,0.55)';
                else if (ratio < 0.8) bg = 'rgba(91,141,239,0.85)';
                else bg = 'rgba(91,141,239,1)';
              }
              const fg = ratio > 0.5 ? '#fff' : clrText;
              return `<td style="text-align:center;padding:2px;background:${bg};color:${fg};border:1px solid ${clrBord};min-width:18px">${v > 0 ? v : ''}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
        </table>
        </div>`;
    }

    const quiet = (d.quiet && d.quiet.cameras) || [];
    const quietHtml = (quiet.length && opts.secs.has('quiet')) ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${clrWarn};padding-bottom:6px;margin-top:18px">${esc(secTitle('quiet'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:${clrWarm}"><th style="padding:8px;text-align:left">${esc(I18N.t('common.camera'))}</th><th style="padding:8px;text-align:left">last_seen</th></tr></thead>
        <tbody>${quiet.map(c => {
          const ago = c.last_seen_ago_sec;
          const agoTxt = ago == null ? '—'
            : ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago / 60)}m` : `${Math.round(ago / 3600)}h`;
          return `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(c.camera_name || c.camera_id)} <span style="color:#999;font-size:10px">${esc(c.camera_id)}</span></td>
            <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv};color:#666">${agoTxt}${ago == null ? '' : ' ago'}</td>
          </tr>`;
        }).join('')}</tbody></table>` : '';

    // footer ในตัวเอกสาร — ใช้กับ **ภาพ PNG** เท่านั้น เพราะ screenshot ไม่มีหน้ากระดาษ
    // จึงไม่มี footer ต่อหน้าให้ใช้ · ฝั่ง PDF ซ่อนอันนี้ทิ้งใน report-print-override.css
    // แล้วใช้ footer ต่อหน้าของ Chromium แทน (แบรนด์ + โลโก้ + เลขหน้า) ไม่งั้นหน้าสุดท้าย
    // จะมี footer ซ้อนกันสองชั้น
    const footerHtml = `
      <div class="rpt-doc-footer" style="margin-top:30px;padding-top:14px;border-top:1px solid ${clrBord};font-size:10px;color:${clrDim};display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;color:${clrMid}">${esc(brandName)}</span>
        <span>© 2025-2026 ${esc(brandName)} · All Rights Reserved</span>
      </div>`;

    // ย้อนหลัง 7 วัน / รายเดือน อยู่ **ท้ายสุด** (เจ้าของสั่ง 2026-09-04) — เป็นบริบท
    // ย้อนหลัง ไม่ใช่เนื้อหาของช่วงที่เลือก จึงไม่ควรคั่นกลางระหว่างกราฟกับหมวดหมู่
    return headerHtml + kpiTopHtml + trendChartHtml + catKpiHtml + shareHtml +
           perCamHtml + brkHtml + heatHtml + quietHtml + daily7Html + monthlyHtml + footerHtml;
  }

  // Aggregate the timeline-by-category series into per-bucket totals.
  function computeTrendPoints(d) {
    const series = (d.tl && d.tl.series) || [];
    const trunc  = (d.tl && d.tl.trunc) || 'day';
    const bucketTotals = {};
    series.forEach(s => {
      (s.points || []).forEach(p => {
        bucketTotals[p.bucket] = (bucketTotals[p.bucket] || 0) + (p.count || 0);
      });
    });
    const points = Object.entries(bucketTotals)
      .map(([bucket, total]) => ({ bucket, total }))
      .sort((a, b) => new Date(a.bucket) - new Date(b.bucket));
    return { points, trunc };
  }

  // เส้นหนึ่งเส้นต่อหนึ่งหมวด แบบเดียวกับหน้า "สถิติเหตุการณ์" (เจ้าของสั่ง 2026-08-21)
  // ⚠️ ใช้แกน x แบบ category (labels) ไม่ใช่ type:'time' — หน้าพิมพ์โหลดแค่ chart.umd
  //    ไม่ได้โหลด adapter date-fns ถ้าใช้ time scale กราฟจะว่างเปล่าเงียบ ๆ ใน PDF
  // animation:false เหมือนเดิม — Puppeteer ต้องได้เฟรมที่วาดเสร็จแล้ว ไม่ใช่ระหว่างอนิเมชัน
  let _trendChart = null;
  function renderReportTrendChart(canvasId, d, accent) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;
    if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
    const series = (d && d.tl && d.tl.series) || [];
    const trunc  = (d && d.tl && d.tl.trunc) || 'day';
    const loc = ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB';
    const fmt = (b) => {
      const dt = new Date(b);
      if (trunc === 'hour' || trunc === 'minute30') return dt.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
      return dt.toLocaleDateString(loc, { day: '2-digit', month: 'short' });
    };
    // แต่ละหมวดอาจไม่มีจุดครบทุกถัง — ต้องรวมถังจากทุกหมวดก่อน แล้วเติม 0 ให้ครบ
    // ไม่งั้นเส้นแต่ละเส้นจะเลื่อนไม่ตรงกันบนแกน x
    const buckets = [...new Set(series.flatMap(s => (s.points || []).map(p => p.bucket)))]
      .sort((a, b) => new Date(a) - new Date(b));
    if (!buckets.length) return;
    const datasets = series.map((s, i) => {
      const c = s.category || {};
      const color = c.color || SERIES_PALETTE[i % SERIES_PALETTE.length];
      const byBucket = new Map((s.points || []).map(p => [new Date(p.bucket).getTime(), p.count || 0]));
      return {
        label: c.name || '',
        data: buckets.map(b => byBucket.get(new Date(b).getTime()) || 0),
        borderColor: color, backgroundColor: color,
        borderWidth: 1.6, tension: 0.3, fill: false,
        pointRadius: buckets.length > 40 ? 0 : 1.8, pointHoverRadius: 4,
      };
    });
    _trendChart = new Chart(ctx, {
      type: 'line',
      data: { labels: buckets.map(fmt), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          // คำอธิบายสีวาดเป็น HTML ใต้กราฟแทน — legend ของ Chart.js กินพื้นที่กราฟ
          // และตัดคำไทยยาว ๆ ทิ้งเมื่อหมวดเยอะ
          legend: { display: false },
          tooltip: { backgroundColor: '#1a202c', titleColor: '#fff', bodyColor: '#fff' },
        },
        scales: {
          // ทุก 30 นาที (22 ถัง) ติดป้ายครบทุกถัง ไม่ให้ autoSkip ข้ามครึ่งชั่วโมงทิ้ง
          x: { ticks: { color: '#4a5568', font: { size: 9 }, maxRotation: 45,
                        autoSkip: trunc !== 'minute30', autoSkipPadding: 12 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#4a5568', precision: 0, font: { size: 10 } },
               grid: { color: 'rgba(0,0,0,0.05)' } },
        },
      },
    });
  }

  // สัดส่วนประเภทเหตุการณ์ — โดนัท ตัวเลข/% อยู่ในตารางข้าง ๆ ไม่วาดทับบนวง
  // (ป้ายไทยบนชิ้นเล็ก ๆ อ่านไม่ออกอยู่แล้วตอนพิมพ์ลง A4)
  // ⚠️ เก็บ instance แยกตาม canvas — รายงานหนึ่งใบมีโดนัทสองวง (วงในบล็อกหมวดหมู่
  //    แยก IN/OUT · วงในบล็อก "สัดส่วน" รวม IN/OUT) ถ้าใช้ตัวแปรเดียวร่วมกัน
  //    วงที่สองจะ destroy วงแรกทิ้ง เหลือกรอบเปล่าโดยไม่มี error ให้เห็น
  const _shareCharts = new Map();
  function renderShareChart(canvasId, cats, catsort, showPct, merge) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined' || !cats || !cats.length) return;
    const prev = _shareCharts.get(canvasId);
    if (prev) { prev.destroy(); _shareCharts.delete(canvasId); }
    // ยุบ IN/OUT ที่นี่ด้วย — ผู้เรียกส่ง cats ดิบมา วงกับตารางกำกับข้าง ๆ
    // จึงต้องนับด้วยกติกาเดียวกัน ไม่งั้น % ในวงกับตัวเลขข้างจะไม่ตรงกัน
    // merge=false = วงในบล็อกหมวดหมู่ ซึ่งคู่กับตารางที่แยก IN/OUT อยู่แล้ว
    const rows = sortCats(merge === false ? cats : mergeInOut(cats), catsort).filter(c => (c.count || 0) > 0);
    if (!rows.length) return;
    // absent/undefined = เปิด (พฤติกรรมเดียวกับ showDelta) — ปิดเฉพาะ false ชัด ๆ
    const pctOn = !(showPct === false || showPct === 'false' || showPct === '0');
    _shareCharts.set(canvasId, new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: rows.map(c => c.name || ''),
        datasets: [{
          data: rows.map(c => c.count || 0),
          backgroundColor: rows.map((c, i) => c.color || SERIES_PALETTE[i % SERIES_PALETTE.length]),
          borderColor: '#fff', borderWidth: 1.5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        cutout: '52%',
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#1a202c', titleColor: '#fff', bodyColor: '#fff' },
        },
      },
      // % กลาง slice — ใช้ตำแหน่ง arc จริงจาก Chart.js (tooltipPosition = กลางวง)
      // ไม่คำนวณมุมเอง จะได้ไม่พังถ้า rotation/padding เปลี่ยน · ชิ้น <3% ข้าม
      // (อ่านไม่ออกบน A4 — ตัวเลขเต็มอยู่ในตารางข้างเสมอ)
      plugins: pctOn ? [{
        id: 'doughnutPctLabels',
        afterDatasetsDraw(chart) {
          const meta = chart.getDatasetMeta(0);
          const values = chart.data.datasets[0].data;
          const total = values.reduce((s, v) => s + (v || 0), 0);
          if (!total || !meta || !meta.data) return;
          const c = chart.ctx;
          c.save();
          c.font = 'bold 10px sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.lineWidth = 2;
          c.strokeStyle = 'rgba(0,0,0,0.35)';
          c.fillStyle = '#fff';
          meta.data.forEach((arc, i) => {
            const pct = (values[i] / total) * 100;
            if (pct < 3 || !arc) return;
            const pos = arc.tooltipPosition();
            const text = (pct < 10 ? pct.toFixed(1) : pct.toFixed(0)) + '%';
            c.strokeText(text, pos.x, pos.y);
            c.fillText(text, pos.x, pos.y);
          });
          c.restore();
        }
      }] : [],
    }));
  }

  // Horizontal bar chart, one bar per category, sorted by count descending —
  // ranks scan better than a pie for long Thai labels + a dominant category.
  // animation:false, same as renderReportTrendChart — the Puppeteer capture
  // needs the painted frame, not an in-progress animation.
  let _catChart = null;
  function renderCategoryChart(canvasId, cats, catsort) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined' || !cats || !cats.length) return;
    if (_catChart) { _catChart.destroy(); _catChart = null; }
    // ⚠️ ต้องเรียงด้วยกติกาเดียวกับตารางข้างล่าง — เดิม hardcode มาก→น้อย
    //    ทำให้กราฟกับตารางเรียงคนละแบบตลอดมา
    const sorted = sortCats(cats, catsort);
    _catChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(c => `${c.icon || ''} ${c.name}`.trim()),
        datasets: [{
          data: sorted.map(c => c.count || 0),
          backgroundColor: sorted.map(c => c.color || '#5b8def'),
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#1a202c', titleColor: '#fff', bodyColor: '#fff' },
        },
        scales: {
          x: { beginAtZero: true, ticks: { color: '#4a5568', precision: 0, font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          y: { ticks: { color: '#4a5568', font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
  }

  // CR.8 — Daily bar chart: หนึ่งแท่งต่อหนึ่งวัน ซ้อนแยกตามประเภท
  // prepared = ผลจาก dailySeries() · opts = { labelMode: 'dow'|'day' }
  // Keep instances in a Map keyed by canvasId to allow multiple charts on one page.
  const _dailyCharts = new Map();
  // แตกยอดรายวันออกเป็น "ประเภท" สำหรับกราฟแท่งซ้อน (เจ้าของสั่ง 2026-09-04)
  // tl = ผลจาก /api/stats/timeline-by-category (กรองหมวดที่ซ่อนมาแล้ว)
  // • รวม IN/OUT เข้าเป็นประเภทเดียว — ทิศทางไม่ใช่ "ประเภท" และแท่ง 8 ชิ้นบางๆ
  //   ต่อวันอ่านไม่ออกบน A4 (ใช้กติกาเดียวกับโดนัทผ่าน _INOUT_RE)
  // • เกิน topN ประเภท ยุบส่วนที่เหลือเป็น "อื่น ๆ" ชิ้นเดียว
  // • คืนแกนวันเต็มช่วงเสมอ (วันที่ไม่มี event = 0) เพื่อให้แท่งเรียงห่างเท่ากัน
  function dailySeries(tl, fromDate, toDate, topN) {
    const N = topN || 8;
    const days = fillDays([], fromDate, toDate).map((r) => r.date);   // แกนวันเปล่า
    const idx = new Map(days.map((d, i) => [d, i]));
    const byType = new Map();
    ((tl && tl.series) || []).forEach((s, si) => {
      const cat = s.category || {};
      const name = String(cat.name || '').replace(_INOUT_RE, '').trim() || String(cat.name || '');
      let e = byType.get(name);
      if (!e) {
        e = { name, color: cat.color || SERIES_PALETTE[si % SERIES_PALETTE.length],
              data: new Array(days.length).fill(0), total: 0, _top: -1 };
        byType.set(name, e);
      }
      let sum = 0;
      (s.points || []).forEach((p) => {
        const i = idx.get(_localYmd(new Date(p.bucket)));
        if (i == null) return;
        e.data[i] += (p.count || 0);
        sum += (p.count || 0);
      });
      e.total += sum;
      // สีของประเภทที่ยุบแล้ว = สีของฝั่งที่ยอดมากกว่า (ตรงกับกติกาของโดนัท)
      if (sum > e._top) { e._top = sum; if (cat.color) e.color = cat.color; }
    });
    const sorted = [...byType.values()].filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
    const head = sorted.slice(0, N);
    const tail = sorted.slice(N);
    if (tail.length) {
      const other = { name: _label('rt.otherTypes', 'อื่น ๆ'), color: '#94a3b8',
                      data: new Array(days.length).fill(0), total: 0 };
      tail.forEach((e) => { e.data.forEach((v, i) => { other.data[i] += v; }); other.total += e.total; });
      head.push(other);
    }
    const totals = days.map((_, i) => head.reduce((s, e) => s + e.data[i], 0));
    return { days, series: head.map(({ name, color, data }) => ({ name, color, data })), totals };
  }

  function renderDailyBarChart(canvasId, prepared, opts) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined' || !prepared || !prepared.days || !prepared.days.length) return;
    const prev = _dailyCharts.get(canvasId);
    if (prev) { prev.destroy(); _dailyCharts.delete(canvasId); }

    opts = opts || {};
    const labelMode = opts.labelMode || 'day';  // 'dow' for weekday short, 'day' for day number
    const rows = prepared.days.map((d, i) => ({ date: d, total: prepared.totals[i] || 0 }));

    // เส้นค่าเฉลี่ยคิดจาก "ยอดรวมต่อวัน" (ความสูงทั้งแท่ง) ไม่ใช่รายประเภท
    const total = rows.reduce((s, r) => s + r.total, 0);
    const avg = rows.length > 0 ? total / rows.length : 0;

    // Build labels based on labelMode
    let labels;
    if (labelMode === 'dow') {
      // Parse YYYY-MM-DD and compute weekday + MM-DD label
      // ⚠️ ค่าใน i18n คั่นด้วยคอมมาและมีจุดในตัวอยู่แล้ว ('จ.,อ.,...') — เรียกแบบ
      //    เดียวกับ heatmap ข้างบน ห้ามใส่ fallback ที่ไม่มีคอมมา (split ได้ตัวเดียว
      //    → ป้ายกลายเป็น '?' ทั้งแถว) และห้ามเติมจุดซ้ำท้ายชื่อวัน
      const dowShort = I18N.t('stats.dowShort').split(',');  // Monday-first
      labels = rows.map(r => {
        const d = new Date(r.date + 'T00:00:00');
        const dow = (d.getDay() + 6) % 7;  // Convert JS (Sun=0) to ISO (Mon=0)
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${(dowShort[dow] || '').trim()} ${month}-${day}`.trim();
      });
    } else {
      // labelMode === 'day' : just the day number
      labels = rows.map(r => {
        const d = new Date(r.date + 'T00:00:00');
        return d.getDate().toString().padStart(2, '0');
      });
    }

    // Determine if x labels need rotation (more than 14 bars)
    const needsRotation = rows.length > 14;
    // มุมมนเฉพาะชิ้นบนสุดของกอง ไม่งั้นรอยต่อระหว่างประเภทจะมีร่องขาว
    const last = prepared.series.length - 1;

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: prepared.series.map((s, i) => ({
          label: s.name,
          data: s.data,
          backgroundColor: s.color,
          borderRadius: i === last ? 3 : 0,
          borderSkipped: false,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: prepared.series.length > 1, position: 'bottom',
            labels: { boxWidth: 9, boxHeight: 9, font: { size: 9 }, color: '#4a5568', padding: 8 } },
          tooltip: { backgroundColor: '#1a202c', titleColor: '#fff', bodyColor: '#fff' },
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              color: '#4a5568',
              font: { size: 9 },
              maxRotation: needsRotation ? 90 : 0,
              minRotation: needsRotation ? 90 : 0,
              autoSkip: false,
            },
            grid: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: '#4a5568', precision: 0, font: { size: 10 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
      plugins: avg > 0 ? [{
        id: 'dailyAvgLine',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const yScale = chart.scales.y;
          const xScale = chart.scales.x;
          if (!yScale || !xScale) return;

          const yPixel = yScale.getPixelForValue(avg);
          const xStart = chart.chartArea.left;
          const xEnd = chart.chartArea.right;

          // Draw horizontal dashed line
          ctx.save();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(xStart, yPixel);
          ctx.lineTo(xEnd, yPixel);
          ctx.stroke();
          ctx.restore();

          // Label at the right end
          const label = avg.toFixed(0);
          ctx.save();
          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, xEnd + 4, yPixel);
          ctx.restore();
        }
      }] : [],
    });
    _dailyCharts.set(canvasId, chart);
  }

  // CR.5 — Compute three time windows for a summary report from an anchor date (local time).
  // Used by both dashboard/page-reports.js and src/report-renderer.js via shared math.
  // Returns { day, week, month } where each is [from ISO, to ISO) pair in UTC.
  function summaryWindows(anchorDate) {
    const d = new Date(anchorDate);
    d.setHours(0, 0, 0, 0);  // start of anchor day (local time)
    const dayEnd = new Date(d);
    dayEnd.setDate(d.getDate() + 1);  // start of next day

    // Week: 7 days ending on anchor (inclusive) = [anchor-6d, anchor+1d)
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - 6);

    // Month: from 1st to 1st of next month (in local time, then to UTC)
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);

    return {
      day:   { from: d.toISOString(),       to: dayEnd.toISOString() },
      week:  { from: weekStart.toISOString(), to: dayEnd.toISOString() },
      month: { from: monthStart.toISOString(), to: monthEnd.toISOString() },
    };
  }

  // CR.8 — Compute time windows for daily7 and monthly bar charts.
  // anchorDate = the last day included in the report (local midnight).
  // Returns { daily7, monthly } where each is { from ISO, to ISO } pair (exclusive end).
  // daily7 = [anchor-6d 00:00, anchor+1d 00:00) — 7 days including anchor.
  // monthly = [1st of anchor's month 00:00, anchor+1d 00:00) — clamped at anchor, never into future.
  // YYYY-MM-DD ตามเวลาท้องถิ่น — ห้ามใช้ toISOString().slice(0,10) กับขอบวัน
  // เพราะ local 2026-08-28 00:00 ที่กรุงเทพ = 2026-08-27T17:00Z (ป้ายเพี้ยนไป 1 วัน)
  function _localYmd(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function dailyWindows(anchorDate) {
    const d = new Date(anchorDate);
    d.setHours(0, 0, 0, 0);  // start of anchor day (local time)

    // daily7: [anchor-6d, anchor+1d)
    const d7Start = new Date(d);
    d7Start.setDate(d.getDate() - 6);
    const d7End = new Date(d);
    d7End.setDate(d.getDate() + 1);

    // monthly: [1st of month, anchor+1d) — clamped at anchor (never into future)
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(d);
    monthEnd.setDate(d.getDate() + 1);

    return {
      daily7: { from: d7Start.toISOString(), to: d7End.toISOString() },
      monthly: { from: monthStart.toISOString(), to: monthEnd.toISOString() },
    };
  }

  // CR.8 — Expand point list to one entry per calendar day in [fromDate, toDate).
  // Missing days are filled with total=0. Returns sorted by date ascending.
  // Key is derived from local date components (getFullYear/getMonth/getDate) to avoid
  // UTC offset issues (Bangkok: local 2026-09-01 00:00 is 2026-08-31T17:00Z).
  function fillDays(points, fromDate, toDate) {
    // Build a map keyed by local YYYY-MM-DD.
    // ⚠️ computeTrendPoints คืน {bucket,total} ไม่ใช่ {date,total} — ต้องรับทั้งสองแบบ
    //    ไม่งั้นคีย์จะเป็น '' ทุกจุด แล้วทุกแท่งกลายเป็น 0 โดยไม่มี error ให้เห็น
    const byDate = new Map();
    (points || []).forEach(p => {
      const key = p.date || (p.bucket ? _localYmd(new Date(p.bucket)) : '');
      if (!key) return;
      byDate.set(key, (byDate.get(key) || 0) + (p.total || 0));
    });

    // Iterate each day in range, using local date components for keys
    const result = [];
    const current = new Date(fromDate);
    current.setHours(0, 0, 0, 0);

    while (current < toDate) {
      const yy = current.getFullYear().toString().padStart(4, '0');
      const mm = (current.getMonth() + 1).toString().padStart(2, '0');
      const dd = current.getDate().toString().padStart(2, '0');
      const dateKey = `${yy}-${mm}-${dd}`;
      result.push({
        date: dateKey,
        total: byDate.get(dateKey) || 0,
      });
      current.setDate(current.getDate() + 1);
    }

    return result;
  }

  // CR.5 — Summary report: build HTML from three time windows (day/week/month)
  // and timeline data for the week. Used by both dashboard/page-reports.js and
  // dashboard/report-print.js so the "full" image matches the interactive preview.
  function buildSummaryHtml(sum, brand, options) {
    brand = brand || {};
    const opts = normalizeOpts(options);
    const brandName    = brand.name    || 'Vigil Platform';
    const brandTagline = brand.tagline || '';
    const brandLogoUrl = brand.logo_url ? `${brand.logo_url}?v=${Date.now()}` : null;

    // Color palette — same as buildReportHtml for consistency
    const accent    = brand.primary_color || '#5b8def';
    const clrText   = '#2d3748';
    const clrDark   = '#1a202c';
    const clrMid    = '#4a5568';
    const clrDim    = '#718096';
    const clrDim2   = '#a0aec0';
    const clrDiv    = '#f1f5f9';
    const clrBord   = '#e2e8f0';
    const clrSurf   = '#f7fafc';

    // Header — reuse buildReportHtml pattern (brand + title + range)
    // หัวข้อที่ผู้ใช้ตั้งเองต้องชนะ ไม่งั้นช่อง "หัวข้อรายงาน" ไม่มีผลกับรายงานสรุป
    const title = (sum.title && String(sum.title).trim()) || I18N.t('rep.typeSummary', 'รายงานสรุป');
    const headerHtml = `
      <div style="border-bottom:3px solid ${esc(accent)};padding-bottom:14px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:14px">
            ${brandLogoUrl ? `<img src="${esc(brandLogoUrl)}" alt="logo" style="width:64px;height:64px;object-fit:contain">` : ''}
            <div>
              <div style="font-size:22px;font-weight:700;color:${clrDark}">${esc(title)}</div>
              <div style="font-size:13px;color:${clrMid};margin-top:4px">${esc(sum.anchorLabel || '')}${sum.todLabel ? esc(` (${sum.todLabel})`) : ''}</div>
            </div>
          </div>
          <div style="text-align:right;font-size:11px;color:${clrDim}">
            <div style="font-weight:700;color:${clrText}">${esc(brandName)}</div>
            ${brandTagline ? `<div style="font-size:10px;color:${clrDim2}">${esc(brandTagline)}</div>` : ''}
            <div style="margin-top:3px">${esc(I18N.t('rt.generatedAt').replace('{d}', new Date().toLocaleString(((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB', { hour12: false })))}</div>
          </div>
        </div>
      </div>`;

    // KPI row: total events for each window
    const dayTotal   = (sum.day && sum.day.categories) || [];
    const weekTotal  = (sum.week && sum.week.categories) || [];
    const monthTotal = (sum.month && sum.month.categories) || [];
    const dayCnt     = dayTotal.reduce((s, c) => s + (c.count || 0), 0);
    const weekCnt    = weekTotal.reduce((s, c) => s + (c.count || 0), 0);
    const monthCnt   = monthTotal.reduce((s, c) => s + (c.count || 0), 0);

    const kpiCard = (color, label, value) => `<div style="background:${clrSurf};padding:14px;border-radius:8px;border-left:3px solid ${color}"><div style="font-size:10px;color:${clrDim};text-transform:uppercase;font-weight:700">${esc(label)}</div><div style="font-size:24px;font-weight:700;color:${clrText}">${value.toLocaleString()}</div></div>`;
    const kpiHtml = `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.summary'))}</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px">
        ${kpiCard(accent, I18N.t('rt.sumDay', 'วันที่เลือก'), dayCnt)}
        ${kpiCard(accent, I18N.t('rt.sumWeek', '7 วันย้อนหลัง'), weekCnt)}
        ${kpiCard(accent, sum.monthLabel || I18N.t('rt.sumMonth', 'เดือนปฏิทิน'), monthCnt)}
      </div>`;

    // Category table: union of all categories across 3 windows, sorted by day desc then week desc
    const catMap = new Map();
    dayTotal.forEach(c => {
      if (!catMap.has(c.id)) catMap.set(c.id, { id: c.id, name: c.name, color: c.color, day: 0, week: 0, month: 0 });
      catMap.get(c.id).day = c.count || 0;
    });
    weekTotal.forEach(c => {
      if (!catMap.has(c.id)) catMap.set(c.id, { id: c.id, name: c.name, color: c.color, day: 0, week: 0, month: 0 });
      catMap.get(c.id).week = c.count || 0;
    });
    monthTotal.forEach(c => {
      if (!catMap.has(c.id)) catMap.set(c.id, { id: c.id, name: c.name, color: c.color, day: 0, week: 0, month: 0 });
      catMap.get(c.id).month = c.count || 0;
    });
    const cats = [...catMap.values()].sort((a, b) => {
      if (b.day !== a.day) return b.day - a.day;
      return b.week - a.week;
    });

    const catTableHtml = !cats.length ? '' : `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.byCategory'))}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:10px">
        <thead><tr style="background:${clrSurf}">
          <td style="padding:6px;border-bottom:2px solid ${clrDiv};font-weight:700">${esc(I18N.t('rt.category', 'หมวดหมู่'))}</td>
          <td style="padding:6px;text-align:right;border-bottom:2px solid ${clrDiv};font-weight:700">${esc(I18N.t('rt.sumDay', 'วัน'))}</td>
          <td style="padding:6px;text-align:right;border-bottom:2px solid ${clrDiv};font-weight:700">${esc(I18N.t('rt.sumWeek', '7วัน'))}</td>
          <td style="padding:6px;text-align:right;border-bottom:2px solid ${clrDiv};font-weight:700">${esc(sum.monthLabel || I18N.t('rt.sumMonth', 'เดือน'))}</td>
        </tr></thead>
        <tbody>${cats.map((c, i) => `<tr>
          <td style="padding:6px;border-bottom:1px solid ${clrDiv}">
            <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${esc(c.color || SERIES_PALETTE[i % SERIES_PALETTE.length])};margin-right:6px"></span>${esc(c.name)}</td>
          <td style="padding:6px;text-align:right;border-bottom:1px solid ${clrDiv}">${_fmt(c.day)}</td>
          <td style="padding:6px;text-align:right;border-bottom:1px solid ${clrDiv}">${_fmt(c.week)}</td>
          <td style="padding:6px;text-align:right;border-bottom:1px solid ${clrDiv}">${_fmt(c.month)}</td>
        </tr>`).join('')}</tbody>
      </table>`;

    // Donut chart: share of selected day
    const shareHtml = dayCnt > 0 ? `
      <div style="page-break-inside:avoid">
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.sumDonut', 'สัดส่วนของวันที่เลือก'))}</h3>
      <div style="position:relative;width:210px;height:210px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="summaryShareChart"></canvas>
      </div>
      </div>` : '';

    // Trend chart: 7-day totals
    const trendHtml = `
      <div style="page-break-inside:avoid">
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.sumTrend', 'แนวโน้ม 7 วัน'))}</h3>
      <div style="position:relative;height:220px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="summaryTrendChart"></canvas>
      </div>
      </div>`;

    return headerHtml + kpiHtml + catTableHtml + shareHtml + trendHtml;
  }

  // CR.5 — Render 7-day trend from timeline-by-category data
  function renderSummaryTrendChart(canvasId, tl) {
    const canv = document.getElementById(canvasId);
    if (!canv || typeof Chart === 'undefined') return;

    // รวมทุกหมวดต่อถังด้วย computeTrendPoints (shape จริงของ endpoint คือ
    // series[].points[{bucket,count}] — ห้ามเดา shape เอง)
    const dailyTotals = computeTrendPoints({ tl }).points;

    const labels = dailyTotals.map(d => {
      const dt = new Date(d.bucket);
      return dt.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
    });
    const data = dailyTotals.map(d => d.total);

    // Reuse line chart options from renderReportTrendChart
    const accent = '#5b8def';
    if (window.__summaryTrendChart) {
      window.__summaryTrendChart.destroy();
    }
    window.__summaryTrendChart = new Chart(canv, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: I18N.t('rt.events', 'เหตุการณ์'),
          data,
          borderColor: accent,
          backgroundColor: 'rgba(91, 141, 239, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: accent,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: '#4a5568', precision: 0, font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          y: { ticks: { color: '#4a5568', font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
  }

  global.ReportTemplate = {
    buildReportHtml, computeTrendPoints, renderReportTrendChart, renderCategoryChart, renderShareChart, renderDailyBarChart,
    buildSummaryHtml, renderSummaryTrendChart,
    normalizeOpts,
    summaryWindows, dailyWindows, fillDays, dailySeries,
    hideCats, legacyShownToHidden, sortCats, mergeInOut, KPI_KEYS, SECTION_KEYS,
    SECTION_TITLE_DEFS, setSectionTitles, getSectionTitles, secTitle,
    buildFaceSection(data) {
      const k = data.kpi || {};
      return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--purple)"></span>${esc(_label('rpt.domFace','ข้อมูลใบหน้า'))}</div>`
        + _kpis([
          { label: _label('rpt.captures','ใบหน้าทั้งหมด'), value: k.captures, color: 'var(--accent)' },
          { label: _label('rpt.known','จดจำได้'),           value: k.known,    color: 'var(--accent-muted)' },
          { label: _label('rpt.unknown','ไม่รู้จัก'),        value: k.unknown,  color: 'var(--warn)' },
          { label: _label('rpt.watch','เฝ้าระวัง'),          value: k.watch,    color: 'var(--status-bad)' },
        ]) + _personsSection(data.top_persons || []) + '</div>';
    },
    buildLprSection(data) {
      const k = data.kpi || {};
      return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--warn)"></span>${esc(_label('rpt.domLpr','ป้ายทะเบียน'))}</div>`
        + _kpis([
          { label: _label('rpt.platesTotal','ป้ายทั้งหมด'), value: k.total,  color: 'var(--accent)' },
          { label: _label('rpt.uniquePlates','ป้ายไม่ซ้ำ'), value: k.unique, color: 'var(--accent-muted)' },
          { label: _label('rpt.noRead','ไม่ระบุ'),        value: k.noread, color: 'var(--warn)' },
          { label: _label('rpt.watchHits','รถเฝ้าระวัง'),    value: k.watch,  color: 'var(--status-bad)' },
        ]) + '</div>';
    },
    // หมวดบุคคลขอแล้วแต่ได้ข้อมูลไม่มา (ช่วงเกิน 2 วัน / API ล้ม) — เดิมตัดทิ้งเงียบ ๆ ผู้อ่านไม่รู้ว่าขาด (GOTCHAS #217)
    buildPersonUnavailable() {
      return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:#14b8a6"></span>${esc(_label('rpt.domPerson','ข้อมูลบุคคล'))}</div>`
        + `<p style="color:var(--text-secondary);margin:8px 0 0">${esc(_label('rpt.appUnavailable','ไม่มีข้อมูลบุคคลในรายงานนี้: หมวดนี้ดูได้ครั้งละไม่เกิน 2 วัน'))}</p></div>`;
    },
    buildPersonSection(data) {
      const k = data.kpi || {};
      const a = data.accessories || {};
      return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:#14b8a6"></span>${esc(_label('rpt.domPerson','ข้อมูลบุคคล'))}</div>`
        + _kpis([
          // k.total คือวัตถุที่กล้องติดตามทั้งหมด ไม่ใช่คน — รายงานนี้ถึงมือลูกค้า
          // การเรียกยอดรวมว่า "บุคคลทั้งหมด" จึงเป็นตัวเลขที่ผิดในเอกสารที่เขาเก็บไว้
          // (ที่ RMUTR-V เป็นคนจริง 533 จาก 12,388) แสดงทั้งสองค่าแยกกัน
          k.person != null
            ? { label: _label('rpt.appPersons','บุคคล'), value: k.person, color: 'var(--status-ok)' }
            : { label: _label('rpt.appPersons','บุคคล'), value: '—', raw: true, color: 'var(--status-ok)' },
          { label: _label('rpt.appTotal','วัตถุที่ติดตาม'), value: k.total,           color: 'var(--accent)' },
          { label: _label('rpt.appBag','พกกระเป๋า'),       value: a.bag_count,        color: 'var(--accent-muted)' },
          { label: _label('rpt.appGlasses','สวมแว่น'),     value: a.glasses_count,    color: 'var(--accent)' },
          { label: _label('rpt.appHelmet','สวมหมวก'),      value: a.helmet_count,     color: 'var(--warn)' },
        ]) + '</div>';
    },
  };
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);

// Enable Node.js require() for tests
typeof module !== 'undefined' && (module.exports = global.ReportTemplate);
