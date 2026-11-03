// ============================================================
// Vigil Platform — Reports Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// Phase 5 — Reports built on Stats v2 endpoints (categories / timeline /
// breakdown / per-camera / heatmap / quiet-cameras).
// 4 report types share the same renderer; only the [from,to] window differs.

function onReportTypeChange() {
  const sel = document.getElementById('reportType');
  if (!sel) return;
  const type = sel.value;
  const fields = ['Daily', 'Weekly', 'Monthly', 'Custom', 'Health'];
  fields.forEach(f => {
    const el = document.getElementById('reportField' + f);
    if (el) el.classList.toggle('hidden', f.toLowerCase() !== type);
  });
  // Ph.3 — health vs analytics: swap button group + hide title/category
  const isHealth = type === 'health';
  document.getElementById('reportBtnsAnalytics')?.classList.toggle('hidden', isHealth);
  document.getElementById('reportBtnsHealth')?.classList.toggle('hidden', !isHealth);
  document.getElementById('reportTitleGroup')?.classList.toggle('hidden', isHealth);
  document.getElementById('reportCategoryGroup')?.classList.toggle('hidden', isHealth);
  if (isHealth) {
    loadHealthRecipients();           // refresh roster each switch
    _hrToggleCustomRange();           // ensure from/to fields toggle is in sync
  }

  // Sensible defaults when switching type
  const today = new Date();
  if (type === 'daily'   && !getDtValue('reportDate'))     setDtValue('reportDate',     today);
  if (type === 'weekly'  && !getDtValue('reportWeekDate')) setDtValue('reportWeekDate', today);
  if (type === 'monthly' && !getDtValue('reportMonth'))    setDtValue('reportMonth',    today);
  if (type === 'custom') {
    const yest = new Date(today.getTime() - 24 * 3600e3);
    if (!getDtValue('reportFrom')) setDtValue('reportFrom', yest);
    if (!getDtValue('reportTo'))   setDtValue('reportTo',   today);
  }

  _refreshReportRangeNote();
}

// Ph.3 — Health report: preview + download + send-now (with range + recipients)

function _getHealthSections() {
  return [...document.querySelectorAll('.hrPreviewSec:checked')].map(c => c.value);
}

function _normalizeHealthSectionsForUi(sections) {
  const raw = Array.isArray(sections) && sections.length ? sections : null;
  if (!raw) return null;
  const out = [];
  raw.forEach(s => {
    if (s === 'cameras') out.push('camera_status', 'camera_uptime');
    else out.push(s);
  });
  return new Set(out);
}

// Restore the saved analytics option set from section_config (2026-08-23).
// Distinguishes
// between "absent" (null/undefined/{}; render everything, legacy) and "empty array" ([]
// tick nothing). Return { domains, kpis, catsort, title } or null if config is absent.
function _normalizeAnalyticsOptsForUi(section_config) {
  if (!section_config || typeof section_config !== 'object') return null;
  // Legacy rows (saved before this feature) have section_config=null or {}.
  // We want to render everything for backward compat, which means:
  // domains = null (render all), kpis = null (render all), secs = null (render all), catsort = 'count', title = '', tod = undefined.
  if (!section_config.domains && !section_config.kpis && !section_config.secs && !section_config.catsort && !section_config.title
      && !section_config.cats && !section_config.cats_hide && !section_config.tod
      && section_config.showDelta === undefined && section_config.showPct === undefined) return null;
  return {
    domains: Array.isArray(section_config.domains) ? new Set(section_config.domains) : null,
    kpis:    Array.isArray(section_config.kpis)    ? new Set(section_config.kpis)    : null,
    secs:    Array.isArray(section_config.secs)    ? new Set(section_config.secs)    : null,
    catsort: section_config.catsort || 'count',
    title:   section_config.title || '',
    // cats = null แปลว่า "ทุกหมวด" ไม่ใช่ "ไม่เอาสักหมวด" — ตารางเก่าที่บันทึกไว้
    // ก่อนมีตัวเลือกนี้จึงยังส่งรายงานครบเหมือนเดิม
    // cats_hide = รูปแบบปัจจุบัน · cats = รูปแบบเก่าก่อน 2026-08-25 (รายชื่อที่เลือก)
    catsHide:  Array.isArray(section_config.cats_hide) ? new Set(section_config.cats_hide) : null,
    catsShownLegacy: Array.isArray(section_config.cats) ? new Set(section_config.cats) : null,
    showDelta: section_config.showDelta !== false,
    showPct: section_config.showPct !== false,
    tod: (section_config.tod && section_config.tod.from && section_config.tod.to) ? section_config.tod : null,
  };
}

// Custom from/to ISO from the health date row (whole-day BKK boundaries via the
// operator's local tz), or null if not in custom mode / dates unset.
function _hrCustomRange() {
  if (_hrRange !== 'custom') return null;
  const f = getDtValue('rptHrFrom'), t = getDtValue('rptHrTo');
  if (!f || !t) return null;
  return { from: new Date(f + 'T00:00:00').toISOString(), to: new Date(t + 'T23:59:59.999').toISOString() };
}

// Build the query-string fragment for range (preset or custom from+to)
function _buildHealthRangeParams() {
  const c = _hrCustomRange();
  return c ? `range=custom&from=${encodeURIComponent(c.from)}&to=${encodeURIComponent(c.to)}`
           : `range=${encodeURIComponent(_hrRange || '24h')}`;
}

// POST-body equivalent of the query-string fragment above
function _buildHealthRangeBody() {
  const c = _hrCustomRange();
  return c ? { from: c.from, to: c.to, label: I18N.t('rep.typeCustom') } : { preset: _hrRange || '24h' };
}

// Auto-fill the health date row from a rolling preset (24h/7d/30d → now-N..now)
function _hrAutoFill(range) {
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 1;
  setDtValue('rptHrFrom', new Date(now.getTime() - days * 86400e3));
  setDtValue('rptHrTo', now);
}

// Toggle the custom from/to fields based on preset selection
function _hrToggleCustomRange() {
  const isCustom = document.getElementById('hrRangePreset')?.value === 'custom';
  const el = document.getElementById('hrCustomRangeFields');
  if (el) el.classList.toggle('hidden', !isCustom);
  // Sensible defaults: from=now-24h, to=now
  if (isCustom) {
    const now = new Date();
    const yest = new Date(now.getTime() - 24 * 3600e3);
    if (!getDtValue('hrRangeFrom')) setDtValue('hrRangeFrom', yest);
    if (!getDtValue('hrRangeTo'))   setDtValue('hrRangeTo',   now);
  }
}

// Load LINE recipients into the picker (re-render on every type=health switch
// so a roster change in Settings is reflected without a page reload).
async function loadHealthRecipients() {
  const el = document.getElementById('hrRecipientsList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/line-config`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
    const enabled = roster.filter(r => r.enabled);
    if (!enabled.length) {
      el.innerHTML = `<div style="color:var(--warn);padding:6px">${escapeHtml(I18N.t('hr.noRecipients'))}</div>`;
      return;
    }
    el.innerHTML = enabled.map(r => {
      const icon = r.type === 'group'
        ? '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-users"/></svg>'
        : r.type === 'room'
        ? '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-map"/></svg>'
        : '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-face"/></svg>';
      const idShort = escapeHtml((r.id || '').slice(0, 8) + '…');
      return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
        <input type="checkbox" class="hrRecipCheck" value="${escapeHtml(r.id)}" checked data-change="updateHrSendBtn">
        <span style="flex:1">${icon} ${escapeHtml(r.name || r.id)} <span style="color:var(--text-secondary);font-size:10px">${idShort}</span></span>
      </label>`;
    }).join('');
    _updateHealthSendBtnLabel();
  } catch (e) {
    el.innerHTML = `<div style="color:var(--status-bad);padding:6px">${escapeHtml(I18N.t('hr.recipLoadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

function _updateHealthSendBtnLabel() {
  const n = document.querySelectorAll('.hrRecipCheck:checked').length;
  const btns = document.querySelectorAll('#hrSendNowBtn');
  btns.forEach(b => {
    b.textContent = I18N.t('hr.btnSendNowN').replace('{n}', n);
    b.disabled = n === 0;
    b.style.opacity = n === 0 ? 0.5 : 1;
    b.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
  });
}

function _getHealthRecipientIds() {
  return [...document.querySelectorAll('.hrRecipCheck:checked')].map(c => c.value);
}

// The SITE bar at the top of the Reports page already drives the Events, Face
// and LPR tabs. Health was the only one ignoring it, so picking "HatYai" left
// the health report showing all 143 cameras (backend gained site_id 2026-08-03;
// this is the caller catching up).
function _hrSiteQs() { return _rptActiveSiteId ? `&site_id=${_rptActiveSiteId}` : ''; }

async function previewHealthReport() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  const preview = document.getElementById('hrPreviewDoc');
  preview.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  const url = `${API}/api/health/report/preview?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}${_hrSiteQs()}&t=${Date.now()}`;
  const img = new Image();
  img.onload = () => {
    preview.innerHTML = '';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.borderRadius = '6px';
    img.style.border = '1px solid var(--border-hairline)';
    preview.appendChild(img);
  };
  img.onerror = () => { preview.innerHTML = `<div style="color:var(--status-bad);padding:30px;text-align:center">${escapeHtml(I18N.t('hr.previewFailed'))}</div>`; };
  img.src = url;
}

function downloadHealthPng() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  window.location = `${API}/api/health/report/preview?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&title=${encodeURIComponent(document.getElementById('hrTitle')?.value.trim() || '')}${_hrSiteQs()}&download=1`;
}

function downloadHealthPdf() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  window.location = `${API}/api/health/report/pdf?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&title=${encodeURIComponent(document.getElementById('hrTitle')?.value.trim() || '')}${_hrSiteQs()}`;
}

function _hrDownloadByFmt() {
  if (_hrFmt === 'pdf') downloadHealthPdf();
  else downloadHealthPng();
}

async function sendHealthReportNow() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const range = _buildHealthRangeBody();
  if (range === null) { alert(I18N.t('hr.needCustomRange')); return; }
  const recipients = _getHealthRecipientIds();
  if (recipients.length === 0) { alert(I18N.t('hr.needRecipient')); return; }
  if (!confirm(I18N.t('hr.confirmSendN').replace('{n}', recipients.length))) return;
  try {
    const res = await fetch(`${API}/api/health/report/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections, range, recipients, lang: (I18N.getLang ? I18N.getLang() : 'th'), site_id: _rptActiveSiteId || null }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    if (j.success) {
      alert(I18N.t('hr.sendOk').replace('{n}', j.sent_count).replace('{t}', j.total_recipients));
    } else {
      alert(I18N.t('hr.sendFailed') + (j.error || 'unknown'));
    }
  } catch (e) { alert(I18N.t('hr.sendFailed') + e.message); }
}

function _computeReportRange() {
  const loc = ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB';
  const fStr = getDtValue('rbFrom');
  const tStr = getDtValue('rbTo');
  if (!fStr || !tStr) return null;
  const from = new Date(fStr + 'T00:00:00');
  const to   = new Date(tStr + 'T23:59:59.999');
  if (!(from < to)) return null;
  let label = `${from.toLocaleDateString(loc)} – ${to.toLocaleDateString(loc)}`;
  const tod = _rptTod();
  if (tod && !tod.error) {
    label += ` (${tod.from}–${tod.to})`;
  }
  return { type: _rptBuildType || 'custom', from, to, label };
}

function _refreshReportRangeNote() {
  const r = _computeReportRange();
  const note = document.getElementById('reportRangeNote');
  if (!note) return;
  if (!r) { note.innerHTML = escapeHtml(I18N.t('rep.noRangeSelected')); return; }
  const days = ((r.to - r.from) / 86400e3).toFixed(1);
  note.innerHTML = I18N.t('rep.rangeNote')
    .replace('{label}', escapeHtml(r.label)).replace('{days}', days);
}

// ตัวเลือกเฉพาะหน้ารายงาน (เจ้าของสั่ง 2026-08-21) — เลือกครั้งต่อครั้ง ไม่ได้เก็บไว้
// ค่าเดินทางไปถึง PDF/PNG ผ่าน query param เส้นทางเดียวกับ domains
// รายงานสรุปใช้เทมเพลตของตัวเอง (buildSummaryHtml) — ตัวเลือกของรายงานปกติอย่าง
// การ์ด KPI / หัวข้อที่แสดง / หมวดที่แสดง / คอลัมน์เทียบ / การเรียง / รูปแบบภาพ
// ไม่มีผลกับมันเลย · ซ่อนทิ้งดีกว่าปล่อยให้ติ๊กแล้วไม่เกิดอะไรขึ้น (เจ้าของทัก 2026-09-04)
// สิ่งที่ยังมีผลกับรายงานสรุป: ไซต์ · กล้อง · ช่วงเวลาในวัน · % บนโดนัท · หัวข้อรายงาน
const _RPT_SUMMARY_HIDE = {
  build:    ['rbKpiWrap', 'rbSecWrap', 'rbCatWrap', 'rbShowDeltaWrap', 'rbCatSortWrap'],
  schedule: ['rsKpiWrap', 'rsSecWrap', 'rsCatWrap', 'rsShowDeltaWrap', 'rsCatSortWrap',
             'rsDomainsWrap', 'rsLayoutGroup'],
};
function _rptToggleSummaryFields(where, isSummary) {
  (_RPT_SUMMARY_HIDE[where] || []).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = isSummary ? 'none' : '';
  });
}
let _rptCatSort = 'count';
// ช่วงเวลาในวันเป็น dropdown ไม่ใช่ <input type="time"> — Chrome เลือกรูปแบบ 12/24 ชม.
// จาก locale ของ "เบราว์เซอร์" บังคับด้วย attribute lang ไม่ได้ (ทดสอบแล้ว 2026-09-04:
// lang=en-GB / th-TH ยังขึ้น AM/PM ทั้งคู่บน locale en-US) · เจ้าของสั่งให้เป็น 24 ชม.
// เสมอเพื่อกันกรอกพลาด · ผลพลอยได้: เลือกนอกขั้น 30 นาทีไม่ได้เลยตั้งแต่ต้นทาง
const _TOD_SLOTS = (() => {
  const out = [];
  for (let h = 0; h < 24; h++) for (const m of ['00', '30']) out.push(`${String(h).padStart(2, '0')}:${m}`);
  return out;
})();
function _fillTodSelects() {
  ['rbTodFrom', 'rbTodTo', 'rsTodFrom', 'rsTodTo'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.options.length) return;      // เติมครั้งเดียวพอ ไม่ล้างค่าที่เลือกไว้
    el.innerHTML = '<option value="">--:--</option>'
      + _TOD_SLOTS.map((t) => `<option value="${t}">${t}</option>`).join('');
  });
}
// หัวข้อนี้เปิดอยู่ไหม — secs ที่ _rptOpts() คืนมาเป็น Array (null = แสดงครบ)
// ส่วนฝั่ง template เป็น Set · รับทั้งสองแบบไว้ กันเรียก .has() ผิดชนิดอีก
function _secOn(secs, key) {
  if (!secs) return true;
  return typeof secs.has === 'function' ? secs.has(key) : secs.includes(key);
}
function _rptOpts() {
  const boxes = [...document.querySelectorAll('#rbKpiBar input[data-kpi]')];
  const secBoxes = [...document.querySelectorAll('#rbSecBar input[data-sec]')];
  const catBoxes = [...document.querySelectorAll('#rbCatPick input[data-cat]')];
  const hiddenCats = catBoxes.filter(b => !b.checked).map(b => parseInt(b.dataset.cat, 10));
  return {
    // ยังไม่ทันเรนเดอร์กล่องตัวเลือก = แสดงครบทุกใบ (พฤติกรรมเดิม) ไม่ใช่ซ่อนหมด
    kpis: boxes.length ? boxes.filter(b => b.checked).map(b => b.dataset.kpi) : null,
    secs: secBoxes.length ? secBoxes.filter(b => b.checked).map(b => b.dataset.sec) : null,
    catsort: _rptCatSort,
    // เก็บ "หมวดที่ติ๊กออก" ไม่ใช่ "หมวดที่เลือก" — หมวดที่สร้างใหม่ทีหลังจะได้โผล่
    // ในรายงานเอง แทนที่จะหายเงียบ ๆ เพราะไม่อยู่ในรายชื่อที่บันทึกไว้
    // ติ๊กครบ = null จะได้ไม่ต้องพก id ไปกับ URL โดยไม่จำเป็น
    catsHide: hiddenCats.length ? hiddenCats : null,
    showDelta: document.getElementById('rbShowDelta')?.checked !== false,
    showPct: document.getElementById('rbShowPct')?.checked !== false,
  };
}

// สร้าง checkbox รายหมวดจากข้อมูลที่โหลดมาจริง — หมวดต่างกันตามไซต์ จึง hardcode ไม่ได้
// เก็บสิ่งที่เคยติ๊กไว้ข้ามการโหลดใหม่ ถ้าหมวดนั้นยังมีอยู่
function _rptRenderCatPicker(cats) {
  const wrap = document.getElementById('rbCatPick');
  if (!wrap) return;
  const rows = (cats || []).slice();
  if (!rows.length) { wrap.innerHTML = ''; return; }
  const prev = new Set([...wrap.querySelectorAll('input[data-cat]')]
    .filter(b => b.checked).map(b => parseInt(b.dataset.cat, 10)));
  const hadAny = wrap.querySelector('input[data-cat]') != null;
  wrap.innerHTML = rows.map(c => {
    const on = hadAny ? prev.has(c.id) : true;   // ครั้งแรก = ติ๊กครบ
    return `<label class="rb-dom"><input type="checkbox" data-cat="${c.id}"${on ? ' checked' : ''}>` +
      `<span class="rb-dom-dot" style="background:${escapeHtml(c.color || 'var(--accent)')}"></span>` +
      `<span>${escapeHtml(c.name || '')}</span></label>`;
  }).join('');
}
// ── ชื่อหัวข้อรายงานที่ตั้งเองได้ (เจ้าของสั่ง 2026-09-10) ─────────────────────
// ค่ากลางทั้งระบบ เก็บที่ system_settings.report_section_titles (migration 224)
// ชื่อเดียวใช้ 3 ที่: รายการติ๊กหน้านี้ · รายการติ๊กหน้ารายงานอัตโนมัติ · หัวข้อในไฟล์รายงาน
// เขียนได้เฉพาะ admin (requireAdminForWrites ฝั่ง server) ปุ่มดินสอจึงเป็น .admin-only
// สองรายการนั้นเป็น HTML คนละก้อนกันมาแต่เดิม (index.html #rbSecBar / #rsSecWrap)
// จึงเดินหาป้ายจาก DOM แทนการรื้อมาสร้างใหม่ — โค้ดที่อ่าน input สองก้อนนั้นยังมีอยู่
const _RPT_SEC_LABEL_SEL = '#rbSecBar label.rb-dom, #rsSecWrap label.rb-dom';

function _rptSecKeyOf(label) {
  const inp = label.querySelector('input[type="checkbox"]');
  return inp ? (inp.dataset.sec || inp.value || '') : '';
}

// เขียนชื่อลงป้ายที่มีอยู่ + แปะปุ่มดินสอครั้งแรกที่เรียก
// ⚠️ ตั้งชื่อเองแล้วต้อง **ถอด data-i18n ออก** ด้วย ไม่งั้น I18N.apply() ตอนสลับภาษา
//    จะเขียนทับชื่อที่ตั้งเองกลับเป็นค่าเริ่มต้นเงียบ ๆ (คืนค่าเริ่มต้น = ใส่ attribute กลับ)
function _rptApplySecLabels() {
  if (typeof ReportTemplate === 'undefined') return;
  const custom = ReportTemplate.getSectionTitles();
  document.querySelectorAll(_RPT_SEC_LABEL_SEL).forEach((lb) => {
    const key = _rptSecKeyOf(lb);
    const def = ReportTemplate.SECTION_TITLE_DEFS[key];
    if (!def) return;
    const span = lb.querySelector('span[data-sec-label], span[data-i18n]');
    if (!span) return;
    span.setAttribute('data-sec-label', key);
    if (custom[key]) {
      span.removeAttribute('data-i18n');
      span.textContent = custom[key];
    } else {
      span.setAttribute('data-i18n', def.labelKey);
      span.textContent = I18N.t(def.labelKey);
    }
    if (!lb.querySelector('[data-sec-edit]')) {
      lb.insertAdjacentHTML('beforeend',
        `<button type="button" class="rb-sec-edit admin-only" data-sec-edit="${escapeHtml(key)}"`
        + ` title="${escapeHtml(I18N.t('rpt.secRename', 'แก้ชื่อหัวข้อ'))}">`
        + '<svg aria-hidden="true" width="11" height="11"><use href="#icon-edit"/></svg></button>');
    }
  });
}

async function _rptSaveSecTitles(next) {
  const r = await fetch(`${API}/api/settings/report_section_titles`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: JSON.stringify(next) }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    showToast({ icon: '!', title: I18N.t('rpt.secRenameFailed', 'บันทึกชื่อหัวข้อไม่สำเร็จ'),
                sub: e.error || ('HTTP ' + r.status) });
    return false;
  }
  ReportTemplate.setSectionTitles(next);
  _rptApplySecLabels();
  return true;
}

// แก้ชื่อในที่ — เปลี่ยนป้ายเป็นช่องกรอกชั่วคราว Enter=บันทึก Esc=ยกเลิก blur=บันทึก
// ปุ่มอยู่ใน <label> จึงต้อง preventDefault ตอนคลิก ไม่งั้นไปติ๊ก checkbox แทน
function _rptEditSecTitle(btn) {
  const key  = btn.dataset.secEdit;
  const lb   = btn.closest('label.rb-dom');
  const span = lb && lb.querySelector('[data-sec-label]');
  if (!span || lb.querySelector('.rb-sec-input')) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'rb-sec-input';
  inp.maxLength = 60;
  // ตั้งไว้แล้ว = ค่าที่ตั้ง · ยังไม่ตั้ง = หัวข้อที่ออกในรายงานจริง ไม่ใช่ป้ายในรายการติ๊ก
  // (สองคำนี้ต่างกันมาแต่เดิม สิ่งที่แก้คือหัวข้อในรายงาน จึงต้องโชว์ค่านั้น)
  inp.value = ReportTemplate.getSectionTitles()[key] || ReportTemplate.secTitle(key);
  span.style.display = 'none';
  btn.style.display = 'none';
  span.insertAdjacentElement('afterend', inp);
  inp.focus();
  inp.select();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    inp.remove();
    span.style.display = '';
    btn.style.display = '';
  };
  const commit = async () => {
    if (closed) return;
    const v = inp.value.trim();
    close();
    const cur  = ReportTemplate.getSectionTitles();
    const def  = ReportTemplate.SECTION_TITLE_DEFS[key];
    // ว่าง หรือ พิมพ์ตรงกับค่าเริ่มต้น = คืนค่าเริ่มต้น (ไม่เก็บ) — เก็บไว้จะทำให้
    // หัวข้อค้างเป็นภาษาเดียวตลอด ทั้งที่ผู้ใช้ไม่ได้ตั้งใจตั้งชื่อเอง
    const next = Object.assign({}, cur);
    if (!v || v === I18N.t(def.titleKey)) delete next[key];
    else next[key] = v;
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    // ตัวอย่างรายงานวาดใหม่ให้เห็นชื่อใหม่ทันที — ยังไม่เคยกดสร้าง (_reportData ว่าง)
    // ฟังก์ชันนี้จะคืนค่าออกไปเอง ไม่ต้องเช็คซ้ำที่นี่
    if (await _rptSaveSecTitles(next)) renderReportPreviewV2();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  inp.addEventListener('blur', commit);
  // คลิกในช่องกรอกไม่ควรไปสลับ checkbox ของ label ที่ครอบอยู่
  inp.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
}

function _rptBindSecTitleEdit() {
  ['rbSecBar', 'rsSecWrap'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sec-edit]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      _rptEditSecTitle(btn);
    });
  });
}

function _rptBindOptionBars() {
  document.getElementById('rbKpiBar')?.addEventListener('change', (e) => {
    if (e.target.matches('input[data-kpi]')) renderReportPreviewV2();
  });
  document.getElementById('rbSecBar')?.addEventListener('change', (e) => {
    if (e.target.matches('input[data-sec]')) renderReportPreviewV2();
  });
  // เปลี่ยนจาก segmented 2 ปุ่มเป็น select เมื่อมีตัวเลือกที่ 3 (2026-08-21)
  document.getElementById('rbCatSortSel')?.addEventListener('change', (e) => {
    _rptCatSort = e.target.value;
    renderReportPreviewV2();
  });
  document.getElementById('rbCatPick')?.addEventListener('change', (e) => {
    if (e.target.matches('input[data-cat]')) _rptRefetchFiltered();
  });
  document.getElementById('rbShowDelta')?.addEventListener('change', renderReportPreviewV2);
  document.getElementById('rbShowPct')?.addEventListener('change', renderReportPreviewV2);
  document.getElementById('rbCatAll')?.addEventListener('click', () => {
    document.querySelectorAll('#rbCatPick input[data-cat]').forEach(c => { c.checked = true; });
    _rptRefetchFiltered();
  });
  document.getElementById('rbCatNone')?.addEventListener('click', () => {
    document.querySelectorAll('#rbCatPick input[data-cat]').forEach(c => { c.checked = false; });
    _rptRefetchFiltered();
  });
}

// Helper: read tod_from/tod_to from UI elements, validate, return { from, to } or { error: true }
// Pass element IDs; if not provided, defaults to manual report IDs (rbTodFrom/rbTodTo)
function _validateTod(fromElemId = 'rbTodFrom', toElemId = 'rbTodTo') {
  const todFrom = document.getElementById(fromElemId)?.value || '';
  const todTo   = document.getElementById(toElemId)?.value || '';
  // Both empty => no filter
  if (!todFrom && !todTo) return null;
  // One empty or from >= to or minutes not 00/30 => error
  if (!todFrom || !todTo) return { error: true };
  if (todFrom >= todTo) return { error: true };
  const timeRegex = /^\d{2}:\d{2}$/;
  if (!timeRegex.test(todFrom) || !timeRegex.test(todTo)) return { error: true };
  // Validate minutes are 00 or 30
  const [hf, mf] = todFrom.split(':');
  const [ht, mt] = todTo.split(':');
  if (mf !== '00' && mf !== '30') return { error: true };
  if (mt !== '00' && mt !== '30') return { error: true };
  return { from: todFrom, to: todTo };
}

// Backward-compat wrapper for manual report page
function _rptTod() {
  return _validateTod('rbTodFrom', 'rbTodTo');
}

let _reportData = null;
let _reportFetchCtx = null;
let _rptRefetchSeq = 0;

async function updateReportPreview() {
  const range = _computeReportRange();
  if (!range) { alert(I18N.t('rep.pickFullRange')); return; }
  const tod = _rptTod();
  if (tod && tod.error) { alert(I18N.t('rep.todInvalid')); return; }
  const title = (document.getElementById('rbTitle')?.value || document.getElementById('reportTitle')?.value) || I18N.t('rep.fallbackTitle');
  const catId = '';
  const camIds = getActiveGroupCameraIds ? getActiveGroupCameraIds() : [];
  const camParam = camIds.length ? `&cameras=${encodeURIComponent(camIds.join(','))}` : '';

  const fromIso = range.from.toISOString();
  const toIso   = range.to.toISOString();
  const catParam = '';
  const checked = new Set([...document.querySelectorAll('.rb-domains input:checked')].map(c => c.dataset.dom).filter(Boolean));
  const siteParam = _rptActiveSiteId ? `&site_id=${_rptActiveSiteId}` : '';
  const todParam = tod ? `&tod_from=${encodeURIComponent(tod.from)}&tod_to=${encodeURIComponent(tod.to)}` : '';

  const preview = document.getElementById('reportPreview');
  if (checked.size === 0) {
    preview.innerHTML = `<div style="text-align:center;padding:80px;color:var(--text-secondary)">${escapeHtml(I18N.t('rpt.pickOneSection'))}</div>`;
    return;
  }
  preview.innerHTML = `<div style="text-align:center;padding:80px;color:var(--text-secondary)">${escapeHtml(I18N.t('rep.loadingData'))}</div>`;

  try {
    // CR.5 — Summary type: compute three time windows and fetch each separately
    if (_rptBuildType === 'summary') {
      const anchor = new Date(range.from);  // from is already the anchor (yesterday)
      const windows = ReportTemplate.summaryWindows(anchor);
      const anchorLabel = anchor.toLocaleDateString(((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB');
      const todLabel = tod ? `${tod.from} – ${tod.to}` : '';

      const [dayData, weekData, monthData, weekTl] = await Promise.all([
        fetch(`${API}/api/stats/categories?from=${windows.day.from}&to=${windows.day.to}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : { categories: [] }),
        fetch(`${API}/api/stats/categories?from=${windows.week.from}&to=${windows.week.to}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : { categories: [] }),
        fetch(`${API}/api/stats/categories?from=${windows.month.from}&to=${windows.month.to}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : { categories: [] }),
        fetch(`${API}/api/stats/timeline-by-category?from=${windows.week.from}&to=${windows.week.to}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : { series: [], buckets: [] }),
      ]);

      const monthLabel = new Date(windows.month.from).toLocaleDateString(
        ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB',
        { month: 'long', year: 'numeric' });
      const sum = { anchorLabel, todLabel, monthLabel, title,
                    day: dayData, week: weekData, month: monthData, tl: weekTl };
      _reportData = { range, title, summaryMode: true, sum, domains: checked };
      _reportFetchCtx = { fromIso, toIso, camParam, siteParam, todParam, domains: [...checked].join(',') };
    } else {
      // top-rules ถูกถอดออก 2026-08-21 — หัวข้อ "Rule ที่ทำงานบ่อยสุด" ไม่มีในรายงานแล้ว
      // per-camera-counts ถูกถอดออก 2026-08-21 — ดูหมายเหตุใน report-template.js
      let cats, tl, brk, heat, quiet, cov, ev, daily7Tl = null, monthlyTl = null;

      // CR.8 — Check if daily7 or monthly sections are enabled
      const opts = _rptOpts();
      // ⚠️ _rptOpts() คืน secs เป็น **Array** (ไม่ใช่ Set — Set มีเฉพาะฝั่ง
      //    normalizeOpts ของ template) · เรียก .has() ตรง ๆ = TypeError ทั้งหน้า
      const wantDaily7 = _secOn(opts.secs, 'daily7');
      const wantMonthly = _secOn(opts.secs, 'monthly');

      // Compute windows for daily7 and monthly if needed
      let daily7Windows = null, monthlyWindows = null;
      if (wantDaily7 || wantMonthly) {
        const toDate = new Date(range.to);
        const anchorDate = new Date(toDate);
        anchorDate.setHours(0, 0, 0, 0);
        const windows = ReportTemplate.dailyWindows(anchorDate);
        daily7Windows = windows.daily7;
        monthlyWindows = windows.monthly;
      }

      const makeTlQ = (fromIso, toIso) => `from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}${camParam}${siteParam}${todParam}`;

      if (checked.has('events')) {
        [cats, tl, brk, heat, quiet, cov, ev, daily7Tl, monthlyTl] = await Promise.all([
          fetch(`${API}/api/stats/categories?from=${fromIso}&to=${toIso}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : { categories: [] }),
          fetch(`${API}/api/stats/timeline-by-category?from=${fromIso}&to=${toIso}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : { series: [] }),
          fetch(`${API}/api/stats/breakdown-v2?from=${fromIso}&to=${toIso}${camParam}${siteParam}${todParam}`).then(r => r.ok ? r.json() : []),
          fetch(`${API}/api/stats/heatmap?from=${fromIso}&to=${toIso}${camParam}${catParam}${siteParam}&domains=${[...checked].join(',')}${todParam}`).then(r => r.ok ? r.json() : { cells: [] }),
          fetch(`${API}/api/stats/quiet-cameras?since_hours=24${siteParam}`).then(r => r.ok ? r.json() : { cameras: [] }),
          // cov/ev ไม่ได้แสดงแล้ว (report-template E3) — เลิกดึง event-coverage/evidence ที่หนักและถ่วงทั้งรายงาน (audit · D9)
          Promise.resolve(null),
          Promise.resolve(null),
          checked.has('events') && wantDaily7 ? fetch(`${API}/api/stats/timeline-by-category?${makeTlQ(daily7Windows.from, daily7Windows.to)}`).then(r => r.ok ? r.json() : { series: [] }) : Promise.resolve(null),
          checked.has('events') && wantMonthly ? fetch(`${API}/api/stats/timeline-by-category?${makeTlQ(monthlyWindows.from, monthlyWindows.to)}`).then(r => r.ok ? r.json() : { series: [] }) : Promise.resolve(null),
        ]);
      }
      const [faceData, lprData, personData] = await Promise.all([
        checked.has('face')   ? fetch(`${API}/api/stats/face/report?period=custom&from=${fromIso}&to=${toIso}&min_score=80${siteParam}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
        checked.has('lpr')    ? fetch(`${API}/api/stats/lpr/report?period=custom&from=${fromIso}&to=${toIso}${siteParam}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
        checked.has('person') ? fetch(`${API}/api/appearances/stats?from=${fromIso}&to=${toIso}${siteParam}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      ]);
      _reportData = { range, title, cats, tl, brk, heat, quiet, cov, ev, domains: checked, faceData, lprData, personData, daily7Tl, monthlyTl, daily7Windows, monthlyWindows };
      // เก็บพารามิเตอร์ไว้ เพราะ /breakdown-v2 กับ /heatmap กรองหมวดที่ SQL
      // (แถวที่คืนมาไม่มี category_id ให้กรองฝั่ง client) พอผู้ใช้ติ๊กหมวดออก
      // จึงต้องดึงสองตัวนี้ใหม่ ไม่งั้นหน้าจอจะไม่ตรงกับ PDF/PNG ที่ส่งออกไป
      _reportFetchCtx = { fromIso, toIso, camParam, siteParam, todParam, domains: [...checked].join(',') };
    }
    // เก็บพารามิเตอร์ไว้ เพราะ /breakdown-v2 กับ /heatmap กรองหมวดที่ SQL
    // (แถวที่คืนมาไม่มี category_id ให้กรองฝั่ง client) พอผู้ใช้ติ๊กหมวดออก
    // จึงต้องดึงสองตัวนี้ใหม่ ไม่งั้นหน้าจอจะไม่ตรงกับ PDF/PNG ที่ส่งออกไป
    _reportFetchCtx = { fromIso, toIso, camParam, siteParam, todParam, domains: [...checked].join(',') };
    renderReportPreviewV2();
    // Mobile UX — once the preview lands, scroll the user to it.
    // Otherwise the form sidebar (stacked above the preview on phones)
    // eats the whole viewport and the operator doesn't realise the
    // report just rendered. No-op on wide screens where both panels
    // are visible side-by-side.
    if (window.matchMedia('(max-width: 768px)').matches) {
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    preview.innerHTML = `<div style="text-align:center;padding:80px;color:var(--status-bad)">${escapeHtml(I18N.t('rep.loadFailed'))}${escapeHtml(e.message)}</div>`;
  }
}

// Populate category filter once when first opening Reports page
async function initReportCategoryFilter() {
  const sel = document.getElementById('reportCategoryFilter');
  if (!sel || sel.options.length > 1) return;  // already populated
  try {
    const r = await fetch(`${API}/api/categories`);
    if (!r.ok) return;
    const cats = await r.json();
    sel.innerHTML = '<option value="">All categories</option>'
      + cats.map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  } catch {}
}

// Print-friendly preview built from Stats v2 data
// The report layout now lives in the shared dashboard/report-template.js
// (window.ReportTemplate) — used by BOTH this interactive page and the
// Puppeteer print page (report-print.html) so the "full" scheduled image
// is byte-for-byte the same report. See Phase 7.3.
// ดึง brk/heat ใหม่ตามหมวดที่ซ่อน แล้วค่อยวาด — ใช้ seq กันผลลัพธ์เก่ามาทับผลใหม่
// เมื่อผู้ใช้คลิกรัว ๆ (คำขอที่ยิงก่อนอาจกลับมาทีหลัง)
async function _rptRefetchFiltered() {
  const c = _reportFetchCtx;
  if (!c || !_reportData) { renderReportPreviewV2(); return; }
  const hide = _rptOpts().catsHide;
  const hideQ = hide && hide.length ? `&cats_hide=${hide.join(',')}` : '';
  const seq = ++_rptRefetchSeq;
  try {
    const [brk, heat] = await Promise.all([
      fetch(`${API}/api/stats/breakdown-v2?from=${c.fromIso}&to=${c.toIso}${c.camParam}${c.siteParam}${hideQ}${c.todParam || ''}`)
        .then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/stats/heatmap?from=${c.fromIso}&to=${c.toIso}${c.camParam}${c.siteParam}${hideQ}&domains=${c.domains}${c.todParam || ''}`)
        .then(r => r.ok ? r.json() : { cells: [] }),
    ]);
    if (seq !== _rptRefetchSeq) return;      // มีคำขอใหม่กว่าแล้ว ทิ้งผลนี้
    _reportData.brk = brk;
    _reportData.heat = heat;
  } catch { /* ดึงไม่ได้ก็วาดด้วยของเดิม ดีกว่าหน้าว่าง */ }
  renderReportPreviewV2();
}

function renderReportPreviewV2() {
  const d = _reportData;
  if (!d) return;
  const preview = document.getElementById('reportPreview');
  if (typeof ReportTemplate === 'undefined') {
    preview.innerHTML = '<div style="padding:40px;color:#c00">report-template.js not loaded</div>';
    return;
  }

  // CR.5 — Summary report render path
  if (d.summaryMode && d.sum) {
    preview.innerHTML = ReportTemplate.buildSummaryHtml(d.sum, _brand, _rptOpts());
    ReportTemplate.renderShareChart('summaryShareChart', d.sum.day.categories || [], 'count', _rptOpts().showPct);
    ReportTemplate.renderSummaryTrendChart('summaryTrendChart', d.sum.tl);
    return;
  }

  if (!d.domains || d.domains.has('events')) {
    // ตัวเลือกหมวดสร้างจากข้อมูล **ก่อนกรอง** เสมอ ไม่งั้นพอติ๊กออกไปแล้วมันจะหายจาก
    // รายการ กลับมาติ๊กคืนไม่ได้อีก
    _rptRenderCatPicker((d.cats && d.cats.categories) || []);
    const opts = _rptOpts();
    // กรองที่ข้อมูลก่อนวาด เหมือน report-print.js เป๊ะ ๆ — หน้าจอกับ PDF จึงตรงกัน
    const dv = ReportTemplate.hideCats(d, opts.catsHide);

    // CR.8 — Build daily7 and monthly data objects (filtered by category)
    if (!_secOn(opts.secs, 'daily7') && !_secOn(opts.secs, 'monthly')) {
      // Both off, skip
    } else {
      // ⚠️ hideCats ต้องได้ `cats` จริงของรายงาน — timeline endpoint ไม่มี .categories
      //    ถ้าส่ง [] ไป มันจะคืนของเดิมทั้งชุด = หมวดที่ติ๊กออกยังถูกนับในสองกราฟนี้
      if (d.daily7Tl && d.daily7Windows && _secOn(opts.secs, 'daily7')) {
        const d7Filtered = ReportTemplate.hideCats({ cats: d.cats, tl: { series: d.daily7Tl.series || [], trunc: 'day' } }, opts.catsHide);
        const d7 = ReportTemplate.dailySeries(d7Filtered.tl, new Date(d.daily7Windows.from), new Date(d.daily7Windows.to));
        dv.daily7 = { from: d7.days[0] || '', to: d7.days[d7.days.length - 1] || '', prepared: d7 };
      }
      if (d.monthlyTl && d.monthlyWindows && _secOn(opts.secs, 'monthly')) {
        const mFiltered = ReportTemplate.hideCats({ cats: d.cats, tl: { series: d.monthlyTl.series || [], trunc: 'day' } }, opts.catsHide);
        const mPrep = ReportTemplate.dailySeries(mFiltered.tl, new Date(d.monthlyWindows.from), new Date(d.monthlyWindows.to));
        const monthDate = new Date(d.monthlyWindows.from);
        const monthLabel = monthDate.toLocaleDateString(((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB', { month: 'short', year: 'numeric' });
        dv.monthly = {
          from: mPrep.days[0] || '',
          to:   mPrep.days[mPrep.days.length - 1] || '',
          monthLabel,
          prepared: mPrep,
        };
      }
    }

    const catsShown = (dv.cats && dv.cats.categories) || [];
    preview.innerHTML = ReportTemplate.buildReportHtml(dv, _brand, opts);
    const t = ReportTemplate.computeTrendPoints(dv);
    if (t.points.length) ReportTemplate.renderReportTrendChart('reportTrendChart', dv, _brand && _brand.primary_color);
    ReportTemplate.renderCategoryChart('reportCategoryChart', catsShown, opts.catsort);
    // วงในบล็อกหมวดหมู่ = แยก IN/OUT (merge=false) · วงในบล็อก "สัดส่วน" = รวม IN/OUT
    ReportTemplate.renderShareChart('reportCatShareChart', catsShown, opts.catsort, opts.showPct, false);
    ReportTemplate.renderShareChart('reportShareChart', catsShown, opts.catsort, opts.showPct);
    // CR.8 — Render daily7 and monthly bar charts
    if (dv.daily7) {
      ReportTemplate.renderDailyBarChart('reportDaily7Chart', dv.daily7.prepared, { labelMode: 'dow' });
    }
    if (dv.monthly) {
      ReportTemplate.renderDailyBarChart('reportMonthlyChart', dv.monthly.prepared, { labelMode: 'day' });
    }
  } else {
    preview.innerHTML = '';
  }
  if (d.faceData)   preview.insertAdjacentHTML('beforeend', ReportTemplate.buildFaceSection(d.faceData));
  if (d.lprData)    preview.insertAdjacentHTML('beforeend', ReportTemplate.buildLprSection(d.lprData));
  if (d.personData) preview.insertAdjacentHTML('beforeend', ReportTemplate.buildPersonSection(d.personData));
  else if (d.domains?.has?.('person')) preview.insertAdjacentHTML('beforeend', ReportTemplate.buildPersonUnavailable());
}


// PDF download is now server-rendered via GET /api/reports/pdf — which
// goes through Puppeteer page.pdf() on the SAME /report-print.html the
// scheduler uses. So the downloaded PDF byte-for-byte matches the
// interactive report, uses Chromium's real paginator (no mid-element
// cuts on long weekly/monthly reports), and respects 8mm A4 margins.
// The old html2canvas+jsPDF white-rect approach is gone.
// PNG or PDF — same report, same print page, one download path. The format
// toggle sets this; the button label follows it.
let _rbFmt = 'pdf';

function _rbSetFmt(fmt) {
  _rbFmt = fmt === 'image' ? 'image' : 'pdf';
  document.querySelectorAll('#rbFmtBar button').forEach(b =>
    b.classList.toggle('active', b.dataset.rfmt === _rbFmt));
  const lbl = document.getElementById('rbDownloadLabel');
  if (lbl) lbl.textContent = _rbFmt === 'pdf' ? I18N.t('rep.btnPdf', 'ดาวน์โหลด PDF')
                                              : I18N.t('rpt.downloadPng', 'ดาวน์โหลด PNG');
}

async function downloadPDF() {
  if (!_reportData) { alert(I18N.t('rep.loadDataFirst')); return; }
  const btn = document.activeElement;
  const orig = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = I18N.t('rep.generatingPdf'); }
  try {
    const r = _reportData.range;
    const camIds = (typeof getActiveGroupCameraIds === 'function') ? getActiveGroupCameraIds() : [];
    const domains = _reportData.domains ? [..._reportData.domains].join(',') : 'events';
    const qp = new URLSearchParams({
      type:     r.type || 'daily',
      from:     r.from.toISOString(),
      to:       r.to.toISOString(),
      title:    _reportData.title || I18N.t('rep.summaryTitle'),
      label:    r.label || '',
      download: '1',
      domains,
    });
    // CR.5 — summary reports need anchor date for the print page to compute windows
    if (r.type === 'summary' && _reportData.summaryMode) {
      const anchor = new Date(r.from);
      qp.set('anchor', anchor.toISOString());
      qp.set('rtype', 'summary');
    }
    if (camIds && camIds.length) qp.set('cameras', camIds.join(','));
    if (_rptActiveSiteId) qp.set('site_id', _rptActiveSiteId);
    const tod = _rptTod();
    if (tod && !tod.error) {
      qp.set('tod_from', tod.from);
      qp.set('tod_to', tod.to);
    }
    // ไฟล์ที่โหลดต้องหน้าตาเหมือนที่เห็นบนจอ — ถ้าไม่ส่งไปด้วย PDF จะกลับไปเป็นค่าเริ่มต้น
    const dlOpts = _rptOpts();
    if (dlOpts.kpis) qp.set('kpis', dlOpts.kpis.join(','));
    if (dlOpts.secs) qp.set('secs', dlOpts.secs.join(','));
    qp.set('catsort', dlOpts.catsort);
    if (dlOpts.catsHide) qp.set('cats_hide', dlOpts.catsHide.join(','));
    if (!dlOpts.showDelta) qp.set('showDelta', 'false');
    if (!dlOpts.showPct) qp.set('showPct', 'false');

    const isPng = _rbFmt === 'image';
    const res = await fetch(`${API}/api/reports/${isPng ? 'image' : 'pdf'}?${qp}`, { cache: 'no-store' });
    if (!res.ok) {
      let body = ''; try { body = (await res.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${res.status}${body ? ' · ' + body : ''}`);
    }
    const blob = await res.blob();
    const stamp = r.from.toISOString().slice(0, 10).replace(/-/g, '') + '_'
                + r.to.toISOString().slice(0, 10).replace(/-/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(_brand?.name || 'vigil').toLowerCase().replace(/\s+/g,'-')}-report-${r.type || 'custom'}-${stamp}.${isPng ? 'png' : 'pdf'}`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (e) {
    alert(I18N.t('rep.pdfFailed') + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

// ============================================================
// 📅 Report Schedules (Phase 7.3 — scheduled report delivery)
// ============================================================
// Commit 1: config layer. CRUD against /api/report-schedules; the
// server-side scheduler fires at send_time and records the run.
// PDF generation + email delivery land in commits 2-3.
const _RS_TYPE_LABEL = {
  daily:   I18N.t('rs.typeDaily'),
  weekly:  I18N.t('rs.typeWeekly'),
  monthly: I18N.t('rs.typeMonthly'),
  summary: I18N.t('rs.typeSummary'),
  health:  I18N.t('hr.typeHealth'),
  manual:  I18N.t('rs.typeManual'),
};
const _RS_LAYOUT_LABEL = {
  compact: I18N.t('rs.layoutCompact'),
  full:    I18N.t('rs.layoutFull'),
};
let _rsRecipients = [];   // LINE recipient roster (from /api/line-config)
let _rsTelegramChats = [];    // T5: approved Telegram chats (from /api/telegram-config)
let _rsTelegramLoaded = false; // true only when that fetch actually succeeded — saveReportSchedule
                                // must not send telegram_chat_ids (and wipe the stored value) on a
                                // failed load, so it needs to tell "empty roster" from "didn't load"
const _rsRowMap = new Map(); // id → schedule row (avoids JSON in onclick attrs)

function openReportScheduleModal() {
  document.getElementById('reportScheduleModal').classList.remove('hidden');
  resetReportScheduleForm();
  loadReportScheduleRecipients();
  loadReportScheduleTelegramChats();
  loadReportSchedules();
}
function closeReportScheduleModal() {
  document.getElementById('reportScheduleModal').classList.add('hidden');
}
function resetReportScheduleForm() {
  document.getElementById('rsId').value = '';
  document.getElementById('rsFamily').value = 'analytics';
  document.getElementById('rsType').value = 'daily';
  document.getElementById('rsSendTime').value = '08:00';
  document.getElementById('rsLayout').value = 'compact';
  document.getElementById('rsEnabled').checked = true;
  document.getElementById('rsDayOfWeek').value = '';
  _rsRenderDayOfMonthChips('');
  // reset health sections — all checked by default
  document.querySelectorAll('.hrSecCheck').forEach(c => { c.checked = true; });
  // analytics option set — same defaults as the interactive form
  document.querySelectorAll('.rsDomCheck').forEach(c => { c.checked = (c.value === 'events'); });
  document.querySelectorAll('.rsKpiCheck').forEach(c => { c.checked = true; });
  document.querySelectorAll('.rsSecCheck').forEach(c => { c.checked = true; });
  document.getElementById('rsCatSort').value = 'count';
  document.getElementById('rsShowDelta').checked = true;
  document.getElementById('rsShowPct').checked = true;
  document.getElementById('rsTitle').value = '';
  // Reset time-of-day window
  document.getElementById('rsTodFrom').value = '';
  document.getElementById('rsTodTo').value = '';
  _rsToggleTypeFields();
  _rsRenderRecipientsChecklist([]);
  _rsRenderTelegramChecklist([]);
  _rsRenderSiteSelect('');
  _rsLoadCatPicker('', null, null);    // ตารางใหม่ = ทุกหมวด
}

// R4: show day-of-week select for (family='health') OR (family!='health' AND type='weekly')
// day-of-month chips for (family!='health' AND type='monthly')
// health sections only for family='health'
// layout only for family='analytics'
// analytics option set only for family='analytics'
// rsTypeGroup hidden when family='health' (no cadence needed)
// Wired to rsFamily.onchange + rsType.onchange + called from resetReportScheduleForm and editReportSchedule.
function _rsToggleTypeFields() {
  const family    = document.getElementById('rsFamily').value;
  const t         = document.getElementById('rsType').value;
  const typeGroup = document.getElementById('rsTypeGroup');
  const dowEl     = document.getElementById('rsDayOfWeekGroup');
  const domEl     = document.getElementById('rsDayOfMonthGroup');
  const healthEl  = document.getElementById('rsHealthSectionsGroup');
  const layoutEl  = document.getElementById('rsLayoutGroup');
  const analyticsOptsEl = document.getElementById('rsAnalyticsOptsGroup');

  const isHealthFamily = family === 'health';

  // Hide cadence selector for health (health reports are always daily-ish)
  if (typeGroup) typeGroup.style.display = isHealthFamily ? 'none' : '';

  // dow: health family OR (weekly cadence when not health)
  if (dowEl) dowEl.style.display = (isHealthFamily || t === 'weekly') ? 'block' : 'none';

  // dom: monthly cadence (only when not health family)
  if (domEl) domEl.style.display = (!isHealthFamily && t === 'monthly') ? 'block' : 'none';

  // health sections: only for health family
  if (healthEl) healthEl.style.display = isHealthFamily ? 'block' : 'none';

  // layout: only for analytics family
  if (layoutEl) layoutEl.style.display = family === 'analytics' ? '' : 'none';

  // analytics option set: only for analytics family
  if (analyticsOptsEl) analyticsOptsEl.style.display = family === 'analytics' ? '' : 'none';

  // domains visibility: hide when analytics family + compact layout (compact shows events only).
  // 2026-08-23 — domain checkboxes meaningless in compact, show hint instead.
  const isAnalyticsFamily = family === 'analytics';
  const layout = document.getElementById('rsLayout').value;
  const domainsWrapEl = document.getElementById('rsDomainsWrap');
  const domainsNoteEl = document.getElementById('rsDomainsCompactNote');
  const hideDomainsInCompact = isAnalyticsFamily && layout === 'compact';
  if (domainsWrapEl) domainsWrapEl.style.display = hideDomainsInCompact ? 'none' : '';
  if (domainsNoteEl) domainsNoteEl.style.display = hideDomainsInCompact ? 'block' : 'none';

  // รายงานสรุปมีเทมเพลตของตัวเอง — ซ่อนตัวเลือกที่ไม่มีผลกับมัน (ต้องมาหลังทุกบรรทัด
  // ข้างบน ไม่งั้นโดนเปิดกลับ) · ตัวโน้ตของ layout ก็ต้องหายไปด้วยเพราะ layout ถูกซ่อน
  const isSummaryType = isAnalyticsFamily && t === 'summary';
  _rptToggleSummaryFields('schedule', isSummaryType);
  if (isSummaryType && domainsNoteEl) domainsNoteEl.style.display = 'none';
}

// Chip grid for day-of-month picker (1..31 + "วันสุดท้าย"). Multi-select
// via toggle. Reads/writes the CSV format the backend expects ("1,15,L").
function _rsRenderDayOfMonthChips(selectedCsv) {
  const el = document.getElementById('rsDayOfMonthChips');
  if (!el) return;
  const sel = new Set(String(selectedCsv || '').split(',').map(x => x.trim()).filter(Boolean));
  const buttons = [];
  for (let i = 1; i <= 31; i++) {
    const active = sel.has(String(i)) ? ' rsDomActive' : '';
    buttons.push(`<button type="button" class="rsDomChip${active}" data-day="${i}">${i}</button>`);
  }
  const lastActive = sel.has('L') ? ' rsDomActive' : '';
  buttons.push(`<button type="button" class="rsDomChip${lastActive}" data-day="L" style="min-width:auto;padding:5px 12px">${escapeHtml(I18N.t('rs.lastDay'))}</button>`);
  el.innerHTML = buttons.join('');
  el.querySelectorAll('.rsDomChip').forEach(b => {
    b.addEventListener('click', () => b.classList.toggle('rsDomActive'));
  });
}
function _rsGetDayOfMonthValue() {
  const active = document.querySelectorAll('#rsDayOfMonthChips .rsDomChip.rsDomActive');
  return [...active].map(b => b.dataset.day).join(',');
}

// LINE recipient roster — reused from line_config (same source the alert
// rule editor uses). Loaded once when the modal opens.
async function loadReportScheduleRecipients() {
  try {
    const r = await fetch(`${API}/api/line-config`);
    const cfg = r.ok ? await r.json() : { recipients: [] };
    _rsRecipients = Array.isArray(cfg.recipients) ? cfg.recipients : [];
  } catch { _rsRecipients = []; }
  _rsRenderRecipientsChecklist([]);
}
function _rsRenderRecipientsChecklist(selectedIds) {
  const el = document.getElementById('rsRecipientsChecklist');
  if (!el) return;
  if (!_rsRecipients.length) {
    el.innerHTML = `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('rs.noRecipients'))}</span>`;
    return;
  }
  el.innerHTML = _rsRecipients.map(r => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
      <input type="checkbox" class="rsRecipCheck" value="${escapeHtml(r.id)}" ${selectedIds.includes(r.id) ? 'checked' : ''}>
      <span>${escapeHtml(r.name || r.id)}${r.enabled === false ? ` <span style="color:var(--text-secondary)">${escapeHtml(I18N.t('rs.disabledTag'))}</span>` : ''}</span>
    </label>`).join('');
}

// T5: Telegram chat roster — only chats already approved in the Telegram Config
// page show up here (same source /api/telegram-config uses for its own list).
// Admin/auditor-only endpoint — a non-OK response (not connected, no permission)
// is treated the same as "not connected": disable the checklist, show the hint.
let _rsTelegramConnected = false; // cfg.enabled && cfg.has_token — "connected", not just "fetch worked"
async function loadReportScheduleTelegramChats() {
  _rsTelegramLoaded = false;
  _rsTelegramConnected = false;
  try {
    const r = await fetch(`${API}/api/telegram-config`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cfg = await r.json();
    _rsTelegramChats = Array.isArray(cfg.chats) ? cfg.chats : [];
    _rsTelegramConnected = !!(cfg.enabled && cfg.has_token);
    _rsTelegramLoaded = true;
  } catch { _rsTelegramChats = []; _rsTelegramLoaded = false; }
  // แก้ race: กดแก้ตารางก่อนคำขอนี้ตอบกลับ → re-render ด้วย [] จะไปล้างติ๊กที่
  // editReportSchedule เพิ่งตั้งไว้ · อ่านค่าที่บันทึกไว้ของตารางที่กำลังแก้อยู่แทน
  // (rsId ว่าง = ฟอร์มใหม่ ไม่มีอะไรให้กู้คืนอยู่แล้ว)
  const rsId = document.getElementById('rsId')?.value;
  const cur = rsId ? _rsRowMap.get(Number(rsId)) : null;
  _rsRenderTelegramChecklist(Array.isArray(cur?.telegram_chat_ids) ? cur.telegram_chat_ids : []);
}
function _rsRenderTelegramChecklist(selectedIds) {
  const el = document.getElementById('rsTelegramChecklist');
  const hint = document.getElementById('rsTelegramHint');
  if (!el) return;
  if (!_rsTelegramLoaded) {
    el.innerHTML = '';
    el.style.display = 'none';
    if (hint) hint.style.display = '';
    return;
  }
  el.style.display = '';
  // เชื่อมต่อ (bot token + enabled) แต่ไม่มีแชทที่อนุมัติเลย ≠ "ยังไม่ได้เชื่อมต่อ" —
  // ข้อความคนละอย่าง คนละทางแก้ (ไปอนุมัติแชท vs ไปตั้งค่าบอทก่อน)
  if (!_rsTelegramConnected) {
    if (hint) hint.style.display = '';
    if (!_rsTelegramChats.length) { el.innerHTML = ''; return; }
  } else if (hint) { hint.style.display = 'none'; }
  if (_rsTelegramConnected && !_rsTelegramChats.length) {
    el.innerHTML = `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('rs.noTelegramChats'))}</span>`;
    return;
  }
  const sel = selectedIds.map(String);
  const dis = _rsTelegramConnected ? '' : 'disabled';
  el.innerHTML = _rsTelegramChats.map(c => `
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:${_rsTelegramConnected ? 'pointer' : 'default'}">
      <input type="checkbox" class="rsTelegramCheck" value="${escapeHtml(String(c.chat_id))}" ${sel.includes(String(c.chat_id)) ? 'checked' : ''} ${dis}>
      <span>${escapeHtml(c.name || String(c.chat_id))}</span>
    </label>`).join('');
}

// Site picker for the schedule form. site_id has been stored on report_schedules
// (migration 070) and honoured by the worker since then, but the form never sent
// it — so every schedule was NULL, i.e. "all sites", no matter which site pill
// the operator had active when they saved it.
function _rsRenderSiteSelect(selectedId) {
  const grp = document.getElementById('rsSiteGroup');
  const sel = document.getElementById('rsSite');
  if (!grp || !sel) return;
  // Single-site install has nothing to choose — hide the control rather than
  // showing a dropdown with one option.
  // Site Admin: ตารางรายงานต้องผูก Site ของตัวเองเสมอ (ไม่มี "ทุก Site" — เซิร์ฟเวอร์ปฏิเสธ) จึงแสดงเสมอแม้มี Site เดียว
  const sa = currentUser?.role === 'site_admin';
  if (!sa && (!Array.isArray(_rptSites) || _rptSites.length < 2)) { grp.style.display = 'none'; return; }
  grp.style.display = '';
  sel.innerHTML = (sa ? '' : `<option value="">${escapeHtml(I18N.t('rs.siteAll'))}</option>`) +
    (_rptSites || []).map(s => `<option value="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}</option>`).join('');
  sel.value = selectedId ? String(selectedId) : (sa ? String((_rptSites || [])[0]?.id ?? '') : '');
  _rsUpdateSiteHint();
}

function _rsUpdateSiteHint() {
  const sel  = document.getElementById('rsSite');
  const hint = document.getElementById('rsSiteHint');
  if (!sel || !hint) return;
  const site = _rptSites.find(s => String(s.id) === sel.value);
  const n = site ? (site.camera_count ?? null) : null;
  hint.style.display = (n === 0) ? '' : 'none';
}

async function loadReportSchedules() {
  const el = document.getElementById('rsList');
  try {
    const res = await fetch(`${API}/api/report-schedules`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    renderReportSchedules(list);
  } catch (e) {
    el.innerHTML = `<tr><td style="padding:12px;color:var(--status-bad)">${escapeHtml(I18N.t('rs.loadFailed'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function _rsSiteName(id) {
  if (!id) return I18N.t('rs.siteAll');
  const s = (_rptSites || []).find(x => String(x.id) === String(id));
  return s ? s.name : `#${id}`;
}

function renderReportSchedules(list) {
  const el = document.getElementById('rsList');
  _rsRowMap.clear();
  list.forEach(s => _rsRowMap.set(s.id, s));
  if (!list.length) {
    el.innerHTML = `<tr><td style="padding:14px;color:var(--text-secondary);text-align:center">${escapeHtml(I18N.t('rs.noSchedules'))}</td></tr>`;
    return;
  }
  const dowLabel = I18N.t('stats.dowShort').split(',');
  function _formatDayCell(s) {
    if (s.report_type === 'daily' || s.report_type === 'summary') return `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('rs.everyDay'))}</span>`;
    if (s.report_type === 'weekly') {
      const d = s.send_day_of_week;
      if (d === null || d === undefined) return `<span style="color:var(--warn)" title="${escapeHtml(I18N.t('rs.everyDayWarnTipW'))}">${escapeHtml(I18N.t('rs.everyDayWarn'))}</span>`;
      return escapeHtml(I18N.t('rs.everyPrefix') + (dowLabel[d] || '?'));
    }
    if (s.report_type === 'monthly') {
      if (!s.send_days_of_month) return `<span style="color:var(--warn)" title="${escapeHtml(I18N.t('rs.everyDayWarnTipM'))}">${escapeHtml(I18N.t('rs.everyDayWarn'))}</span>`;
      const tokens = String(s.send_days_of_month).split(',').map(x => x.trim());
      const pretty = tokens.map(t => t === 'L' ? I18N.t('rs.lastDayShort') : t).join(', ');
      return escapeHtml(I18N.t('rs.daysPrefix').replace('{d}', pretty));
    }
    return '—';
  }

  el.innerHTML =
    `<thead><tr>
       <th style="text-align:left">${escapeHtml(I18N.t('rs.fldType'))}</th><th>${escapeHtml(I18N.t('evt.colTime'))}</th><th>${escapeHtml(I18N.t('rs.colSendDay'))}</th>
       <th>${escapeHtml(I18N.t('rs.fldLayout'))}</th><th>${escapeHtml(I18N.t('rs.colSite'))}</th><th>${escapeHtml(I18N.t('rs.colStatus'))}</th>
       <th>${escapeHtml(I18N.t('rs.colLastRun'))}</th><th></th>
     </tr></thead><tbody>` +
    list.map(s => {
      const lastRun = s.last_run_at
        ? new Date(s.last_run_at).toLocaleString('th-TH', { hour12: false })
        : '—';
      const statusBadge = !s.last_status ? `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('rs.notRunYet'))}</span>`
        : s.last_status === 'success' ? `<span style="color:var(--status-ok)">${escapeHtml(I18N.t('rs.statusSuccess'))}</span>`
        : s.last_status === 'pending' ? '<span style="color:var(--warn)" title="' + escapeHtml(s.last_error || '') + '">pending</span>'
        : '<span style="color:var(--status-bad)" title="' + escapeHtml(s.last_error || '') + '">✗ ' + escapeHtml(s.last_status) + '</span>';
      return `<tr>
        <td style="padding:6px 8px">${_RS_TYPE_LABEL[s.report_type] || s.report_type}</td>
        <td style="text-align:center">${String(s.send_time).slice(0,5)}</td>
        <td style="text-align:center;font-size:11px">${_formatDayCell(s)}</td>
        <td style="text-align:center">${_RS_LAYOUT_LABEL[s.image_layout] || s.image_layout}</td>
        <td style="text-align:center;font-size:11px">${escapeHtml(_rsSiteName(s.site_id))}</td>
        <td style="text-align:center">${s.enabled ? escapeHtml(I18N.t('rs.enabledOn')) : escapeHtml(I18N.t('rs.enabledOff'))}</td>
        <td style="text-align:center;font-size:11px">${lastRun}<br>${statusBadge}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="csv-btn" style="font-size:10px" title="${escapeHtml(I18N.t('rh.runNowTip'))}" data-action="runReportNow" data-id="${s.id}">▶</button>
          <button class="csv-btn" style="font-size:10px" data-action="editReportSched" data-id="${s.id}"><svg aria-hidden="true" width="11" height="11"><use href="#icon-edit"/></svg></button>
          <button class="csv-btn" style="font-size:10px;color:var(--status-bad)" data-action="deleteReportSched" data-id="${s.id}"><svg aria-hidden="true" width="11" height="11"><use href="#icon-trash"/></svg></button>
        </td></tr>`;
    }).join('') + '</tbody>';
}

function editReportSchedule(id) {
  const s = _rsRowMap.get(Number(id));
  if (!s) return;
  document.getElementById('rsId').value = s.id;
  // R4: restore report_family (legacy fallback for existing rows)
  document.getElementById('rsFamily').value = s.report_family || (s.report_type === 'health' ? 'health' : 'analytics');
  document.getElementById('rsType').value = s.report_type;
  document.getElementById('rsSendTime').value = String(s.send_time).slice(0, 5);
  document.getElementById('rsLayout').value = s.image_layout || 'compact';
  document.getElementById('rsEnabled').checked = !!s.enabled;
  // Phase 7.4 — restore day-of-week / day-of-month from the row.
  document.getElementById('rsDayOfWeek').value =
    (s.send_day_of_week === null || s.send_day_of_week === undefined) ? '' : String(s.send_day_of_week);
  _rsRenderDayOfMonthChips(s.send_days_of_month || '');
  // Ph.3 — restore health sections (default all checked if null)
  const savedSections = _normalizeHealthSectionsForUi(s.health_sections);
  document.querySelectorAll('.hrSecCheck').forEach(c => {
    c.checked = savedSections ? savedSections.has(c.value) : true;
  });
  // restore the analytics option set — legacy rows fall back to the old defaults
  const savedAnalyticsOpts = _normalizeAnalyticsOptsForUi(s.section_config);
  const domainsSet = savedAnalyticsOpts?.domains;
  const kpisSet = savedAnalyticsOpts?.kpis;
  const secsSet = savedAnalyticsOpts?.secs;
  document.querySelectorAll('.rsDomCheck').forEach(c => {
    c.checked = domainsSet ? domainsSet.has(c.value) : (c.value === 'events');
  });
  document.querySelectorAll('.rsKpiCheck').forEach(c => {
    c.checked = kpisSet ? kpisSet.has(c.value) : true;
  });
  document.querySelectorAll('.rsSecCheck').forEach(c => {
    c.checked = secsSet ? secsSet.has(c.value) : true;
  });
  document.getElementById('rsShowDelta').checked = savedAnalyticsOpts?.showDelta !== false;
  document.getElementById('rsShowPct').checked = savedAnalyticsOpts?.showPct !== false;
  // รายการหมวดต้องโหลดตาม SITE ของตารางนี้ แล้วค่อยติ๊กตามที่บันทึกไว้
  _rsLoadCatPicker(s.site_id, savedAnalyticsOpts?.catsHide || null,
                   savedAnalyticsOpts?.catsShownLegacy || null);
  document.getElementById('rsCatSort').value = savedAnalyticsOpts?.catsort || 'count';
  document.getElementById('rsTitle').value = savedAnalyticsOpts?.title || '';
  // Restore time-of-day window (CR.2, 2026-09-03)
  const savedTod = savedAnalyticsOpts?.tod;
  document.getElementById('rsTodFrom').value = savedTod?.from || '';
  document.getElementById('rsTodTo').value = savedTod?.to || '';
  _rsToggleTypeFields();
  const sel = String(s.recipients || '').split(',').map(x => x.trim()).filter(Boolean);
  _rsRenderRecipientsChecklist(sel);
  _rsRenderTelegramChecklist(Array.isArray(s.telegram_chat_ids) ? s.telegram_chat_ids : []);
  _rsRenderSiteSelect(s.site_id || '');
}

// รายการหมวดของฟอร์มตั้งเวลา — ต้องดึงตาม SITE ที่เลือก เพราะหมวดเป็นของราย Site
// (ดู event_categories.site_id) · ช่วงเวลาใช้ 7 วันล่าสุดเพียงเพื่อ "ให้ได้รายชื่อหมวด"
// ไม่ได้เอาตัวเลข จึงไม่ต้องตรงกับช่วงที่รายงานจริงจะใช้
async function _rsLoadCatPicker(siteId, hidden, shownLegacy) {
  const wrap = document.getElementById('rsCatPick');
  if (!wrap) return;
  wrap.innerHTML = `<div style="font-size:11px;color:var(--text-secondary)">${escapeHtml(I18N.t('rs.catLoading'))}</div>`;
  const to = new Date(), from = new Date(Date.now() - 7 * 86400e3);
  const siteQ = siteId ? `&site_id=${encodeURIComponent(siteId)}` : '';
  let rows = [];
  try {
    const r = await fetch(`${API}/api/stats/categories?from=${from.toISOString()}&to=${to.toISOString()}${siteQ}`);
    if (r.ok) rows = (await r.json()).categories || [];
  } catch { /* ปล่อยว่างไว้ = ถือว่าไม่กรอง */ }
  if (!rows.length) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--text-secondary)">${escapeHtml(I18N.t('rs.catNone'))}</div>`;
    return;
  }
  wrap.innerHTML = rows.map(c => {
    // hidden = รูปแบบปัจจุบัน · shownLegacy = ตารางเก่าที่เก็บ "รายชื่อที่เลือก" ไว้
    const on = hidden ? !hidden.has(c.id)
             : shownLegacy ? shownLegacy.has(c.id)
             : true;
    return `<label class="rb-dom"><input type="checkbox" class="rsCatCheck" value="${c.id}"${on ? ' checked' : ''}>` +
      `<span class="rb-dom-dot" style="background:${escapeHtml(c.color || 'var(--accent)')}"></span>` +
      `<span>${escapeHtml(c.name || '')}</span></label>`;
  }).join('');
}

async function saveReportSchedule() {
  const id = document.getElementById('rsId').value;
  const family = document.getElementById('rsFamily').value;
  const type = document.getElementById('rsType').value;
  const isHealth = family === 'health';
  const isFaceOrLpr = family === 'face' || family === 'lpr';

  // R4: Derive report_type from family and type
  // health family: report_type='health' (cadence ignored)
  // others: report_type is the cadence (daily/weekly/monthly)
  const report_type = isHealth ? 'health' : type;

  const body = {
    report_type:  report_type,
    report_family: family,
    send_time:    document.getElementById('rsSendTime').value,
    enabled:      document.getElementById('rsEnabled').checked,
    recipients:   [...document.querySelectorAll('.rsRecipCheck:checked')].map(c => c.value).join(','),
    // Phase 7.4 — day picker fields. Always sent (even when irrelevant for
    // the type) so the backend can clear stale values from a previous edit
    // where the type was different.
    send_day_of_week:   (isHealth || type === 'weekly') ? document.getElementById('rsDayOfWeek').value : null,
    send_days_of_month: type === 'monthly' ? _rsGetDayOfMonthValue() : null,
    site_id: document.getElementById('rsSite')?.value
             ? parseInt(document.getElementById('rsSite').value, 10) : null,
  };

  // T5: ส่ง telegram_chat_ids เฉพาะตอนโหลด checklist สำเร็จแล้วเท่านั้น — โหลดไม่สำเร็จ
  // (ยังไม่เชื่อมต่อ Telegram/หมดสิทธิ์) แล้วยังส่งเป็น [] จะไปเขียนทับค่าที่บันทึกไว้
  // เดิมให้ว่างเปล่าโดยที่ผู้ใช้ไม่ได้ตั้งใจ
  if (_rsTelegramLoaded) {
    body.telegram_chat_ids = [...document.querySelectorAll('.rsTelegramCheck:checked')].map(c => c.value);
  }

  // R4: image_layout — only for analytics
  if (family === 'analytics') {
    body.image_layout = document.getElementById('rsLayout').value;
  }

  // Ph.3 — health sections — only for health family
  if (isHealth) {
    body.health_sections = [...document.querySelectorAll('.hrSecCheck:checked')].map(c => c.value);
  }

  // R4: section_config — only for face/lpr
  if (isFaceOrLpr) {
    body.section_config = {}; // Currently empty; could be extended later with face/lpr-specific options
  }

  // Analytics option set. renderReportImage has accepted domains/kpis/catsort
  // since 2026-08-21 but a schedule had nowhere to keep them, so every
  // scheduled run rendered the full report no matter what the operator picked.
  // section_config (migration 068) already round-trips through the route, so
  // this needed no schema change. tod (time-of-day) added 2026-09-03 (CR.2).
  // secs (section toggle) added 2026-09-03 (CR.7).
  if (family === 'analytics') {
    const catBoxes = [...document.querySelectorAll('.rsCatCheck')];
    const catHidden = catBoxes.filter(c => !c.checked).map(c => parseInt(c.value, 10));
    // Validate time window
    const todVal = _validateTod('rsTodFrom', 'rsTodTo');
    if (todVal && todVal.error) { alert(I18N.t('rep.todInvalid')); return; }
    body.section_config = {
      domains: [...document.querySelectorAll('.rsDomCheck:checked')].map(c => c.value),
      kpis:    [...document.querySelectorAll('.rsKpiCheck:checked')].map(c => c.value),
      secs:    [...document.querySelectorAll('.rsSecCheck:checked')].map(c => c.value),
      catsort: document.getElementById('rsCatSort')?.value || 'count',
      title:   document.getElementById('rsTitle')?.value.trim() || null,
      // เก็บ "หมวดที่ติ๊กออก" — หมวดที่สร้างใหม่ทีหลังจะเข้ารายงานเองโดยอัตโนมัติ
      cats_hide: catHidden.length ? catHidden : null,
      showDelta: document.getElementById('rsShowDelta')?.checked !== false,
      showPct: document.getElementById('rsShowPct')?.checked !== false,
      // tod (time-of-day window within each day, optional)
      ...(todVal ? { tod: todVal } : {}),
    };
  }

  if (!body.send_time) { alert(I18N.t('rs.needSendTime')); return; }
  try {
    const res = await fetch(`${API}/api/report-schedules${id ? '/' + id : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    resetReportScheduleForm();
    loadReportSchedules();
  } catch (e) { alert(I18N.t('rs.saveFailed') + e.message); }
}

async function deleteReportSchedule(id) {
  if (!confirm(I18N.t('rs.confirmDelete'))) return;
  try {
    const res = await fetch(`${API}/api/report-schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadReportSchedules();
  } catch (e) { alert(I18N.t('rs.deleteFailed') + e.message); }
}

// Ph.2 — "▶ Run Now" button in schedule list
async function runReportNow(id, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(`${API}/api/report-schedules/${id}/run`, { method: 'POST' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    showToast({ icon: '▶', title: I18N.t('rh.runQueued'), sub: I18N.t('rh.runQueuedSub') });
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
    showToast({ icon: '▶', title: I18N.t('rh.runFailed') + e.message });
  }
}

// ============================================================
// Ph.2 — Report History
// ============================================================

let _rhOffset = 0;
const _RH_LIMIT = 50;

// ── Report History Stats Summary ─────────────────────────────
let _rhStatsWindow = '30d';

async function loadReportHistoryStats(win) {
  if (win) _rhStatsWindow = win;
  const el = document.getElementById('rhStatsSummary');
  if (!el) return;
  el.innerHTML = `<div style="font-size:11px;color:var(--text-secondary);padding:6px 0">${escapeHtml(I18N.t('rh.statLoading'))}</div>`;
  try {
    const res = await fetch(`${API}/api/report-history/stats?window=${_rhStatsWindow}`, { cache: 'no-store' });
    const data = await res.json();
    el.innerHTML = renderReportHistoryStats(data);
  } catch {
    el.innerHTML = `<div style="font-size:11px;color:var(--status-bad);padding:6px 0">${escapeHtml(I18N.t('rh.statError'))}</div>`;
  }
}

function renderReportHistoryStats(d) {
  const rate = d.success_rate != null ? `${d.success_rate}%` : '—';
  const bt = d.by_type || {};

  const card = (color, num, label, sub = '') => `
    <div style="background:var(--surface-elevated);border:1px solid ${color};border-radius:8px;padding:10px 14px;min-width:0">
      <div style="font-size:18px;font-weight:700;color:${color};line-height:1.2">${num.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--text-primary);margin-top:3px">${label}</div>
      ${sub ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:1px">${sub}</div>` : ''}
    </div>`;

  const winBtn = (w, label) => `
    <button data-action="loadRhStats" data-window="${w}"
      style="padding:3px 10px;font-size:10px;border-radius:12px;border:1px solid var(--border-hairline);cursor:pointer;
             background:${_rhStatsWindow === w ? 'var(--accent)' : 'var(--surface-overlay)'};
             color:${_rhStatsWindow === w ? '#fff' : 'var(--text-secondary)'};white-space:nowrap">
      ${escapeHtml(label)}
    </button>`;

  const typeChip = (label, count) => count > 0
    ? `<span style="background:var(--surface-elevated);border:1px solid var(--border-hairline);border-radius:10px;padding:2px 8px;font-size:10px;white-space:nowrap">${escapeHtml(label)} <strong>${count}</strong></span>`
    : '';

  const typeRow = [
    typeChip('Daily',   bt.daily   || 0),
    typeChip('Weekly',  bt.weekly  || 0),
    typeChip('Monthly', bt.monthly || 0),
    typeChip('Health',  bt.health  || 0),
  ].filter(Boolean).join(' ');

  return `
    <div style="background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:8px;padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div style="font-size:11px;font-weight:600;color:var(--text-secondary)">Summary</div>
        <div style="display:flex;gap:5px">
          ${winBtn('30d', I18N.t('rh.win30d'))}
          ${winBtn('90d', I18N.t('rh.win90d'))}
          ${winBtn('all', I18N.t('rh.winAll'))}
        </div>
      </div>
      <div class="rh-stats-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        ${card('var(--status-ok)', d.success || 0, escapeHtml(I18N.t('rh.statSuccess')), `${rate} ${escapeHtml(I18N.t('rh.statSuccessRate'))}`)}
        ${card('var(--status-bad)',   d.failed  || 0, escapeHtml(I18N.t('rh.statFailed')))}
        ${card('var(--accent)',d.total_recipients_sent || 0, escapeHtml(I18N.t('rh.statRecipients')))}
      </div>
      ${typeRow ? `<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        <span style="font-size:10px;color:var(--text-secondary);margin-right:2px">${escapeHtml(I18N.t('rh.statByType'))}:</span>
        ${typeRow}
      </div>` : ''}
    </div>`;
}

async function loadReportHistory(offset) {
  if (!offset) loadReportHistoryStats();
  _rhOffset = offset || 0;
  const el = document.getElementById('rhList');
  if (!el) return;
  el.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</td></tr>`;
  try {
    const res = await fetch(`${API}/api/report-history?limit=${_RH_LIMIT}&offset=${_rhOffset}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items, total } = await res.json();
    renderReportHistory(items, total);
  } catch (e) {
    el.innerHTML = `<tr><td colspan="6" style="padding:12px;color:var(--status-bad)">${escapeHtml(I18N.t('rh.loadFailed'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderReportHistory(items, total) {
  const el = document.getElementById('rhList');
  if (!items.length) {
    el.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('rh.noHistory'))}</td></tr>`;
    document.getElementById('rhPager').innerHTML = '';
    return;
  }
  const _RS_TYPE   = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly'), summary: I18N.t('rs.typeSummary') };
  const _RS_FAMILY = { face: I18N.t('rs.familyFace'), lpr: I18N.t('rs.familyLpr') };
  const _RS_LAYOUT = { compact: I18N.t('rs.layoutCompact'), full: I18N.t('rs.layoutFull') };
  el.innerHTML = items.map(row => {
    const ts = new Date(row.created_at).toLocaleString('th-TH', { hour12: false });
    const statusBadge = row.status === 'success'
      ? `<span style="color:var(--status-ok)">✓ ${escapeHtml(I18N.t('rs.statusSuccess'))}</span>`
      : `<span style="color:var(--status-bad)" title="${escapeHtml(row.error_message || '')}">✗ ${escapeHtml(row.status)}</span>`;
    const pngBtn = row.file_path
      ? `<a href="${API}/api/report-history/${row.id}/image" class="csv-btn" style="font-size:10px;text-decoration:none" title="${escapeHtml(I18N.t('rh.downloadPng'))}">⬇ PNG</a>`
      : `<span style="color:var(--text-secondary);font-size:10px">—</span>`;
    const sentInfo = row.status === 'success'
      ? `${row.sent_count}/${row.total_recipients}`
      : `<span style="color:var(--text-secondary)">—</span>`;
    return `<tr>
      <td style="padding:5px 8px;white-space:nowrap">${escapeHtml(ts)}</td>
      <td style="text-align:center">${escapeHtml(_RS_FAMILY[row.report_family] ? `${_RS_FAMILY[row.report_family]} · ${_RS_TYPE[row.report_type] || row.report_type}` : _RS_TYPE[row.report_type] || row.report_type)}</td>
      <td style="text-align:center">${escapeHtml(_RS_LAYOUT[row.image_layout] || row.image_layout || '—')}</td>
      <td style="text-align:center">${sentInfo}</td>
      <td style="text-align:center">${statusBadge}</td>
      <td style="text-align:right">${pngBtn}</td>
    </tr>`;
  }).join('');
  // pager
  const pager = document.getElementById('rhPager');
  const pages = Math.ceil(total / _RH_LIMIT);
  const cur = Math.floor(_rhOffset / _RH_LIMIT);
  pager.innerHTML = `<span style="font-size:11px;color:var(--text-secondary)">${total} ${escapeHtml(I18N.t('rh.rows'))}</span>` +
    (cur > 0 ? `<button class="csv-btn" data-action="loadReportHistory" data-offset="${(cur-1)*_RH_LIMIT}">‹ ${escapeHtml(I18N.t('rh.prev'))}</button>` : '') +
    `<span style="font-size:11px">${cur+1} / ${pages}</span>` +
    (cur < pages-1 ? `<button class="csv-btn" data-action="loadReportHistory" data-offset="${(cur+1)*_RH_LIMIT}">${escapeHtml(I18N.t('rh.next'))} ›</button>` : '');
}

async function exportReportHistoryCsv() {
  try {
    const res = await fetch(`${API}/api/report-history?limit=200&offset=0`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items } = await res.json();
    const header = ['id','created_at','report_type','image_layout','range_from','range_to','status','sent_count','total_recipients','recipients_sent','error_message','file_path'];
    const rows = items.map(r => header.map(k => JSON.stringify(r[k] ?? '')).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_history_${new Date().toLocaleDateString('sv')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert(I18N.t('rh.exportFailed') + e.message); }
}

// ============================================================
// Analytics & LPR Send to LINE — load recipients, update labels, send
// ============================================================

// ผู้รับของปุ่ม "ส่งทันที" — ตั้งใจไม่ติ๊กมาให้ล่วงหน้า ต่างจาก modal ตารางส่งที่
// "ไม่เลือก = ส่งทุกคน" ได้เพราะทบทวนก่อนถึงเวลาจริง ปุ่มนี้ยิงแล้วเรียกคืนไม่ได้
// (2026-08-23 ตารางที่ปล่อยผู้รับว่างยิงรายงานเข้า 7 กลุ่มจริงรวมกลุ่มตำรวจ)
// listener ผูกที่ตัว container ไม่ใช่ที่ checkbox — รายการถูก render ทีหลังแบบ async
// ผูกทีละใบจึงไม่ทัน ได้ 0 ตัวเสมอ
async function _rptLoadRecipientsForTab(listEl, checkboxClass, btnId, hintId) {
  if (!listEl) return;
  if (!listEl.dataset.bound) {
    listEl.dataset.bound = '1';
    listEl.addEventListener('change', () => _rptUpdateSendBtnLabel(btnId, checkboxClass, hintId));
  }
  try {
    const res = await fetch(`${API}/api/line-config`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    const roster = Array.isArray(cfg.recipients) ? cfg.recipients : [];
    const enabled = roster.filter(r => r.enabled);
    listEl.innerHTML = enabled.map(r => {
      const icon = r.type === 'group'
        ? '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-users"/></svg>'
        : r.type === 'room'
        ? '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-map"/></svg>'
        : '<svg aria-hidden="true" width="12" height="12" style="vertical-align:-2px"><use href="#icon-face"/></svg>';
      const idShort = escapeHtml((r.id || '').slice(0, 8) + '…');
      return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
        <input type="checkbox" class="${checkboxClass}" value="${escapeHtml(r.id)}">
        <span style="flex:1">${icon} ${escapeHtml(r.name || r.id)} <span style="color:var(--text-secondary);font-size:10px">${idShort}</span></span>
      </label>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="color:var(--status-bad);padding:6px">${escapeHtml(I18N.t('hr.recipLoadFailed'))}${escapeHtml(e.message)}</div>`;
  }
  _rptUpdateSendBtnLabel(btnId, checkboxClass, hintId);
}

function _rptUpdateSendBtnLabel(btnId, checkboxClass, hintId) {
  const n = document.querySelectorAll(`.${checkboxClass}:checked`).length;
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.textContent = I18N.t('rpt.sendNowN').replace('{n}', n);
    btn.disabled = n === 0;
    btn.style.opacity = n === 0 ? 0.5 : 1;
    btn.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
  }
  const hint = document.getElementById(hintId);
  if (hint) {
    hint.style.display = n === 0 ? 'block' : 'none';
  }
}

function _rptGetRecipientIds(checkboxClass) {
  return [...document.querySelectorAll(`.${checkboxClass}:checked`)].map(c => c.value);
}

async function sendAnalyticsReportNow() {
  const recipients = _rptGetRecipientIds('rptRecipCheck-rb');
  if (recipients.length === 0) { alert(I18N.t('rpt.needRecipient')); return; }
  if (!confirm(I18N.t('rpt.confirmSendN').replace('{n}', recipients.length))) return;

  try {
    const range = _computeReportRange();
    if (!range) { alert(I18N.t('rep.pickFullRange')); return; }
    const checked = new Set([...document.querySelectorAll('.rb-domains input:checked')].map(c => c.dataset.dom).filter(Boolean));
    const title = (document.getElementById('rbTitle')?.value || document.getElementById('reportTitle')?.value) || I18N.t('rep.fallbackTitle');
    const opts = _rptOpts();
    const lang = I18N.getLang ? I18N.getLang() : 'th';

    const res = await fetch(`${API}/api/reports/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family: 'analytics',
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        title,
        layout: 'full',
        site_id: _rptActiveSiteId || null,
        domains: [...checked].join(',') || null,
        kpis: opts.kpis ? opts.kpis.join(',') : null,
        catsort: opts.catsort,
        recipients,
        lang,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    if (j.success) {
      alert(I18N.t('rpt.sendOk').replace('{n}', j.sent_count).replace('{t}', j.total_recipients));
    } else {
      alert(I18N.t('rpt.sendFailed') + (j.error || 'unknown'));
    }
  } catch (e) { alert(I18N.t('rpt.sendFailed') + e.message); }
}

async function sendLprReportNow() {
  const recipients = _rptGetRecipientIds('rptRecipCheck-lp');
  if (recipients.length === 0) { alert(I18N.t('rpt.needRecipient')); return; }
  if (!confirm(I18N.t('rpt.confirmSendN').replace('{n}', recipients.length))) return;

  try {
    const group = document.getElementById('rptLprGroup')?.value || 'all';
    const lang = I18N.getLang ? I18N.getLang() : 'th';
    const activeSecs = Object.keys(_rptLprSections).filter(s => _rptLprSections[s]);
    const title = document.getElementById('lpTitle')?.value.trim() || I18N.t('rpt.lprTitle');
    const qs = new URLSearchParams({ group, sections: activeSecs.join(','), lang });
    _rptApplyRangeQs(qs, _rptLprPeriod, 'rptLprFrom', 'rptLprTo');
    if (_rptActiveSiteId) qs.set('site_id', String(_rptActiveSiteId));

    // Extract period/from/to from query params for the POST body
    const period = qs.get('period');
    const from = qs.get('from');
    const to = qs.get('to');

    const res = await fetch(`${API}/api/reports/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family: 'lpr',
        period,
        group,
        sections: activeSecs.join(','),
        from,
        to,
        title,
        recipients,
        lang,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    if (j.success) {
      alert(I18N.t('rpt.sendOk').replace('{n}', j.sent_count).replace('{t}', j.total_recipients));
    } else {
      alert(I18N.t('rpt.sendFailed') + (j.error || 'unknown'));
    }
  } catch (e) { alert(I18N.t('rpt.sendFailed') + e.message); }
}

// ============================================================
// Reports Redesign R2 — tab shell + Face/LPR live previews
// ============================================================

let _rptBound = false;
let _rptActiveTab = 'build';
let _rptFacePeriod = 'today';
let _rptFaceScore = 80;
let _rptLprPeriod = 'today';
let _rptCharts = [];
const _rptFaceSections = { peak: true, demographics: true, trend: true, persons: true, suspects: true };
const _rptLprSections = { peak: true, province: true, vtype: true, direction: true, watch: true };
let _rptBuildType = 'daily';
let _rptActiveSiteId = null;
let _hrRange = '24h';
let _hrFmt = 'png';
let _faFmt = 'pdf';   // person report is multi-page → PDF only (PNG btn disabled)
let _lpFmt = 'image';

function initReportsRedesign() {
  if (_rptBound) {
    _rptShowTab(_rptActiveTab);
    return;
  }
  _rptBound = true;

  // ชื่อหัวข้อรายงานที่ตั้งเอง — วาดป้าย + ปุ่มดินสอทั้งสองรายการตั้งแต่เปิดหน้า
  // (ค่าโหลดมาแล้วตอน boot ใน dashboard.js พร้อม nav_hidden_pages)
  _rptApplySecLabels();
  _rptBindSecTitleEdit();

  // Tab switching
  document.getElementById('rptTabBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rpt-tab]');
    if (!btn) return;
    _rptShowTab(btn.dataset.rptTab);
  });

  // Build tab — type seg (auto-fill date range on switch)
  document.getElementById('rptTypeSeg')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rt]');
    if (!btn) return;
    _rptBuildType = btn.dataset.rt;
    document.getElementById('rptTypeSeg')?.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.rt === _rptBuildType);
    });
    _rptToggleSummaryFields('build', _rptBuildType === 'summary');
    _rptBuildAutoFillDates();
  });

  // Health range bar
  document.getElementById('hrRangeBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hr]');
    if (!btn) return;
    _hrRange = btn.dataset.hr;
    document.getElementById('hrRangeBar')?.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.hr === _hrRange);
    });
    if (_hrRange !== 'custom') _hrAutoFill(_hrRange);
  });

  // Health format bar
  document.getElementById('hrFmtBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hfmt]');
    if (!btn) return;
    _hrFmt = btn.dataset.hfmt;
    document.getElementById('hrFmtBar')?.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.hfmt === _hrFmt);
    });
    const dl = document.getElementById('hrDownload');
    if (dl) dl.querySelector('span[data-i18n]').textContent =
      _hrFmt === 'pdf' ? I18N.t('hr.btnDownloadPdf') : I18N.t('hr.btnDownloadPng');
  });

  // Face controls (keep existing IDs)
  document.getElementById('rptFacePeriod')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rpt-period]');
    if (!btn) return;
    _rptFacePeriod = btn.dataset.rptPeriod;
    _rptSetActive('rptFacePeriod', 'rptPeriod', _rptFacePeriod);
    if (_rptFacePeriod !== 'custom') _rptAutoFillRange('rptFaceFrom', 'rptFaceTo', _rptFacePeriod);
    loadFaceReportPreview();
  });
  document.getElementById('rptFaceScore')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rpt-score]');
    if (!btn) return;
    _rptFaceScore = parseInt(btn.dataset.rptScore, 10) || 80;
    _rptSetActive('rptFaceScore', 'rptScore', String(_rptFaceScore));
    loadFaceReportPreview();
  });
  document.getElementById('rptFaceGroup')?.addEventListener('change', loadFaceReportPreview);
  document.getElementById('rptFaceSections')?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-rpt-sec]');
    if (!cb) return;
    _rptFaceSections[cb.dataset.rptSec] = cb.checked;
    loadFaceReportPreview();
  });
  document.getElementById('rptFaceRefresh')?.addEventListener('click', loadFaceReportPreview);

  // Face format bar + combined download
  document.getElementById('faFmtBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ffmt]');
    if (!btn) return;
    _faFmt = btn.dataset.ffmt;
    document.getElementById('faFmtBar')?.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.ffmt === _faFmt);
    });
    const lbl = document.getElementById('faDownloadLabel');
    if (lbl) lbl.textContent = _faFmt === 'pdf' ? I18N.t('rpt.downloadPdf') : I18N.t('rpt.downloadPng');
  });
  document.getElementById('faDownload')?.addEventListener('click', () => _downloadFaceReport(_faFmt));
  // Live title — update the preview header as the user types (no re-fetch)
  document.getElementById('faTitle')?.addEventListener('input', (e) => {
    const t = document.querySelector('#rptFaceDoc .rpt-title-doc');
    if (t) t.textContent = e.target.value.trim() || _rptLabel('rpt.faceTitle', 'รายงานบุคคล');
  });

  // LPR controls (keep existing IDs)
  document.getElementById('rptLprPeriod')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rpt-period]');
    if (!btn) return;
    _rptLprPeriod = btn.dataset.rptPeriod;
    _rptSetActive('rptLprPeriod', 'rptPeriod', _rptLprPeriod);
    if (_rptLprPeriod !== 'custom') _rptAutoFillRange('rptLprFrom', 'rptLprTo', _rptLprPeriod);
    loadLprReportPreview();
  });
  document.getElementById('rptLprGroup')?.addEventListener('change', loadLprReportPreview);
  document.getElementById('rptLprSections')?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-rpt-sec]');
    if (!cb) return;
    _rptLprSections[cb.dataset.rptSec] = cb.checked;
    loadLprReportPreview();
  });
  document.getElementById('rptLprRefresh')?.addEventListener('click', loadLprReportPreview);

  // LPR format bar + combined download
  document.getElementById('lpFmtBar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lfmt]');
    if (!btn) return;
    _lpFmt = btn.dataset.lfmt;
    document.getElementById('lpFmtBar')?.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.lfmt === _lpFmt);
    });
    const lbl = document.getElementById('lpDownloadLabel');
    if (lbl) lbl.textContent = _lpFmt === 'pdf' ? I18N.t('rpt.downloadPdf') : I18N.t('rpt.downloadPng');
  });
  document.getElementById('lpDownload')?.addEventListener('click', () => _downloadLprReport(_lpFmt));
  document.getElementById('lpTitle')?.addEventListener('input', (e) => {
    const t = document.querySelector('#rptLprDoc .rpt-title-doc');
    if (t) t.textContent = e.target.value.trim() || _rptLabel('rpt.lprTitle', 'รายงานป้ายทะเบียน');
  });
  document.getElementById('lpSendLine')?.addEventListener('click', sendLprReportNow);

  // Analytics send to LINE — wire button
  document.getElementById('rbSendLine')?.addEventListener('click', sendAnalyticsReportNow);

  // Report Schedule — Site picker
  document.getElementById('rsCatAll')?.addEventListener('click', () => {
    document.querySelectorAll('.rsCatCheck').forEach(c => { c.checked = true; });
  });
  document.getElementById('rsCatNone')?.addEventListener('click', () => {
    document.querySelectorAll('.rsCatCheck').forEach(c => { c.checked = false; });
  });
  document.getElementById('rsSite')?.addEventListener('change', (e) => {
    _rsUpdateSiteHint();
    // หมวดเป็นของราย Site — เปลี่ยนไซต์แล้วรายการต้องตามไป ไม่งั้นจะเหลือ id
    // ของไซต์เดิมค้างอยู่ ซึ่งพอถึงเวลาส่งจริงจะกรองไม่ตรงกับที่เห็นตอนตั้ง
    _rsLoadCatPicker(e.target.value || '', null, null);
  });

  // rsFamily/rsType/rsLayout เคยผูกด้วย inline onchange= ซึ่ง CSP ของเรา
  // (script-src 'self' ไม่มี unsafe-inline) บล็อกทิ้งเงียบ ๆ — ฟอร์มจึงไม่เคย
  // สลับช่องตามประเภท/ความถี่ที่เลือกเลย พบ 2026-08-23 ตอนเพิ่มตัวเลือก analytics
  // (บั๊กชนิดเดียวกับ LPR Gallery ที่ย้ายไป data-action ไปแล้ว)
  ['rsFamily', 'rsType', 'rsLayout'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', _rsToggleTypeFields);
  });

  // History tab
  document.getElementById('rptHistRefresh')?.addEventListener('click', loadRptHistory);
  document.getElementById('rptHistExportCsv')?.addEventListener('click', exportReportHistoryCsv);

  // Init scope bar
  _initRptScopeBar();

  // ⚠️ ต้องผูก AirDatepicker ให้ช่องวันที่ของหน้านี้ก่อนเติมค่า — ตอนบูตหน้ายังไม่ถูก
  //    ผูกจริง (วัดแล้ว rbFrom._adp = false) ค่าจึงตกไปใช้ fallback แล้วขึ้นเป็น
  //    '2026-08-21T14:54' พร้อมเวลา ทั้งที่รายงานเป็นรายวัน · ฟังก์ชันนี้ข้ามช่องที่
  //    ผูกแล้วอยู่แล้ว เรียกซ้ำจึงไม่มีผลข้างเคียง
  if (typeof initDateTimePickers === 'function') initDateTimePickers();

  // Auto-fill build tab dates on init
  _rptBuildAutoFillDates();

  _rptShowTab(_rptActiveTab);
}

function _rptBuildAutoFillDates() {
  const today = new Date();
  if (_rptBuildType === 'daily') {
    setDtValue('rbFrom', today);
    setDtValue('rbTo',   today);
  } else if (_rptBuildType === 'weekly') {
    const dow = (today.getDay() + 6) % 7;
    const mon = new Date(today); mon.setDate(today.getDate() - dow);
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
    setDtValue('rbFrom', mon);
    setDtValue('rbTo',   sun);
  } else if (_rptBuildType === 'monthly') {
    // Previous calendar month (consistent with schedule monthly behavior since 2026-09-03)
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const first = prevMonth;
    const last  = new Date(today.getFullYear(), today.getMonth(), 0);  // last day of prev month
    setDtValue('rbFrom', first);
    setDtValue('rbTo',   last);
  } else if (_rptBuildType === 'summary') {
    // Summary: anchor is yesterday (the day being summarized)
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    setDtValue('rbFrom', yest);
    setDtValue('rbTo',   yest);
  }
  _refreshReportRangeNote();
}

let _rptSites = [];  // cached /api/sites rows (id, name, has_face, has_lpr, has_appearance, ...)

// Hide the face/person/lpr report-domain checkboxes when the ACTIVE site
// selection has no camera of that type. "ทั้งหมด" (no site chosen) unions
// capability across every visible site — matches nav-hide's "any site has
// it" logic, just scoped to the currently selected chip instead of the
// whole session. Unchecks a hidden checkbox so it can't silently stay
// selected and get fetched via a stale scope switch. Person uses
// has_appearance (cam_role='standard' VCA data), NOT has_face — a
// face-recognition camera produces zero Person-class events on this
// platform, so the two are independent capabilities.
function _applyRptDomainVisibility() {
  const sites = _rptActiveSiteId
    ? _rptSites.filter(s => s.id === _rptActiveSiteId)
    : _rptSites;
  const hasFace       = sites.some(s => s.has_face);
  const hasLpr         = sites.some(s => s.has_lpr);
  const hasAppearance  = sites.some(s => s.has_appearance);
  document.querySelectorAll('.rb-domains .rb-dom').forEach(label => {
    const input = label.querySelector('input[data-dom]');
    const dom = input?.dataset.dom;
    const visible = dom === 'face' ? hasFace
                  : dom === 'person' ? hasAppearance
                  : dom === 'lpr' ? hasLpr
                  : true; // events always visible
    label.style.display = visible ? '' : 'none';
    if (!visible && input) input.checked = false;
  });
  _applyRptTabVisibility(hasFace, hasLpr);
}

// Hide the standalone Face/LPR report-view tabs (separate from the domain
// checkboxes above) the same way, tied to the same active-site scope. If the
// user is currently sitting on a tab that just got hidden, fall back to the
// events ("build") tab so they never land on a blank pane.
function _applyRptTabVisibility(hasFace, hasLpr) {
  const tabFace = document.querySelector('#rptTabBar [data-rpt-tab="face"]');
  const tabLpr  = document.querySelector('#rptTabBar [data-rpt-tab="lpr"]');
  if (tabFace) tabFace.style.display = hasFace ? '' : 'none';
  if (tabLpr)  tabLpr.style.display  = hasLpr  ? '' : 'none';
  if ((_rptActiveTab === 'face' && !hasFace) || (_rptActiveTab === 'lpr' && !hasLpr)) {
    _rptShowTab('build');
  }
}

async function _initRptScopeBar() {
  const bar = document.getElementById('rptScopeBar');
  const siteBar = document.getElementById('rptSiteBar');
  if (!bar || !siteBar) return;
  try {
    const res = await fetch(`${API}/api/sites`, { cache: 'no-store' });
    if (!res.ok) return;
    const sites = await res.json();
    if (!Array.isArray(sites) || !sites.length) return;
    _rptSites = sites;
    bar.style.display = '';
    if (sites.length === 1) {
      _rptActiveSiteId = sites[0].id;
      siteBar.innerHTML = `<span class="site-tag active" style="cursor:default">${escapeHtml(sites[0].name)}</span>`;
      _applyRptDomainVisibility();
      return;
    }
    siteBar.innerHTML = `<button class="site-tag all active" data-site-id="">${escapeHtml(I18N.t('common.all'))}</button>` +
      sites.map(s => `<button class="site-tag" data-site-id="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}</button>`).join('');
    siteBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.site-tag');
      if (!btn) return;
      siteBar.querySelectorAll('.site-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _rptActiveSiteId = btn.dataset.siteId ? parseInt(btn.dataset.siteId) : null;
      _applyRptDomainVisibility();
      if (_rptActiveTab === 'face') loadFaceReportPreview();
      else if (_rptActiveTab === 'lpr') loadLprReportPreview();
      // Health only re-renders when a preview is already on screen. Generating
      // one costs a Puppeteer/sharp pass, so switching site with an empty panel
      // should not trigger it — but leaving a rendered image from the previous
      // site sitting there is worse, because nothing on it says which site it
      // is. Events is left alone on purpose: it waits for "โหลดข้อมูล" by design.
      else if (_rptActiveTab === 'health'
               && document.getElementById('hrPreviewDoc')?.querySelector('img')) {
        previewHealthReport();
      }
    });
    _applyRptDomainVisibility();
  } catch {}
}

async function loadRptHistory() {
  const tbody = document.getElementById('rptHistList');
  const pager = document.getElementById('rptHistPager');
  const sub   = document.getElementById('rptHistSub');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</td></tr>`;
  try {
    const res = await fetch(`${API}/api/report-history?limit=50&offset=0`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items, total } = await res.json();
    if (sub) sub.textContent = `${total} ${I18N.t('rh.rows') || 'รายการ'}`;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('rh.noHistory'))}</td></tr>`;
      if (pager) pager.innerHTML = '';
      return;
    }
    const _RS_TYPE = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly'), summary: I18N.t('rs.typeSummary'), health: I18N.t('hr.typeHealth') };
    const _RS_LAY  = { compact: I18N.t('rs.layoutCompact'), full: I18N.t('rs.layoutFull') };
    tbody.innerHTML = items.map(row => {
      const ts = new Date(row.created_at).toLocaleString('th-TH', { hour12: false });
      const ok = row.status === 'success';
      const statusBadge = ok
        ? `<span class="hist-state ok">${escapeHtml(I18N.t('rs.statusSuccess'))}</span>`
        : `<span class="hist-state fail" title="${escapeHtml(row.error_message || '')}">${escapeHtml(row.status)}</span>`;
      const pngBtn = row.file_path
        ? `<a href="${API}/api/report-history/${row.id}/image" class="btn btn-secondary" style="padding:3px 12px;font-size:11px;text-decoration:none">${escapeHtml(I18N.t('rh.downloadPng') || 'PNG')}</a>`
        : '';
      return `<tr>
        <td>${escapeHtml(ts)}</td>
        <td>${escapeHtml(_RS_TYPE[row.report_type] || row.report_type || '—')}</td>
        <td>${escapeHtml(_RS_LAY[row.image_layout] || row.image_layout || '—')}</td>
        <td style="text-align:center">${ok ? `${row.sent_count}/${row.total_recipients}` : '<span style="color:var(--text-secondary)">—</span>'}</td>
        <td>${statusBadge}</td>
        <td style="text-align:right">${pngBtn}</td>
      </tr>`;
    }).join('');
    if (pager) pager.innerHTML = `<span style="color:var(--text-secondary)">${total} ${escapeHtml(I18N.t('rh.rows') || 'รายการ')}</span>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;color:var(--status-bad)">${escapeHtml(I18N.t('rh.loadFailed'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function _rptDestroyCharts() {
  _rptCharts.forEach(c => { try { c.destroy(); } catch {} });
  _rptCharts = [];
}

function _rptSetActive(id, datasetKey, value) {
  document.getElementById(id)?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset[datasetKey] === value);
  });
}

function _rptShowTab(tab) {
  _rptActiveTab = tab || 'build';
  document.querySelectorAll('#rptTabBar [data-rpt-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rptTab === _rptActiveTab);
  });
  document.querySelectorAll('#page-reports .rpt-pane').forEach(p => p.classList.remove('active'));
  const paneMap = { build: 'rptPaneBuild', health: 'rptPaneHealth', face: 'rptPaneFace', lpr: 'rptPaneLpr', auto: 'rptPaneAuto', history: 'rptPaneHistory' };
  document.getElementById(paneMap[_rptActiveTab] || 'rptPaneBuild')?.classList.add('active');
  if (_rptActiveTab === 'build') {
    _rptLoadRecipientsForTab(document.getElementById('rbRecipientsList'), 'rptRecipCheck-rb', 'rbSendLine', 'rbRecipHint');
  }
  if (_rptActiveTab === 'face')    { if (_rptFacePeriod !== 'custom') _rptAutoFillRange('rptFaceFrom', 'rptFaceTo', _rptFacePeriod); loadFaceReportPreview(); loadHealthRecipients(); }
  if (_rptActiveTab === 'lpr')     {
    if (_rptLprPeriod !== 'custom') _rptAutoFillRange('rptLprFrom', 'rptLprTo', _rptLprPeriod);
    _rptLoadRecipientsForTab(document.getElementById('lpRecipientsList'), 'rptRecipCheck-lp', 'lpSendLine', 'lpRecipHint');
    loadLprReportPreview();
  }
  if (_rptActiveTab === 'health')  { if (_hrRange !== 'custom') _hrAutoFill(_hrRange); loadHealthRecipients(); previewHealthReport(); }
  if (_rptActiveTab === 'auto')    _loadAutoSchedList();
  if (_rptActiveTab === 'history') loadRptHistory();
}

async function _loadAutoSchedList() {
  const el = document.getElementById('autoSchedList');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/report-schedules`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    _rsRowMap.clear();
    list.forEach(s => _rsRowMap.set(s.id, s));
    if (!list.length) {
      el.innerHTML = `<div class="rpt-empty">${escapeHtml(I18N.t('rs.noSchedules'))}</div>`;
      return;
    }
    const _RS_TYPE = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly'), summary: I18N.t('rs.typeSummary'), health: I18N.t('hr.typeHealth') };
    el.innerHTML = list.map(s => {
      const stateClass = s.enabled ? 'on' : 'off';
      const stateLabel = s.enabled ? I18N.t('rs.enabledOn') : I18N.t('rs.enabledOff');
      const typeLabel  = _RS_TYPE[s.report_type] || s.report_type;
      const timeLabel  = String(s.send_time || '').slice(0, 5);
      const lastRun    = s.last_run_at ? new Date(s.last_run_at).toLocaleString('th-TH', { hour12: false }) : I18N.t('rs.notRunYet');
      return `<div class="sched-card${s.enabled ? '' : ' off'}">
        <div class="sched-main">
          <div class="sched-row1">
            <span class="sched-name">${escapeHtml(typeLabel)} · ${escapeHtml(timeLabel)}</span>
          </div>
          <div class="sched-row2">${escapeHtml(I18N.t('rs.colLastRun'))}: ${escapeHtml(lastRun)}</div>
        </div>
        <div class="sched-side">
          <span class="sched-state ${stateClass}">${escapeHtml(stateLabel)}</span>
          <button class="csv-btn" style="font-size:10px" data-action="runReportNow" data-id="${s.id}">▶</button>
          <button class="csv-btn" style="font-size:10px" data-action="editReportSched" data-id="${s.id}"><svg aria-hidden="true" width="11" height="11"><use href="#icon-edit"/></svg></button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div class="rpt-empty" style="color:var(--status-bad)">${escapeHtml(e.message)}</div>`;
  }
}

function _rptEsc(v) {
  return escapeHtml(v == null ? '' : String(v));
}

function _rptFmt(n) {
  return (Number(n) || 0).toLocaleString();
}

function _rptLabel(key, fallback) {
  return I18N.t(key, fallback);
}

function _rptToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function _rptCssColor(value, fallback = 'var(--status-bad)') {
  const v = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^var\(--[A-Za-z0-9_-]+\)$/.test(v)) return v;
  return fallback;
}

// Unified report header — same layout as the analytics report
// (report-template.js): logo + title + scope (left) · brand / tagline /
// generated-at (right). `sub` is kept in the signature for back-compat but the
// scope line now uses `meta` to match analytics.
function _rptHeader(title, sub, meta) {
  const brandName = _brand?.name || 'Vigil Platform';
  const tagline = _brand?.tagline || '';
  const logoUrl = _brand?.logo_url ? `${_brand.logo_url}?v=${Date.now()}` : null;
  const genLocale = (I18N.getLang ? I18N.getLang() : 'th') === 'en' ? 'en-GB' : 'th-TH';
  const genStr = `${_rptLabel('rpt.generatedAt', 'สร้างเมื่อ')} ${new Date().toLocaleString(genLocale, { hour12: false })}`;
  const logo = logoUrl
    ? `<img src="${_rptEsc(logoUrl)}" alt="logo" class="rpt-logo-img">`
    : `<span class="rpt-logo">${_rptEsc(brandName.slice(0, 1) || 'V')}</span>`;
  return `<div class="rpt-head">
    <div class="rpt-brand">${logo}<div><div class="rpt-title-doc">${_rptEsc(title)}</div><div class="rpt-muted">${_rptEsc(meta)}</div></div></div>
    <div class="rpt-head-meta"><div class="rpt-brand-name">${_rptEsc(brandName)}</div>${tagline ? `<div class="rpt-brand-sub">${_rptEsc(tagline)}</div>` : ''}<div class="rpt-muted">${_rptEsc(genStr)}</div></div>
  </div>`;
}

function _rptKpis(items) {
  return `<div class="rpt-execrow">${items.map(t => `<div class="rpt-exec" style="--ka:${_rptEsc(t.color)}"><div class="rpt-exec-v">${_rptFmt(t.value)}</div><div class="rpt-exec-k">${_rptEsc(t.label)}</div></div>`).join('')}</div>`;
}

// Thai day-of-week label remap (backend always sends English abbreviations)
function _rptRemapDayLabels(labels) {
  if ((I18N.getLang ? I18N.getLang() : 'th') === 'en') return labels;
  const MAP = { Sun:'อา.',Mon:'จ.',Tue:'อ.',Wed:'พ.',Thu:'พฤ.',Fri:'ศ.',Sat:'ส.' };
  return (labels || []).map(l => MAP[l] || l);
}

// Inline Chart.js plugin — draws value above each bar (no external lib needed)
const _rptBarLabelPlugin = {
  id: 'rpt-barlabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, i) => {
      chart.getDatasetMeta(i).data.forEach((bar, j) => {
        const v = ds.data[j];
        if (!v) return;
        ctx.save();
        ctx.fillStyle = Chart.defaults.color || '#718096';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(v, bar.x, bar.y - 2);
        ctx.restore();
      });
    });
  }
};

// Vehicle-type code → Thai label, matching the search page (`_lprVType` reads the
// lpr_vehicle_types display config). Guarded — `_lprVType` lives in page-lpr.js.
function _rptVtypeName(t) { return (typeof _lprVType === 'function' ? _lprVType(t) : t) || t; }
// Same table the server renderer uses (province-names.js), so the HTML preview
// and the exported PNG cannot disagree about what a province is called.
function _rptProvName(n) {
  return (typeof provinceNameEn === 'function') ? provinceNameEn(n, I18N.getLang()) : n;
}

function _rptChart(canvasId, type, labels, datasets, extra = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  // noBarLabels: skip the on-bar value labels (e.g. province — the side table
  // already shows the numbers). Pulled out so it doesn't leak into Chart options.
  const { noBarLabels, ...opts } = extra;
  const grid = _rptToken('--border-hairline');
  Chart.defaults.color = _rptToken('--text-secondary');
  _rptCharts.push(new Chart(canvas, {
    type,
    data: { labels, datasets },
    plugins: (type === 'bar' && !noBarLabels) ? [_rptBarLabelPlugin] : [],
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: type === 'doughnut' ? undefined : {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { grid: { color: grid }, ticks: { font: { size: 11 } } },
      },
      ...opts,
    },
  }));
}

function _rptRenderEmpty(el, msgKey, fallback) {
  el.innerHTML = `<div class="rpt-empty">${_rptEsc(_rptLabel(msgKey, fallback))}</div>`;
}

function _downloadFaceReport(fmt) {
  const group = document.getElementById('rptFaceGroup')?.value || 'all';
  const sections = Object.entries(_rptFaceSections).filter(([, v]) => v).map(([k]) => k).join(',');
  const lang = I18N.getLang ? I18N.getLang() : 'th';
  const qs = new URLSearchParams({ group, min_score: String(_rptFaceScore), sections, lang });
  _rptApplyRangeQs(qs, _rptFacePeriod, 'rptFaceFrom', 'rptFaceTo');
  const title = document.getElementById('faTitle')?.value.trim();
  if (title) qs.set('title', title);
  window.location = `${API}/api/reports/face/${fmt}?${qs}`;
}

function _downloadLprReport(fmt) {
  const group = document.getElementById('rptLprGroup')?.value || 'all';
  const sections = Object.entries(_rptLprSections).filter(([, v]) => v).map(([k]) => k).join(',');
  const lang = I18N.getLang ? I18N.getLang() : 'th';
  const qs = new URLSearchParams({ group, sections, lang });
  _rptApplyRangeQs(qs, _rptLprPeriod, 'rptLprFrom', 'rptLprTo');
  const title = document.getElementById('lpTitle')?.value.trim();
  if (title) qs.set('title', title);
  window.location = `${API}/api/reports/lpr/${fmt}?${qs}`;
}

async function loadFaceReportPreview() {
  const el = document.getElementById('rptFaceDoc');
  if (!el) return;
  _rptDestroyCharts();
  el.innerHTML = `<div class="rpt-empty">${_rptEsc(I18N.t('common.loading'))}</div>`;
  const group = document.getElementById('rptFaceGroup')?.value || 'all';
  const qs = new URLSearchParams({ group, min_score: String(_rptFaceScore) });
  _rptApplyRangeQs(qs, _rptFacePeriod, 'rptFaceFrom', 'rptFaceTo');
  if (_rptActiveSiteId) qs.set('site_id', String(_rptActiveSiteId));
  try {
    const res = await fetch(`${API}/api/stats/face/report?${qs}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _rptPopulateFaceGroups(data.groups || [], group);
    renderFaceReportPreview(data);
  } catch (err) {
    _rptRenderEmpty(el, 'rpt.loadFailed', `โหลดรายงานไม่สำเร็จ: ${err.message}`);
  }
}

function _rptPopulateFaceGroups(groups, selected) {
  const sel = document.getElementById('rptFaceGroup');
  if (!sel) return;
  const current = selected || sel.value || 'all';
  sel.innerHTML = `<option value="all">${_rptEsc(I18N.t('common.all'))}</option>` +
    groups.map(g => `<option value="${_rptEsc(g)}">${_rptEsc(g)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === current) ? current : 'all';
}

function renderFaceReportPreview(data) {
  const el = document.getElementById('rptFaceDoc');
  const k = data.kpi || {};
  const d = data.demographics || {};
  const activeSecs = Object.keys(_rptFaceSections).filter(s => _rptFaceSections[s]);
  const meta = `${_rptLabel('rpt.period', 'ช่วงข้อมูล')}: ${_rptEsc(data.period)} · ${_rptLabel('rpt.minScore', 'ความมั่นใจขั้นต่ำ')} ${_rptFmt(data.min_score)}%`;
  if (data.peak?.labels)  data.peak.labels  = _rptRemapDayLabels(data.peak.labels);
  if (data.trend?.labels) data.trend.labels = _rptRemapDayLabels(data.trend.labels);
  const sections = [];
  if (_rptFaceSections.peak) sections.push(_rptPeakSection('rptFacePeakChart', data.peak, _rptLabel('rpt.peak', 'ช่วงหนาแน่น')));
  if (_rptFaceSections.demographics) {
    sections.push(_rptFaceDemoSection(d));
    sections.push(_rptFaceAccessoriesSection(d.accessories, k.captures || 0));
  }
  if (_rptFaceSections.trend) sections.push(_rptTrendSection('rptFaceTrendChart', data.trend, _rptLabel('rpt.trend', 'แนวโน้ม')));
  if (_rptFaceSections.persons) sections.push(_rptPersonsSection(data.top_persons || []));
  if (_rptFaceSections.suspects) sections.push(_rptFaceSuspectsSection(data.suspects || []));
  el.innerHTML = _rptHeader((document.getElementById('faTitle')?.value.trim() || _rptLabel('rpt.faceTitle', 'รายงานบุคคล')), _rptLabel('rpt.faceSubtitle', 'ข้อมูลบุคคลจากระบบใบหน้า'), meta) +
    _rptKpis([
      { label: _rptLabel('rpt.captures', 'ใบหน้าทั้งหมด'), value: k.captures, color: 'var(--accent)' },
      { label: _rptLabel('rpt.known', 'จดจำได้'), value: k.known, color: 'var(--accent-muted)' },
      { label: _rptLabel('rpt.unknown', 'ไม่รู้จัก'), value: k.unknown, color: 'var(--warn)' },
      { label: _rptLabel('rpt.watch', 'เฝ้าระวัง'), value: k.watch, color: 'var(--status-bad)' },
    ]) +
    (activeSecs.length ? sections.join('') : `<div class="rpt-empty">${_rptEsc(_rptLabel('rpt.pickOneSection', 'เลือกเนื้อหาอย่างน้อย 1 หมวด'))}</div>`) +
    `<div class="rpt-foot"><span>${_rptEsc(_rptLabel('rpt.pdpaFace', 'เอกสารลับ · ข้อมูลใบหน้าเป็นข้อมูลอ่อนไหว'))}</span><span>Vigil Platform</span></div>`;
  _rptBuildFaceCharts(data);
  document.getElementById('rptFaceSummary').innerHTML =
    `<div><b>${_rptEsc(_rptLabel('rpt.period', 'ช่วงข้อมูล'))}:</b> ${_rptEsc(data.period)}</div>` +
    `<div><b>${_rptEsc(_rptLabel('rpt.faceGroup', 'กลุ่ม FDLib'))}:</b> ${_rptEsc(data.group === 'all' ? I18N.t('common.all') : data.group)}</div>` +
    `<div><b>${_rptEsc(_rptLabel('rpt.minScore', 'ความมั่นใจขั้นต่ำ'))}:</b> ${_rptEsc(data.min_score)}%</div>`;
}

function _rptPeakSection(canvasId, peak, label) {
  const max = peak?.max || 0;
  const idx = peak?.index ?? -1;
  const peakLabel = idx >= 0 ? (peak.labels || [])[idx] : '-';
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>${_rptEsc(label)} <span class="rpt-pill">${_rptEsc(peakLabel)} · ${_rptFmt(max)}</span></div><div class="rpt-chartbox"><canvas id="${canvasId}"></canvas></div></div>`;
}

function _rptTrendSection(canvasId, trend, label) {
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--warn)"></span>${_rptEsc(label)}</div><div class="rpt-chartbox"><canvas id="${canvasId}"></canvas></div></div>`;
}

function _rptFaceDemoSection(d) {
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-ok)"></span>${_rptEsc(_rptLabel('rpt.demographics', 'ข้อมูลประชากร'))}</div>
    <div class="rpt-2col">
      <div class="rpt-chartbox sm"><div class="rpt-chart-cap">${_rptEsc(_rptLabel('rpt.gender', 'เพศ'))}</div><canvas id="rptFaceGenderChart"></canvas></div>
      <div class="rpt-chartbox sm"><div class="rpt-chart-cap">${_rptEsc(_rptLabel('rpt.ageGroup', 'ช่วงอายุ (ปี)'))}</div><canvas id="rptFaceAgeChart"></canvas></div>
    </div>
  </div>`;
}

function _rptFaceAccessoriesSection(accessories, captures) {
  const a = accessories || {};
  const pct = n => captures > 0 ? ' · ' + Math.round(n / captures * 100) + '%' : '';
  const accItems = [
    { label: _rptLabel('rpt.wearGlasses', 'แว่นตา'),   count: a.glass || 0, color: 'var(--accent)' },
    { label: _rptLabel('rpt.wearMask',    'หน้ากาก'),  count: a.mask  || 0, color: 'var(--warn)' },
    { label: _rptLabel('rpt.wearHat',     'หมวก'),     count: a.hat   || 0, color: 'var(--status-ok)' },
    { label: _rptLabel('rpt.carryBag',    'กระเป๋า'),  count: a.bag   || 0, color: 'var(--accent-muted)' },
  ];
  const accHtml = accItems.map(item =>
    `<div class="rpt-acc-item"><div class="rpt-acc-val" style="color:${item.color}">${_rptFmt(item.count)}</div><div class="rpt-acc-sub">${_rptEsc(pct(item.count))}</div><div class="rpt-acc-label">${_rptEsc(item.label)}</div></div>`
  ).join('');
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent-muted)"></span>${_rptEsc(_rptLabel('rpt.accessories', 'ลักษณะ/ของติดตัว'))}</div>
    <div class="rpt-acc-grid">${accHtml}</div>
  </div>`;
}

function _rptPersonsSection(rows) {
  const body = rows.length ? rows.map(p => `<tr><td><span class="rpt-ava">${_rptEsc((p.name || '?').slice(0, 1))}</span>${_rptEsc(p.name || 'Unknown')} <span class="rpt-muted">${_rptEsc(p.group_name || '')}</span></td><td class="rpt-num">${_rptFmt(p.hits)}</td></tr>`).join('') : `<tr><td colspan="2" class="rpt-muted">${_rptEsc(_rptLabel('rpt.noData', 'ไม่มีข้อมูล'))}</td></tr>`;
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent-muted)"></span>${_rptEsc(_rptLabel('rpt.topPersons', 'บุคคลที่พบบ่อย'))}</div><table class="rpt-table">${body}</table></div>`;
}

function _rptFaceSuspectsSection(rows) {
  if (!rows.length) {
    const empty = `<div class="rpt-muted">${_rptEsc(_rptLabel('rpt.noSuspects', 'ไม่พบบุคคลเฝ้าระวังตามเงื่อนไข'))}</div>`;
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-bad)"></span>${_rptEsc(_rptLabel('rpt.suspectHits', 'ผู้ต้องสงสัย/เฝ้าระวัง'))}</div>${empty}</div>`;
  }
  // Show every watch/suspect hit in the period as a card (capped server-side).
  const cards = `<div class="cmp-grid">${rows.map(r => {
    const capImg = r.snapshot
      ? `<img src="${API}/snapshots/${encodeURIComponent(r.snapshot)}" alt="" style="max-width:100%;max-height:80px;border-radius:5px;object-fit:cover;margin-bottom:4px">`
      : '';
    const _refUrl = r.ref_snapshot ? `${API}/snapshots/${encodeURIComponent(r.ref_snapshot)}`
      : r.ref_photo ? `${API}/api/blacklist/photo/${r.ref_photo.split('/').map(encodeURIComponent).join('/')}` : null;
    const refImg = _refUrl
      ? `<img src="${_refUrl}" alt="" style="max-width:100%;max-height:80px;border-radius:5px;object-fit:cover;margin-bottom:4px">`
      : '';
    const dt = r.event_time ? new Date(r.event_time).toLocaleString('th-TH', { hour12: false }) : '-';
    return `<div class="cmp-card" style="--gc:var(--status-bad)">
      <div class="cmp-imgs">
        <div class="cmp-box">${capImg}<span class="cmp-cap">${_rptEsc(_rptLabel('rpt.captured','ภาพจากกล้อง'))}</span><span class="rpt-muted">#${_rptEsc(String(r.id))}</span></div>
        <div class="cmp-box ref">${refImg}<span class="cmp-cap">${_rptEsc(_rptLabel('rpt.reference','ภาพอ้างอิง'))}</span><span class="rpt-muted">${_rptEsc(r.human_id || '-')}</span></div>
      </div>
      <span class="rpt-badge" style="background:var(--status-bad);margin-top:8px;display:inline-block">${_rptEsc(r.group_name || 'blackList')}</span>
      <div class="cmp-name">${_rptEsc(r.name || 'Unknown')}</div>
      <div class="rpt-muted" style="font-size:11px">${_rptEsc(dt)}</div>
      <div class="rpt-muted">${_rptEsc(r.camera_id)} · ${_rptEsc(r.score_pct != null ? String(r.score_pct) : '-')}%</div>
    </div>`;
  }).join('')}</div>`;
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-bad)"></span>${_rptEsc(_rptLabel('rpt.suspectHits', 'ผู้ต้องสงสัย/เฝ้าระวัง'))}</div>${cards}</div>`;
}

function _rptBuildFaceCharts(data) {
  const acc = _rptToken('--accent');
  const warn = _rptToken('--warn');
  const bad = _rptToken('--status-bad');
  const ok = _rptToken('--status-ok');
  if (_rptFaceSections.peak && data.peak) _rptChart('rptFacePeakChart', 'bar', data.peak.labels, [{ data: data.peak.values, backgroundColor: data.peak.values.map((_, i) => i === data.peak.index ? bad : acc), borderRadius: 3 }], { plugins: { legend: { display: false } } });
  if (_rptFaceSections.demographics) {
    const g = data.demographics?.gender || {};
    const a = data.demographics?.age || {};
    _rptChart('rptFaceGenderChart', 'doughnut', [_rptLabel('rpt.male','ชาย'), _rptLabel('rpt.female','หญิง'), _rptLabel('rpt.unknown','ไม่ทราบ')], [{ data: [g.male || 0, g.female || 0, g.unknown || 0], backgroundColor: [acc, bad, _rptToken('--text-secondary')], borderWidth: 0 }], { cutout: '60%', plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } });
    _rptChart('rptFaceAgeChart', 'bar', ['0-19','20-39','40-59','60+'], [{ data: [a.teen || 0, a.young || 0, a.mid || 0, a.senior || 0], backgroundColor: ok, borderRadius: 3 }], { plugins: { legend: { display: false } } });
  }
  if (_rptFaceSections.trend && data.trend) {
    _rptChart('rptFaceTrendChart', 'line', data.trend.labels, [
      { label: _rptLabel('rpt.known','จดจำได้'), data: data.trend.known, borderColor: acc, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
      { label: _rptLabel('rpt.watch','เฝ้าระวัง'), data: data.trend.watch, borderColor: bad, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
      { label: _rptLabel('rpt.unknown','ไม่รู้จัก'), data: data.trend.unknown, borderColor: warn, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
    ]);
  }
}

// Report-builder date range (LPR/Face) — mirror the analytics build tab.
// Preset buttons auto-fill an always-visible from/to row; custom lets the user
// pick. Preset → send period only (keeps server bucket granularity); custom →
// period=custom + from/to ISO (BKK day boundaries via the operator's local tz,
// same conversion as _computeReportRange).
function _rptAutoFillRange(fromId, toId, period) {
  const today = new Date();
  if (period === 'week') {
    const dow = (today.getDay() + 6) % 7;
    const mon = new Date(today); mon.setDate(today.getDate() - dow);
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
    setDtValue(fromId, mon); setDtValue(toId, sun);
  } else if (period === 'month') {
    setDtValue(fromId, new Date(today.getFullYear(), today.getMonth(), 1));
    setDtValue(toId,   new Date(today.getFullYear(), today.getMonth() + 1, 0));
  } else if (period === 'today') {
    setDtValue(fromId, today); setDtValue(toId, today);
  }
}
function _rptApplyRangeQs(qs, period, fromId, toId) {
  if (period === 'custom') {
    const f = getDtValue(fromId), t = getDtValue(toId);
    if (f && t) {
      qs.set('period', 'custom');
      qs.set('from', new Date(f + 'T00:00:00').toISOString());
      qs.set('to',   new Date(t + 'T23:59:59.999').toISOString());
      return;
    }
  }
  qs.set('period', period);
}

async function loadLprReportPreview() {
  const el = document.getElementById('rptLprDoc');
  if (!el) return;
  _rptDestroyCharts();
  el.innerHTML = `<div class="rpt-empty">${_rptEsc(I18N.t('common.loading'))}</div>`;
  const group = document.getElementById('rptLprGroup')?.value || 'all';
  const qs = new URLSearchParams({ group });
  _rptApplyRangeQs(qs, _rptLprPeriod, 'rptLprFrom', 'rptLprTo');
  if (_rptActiveSiteId) qs.set('site_id', String(_rptActiveSiteId));
  try {
    const res = await fetch(`${API}/api/stats/lpr/report?${qs}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _rptPopulateLprGroups(data.groups || [], group);
    renderLprReportPreview(data);
  } catch (err) {
    _rptRenderEmpty(el, 'rpt.loadFailed', `โหลดรายงานไม่สำเร็จ: ${err.message}`);
  }
}

function _rptPopulateLprGroups(groups, selected) {
  const sel = document.getElementById('rptLprGroup');
  if (!sel) return;
  const current = selected || sel.value || 'all';
  sel.innerHTML = `<option value="all">${_rptEsc(I18N.t('common.all'))}</option>` +
    groups.map(g => `<option value="${_rptEsc(g.id)}">${_rptEsc(g.name)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === current) ? current : 'all';
}

function renderLprReportPreview(data) {
  const el = document.getElementById('rptLprDoc');
  const k = data.kpi || {};
  const activeSecs = Object.keys(_rptLprSections).filter(s => _rptLprSections[s]);
  const meta = `${_rptLabel('rpt.period', 'ช่วงข้อมูล')}: ${_rptEsc(data.period)} · ${_rptLabel('rpt.lprHint', 'ตัด unknown ออกจากกราฟ')}`;
  if (data.peak?.labels)      data.peak.labels      = _rptRemapDayLabels(data.peak.labels);
  if (data.direction?.labels) data.direction.labels = _rptRemapDayLabels(data.direction.labels);
  const sections = [];
  if (_rptLprSections.peak) sections.push(_rptPeakSection('rptLprPeakChart', data.peak, _rptLabel('rpt.peak', 'ช่วงหนาแน่น')));
  // Province arrives from the camera in Thai. The report follows the UI language
  // like every other label, instead of leaving Thai names in an English report.
  const _provRows = (data.province || []).map(r => ({ ...r, name: _rptProvName(r.name) }));
  if (_rptLprSections.province) sections.push(_rptBarTableSection('rptLprProvinceChart', _rptLabel('rpt.province', 'จังหวัด'), _provRows, 'name'));
  if (_rptLprSections.vtype) sections.push(_rptBarTableSection('rptLprVtypeChart', _rptLabel('rpt.vehicleType', 'ประเภทรถ'), (data.vehicle_type || []).map(r => ({ ...r, type: _rptVtypeName(r.type) })), 'type'));
  if (_rptLprSections.direction) sections.push(_rptDirectionSection(data.direction));
  if (_rptLprSections.watch) sections.push(_rptLprWatchSection(data.watch_hits || []));
  el.innerHTML = _rptHeader((document.getElementById('lpTitle')?.value.trim() || _rptLabel('rpt.lprTitle', 'รายงานป้ายทะเบียน')), _rptLabel('rpt.lprSubtitle', 'รายงานป้ายทะเบียน'), meta) +
    _rptKpis([
      { label: _rptLabel('rpt.platesTotal', 'ป้ายทั้งหมด'), value: k.total, color: 'var(--accent)' },
      { label: _rptLabel('rpt.localPlates', 'ป้ายซ้ำ'), value: k.local, color: 'var(--accent-muted)' },
      { label: _rptLabel('rpt.visitorPlates', 'ป้ายไม่ซ้ำ'), value: k.visitor, color: 'var(--accent)' },
      { label: _rptLabel('rpt.noHelmet', 'คนไม่ใส่หมวก'), value: k.no_helmet, color: 'var(--warn)' },
      { label: _rptLabel('rpt.watchHits', 'รถเฝ้าระวัง'), value: k.watch, color: 'var(--status-bad)' },
    ]) +
    (activeSecs.length ? sections.join('') : `<div class="rpt-empty">${_rptEsc(_rptLabel('rpt.pickOneSection', 'เลือกเนื้อหาอย่างน้อย 1 หมวด'))}</div>`) +
    `<div class="rpt-foot"><span>${_rptEsc(_rptLabel('rpt.pdpaLpr', 'เอกสารลับ · สำหรับใช้ภายในองค์กรเท่านั้น'))}</span><span>Vigil Platform</span></div>`;
  _rptBuildLprCharts(data);
  document.getElementById('rptLprSummary').innerHTML =
    `<div><b>${_rptEsc(_rptLabel('rpt.period', 'ช่วงข้อมูล'))}:</b> ${_rptEsc(data.period)}</div>` +
    `<div><b>${_rptEsc(_rptLabel('rpt.lprGroup', 'กลุ่มเฝ้าระวัง'))}:</b> ${_rptEsc(data.group === 'all' ? I18N.t('common.all') : data.group)}</div>` +
    `<div><b>${_rptEsc(_rptLabel('rpt.identified', 'ข้อมูลระบุได้'))}:</b> ${_rptFmt(k.identified)}</div>`;
}

function _rptBarTableSection(canvasId, title, rows, key) {
  // Executive layout — bar (magnitude) + table (count + % share). % lets execs
  // read proportions at a glance without a pie/donut.
  const tot = rows.reduce((s, r) => s + (+r.n || 0), 0) || 1;
  const body = rows.length ? rows.map(r =>
    `<tr><td>${_rptEsc(r[key] || r.name || r.type)}</td><td class="rpt-num">${_rptFmt(r.n)}</td><td class="rpt-pct">${((+r.n || 0) / tot * 100).toFixed(1)}%</td></tr>`
  ).join('') : `<tr><td colspan="3" class="rpt-muted">${_rptEsc(_rptLabel('rpt.noData', 'ไม่มีข้อมูล'))}</td></tr>`;
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>${_rptEsc(title)}</div><div class="rpt-2col"><div class="rpt-chartbox"><canvas id="${canvasId}"></canvas></div><table class="rpt-table">${body}</table></div></div>`;
}

function _rptDirectionSection(dir) {
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-ok)"></span>${_rptEsc(_rptLabel('rpt.direction', 'ทิศทางเข้า/ออก'))}</div><div class="rpt-chartbox"><canvas id="rptLprDirChart"></canvas></div></div>`;
}

function _rptLprWatchSection(rows) {
  const body = rows.length ? `<div class="cmp-grid">${rows.slice(0, 8).map(r => {
    const color = _rptCssColor(r.group_color);
    return `<div class="cmp-card" style="--gc:${color}"><div class="cmp-imgs"><div class="cmp-box"><span class="cmp-cap">${_rptEsc(_rptLabel('rpt.captured', 'ภาพจากกล้อง'))}</span><span class="rpt-muted">${_rptEsc(r.camera_id)}</span></div><div class="cmp-box ref"><span class="cmp-cap">${_rptEsc(_rptLabel('rpt.reference', 'ภาพอ้างอิง'))}</span><span class="rpt-muted">${_rptEsc(r.ref_image || r.plate_number)}</span></div></div><span class="rpt-badge" style="background:${color}">${_rptEsc(r.group_name)}</span><div class="cmp-name">${_rptEsc(r.plate_number)}</div><div class="rpt-muted">${_rptEsc([r.region, r.vehicle_type].filter(Boolean).join(' · '))}</div></div>`;
  }).join('')}</div>` : `<div class="rpt-muted">${_rptEsc(_rptLabel('rpt.noWatchHits', 'ไม่พบรถเฝ้าระวังตามเงื่อนไข'))}</div>`;
  return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-bad)"></span>${_rptEsc(_rptLabel('rpt.watchHits', 'รถเฝ้าระวัง'))}</div>${body}</div>`;
}

function _rptBuildLprCharts(data) {
  const acc = _rptToken('--accent');
  const warn = _rptToken('--warn');
  const bad = _rptToken('--status-bad');
  const ok = _rptToken('--status-ok');
  if (_rptLprSections.peak && data.peak) _rptChart('rptLprPeakChart', 'bar', data.peak.labels, [{ data: data.peak.values, backgroundColor: data.peak.values.map((_, i) => i === data.peak.index ? bad : acc), borderRadius: 3 }], { plugins: { legend: { display: false } } });
  // Recomputed here, not shared with renderLprReportPreview: that runs in a
  // different function and the chart must carry the same labels as its table.
  const provRows = (data.province || []).map(r => ({ ...r, name: _rptProvName(r.name) }));
  if (_rptLprSections.province) _rptChart('rptLprProvinceChart', 'bar', provRows.map(r => r.name), [{ data: provRows.map(r => r.n), backgroundColor: acc, borderRadius: 3 }], { indexAxis: 'y', noBarLabels: true, plugins: { legend: { display: false } } });
  if (_rptLprSections.vtype) _rptChart('rptLprVtypeChart', 'bar', (data.vehicle_type || []).map(r => _rptVtypeName(r.type)), [{ data: (data.vehicle_type || []).map(r => r.n), backgroundColor: acc, borderRadius: 3 }], { indexAxis: 'y', noBarLabels: true, plugins: { legend: { display: false } } });
  if (_rptLprSections.direction && data.direction) {
    _rptChart('rptLprDirChart', 'line', data.direction.labels, [
      { label: _rptLabel('rpt.in','เข้า'), data: data.direction.in, borderColor: ok, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
      { label: _rptLabel('rpt.out','ออก'), data: data.direction.out, borderColor: warn, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
    ]);
  }
}

