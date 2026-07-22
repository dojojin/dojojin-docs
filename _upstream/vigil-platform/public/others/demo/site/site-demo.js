// ============================================================
// Vigil Platform — Camera Status Multi-Site Demo
// CSP-compliant external script (no inline handlers).
// Mock: 100 cameras across 3 sites, 10/page, 3 types.
// ============================================================
(function () {
  'use strict';

  // ─── Sites ────────────────────────────────────────────────
  const SITES = [
    { id: 'main',   name: 'Main Site', color: '#5b8def' },
    { id: 'bma',    name: 'BMA',       color: '#22c55e' },
    { id: 'phuket', name: 'ภูเก็ต',    color: '#f59e0b' },
  ];

  // ─── Role → allowed sites ──────────────────────────────────
  const ROLES = {
    superadmin: { label: 'Super Admin',      sites: ['main', 'bma', 'phuket'] },
    main:       { label: 'Admin · Main Site', sites: ['main'] },
    bma:        { label: 'Admin · BMA',       sites: ['bma'] },
    phuket:     { label: 'Admin · ภูเก็ต',   sites: ['phuket'] },
  };

  // ─── Mock camera generator (deterministic, no Math.random) ─
  const LOC = {
    main:   ['ชั้น 1 ทางเข้า A','ชั้น 1 ทางเข้า B','ชั้น 2 โถงกลาง','ชั้น 2 ห้องประชุม','ชั้น 3 ระเบียง','ลานจอด P1','ลานจอด P2','ห้อง Server B1','โถงลิฟต์ชั้น 1','ประตูหลังอาคาร'],
    bma:    ['ด่านเข้าหลัก','ด่านออกหลัก','ถนนรัชดา กม.1','ถนนรัชดา กม.2','จุดตรวจ A','จุดตรวจ B','ลานจอด Zone A','ลานจอด Zone B','สะพานลอยหน้าอาคาร','ถนนพหลโยธิน'],
    phuket: ['ทางเข้าหลัก','ล็อบบี้ชั้น 1','ล็อบบี้ชั้น 2','สระว่ายน้ำ','ที่จอดรถ Zone A','ที่จอดรถ Zone B','ชายหาดด้านซ้าย','ชายหาดด้านขวา','ร้านอาหาร Pool Bar','ทางออกฉุกเฉิน'],
  };

  // ponytail: deterministic cycle helper
  const pick = (arr, i) => arr[i % arr.length];
  // status distribution: 70% online, 20% offline, 10% paused
  const STATUS_CYCLE = ['online','online','online','online','online','online','online','offline','offline','paused'];

  function cam(site, idx, group, vendor, type) {
    const id     = `${site.toUpperCase()}-${String(idx).padStart(3, '0')}`;
    const status = pick(STATUS_CYCLE, idx);
    // last_seen_at in seconds ago (deterministic)
    const lastSec = status === 'offline'
      ? 1800 + (idx * 600) % 86400   // 30 min–24h ago when offline
      : pick([30, 60, 90, 120, 180, 240], idx);

    return {
      id, site, group, vendor, type, status,
      name: `กล้อง ${id}`,
      location: pick(LOC[site], idx),
      lastSec,
      // stats — seeded from idx, realistic daily volumes (scales to 5-digit/day)
      stats: (function() {
        const eventsToday   =   80 + (idx * 137) % 4800;   // 80–4,879
        const peopleToday   =   40 + (idx *  97) % 2600;   // 40–2,639
        const vehiclesToday =  200 + (idx * 271) % 14500;  // 200–14,699
        const facesToday    = 1500 + (idx * 311) % 16500;  // 1,500–17,999 (ระดับหมื่น/วัน)
        const facesKnown    = Math.min(Math.round(facesToday * (62 + (idx % 26)) / 100), facesToday); // 62–87%
        return {
          eventsToday, peopleToday, vehiclesToday, facesToday, facesKnown,
          facesSuspect: (idx * 3) % 13,   // 0–12 watchlist hits
        };
      })(),
      // SD recording — mirrors prod: only Bosch is polled (ONVIF
      // GetRecordingSummary). Hikvision/Dahua not supported yet → unknown.
      rec: (function() {
        if (vendor !== 'bosch') return { supported: false };
        if (idx % 9 === 4) return { supported: true, sdStatus: 'unreachable' }; // SD เสีย/ถอด
        return {
          supported: true,
          sdStatus: 'ok',
          recording: status === 'online',          // เขียนอยู่เฉพาะตอน online
          retentionDays: 7 + (idx * 3) % 53,       // 7–59 วันย้อนหลัง
          count: 1200 + (idx * 137) % 28000,       // segment บน SD
          lastCheckSec: 60 + (idx * 37) % 3000,    // ตรวจล่าสุด
        };
      })(),
    };
  }

  // ─── 100 mock cameras ──────────────────────────────────────
  const CAMS = [];
  let _i = 0;

  // Main Site: 40 — mostly Bosch IVA, some Hikvision Face
  [
    ...Array.from({ length: 10 }, () => ['ทางเข้าหลัก',  'bosch',     'standard']),
    ...Array.from({ length:  8 }, () => ['ชั้น 1',       'bosch',     'standard']),
    ...Array.from({ length:  8 }, () => ['ชั้น 2',       'bosch',     'standard']),
    ...Array.from({ length:  6 }, () => ['ชั้น 3',       'bosch',     'standard']),
    ...Array.from({ length:  5 }, () => ['ลานจอดรถ',    'hikvision', 'lpr']),
    ...Array.from({ length:  3 }, () => ['Server Room',  'hikvision', 'face']),
  ].forEach(([g, v, t]) => CAMS.push(cam('main', ++_i, g, v, t)));

  // BMA: 35 — Hikvision LPR + Bosch IVA + Dahua
  [
    ...Array.from({ length:  8 }, () => ['ด่านเข้า-ออก',  'hikvision', 'lpr']),
    ...Array.from({ length: 12 }, () => ['ถนนสายหลัก',   'hikvision', 'lpr']),
    ...Array.from({ length:  8 }, () => ['จุดตรวจ',       'bosch',     'standard']),
    ...Array.from({ length:  7 }, () => ['ลานจอดรถ',     'dahua',     'standard']),
  ].forEach(([g, v, t]) => CAMS.push(cam('bma', ++_i, g, v, t)));

  // Phuket: 25 — Dahua mixed + Hikvision LPR + Dahua Face
  [
    ...Array.from({ length:  6 }, () => ['ทางเข้า',       'hikvision', 'lpr']),
    ...Array.from({ length:  5 }, () => ['ล็อบบี้',       'dahua',     'standard']),
    ...Array.from({ length:  4 }, () => ['สระว่ายน้ำ',   'dahua',     'standard']),
    ...Array.from({ length:  6 }, () => ['ที่จอดรถ',     'dahua',     'lpr']),
    ...Array.from({ length:  4 }, () => ['ชายหาด',        'dahua',     'face']),
  ].forEach(([g, v, t]) => CAMS.push(cam('phuket', ++_i, g, v, t)));

  // ─── State ─────────────────────────────────────────────────
  let role    = 'superadmin';
  let site    = 'all';
  let page    = 1;
  const PER   = 10;

  // ─── Helpers ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  function relTime(sec) {
    if (sec < 60)    return 'เพิ่งเห็น';
    if (sec < 3600)  return `${Math.round(sec / 60)} นาทีที่แล้ว`;
    if (sec < 86400) return `${Math.round(sec / 3600)} ชม.ที่แล้ว`;
    return `${Math.round(sec / 86400)} วันที่แล้ว`;
  }

  // ─── SD recording helpers ──────────────────────────────────
  const TH_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  // Deterministic retention range ending at the mock "today" (2026-06-21).
  function recRange(days) {
    const until = new Date(Date.UTC(2026, 5, 21));
    const from  = new Date(until.getTime() - days * 86400000);
    const fmt = d => `${d.getUTCDate()} ${TH_MONTH[d.getUTCMonth()]}`;
    return `${fmt(from)} – ${fmt(until)}`;
  }
  // Compact card label for SD state (Bosch only — others have no SD telemetry).
  function recCardLine(rec) {
    if (!rec || !rec.supported) return '';
    if (rec.sdStatus === 'unreachable')
      return `<div class="last-seen-line">SD&ensp;<span class="sv bad">การ์ดมีปัญหา</span></div>`;
    const tag = rec.recording
      ? `<span class="sv ok">● บันทึกอยู่</span>`
      : `<span class="sv dim">ปกติ</span>`;
    return `<div class="last-seen-line">SD&ensp;${tag}&ensp;·&ensp;ย้อนหลัง&ensp;<span class="sv dim">${rec.retentionDays}</span>&ensp;วัน</div>`;
  }
  // Full SD-recording box for the modal.
  function recBox(c) {
    const r = c.rec || {};
    if (!r.supported) return `<div class="cm-box">
      <span class="cm-cap">การบันทึก (SD Card)</span>
      <div class="cm-rec-na">ไม่รองรับการตรวจสถานะ SD — มีเฉพาะกล้อง Bosch (ONVIF GetRecordingSummary). ${VENDOR_LABEL[c.vendor] || c.vendor} บันทึกผ่าน NVR/ระบบภายนอก</div>
    </div>`;
    if (r.sdStatus === 'unreachable') return `<div class="cm-box">
      <span class="cm-cap">การบันทึก (SD Card)</span>
      <div class="cm-data">
        <div class="cm-drow"><span class="cm-dk">สถานะ SD</span><span class="cm-dv"><span class="sd-led bad"></span>&ensp;<span class="sv bad">การ์ดมีปัญหา</span></span></div>
        <div class="cm-drow"><span class="cm-dk">ตรวจล่าสุด</span><span class="cm-dv">เมื่อสักครู่</span></div>
      </div>
      <div class="cm-rec-na warn">อ่าน SD ไม่ได้ — ตรวจการ์ดหรือการเชื่อมต่อกล้อง (ช่วงนี้อาจไม่มีภาพย้อนหลัง)</div>
    </div>`;
    return `<div class="cm-box">
      <span class="cm-cap">การบันทึก (SD Card)</span>
      <div class="cm-data">
        <div class="cm-drow"><span class="cm-dk">สถานะ SD</span><span class="cm-dv"><span class="sd-led ok"></span>&ensp;<span class="sv ok">ปกติ</span></span></div>
        <div class="cm-drow"><span class="cm-dk">กำลังบันทึก</span><span class="cm-dv">${r.recording ? '<span class="sv ok">ใช่</span>' : '<span class="sv dim">ไม่ (กล้องไม่ออนไลน์)</span>'}</span></div>
        <div class="cm-drow"><span class="cm-dk">ข้อมูลย้อนหลัง</span><span class="cm-dv">${r.retentionDays} วัน · ${recRange(r.retentionDays)}</span></div>
        <div class="cm-drow"><span class="cm-dk">จำนวนไฟล์</span><span class="cm-dv">${r.count.toLocaleString()} segment</span></div>
        <div class="cm-drow"><span class="cm-dk">ตรวจล่าสุด</span><span class="cm-dv">${relTime(r.lastCheckSec)}</span></div>
      </div>
    </div>`;
  }

  const VENDOR_LABEL = { bosch:'Bosch', hikvision:'Hikvision', dahua:'Dahua', onvif:'ONVIF' };
  const TYPE_LABEL   = { standard:'IVA', lpr:'LPR', face:'Face' };
  const siteObj = id => SITES.find(s => s.id === id) || { name: id, color: '#5b8def' };

  function allowedSites() { return ROLES[role].sites; }

  function filtered() {
    const q  = ($('q').value || '').toLowerCase().trim();
    const fg = $('fGroup').value;
    const fv = $('fVendor').value;
    const ft = $('fType').value;
    const fs = $('fStatus').value;
    const allowed = allowedSites();
    return CAMS.filter(c => {
      if (!allowed.includes(c.site)) return false;
      if (site !== 'all' && c.site !== site) return false;
      if (fg && c.group   !== fg) return false;
      if (fv && c.vendor  !== fv) return false;
      if (ft && c.type    !== ft) return false;
      if (fs && c.status  !== fs) return false;
      if (q && !c.id.toLowerCase().includes(q)
            && !c.name.toLowerCase().includes(q)
            && !c.location.toLowerCase().includes(q)
            && !c.group.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // ─── Render: Summary bar ───────────────────────────────────
  function renderSummary(cams) {
    const online  = cams.filter(c => c.status === 'online').length;
    const offline = cams.filter(c => c.status === 'offline').length;
    const maint   = cams.filter(c => c.status === 'paused').length;
    $('summaryBar').innerHTML = `
      <div class="sum-chip total">รวม ${cams.length} กล้อง</div>
      <div class="sum-chip online"><span class="sdot"></span>ออนไลน์ ${online}</div>
      <div class="sum-chip offline"><span class="sdot"></span>ออฟไลน์ ${offline}</div>
      ${maint ? `<div class="sum-chip paused"><span class="sdot"></span>Maintenance ${maint}</div>` : ''}
    `;
  }

  // ─── Render: Site tabs ─────────────────────────────────────
  function renderTabs() {
    const allowed = allowedSites();
    const nav = $('siteTabs');
    nav.innerHTML = '';

    const addTab = (id, label, color) => {
      const btn = el('button', `site-tab${site === id ? ' active' : ''}`);
      if (color) {
        const dot = el('span', 'tab-dot');
        dot.style.background = color;
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(label));
      btn.dataset.site = id;
      nav.appendChild(btn);
    };

    if (allowed.length > 1) addTab('all', 'ทั้งหมด', null);
    allowed.forEach(sid => {
      const s = siteObj(sid);
      addTab(sid, s.name, s.color);
    });

    nav.querySelectorAll('.site-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        site = btn.dataset.site;
        page = 1;
        render();
      });
    });
  }

  // ─── Render: Group filter (context-aware) ──────────────────
  function renderGroupFilter(cams) {
    const groups = [...new Set(cams.map(c => c.group))].sort((a, b) => a.localeCompare(b, 'th'));
    const sel = $('fGroup');
    const cur = sel.value;
    sel.innerHTML = '<option value="">ทุกกลุ่ม</option>';
    groups.forEach(g => {
      const o = document.createElement('option');
      o.value = g; o.textContent = g;
      if (g === cur) o.selected = true;
      sel.appendChild(o);
    });
  }

  // ─── SVG icons for preview placeholder ────────────────────
  const ICONS = {
    standard: `<svg class="preview-icon" viewBox="0 0 48 48" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="12" width="32" height="24" rx="3"/>
      <path d="M36 20l8-6v20l-8-6"/>
      <circle cx="20" cy="24" r="5"/>
    </svg>`,
    lpr: `<svg class="preview-icon" viewBox="0 0 48 48" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="16" width="40" height="20" rx="4"/>
      <circle cx="13" cy="36" r="4"/><circle cx="35" cy="36" r="4"/>
      <path d="M8 22h7l4-6h10l4 6h7"/>
      <rect x="16" y="24" width="16" height="8" rx="2"/>
    </svg>`,
    face: `<svg class="preview-icon" viewBox="0 0 48 48" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="24" cy="20" r="12"/>
      <path d="M8 44c0-8.837 7.163-16 16-16s16 7.163 16 16"/>
      <path d="M19 21q1 2 5 2t5-2"/><circle cx="19" cy="18" r="1.5" fill="white"/><circle cx="29" cy="18" r="1.5" fill="white"/>
    </svg>`,
  };

  // Mock timestamp (deterministic from camera idx extracted from id)
  function mockTs(id) {
    const n = parseInt(id.split('-')[1] || '1', 10);
    const h = String(7 + (n * 3) % 16).padStart(2,'0');
    const m = String((n * 7) % 60).padStart(2,'0');
    const s = String((n * 11) % 60).padStart(2,'0');
    return `2026-06-21 ${h}:${m}:${s}`;
  }

  // ─── Preview block (shared by card + modal) ────────────────
  function buildPreview(c) {
    let overlay = '';
    if (c.status === 'offline') {
      overlay = `<div class="preview-overlay offline">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M1 1l22 22M16.7 16.7A7 7 0 0 1 5.3 5.3M9.9 4.24A9 9 0 0 1 21 12m-1.7 5.3A9 9 0 0 1 3 12"/>
        </svg>
        ไม่มีสัญญาณ
      </div>`;
    } else if (c.status === 'paused') {
      overlay = `<div class="preview-overlay paused">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>
        </svg>
        Maintenance
      </div>`;
    }
    let chip = '';
    if (c.status === 'online') {
      if (c.type === 'lpr')       chip = `<div class="preview-count type-lpr"><span class="pc-dot"></span>${c.stats.vehiclesToday.toLocaleString()} คัน</div>`;
      else if (c.type === 'face') chip = `<div class="preview-count type-face"><span class="pc-dot"></span>${c.stats.facesToday.toLocaleString()} ใบหน้า</div>`;
      else                        chip = `<div class="preview-count type-standard"><span class="pc-dot"></span>${c.stats.peopleToday.toLocaleString()} คน</div>`;
    }
    return `<div class="card-preview type-${c.type}">
      ${ICONS[c.type] || ICONS.standard}
      <div class="preview-ts">${mockTs(c.id)}</div>
      <div class="preview-cam-id">${c.id}</div>
      ${chip}
      ${overlay}
    </div>`;
  }

  // ─── Render: Camera card ────────────────────────────────────
  function renderCard(c) {
    const card = el('div', `cam-card status-${c.status}`);
    const s    = siteObj(c.site);

    // ── Compact stats block (type-adaptive) ────────────────
    const lsClass = c.status === 'offline' ? 'bad' : c.status === 'paused' ? 'warn' : 'dim';
    let statsBlock = '';

    if (c.status === 'paused') {
      statsBlock = `<div class="stat-line">
        <span class="sv warn">หยุดชั่วคราว</span>
      </div>`;
    } else if (c.type === 'lpr') {
      statsBlock = `<div class="stat-line">รถผ่านวันนี้&ensp;<span class="sv warn">${c.stats.vehiclesToday.toLocaleString()}</span>&ensp;คัน</div>
      <div class="stat-line">Events&ensp;<span class="sv dim">${c.stats.eventsToday.toLocaleString()}</span></div>`;
    } else if (c.type === 'face') {
      const unknown = c.stats.facesToday - c.stats.facesKnown;
      statsBlock = `<div class="stat-line">ใบหน้าวันนี้&ensp;<span class="sv purple">${c.stats.facesToday.toLocaleString()}</span></div>
      <div class="stat-line">รู้จัก&ensp;<span class="sv dim">${c.stats.facesKnown.toLocaleString()}</span>&ensp;·&ensp;ไม่รู้จัก&ensp;<span class="sv">${unknown.toLocaleString()}</span></div>
      ${c.stats.facesSuspect > 0 ? `<div class="stat-line">Watchlist&ensp;<span class="sv bad">${c.stats.facesSuspect}</span>&ensp;รายการ</div>` : ''}`;
    } else {
      statsBlock = `<div class="stat-line">Events&ensp;<span class="sv dim">${c.stats.eventsToday.toLocaleString()}</span>&ensp;·&ensp;คน&ensp;<span class="sv ok">${c.stats.peopleToday.toLocaleString()}</span></div>`;
    }

    card.innerHTML = `
      ${buildPreview(c)}
      <div class="card-info">
        <div class="card-info-top">
          <div class="card-info-left">
            <div class="cam-toprow">
              <span class="status-dot ${c.status}"></span>
              <span class="cam-id">${c.id}</span>
              ${c.status === 'paused' ? '<span class="badge maint">Maintenance</span>' : ''}
            </div>
            <div class="cam-location-name" title="${c.location}">${c.location}</div>
            <div class="cam-breadcrumb">
              <span class="bc-dot" style="background:${s.color}"></span>
              ${s.name}&nbsp;›&nbsp;${c.group}
            </div>
          </div>
          <div class="card-badges">
            <span class="badge vendor-${c.vendor}">${VENDOR_LABEL[c.vendor] || c.vendor}</span>
            <span class="badge type-${c.type}">${TYPE_LABEL[c.type] || c.type}</span>
            ${c.rec?.sdStatus === 'unreachable' ? '<span class="badge sd-bad">SD ✕</span>' : ''}
          </div>
        </div>
        <div class="cam-stats">
          ${statsBlock}
          ${recCardLine(c.rec)}
          <div class="last-seen-line">Last seen&ensp;<span class="sv ${lsClass}">${relTime(c.lastSec)}</span></div>
        </div>
      </div>
    `;
    card.addEventListener('click', () => openCamModal(c));
    return card;
  }

  // ─── Camera detail modal (read-only · theme mirrors LPR demo) ─
  const CAM_MODELS = {
    bosch:     ['FLEXIDOME IP 3000i', 'DINION IP 5000i', 'FLEXIDOME IP 8000i'],
    hikvision: ['DS-2CD2386G2-IU', 'DS-2CD7A26G0-IZS', 'iDS-2CD8A46G0'],
    dahua:     ['IPC-HDW5442T-ZE', 'IPC-HFW5849T1-ASE', 'ITC413-PW4D-IZ3'],
    onvif:     ['ONVIF Generic'],
  };
  const CAM_RES     = ['1920×1080 · 2MP', '2560×1440 · 4MP', '3840×2160 · 8MP'];
  const SITE_OCTET  = { main: 10, bma: 20, phuket: 30 };
  const STATUS_LBL  = { online: 'ออนไลน์', offline: 'ออฟไลน์', paused: 'Maintenance (หยุดชั่วคราว)' };
  // type-aware deep-link target (real system: drillTo→Events / LPR search / Face matches)
  const VIEW_ACTION = {
    standard: { label: 'ดูเหตุการณ์ทั้งหมด', dest: 'หน้าเหตุการณ์ (Events)' },
    lpr:      { label: 'ดูประวัติทะเบียน',    dest: 'LPR · ค้นหาทะเบียน' },
    face:     { label: 'ดูใบหน้าที่พบ',       dest: 'Face · ใบหน้าที่ตรงกัน' },
  };
  const ICON_EXT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>`;

  function camDetail(c) {
    const n = parseInt(c.id.split('-')[1] || '1', 10);
    return {
      model: pick(CAM_MODELS[c.vendor] || CAM_MODELS.onvif, n),
      ip:    `10.${SITE_OCTET[c.site] || 10}.${Math.floor(n / 250) + 1}.${(n % 250) + 5}`,
      res:   pick(CAM_RES, n),
    };
  }

  // type-adaptive activity tiles (same numbers as card, fuller)
  function statsTiles(c) {
    if (c.type === 'lpr') return [
      { v: c.stats.vehiclesToday, l: 'รถผ่านวันนี้', cls: 'warn' },
      { v: c.stats.eventsToday,   l: 'Events',       cls: 'dim' },
    ];
    if (c.type === 'face') return [
      { v: c.stats.facesToday,                      l: 'ใบหน้าวันนี้', cls: 'purple' },
      { v: c.stats.facesKnown,                      l: 'รู้จัก',       cls: 'ok' },
      { v: c.stats.facesToday - c.stats.facesKnown, l: 'ไม่รู้จัก',    cls: 'dim' },
      { v: c.stats.facesSuspect,                    l: 'Watchlist',    cls: 'bad' },
    ];
    return [
      { v: c.stats.eventsToday, l: 'Events', cls: 'dim' },
      { v: c.stats.peopleToday, l: 'คน',     cls: 'ok' },
    ];
  }

  function openCamModal(c) {
    const s = siteObj(c.site);
    const d = camDetail(c);
    const view = VIEW_ACTION[c.type] || VIEW_ACTION.standard;
    const tiles = statsTiles(c).map(t =>
      `<div class="cm-tile"><div class="cm-tile-v ${t.cls}">${t.v.toLocaleString()}</div><div class="cm-tile-l">${t.l}</div></div>`
    ).join('');
    $('camModalBody').innerHTML = `
      <div class="cm-head">
        <span class="status-dot ${c.status}"></span>
        <span class="cm-title">${c.location}</span>
        <span class="cm-id">${c.id}</span>
      </div>
      <div class="cm-breadcrumb">
        <span class="bc-dot" style="background:${s.color}"></span>
        ${s.name}&nbsp;›&nbsp;${c.group}
      </div>
      ${buildPreview(c)}
      <div class="cm-box">
        <span class="cm-cap">กิจกรรมวันนี้ · 00:00–ปัจจุบัน</span>
        <div class="cm-tiles">${tiles}</div>
      </div>
      <div class="cm-box">
        <span class="cm-cap">รายละเอียดกล้อง</span>
        <div class="cm-data">
          <div class="cm-drow"><span class="cm-dk">Vendor</span><span class="cm-dv">${VENDOR_LABEL[c.vendor] || c.vendor}</span></div>
          <div class="cm-drow"><span class="cm-dk">ประเภท</span><span class="cm-dv">${TYPE_LABEL[c.type] || c.type}</span></div>
          <div class="cm-drow"><span class="cm-dk">รุ่น</span><span class="cm-dv">${d.model}</span></div>
          <div class="cm-drow"><span class="cm-dk">IP Address</span><span class="cm-dv">${d.ip}</span></div>
          <div class="cm-drow"><span class="cm-dk">ความละเอียด</span><span class="cm-dv">${d.res}</span></div>
          <div class="cm-drow"><span class="cm-dk">สถานะ</span><span class="cm-dv"><span class="status-dot ${c.status}"></span>&ensp;${STATUS_LBL[c.status]}</span></div>
          <div class="cm-drow"><span class="cm-dk">เห็นล่าสุด</span><span class="cm-dv">${relTime(c.lastSec)}</span></div>
        </div>
      </div>
      ${recBox(c)}
      <div class="cm-foot">
        <button class="cm-view-btn" id="cmViewBtn">${ICON_EXT}&ensp;${view.label}</button>
      </div>
    `;
    $('camModal').style.display = 'flex';
    $('cmViewBtn').addEventListener('click', () =>
      showToast(`${ICON_EXT}<span>(เดโม่) จะลิงก์ไป <strong>${view.dest}</strong> · กรองเฉพาะ <strong>${c.id}</strong> · ช่วงวันนี้ 00:00–ปัจจุบัน</span>`)
    );
  }
  function closeCamModal() { $('camModal').style.display = 'none'; }

  // demo toast (real system navigates via drillTo / showPage)
  let _toastTimer = null;
  function showToast(html) {
    let t = $('cmToast');
    if (!t) { t = el('div', 'cm-toast'); t.id = 'cmToast'; document.body.appendChild(t); }
    t.innerHTML = html;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
  }

  // ─── Render: Pagination ────────────────────────────────────
  function renderPager(total) {
    const pages = Math.ceil(total / PER);
    const nav   = $('pager');
    nav.innerHTML = '';
    if (pages <= 1) return;

    const addBtn = (label, p, disabled, active) => {
      const btn = el('button');
      btn.innerHTML = label;
      if (active)   btn.classList.add('cur');
      btn.disabled = disabled;
      if (!disabled && !active) btn.addEventListener('click', () => { page = p; render(); });
      nav.appendChild(btn);
    };

    const addEllipsis = () => {
      const sp = el('span', 'ellipsis'); sp.textContent = '…'; nav.appendChild(sp);
    };

    addBtn('&larr;', page - 1, page === 1, false);

    // Smart page number list with ellipsis
    const shown = new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter(p => p >= 1 && p <= pages));
    let prev = 0;
    [...shown].sort((a, b) => a - b).forEach(p => {
      if (prev && p - prev > 1) addEllipsis();
      addBtn(p, p, false, p === page);
      prev = p;
    });

    addBtn('&rarr;', page + 1, page === pages, false);
  }

  // ─── Main render ───────────────────────────────────────────
  function render() {
    const allowed = allowedSites();
    const allForSite = CAMS.filter(c => allowed.includes(c.site));
    renderSummary(allForSite);
    renderTabs();

    // Group filter based on visible cameras (before status/type/vendor/q filter)
    const siteFiltered = allForSite.filter(c => site === 'all' || c.site === site);
    renderGroupFilter(siteFiltered);

    const list  = filtered();
    const total = list.length;
    $('count').textContent = `${total} กล้อง`;

    const start = (page - 1) * PER;
    const slice = list.slice(start, start + PER);

    const grid = $('camGrid');
    grid.innerHTML = '';
    if (!slice.length) {
      const empty = el('div', 'empty');
      empty.textContent = 'ไม่พบกล้องที่ตรงกับเงื่อนไข';
      grid.appendChild(empty);
    } else {
      slice.forEach(c => grid.appendChild(renderCard(c)));
    }

    renderPager(total);
  }

  // ─── Event bindings ────────────────────────────────────────
  const refilter = () => { page = 1; render(); };
  $('roleSwitch').addEventListener('change', e => {
    role = e.target.value;
    const allowed = allowedSites();
    site = allowed.length === 1 ? allowed[0] : 'all';
    page = 1;
    render();
  });
  $('q').addEventListener('input', refilter);
  $('fGroup').addEventListener('change', refilter);
  $('fVendor').addEventListener('change', refilter);
  $('fType').addEventListener('change', refilter);
  $('fStatus').addEventListener('change', refilter);

  // ─── Camera modal close (bound once) ───────────────────────
  $('camModalX').addEventListener('click', closeCamModal);
  $('camModal').addEventListener('click', e => { if (e.target === $('camModal')) closeCamModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCamModal(); });

  // ─── Theme toggle ──────────────────────────────────────────
  const themeBtn = el('button', 'theme-btn');
  themeBtn.title = 'สลับ Dark / Light';
  const ICON_SUN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
  const ICON_MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  let isDark = true;
  themeBtn.innerHTML = ICON_SUN;  // show sun = "switch to light"
  themeBtn.addEventListener('click', () => {
    isDark = !isDark;
    document.documentElement.dataset.theme = isDark ? '' : 'light';
    themeBtn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
  });

  // ─── Init ──────────────────────────────────────────────────
  render();
  // inject theme button (page-h-right is a class in static HTML, not an id)
  const headerRight = document.querySelector('.page-h-right');
  if (headerRight) headerRight.prepend(themeBtn);
})();
