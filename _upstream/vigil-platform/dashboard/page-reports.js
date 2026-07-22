// ============================================================
// Vigil Platform — Reports Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// Phase 5 — Reports built on Stats v2 endpoints (categories / timeline /
// breakdown / per-camera / heatmap / top-rules / quiet-cameras).
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

async function previewHealthReport() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  const preview = document.getElementById('hrPreviewDoc');
  preview.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  const url = `${API}/api/health/report/preview?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&t=${Date.now()}`;
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
  window.location = `${API}/api/health/report/preview?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&title=${encodeURIComponent(document.getElementById('hrTitle')?.value.trim() || '')}&download=1`;
}

function downloadHealthPdf() {
  const sections = _getHealthSections();
  if (!sections.length) { alert(I18N.t('hr.atLeastOne')); return; }
  const rangeQs = _buildHealthRangeParams();
  if (rangeQs === null) { alert(I18N.t('hr.needCustomRange')); return; }
  window.location = `${API}/api/health/report/pdf?sections=${encodeURIComponent(sections.join(','))}&${rangeQs}&lang=${encodeURIComponent((I18N.getLang ? I18N.getLang() : 'th'))}&title=${encodeURIComponent(document.getElementById('hrTitle')?.value.trim() || '')}`;
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
      body: JSON.stringify({ sections, range, recipients, lang: (I18N.getLang ? I18N.getLang() : 'th') }),
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
  const label = `${from.toLocaleDateString(loc)} – ${to.toLocaleDateString(loc)}`;
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

let _reportData = null;

async function updateReportPreview() {
  const range = _computeReportRange();
  if (!range) { alert(I18N.t('rep.pickFullRange')); return; }
  const title = (document.getElementById('rbTitle')?.value || document.getElementById('reportTitle')?.value) || I18N.t('rep.fallbackTitle');
  const catId = '';
  const camIds = getActiveGroupCameraIds ? getActiveGroupCameraIds() : [];
  const camParam = camIds.length ? `&cameras=${encodeURIComponent(camIds.join(','))}` : '';

  const fromIso = range.from.toISOString();
  const toIso   = range.to.toISOString();
  const catParam = '';
  const checked = new Set([...document.querySelectorAll('.rb-domains input:checked')].map(c => c.dataset.dom).filter(Boolean));
  const siteParam = _rptActiveSiteId ? `&site_id=${_rptActiveSiteId}` : '';

  const preview = document.getElementById('reportPreview');
  if (checked.size === 0) {
    preview.innerHTML = `<div style="text-align:center;padding:80px;color:var(--text-secondary)">${escapeHtml(I18N.t('rpt.pickOneSection'))}</div>`;
    return;
  }
  preview.innerHTML = `<div style="text-align:center;padding:80px;color:var(--text-secondary)">${escapeHtml(I18N.t('rep.loadingData'))}</div>`;

  try {
    let cats, tl, brk, ppl, veh, heat, top, quiet, cov, ev;
    if (checked.has('events')) {
      [cats, tl, brk, ppl, veh, heat, top, quiet, cov, ev] = await Promise.all([
        fetch(`${API}/api/stats/categories?from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : { categories: [] }),
        fetch(`${API}/api/stats/timeline-by-category?from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : { series: [] }),
        fetch(`${API}/api/stats/breakdown-v2?from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : []),
        fetch(`${API}/api/stats/per-camera-counts?kind=people&from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : { per_camera: [] }),
        fetch(`${API}/api/stats/per-camera-counts?kind=vehicle&from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : { per_camera: [] }),
        fetch(`${API}/api/stats/heatmap?from=${fromIso}&to=${toIso}${camParam}${catParam}${siteParam}&domains=${[...checked].join(',')}`).then(r => r.ok ? r.json() : { cells: [] }),
        fetch(`${API}/api/stats/top-rules?from=${fromIso}&to=${toIso}${camParam}${siteParam}&limit=10`).then(r => r.ok ? r.json() : { top: [] }),
        fetch(`${API}/api/stats/quiet-cameras?since_hours=24${siteParam}`).then(r => r.ok ? r.json() : { cameras: [] }),
        fetch(`${API}/api/stats/event-coverage?from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/stats/evidence?from=${fromIso}&to=${toIso}${camParam}${siteParam}`).then(r => r.ok ? r.json() : null),
      ]);
    }
    const [faceData, lprData, personData] = await Promise.all([
      checked.has('face')   ? fetch(`${API}/api/stats/face/report?period=custom&from=${fromIso}&to=${toIso}&min_score=80${siteParam}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      checked.has('lpr')    ? fetch(`${API}/api/stats/lpr/report?period=custom&from=${fromIso}&to=${toIso}${siteParam}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
      checked.has('person') ? fetch(`${API}/api/appearances/stats?from=${fromIso}&to=${toIso}${siteParam}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
    ]);
    _reportData = { range, title, cats, tl, brk, ppl, veh, heat, top, quiet, cov, ev, domains: checked, faceData, lprData, personData };
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
function renderReportPreviewV2() {
  const d = _reportData;
  if (!d) return;
  const preview = document.getElementById('reportPreview');
  if (typeof ReportTemplate === 'undefined') {
    preview.innerHTML = '<div style="padding:40px;color:#c00">report-template.js not loaded</div>';
    return;
  }
  if (!d.domains || d.domains.has('events')) {
    preview.innerHTML = ReportTemplate.buildReportHtml(d, _brand);
    const t = ReportTemplate.computeTrendPoints(d);
    if (t.points.length) ReportTemplate.renderReportTrendChart('reportTrendChart', t.points, t.trunc, _brand && _brand.primary_color);
    ReportTemplate.renderCategoryChart('reportCategoryChart', (d.cats && d.cats.categories) || []);
  } else {
    preview.innerHTML = '';
  }
  if (d.faceData)   preview.insertAdjacentHTML('beforeend', ReportTemplate.buildFaceSection(d.faceData));
  if (d.lprData)    preview.insertAdjacentHTML('beforeend', ReportTemplate.buildLprSection(d.lprData));
  if (d.personData) preview.insertAdjacentHTML('beforeend', ReportTemplate.buildPersonSection(d.personData));
}


// PDF download is now server-rendered via GET /api/reports/pdf — which
// goes through Puppeteer page.pdf() on the SAME /report-print.html the
// scheduler uses. So the downloaded PDF byte-for-byte matches the
// interactive report, uses Chromium's real paginator (no mid-element
// cuts on long weekly/monthly reports), and respects 8mm A4 margins.
// The old html2canvas+jsPDF white-rect approach is gone.
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
    if (camIds && camIds.length) qp.set('cameras', camIds.join(','));
    if (_rptActiveSiteId) qp.set('site_id', _rptActiveSiteId);

    const res = await fetch(`${API}/api/reports/pdf?${qp}`, { cache: 'no-store' });
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
    a.download = `${(_brand?.name || 'vigil').toLowerCase().replace(/\s+/g,'-')}-report-${r.type || 'custom'}-${stamp}.pdf`;
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
  health:  I18N.t('hr.typeHealth'),
};
const _RS_LAYOUT_LABEL = {
  compact: I18N.t('rs.layoutCompact'),
  full:    I18N.t('rs.layoutFull'),
};
let _rsRecipients = [];   // LINE recipient roster (from /api/line-config)
const _rsRowMap = new Map(); // id → schedule row (avoids JSON in onclick attrs)

function openReportScheduleModal() {
  document.getElementById('reportScheduleModal').classList.remove('hidden');
  resetReportScheduleForm();
  loadReportScheduleRecipients();
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
  _rsToggleTypeFields();
  _rsRenderRecipientsChecklist([]);
}

// R4: show day-of-week select for (family='health') OR (family!='health' AND type='weekly')
// day-of-month chips for (family!='health' AND type='monthly')
// health sections only for family='health'
// layout only for family='analytics'
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
    if (s.report_type === 'daily') return `<span style="color:var(--text-secondary)">${escapeHtml(I18N.t('rs.everyDay'))}</span>`;
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
       <th>${escapeHtml(I18N.t('rs.fldLayout'))}</th><th>${escapeHtml(I18N.t('rs.colStatus'))}</th>
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
  _rsToggleTypeFields();
  const sel = String(s.recipients || '').split(',').map(x => x.trim()).filter(Boolean);
  _rsRenderRecipientsChecklist(sel);
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
  };

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
  const _RS_TYPE   = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly') };
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
  document.getElementById('lpSendLine')?.addEventListener('click', () => {
    alert(I18N.t('rpt.sendLineNotSupported') || 'ฟีเจอร์ส่ง LINE ยังไม่รองรับสำหรับรายงานนี้ กรุณาดาวน์โหลดและส่งด้วยตนเอง');
  });

  // History tab
  document.getElementById('rptHistRefresh')?.addEventListener('click', loadRptHistory);
  document.getElementById('rptHistExportCsv')?.addEventListener('click', exportReportHistoryCsv);

  // Init scope bar
  _initRptScopeBar();

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
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    setDtValue('rbFrom', first);
    setDtValue('rbTo',   last);
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
    const _RS_TYPE = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly'), health: I18N.t('hr.typeHealth') };
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
  if (_rptActiveTab === 'face')    { if (_rptFacePeriod !== 'custom') _rptAutoFillRange('rptFaceFrom', 'rptFaceTo', _rptFacePeriod); loadFaceReportPreview(); loadHealthRecipients(); }
  if (_rptActiveTab === 'lpr')     { if (_rptLprPeriod !== 'custom') _rptAutoFillRange('rptLprFrom', 'rptLprTo', _rptLprPeriod); loadLprReportPreview(); }
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
    const _RS_TYPE = { daily: I18N.t('rs.typeDaily'), weekly: I18N.t('rs.typeWeekly'), monthly: I18N.t('rs.typeMonthly'), health: I18N.t('hr.typeHealth') };
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
    const refImg = r.ref_snapshot
      ? `<img src="${API}/snapshots/${encodeURIComponent(r.ref_snapshot)}" alt="" style="max-width:100%;max-height:80px;border-radius:5px;object-fit:cover;margin-bottom:4px">`
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
  if (_rptLprSections.province) sections.push(_rptBarTableSection('rptLprProvinceChart', _rptLabel('rpt.province', 'จังหวัด'), data.province || [], 'name'));
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
  if (_rptLprSections.province) _rptChart('rptLprProvinceChart', 'bar', (data.province || []).map(r => r.name), [{ data: (data.province || []).map(r => r.n), backgroundColor: acc, borderRadius: 3 }], { indexAxis: 'y', noBarLabels: true, plugins: { legend: { display: false } } });
  if (_rptLprSections.vtype) _rptChart('rptLprVtypeChart', 'bar', (data.vehicle_type || []).map(r => _rptVtypeName(r.type)), [{ data: (data.vehicle_type || []).map(r => r.n), backgroundColor: acc, borderRadius: 3 }], { indexAxis: 'y', noBarLabels: true, plugins: { legend: { display: false } } });
  if (_rptLprSections.direction && data.direction) {
    _rptChart('rptLprDirChart', 'line', data.direction.labels, [
      { label: _rptLabel('rpt.in','เข้า'), data: data.direction.in, borderColor: ok, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
      { label: _rptLabel('rpt.out','ออก'), data: data.direction.out, borderColor: warn, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
    ]);
  }
}

