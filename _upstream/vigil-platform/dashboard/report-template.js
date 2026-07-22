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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function _fmt(n) { return (Number(n) || 0).toLocaleString(); }
  function _label(key, fallback) { return (typeof I18N !== 'undefined') ? I18N.t(key, fallback) : (fallback || key); }
  function _kpis(items) {
    return `<div class="rpt-execrow">${items.map(t =>
      `<div class="rpt-exec" style="--ka:${esc(t.color)}"><div class="rpt-exec-v">${_fmt(t.value)}</div><div class="rpt-exec-k">${esc(t.label)}</div></div>`
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
  function buildReportHtml(d, brand) {
    brand = brand || {};
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

    const cats = (d.cats && d.cats.categories) || [];
    const totalEvents  = cats.reduce((s, c) => s + (c.count || 0), 0);
    const peopleTotal  = (cats.find(c => c.kind === 'people_counter') || {}).count || 0;
    const vehicleTotal = (cats.find(c => c.kind === 'vehicle_counter') || {}).count || 0;
    const cameraSet = new Set([
      ...((d.ppl && d.ppl.per_camera) || []).map(r => r.camera_id),
      ...((d.veh && d.veh.per_camera) || []).map(r => r.camera_id),
    ]);
    const kpiTopHtml = `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.summary'))}</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px">
        <div style="background:${clrSurf};padding:14px;border-radius:8px;border-left:3px solid ${accent}"><div style="font-size:10px;color:${clrDim};text-transform:uppercase;font-weight:700">${esc(I18N.t('rt.totalEvents'))}</div><div style="font-size:24px;font-weight:700;color:${clrText}">${totalEvents.toLocaleString()}</div></div>
        <div style="background:${clrSurf};padding:14px;border-radius:8px;border-left:3px solid ${clrOk}"><div style="font-size:10px;color:${clrDim};text-transform:uppercase;font-weight:700">${esc(I18N.t('cam.people'))}</div><div style="font-size:24px;font-weight:700;color:${clrText}">${peopleTotal.toLocaleString()}</div></div>
        <div style="background:${clrSurf};padding:14px;border-radius:8px;border-left:3px solid ${clrWarn}"><div style="font-size:10px;color:${clrDim};text-transform:uppercase;font-weight:700">${esc(I18N.t('rt.vehicles'))}</div><div style="font-size:24px;font-weight:700;color:${clrText}">${vehicleTotal.toLocaleString()}</div></div>
        <div style="background:${clrSurf};padding:14px;border-radius:8px;border-left:3px solid ${clrPurple}"><div style="font-size:10px;color:${clrDim};text-transform:uppercase;font-weight:700">${esc(I18N.t('rt.camerasDetected'))}</div><div style="font-size:24px;font-weight:700;color:${clrText}">${cameraSet.size}</div></div>
      </div>`;

    // E3 — coverage/evidence section removed (low value); d.cov/d.ev still
    // returned by the backend but no longer rendered.

    const { points: trendPoints, trunc } = computeTrendPoints(d);
    const trendLabel = trunc === 'hour' ? I18N.t('rt.byHour') : trunc === 'day' ? I18N.t('rt.byDay') : I18N.t('rt.byWeek');
    const trendChartHtml = trendPoints.length ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.trendTitle').replace('{label}', trendLabel))}</h3>
      <div style="position:relative;height:200px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="reportTrendChart"></canvas>
      </div>` : '';

    const catChartHeight = Math.max(120, cats.length * 28);
    const catKpiHtml = `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.byCategory'))}</h3>
      ${cats.length ? `<div style="position:relative;height:${catChartHeight}px;margin-top:10px;background:#fff;border:1px solid ${clrBord};border-radius:8px;padding:8px">
        <canvas id="reportCategoryChart"></canvas>
      </div>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:${clrSurf}"><th style="padding:8px;text-align:left">${esc(I18N.t('rt.colCategory'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colVsPrev'))}</th></tr></thead>
        <tbody>${cats.map(c => {
          const cmpRaw = c.change_pct;
          let cmp = '—';
          if (c.prev_count === 0 && c.count > 0) cmp = '↑ NEW';
          else if (c.prev_count > 0 && c.count === 0) cmp = '▼ STOPPED';
          else if (cmpRaw == null) cmp = '—';
          else cmp = (cmpRaw >= 0 ? '▲ ' : '▼ ') + Math.abs(cmpRaw).toFixed(1) + '%';
          return `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(c.icon || '')} ${esc(c.name)}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(c.count || 0).toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;border-bottom:1px solid ${clrDiv};color:#666">${cmp}</td>
          </tr>`;
        }).join('')}</tbody></table>`;

    const top = (d.top && d.top.top) || [];
    const topRulesHtml = top.length ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.topRules'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:${clrSurf}"><th style="padding:8px;text-align:left">#</th><th style="padding:8px;text-align:left">Rule</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCameraCount'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th></tr></thead>
        <tbody>${top.map((r, i) => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv};color:#999">${i + 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(r.rule_name)}</td>
          <td style="padding:6px 8px;text-align:right;border-bottom:1px solid ${clrDiv}">${r.cameras_seen}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';

    const camTable = (rows, header) => rows.length ? `
      <table style="width:48%;border-collapse:collapse;margin-top:8px;font-size:12px;display:inline-table;vertical-align:top">
        <thead><tr style="background:${clrSurf}"><th colspan="2" style="padding:8px;text-align:left">${header}</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(r.camera_id)}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';
    const pplRows = (d.ppl && d.ppl.per_camera) || [];
    const vehRows = (d.veh && d.veh.per_camera) || [];
    const perCamHtml = (pplRows.length || vehRows.length) ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.perCamera'))}</h3>
      <div style="display:flex;gap:14px;margin-top:10px">
        ${camTable(pplRows, esc(I18N.t('stats.peopleByCam') || 'People'))}
        ${camTable(vehRows, esc(I18N.t('rt.vehicles') || 'Vehicle'))}
      </div>` : '';

    const brk = (d.brk || []).slice(0, 15);
    const brkHtml = brk.length ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.eventDetail'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:${clrSurf}"><th style="padding:8px;text-align:left">${esc(I18N.t('rt.colEvent'))}</th><th style="padding:8px;text-align:left">${esc(I18N.t('common.camera'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th></tr></thead>
        <tbody>${brk.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv}">${esc(r.name || r.event_type || '—')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid ${clrDiv};color:#666">${esc(r.camera_id || '')}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid ${clrDiv}">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';

    const heatCells = (d.heat && d.heat.cells) || [];
    let heatHtml = '';
    if (heatCells.length) {
      const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
      let max = 0;
      heatCells.forEach(c => { matrix[c.dow][c.hour] = c.count; if (c.count > max) max = c.count; });
      const days = I18N.t('stats.dowShort').split(',');
      heatHtml = `
        <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${accent};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.heatmapTitle'))}</h3>
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
        </table>`;
    }

    const quiet = (d.quiet && d.quiet.cameras) || [];
    const quietHtml = quiet.length ? `
      <h3 style="font-size:14px;color:${clrText};border-bottom:2px solid ${clrWarn};padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.quietCameras'))}</h3>
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

    const footerHtml = `
      <div style="margin-top:30px;padding-top:14px;border-top:1px solid ${clrBord};font-size:10px;color:${clrDim};display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;color:${clrMid}">${esc(brandName)}</span>
        <span>© 2025-2026 ${esc(brandName)} · All Rights Reserved</span>
      </div>`;

    return headerHtml + kpiTopHtml + trendChartHtml + catKpiHtml + topRulesHtml +
           perCamHtml + brkHtml + heatHtml + quietHtml + footerHtml;
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

  // Render the trend bar chart into a canvas (needs Chart.js loaded).
  // animation:false so a screenshot/PDF capture catches the painted frame.
  let _trendChart = null;
  function renderReportTrendChart(canvasId, points, trunc, accent) {
    accent = accent || '#5b8def';
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;
    if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
    const fmt = b => {
      const dt  = new Date(b);
      const loc = ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB';
      if (trunc === 'hour') return dt.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
      return dt.toLocaleDateString(loc, { day: '2-digit', month: 'short' });
    };
    // convert hex accent to rgba for fill
    const hexToRgba = (hex, a) => {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    };
    _trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: points.map(p => fmt(p.bucket)),
        datasets: [{
          label: I18N.t('rt.chartLabel'),
          data: points.map(p => p.total),
          backgroundColor: hexToRgba(accent, 0.7),
          borderColor: accent, borderWidth: 1, borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#1a202c', titleColor: '#fff', bodyColor: '#fff' },
        },
        scales: {
          x: { ticks: { color: '#4a5568', font: { size: 9 }, maxRotation: 45 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#4a5568', precision: 0, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
        },
      },
    });
  }

  // Horizontal bar chart, one bar per category, sorted by count descending —
  // ranks scan better than a pie for long Thai labels + a dominant category.
  // animation:false, same as renderReportTrendChart — the Puppeteer capture
  // needs the painted frame, not an in-progress animation.
  let _catChart = null;
  function renderCategoryChart(canvasId, cats) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined' || !cats || !cats.length) return;
    if (_catChart) { _catChart.destroy(); _catChart = null; }
    const sorted = [...cats].sort((a, b) => (b.count || 0) - (a.count || 0));
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

  global.ReportTemplate = {
    buildReportHtml, computeTrendPoints, renderReportTrendChart, renderCategoryChart,
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
    buildPersonSection(data) {
      const k = data.kpi || {};
      const a = data.accessories || {};
      return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:#14b8a6"></span>${esc(_label('rpt.domPerson','ข้อมูลบุคคล'))}</div>`
        + _kpis([
          { label: _label('rpt.appTotal','บุคคลทั้งหมด'),  value: k.total,           color: 'var(--status-ok)' },
          { label: _label('rpt.appBag','พกกระเป๋า'),       value: a.bag_count,        color: 'var(--accent-muted)' },
          { label: _label('rpt.appGlasses','สวมแว่น'),     value: a.glasses_count,    color: 'var(--accent)' },
          { label: _label('rpt.appHelmet','สวมหมวก'),      value: a.helmet_count,     color: 'var(--warn)' },
        ]) + '</div>';
    },
  };
})(typeof window !== 'undefined' ? window : this);
