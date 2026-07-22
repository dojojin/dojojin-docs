// ============================================================
// Vigil Platform — Stats Page (Analytics & Charts)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// ============================================================
// STATS PAGE — Full features
// ============================================================

// Phase 2: stats v2 — supports presets (1h/1d/7d/30d) + custom range
let _statsCustomFrom = null;  // ISO string when range='custom'
let _statsCustomTo   = null;
let _statsRangeMaxDays = 365;  // refreshed from /api/settings on first load
let _statsFocusCategoryId = null; // null = all categories in Event Overview
let _statsSiteId = null; // null = all sites
let _statsScopeBarReady = false;

async function _initStatsScopeBar() {
  if (_statsScopeBarReady) return;
  _statsScopeBarReady = true;
  const bar = document.getElementById('statsScopeBar');
  const siteBar = document.getElementById('statsSiteBar');
  if (!bar || !siteBar) return;
  try {
    const res = await fetch(`${API}/api/sites`, { cache: 'no-store' });
    if (!res.ok) return;
    const sites = await res.json();
    if (!Array.isArray(sites) || sites.length <= 1) return; // single-site: no selector needed
    bar.style.display = '';
    siteBar.innerHTML =
      `<button class="site-tag all active" data-site-id="">${escapeHtml(I18N.t('common.all'))}</button>` +
      sites.map(s => `<button class="site-tag" data-site-id="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}</button>`).join('');
    siteBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.site-tag');
      if (!btn) return;
      siteBar.querySelectorAll('.site-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _statsSiteId = btn.dataset.siteId ? parseInt(btn.dataset.siteId) : null;
      // The active group tab may now be hidden (belongs to a different site) —
      // reset to "ALL" so we don't keep sending a foreign-site group filter
      // ANDed with site_id server-side, which would silently zero out the charts.
      if (activeGroupId !== 'all' && _statsSiteId) {
        const g = groups.find(gr => gr.id === activeGroupId);
        const siteCamIds = new Set(cameras.filter(c => c.site_id === _statsSiteId).map(c => c.camera_id));
        if (!g || !(g.cameraIds || []).some(id => siteCamIds.has(id))) activeGroupId = 'all';
      }
      renderGroupBars();
      loadStats();
    });
  } catch {}
}

function setStatsRange(range, btn) {
  if (range === 'custom') return;  // handled by openCustomRangeModal
  currentStatsRange = range;
  _statsCustomFrom = null;
  _statsCustomTo   = null;
  document.querySelectorAll('#page-stats .per-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadStats();
}

function getRangeQuery() {
  const now = new Date();
  let from, label;
  if (currentStatsRange === 'custom' && _statsCustomFrom && _statsCustomTo) {
    return {
      from: _statsCustomFrom,
      to:   _statsCustomTo,
      label: `${_statsCustomFrom.slice(0, 16).replace('T', ' ')} → ${_statsCustomTo.slice(0, 16).replace('T', ' ')}`,
    };
  }
  if (currentStatsRange === 'yesterday') {
    // calendar YESTERDAY — [yesterday 00:00, today 00:00), not "yesterday → now"
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);
    const yesterdayMidnight = new Date(todayMidnight);
    yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);
    return { from: yesterdayMidnight.toISOString(), to: todayMidnight.toISOString(), label: 'YESTERDAY' };
  }
  switch (currentStatsRange) {
    case '1h':
      // rolling — last 60 minutes
      from = new Date(now - 3600000);
      label = 'LAST HOUR';
      break;
    case '1d':
      // calendar TODAY — from local midnight of the current day
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      label = 'TODAY';
      break;
    case '7d': {
      // calendar THIS WEEK — from Monday 00:00 of the current week
      from = new Date(now);
      const dow = (from.getDay() + 6) % 7;  // Mon=0..Sun=6
      from.setDate(from.getDate() - dow);
      from.setHours(0, 0, 0, 0);
      label = 'THIS WEEK';
      break;
    }
    case '30d':
      // calendar THIS MONTH — from day 1 of the current month
      from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      label = 'THIS MONTH';
      break;
    default:
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      label = 'TODAY';
  }
  return { from: from.toISOString(), to: now.toISOString(), label };
}

async function _ensureStatsSettings() {
  if (_statsRangeMaxDays !== 365) return;  // already loaded (or default kept)
  try {
    const res = await fetch(`${API}/api/settings`);
    if (res.ok) {
      const s = await res.json();
      const v = parseInt(s?.custom_range_max_days?.value, 10);
      if (Number.isFinite(v) && v > 0) _statsRangeMaxDays = v;
    }
  } catch {}
}

async function loadStats() {
  _initStatsScopeBar();  // lazy one-time init (async, non-blocking)
  const { from, to, label } = getRangeQuery();
  const camIds   = getActiveGroupCameraIds();
  const camParam = camIds.length ? `&cameras=${encodeURIComponent(camIds.join(','))}` : '';
  const siteParam = _statsSiteId ? `&site_id=${_statsSiteId}` : '';

  // header labels
  const rangeBadge = document.getElementById('statsRangeLabel');
  if (rangeBadge) rangeBadge.textContent = label;
  document.getElementById('tlBadge').textContent  = label;
  document.getElementById('brkBadge').textContent = label;

  await _ensureStatsSettings();

  // Update per-camera-bar badges
  const peopleBadge  = document.getElementById('peopleCamBadge');
  const vehicleBadge = document.getElementById('vehicleCamBadge');
  const dwellBadge   = document.getElementById('dwellBadge');
  const pcBadge      = document.getElementById('pcBadge');
  if (peopleBadge)  peopleBadge.textContent  = label;
  if (vehicleBadge) vehicleBadge.textContent = label;
  if (dwellBadge)   dwellBadge.textContent   = label;
  if (pcBadge)      pcBadge.textContent      = label;

  try {
    const [catsRes, tlRes, brkRes, peopleRes, vehicleRes, dwellRes, pcRes] = await Promise.all([
      fetch(`${API}/api/stats/categories?from=${from}&to=${to}${camParam}${siteParam}`),
      fetch(`${API}/api/stats/timeline-by-category?from=${from}&to=${to}${camParam}${siteParam}`),
      fetch(`${API}/api/stats/breakdown-v2?from=${from}&to=${to}${camParam}${siteParam}`),
      fetch(`${API}/api/stats/per-camera-counts?kind=people&from=${from}&to=${to}${camParam}${siteParam}`),
      fetch(`${API}/api/stats/per-camera-counts?kind=vehicle&from=${from}&to=${to}${camParam}${siteParam}`),
      fetch(`${API}/api/stats/dwell?from=${from}&to=${to}${camParam}${siteParam}`),
      fetch(`${API}/api/stats/people-counting?from=${from}&to=${to}${camParam}${siteParam}`),
    ]);
    if (!catsRes.ok || !tlRes.ok || !brkRes.ok) throw new Error('stats fetch failed');

    const catsBody  = await catsRes.json();
    const tlBody    = await tlRes.json();
    const breakdown = await brkRes.json();
    const peopleBody  = peopleRes.ok  ? await peopleRes.json()  : { per_camera: [] };
    const vehicleBody = vehicleRes.ok ? await vehicleRes.json() : { per_camera: [] };

    let dwellRows = dwellRes.ok ? await dwellRes.json() : [];
    const pcBody = pcRes.ok ? await pcRes.json() : { buckets: [], per_camera: [], total_enter: 0, total_exit: 0 };

    renderCategoryKPI(catsBody.categories || []);
    renderTimelineByCategory(tlBody, from, to);
    renderBreakdown(breakdown);
    renderDwell(dwellRows);
    renderPeopleCounting(pcBody);

    // Hide People Counting / Dwell Time cards for a site/period with no
    // capable camera reporting at all — same reasoning as
    // _refreshOccupancySectionVisibility: DB rows in the selected range are
    // the source of truth (a capable camera with a genuine 0 count still has
    // rows), so this doesn't hide a working camera that's just quiet, and it
    // re-appears on its own once a newly-added camera reports its first row.
    const pcSection    = document.getElementById('pcSection');
    const dwellSection = document.getElementById('dwellSection');
    if (pcSection)    pcSection.style.display    = (pcBody.per_camera || []).length ? '' : 'none';
    if (dwellSection) dwellSection.style.display = dwellRows.length ? '' : 'none';
    renderCategoryPie(catsBody.categories || []);
    renderPerCameraBar('people',  peopleBody.per_camera  || []);
    renderPerCameraBar('vehicle', vehicleBody.per_camera || []);

    // cache for CSV export
    _lastStats.kpi       = catsBody.categories || [];
    _lastStats.timeline  = tlBody;
    _lastStats.breakdown = breakdown;
    _lastStats.people    = peopleBody.per_camera  || [];
    _lastStats.vehicle   = vehicleBody.per_camera || [];

    renderCategoryHealth();

    // Phase 4 — heatmap + insights run after main panels load
    _statsLastFrom = from;
    _statsLastTo   = to;
    _statsLastCams = camParam;
    _statsLastSite = siteParam;
    populateHeatmapCategoryFilter(catsBody.categories || []);
    loadHeatmap();
    loadInsights();

    // People in Area — live occupancy (independent of the date-range)
    loadOccupancy();

    // Density Over Time — historical occupancy line chart (range-bound)
    loadOccupancyTimeline();

    // Density Heatmap — dow × hour pattern (range-bound)
    loadOccupancyHeatmap();

    // Hide the whole "การนับในพื้นที่" group when the selected site has no
    // occupancy-capable camera at all — checked against /occupancy/sources
    // (DB-backed, period-scoped), not the live snapshot, so a site with a
    // counting camera that just happens to read 0 right now stays visible.
    _refreshOccupancySectionVisibility(from, to);
  } catch (e) {
    console.error('loadStats error:', e);
  }
}

// ============================================================
// People in Area — live occupancy (Bosch CountAggregation/Counter)
// ============================================================
// Server keeps in-memory state via /api/stats/occupancy and pushes
// occupancy_update WS messages on change. We snapshot on Stats page
// load to seed the grid, then track increments live.
const _occupancy = {};   // "cam::rule" -> { camera_id, rule_name, current, raw, last_update }

async function loadOccupancy() {
  try {
    const r = await fetch(`${API}/api/stats/occupancy${_statsSiteId ? `?site_id=${_statsSiteId}` : ''}`);
    if (!r.ok) throw new Error('occupancy fetch failed');
    const body = await r.json();
    (body.cameras || []).forEach(c => {
      _occupancy[`${c.camera_id}::${c.rule_name}`] = c;
    });
    renderOccupancy();
  } catch (e) {
    console.warn('loadOccupancy error:', e);
  }
}

function renderOccupancy() {
  const grid = document.getElementById('occupancyGrid');
  if (!grid) return;
  const items = Object.values(_occupancy)
    .sort((a, b) => (a.camera_id + a.rule_name).localeCompare(b.camera_id + b.rule_name));

  if (items.length === 0) {
    grid.innerHTML = `<div style="color:var(--text-secondary);font-size:13px;padding:14px">
      ${escapeHtml(I18N.t('stats.waitingCount'))}
      <div style="margin-top:6px;font-size:11px">${I18N.t('stats.waitingCountHint')}</div>
    </div>`;
    return;
  }

  grid.innerHTML = items.map(c => {
    const count = (c.current ?? 0);
    const color = count >= 5 ? token('--status-bad') : count >= 2 ? token('--warn') : token('--status-ok');
    const ageSec = c.last_update
      ? Math.floor((Date.now() - new Date(c.last_update).getTime()) / 1000)
      : null;
    const ageLabel = ageSec == null
      ? '—'
      : ageSec < 5 ? I18N.t('stats.nowLabel')
      : ageSec < 60 ? I18N.t('stats.secsAgo').replace('{n}', ageSec)
      : I18N.t('stats.minsAgo').replace('{n}', Math.floor(ageSec / 60));
    return `
      <div class="kpi" style="border-left:3px solid ${color}">
        <div class="kpi-l">${c.camera_id}</div>
        <div class="kpi-v" style="color:${color}">${count}</div>
        <div class="kpi-s" style="font-size:11px">
          ${c.rule_name || '—'}<br>
          <span style="color:var(--text-secondary)">raw=${c.raw ?? '—'} · ${ageLabel}</span>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// Density Over Time — historical occupancy (Phase 1 of crowd-density viz)
// ============================================================
// Fetches /api/stats/occupancy/timeline for the active Stats date range.
// Bucket size is auto-picked server-side (1m / 5m / 1h / 1d) so we plot a
// reasonable number of points regardless of the window length.
let _occTlChart = null;

// Density dropdown population — used by both Density Over Time and
// Density Heatmap. Source is /api/stats/occupancy/sources (DB-scoped to
// the active range); the live in-memory _occupancy tracker is layered on
// top so a counter that just started today (no history in range yet) is
// still selectable. The old code only looked at the live tracker, which
// was empty after every api-server restart and made the dropdown appear
// to have "no cameras to choose" even when DB had thousands of samples.
async function _loadDensitySources(from, to) {
  let dbSources = [];
  try {
    const r = await fetch(`${API}/api/stats/occupancy/sources?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${_statsSiteId ? `&site_id=${_statsSiteId}` : ''}`);
    if (r.ok) dbSources = (await r.json()).sources || [];
  } catch (e) {
    console.warn('_loadDensitySources error:', e);
  }
  const seen = new Set();
  const merged = [];
  for (const s of dbSources) {
    const key = `${s.camera_id}|${s.rule_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ key, label: `${s.camera_id} · ${s.rule_name}` });
  }
  for (const c of Object.values(_occupancy)) {
    const key = `${c.camera_id}|${c.rule_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ key, label: `${c.camera_id} · ${c.rule_name} (live)` });
  }
  merged.sort((a, b) => a.label.localeCompare(b.label));
  return merged;
}

async function _refreshOccupancySectionVisibility(from, to) {
  const section = document.getElementById('occupancySection');
  if (!section) return;
  try {
    const r = await fetch(`${API}/api/stats/occupancy/sources?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${_statsSiteId ? `&site_id=${_statsSiteId}` : ''}`);
    const hasCounting = r.ok && ((await r.json()).sources || []).length > 0;
    section.style.display = hasCounting ? '' : 'none';
  } catch (e) {
    console.warn('_refreshOccupancySectionVisibility error:', e);
  }
}

function _populateDensityDropdown(selectId, sources) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('stats.allCamRule'))}</option>` +
    sources.map(w => `<option value="${escapeHtml(w.key)}">${escapeHtml(w.label)}</option>`).join('');
  if (sources.some(w => w.key === current)) sel.value = current;
}

async function loadOccupancyTimeline() {
  const { from, to, label } = getRangeQuery();
  const badge = document.getElementById('occTlBadge');
  if (badge) badge.textContent = label;

  const sources = await _loadDensitySources(from, to);
  _populateDensityDropdown('occTlCamRule', sources);
  const sel = document.getElementById('occTlCamRule');

  const [camId, ruleName] = (sel?.value || '').split('|');
  const qp = new URLSearchParams({ from, to });
  if (camId)    qp.set('camera_id', camId);
  if (ruleName) qp.set('rule_name', ruleName);
  if (_statsSiteId) qp.set('site_id', _statsSiteId);

  try {
    const r = await fetch(`${API}/api/stats/occupancy/timeline?${qp}`);
    if (!r.ok) throw new Error('occupancy timeline fetch failed');
    const body = await r.json();
    renderOccupancyTimeline(body);
  } catch (e) {
    console.warn('loadOccupancyTimeline error:', e);
  }
}

function renderOccupancyTimeline(body) {
  const canvas = document.getElementById('occTlChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels = (body.buckets || []).map(b => b.ts);
  const avg    = (body.buckets || []).map(b => b.avg);
  const max    = (body.buckets || []).map(b => b.max);

  if (_occTlChart) _occTlChart.destroy();

  const sub = document.getElementById('occTlSub');
  if (sub) {
    const bucketLabel = body.bucket_sec < 60
      ? `${body.bucket_sec}s`
      : body.bucket_sec < 3600 ? `${body.bucket_sec / 60}m`
      : body.bucket_sec < 86400 ? `${body.bucket_sec / 3600}h`
      : `${body.bucket_sec / 86400}d`;
    sub.textContent = I18N.t('stats.densitySubDynamic')
      .replace('{b}', bucketLabel).replace('{n}', labels.length);
  }

  if (labels.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = token('--text-secondary');
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(I18N.t('stats.noCountData'), canvas.width / 2, canvas.height / 2);
    return;
  }

  _occTlChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: I18N.t('stats.peakOcc'),
          data: max,
          borderColor: token('--warn'),
          backgroundColor: token('--warn') + '1f',
          borderWidth: 1,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
        {
          label: I18N.t('stats.avgOcc'),
          data: avg,
          borderColor: token('--accent'),
          backgroundColor: token('--accent') + '14',
          borderWidth: 2,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].label).toLocaleString(),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: token('--text-secondary'),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            callback: function (val) {
              const d = new Date(this.getLabelForValue(val));
              return body.bucket_sec >= 86400
                ? d.toLocaleDateString()
                : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            },
          },
          grid: { color: 'rgba(148,163,184,0.08)' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0 },
          grid: { color: 'rgba(148,163,184,0.08)' },
        },
      },
    },
  });
}

// ============================================================
// Density Heatmap — Phase 2 of crowd-density viz
// ============================================================
// 7×24 grid (Mon..Sun × 00..23) showing average occupancy per cell.
// Source rows are the same CountAggregation/Counter events the Density
// Over Time chart uses; only the GROUP BY differs (dow × hour vs time).
// Visual style mirrors the existing Activity Heatmap so the page stays
// consistent — amber palette to distinguish "density" from "activity".

async function loadOccupancyHeatmap() {
  const { from, to, label } = getRangeQuery();
  const badge = document.getElementById('occHmBadge');
  if (badge) badge.textContent = label;

  const sources = await _loadDensitySources(from, to);
  _populateDensityDropdown('occHmCamRule', sources);
  const sel = document.getElementById('occHmCamRule');

  const [camId, ruleName] = (sel?.value || '').split('|');
  const qp = new URLSearchParams({ from, to });
  if (camId)    qp.set('camera_id', camId);
  if (ruleName) qp.set('rule_name', ruleName);
  if (_statsSiteId) qp.set('site_id', _statsSiteId);

  try {
    const r = await fetch(`${API}/api/stats/occupancy/heatmap?${qp}`);
    if (!r.ok) throw new Error('occupancy heatmap fetch failed');
    const body = await r.json();
    renderOccupancyHeatmap(body.cells || []);
  } catch (e) {
    console.warn('loadOccupancyHeatmap error:', e);
    const grid = document.getElementById('occHmGrid');
    if (grid) grid.innerHTML =
      `<tr><td style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('stats.densityHeatmapErr'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderOccupancyHeatmap(cells) {
  const grid = document.getElementById('occHmGrid');
  if (!grid) return;

  // Sparse cells → dense 7×24 matrix. Each cell carries avg + max + samples.
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(null));
  let maxAvg = 0, totalSamples = 0, peak = 0;
  cells.forEach(c => {
    const d = Math.max(0, Math.min(6, c.dow));
    const h = Math.max(0, Math.min(23, c.hour));
    matrix[d][h] = c;
    if (c.avg > maxAvg) maxAvg = c.avg;
    if (c.max > peak)   peak   = c.max;
    totalSamples += c.samples || 0;
  });

  const dayLabel  = I18N.t('stats.dowShort').split(',');
  const hourLabel = h => h.toString().padStart(2, '0');

  let html = '<thead><tr>';
  html += '<th style="text-align:right;padding:3px 8px;color:var(--text-secondary);font-weight:normal"></th>';
  for (let h = 0; h < 24; h++) {
    html += `<th style="text-align:center;padding:3px 0;color:var(--text-secondary);font-weight:normal">${hourLabel(h)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let d = 0; d < 7; d++) {
    html += `<tr><th style="text-align:right;padding:3px 8px;color:var(--text-secondary);font-weight:normal">${dayLabel[d]}</th>`;
    for (let h = 0; h < 24; h++) {
      const cell = matrix[d][h];
      const v = cell?.avg ?? 0;
      const ratio = maxAvg > 0 ? v / maxAvg : 0;
      let bg;
      if (!cell)            bg = 'rgba(245,158,11,0.05)';
      else if (ratio < 0.2) bg = 'rgba(245,158,11,0.25)';
      else if (ratio < 0.5) bg = 'rgba(245,158,11,0.55)';
      else if (ratio < 0.8) bg = 'rgba(245,158,11,0.85)';
      else                  bg = 'rgba(245,158,11,1)';
      const fg = ratio > 0.5 ? '#fff' : 'var(--text-primary)';
      const display = cell
        ? (v >= 10 ? Math.round(v).toString()
                   : v >= 1 ? v.toFixed(1)
                            : v > 0 ? v.toFixed(2).replace(/^0/, '')
                                    : '')
        : '';
      const title = cell
        ? `${dayLabel[d]} ${hourLabel(h)}:00 — avg ${v.toFixed(2)} · peak ${cell.max} · ${cell.samples} samples`
        : `${dayLabel[d]} ${hourLabel(h)}:00 — no data`;
      html += `<td title="${escapeHtml(title)}" style="text-align:center;padding:0;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.04);height:24px;min-width:24px">${display}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  grid.innerHTML = html;

  const totalEl = document.getElementById('occHmTotal');
  if (totalEl) {
    totalEl.textContent = cells.length === 0
      ? I18N.t('stats.noCountData')
      : I18N.t('stats.hmSamplesDyn')
          .replace('{n}', totalSamples.toLocaleString())
          .replace('{peak}', peak)
          .replace('{max}', maxAvg.toFixed(2));
  }
}

// Phase 3: vertical bar chart of counts grouped by camera_id.
// kind = 'people' | 'vehicle'
function renderPerCameraBar(kind, rows) {
  const canvasId = kind === 'people' ? 'peopleCamChart' : 'vehicleCamChart';
  const color    = kind === 'people' ? token('--status-ok') : token('--accent');
  const ctx      = document.getElementById(canvasId);
  if (!ctx) return;

  if (_camChartReg[kind]) { _camChartReg[kind].destroy(); _camChartReg[kind] = null; }

  // Cleanup any prior "no data" message
  const parent = ctx.parentElement;
  parent.style.position = 'relative';
  const oldMsg = parent.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  if (!rows.length) {
    const msg = document.createElement('div');
    msg.className = 'no-data-msg';
    msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text-secondary);font-size:12px;text-align:center;line-height:1.6';
    msg.innerHTML = `${escapeHtml(I18N.t('stats.noDataYet'))}<br><span style="font-size:10px">${escapeHtml(I18N.t('stats.addMappingRule'))} "${kind === 'people' ? 'People' : 'Vehicle'} Counting"</span>`;
    parent.appendChild(msg);
    return;
  }

  // Cap to top-N bars — past ~20 the labels squash together and the chart
  // stops being readable. /api/stats/per-camera-counts already orders by
  // count DESC so slicing keeps the busiest cameras. A small "+N more"
  // hint replaces the dropped tail so the operator knows there's more data.
  const TOP_N = 20;
  const truncated = rows.length > TOP_N;
  const visible = truncated ? rows.slice(0, TOP_N) : rows;
  const labels = visible.map(r => r.camera_id);
  const values = visible.map(r => r.count);
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'no-data-msg';
    note.style.cssText = 'position:absolute;top:6px;right:8px;color:var(--text-secondary);font-size:10px;background:rgba(0,0,0,0.4);padding:2px 8px;border-radius:10px;pointer-events:none';
    note.textContent = I18N.t('stats.topNote').replace('{n}', TOP_N).replace('{total}', rows.length);
    parent.appendChild(note);
  }

  _camChartReg[kind] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: kind === 'people' ? 'People' : 'Vehicles',
        data: values,
        backgroundColor: color + 'cc',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const i = elements[0].index;
        const cam = labels[i];
        const cls = kind === 'people' ? 'Person' : null;  // vehicle has many classes
        const label = `${kind === 'people' ? 'People' : 'Vehicle'} count · ${cam}`;
        drillTo({ camera: cam, cls, label });
      },
      onHover: (_evt, els, chart) => {
        chart.canvas.style.cursor = els.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltip(),
          borderColor: color + '55',
          callbacks: { label: c => `${c.parsed.y.toLocaleString()} ${kind === 'people' ? 'persons' : 'vehicles'} · click to drill down` },
        },
      },
      scales: {
        x: {
          ticks: { color: token('--text-secondary'), font: { family: 'monospace', size: 10 }, maxRotation: 35, minRotation: 0 },
          grid:  { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0, font: { family: 'monospace', size: 10 } },
          grid:  { color: 'rgba(91,141,239,0.05)' },
        },
      },
    },
  });
}

// ============================================================
// Phase 4 — Heatmap, Quiet Cameras, Top Rules
// ============================================================

let _statsLastFrom = null;
let _statsLastTo   = null;
let _statsLastCams = '';
let _statsLastSite = '';
const _lastStats = {
  kpi: [], timeline: null, breakdown: [],
  people: [], vehicle: [], heatmap: [],
  topRules: [], quietCameras: [],
};

// ============================================================
// Phase 4 — CSV Export (pure client-side, uses cached data)
// ============================================================
function _csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function _downloadCsv(filename, rows) {
  if (!rows || !rows.length) { alert(I18N.t('stats.noExportData')); return; }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => _csvEscape(r[h])).join(',')),
  ];
  // BOM so Excel reads UTF-8 (Thai text) correctly
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCsv(kind) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  switch (kind) {
    case 'kpi':
      _downloadCsv(`kpi_${stamp}.csv`, _lastStats.kpi.map(c => ({
        category:    c.name,
        kind:        c.kind,
        count:       c.count,
        prev_count:  c.prev_count,
        change_pct:  c.change_pct,
      })));
      break;
    case 'timeline': {
      const rows = [];
      const series = (_lastStats.timeline?.series || [])
        .filter(s => _statsFocusCategoryId == null || s.category?.id === _statsFocusCategoryId);
      series.forEach(s => {
        s.points.forEach(p => rows.push({
          bucket:   p.bucket,
          category: s.category.name,
          count:    p.count,
        }));
      });
      _downloadCsv(`timeline_${stamp}.csv`, rows);
      break;
    }
    case 'breakdown':
      _downloadCsv(`breakdown_${stamp}.csv`, _lastStats.breakdown.map(b => ({
        name:       b.name,
        event_type: b.event_type,
        camera_id:  b.camera_id,
        count:      b.count,
      })));
      break;
    case 'people':
      _downloadCsv(`people_by_camera_${stamp}.csv`, _lastStats.people);
      break;
    case 'vehicle':
      _downloadCsv(`vehicle_by_camera_${stamp}.csv`, _lastStats.vehicle);
      break;
    case 'heatmap': {
      const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const rows = _lastStats.heatmap.map(c => ({
        day:   days[c.dow] || c.dow,
        hour:  c.hour,
        count: c.count,
      }));
      _downloadCsv(`heatmap_${stamp}.csv`, rows);
      break;
    }
    case 'topRules':
      _downloadCsv(`top_rules_${stamp}.csv`, _lastStats.topRules);
      break;
    case 'quietCameras':
      _downloadCsv(`quiet_cameras_${stamp}.csv`, _lastStats.quietCameras);
      break;
  }
}

async function loadHeatmap() {
  if (!_statsLastFrom || !_statsLastTo) return;
  const catSel = document.getElementById('heatmapCatFilter');
  const catId  = catSel?.value || '';
  const url    = `${API}/api/stats/heatmap?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${_statsLastSite}${catId ? `&category_id=${encodeURIComponent(catId)}` : ''}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    _lastStats.heatmap = body.cells || [];
    renderHeatmap(body.cells || []);
  } catch (e) {
    console.error('loadHeatmap:', e);
    document.getElementById('heatmapGrid').innerHTML =
      `<tr><td style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('stats.heatmapErr'))}${escapeHtml(e.message)}</td></tr>`;
  }
}

function drillHeatmapCell(dow, hour, count) {
  const catSel = document.getElementById('heatmapCatFilter');
  const catId = catSel?.value || '';
  const catLabel = catId
    ? (catSel?.selectedOptions?.[0]?.textContent || '').trim()
    : '';
  const dayLabel = I18N.t('stats.dowShort').split(',');
  const hourLabel = h => h.toString().padStart(2, '0');
  const labelParts = [
    `${dayLabel[dow] || dow} ${hourLabel(hour)}:00`,
    count != null ? `${Number(count).toLocaleString()} events` : '',
    catLabel,
  ].filter(Boolean);
  drillTo({
    dow,
    hour,
    category_id: catId || null,
    label: labelParts.join(' · '),
  });
}

function renderHeatmap(cells) {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  // Build dense 7×24 matrix (dow 0=Mon..6=Sun)
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0, max = 0;
  cells.forEach(c => {
    const d = Math.max(0, Math.min(6, c.dow));
    const h = Math.max(0, Math.min(23, c.hour));
    matrix[d][h] = c.count;
    total += c.count;
    if (c.count > max) max = c.count;
  });

  const dayLabel = I18N.t('stats.dowShort').split(',');
  const hourLabel = h => h.toString().padStart(2, '0');

  // Build header row + 7 day rows
  let html = '<thead><tr>';
  html += '<th style="text-align:right;padding:3px 8px;color:var(--text-secondary);font-weight:normal"></th>';
  for (let h = 0; h < 24; h++) {
    html += `<th style="text-align:center;padding:3px 0;color:var(--text-secondary);font-weight:normal">${hourLabel(h)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let d = 0; d < 7; d++) {
    html += `<tr><th style="text-align:right;padding:3px 8px;color:var(--text-secondary);font-weight:normal">${dayLabel[d]}</th>`;
    for (let h = 0; h < 24; h++) {
      const v = matrix[d][h];
      const ratio = max > 0 ? v / max : 0;
      // Five-level palette to match the legend swatches
      let bg;
      if (v === 0)         bg = 'rgba(91,141,239,0.05)';
      else if (ratio < 0.2) bg = 'rgba(91,141,239,0.25)';
      else if (ratio < 0.5) bg = 'rgba(91,141,239,0.55)';
      else if (ratio < 0.8) bg = 'rgba(91,141,239,0.85)';
      else                  bg = 'rgba(91,141,239,1)';
      const fg = ratio > 0.5 ? '#fff' : 'var(--text-primary)';
      const cell = v > 0
        ? `<td data-action="drillHeatmapCell" data-d="${d}" data-h="${h}" data-v="${v}" title="${escapeHtml(dayLabel[d])} ${hourLabel(h)}:00 — ${v} events · click to drill down" style="cursor:pointer;text-align:center;padding:0;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.04);height:24px;min-width:24px">${v}</td>`
        : `<td title="${escapeHtml(dayLabel[d])} ${hourLabel(h)}:00 — 0 events" style="text-align:center;padding:0;background:${bg};color:${fg};border:1px solid rgba(255,255,255,0.04);height:24px;min-width:24px"></td>`;
      html += cell;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  grid.innerHTML = html;

  document.getElementById('heatmapTotal').textContent = I18N.t('stats.hmTotalDyn')
    .replace('{n}', total.toLocaleString()).replace('{peak}', max);
}

function populateHeatmapCategoryFilter(cats) {
  const sel = document.getElementById('heatmapCatFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All categories</option>'
    + (cats || []).map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  // restore selection if still valid
  if (current && (cats || []).some(c => String(c.id) === current)) sel.value = current;
}

async function loadInsights() {
  if (!_statsLastFrom || !_statsLastTo) return;
  try {
    const [quietRes, topRes, covRes, evRes, aeRes, fsRes] = await Promise.all([
      fetch(`${API}/api/stats/quiet-cameras?since_hours=24${_statsLastSite}`),
      fetch(`${API}/api/stats/top-rules?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${_statsLastSite}&limit=10`),
      fetch(`${API}/api/stats/event-coverage?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${_statsLastSite}`),
      fetch(`${API}/api/stats/evidence?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${_statsLastSite}`),
      fetch(`${API}/api/stats/alert-effectiveness?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${_statsLastSite}`),
      fetch(`${API}/api/stats/forensic-summary?from=${encodeURIComponent(_statsLastFrom)}&to=${encodeURIComponent(_statsLastTo)}${_statsLastCams}${_statsLastSite}`),
    ]);
    if (quietRes.ok) {
      const cams = (await quietRes.json()).cameras || [];
      _lastStats.quietCameras = cams;
      renderQuietCameras(cams);
    }
    if (topRes.ok) {
      const top = (await topRes.json()).top || [];
      _lastStats.topRules = top;
      renderTopRules(top);
    }
    if (covRes.ok) {
      const cov = await covRes.json();
      _lastStats.coverage = cov;
      renderUncategorized(cov);
      renderCoverageMatrix(cov);
    }
    if (evRes.ok) {
      const ev = await evRes.json();
      _lastStats.evidence = ev;
      renderEvidence(ev);
    }
    if (aeRes.ok) {
      const ae = await aeRes.json();
      _lastStats.alertEff = ae;
      renderAlertEff(ae);
    }
    if (fsRes.ok) {
      const fs = await fsRes.json();
      _lastStats.forensic = fs;
      renderForensicSummary(fs);
    }
    updateAttentionBadge();
  } catch (e) { console.error('loadInsights:', e); }
}

function renderForensicSummary(fs) {
  const el = document.getElementById('forensicSummaryCard');
  if (!el) return;
  const t = k => escapeHtml(I18N.t(k));
  const tile = (label, val, color) =>
    `<div style="text-align:center;padding:12px 8px;background:var(--surface-base);border-radius:6px;border:1px solid var(--border-hairline)">` +
    `<div style="font-size:22px;font-weight:700;color:${color}">${val}</div>` +
    `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${label}</div></div>`;

  const tiles = [
    tile(t('stats.forensicAppearances'), fs.appearances, 'var(--accent)'),
    tile(t('stats.forensicFaces'), fs.faces, 'var(--accent)'),
    tile(t('stats.forensicMatches'), fs.face_matches, 'var(--warn)'),
  ];
  if (fs.lpr > 0) tiles.push(tile(t('stats.forensicLpr'), fs.lpr, 'var(--accent)'));

  // CSP blocks inline onclick — route through the data-action dispatcher
  const accentBtn = `background:var(--accent);color:#fff;border:none;border-radius:4px;padding:5px 12px;font-size:11px;cursor:pointer`;
  const navBtns =
    `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">` +
    `<button style="${accentBtn}" data-action="goPage" data-page="appearance">${t('stats.forensicGoAppearance')}</button>` +
    `<button style="${accentBtn}" data-action="goPage" data-page="face-matches">${t('stats.forensicGoFace')}</button>` +
    (fs.lpr > 0 ? `<button style="${accentBtn}" data-action="goPage" data-page="lpr">${t('stats.forensicGoLpr')}</button>` : '') +
    `</div>`;

  el.innerHTML =
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;padding:12px">${tiles.join('')}</div>` +
    `<div style="padding:0 12px 8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">` +
    `${navBtns}` +
    `<div style="font-size:10px;color:var(--text-secondary)">${t('stats.forensicPdpa')}</div>` +
    `</div>`;
}

function renderEvidence(ev) {
  const el = document.getElementById('evidenceCard');
  const badge = document.getElementById('evidenceAnyBadge');
  if (!el) return;
  if (badge) badge.textContent = ev.total > 0 ? `${ev.any_pct}%` : '';
  if (!ev.total) { el.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('stats.alertEffNoData'))}</div>`; return; }

  const row = (label, count, pct, color) => {
    const barColor = pct >= 80 ? token('--status-ok') : pct >= 40 ? token('--warn') : token('--status-bad');
    return `<div style="display:grid;grid-template-columns:80px 1fr 48px 52px;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border-hairline);font-size:11px">
      <div style="color:var(--text-secondary)">${escapeHtml(label)}</div>
      <div style="height:6px;background:var(--surface-overlay);border-radius:3px;overflow:hidden">
        <div style="height:100%;background:${barColor};width:${pct}%"></div>
      </div>
      <div style="text-align:right;font-weight:600;color:${barColor}">${pct}%</div>
      <div style="text-align:right;color:var(--text-secondary)">${count.toLocaleString()}</div>
    </div>`;
  };

  el.innerHTML =
    row(I18N.t('stats.evidenceSnapshot'), ev.snapshot_count, ev.snapshot_pct) +
    row(I18N.t('stats.evidenceClip'),     ev.clip_count,     ev.clip_pct) +
    row(I18N.t('stats.evidenceAny'),      ev.any_count,      ev.any_pct) +
    `<div style="padding:6px 12px;font-size:10px;color:var(--text-secondary);text-align:right">${ev.total.toLocaleString()} events total</div>`;
}

function renderAlertEff(ae) {
  const el = document.getElementById('alertEffCard');
  const badge = document.getElementById('alertEffBadge');
  if (!el) return;
  if (!ae.total) {
    if (badge) badge.textContent = '';
    el.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('stats.alertEffNoData'))}</div>`;
    return;
  }
  const rate = ae.delivery_rate;
  const rateColor = rate >= 90 ? token('--status-ok') : rate >= 60 ? token('--warn') : token('--status-bad');
  if (badge) badge.textContent = rate != null ? `${rate}%` : '';

  const skipped = ae.by_status.cooldown_skip || 0;
  const failed  = ae.by_status.failed || 0;
  const success = ae.by_status.success || 0;

  // tiles
  const tile = (label, val, color) =>
    `<div style="text-align:center;padding:10px 8px;background:var(--surface-base);border-radius:6px">
      <div style="font-size:18px;font-weight:700;color:${color}">${val}</div>
      <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${escapeHtml(label)}</div>
    </div>`;

  const rateDisplay = rate != null ? `${rate}%` : '—';
  const tilesHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 12px">
    ${tile(I18N.t('stats.alertEffRate'),    rateDisplay, rateColor)}
    ${tile(I18N.t('stats.alertEffSkipped'), skipped,     token('--warn'))}
    ${tile(I18N.t('stats.alertEffFailed'),  failed,      failed > 0 ? token('--status-bad') : token('--text-secondary'))}
  </div>`;

  // per-rule table (top 5)
  const ruleRows = (ae.by_rule || []).slice(0, 5);
  const thS = 'padding:5px 8px;text-align:left;font-size:10px;color:var(--text-secondary);border-bottom:1px solid var(--border-hairline)';
  const tdS = 'padding:6px 8px;font-size:11px;border-bottom:1px solid var(--border-hairline)';
  const tableHtml = ruleRows.length ? `<div style="overflow-x:auto;padding:0 4px 4px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${thS}">${escapeHtml(I18N.t('stats.alertEffRuleCol'))}</th>
        <th style="${thS};text-align:right">${escapeHtml(I18N.t('stats.alertEffTotalCol'))}</th>
        <th style="${thS};text-align:right">${escapeHtml(I18N.t('stats.alertEffSuccessCol'))}</th>
      </tr></thead>
      <tbody>${ruleRows.map(r => `<tr>
        <td style="${tdS};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px" title="${escapeHtml(r.rule_name)}">${escapeHtml(r.rule_name)}</td>
        <td style="${tdS};text-align:right">${r.total}</td>
        <td style="${tdS};text-align:right;color:${token('--status-ok')}">${r.success}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : '';

  // fail reasons
  const failHtml = failed > 0 && ae.fail_reasons?.length
    ? `<div style="padding:6px 12px;font-size:10px;color:${token('--status-bad')}">
        ${ae.fail_reasons.map(f => `${escapeHtml(f.error_message)} (${f.n})`).join(' · ')}
       </div>`
    : `<div style="padding:6px 12px;font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t('stats.alertEffNoFail'))}</div>`;

  el.innerHTML = tilesHtml + tableHtml + failHtml;
}

function renderUncategorized(cov) {
  const el = document.getElementById('uncategorizedList');
  const badge = document.getElementById('uncatBadge');
  if (!el) return;
  const rows = (cov.event_types || []).filter(r => r.uncategorized);
  if (badge) badge.textContent = rows.length ? rows.length : '';
  if (!rows.length) {
    el.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('stats.uncatNone'))}</div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const bucket = r.bucket;
    const bucketColor = bucket === 'incident' ? token('--status-bad') : bucket === 'analytics' ? token('--warn') : token('--text-secondary');
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border-hairline);font-size:11px">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%" title="${escapeHtml(r.event_type)}">${escapeHtml(r.event_type)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span style="color:${bucketColor};font-size:10px">${escapeHtml(bucket)}</span>
        <span style="font-weight:600;color:var(--text-primary)">${r.count.toLocaleString()}</span>
      </div>
    </div>`;
  }).join('');
}

function renderCoverageMatrix(cov) {
  const el = document.getElementById('coverageMatrix');
  const badge = document.getElementById('coveragePctBadge');
  if (!el) return;
  if (badge) badge.textContent = `${cov.coverage_pct ?? 100}%`;
  const rows = cov.event_types || [];
  if (!rows.length) { el.innerHTML = ''; return; }

  const bucketLabel = { incident: 'incident', metric: 'metric', analytics: 'analytics', face: 'face' };
  const thStyle = 'padding:6px 10px;text-align:left;font-size:10px;color:var(--text-secondary);border-bottom:1px solid var(--border-hairline);white-space:nowrap';
  const tdStyle = 'padding:7px 10px;border-bottom:1px solid var(--border-hairline);font-size:11px;';

  el.innerHTML = `<div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${thStyle}">${escapeHtml(I18N.t('stats.covColType'))}</th>
        <th style="${thStyle}">${escapeHtml(I18N.t('stats.covColBucket'))}</th>
        <th style="${thStyle};text-align:right">${escapeHtml(I18N.t('stats.covColTotal'))}</th>
        <th style="${thStyle};text-align:right">${escapeHtml(I18N.t('stats.covColUnmatched'))}</th>
        <th style="${thStyle}">${escapeHtml(I18N.t('stats.covColCategory'))}</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const unmatchedPct = r.count > 0 ? Math.round(r.unmatched_count / r.count * 100) : 0;
        const rowColor = r.uncategorized ? `background:${token('--status-bad')}12` : '';
        const unmatchedColor = unmatchedPct > 50 ? token('--status-bad') : unmatchedPct > 0 ? token('--warn') : token('--status-ok');
        return `<tr style="${rowColor}">
          <td style="${tdStyle}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="${escapeHtml(r.event_type)}">${escapeHtml(r.event_type)}</td>
          <td style="${tdStyle}color:var(--text-secondary)">${escapeHtml(bucketLabel[r.bucket] || r.bucket)}</td>
          <td style="${tdStyle}text-align:right">${r.count.toLocaleString()}</td>
          <td style="${tdStyle}text-align:right;color:${unmatchedColor};font-weight:${r.unmatched_count > 0 ? 600 : 400}">${r.unmatched_count.toLocaleString()}</td>
          <td style="${tdStyle}color:var(--text-secondary)">${escapeHtml(r.category_name || '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

// B4: Category Mapping Health — reads from _lastStats.kpi (already has rule_count after endpoint change)
function renderCategoryHealth() {
  const el = document.getElementById('categoryHealthList');
  if (!el) return;
  const cats = _lastStats.kpi || [];
  if (!cats.length) { el.innerHTML = ''; return; }

  const BUCKET_COLOR = { ok: token('--status-ok'), noRules: token('--status-bad'), noEvents: token('--warn') };
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1px;background:var(--border-hairline)">
    ${cats.map(c => {
      const noRules  = !c.rule_count;
      const noEvents = !noRules && !c.count;
      const statusKey = noRules ? 'noRules' : noEvents ? 'noEvents' : 'ok';
      const color = BUCKET_COLOR[statusKey];
      const label = I18N.t(`stats.catHealth${statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}`);
      return `<div style="background:var(--surface-elevated);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="overflow:hidden">
          <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${c.rule_count ?? 0} rules · ${(c.count || 0).toLocaleString()} events</div>
        </div>
        <span style="flex-shrink:0;background:${color}20;color:${color};padding:2px 7px;border-radius:4px;font-size:10px;white-space:nowrap">${escapeHtml(label)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

// B5: Attention badge on the Insights section title
function updateAttentionBadge() {
  const titleEl = document.getElementById('insightsSectionTitle');
  if (!titleEl) return;
  const quietCount   = (_lastStats.quietCameras || []).length;
  const uncatTypes   = (_lastStats.coverage?.event_types || []).filter(r => r.uncategorized).length;
  const noRuleCats   = (_lastStats.kpi || []).filter(c => !c.rule_count && !c.is_locked).length;
  const total = quietCount + uncatTypes + noRuleCats;
  // remove existing badge if any
  const existing = titleEl.querySelector('.attention-badge');
  if (existing) existing.remove();
  if (total > 0) {
    const badge = document.createElement('span');
    badge.className = 'attention-badge';
    badge.style.cssText = `display:inline-flex;align-items:center;justify-content:center;margin-left:8px;background:${token('--status-bad')};color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:700;vertical-align:middle`;
    badge.textContent = total;
    titleEl.appendChild(badge);
  }
}

function renderQuietCameras(cams) {
  const el = document.getElementById('quietCamsList');
  if (!el) return;
  if (!cams.length) {
    el.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('stats.allCamsActive'))}</div>`;
    return;
  }
  el.innerHTML = cams.map(c => {
    const ago = c.last_seen_ago_sec;
    const agoTxt = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago/60)}m` : `${Math.round(ago/3600)}h`;
    return `<div data-action="drillToCamera" data-camera="${escapeHtml(c.camera_id)}" data-label="${escapeHtml(c.camera_name || c.camera_id)}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--border-hairline)" title="Click to inspect this camera's events">
      <div>
        <div style="font-weight:600">${escapeHtml(c.camera_name || c.camera_id)}</div>
        <div style="font-size:10px;color:var(--text-secondary)">${escapeHtml(c.camera_id)} · last_seen ${agoTxt} ago</div>
      </div>
      <span style="background:${token('--warn')}30;color:${token('--warn')};padding:3px 8px;border-radius:4px;font-size:10px">0 events</span>
    </div>`;
  }).join('');
}

function renderTopRules(rules) {
  const el = document.getElementById('topRulesList');
  if (!el) return;
  if (!rules.length) {
    el.innerHTML = '<div style="padding:18px;text-align:center;color:var(--text-secondary);font-size:11px">No rule firings in this window</div>';
    return;
  }
  const max = rules[0]?.count || 1;
  el.innerHTML = rules.map((r, i) => {
    const pct  = (r.count / max * 100).toFixed(0);
    return `<div data-action="drillToRule" data-rule-name="${escapeHtml(r.rule_name)}" data-label="${escapeHtml('Rule: ' + r.rule_name)}" style="cursor:pointer;display:grid;grid-template-columns:24px 1fr 60px 80px;gap:8px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--border-hairline);font-size:11px" title="Click to drill down">
      <div style="color:var(--text-secondary);text-align:right">${i + 1}.</div>
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.rule_name)}">${escapeHtml(r.rule_name)}</div>
      <div style="font-size:10px;color:var(--text-secondary)"><svg aria-hidden="true" width="10" height="10" style="vertical-align:-1px"><use href="#icon-camera"/></svg> ${r.cameras_seen}</div>
      <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
        <div style="flex:1;height:5px;background:var(--surface-overlay);border-radius:3px;overflow:hidden">
          <div style="height:100%;background:${token('--accent')};width:${pct}%"></div>
        </div>
        <span style="font-weight:600;color:var(--accent);min-width:30px;text-align:right">${r.count}</span>
      </div>
    </div>`;
  }).join('');
}

// Translate (cur, prev, change_pct) into a human-friendly comparison line.
// Rules tuned for "non-statistician glance":
//   prev=0,cur>0  → "NEW"            (just started showing up)
//   prev=0,cur=0  → "no data"
//   prev>0,cur=0  → "STOPPED"
//   prev small    → show absolute "+N events" (% would be misleading)
//   normal        → "X%"             (capped at >999%)
function formatComparison(cur, prev, changePct) {
  const dim = 'color:var(--text-secondary)';
  const up  = `color:${token('--status-ok')}`;
  const dn  = `color:${token('--status-bad')}`;

  if (prev === 0 && cur === 0) return `<span style="font-size:10px;${dim}">— no data</span>`;
  if (prev === 0 && cur  >  0) return `<span style="font-size:10px;${up}">↑ NEW</span>`;
  if (prev  >  0 && cur === 0) return `<span style="font-size:10px;${dn}">▼ STOPPED</span>`;

  const diff = cur - prev;
  // baseline too small → % is unstable, show count change instead
  if (prev < 5) {
    const sign = diff > 0 ? '▲ +' : '▼ ';
    const col  = diff > 0 ? up : dn;
    return `<span style="font-size:10px;${col}">${sign}${Math.abs(diff)} events</span>`;
  }

  if (diff === 0) return `<span style="font-size:10px;${dim}">— 0% vs prev</span>`;

  // cap to keep big jumps readable
  let pct = Math.abs(changePct ?? ((diff / prev) * 100));
  let cappedPrefix = '';
  if (pct > 999) { pct = 999; cappedPrefix = '>'; }
  const arrow = diff > 0 ? '▲' : '▼';
  const col   = diff > 0 ? up : dn;
  return `<span style="font-size:10px;${col}">${arrow} ${cappedPrefix}${pct.toFixed(1)}% vs prev</span>`;
}

function renderCategoryKPI(cats) {
  // Always show every category (built-in + user-created). Hiding categories
  // that happen to be 0 in the current window would hide configuration
  // mistakes from the user — they need to see "I created this but it's 0"
  // so they can fix the mapping rule.
  const visible = cats || [];
  if (!visible.length) {
    document.getElementById('statsKpi').innerHTML =
      `<div class="stats-kpi-empty">${escapeHtml(I18N.t('stats.noCategories'))}</div>`;
    _statsFocusCategoryId = null;
    return;
  }

  if (_statsFocusCategoryId != null && !visible.some(c => c.id === _statsFocusCategoryId)) {
    _statsFocusCategoryId = null;
  }

  const allChip = `
    <button type="button" class="stats-kpi-chip stats-kpi-all ${_statsFocusCategoryId == null ? 'active' : ''}"
            data-action="setFocusCat" data-cat-id=""
            title="${escapeHtml(I18N.t('stats.focusAllSub'))}">
      <span class="stats-kpi-icon"><svg aria-hidden="true" width="13" height="13"><use href="#icon-stats"/></svg></span>
      <span class="stats-kpi-name">${escapeHtml(I18N.t('stats.focusAll'))}</span>
      <span class="stats-kpi-value">${escapeHtml(I18N.t('stats.focusAll'))}</span>
      <span class="stats-kpi-delta">${escapeHtml(I18N.t('stats.focusAllSub'))}</span>
    </button>`;

  const categoryChips = visible.map(c => {
    const cur  = c.count || 0;
    const prev = c.prev_count || 0;
    const cmp  = formatComparison(cur, prev, c.change_pct);
    const color = c.color || token('--accent');
    const active = _statsFocusCategoryId === c.id ? 'active' : '';
    const focusTitle = I18N.t('stats.focusSub').replace('{name}', c.name);
    return `
      <button type="button" class="stats-kpi-chip ${active}" style="--ka:${color}"
              data-action="setFocusCat" data-cat-id="${c.id}"
              title="${escapeHtml(focusTitle)}">
        <span class="stats-kpi-icon">${escapeHtml(c.icon || '🚨')}</span>
        <span class="stats-kpi-name">${escapeHtml(c.name)}</span>
        <span class="stats-kpi-value">${cur.toLocaleString()}</span>
        <span class="stats-kpi-delta">${cmp}</span>
      </button>
    `;
  }).join('');

  document.getElementById('statsKpi').innerHTML = allChip + categoryChips;
}

function setStatsFocusCategory(categoryId) {
  _statsFocusCategoryId = categoryId == null ? null : Number(categoryId);
  renderCategoryKPI(_lastStats.kpi || []);
  if (_lastStats.timeline && _statsLastFrom && _statsLastTo) {
    renderTimelineByCategory(_lastStats.timeline, _statsLastFrom, _statsLastTo);
  }
}

// ── Custom Range modal handlers ─────────────────────────────
function openCustomRangeModal() {
  const now = new Date();
  const yest = new Date(now.getTime() - 24 * 3600e3);
  setDtValue('crFrom', yest);
  setDtValue('crTo',   now);
  document.getElementById('crErr').style.display = 'none';
  _ensureStatsSettings().then(() => {
    document.getElementById('crCapNote').textContent =
      I18N.t('cr.capNote').replace('{n}', _statsRangeMaxDays);
  });
  document.getElementById('customRangeModal').classList.remove('hidden');
}
function closeCustomRangeModal() {
  document.getElementById('customRangeModal').classList.add('hidden');
}
function crQuick(kind) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from, to;
  if (kind === 'today')        { from = today;                                   to = new Date(); }
  else if (kind === 'yesterday') {
    from = new Date(today.getTime() - 86400e3);
    to   = new Date(today.getTime() - 1);
  }
  else if (kind === 'thisweek')  {
    const dow = (today.getDay() + 6) % 7;  // Mon=0
    from = new Date(today.getTime() - dow * 86400e3);
    to   = new Date();
  }
  else if (kind === 'lastweek')  {
    const dow = (today.getDay() + 6) % 7;
    const monThis = new Date(today.getTime() - dow * 86400e3);
    from = new Date(monThis.getTime() - 7 * 86400e3);
    to   = new Date(monThis.getTime() - 1);
  }
  else if (kind === 'thismonth') {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to   = new Date();
  }
  setDtValue('crFrom', from);
  setDtValue('crTo',   to);
}
function applyCustomRange() {
  const fromStr = getDtValue('crFrom');
  const toStr   = getDtValue('crTo');
  const err     = document.getElementById('crErr');
  if (!fromStr || !toStr) { err.textContent = I18N.t('cr.errBothRequired'); err.style.display = 'block'; return; }
  const from = new Date(fromStr), to = new Date(toStr);
  if (!(from < to)) { err.textContent = I18N.t('cr.errOrder'); err.style.display = 'block'; return; }
  const spanDays = (to - from) / 86400e3;
  if (spanDays > _statsRangeMaxDays) {
    err.textContent = I18N.t('cr.errTooLong').replace('{n}', _statsRangeMaxDays);
    err.style.display = 'block';
    return;
  }
  _statsCustomFrom = from.toISOString();
  _statsCustomTo   = to.toISOString();
  currentStatsRange = 'custom';
  document.querySelectorAll('#page-stats .per-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === 'custom');
  });
  closeCustomRangeModal();
  loadStats();
}

// Phase 2 — accepts {from, to, trunc, buckets}  (legacy, single total + alerts)
function renderTimelineChartV2(body, fromIso, toIso) {
  const data = body?.buckets || [];
  const trunc = body?.trunc || 'hour';
  const granularity = trunc === 'hour' ? 'hour' : trunc === 'week' ? 'day' : 'day';
  return renderTimelineChart(data, granularity, fromIso, toIso);
}

// One coloured line per category (uses each category's own color/icon).
// body shape: { from, to, trunc, tz, series: [{ category, points: [{bucket, count}] }] }
function renderTimelineByCategory(body, fromIso, toIso) {
  const ctx = document.getElementById('tlChart');
  if (!ctx) return;

  const trunc       = body?.trunc || 'hour';
  const granularity = trunc === 'hour' ? 'hour' : 'day';
  const allSeries   = (body?.series || []).filter(s => s.category);
  const focusSeries = _statsFocusCategoryId == null
    ? allSeries
    : allSeries.filter(s => s.category?.id === _statsFocusCategoryId);
  const series      = focusSeries;

  const sub = document.getElementById('tlSub');
  if (sub) {
    const focused = _statsFocusCategoryId == null ? null : allSeries.find(s => s.category?.id === _statsFocusCategoryId);
    sub.textContent = focused
      ? I18N.t('stats.focusSub').replace('{name}', `${focused.category.icon || ''} ${focused.category.name}`.trim())
      : I18N.t('stats.focusAllSub');
  }

  // Build a unified bucket axis from fromIso/toIso (so empty buckets render as 0)
  const fromDate = new Date(fromIso);
  const toDate   = new Date(toIso);
  const allBuckets = [];
  if (granularity === 'hour') {
    const start = new Date(fromDate); start.setMinutes(0, 0, 0);
    while (start < toDate) { allBuckets.push(start.toISOString()); start.setHours(start.getHours() + 1); }
  } else {
    const start = new Date(fromDate); start.setHours(0, 0, 0, 0);
    while (start < toDate) { allBuckets.push(start.toISOString()); start.setDate(start.getDate() + 1); }
  }

  const hasAny = series.some(s => s.points && s.points.length > 0);

  if (tlChart) { tlChart.destroy(); tlChart = null; }

  const parent = ctx.parentElement;
  parent.style.position = 'relative';
  const oldMsg = parent.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  if (!hasAny) {
    const msg = document.createElement('div');
    msg.className = 'no-data-msg';
    msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text-secondary);font-size:13px;text-align:center';
    msg.innerHTML = `${I18N.t('stats.noDataRange')}<br><span style="font-size:11px">${I18N.t('stats.tryChangeRange')}</span>`;
    parent.appendChild(msg);
    const lgd = document.getElementById('tlLegend');
    if (lgd) lgd.innerHTML = '';
    return;
  }

  const palette = [
    token('--accent'),     token('--status-ok'), token('--warn'),
    token('--status-bad'), '#a855f7',            '#06b6d4',
    '#ec4899',             '#84cc16',            '#f97316', '#14b8a6',
  ];
  const datasets = series.map((s, i) => {
    const c = s.category;
    const color = c.color || palette[i % palette.length];
    const data  = allBuckets.map(b => {
      const point = s.points.find(p => new Date(p.bucket).getTime() === new Date(b).getTime());
      return { x: b, y: point ? point.count : 0 };
    });
    return {
      label:           `${c.icon || '🚨'} ${c.name}`,
      data,
      borderColor:     color,
      backgroundColor: color + '22',
      tension:         0.3,
      fill:            false,
      pointRadius:     2,
      pointHoverRadius: 5,
      pointBackgroundColor: color,
      borderWidth:     2,
    };
  });

  tlChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { unit: granularity, displayFormats: { hour: 'HH:mm', day: 'MMM d' } },
          ticks: { color: token('--text-secondary'), maxRotation: 0, font: { family: 'monospace', size: 10 } },
          grid:  { color: token('--accent') + '0d' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0, font: { family: 'monospace', size: 10 } },
          grid:  { color: token('--accent') + '0d' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...chartTooltip() },
      },
    },
  });

  // Render the legend strip below the chart with per-category colour swatches
  const lgd = document.getElementById('tlLegend');
  if (lgd) {
    lgd.innerHTML = series.map((s, i) => {
      const c = s.category;
      const color = c.color || palette[i % palette.length];
      const icon = c.icon ? `<span class="lgdi-icon">${escapeHtml(c.icon)}</span> ` : '';
      return `<div class="lgdi"><div class="lgdd" style="background:${escapeHtml(color)}"></div>${icon}${escapeHtml(c.name)}</div>`;
    }).join('');
  }
}

// Chart.js 4.4.1's own chart.resize() is a no-op here (verified: canvas
// attrs never move, even called with explicit width/height) — the fix is to
// drive the canvas size ourselves the same way retinaScale() would, then
// repaint with update('none') instead of relying on its internal resize path.
function setChartCanvasSize(chart, cssWidth, cssHeight) {
  const canvas = chart.canvas;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  chart.width = cssWidth;
  chart.height = cssHeight;
  chart.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chart.update('none');
}

// Widen the timeline chart + let its wrapper scroll horizontally, so hourly
// ticks that are cramped on mobile (24 ticks in ~390px) spread out instead
// of Chart.js auto-thinning the x-axis labels. Width is computed relative to
// the chart's current size (never a fixed px) so it can't end up narrower
// than the default on a wide desktop viewport.
function toggleTimelineExpand() {
  const scroll = document.getElementById('tlChartScroll');
  const inner  = document.getElementById('tlChartInner');
  const btn    = document.getElementById('tlExpandBtn');
  if (!scroll || !inner || !btn) return;
  const expanding = !scroll.classList.contains('expanded');
  scroll.classList.toggle('expanded', expanding);
  btn.classList.toggle('active', expanding);
  const naturalWidth = scroll.clientWidth;
  const targetWidth = expanding ? Math.max(naturalWidth * 1.8, 900) : naturalWidth;
  inner.style.width = expanding ? targetWidth + 'px' : '';
  const useEl = btn.querySelector('use');
  if (useEl) useEl.setAttribute('href', expanding ? '#icon-collapse' : '#icon-expand');
  btn.title = I18N.t(expanding ? 'stats.collapseChart' : 'stats.expandChart');
  if (tlChart) setChartCanvasSize(tlChart, targetWidth, 280);
}

// Pie of category counts. Counter-kind categories (People/Vehicle Counting)
// are excluded — they are shown in their own bar charts below and would
// otherwise double-count alongside event-kind categories under all-match.
function renderCategoryPie(cats) {
  const data = (cats || [])
    .filter(c => c.kind === 'event' && (c.count || 0) > 0)
    .map(c => ({ name: c.name, count: c.count, color: c.color || null }))
    .sort((a, b) => b.count - a.count);
  return renderPie3D(data);
}

function renderTimelineChart(data, granularity, fromIso, toIso) {
  const ctx = document.getElementById('tlChart');
  if (!ctx) return;

  // Build all buckets
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  const allBuckets = [];
  if (granularity === 'hour') {
    const start = new Date(fromDate);
    start.setMinutes(0, 0, 0);
    while (start < toDate) {
      allBuckets.push(new Date(start).toISOString());
      start.setHours(start.getHours() + 1);
    }
  } else {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    while (start < toDate) {
      allBuckets.push(new Date(start).toISOString());
      start.setDate(start.getDate() + 1);
    }
  }

  const totalData = allBuckets.map(b => {
    const point = data.find(d => new Date(d.bucket).getTime() === new Date(b).getTime());
    return { x: b, y: point ? point.total : 0 };
  });
  const alertsData = allBuckets.map(b => {
    const point = data.find(d => new Date(d.bucket).getTime() === new Date(b).getTime());
    return { x: b, y: point ? point.alerts : 0 };
  });

  const hasAny = data.length > 0;

  if (tlChart) tlChart.destroy();

  // Show "no data" when empty
  if (!hasAny) {
    const parent = ctx.parentElement;
    parent.style.position = 'relative';
    let msg = parent.querySelector('.no-data-msg');
    if (!msg) {
      msg = document.createElement('div');
      msg.className = 'no-data-msg';
      msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:var(--text-secondary);font-size:13px;text-align:center';
      parent.appendChild(msg);
    }
    msg.innerHTML = `${I18N.t('stats.noDataRange')}<br><span style="font-size:11px">${I18N.t('stats.tryChangeRange')}</span>`;
    return;
  } else {
    const oldMsg = ctx.parentElement.querySelector('.no-data-msg');
    if (oldMsg) oldMsg.remove();
  }

  tlChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Total Events',
          data: totalData,
          borderColor: token('--accent'),
          backgroundColor: token('--accent') + '26',
          tension: 0.4, fill: true,
          pointRadius: 4, pointHoverRadius: 7,
          pointBackgroundColor: token('--accent'),
          borderWidth: 2,
        },
        {
          label: 'Alerts',
          data: alertsData,
          borderColor: token('--status-ok'),
          backgroundColor: token('--status-ok') + '1a',
          tension: 0.4, fill: true,
          pointRadius: 4, pointHoverRadius: 7,
          pointBackgroundColor: token('--status-ok'),
          borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { unit: granularity === 'hour' ? 'hour' : 'day', displayFormats: { hour: 'HH:mm', day: 'MMM d' } },
          ticks: { color: token('--text-secondary'), maxRotation: 0, font: { family: 'monospace', size: 10 } },
          grid: { color: token('--accent') + '0d' },
        },
        y: { beginAtZero: true, ticks: { color: token('--text-secondary'), precision: 0, font: { family: 'monospace', size: 10 } }, grid: { color: token('--accent') + '0d' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...chartTooltip() },
      }
    }
  });
}

function renderBreakdown(data) {
  const tbl = document.getElementById('evtTbl');
  if (data.length === 0) {
    tbl.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:30px;color:var(--text-secondary)">${escapeHtml(I18N.t('stats.noEvents'))}</td></tr>`;
    return;
  }
  const max = Math.max(...data.map(d => d.count));
  tbl.innerHTML = `
    <thead><tr><th>${escapeHtml(I18N.t('stats.brkColType'))}</th><th>${escapeHtml(I18N.t('stats.brkColFreq'))}</th><th style="text-align:right">${escapeHtml(I18N.t('stats.brkColCount'))}</th></tr></thead>
    <tbody>
      ${data.map((d, i) => {
        const color = COLORS[i % COLORS.length];
        const pct = (d.count / max * 100).toFixed(0);
        // name = COALESCE(rule_name, event_type) — when it fell through to the
        // raw event_type, show the friendly label instead (anprAlarm → ป้ายทะเบียน)
        const dispName = d.name === d.event_type ? eventTypeLabel(d.event_type) : d.name;
        const camName = (cameras.find(c => c.camera_id === d.camera_id) || {}).camera_name || d.camera_id || '';
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:7px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span><div style="min-width:0"><div>${escapeHtml(dispName)}</div>${camName ? `<div style="font-size:10px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(camName)}</div>` : ''}</div></div></td>
          <td><div class="ebar-w"><div class="ebar-bg"><div class="ebar-f" style="width:${pct}%;background:${color}"></div></div></div></td>
          <td class="ecnt" style="color:${color}">${d.count.toLocaleString()}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

// People Counting traffic (PC.1) — body from GET /api/stats/people-counting
// {bucket_sec, buckets:[{ts,enter,exit}], total_enter, total_exit}
let _pcChart = null;
function renderPeopleCounting(body) {
  const canvas = document.getElementById('pcChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const buckets = body.buckets || [];

  const totals = document.getElementById('pcTotals');
  if (totals) {
    totals.textContent = `${I18N.t('stats.pcEnter')} ${body.total_enter ?? 0} · ${I18N.t('stats.pcExit')} ${body.total_exit ?? 0}`;
  }

  if (_pcChart) { _pcChart.destroy(); _pcChart = null; }
  if (buckets.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = token('--text-secondary');
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(I18N.t('stats.pcNoData'), canvas.width / 2, canvas.height / 2);
    return;
  }

  const labels = buckets.map(b => b.ts);
  _pcChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: I18N.t('stats.pcEnter'), data: buckets.map(b => b.enter),
          backgroundColor: token('--status-ok'), borderRadius: 2 },
        { label: I18N.t('stats.pcExit'),  data: buckets.map(b => b.exit),
          backgroundColor: token('--warn'), borderRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (items) => new Date(items[0].label).toLocaleString() } },
      },
      scales: {
        x: {
          ticks: {
            color: token('--text-secondary'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
            callback: function (val) {
              const d = new Date(this.getLabelForValue(val));
              return body.bucket_sec >= 86400
                ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
                : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
            },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: token('--text-secondary'), precision: 0 },
          grid: { color: token('--border-hairline') },
        },
      },
    },
  });
}

// Zone Dwell Time (Data Enrichment Ph.1) — rows from GET /api/stats/dwell
// [{camera_id, rule_name, episodes, avg_sec, max_sec, min_sec, total_sec}]
function _fmtDwell(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

function renderDwell(rows) {
  const tbl = document.getElementById('dwellTbl');
  if (!tbl) return;
  if (!rows.length) {
    tbl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-secondary)">${escapeHtml(I18N.t('stats.dwellNone'))}</td></tr>`;
    return;
  }
  const maxAvg = Math.max(...rows.map(r => r.avg_sec || 0), 1);
  tbl.innerHTML = `
    <thead><tr>
      <th>${escapeHtml(I18N.t('stats.dwellColCamera'))}</th>
      <th>${escapeHtml(I18N.t('stats.dwellColRule'))}</th>
      <th style="text-align:right">${escapeHtml(I18N.t('stats.dwellColEpisodes'))}</th>
      <th>${escapeHtml(I18N.t('stats.dwellColAvg'))}</th>
      <th style="text-align:right">${escapeHtml(I18N.t('stats.dwellColMax'))}</th>
      <th style="text-align:right">${escapeHtml(I18N.t('stats.dwellColTotal'))}</th>
    </tr></thead>
    <tbody>
      ${rows.map((r, i) => {
        const color = COLORS[i % COLORS.length];
        const pct = (r.avg_sec / maxAvg * 100).toFixed(0);
        const camName = (cameras.find(c => c.camera_id === r.camera_id) || {}).camera_name || r.camera_id;
        return `<tr>
          <td>${escapeHtml(camName)}</td>
          <td>${escapeHtml(r.rule_name || '—')}</td>
          <td class="ecnt" style="color:${color}">${r.episodes}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="ebar-w" style="flex:0 0 80px"><div class="ebar-bg"><div class="ebar-f" style="width:${pct}%;background:${color}"></div></div></div><span style="white-space:nowrap">${_fmtDwell(r.avg_sec)}</span></div></td>
          <td style="text-align:right;white-space:nowrap">${_fmtDwell(r.max_sec)}</td>
          <td style="text-align:right;white-space:nowrap;color:var(--text-secondary)">${_fmtDwell(r.total_sec)}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

// 3D Pie chart (canvas drawing)
function renderPie3D(data) {
  const canvas = document.getElementById('pie3d');
  const lgd = document.getElementById('pie3dLgd');
  if (!canvas) return;

  if (data.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = token('--text-secondary');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(I18N.t('stats.noData'), canvas.width/2, canvas.height/2);
    lgd.innerHTML = '';
    return;
  }

  const total = data.reduce((s, d) => s + d.count, 0);
  const segs = data.map((d, i) => ({
    value: d.count,
    color: d.color || COLORS[i % COLORS.length],
    label: d.name,
    pct: d.count/total*100
  }));

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W*0.5, cy = H*0.46, rx = Math.min(W*0.40, H*0.95), ry = rx*0.42, dep = 14;
  let ang = -Math.PI/2;

  const sls = segs.map(s => {
    const sw = (s.value/total) * Math.PI * 2;
    const sl = { ...s, s: ang, e: ang+sw, m: ang+sw/2 };
    ang += sw;
    return sl;
  });

  function darken(hex, f=0.45) {
    const n = parseInt(hex.replace('#',''), 16);
    return `rgb(${Math.floor(((n>>16)&255)*f)},${Math.floor(((n>>8)&255)*f)},${Math.floor((n&255)*f)})`;
  }

  // Draw side walls (sorted by depth)
  const so = [...sls].sort((a,b) => Math.sin(a.m) - Math.sin(b.m));
  so.forEach(sl => {
    if (Math.sin(sl.m) < -0.05) return;
    const st = Math.max(4, Math.ceil((sl.e-sl.s)/0.04));
    const sp = (sl.e-sl.s)/st;
    ctx.beginPath();
    ctx.moveTo(cx + rx*Math.cos(sl.s), cy + ry*Math.sin(sl.s));
    for (let i = 1; i <= st; i++) {
      const a = sl.s + i*sp;
      ctx.lineTo(cx + rx*Math.cos(a), cy + ry*Math.sin(a));
    }
    for (let i = st; i >= 0; i--) {
      const a = sl.s + i*sp;
      ctx.lineTo(cx + rx*Math.cos(a), cy + dep + ry*Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = darken(sl.color, 0.42);
    ctx.fill();
  });

  // Draw top
  sls.forEach(sl => {
    const st = Math.max(4, Math.ceil((sl.e-sl.s)/0.03));
    const sp = (sl.e-sl.s)/st;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = 0; i <= st; i++) {
      const a = sl.s + i*sp;
      ctx.lineTo(cx + rx*Math.cos(a), cy + ry*Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = sl.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,14,26,0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  // Draw % labels
  sls.forEach(sl => {
    if (sl.pct < 5) return;
    const lx = cx + rx*0.58*Math.cos(sl.m);
    const ly = cy + ry*0.58*Math.sin(sl.m);
    ctx.font = `bold 12px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(`${sl.pct.toFixed(1)}%`, lx+0.5, ly+0.5);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${sl.pct.toFixed(1)}%`, lx, ly);
  });

  // Legend — count + % so the reader gets absolute scale without hovering
  lgd.innerHTML = sls.map(sl => `
    <div class="pli">
      <div class="psw" style="background:${sl.color};box-shadow:0 0 6px ${sl.color}55"></div>
      <div class="plt"><div class="pln">${sl.label}</div></div>
      <div class="plc">${sl.value.toLocaleString()}</div>
      <div class="plp" style="color:${sl.color}">${sl.pct.toFixed(1)}%</div>
    </div>`).join('');
}

