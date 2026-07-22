// ============================================================
// Vigil Platform — Reports Redesign DRAFT demo (self-contained, CSP-safe)
// Multi-domain report: Events · Face Recognition · Face Capture · LPR
// + auto-send to LINE. All numbers mock. No inline handlers (addEventListener).
// ============================================================
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const token = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmt = n => n.toLocaleString();

  // ───────── report type → range + scale ─────────
  // daily = 1d baseline; weekly ×6.4; monthly ×27; custom ×3. Mock magnitudes.
  const TYPES = {
    daily:   { label: 'รายวัน',     k: 1,    rangeText: 'วันนี้ · 21 มิ.ย. 2026' },
    weekly:  { label: 'รายสัปดาห์',  k: 6.4,  rangeText: '15–21 มิ.ย. 2026 (7 วัน)' },
    monthly: { label: 'รายเดือน',    k: 27,   rangeText: 'มิถุนายน 2026 (30 วัน)' },
    custom:  { label: 'กำหนดเอง',    k: 3,    rangeText: '19–21 มิ.ย. 2026 (3 วัน)' },
  };
  let rptType = 'daily', rptFmt = 'png';
  let DOMAINS = { events: true, facerec: true, facecap: true, lpr: true };

  // ───────── Multi-site + RBAC (demo) ─────────
  // prod: sites table + cameras.site_id + user_sites + role. Here = mock + a
  // role simulator. site-user sees only their site (selector locked); super
  // admin sees all + can pick per-site or combined.
  // sites จริง (schema): 'main' = default site — cameras ปัจจุบันทั้งหมด backfill ลงนี่
  // (migration 055) · 'vss' = office edge site แยก (migration 062, INSERT code='vss').
  // bma/phuket = planned expansion. demo จึงมี main + vss คู่กัน (ไม่ใช่อันเดียว).
  const SITES = {
    main:   { name: 'Main Site', color: '#5b8def' },
    vss:    { name: 'VSS (สำนักงาน)', color: '#8b5cf6' },
    bma:    { name: 'BMA',       color: '#22c55e' },
    phuket: { name: 'ภูเก็ต',    color: '#f59e0b' },
  };
  const VIEWERS = {
    super:  { label: 'Super Admin', sites: ['main', 'vss', 'bma', 'phuket'] },
    vss:    { label: 'ผู้ใช้ VSS',  sites: ['vss'] },
    bma:    { label: 'ผู้ใช้ BMA',  sites: ['bma'] },
    phuket: { label: 'ผู้ใช้ ภูเก็ต', sites: ['phuket'] },
  };
  // 2 cameras — VSS only (main/bma/phuket ยังไม่มีกล้อง ณ 2026-06-26)
  const CAMERAS = [
    { name: 'ประตูสำนักงาน VSS', site: 'vss', group: 'สำนักงาน', vendor: 'Bosch', up: 99.6, online: true },
    { name: 'ลานจอด VSS (LPR)', site: 'vss', group: 'ทางเข้า-ออก', vendor: 'Hikvision', up: 98.9, online: true },
  ];
  let viewer = 'super';     // simulated logged-in role
  let siteScope = 'all';    // 'all' | site code (constrained by viewer.sites)

  function viewerSites() { return VIEWERS[viewer].sites; }
  function scopeSites() { return siteScope === 'all' ? viewerSites() : [siteScope]; }
  function scopedCameras() { const s = scopeSites(); return CAMERAS.filter(c => s.includes(c.site)); }
  function scopeLabel() {
    if (siteScope === 'all') return viewerSites().length > 1 ? 'ทุก Site (รวม)' : SITES[viewerSites()[0]].name;
    return SITES[siteScope].name;
  }
  // fraction of the (full 11-cam) baseline that the current scope covers → scales mock totals
  function scopeFactor() { return scopedCameras().length / CAMERAS.length; }

  function renderScopeBar() {
    document.querySelectorAll('#viewerBar button').forEach(b => b.classList.toggle('active', b.dataset.vw === viewer));
    const vs = viewerSites(), multi = vs.length > 1;
    const opts = multi ? ['all', ...vs] : vs;
    $('siteBar').innerHTML = opts.map(s => {
      const lbl = s === 'all' ? 'ทุก Site' : SITES[s].name;
      const dot = s === 'all' ? '' : `<span class="site-dot" style="background:${SITES[s].color}"></span>`;
      return `<button data-site="${s}" class="${siteScope === s ? 'active' : ''}">${dot}${lbl}</button>`;
    }).join('');
    $('siteLock').style.display = multi ? 'none' : '';
  }
  function setViewer(v) {
    viewer = v;
    siteScope = VIEWERS[v].sites.length > 1 ? 'all' : VIEWERS[v].sites[0];
    renderScopeBar(); rerenderActiveTab();
  }

  // ───────── base (daily) mock data — scaled by type.k ─────────
  const EV_CATS = [
    { th: 'บุกรุกพื้นที่หวงห้าม', n: 42, c: 'var(--status-bad)' },
    { th: 'เดินวนผิดปกติ (Loitering)', n: 88, c: 'var(--warn)' },
    { th: 'รวมกลุ่ม / มวลชน', n: 31, c: 'var(--purple)' },
    { th: 'วัตถุต้องสงสัยทิ้งไว้', n: 12, c: 'var(--accent)' },
    { th: 'ข้ามเส้นกั้น (Tripwire)', n: 64, c: '#14b8a6' },
    { th: 'กล้องถูกบดบัง (Tamper)', n: 5,  c: '#e879a6' },
  ];
  const FR_PERSONS = [
    { name: 'สมชาย ใจดี', dept: 'ฝ่ายผลิต', n: 24 },
    { name: 'อรพรรณ ทองสุข', dept: 'ฝ่ายบุคคล', n: 19 },
    { name: 'David Chen', dept: 'ผู้รับเหมา', n: 14 },
    { name: 'ก้องภพ วิริยะ', dept: 'รปภ.', n: 11 },
    { name: 'มินตรา ศรีสุข', dept: 'ฝ่ายบัญชี', n: 9 },
  ];
  const FR_WATCH = [
    { name: 'บุคคลเฝ้าระวัง #A-21', group: 'บัญชีดำ', cam: 'ประตูหน้า', time: '08:42' },
    { name: 'อดีตพนักงาน (เลิกจ้าง)', group: 'ห้ามเข้า', cam: 'โรงงาน B', time: '13:05' },
  ];
  const FC_CAMS = [
    { cam: 'ประตูหน้า (Lobby)', n: 312 },
    { cam: 'โรงอาหาร', n: 248 },
    { cam: 'ทางเข้าโรงงาน A', n: 187 },
    { cam: 'ลานจอดรถ', n: 96 },
  ];
  const LPR_PROV = [
    { name: 'ภูเก็ต', n: 115 }, { name: 'พังงา', n: 85 }, { name: 'ไม่ทราบ', n: 68 },
    { name: 'กรุงเทพฯ', n: 47 }, { name: 'สตูล', n: 28 }, { name: 'กระบี่', n: 12 },
  ];
  const LPR_VTYPES = [
    { th: 'รถเก๋ง/รถยนต์นั่ง', n: 186 }, { th: 'รถกระบะ', n: 142 },
    { th: 'จักรยานยนต์', n: 98 }, { th: 'รถบรรทุก', n: 41 }, { th: 'รถตู้', n: 28 },
  ];
  // watchlist vehicle hits (reuse the production plaque renderer)
  const LPR_WATCH = [
    { prov: 'ภก', num: '5678', region: 'ภูเก็ต', vtype: 'twoWheelVehicle', pcolor: 'white', group: 'รถผู้ต้องสงสัย', gcolor: '#f59e0b', cam: 'ท่าเรือ', time: '09:14', site: 'phuket' },
    { prov: '1กข', num: '1234', region: 'กรุงเทพมหานคร', vtype: 'smallCar', pcolor: 'white', group: 'รถตามหมายจับ', gcolor: '#ef4444', cam: 'ประตูหน้า BMA', time: '17:33', site: 'bma' },
    { prov: '8ฒฬ', num: '7788', region: '', vtype: 'smallCar', pcolor: 'white', group: 'รถ VIP', gcolor: '#22c55e', cam: 'ลานจอด BMA', time: '18:05', site: 'bma' },
    { prov: 'กท', num: '4095', region: 'กรุงเทพมหานคร', vtype: 'pickupTruck', pcolor: 'white', group: 'รถตามหมายจับ', gcolor: '#ef4444', cam: 'ประตูหน้า Main', time: '11:48', site: 'main' },
    { prov: '9กก', num: '2020', region: 'กรุงเทพมหานคร', vtype: 'smallCar', pcolor: 'white', group: 'รถ VIP', gcolor: '#22c55e', cam: 'ลานจอด VSS (LPR)', time: '08:22', site: 'vss' },
  ];

  // ───────── LINE recipients roster (mock) ─────────
  const RECIPS = [
    { id: 'g1', name: 'กลุ่ม ศูนย์ควบคุม (Ops Center)', type: 'group' },
    { id: 'g2', name: 'กลุ่ม หัวหน้า รปภ.', type: 'group' },
    { id: 'u1', name: 'ผจก. ฝ่ายความปลอดภัย', type: 'user' },
    { id: 'u2', name: 'เจ้าหน้าที่เวร (กลางคืน)', type: 'user' },
  ];

  // ───────── schedules (mock) ─────────
  let SCHEDULES = [
    { id: 1, site: 'all', family: 'analytics', name: 'สรุปประจำวัน (ทุก Site) 08:00', freq: 'daily', time: '08:00', dow: '', dom: '', fmt: 'png',
      domains: { events: true, facerec: true, facecap: true, lpr: true }, recips: ['g1', 'u1'], enabled: true },
    { id: 2, site: 'bma', family: 'health', name: 'สุขภาพระบบ BMA ทุกเช้า', freq: 'daily', time: '07:00', dow: '', dom: '', fmt: 'png',
      hsecs: { camera_status: true, camera_uptime: true, storage: true, system: true }, recips: ['g2'], enabled: true },
    { id: 3, site: 'all', family: 'analytics', name: 'รายงานผู้บริหาร รายเดือน', freq: 'monthly', time: '07:30', dow: '', dom: '1', fmt: 'pdf',
      domains: { events: true, facerec: true, facecap: true, lpr: true }, recips: ['u1'], enabled: false },
  ];
  let _nextSched = 4, _editId = null;
  const _seDomains = { events: true, facerec: true, facecap: true, lpr: true };
  let seFreq = 'daily', seFmt = 'png', seDow = '1', seFamily = 'analytics', seSite = 'all';
  const DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  // ───────── history (mock) ─────────
  const _HIST_SITE = ['all', 'vss', 'phuket', 'main', 'bma'];
  const HISTORY = Array.from({ length: 14 }, (_, i) => {
    const types = ['รายวัน', 'รายสัปดาห์', 'รายเดือน'];
    const ok = i !== 3 && i !== 9;
    const d = new Date(2026, 5, 21 - i, 8, 0);
    return {
      date: `${String(d.getDate()).padStart(2, '0')}/06 ${String(d.getHours()).padStart(2, '0')}:00`,
      type: types[i % 3], site: _HIST_SITE[i % _HIST_SITE.length], range: i % 3 === 0 ? '1 วัน' : i % 3 === 1 ? '7 วัน' : '30 วัน',
      recips: (i % 2) ? 2 : 1, fmt: i % 4 === 1 ? 'PDF' : 'PNG',
      status: ok ? 'ok' : 'fail', size: ok ? `${(0.6 + (i % 5) * 0.3).toFixed(1)} MB` : '—',
    };
  });
  let histFilter = 'all';

  // ───────── chart registry ─────────
  let charts = [];
  function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

  // ============================================================
  //  Report preview document
  // ============================================================
  function scaled(n) { return Math.round(n * TYPES[rptType].k * scopeFactor()); }
  function activeDomains() { return Object.keys(DOMAINS).filter(k => DOMAINS[k]); }

  // per-site breakdown row — only meaningful for a multi-site viewer on "ทุก Site"
  function siteBreakdownRow(metricLabel, base) {
    if (siteScope !== 'all' || viewerSites().length <= 1) return '';
    const sites = viewerSites().filter(s => CAMERAS.filter(c => c.site === s).length > 0);
    if (!sites.length) return '';
    return `<div class="site-break"><div class="rpt-subh">แยกตาม Site</div><div class="site-break-grid">${sites.map(s => {
      const cams = CAMERAS.filter(c => c.site === s);
      const share = cams.length / CAMERAS.length;
      return `<div class="site-break-card" style="--sc:${SITES[s].color}">
        <div class="sb-name"><span class="site-dot" style="background:${SITES[s].color}"></span>${SITES[s].name}</div>
        <div class="sb-stat">${cams.length} กล้อง · ${cams.filter(c => c.online).length} ออนไลน์</div>
        <div class="sb-num">${fmt(Math.round(base * share * TYPES[rptType].k))}<span> ${metricLabel}</span></div>
      </div>`;
    }).join('')}</div></div>`;
  }

  function execTiles() {
    const t = [];
    if (DOMAINS.events) t.push({ k: 'เหตุการณ์ทั้งหมด', v: scaled(EV_CATS.reduce((s, c) => s + c.n, 0)), c: 'var(--accent)' });
    if (DOMAINS.facerec) {
      t.push({ k: 'ใบหน้าทั้งหมด', v: scaled(412), c: 'var(--purple)' });
      t.push({ k: 'บุคคลเฝ้าระวัง', v: scaled(96), c: 'var(--warn)' });
    }
    if (DOMAINS.facecap) t.push({ k: 'ป้ายทะเบียนทั้งหมด', v: scaled(FC_CAMS.reduce((s, c) => s + c.n, 0)), c: '#14b8a6' });
    if (DOMAINS.lpr) {
      t.push({ k: 'ป้ายทะเบียน', v: scaled(LPR_VTYPES.reduce((s, c) => s + c.n, 0)), c: 'var(--warn)' });
      t.push({ k: 'ป้ายทะเบียนเฝ้าระวัง', v: scaled(LPR_WATCH.length + FR_WATCH.length), c: 'var(--status-bad)' });
    }
    return t;
  }

  function sectionEvents() {
    return `<div class="rpt-section" data-sec="events">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>เหตุการณ์ทั่วไป</div>
      <div class="rpt-2col">
        <div class="rpt-chartcard"><div class="chart-box"><canvas id="cEv"></canvas></div></div>
        <table class="rpt-table">${EV_CATS.map(c => `<tr><td><span class="rpt-cdot" style="background:${c.c}"></span>${c.th}</td><td class="rpt-num">${fmt(scaled(c.n))}</td></tr>`).join('')}</table>
      </div>
    </div>`;
  }
  function sectionFaceRec() {
    return `<div class="rpt-section" data-sec="facerec">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--purple)"></span>การจดจำใบหน้า</div>
      <div class="rpt-2col">
        <div class="rpt-chartcard"><div class="chart-box"><canvas id="cFr"></canvas></div></div>
        <div>
          <div class="rpt-subh">บุคคลที่พบบ่อย</div>
          <table class="rpt-table">${FR_PERSONS.map(p => `<tr><td><span class="rpt-ava">${p.name.trim()[0]}</span>${p.name} <span class="rpt-mute">· ${p.dept}</span></td><td class="rpt-num">${fmt(scaled(p.n))}</td></tr>`).join('')}</table>
        </div>
      </div>
      ${FR_WATCH.length ? `<div class="rpt-alertbar">
        <span class="rpt-alert-k">พบบุคคลเฝ้าระวัง ${FR_WATCH.length} ราย</span>
        ${FR_WATCH.map(w => `<span class="rpt-chip" style="--gc:var(--status-bad)">${w.name} · ${w.cam} · ${w.time}</span>`).join('')}
      </div>` : ''}
    </div>`;
  }
  function sectionFaceCap() {
    return `<div class="rpt-section" data-sec="facecap">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:#14b8a6"></span>การบันทึกใบหน้า (Appearances)</div>
      <div class="rpt-3col">
        <div class="rpt-chartcard"><div class="rpt-subh">เพศ</div><div class="chart-box sm"><canvas id="cFcG"></canvas></div></div>
        <div class="rpt-chartcard"><div class="rpt-subh">ช่วงอายุ</div><div class="chart-box sm"><canvas id="cFcA"></canvas></div></div>
        <div>
          <div class="rpt-subh">กล้องที่บันทึกมากสุด</div>
          <table class="rpt-table">${FC_CAMS.map(c => `<tr><td>${c.cam}</td><td class="rpt-num">${fmt(scaled(c.n))}</td></tr>`).join('')}</table>
        </div>
      </div>
    </div>`;
  }
  function plaque(w) {
    return (typeof window.lprPlaque === 'function')
      ? window.lprPlaque(`${w.prov}${w.num}`, { vehicleType: w.vtype, plateColor: w.pcolor, region: w.region })
      : `<span>${w.prov} ${w.num}</span>`;
  }
  function sectionLpr() {
    return `<div class="rpt-section" data-sec="lpr">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--warn)"></span>ป้ายทะเบียน (LPR)</div>
      <div class="rpt-2col">
        <div class="rpt-chartcard"><div class="rpt-subh">จังหวัดที่พบมากสุด</div><div class="chart-box"><canvas id="cLpP"></canvas></div></div>
        <div class="rpt-chartcard"><div class="rpt-subh">ประเภทรถ</div><div class="chart-box"><canvas id="cLpV"></canvas></div></div>
      </div>
      <div class="rpt-subh" style="margin-top:14px">รถในรายการเฝ้าระวังที่ตรวจพบ</div>
      <div class="rpt-watchgrid">${LPR_WATCH.map(w => `<div class="rpt-watchcard" style="--gc:${w.gcolor}">
        <div class="rpt-watch-plaque">${plaque(w)}</div>
        <div class="rpt-watch-info"><span class="rpt-badge" style="background:${w.gcolor}">${w.group}</span>
          <span class="rpt-mute">${[w.region || 'ไม่ทราบจังหวัด', w.cam, w.time].join(' · ')}</span></div>
      </div>`).join('')}</div>
    </div>`;
  }

  function renderReportDoc() {
    destroyCharts();
    const doc = $('rptDoc');
    const ty = TYPES[rptType];
    const tiles = execTiles();
    const secs = [];
    if (DOMAINS.events) secs.push(sectionEvents());
    if (DOMAINS.facerec) secs.push(sectionFaceRec());
    if (DOMAINS.facecap) secs.push(sectionFaceCap());
    if (DOMAINS.lpr) secs.push(sectionLpr());

    doc.innerHTML = `
      <div class="rpt-watermark">ตัวอย่าง</div>
      <div class="rpt-head">
        <div class="rpt-brand"><span class="rpt-logo">V</span><div><div class="rpt-brand-name">Vigil Platform</div><div class="rpt-brand-sub">Powerful CCTV Platform</div></div></div>
        <div class="rpt-head-meta"><div class="rpt-title-doc">${$('rbTitle').value || 'รายงานวิเคราะห์ระบบ CCTV'}</div>
          <div class="rpt-mute">${ty.label} · ${ty.rangeText}</div>
          <div class="rpt-mute"><span class="rpt-scopetag">${scopeLabel()}</span> · ${scopedCameras().length} กล้อง</div></div>
      </div>
      <div class="rpt-execrow">${tiles.map(t => `<div class="rpt-exec" style="--ka:${t.c}"><div class="rpt-exec-v">${fmt(t.v)}</div><div class="rpt-exec-k">${t.k}</div></div>`).join('')}</div>
      ${siteBreakdownRow('เหตุการณ์', 180)}
      ${secs.length ? secs.join('') : '<div class="rpt-empty">เลือกเนื้อหาอย่างน้อย 1 หมวดเพื่อสร้างรายงาน</div>'}
      <div class="rpt-foot"><span>เอกสารลับ · สำหรับใช้ภายในองค์กรเท่านั้น (PDPA)</span><span>Vigil Platform · หน้า 1/1</span></div>`;

    buildCharts();
    renderSummary();
  }

  function buildCharts() {
    const acc = token('--accent'), grid = token('--border-hairline'), dim = token('--text-secondary');
    Chart.defaults.color = dim; Chart.defaults.font.family = token('--ui-font-family') || 'sans-serif';
    const noLeg = { plugins: { legend: { display: false } }, maintainAspectRatio: false };
    const palette = [acc, token('--purple'), token('--status-ok'), token('--warn'), token('--status-bad'), '#14b8a6', '#e879a6'];

    if (DOMAINS.events && $('cEv')) charts.push(new Chart($('cEv'), {
      type: 'bar', data: { labels: EV_CATS.map(c => c.th.split(' ')[0]), datasets: [{ data: EV_CATS.map(c => scaled(c.n)), backgroundColor: EV_CATS.map(c => token(c.c.replace('var(', '').replace(')', '')) || acc), borderRadius: 3 }] },
      options: { ...noLeg, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } }, y: { grid: { color: grid }, ticks: { font: { size: 9 } } } } } }));

    if (DOMAINS.facerec && $('cFr')) charts.push(new Chart($('cFr'), {
      type: 'doughnut', data: { labels: ['จดจำได้', 'ไม่รู้จัก'], datasets: [{ data: [scaled(412), scaled(96)], backgroundColor: [token('--purple'), token('--warn')], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } } }));

    if (DOMAINS.facecap) {
      if ($('cFcG')) charts.push(new Chart($('cFcG'), {
        type: 'doughnut', data: { labels: ['ชาย', 'หญิง', 'ไม่ทราบ'], datasets: [{ data: [scaled(520), scaled(286), scaled(37)], backgroundColor: [acc, '#e879a6', dim], borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 9 } } } } } }));
      if ($('cFcA')) charts.push(new Chart($('cFcA'), {
        type: 'bar', data: { labels: ['<18', '18-30', '31-45', '46-60', '60+'], datasets: [{ data: [scaled(42), scaled(310), scaled(280), scaled(150), scaled(61)], backgroundColor: '#14b8a6', borderRadius: 3 }] },
        options: { ...noLeg, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: grid }, ticks: { font: { size: 9 } } } } } }));
    }

    if (DOMAINS.lpr) {
      if ($('cLpP')) charts.push(new Chart($('cLpP'), {
        type: 'bar', data: { labels: LPR_PROV.map(p => p.name), datasets: [{ data: LPR_PROV.map(p => scaled(p.n)), backgroundColor: acc, borderRadius: 3 }] },
        options: { ...noLeg, indexAxis: 'y', scales: { x: { grid: { color: grid }, ticks: { font: { size: 9 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } }));
      if ($('cLpV')) charts.push(new Chart($('cLpV'), {
        type: 'doughnut', data: { labels: LPR_VTYPES.map(v => v.th), datasets: [{ data: LPR_VTYPES.map(v => scaled(v.n)), backgroundColor: LPR_VTYPES.map((_, i) => palette[i % palette.length]), borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { boxWidth: 9, font: { size: 9 } } } } } }));
    }
  }

  function renderSummary() {
    const ty = TYPES[rptType], doms = activeDomains().length;
    $('rbSummary').innerHTML = `<div><b>ช่วง:</b> ${ty.rangeText}</div><div><b>เนื้อหา:</b> ${doms} หมวด</div><div><b>รูปแบบ:</b> ${rptFmt.toUpperCase()}</div>`;
  }

  // ============================================================
  //  Health report preview (สุขภาพระบบ tab)
  // ============================================================
  const HR_RANGE = { '24h': '24 ชั่วโมงล่าสุด · 21 มิ.ย. 2026', '7d': '7 วันล่าสุด · 15–21 มิ.ย. 2026', '30d': '30 วันล่าสุด · มิถุนายน 2026' };
  let hrRange = '24h', hrFmt = 'png', hrGroupBy = 'group';
  const HR_SECS = { camera_status: true, camera_uptime: true, storage: true, system: true };
  const GB_LABEL = { site: 'Site', group: 'กลุ่ม', vendor: 'ยี่ห้อ', camera: 'กล้อง' };
  let _hrUp = [];  // computed uptime groups (chart reads this)

  function hrCamStatus() { const c = scopedCameras(); return { total: c.length, online: c.filter(x => x.online).length, offline: c.filter(x => !x.online) }; }
  function hrUptimeData() {
    const cams = scopedCameras();
    if (hrGroupBy === 'camera') return cams.map(c => ({ label: c.name, p: c.up }));
    const m = {};
    cams.forEach(c => { const k = hrGroupBy === 'site' ? SITES[c.site].name : c[hrGroupBy]; (m[k] = m[k] || []).push(c.up); });
    return Object.keys(m).map(k => ({ label: k, p: +(m[k].reduce((a, b) => a + b, 0) / m[k].length).toFixed(1) }));
  }
  const HR_GAUGES = [
    { k: 'CPU', v: 18, max: 100, unit: '%', warn: 85 },
    { k: 'RAM', v: 62, max: 100, unit: '%', warn: 85 },
    { k: 'พื้นที่ดิสก์', v: 41, max: 100, unit: '%', warn: 85, detail: '412 GB / 1 TB' },
  ];
  function hrActive() { return Object.keys(HR_SECS).filter(k => HR_SECS[k]); }

  function hrSectionCamStatus() {
    const st = hrCamStatus();
    const off = st.offline.length
      ? st.offline.map((c, i) => `<div class="hr-offline"><span class="hr-off-dot"></span><div><div class="hr-off-name">${c.name} <span class="site-dot" style="background:${SITES[c.site].color}"></span><span class="rpt-mute">${SITES[c.site].name}</span></div><div class="rpt-mute">ออฟไลน์ ${['2 ชม. 14 นาที', '38 นาที', '1 ชม. 6 นาที'][i % 3]} · ${c.vendor}</div></div></div>`).join('')
      : '<div class="rpt-mute" style="padding:8px 0">ทุกกล้องออนไลน์</div>';
    return `<div class="rpt-section" data-sec="camera_status">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>สถานะกล้อง <span class="hr-pill">${st.online}/${st.total} ออนไลน์</span></div>
      <div class="rpt-2col">
        <div class="rpt-chartcard"><div class="chart-box sm"><canvas id="cHrCam"></canvas></div></div>
        <div><div class="rpt-subh">กล้องที่ออฟไลน์ (${st.offline.length})</div>${off}</div>
      </div>
    </div>`;
  }
  // group uptime by the camera_group each camera is assigned to (site-qualified
  // when scope spans >1 site, since group names repeat across sites). worst-first.
  function hrGroupBreakdown() {
    const cams = scopedCameras(), m = {};
    cams.forEach(c => { const k = c.site + '|' + c.group; (m[k] = m[k] || { site: c.site, name: c.group, ups: [], total: 0, online: 0 }); m[k].ups.push(c.up); m[k].total++; if (c.online) m[k].online++; });
    return Object.values(m).map(g => ({ ...g, p: +(g.ups.reduce((a, b) => a + b, 0) / g.ups.length).toFixed(1) })).sort((a, b) => a.p - b.p);
  }
  function hrSectionUptime() {
    const cams = scopedCameras();
    const avg = cams.length ? (cams.reduce((s, c) => s + c.up, 0) / cams.length).toFixed(1) : '—';
    if (hrGroupBy === 'group') {
      const multi = scopeSites().length > 1;
      const groups = hrGroupBreakdown();
      return `<div class="rpt-section" data-sec="camera_uptime">
        <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-ok)"></span>Uptime — แยกตามกลุ่มกล้อง <span class="hr-pill">เฉลี่ย ${avg}%</span></div>
        <div class="grp-up-list">${groups.map(g => {
          const cls = g.p >= 95 ? 'ok' : g.p >= 85 ? 'warn' : 'bad';
          const off = g.total - g.online;
          return `<div class="grp-up-row">
            <div class="grp-up-name">${multi ? `<span class="site-dot" style="background:${SITES[g.site].color}"></span><span class="rpt-mute">${SITES[g.site].name} ·</span> ` : ''}${g.name}
              <span class="rpt-mute">${g.online}/${g.total} ออนไลน์${off ? ` · <span style="color:var(--status-bad)">${off} ออฟไลน์</span>` : ''}</span></div>
            <div class="grp-up-bar"><span class="${cls}" style="width:${g.p}%"></span></div>
            <div class="grp-up-pct ${cls}">${g.p}%</div>
          </div>`;
        }).join('')}</div>
      </div>`;
    }
    return `<div class="rpt-section" data-sec="camera_uptime">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-ok)"></span>Uptime — จัดกลุ่มตาม${GB_LABEL[hrGroupBy]} <span class="hr-pill">เฉลี่ย ${avg}%</span></div>
      <div class="chart-box"><canvas id="cHrUp"></canvas></div>
    </div>`;
  }
  function hrSectionStorage() {
    return `<div class="rpt-section" data-sec="storage">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--purple)"></span>พื้นที่จัดเก็บ</div>
      <div class="rpt-2col">
        <div class="rpt-chartcard"><div class="chart-box sm"><canvas id="cHrSt"></canvas></div></div>
        <table class="rpt-table">
          <tr><td>ดิสก์ทั้งหมด</td><td class="rpt-num">1.0 TB</td></tr>
          <tr><td>ใช้ไป</td><td class="rpt-num">412 GB (41%)</td></tr>
          <tr><td>รูป Snapshot</td><td class="rpt-num">168 GB</td></tr>
          <tr><td>คลิปวิดีโอ</td><td class="rpt-num">224 GB</td></tr>
          <tr><td>นโยบายเก็บ</td><td class="rpt-num">30 วัน</td></tr>
        </table>
      </div>
    </div>`;
  }
  function hrSectionSystem() {
    return `<div class="rpt-section" data-sec="system">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:#14b8a6"></span>ทรัพยากรระบบ</div>
      <div class="hr-gauges">${HR_GAUGES.map(g => {
        const over = g.v >= g.warn;
        return `<div class="hr-gauge"><div class="hr-gauge-top"><span>${g.k}</span><span class="hr-gauge-v${over ? ' warn' : ''}">${g.v}${g.unit}</span></div>
        <div class="hr-bar"><span style="width:${g.v}%;background:${over ? 'var(--status-bad)' : 'var(--status-ok)'}"></span></div>
        ${g.detail ? `<div class="rpt-mute" style="margin-top:3px">${g.detail}</div>` : ''}</div>`;
      }).join('')}</div>
      <div class="hr-sysrow">
        <div class="hr-sysitem"><div class="rpt-mute">Uptime แอป</div><div class="hr-sysval">14 วัน 6 ชม.</div></div>
        <div class="hr-sysitem"><div class="rpt-mute">PM2 Workers</div><div class="hr-sysval">7 / 7 ทำงาน</div></div>
        <div class="hr-sysitem"><div class="rpt-mute">เวอร์ชัน</div><div class="hr-sysval">v1.5.3</div></div>
        <div class="hr-sysitem"><div class="rpt-mute">ฐานข้อมูล</div><div class="hr-sysval">เชื่อมต่อปกติ</div></div>
      </div>
    </div>`;
  }

  // per-site breakdown for health = avg uptime + online count per site
  function healthBreakdownRow() {
    if (siteScope !== 'all' || viewerSites().length <= 1) return '';
    const sites = viewerSites().filter(s => CAMERAS.filter(c => c.site === s).length > 0);
    if (!sites.length) return '';
    return `<div class="site-break"><div class="rpt-subh">แยกตาม Site</div><div class="site-break-grid">${sites.map(s => {
      const cams = CAMERAS.filter(c => c.site === s);
      const up = (cams.reduce((a, c) => a + c.up, 0) / cams.length).toFixed(1);
      return `<div class="site-break-card" style="--sc:${SITES[s].color}">
        <div class="sb-name"><span class="site-dot" style="background:${SITES[s].color}"></span>${SITES[s].name}</div>
        <div class="sb-stat">${cams.length} กล้อง · ${cams.filter(c => c.online).length} ออนไลน์</div>
        <div class="sb-num">${up}<span> % uptime</span></div>
      </div>`;
    }).join('')}</div></div>`;
  }
  function renderHealthDoc() {
    destroyCharts();
    _hrUp = hrUptimeData();
    const st = hrCamStatus();
    const secs = [];
    if (HR_SECS.camera_status) secs.push(hrSectionCamStatus());
    if (HR_SECS.camera_uptime) secs.push(hrSectionUptime());
    if (HR_SECS.storage) secs.push(hrSectionStorage());
    if (HR_SECS.system) secs.push(hrSectionSystem());
    const banner = st.offline.length
      ? `<div class="hr-banner">⚠ มีกล้องออฟไลน์ ${st.offline.length} ตัว · ระบบโดยรวมทำงานปกติ (ดิสก์ 41% · RAM 62%)</div>`
      : `<div class="hr-banner ok">✓ ทุกกล้องออนไลน์ · ระบบทำงานปกติ (ดิสก์ 41% · RAM 62%)</div>`;

    $('hrDoc').innerHTML = `
      <div class="rpt-watermark">ตัวอย่าง</div>
      <div class="rpt-head">
        <div class="rpt-brand"><span class="rpt-logo">V</span><div><div class="rpt-brand-name">Vigil Platform</div><div class="rpt-brand-sub">Powerful CCTV Platform</div></div></div>
        <div class="rpt-head-meta"><div class="rpt-title-doc">รายงานสุขภาพระบบ</div>
          <div class="rpt-mute">${HR_RANGE[hrRange]}</div>
          <div class="rpt-mute"><span class="rpt-scopetag">${scopeLabel()}</span> · ${st.total} กล้อง</div></div>
      </div>
      ${banner}
      ${healthBreakdownRow()}
      ${secs.length ? secs.join('') : '<div class="rpt-empty">เลือกอย่างน้อย 1 หมวด</div>'}
      <div class="rpt-foot"><span>เอกสารลับ · สำหรับใช้ภายในองค์กรเท่านั้น (PDPA)</span><span>Vigil Platform · หน้า 1/1</span></div>`;

    buildHealthCharts();
    const ty = hrActive().length;
    $('hrSummary').innerHTML = `<div><b>ช่วง:</b> ${HR_RANGE[hrRange]}</div><div><b>หมวด:</b> ${ty} หมวด</div><div><b>รูปแบบ:</b> ${hrFmt.toUpperCase()}</div>`;
  }
  function buildHealthCharts() {
    const acc = token('--accent'), grid = token('--border-hairline'), dim = token('--text-secondary');
    Chart.defaults.color = dim; Chart.defaults.font.family = token('--ui-font-family') || 'sans-serif';
    const noLeg = { plugins: { legend: { display: false } }, maintainAspectRatio: false };
    const st = hrCamStatus();
    if (HR_SECS.camera_status && $('cHrCam')) charts.push(new Chart($('cHrCam'), {
      type: 'doughnut', data: { labels: ['ออนไลน์', 'ออฟไลน์'], datasets: [{ data: [st.online, st.offline.length], backgroundColor: [token('--status-ok'), token('--status-bad')], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 9, font: { size: 10 } } } } } }));
    if (HR_SECS.camera_uptime && $('cHrUp')) charts.push(new Chart($('cHrUp'), {
      type: 'bar', data: { labels: _hrUp.map(u => u.label), datasets: [{ data: _hrUp.map(u => u.p), backgroundColor: _hrUp.map(u => u.p < 95 ? token('--status-bad') : token('--status-ok')), borderRadius: 3 }] },
      options: { ...noLeg, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } }, y: { min: 80, max: 100, grid: { color: grid }, ticks: { font: { size: 9 }, callback: v => v + '%' } } } } }));
    if (HR_SECS.storage && $('cHrSt')) charts.push(new Chart($('cHrSt'), {
      type: 'doughnut', data: { labels: ['ใช้ไป', 'ว่าง'], datasets: [{ data: [41, 59], backgroundColor: [token('--purple'), grid], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: '64%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 9, font: { size: 10 } } } } } }));
  }

  // ============================================================
  //  Peak-time graph (period-adaptive) — shared by Face & LPR reports
  //  daily → by hour · weekly → by day-of-week · monthly → by day-of-month
  // ============================================================
  const _mDays = Array.from({ length: 30 }, (_, i) => i + 1);
  function _monthly(base, spike) { return _mDays.map(d => Math.round(base * (0.7 + 0.3 * Math.sin(d / 30 * 6.283)) + (d === spike ? base * 0.6 : 0) + (d % 7 === 5 ? base * 0.15 : 0))); }
  const PEAK = {
    daily: {
      labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
      face: [8, 4, 3, 2, 4, 10, 25, 55, 80, 70, 62, 68, 78, 72, 64, 75, 98, 120, 105, 78, 52, 34, 20, 12],
      lpr: [5, 3, 2, 2, 3, 8, 20, 42, 60, 52, 46, 50, 58, 54, 48, 56, 72, 90, 80, 58, 40, 26, 15, 9],
      word: 'ช่วงเวลา', fmtPeak: l => `${l}:00 น.`,
    },
    weekly: {
      labels: ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'],
      face: [380, 440, 410, 470, 520, 300, 210], lpr: [300, 360, 330, 390, 420, 250, 180],
      word: 'วัน', fmtPeak: l => l,
    },
    monthly: {
      labels: _mDays.map(String), face: _monthly(150, 26), lpr: _monthly(110, 26),
      word: 'วันที่', fmtPeak: l => l,
    },
  };
  function peakSeries(period, kind) {
    const c = PEAK[period === 'custom' ? 'daily' : period] || PEAK.daily;
    const data = c[kind].map(v => Math.round(v * scopeFactor()));
    let pk = 0; data.forEach((v, i) => { if (v > data[pk]) pk = i; });
    return { labels: c.labels, data, peakIdx: pk, peakLabel: c.fmtPeak(c.labels[pk]), word: c.word };
  }
  function peakSectionHtml(canvasId, who, s) {
    return `<div class="rpt-section" data-sec="peak">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>ช่วงที่${who}หนาแน่นที่สุด (Peak) <span class="hr-pill">${s.word} ${s.peakLabel}</span></div>
      <div class="chart-box"><canvas id="${canvasId}"></canvas></div></div>`;
  }
  function buildPeakChart(canvasId, s) {
    if (!$(canvasId)) return;
    const acc = token('--accent'), bad = token('--status-bad'), grid = token('--border-hairline');
    charts.push(new Chart($(canvasId), {
      type: 'bar', data: { labels: s.labels, datasets: [{ data: s.data, backgroundColor: s.data.map((_, i) => i === s.peakIdx ? bad : acc), borderRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, maintainAspectRatio: false, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { grid: { color: grid }, ticks: { font: { size: 9 } } } } },
    }));
  }

  // ============================================================
  //  Face report tab (ใบหน้า) — suspect hits captured vs reference
  // ============================================================
  const PERSON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21c0-4.6 4-7 8.5-7s8.5 2.4 8.5 7z"/></svg>';
  const FACE_SUSPECTS = [
    { name: 'นาย ก. (หมายจับ 88/2569)', group: 'บัญชีดำ', gcolor: '#ef4444', cam: 'ประตูหน้า BMA', time: '08:42', score: 94, site: 'bma' },
    { name: 'อดีตพนักงาน (เลิกจ้าง)', group: 'ห้ามเข้า', gcolor: '#f59e0b', cam: 'อาคาร A', time: '13:05', score: 88, site: 'main' },
    { name: 'บุคคลเฝ้าระวัง #A-21', group: 'บัญชีดำ', gcolor: '#ef4444', cam: 'ลานจอด BMA', time: '17:20', score: 86, site: 'bma' },
    { name: 'นาย ข. (ต้องสงสัย)', group: 'บัญชีดำ', gcolor: '#ef4444', cam: 'ตลาดภูเก็ต', time: '15:33', score: 82, site: 'phuket' },
    { name: 'ผู้บริหาร (VIP)', group: 'VIP', gcolor: '#22c55e', cam: 'ท่าเรือ', time: '09:10', score: 97, site: 'phuket' },
  ];
  let faType = 'daily', faFmt = 'png', faGroup = 'all', faMinScore = 80;
  const FA_SECS = { peak: true, demographics: true, trend: true, persons: true, suspects: true };
  function faScale(n) { return Math.round(n * TYPES[faType].k * scopeFactor()); }
  function faSuspects() { const s = scopeSites(); return FACE_SUSPECTS.filter(x => s.includes(x.site) && (faGroup === 'all' || x.group === faGroup) && x.score >= faMinScore); }
  function faceImg(label, ref) {
    return `<div class="cmp-box${ref ? ' ref' : ''}"><div class="cmp-ph">${PERSON_SVG}</div><span class="cmp-cap">${label}</span></div>`;
  }
  function faceCard(s) {
    return `<div class="cmp-card" style="--gc:${s.gcolor}">
      <div class="cmp-imgs">${faceImg('ภาพจากกล้อง', false)}${faceImg('ภาพอ้างอิง', true)}</div>
      <div class="cmp-info"><span class="rpt-badge" style="background:${s.gcolor}">${s.group}</span>
        <div class="cmp-name">${s.name}</div>
        <div class="rpt-mute">${s.cam} · ${s.time} · ความมั่นใจ ${s.score}%</div></div>
    </div>`;
  }
  function faSectionSuspects() {
    const list = faSuspects();
    return `<div class="rpt-section" data-sec="suspects">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-bad)"></span>ผู้ต้องสงสัย / เฝ้าระวังที่พบ <span class="hr-pill" style="color:var(--status-bad);background:rgba(239,68,68,.13)">${list.length} ราย</span></div>
      ${list.length ? `<div class="cmp-grid">${list.map(faceCard).join('')}</div>` : '<div class="rpt-mute" style="padding:10px 0">ไม่พบบุคคลเฝ้าระวังตามเงื่อนไข</div>'}
    </div>`;
  }
  function faSectionPersons() {
    return `<div class="rpt-section" data-sec="persons">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--purple)"></span>บุคคลที่พบบ่อย</div>
      <table class="rpt-table">${FR_PERSONS.map(p => `<tr><td><span class="rpt-ava">${p.name.trim()[0]}</span>${p.name} <span class="rpt-mute">· ${p.dept}</span></td><td class="rpt-num">${fmt(faScale(p.n))}</td></tr>`).join('')}</table>
    </div>`;
  }
  function faSectionDemo() {
    return `<div class="rpt-section" data-sec="demographics">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:#14b8a6"></span>ข้อมูลประชากร</div>
      <div class="rpt-2col">
        <div class="rpt-chartcard"><div class="rpt-subh">เพศ</div><div class="chart-box sm"><canvas id="cFaG"></canvas></div></div>
        <div class="rpt-chartcard"><div class="rpt-subh">ช่วงอายุ</div><div class="chart-box sm"><canvas id="cFaA"></canvas></div></div>
      </div>
    </div>`;
  }
  function faSectionPeak() { return peakSectionHtml('cFaPk', 'คน', peakSeries(faType, 'face')); }
  function faSectionTrend() {
    return `<div class="rpt-section" data-sec="trend">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>แนวโน้มตามเวลา — จดจำได้ vs ไม่รู้จัก</div>
      <div class="chart-box"><canvas id="cFaT"></canvas></div>
    </div>`;
  }
  function renderFaceDoc() {
    destroyCharts();
    const ty = TYPES[faType];
    const tiles = [
      { k: 'ใบหน้าทั้งหมด', v: faScale(412), c: 'var(--accent)' },
      { k: 'จดจำได้', v: faScale(316), c: 'var(--purple)' },
      { k: 'ไม่รู้จัก', v: faScale(96), c: 'var(--warn)' },
      { k: 'เฝ้าระวังที่พบ', v: faSuspects().length, c: 'var(--status-bad)' },
    ];
    // executive view: graphs first (peak → demographics → trend), then table,
    // image evidence (suspect cards) last
    const secs = [];
    if (FA_SECS.peak) secs.push(faSectionPeak());
    if (FA_SECS.demographics) secs.push(faSectionDemo());
    if (FA_SECS.trend) secs.push(faSectionTrend());
    if (FA_SECS.persons) secs.push(faSectionPersons());
    if (FA_SECS.suspects) secs.push(faSectionSuspects());
    $('faDoc').innerHTML = `
      <div class="rpt-watermark">ตัวอย่าง</div>
      <div class="rpt-head">
        <div class="rpt-brand"><span class="rpt-logo">V</span><div><div class="rpt-brand-name">Vigil Platform</div><div class="rpt-brand-sub">Face Recognition Report</div></div></div>
        <div class="rpt-head-meta"><div class="rpt-title-doc">รายงานการจดจำใบหน้า</div>
          <div class="rpt-mute">${ty.label} · ${ty.rangeText}</div>
          <div class="rpt-mute"><span class="rpt-scopetag">${scopeLabel()}</span> · ความมั่นใจ ≥ ${faMinScore}%${faGroup !== 'all' ? ` · กลุ่ม ${faGroup}` : ''}</div></div>
      </div>
      <div class="rpt-execrow">${tiles.map(t => `<div class="rpt-exec" style="--ka:${t.c}"><div class="rpt-exec-v">${fmt(t.v)}</div><div class="rpt-exec-k">${t.k}</div></div>`).join('')}</div>
      ${secs.length ? secs.join('') : '<div class="rpt-empty">เลือกเนื้อหาอย่างน้อย 1 หมวด</div>'}
      <div class="rpt-foot"><span>เอกสารลับ · PDPA — ข้อมูลใบหน้าเป็นข้อมูลอ่อนไหว</span><span>Vigil Platform · หน้า 1/1</span></div>`;
    buildFaceCharts();
    $('faSummary').innerHTML = `<div><b>ช่วง:</b> ${ty.rangeText}</div><div><b>เกณฑ์:</b> ≥${faMinScore}% · ${faGroup === 'all' ? 'ทุกกลุ่ม' : faGroup}</div><div><b>รูปแบบ:</b> ${faFmt.toUpperCase()}</div>`;
  }
  function buildFaceCharts() {
    const acc = token('--accent'), grid = token('--border-hairline'), dim = token('--text-secondary');
    Chart.defaults.color = dim; Chart.defaults.font.family = token('--ui-font-family') || 'sans-serif';
    const noLeg = { plugins: { legend: { display: false } }, maintainAspectRatio: false };
    if (FA_SECS.demographics) {
      if ($('cFaG')) charts.push(new Chart($('cFaG'), { type: 'doughnut', data: { labels: ['ชาย', 'หญิง', 'ไม่ทราบ'], datasets: [{ data: [faScale(230), faScale(158), faScale(24)], backgroundColor: [acc, '#e879a6', dim], borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 9 } } } } } }));
      if ($('cFaA')) charts.push(new Chart($('cFaA'), { type: 'bar', data: { labels: ['<18', '18-30', '31-45', '46-60', '60+'], datasets: [{ data: [faScale(18), faScale(150), faScale(120), faScale(70), faScale(30)], backgroundColor: '#14b8a6', borderRadius: 3 }] }, options: { ...noLeg, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: grid }, ticks: { font: { size: 9 } } } } } }));
    }
    if (FA_SECS.peak) buildPeakChart('cFaPk', peakSeries(faType, 'face'));
    if (FA_SECS.trend && $('cFaT')) charts.push(new Chart($('cFaT'), { type: 'line', data: { labels: ['08', '10', '12', '14', '16', '18'], datasets: [
      { label: 'จดจำได้', data: [40, 62, 55, 48, 70, 52].map(faScale), borderColor: token('--purple'), backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2 },
      { label: 'ไม่รู้จัก', data: [12, 18, 14, 11, 20, 16].map(faScale), borderColor: token('--warn'), backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2 } ] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: grid }, ticks: { font: { size: 9 } } } } } }));
  }

  // ============================================================
  //  LPR report tab (ป้ายทะเบียน) — watchlist vehicle hits + breakdowns
  // ============================================================
  let lpType = 'daily', lpFmt = 'png', lpGroup = 'all';
  const LP_SECS = { peak: true, province: true, vtype: true, direction: true, watch: true };
  // exclude 'ไม่ทราบ' province from the report (same as prod analytics charts)
  const LPR_PROV_RPT = LPR_PROV.filter(p => p.name !== 'ไม่ทราบ');
  function lpSectionPeak() { return peakSectionHtml('cLpPk', 'รถ', peakSeries(lpType, 'lpr')); }
  function lpScale(n) { return Math.round(n * TYPES[lpType].k * scopeFactor()); }
  function lpWatch() { const s = scopeSites(); return LPR_WATCH.filter(w => s.includes(w.site) && (lpGroup === 'all' || w.group === lpGroup)); }
  function lprWatchCard(w) {
    return `<div class="cmp-card" style="--gc:${w.gcolor}">
      <div class="cmp-imgs">
        <div class="cmp-box"><div class="cmp-scene">ภาพจากกล้อง<br><small>${w.cam} · ${w.time}</small></div><div class="cmp-plaque">${plaque(w)}</div><span class="cmp-cap">ที่ตรวจพบ</span></div>
        <div class="cmp-box ref"><div class="cmp-plaque big">${plaque(w)}</div><span class="cmp-cap">ทะเบียนเฝ้าระวัง (อ้างอิง)</span></div>
      </div>
      <div class="cmp-info"><span class="rpt-badge" style="background:${w.gcolor}">${w.group}</span>
        <div class="cmp-name">${w.prov} ${w.num}</div>
        <div class="rpt-mute">${[w.region || 'ไม่ทราบจังหวัด', w.cam, w.time].join(' · ')}</div></div>
    </div>`;
  }
  function lpSectionWatch() {
    const list = lpWatch();
    return `<div class="rpt-section" data-sec="watch">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-bad)"></span>รถในรายการเฝ้าระวังที่ตรวจพบ <span class="hr-pill" style="color:var(--status-bad);background:rgba(239,68,68,.13)">${list.length} คัน</span></div>
      ${list.length ? `<div class="cmp-grid">${list.map(lprWatchCard).join('')}</div>` : '<div class="rpt-mute" style="padding:10px 0">ไม่พบรถเฝ้าระวังตามเงื่อนไข</div>'}
    </div>`;
  }
  function lpSectionProvince() {
    return `<div class="rpt-section" data-sec="province">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>จังหวัดที่พบมากสุด</div>
      <div class="chart-box"><canvas id="cLpP2"></canvas></div></div>`;
  }
  function lpSectionVtype() {
    return `<div class="rpt-section" data-sec="vtype">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--warn)"></span>ประเภทรถ</div>
      <div class="rpt-2col"><div class="rpt-chartcard"><div class="chart-box"><canvas id="cLpV2"></canvas></div></div>
        <table class="rpt-table">${LPR_VTYPES.map(v => `<tr><td>${v.th}</td><td class="rpt-num">${fmt(lpScale(v.n))}</td></tr>`).join('')}</table></div></div>`;
  }
  function lpSectionDir() {
    return `<div class="rpt-section" data-sec="direction">
      <div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-ok)"></span>ทิศทาง เข้า / ออก</div>
      <div class="chart-box"><canvas id="cLpD"></canvas></div></div>`;
  }
  function renderLprDoc() {
    destroyCharts();
    const ty = TYPES[lpType];
    const tiles = [
      { k: 'ป้ายทั้งหมด', v: lpScale(495), c: 'var(--accent)' },
      { k: 'ป้ายไม่ซ้ำ', v: lpScale(410), c: 'var(--purple)' },
      { k: 'อ่านไม่ออก', v: lpScale(34), c: 'var(--warn)' },
      { k: 'รถเฝ้าระวัง', v: lpWatch().length, c: 'var(--status-bad)' },
    ];
    // executive view: graphs first (peak → province → vtype → direction),
    // image evidence (watch cards) last
    const secs = [];
    if (LP_SECS.peak) secs.push(lpSectionPeak());
    if (LP_SECS.province) secs.push(lpSectionProvince());
    if (LP_SECS.vtype) secs.push(lpSectionVtype());
    if (LP_SECS.direction) secs.push(lpSectionDir());
    if (LP_SECS.watch) secs.push(lpSectionWatch());
    $('lpDoc').innerHTML = `
      <div class="rpt-watermark">ตัวอย่าง</div>
      <div class="rpt-head">
        <div class="rpt-brand"><span class="rpt-logo">V</span><div><div class="rpt-brand-name">Vigil Platform</div><div class="rpt-brand-sub">License Plate (ANPR) Report</div></div></div>
        <div class="rpt-head-meta"><div class="rpt-title-doc">รายงานป้ายทะเบียน</div>
          <div class="rpt-mute">${ty.label} · ${ty.rangeText}</div>
          <div class="rpt-mute"><span class="rpt-scopetag">${scopeLabel()}</span>${lpGroup !== 'all' ? ` · กลุ่ม ${lpGroup}` : ''}</div></div>
      </div>
      <div class="rpt-execrow">${tiles.map(t => `<div class="rpt-exec" style="--ka:${t.c}"><div class="rpt-exec-v">${fmt(t.v)}</div><div class="rpt-exec-k">${t.k}</div></div>`).join('')}</div>
      ${secs.length ? secs.join('') : '<div class="rpt-empty">เลือกเนื้อหาอย่างน้อย 1 หมวด</div>'}
      <div class="rpt-foot"><span>เอกสารลับ · สำหรับใช้ภายในองค์กรเท่านั้น (PDPA)</span><span>Vigil Platform · หน้า 1/1</span></div>`;
    buildLprCharts();
    $('lpSummary').innerHTML = `<div><b>ช่วง:</b> ${ty.rangeText}</div><div><b>กลุ่ม:</b> ${lpGroup === 'all' ? 'ทุกกลุ่ม' : lpGroup}</div><div><b>รูปแบบ:</b> ${lpFmt.toUpperCase()}</div>`;
  }
  function buildLprCharts() {
    const acc = token('--accent'), grid = token('--border-hairline'), dim = token('--text-secondary');
    Chart.defaults.color = dim; Chart.defaults.font.family = token('--ui-font-family') || 'sans-serif';
    const noLeg = { plugins: { legend: { display: false } }, maintainAspectRatio: false };
    const palette = [acc, token('--purple'), token('--status-ok'), token('--warn'), token('--status-bad'), '#14b8a6'];
    if (LP_SECS.peak) buildPeakChart('cLpPk', peakSeries(lpType, 'lpr'));
    if (LP_SECS.province && $('cLpP2')) charts.push(new Chart($('cLpP2'), { type: 'bar', data: { labels: LPR_PROV_RPT.map(p => p.name), datasets: [{ data: LPR_PROV_RPT.map(p => lpScale(p.n)), backgroundColor: acc, borderRadius: 3 }] }, options: { ...noLeg, indexAxis: 'y', scales: { x: { grid: { color: grid }, ticks: { font: { size: 9 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } } }));
    if (LP_SECS.vtype && $('cLpV2')) charts.push(new Chart($('cLpV2'), { type: 'doughnut', data: { labels: LPR_VTYPES.map(v => v.th), datasets: [{ data: LPR_VTYPES.map(v => lpScale(v.n)), backgroundColor: LPR_VTYPES.map((_, i) => palette[i % palette.length]), borderWidth: 0 }] }, options: { maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { boxWidth: 9, font: { size: 9 } } } } } }));
    if (LP_SECS.direction && $('cLpD')) charts.push(new Chart($('cLpD'), { type: 'line', data: { labels: ['08', '10', '12', '14', '16', '18'], datasets: [
      { label: 'เข้า', data: [24, 31, 28, 22, 30, 27].map(lpScale), borderColor: token('--status-ok'), backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2 },
      { label: 'ออก', data: [12, 14, 11, 16, 18, 15].map(lpScale), borderColor: token('--warn'), backgroundColor: 'transparent', tension: .35, pointRadius: 0, borderWidth: 2 } ] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: grid }, ticks: { font: { size: 9 } } } } } }));
  }

  // ============================================================
  //  Auto-send LINE tab
  // ============================================================
  const FREQ_TH = { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน' };
  const _DOM_MAP = { events: ['เหตุการณ์', 'var(--accent)'], facerec: ['ใบหน้า', 'var(--purple)'], facecap: ['บันทึกหน้า', '#14b8a6'], lpr: ['LPR', 'var(--warn)'] };
  const _HSEC_MAP = { camera_status: ['กล้อง', 'var(--accent)'], camera_uptime: ['uptime', 'var(--status-ok)'], storage: ['ดิสก์', 'var(--purple)'], system: ['ระบบ', '#14b8a6'] };
  const FAM_LABEL = { analytics: 'วิเคราะห์', health: 'สุขภาพระบบ', face: 'ใบหน้า', lpr: 'ป้ายทะเบียน' };
  function contentChips(s) {
    if (s.family === 'face') return `<span class="dom-chip" style="--c:var(--purple)">ใบหน้า · ผู้ต้องสงสัย</span>`;
    if (s.family === 'lpr') return `<span class="dom-chip" style="--c:var(--warn)">ป้ายทะเบียน · เฝ้าระวัง</span>`;
    const m = s.family === 'health' ? _HSEC_MAP : _DOM_MAP;
    const obj = s.family === 'health' ? (s.hsecs || {}) : (s.domains || {});
    return Object.keys(obj).filter(k => obj[k]).map(k => `<span class="dom-chip" style="--c:${m[k][1]}">${m[k][0]}</span>`).join('');
  }
  function freqText(s) {
    if (s.freq === 'daily') return 'ทุกวัน';
    if (s.freq === 'weekly') return 'ทุกวัน' + ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][+s.dow || 1];
    return `ทุกวันที่ ${s.dom || 1} ของเดือน`;
  }
  function siteTag(code) {
    if (code === 'all') return `<span class="site-tag all">ทุก Site</span>`;
    return `<span class="site-tag" style="--sc:${SITES[code].color}"><span class="site-dot" style="background:${SITES[code].color}"></span>${SITES[code].name}</span>`;
  }
  function renderSchedules() {
    const el = $('autoList');
    const rows = SCHEDULES.filter(s => viewer === 'super' || s.site === 'all' || VIEWERS[viewer].sites.includes(s.site));
    el.innerHTML = rows.map(s => `<div class="sched-card${s.enabled ? '' : ' off'}" data-sched="${s.id}">
      <div class="sched-main">
        <div class="sched-row1">${siteTag(s.site)}<span class="fam-badge ${s.family}">${FAM_LABEL[s.family] || s.family}</span><span class="sched-name">${s.name}</span><span class="freq-badge">${FREQ_TH[s.freq]}</span></div>
        <div class="sched-row2">${freqText(s)} · ${s.time} น. · ${s.fmt.toUpperCase()} · ผู้รับ ${s.recips.length}</div>
        <div class="sched-doms">${contentChips(s)}</div>
      </div>
      <div class="sched-side">
        <span class="sched-state ${s.enabled ? 'on' : 'off'}">${s.enabled ? 'เปิด' : 'ปิด'}</span>
        <button class="btn btn-secondary sched-edit" data-edit="${s.id}">แก้ไข</button>
        <button class="icon-x sched-del" data-del="${s.id}" aria-label="ลบ">✕</button>
      </div>
    </div>`).join('') || '<div class="rpt-empty">ยังไม่มีกำหนดการ — กด "+ สร้างกำหนดการ"</div>';
    const on = rows.filter(s => s.enabled).length;
    $('autoBadge').textContent = on; $('autoBadge').style.display = on ? '' : 'none';
    renderLineMock();
  }
  function renderLineMock() {
    const s = SCHEDULES.find(x => x.enabled) || SCHEDULES[0];
    if (!s) { $('lineMock').innerHTML = ''; return; }
    const lines = [];
    if (s.family === 'face') { lines.push('• ใบหน้าทั้งหมด 412 · เฝ้าระวังที่พบ 5 ราย'); lines.push('• แนบภาพที่ตรวจพบ + ภาพอ้างอิง'); }
    else if (s.family === 'lpr') { lines.push('• ป้ายทะเบียน 495 · รถเฝ้าระวัง 4 คัน'); lines.push('• แนบภาพป้าย + ทะเบียนเฝ้าระวัง'); }
    else if (s.family === 'health') {
      const h = s.hsecs || {};
      if (h.camera_status) lines.push('• กล้องออนไลน์ 9/11 (ออฟไลน์ 2)');
      if (h.camera_uptime) lines.push('• Uptime เฉลี่ย 95.6%');
      if (h.storage) lines.push('• ดิสก์ 412 GB / 1 TB (41%)');
      if (h.system) lines.push('• RAM 62% · Workers 7/7 · v1.5.3');
    } else {
      const d = s.domains || {};
      if (d.events) lines.push('• เหตุการณ์ทั้งหมด 242 ครั้ง (บุกรุก 42)');
      if (d.facerec) lines.push('• จดจำใบหน้า 412 · ไม่รู้จัก 96 · เฝ้าระวัง 2');
      if (d.facecap) lines.push('• บันทึกใบหน้า 843 ครั้ง');
      if (d.lpr) lines.push('• ป้ายทะเบียน 495 · ตรงเฝ้าระวัง 3 คัน');
    }
    $('lineMock').innerHTML = `
      <div class="lm-line-head"><span class="lm-line-logo">V</span> Vigil Platform</div>
      <div class="lm-bubble">
        <div class="lm-bubble-title">${({ health: '🩺', face: '🧑', lpr: '🚗' })[s.family] || '📊'} ${s.name}</div>
        <div class="lm-bubble-sub">${FREQ_TH[s.freq]} · 21 มิ.ย. 2026 08:00</div>
        <div class="lm-bubble-body">${lines.join('<br>')}</div>
        <div class="lm-bubble-attach">${s.fmt === 'pdf' ? '📄 รายงาน.pdf' : '🖼️ รายงาน.png'} · แตะเพื่อเปิด</div>
      </div>
      <div class="lm-bubble-time">08:00</div>`;
  }

  function renderRecips(selected) {
    $('seRecips').innerHTML = RECIPS.map(r => `<label class="recip-item"><input type="checkbox" data-recip="${r.id}" ${selected.includes(r.id) ? 'checked' : ''}>
      <span class="recip-ico">${r.type === 'group' ? '👥' : '👤'}</span>${r.name}</label>`).join('');
  }
  function renderSeDow() {
    $('seDow').innerHTML = ['1', '2', '3', '4', '5', '6', '0'].map(d => `<button data-dow="${d}" class="${seDow === d ? 'active' : ''}">${DOW_TH[+d]}</button>`).join('');
  }
  function openEditor(s, presetFamily) {
    _editId = s ? s.id : null;
    $('schedEditTitle').textContent = s ? 'แก้ไขกำหนดการ' : 'กำหนดการใหม่';
    $('seName').value = s ? s.name : '';
    seFamily = s ? s.family : (presetFamily || 'analytics');
    seFreq = s ? s.freq : 'daily'; seFmt = s ? s.fmt : 'png'; seDow = (s && s.dow) || '1';
    $('seTime').value = s ? s.time : '08:00';
    $('seDom').value = (s && s.dom) || '1';
    $('seEnabled').checked = s ? s.enabled : true;
    const dsrc = (s && s.domains) || { events: true, facerec: true, facecap: true, lpr: true };
    $('seDomains').querySelectorAll('input[data-dom]').forEach(cb => { cb.checked = !!dsrc[cb.dataset.dom]; });
    const hsrc = (s && s.hsecs) || { camera_status: true, camera_uptime: true, storage: true, system: true };
    $('seHealthSecs').querySelectorAll('input[data-hsec]').forEach(cb => { cb.checked = !!hsrc[cb.dataset.hsec]; });
    seSite = s ? s.site : (viewer === 'super' ? 'all' : VIEWERS[viewer].sites[0]);
    segSet('seFamily', 'fam', seFamily); segSet('seFreq', 'fr', seFreq); segSet('seFmt', 'fmt', seFmt);
    renderSeSite(); renderSeDow(); _seFreqFields(); _seFamilyFields(); renderRecips(s ? s.recips : ['g1']);
    $('schedEditor').style.display = '';
    $('schedEditor').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function _seFreqFields() {
    $('seDowGroup').style.display = seFreq === 'weekly' ? '' : 'none';
    $('seDomGroup').style.display = seFreq === 'monthly' ? '' : 'none';
  }
  function _seFamilyFields() {
    $('seDomains').style.display = seFamily === 'analytics' ? '' : 'none';
    $('seHealthSecs').style.display = seFamily === 'health' ? '' : 'none';
    $('seWholeNote').style.display = (seFamily === 'face' || seFamily === 'lpr') ? '' : 'none';
  }
  function renderSeSite() {
    const opts = viewer === 'super' ? ['all', 'main', 'vss', 'bma', 'phuket'] : VIEWERS[viewer].sites;
    if (!opts.includes(seSite)) seSite = opts[0];
    $('seSite').innerHTML = opts.map(s => {
      const lbl = s === 'all' ? 'ทุก Site' : SITES[s].name;
      const dot = s === 'all' ? '' : `<span class="site-dot" style="background:${SITES[s].color}"></span>`;
      return `<button data-st="${s}" class="${seSite === s ? 'active' : ''}">${dot}${lbl}</button>`;
    }).join('');
  }
  function saveSched() {
    const recips = [...$('seRecips').querySelectorAll('input:checked')].map(c => c.dataset.recip);
    const domains = {}; $('seDomains').querySelectorAll('input[data-dom]').forEach(cb => domains[cb.dataset.dom] = cb.checked);
    const hsecs = {}; $('seHealthSecs').querySelectorAll('input[data-hsec]').forEach(cb => hsecs[cb.dataset.hsec] = cb.checked);
    const row = { site: seSite, family: seFamily, name: $('seName').value.trim() || 'กำหนดการใหม่', freq: seFreq, time: $('seTime').value || '08:00',
      dow: seDow, dom: $('seDom').value || '1', fmt: seFmt, domains, hsecs, recips, enabled: $('seEnabled').checked };
    if (_editId) { const i = SCHEDULES.findIndex(s => s.id === _editId); SCHEDULES[i] = { ...SCHEDULES[i], ...row }; }
    else { SCHEDULES.unshift({ id: _nextSched++, ...row }); }
    $('schedEditor').style.display = 'none'; renderSchedules();
  }

  // ============================================================
  //  History tab
  // ============================================================
  function renderHistory() {
    const rows = HISTORY
      .filter(h => viewer === 'super' || h.site === 'all' || VIEWERS[viewer].sites.includes(h.site))
      .filter(h => histFilter === 'all' || (histFilter === 'ok' ? h.status === 'ok' : h.status === 'fail'));
    $('histSub').textContent = `${rows.length} รายการ · ${scopeLabel()}`;
    $('histTable').innerHTML = `<thead><tr><th>วันที่ส่ง</th><th>Site</th><th>ประเภท</th><th>ช่วง</th><th>ผู้รับ</th><th>รูปแบบ</th><th>ขนาด</th><th>สถานะ</th><th></th></tr></thead><tbody>${rows.map(h => `<tr>
      <td>${h.date}</td><td>${siteTag(h.site)}</td><td>${h.type}</td><td>${h.range}</td><td>${h.recips} ราย</td><td>${h.fmt}</td><td>${h.size}</td>
      <td><span class="hist-state ${h.status}">${h.status === 'ok' ? 'สำเร็จ' : 'ล้มเหลว'}</span></td>
      <td>${h.status === 'ok' ? '<button class="btn btn-secondary hist-view">ดู</button>' : '<button class="btn btn-secondary hist-view">ลองใหม่</button>'}</td></tr>`).join('')}</tbody>`;
  }

  // ============================================================
  //  segmented-control helper + bindings
  // ============================================================
  function segSet(barId, attr, val) {
    $(barId).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset[attr] === val));
  }
  function rerenderActiveTab() {
    const t = document.querySelector('#rptTabBar .tab.active')?.dataset.tab || 'build';
    if (t === 'build') renderReportDoc();
    else if (t === 'health') renderHealthDoc();
    else if (t === 'face') renderFaceDoc();
    else if (t === 'lpr') renderLprDoc();
    else if (t === 'auto') renderSchedules();
    else if (t === 'history') renderHistory();
  }

  // tab switch
  $('rptTabBar').addEventListener('click', e => {
    const b = e.target.closest('.tab[data-tab]'); if (!b) return;
    document.querySelectorAll('#rptTabBar .tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.tab;
    ['build', 'health', 'face', 'lpr', 'auto', 'history'].forEach(n => { $('tab-' + n).style.display = n === t ? '' : 'none'; });
    if (t === 'build') renderReportDoc();
    if (t === 'health') renderHealthDoc();
    if (t === 'face') renderFaceDoc();
    if (t === 'lpr') renderLprDoc();
    if (t === 'auto') renderSchedules();
    if (t === 'history') renderHistory();
  });

  // builder controls
  $('rptTypeBar').addEventListener('click', e => { const b = e.target.closest('button[data-rt]'); if (!b) return; rptType = b.dataset.rt; segSet('rptTypeBar', 'rt', rptType); renderReportDoc(); });
  $('rptFmtBar').addEventListener('click', e => { const b = e.target.closest('button[data-fmt]'); if (!b) return; rptFmt = b.dataset.fmt; segSet('rptFmtBar', 'fmt', rptFmt); $('rbFmtLabel').textContent = rptFmt.toUpperCase(); renderSummary(); });
  $('rbDomains').addEventListener('change', e => { const cb = e.target.closest('input[data-dom]'); if (!cb) return; DOMAINS[cb.dataset.dom] = cb.checked; renderReportDoc(); });
  $('rbTitle').addEventListener('input', () => { const d = $('rptDoc').querySelector('.rpt-title-doc'); if (d) d.textContent = $('rbTitle').value || 'รายงานวิเคราะห์ระบบ CCTV'; });
  $('rbSendLine').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); });
  $('rbSchedule').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); openEditor(null); });
  $('rbDownload').addEventListener('click', () => { $('rbDownload').textContent = 'กำลังสร้าง…'; setTimeout(() => { $('rbDownload').innerHTML = `ดาวน์โหลด <span id="rbFmtLabel">${rptFmt.toUpperCase()}</span>`; }, 900); });

  // scope bar — RBAC role sim + Site scope
  $('viewerBar').addEventListener('click', e => { const b = e.target.closest('button[data-vw]'); if (!b) return; setViewer(b.dataset.vw); });
  $('siteBar').addEventListener('click', e => { const b = e.target.closest('button[data-site]'); if (!b) return; siteScope = b.dataset.site; renderScopeBar(); rerenderActiveTab(); });

  // health controls
  $('hrGroupBar').addEventListener('click', e => { const b = e.target.closest('button[data-gb]'); if (!b) return; hrGroupBy = b.dataset.gb; segSet('hrGroupBar', 'gb', hrGroupBy); renderHealthDoc(); });
  $('hrRangeBar').addEventListener('click', e => { const b = e.target.closest('button[data-hr]'); if (!b) return; hrRange = b.dataset.hr; segSet('hrRangeBar', 'hr', hrRange); renderHealthDoc(); });
  $('hrFmtBar').addEventListener('click', e => { const b = e.target.closest('button[data-fmt]'); if (!b) return; hrFmt = b.dataset.fmt; segSet('hrFmtBar', 'fmt', hrFmt); $('hrFmtLabel').textContent = hrFmt.toUpperCase(); renderHealthDoc(); });
  $('hrSecs').addEventListener('change', e => { const cb = e.target.closest('input[data-sec]'); if (!cb) return; HR_SECS[cb.dataset.sec] = cb.checked; renderHealthDoc(); });
  $('hrSendLine').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); });
  $('hrSchedule').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); openEditor(null, 'health'); });
  $('hrDownload').addEventListener('click', () => { $('hrDownload').textContent = 'กำลังสร้าง…'; setTimeout(() => { $('hrDownload').innerHTML = `ดาวน์โหลด <span id="hrFmtLabel">${hrFmt.toUpperCase()}</span>`; }, 900); });

  // face report controls
  $('faTypeBar').addEventListener('click', e => { const b = e.target.closest('button[data-rt]'); if (!b) return; faType = b.dataset.rt; segSet('faTypeBar', 'rt', faType); renderFaceDoc(); });
  $('faGroupBar').addEventListener('click', e => { const b = e.target.closest('button[data-fg]'); if (!b) return; faGroup = b.dataset.fg; segSet('faGroupBar', 'fg', faGroup); renderFaceDoc(); });
  $('faScoreBar').addEventListener('click', e => { const b = e.target.closest('button[data-sc]'); if (!b) return; faMinScore = +b.dataset.sc; segSet('faScoreBar', 'sc', b.dataset.sc); renderFaceDoc(); });
  $('faSecs').addEventListener('change', e => { const cb = e.target.closest('input[data-sec]'); if (!cb) return; FA_SECS[cb.dataset.sec] = cb.checked; renderFaceDoc(); });
  $('faFmtBar').addEventListener('click', e => { const b = e.target.closest('button[data-fmt]'); if (!b) return; faFmt = b.dataset.fmt; segSet('faFmtBar', 'fmt', faFmt); $('faFmtLabel').textContent = faFmt.toUpperCase(); renderFaceDoc(); });
  $('faSendLine').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); });
  $('faSchedule').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); openEditor(null, 'face'); });
  $('faDownload').addEventListener('click', () => { $('faDownload').textContent = 'กำลังสร้าง…'; setTimeout(() => { $('faDownload').innerHTML = `ดาวน์โหลด <span id="faFmtLabel">${faFmt.toUpperCase()}</span>`; }, 900); });

  // lpr report controls
  $('lpTypeBar').addEventListener('click', e => { const b = e.target.closest('button[data-rt]'); if (!b) return; lpType = b.dataset.rt; segSet('lpTypeBar', 'rt', lpType); renderLprDoc(); });
  $('lpGroupBar').addEventListener('click', e => { const b = e.target.closest('button[data-lg]'); if (!b) return; lpGroup = b.dataset.lg; segSet('lpGroupBar', 'lg', lpGroup); renderLprDoc(); });
  $('lpSecs').addEventListener('change', e => { const cb = e.target.closest('input[data-sec]'); if (!cb) return; LP_SECS[cb.dataset.sec] = cb.checked; renderLprDoc(); });
  $('lpFmtBar').addEventListener('click', e => { const b = e.target.closest('button[data-fmt]'); if (!b) return; lpFmt = b.dataset.fmt; segSet('lpFmtBar', 'fmt', lpFmt); $('lpFmtLabel').textContent = lpFmt.toUpperCase(); renderLprDoc(); });
  $('lpSendLine').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); });
  $('lpSchedule').addEventListener('click', () => { document.querySelector('#rptTabBar .tab[data-tab="auto"]').click(); openEditor(null, 'lpr'); });
  $('lpDownload').addEventListener('click', () => { $('lpDownload').textContent = 'กำลังสร้าง…'; setTimeout(() => { $('lpDownload').innerHTML = `ดาวน์โหลด <span id="lpFmtLabel">${lpFmt.toUpperCase()}</span>`; }, 900); });

  // auto-send controls
  $('autoNew').addEventListener('click', () => openEditor(null));
  $('seFamily').addEventListener('click', e => { const b = e.target.closest('button[data-fam]'); if (!b) return; seFamily = b.dataset.fam; segSet('seFamily', 'fam', seFamily); _seFamilyFields(); });
  $('seSite').addEventListener('click', e => { const b = e.target.closest('button[data-st]'); if (!b) return; seSite = b.dataset.st; renderSeSite(); });
  $('seCancel').addEventListener('click', () => { $('schedEditor').style.display = 'none'; });
  $('seSave').addEventListener('click', saveSched);
  $('seFreq').addEventListener('click', e => { const b = e.target.closest('button[data-fr]'); if (!b) return; seFreq = b.dataset.fr; segSet('seFreq', 'fr', seFreq); _seFreqFields(); });
  $('seFmt').addEventListener('click', e => { const b = e.target.closest('button[data-fmt]'); if (!b) return; seFmt = b.dataset.fmt; segSet('seFmt', 'fmt', seFmt); });
  $('seDow').addEventListener('click', e => { const b = e.target.closest('button[data-dow]'); if (!b) return; seDow = b.dataset.dow; renderSeDow(); });
  $('autoList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'); if (ed) { openEditor(SCHEDULES.find(s => s.id === +ed.dataset.edit)); return; }
    const del = e.target.closest('[data-del]'); if (del) { SCHEDULES = SCHEDULES.filter(s => s.id !== +del.dataset.del); renderSchedules(); return; }
    const card = e.target.closest('.sched-card[data-sched]'); if (card) openEditor(SCHEDULES.find(s => s.id === +card.dataset.sched));
  });

  // history filter
  $('histFilter').addEventListener('click', e => { const b = e.target.closest('button[data-hf]'); if (!b) return; histFilter = b.dataset.hf; segSet('histFilter', 'hf', histFilter); renderHistory(); });

  // date pickers
  if (typeof AirDatepicker !== 'undefined') {
    const ADP = { dateFormat: 'dd/MM/yyyy', autoClose: true, position: 'bottom left' };
    ['rbFrom', 'rbTo'].forEach(id => { if ($(id)) new AirDatepicker($(id), ADP); });
  }
  $('rbFrom').value = '21/06/2026'; $('rbTo').value = '21/06/2026';

  // init — demo pages are always light theme (memory rule 2026-06-25); prod page
  // supports both themes natively via tokens.
  document.documentElement.setAttribute('data-theme', 'light');
  renderScopeBar();
  renderReportDoc();
})();
