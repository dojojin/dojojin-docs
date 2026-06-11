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

  // Build the full report HTML from reportData (the _reportData shape:
  // { range:{label}, title, cats, tl, brk, ppl, veh, heat, top, quiet })
  // and brand ({ name, tagline, logo_url, primary_color }).
  function buildReportHtml(d, brand) {
    brand = brand || {};
    const brandName    = brand.name    || 'Vigil Platform';
    const brandTagline = brand.tagline || '';
    const brandLogoUrl = brand.logo_url ? `${brand.logo_url}?v=${Date.now()}` : null;
    const accent       = brand.primary_color || '#5b8def';

    const headerHtml = `
      <div style="border-bottom:3px solid ${esc(accent)};padding-bottom:14px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:14px">
            ${brandLogoUrl ? `<img src="${esc(brandLogoUrl)}" alt="logo" style="width:64px;height:64px;object-fit:contain">` : ''}
            <div>
              <div style="font-size:22px;font-weight:700;color:#1a202c">${esc(d.title)}</div>
              <div style="font-size:13px;color:#4a5568;margin-top:4px">${esc(d.range && d.range.label)}</div>
            </div>
          </div>
          <div style="text-align:right;font-size:11px;color:#718096">
            <div style="font-weight:700;color:#2d3748">${esc(brandName)}</div>
            ${brandTagline ? `<div style="font-size:10px;color:#a0aec0">${esc(brandTagline)}</div>` : ''}
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
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.summary'))}</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px">
        <div style="background:#f7fafc;padding:14px;border-radius:8px;border-left:3px solid #5b8def"><div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:700">${esc(I18N.t('rt.totalEvents'))}</div><div style="font-size:24px;font-weight:700;color:#2d3748">${totalEvents.toLocaleString()}</div></div>
        <div style="background:#f7fafc;padding:14px;border-radius:8px;border-left:3px solid #22c55e"><div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:700">${esc(I18N.t('cam.people'))}</div><div style="font-size:24px;font-weight:700;color:#2d3748">${peopleTotal.toLocaleString()}</div></div>
        <div style="background:#f7fafc;padding:14px;border-radius:8px;border-left:3px solid #f59e0b"><div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:700">${esc(I18N.t('rt.vehicles'))}</div><div style="font-size:24px;font-weight:700;color:#2d3748">${vehicleTotal.toLocaleString()}</div></div>
        <div style="background:#f7fafc;padding:14px;border-radius:8px;border-left:3px solid #a78bfa"><div style="font-size:10px;color:#718096;text-transform:uppercase;font-weight:700">${esc(I18N.t('rt.camerasDetected'))}</div><div style="font-size:24px;font-weight:700;color:#2d3748">${cameraSet.size}</div></div>
      </div>`;

    const { points: trendPoints, trunc } = computeTrendPoints(d);
    const trendLabel = trunc === 'hour' ? I18N.t('rt.byHour') : trunc === 'day' ? I18N.t('rt.byDay') : I18N.t('rt.byWeek');
    const trendChartHtml = trendPoints.length ? `
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.trendTitle').replace('{label}', trendLabel))}</h3>
      <div style="position:relative;height:200px;margin-top:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px">
        <canvas id="reportTrendChart"></canvas>
      </div>` : '';

    const catKpiHtml = `
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.byCategory'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:#f7fafc"><th style="padding:8px;text-align:left">${esc(I18N.t('rt.colCategory'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colVsPrev'))}</th></tr></thead>
        <tbody>${cats.map(c => {
          const cmpRaw = c.change_pct;
          let cmp = '—';
          if (c.prev_count === 0 && c.count > 0) cmp = '↑ NEW';
          else if (c.prev_count > 0 && c.count === 0) cmp = '▼ STOPPED';
          else if (cmpRaw == null) cmp = '—';
          else cmp = (cmpRaw >= 0 ? '▲ ' : '▼ ') + Math.abs(cmpRaw).toFixed(1) + '%';
          return `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(c.icon || '')} ${esc(c.name)}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f1f5f9">${(c.count || 0).toLocaleString()}</td>
            <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;color:#666">${cmp}</td>
          </tr>`;
        }).join('')}</tbody></table>`;

    const top = (d.top && d.top.top) || [];
    const topRulesHtml = top.length ? `
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.topRules'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:#f7fafc"><th style="padding:8px;text-align:left">#</th><th style="padding:8px;text-align:left">Rule</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCameraCount'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th></tr></thead>
        <tbody>${top.map((r, i) => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;color:#999">${i + 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(r.rule_name)}</td>
          <td style="padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9">${r.cameras_seen}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f1f5f9">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';

    const camTable = (rows, header) => rows.length ? `
      <table style="width:48%;border-collapse:collapse;margin-top:8px;font-size:12px;display:inline-table;vertical-align:top">
        <thead><tr style="background:#f7fafc"><th colspan="2" style="padding:8px;text-align:left">${header}</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">📷 ${esc(r.camera_id)}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f1f5f9">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';
    const pplRows = (d.ppl && d.ppl.per_camera) || [];
    const vehRows = (d.veh && d.veh.per_camera) || [];
    const perCamHtml = (pplRows.length || vehRows.length) ? `
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.perCamera'))}</h3>
      <div style="display:flex;gap:14px;margin-top:10px">
        ${camTable(pplRows, '🚶 People')}
        ${camTable(vehRows, '🚗 Vehicle')}
      </div>` : '';

    const brk = (d.brk || []).slice(0, 15);
    const brkHtml = brk.length ? `
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.eventDetail'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:#f7fafc"><th style="padding:8px;text-align:left">${esc(I18N.t('rt.colEvent'))}</th><th style="padding:8px;text-align:left">${esc(I18N.t('common.camera'))}</th><th style="padding:8px;text-align:right">${esc(I18N.t('rt.colCount'))}</th></tr></thead>
        <tbody>${brk.map(r => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(r.name || r.event_type || '—')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;color:#666">${esc(r.camera_id || '')}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f1f5f9">${(r.count || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>` : '';

    const heatCells = (d.heat && d.heat.cells) || [];
    let heatHtml = '';
    if (heatCells.length) {
      const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
      let max = 0;
      heatCells.forEach(c => { matrix[c.dow][c.hour] = c.count; if (c.count > max) max = c.count; });
      const days = I18N.t('stats.dowShort').split(',');
      heatHtml = `
        <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #5b8def;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.heatmapTitle'))}</h3>
        <table style="border-collapse:collapse;font-size:9px;font-family:monospace;margin-top:10px;width:100%">
          <thead><tr><th></th>${[...Array(24)].map((_, h) => `<th style="text-align:center;color:#666;font-weight:normal;padding:2px">${h.toString().padStart(2, '0')}</th>`).join('')}</tr></thead>
          <tbody>${matrix.map((row, dy) => `<tr>
            <th style="text-align:right;padding:2px 6px;color:#666;font-weight:normal">${days[dy]}</th>
            ${row.map(v => {
              const ratio = max > 0 ? v / max : 0;
              let bg = '#f7fafc';
              if (v > 0) {
                if (ratio < 0.2) bg = 'rgba(91,141,239,0.25)';
                else if (ratio < 0.5) bg = 'rgba(91,141,239,0.55)';
                else if (ratio < 0.8) bg = 'rgba(91,141,239,0.85)';
                else bg = 'rgba(91,141,239,1)';
              }
              const fg = ratio > 0.5 ? '#fff' : '#2d3748';
              return `<td style="text-align:center;padding:2px;background:${bg};color:${fg};border:1px solid #e2e8f0;min-width:18px">${v > 0 ? v : ''}</td>`;
            }).join('')}
          </tr>`).join('')}</tbody>
        </table>`;
    }

    const quiet = (d.quiet && d.quiet.cameras) || [];
    const quietHtml = quiet.length ? `
      <h3 style="font-size:14px;color:#2d3748;border-bottom:2px solid #f59e0b;padding-bottom:6px;margin-top:18px">${esc(I18N.t('rt.quietCameras'))}</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
        <thead><tr style="background:#fff7e6"><th style="padding:8px;text-align:left">${esc(I18N.t('common.camera'))}</th><th style="padding:8px;text-align:left">last_seen</th></tr></thead>
        <tbody>${quiet.map(c => {
          const ago = c.last_seen_ago_sec;
          const agoTxt = ago == null ? '—'
            : ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago / 60)}m` : `${Math.round(ago / 3600)}h`;
          return `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(c.camera_name || c.camera_id)} <span style="color:#999;font-size:10px">${esc(c.camera_id)}</span></td>
            <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;color:#666">${agoTxt}${ago == null ? '' : ' ago'}</td>
          </tr>`;
        }).join('')}</tbody></table>` : '';

    const footerHtml = `
      <div style="margin-top:30px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:10px;color:#718096;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;color:#4a5568">${esc(brandName)}</span>
        <span>© 2025-2026 DojoJin Tech · All Rights Reserved</span>
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
  function renderReportTrendChart(canvasId, points, trunc) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;
    if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
    const fmt = b => {
      const dt  = new Date(b);
      const loc = ((typeof I18N !== 'undefined' && I18N.getLang()) || 'th') === 'th' ? 'th-TH' : 'en-GB';
      if (trunc === 'hour') return dt.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
      return dt.toLocaleDateString(loc, { day: '2-digit', month: 'short' });
    };
    _trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: points.map(p => fmt(p.bucket)),
        datasets: [{
          label: I18N.t('rt.chartLabel'),
          data: points.map(p => p.total),
          backgroundColor: 'rgba(91,141,239,0.7)',
          borderColor: '#5b8def', borderWidth: 1, borderRadius: 3,
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

  global.ReportTemplate = { buildReportHtml, computeTrendPoints, renderReportTrendChart };
})(typeof window !== 'undefined' ? window : this);
