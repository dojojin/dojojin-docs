// ============================================================
// Vigil Platform — Executive Summary Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// 📈 Executive Summary page (Phase 7 — SPA merge)
// ============================================================
// Security Morning Briefing (Phase 1 / decision #172)
// ============================================================
// Was "Executive Summary" — persona changed from executive to
// Security Manager (morning check: is the system ok? any alerts?).
// Layout: Status Strip → Attention (alerts + offline cams) →
// Activity 24H + Today vs Yesterday → Site Map + Top Hotspots → Footer.
// Uses semantic tokens (--surface-elevated etc.) — no --es-* namespace.
// Backend: same /api/stats/executive-summary endpoint (no API change).

const _SUMMARY_REFRESH_MS = 30_000;

let _smbActivityChart  = null;
let _summaryMapInstance = null;
let _summaryMapSource   = null;
let _summaryHeatLayer   = null;
let _summaryMarkerLayer = null;
let _summaryShowHeat    = true;
let _summaryMapCentered = false;
let _summaryRefreshTimer = null;
let _summaryHasLoadedOnce = false;

const _summaryFmt = {
  num: n => Number(n || 0).toLocaleString(),
  pct: n => (n > 0 ? '+' : '') + (n ?? 0).toFixed(1) + '%',
  bytes: b => {
    if (!b) return '0 B';
    const units = ['B','KB','MB','GB','TB','PB'];
    let i = 0; let v = b;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[i];
  },
  duration: secs => {
    if (!secs) return '0s';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  },
  timeShort: iso => {
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
  },
  hourLabel: iso => {
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':00';
  },
};

async function loadSummary() {
  try {
    const res = await fetch(`${API}/api/stats/executive-summary`, { cache: 'no-store' });
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${res.status}${body ? ' · ' + body : ''}`);
    }
    const data = await res.json();
    _summaryApply(data);
    _summaryHasLoadedOnce = true;
    _summaryHideError();
  } catch (err) {
    console.warn('[summary] API failed:', err);
    _summaryShowError(err, _summaryHasLoadedOnce);
  }
}

function _summaryApply(d) {
  _smbRenderStrip(d.kpis, d.cameras, d.system);
  _smbRenderAttention(d.recent_events, d.cameras);
  _smbRenderActivity(d.events_24h);
  _smbRenderKpis(d.kpis);
  _smbRenderTopCams(d.top_cameras);
  _smbRenderFooter(d.system);
  _summaryInitMap(d.cameras.locations);
}

// 1. Status Strip
function _smbRenderStrip(kpis, cams, sys) {
  const el = document.getElementById('smbStrip');
  if (!el) return;
  const ratio = cams.total ? cams.online / cams.total : 1;
  const healthCls = ratio < 0.70 ? 'smb-bad' : ratio < 0.90 ? 'smb-warn' : 'smb-ok';
  const healthLabel = ratio < 0.70 ? I18N.t('smb.healthCrit') : ratio < 0.90 ? I18N.t('smb.healthWarn') : I18N.t('smb.healthOk');
  const mqttCls = sys.mqtt_connected ? 'smb-ok' : 'smb-bad';
  const mqttLabel = sys.mqtt_connected ? I18N.t('smb.stripMqttLive') : I18N.t('smb.stripMqttOff');
  const diskPct = sys.storage_total_bytes
    ? Math.round(sys.storage_used_bytes / sys.storage_total_bytes * 100) : 0;
  const diskCls = diskPct >= 90 ? 'smb-bad' : diskPct >= 75 ? 'smb-warn' : '';
  el.innerHTML =
    `<span class="${healthCls}">${healthLabel}</span><span class="smb-strip-sep">·</span>` +
    `<span><span style="color:var(--status-ok)">${cams.online}</span>/${cams.total} ${I18N.t('smb.stripCamsOnline')}</span><span class="smb-strip-sep">·</span>` +
    `<span class="${mqttCls}">${mqttLabel}</span><span class="smb-strip-sep">·</span>` +
    `<span class="${diskCls}">${diskPct}% disk</span><span class="smb-strip-sep">·</span>` +
    `<span>up ${_summaryFmt.duration(sys.uptime_seconds)}</span>`;
}

// 2a. Attention — alerts (recent events with rule_name within 4h)
// 2b. Attention — offline cameras
function _smbRenderAttention(recentEvents, cams) {
  const fourHAgo = Date.now() - 4 * 3600 * 1000;
  const alerts = (recentEvents || []).filter(e =>
    e.rule_name && new Date(e.event_time).getTime() >= fourHAgo
  );

  const alertEl = document.getElementById('smbAlerts');
  const countEl = document.getElementById('smbAlertCount');
  if (alertEl) {
    if (!alerts.length) {
      alertEl.innerHTML = `<div class="smb-empty">${escapeHtml(I18N.t('smb.noAlerts4h'))}</div>`;
    } else {
      alertEl.innerHTML = alerts.map(e => {
        const img = e.snapshot_url
          ? `<img src="${escapeHtml(e.snapshot_url)}?w=120" loading="lazy" alt="">`
          : `<svg class="smb-thumb-icon" aria-hidden="true" width="20" height="20"><use href="#icon-camera"/></svg>`;
        const evJson = escapeHtml(JSON.stringify({
          id:e.id, event_time:e.event_time, camera_id:e.camera_id,
          event_type:e.event_type, rule_name:e.rule_name,
          object_class:e.object_class, snapshot_file:e.snapshot_file||null,
        }));
        return `<div class="smb-alert-row" data-action="summaryOpenEvent" data-event-json="${evJson}">
          <div class="smb-alert-thumb">${img}</div>
          <div class="smb-alert-body">
            <div class="smb-alert-rule">${escapeHtml(e.rule_name)}</div>
            <div class="smb-alert-meta">${escapeHtml(e.camera_id||'')} · ${_summaryFmt.timeShort(e.event_time)}</div>
          </div></div>`;
      }).join('');
    }
  }
  if (countEl) countEl.textContent = alerts.length > 0 ? String(alerts.length) : '';

  const offline = (cams.locations || []).filter(c => !c.online)
    .sort((a, b) => new Date(a.last_seen_at||0) - new Date(b.last_seen_at||0));
  const offEl = document.getElementById('smbOffline');
  const offCountEl = document.getElementById('smbOfflineCount');
  if (offEl) {
    if (!offline.length) {
      offEl.innerHTML = `<div class="smb-empty" style="color:var(--status-ok)">${escapeHtml(I18N.t('smb.allOnline'))}</div>`;
    } else {
      offEl.innerHTML = offline.slice(0, 5).map(c => {
        const dur = c.last_seen_at
          ? _summaryFmt.duration(Math.floor((Date.now() - new Date(c.last_seen_at)) / 1000))
          : '—';
        return `<div class="smb-offline-row">
          <div class="smb-offline-dot"></div>
          <div class="smb-offline-name">${escapeHtml(c.camera_name||c.camera_id)}</div>
          <div class="smb-offline-dur">${escapeHtml(dur)}</div>
        </div>`;
      }).join('');
    }
  }
  if (offCountEl) offCountEl.textContent = offline.length > 0 ? String(offline.length) : '';
}

// Click an alert row → open event in context
function summaryOpenEvent(ev) {
  if (!ev) return;
  if (ev.event_type === 'FaceCapture' || ev.rule_name === 'Face Capture') {
    showPage('face-matches', document.querySelector('.nav-item[data-page="face-matches"]'));
    if (typeof _switchFaceTab === 'function') _switchFaceTab('allFaces');
    loadFaces().then(() => openFaceModal(ev.id)).catch(() => {});
  } else {
    showSnapshot(ev);
  }
}

// 3a. Activity 24H chart
function _smbRenderActivity(events_24h) {
  const labels = (events_24h||[]).map(e => _summaryFmt.hourLabel(e.hour));
  const data   = (events_24h||[]).map(e => e.count);
  if (_smbActivityChart) {
    _smbActivityChart.data.labels = labels;
    _smbActivityChart.data.datasets[0].data = data;
    _smbActivityChart.update('none');
    return;
  }
  const canvas = document.getElementById('smbActivityChart');
  if (!canvas) return;
  _smbActivityChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: token('--accent') + '99', borderColor: token('--accent'), borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { ...chartTooltip(), displayColors: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: token('--text-secondary'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: token('--accent') + '0d' }, ticks: { color: token('--text-secondary'), precision: 0, font: { size: 10 } } },
      },
    },
  });
}

// 3b. Today vs Yesterday KPIs (Events + Alerts only — Traffic/People cut per #172)
function _smbRenderKpis(kpis) {
  const el = document.getElementById('smbKpis');
  if (!el) return;
  const rows = [
    { label: I18N.t('smb.kpiEvents'), kpi: kpis.total_events },
    { label: I18N.t('smb.kpiAlerts'), kpi: kpis.alerts },
  ];
  el.innerHTML = rows.map(({ label, kpi }) => {
    const pct = kpi.change_pct ?? 0;
    const cls = kpi.trend === 'up' ? 'up' : 'down';
    const arrow = kpi.trend === 'up' ? '▲' : '▼';
    return `<div class="smb-kpi-row">
      <span class="smb-kpi-label">${escapeHtml(label)}</span>
      <span class="smb-kpi-right">
        <span class="smb-kpi-val">${_summaryFmt.num(kpi.value)}</span>
        <span class="smb-kpi-delta ${cls}">${arrow} ${_summaryFmt.pct(pct)}</span>
      </span>
    </div>`;
  }).join('') +
  `<div class="smb-kpi-row" style="margin-top:6px">
    <span class="smb-kpi-label">${escapeHtml(I18N.t('smb.kpiHealth'))}</span>
    <span class="smb-kpi-val" style="font-size:14px;${kpis.system_health.status==='Excellent'||kpis.system_health.status==='Good'?'color:var(--status-ok)':kpis.system_health.status==='Warning'?'color:var(--warn)':'color:var(--status-bad)'}">${escapeHtml(kpis.system_health.status||'—')}</span>
  </div>`;
}

// 4. Top 5 hotspots
function _smbRenderTopCams(cams) {
  const el = document.getElementById('smbTopCams');
  if (!el) return;
  const list = (cams||[]).slice(0,5);
  const maxV = Math.max(...list.map(c => c.total||0), 1);
  if (!list.length) { el.innerHTML = `<div class="smb-empty">${escapeHtml(I18N.t('smb.noDataToday'))}</div>`; return; }
  el.innerHTML = list.map((c, i) => {
    const pct = Math.round((c.total||0) / maxV * 100);
    return `<div class="smb-top-row">
      <span class="smb-top-rank">${i+1}</span>
      <span class="smb-top-name" title="${escapeHtml(c.camera_name||c.camera_id)}">${escapeHtml(c.camera_name||c.camera_id)}</span>
      <div class="smb-top-bar-wrap"><div class="smb-top-bar" style="width:${pct}%"></div></div>
      <span class="smb-top-val">${_summaryFmt.num(c.total)}</span>
    </div>`;
  }).join('');
}

// 5. Footer
function _smbRenderFooter(sys) {
  const el = document.getElementById('smbFooter');
  if (!el) return;
  const diskPct = sys.storage_total_bytes
    ? Math.round(sys.storage_used_bytes / sys.storage_total_bytes * 100) : 0;
  el.innerHTML =
    `<span>${escapeHtml(sys.version||'—')}${sys.version_date?' ('+escapeHtml(sys.version_date)+')':''}</span>` +
    `<span>up ${_summaryFmt.duration(sys.uptime_seconds)}</span>` +
    `<span>${_summaryFmt.num(sys.snapshot_count)} snaps · ${_summaryFmt.bytes(sys.snapshot_size_bytes)}</span>` +
    `<span>${_summaryFmt.num(sys.clip_count||0)} clips · ${_summaryFmt.bytes(sys.clip_size_bytes||0)}</span>` +
    `<span>disk ${diskPct}%</span>`;
}

// Camera map — mirrors the main Map page: CARTO Streets basemap (locked,
// no style picker), camera markers from the DB, click-popup with details,
// and a heatmap layer with a single ON/OFF toggle. Focuses on the most
// recently ADDED camera (locations[0]; endpoint orders by created_at DESC)
// — only on page-enter, not on every 30s background refresh.
function _summaryInitMap(locations) {
  const hasLocations = Array.isArray(locations) && locations.length > 0;
  const features = hasLocations ? locations.map(p => new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat([parseFloat(p.lon), parseFloat(p.lat)])),
    cam: p,                                         // full row → popup reads from this
    heat: Math.min(1, (p.event_count || 0) / 1000),
    online: !!p.online,
  })) : [];

  _summaryToggleMapEmptyState(!hasLocations);

  // Reuse the map across refreshes — just swap the feature source.
  if (_summaryMapInstance) {
    if (_summaryMapSource) {
      _summaryMapSource.clear();
      if (features.length) _summaryMapSource.addFeatures(features);
    }
    // Focus the newest camera only if we haven't centered yet this visit.
    if (hasLocations && !_summaryMapCentered) {
      _summaryFocusNewestCamera(locations);
    }
    setTimeout(() => _summaryMapInstance && _summaryMapInstance.updateSize(), 50);
    return;
  }

  // First-time construction.
  _summaryMapSource = new ol.source.Vector({ features });

  _summaryHeatLayer = new ol.layer.Heatmap({
    source: _summaryMapSource,
    blur: 28, radius: 24,
    weight: (f) => f.get('heat'),
    gradient: ['#00ff00', '#ffff00', '#ff8800', '#ff0000'],
    visible: _summaryShowHeat,
  });
  _summaryMarkerLayer = new ol.layer.Vector({
    source: _summaryMapSource,
    style: (f) => {
      const cam = f.get('cam') || {};
      const count = cam.event_count || 0;
      const camName = cam.camera_name || cam.camera_id || '';
      // Text label above the dot — same pattern as the main Map page
      // (📷 name + 24h event count) so the camera name is visible
      // without clicking.
      const label = count > 0 ? `${camName} (${count})` : camName;
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 7,
          fill: new ol.style.Fill({
            color: !f.get('online') ? '#5a6a85' :
                   f.get('heat') > 0.7 ? token('--status-bad') :
                   f.get('heat') > 0.4 ? token('--warn')       : token('--status-ok'),
          }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 }),
        }),
        text: new ol.style.Text({
          text: label, offsetY: -18,
          fill: new ol.style.Fill({ color: '#ffffff' }),
          stroke: new ol.style.Stroke({ color: '#0a0e1a', width: 3 }),
          font: 'bold 11px sans-serif',
        }),
      });
    },
  });

  const center = hasLocations
    ? ol.proj.fromLonLat([parseFloat(locations[0].lon), parseFloat(locations[0].lat)])
    : ol.proj.fromLonLat([100.5018, 13.7563]);     // Bangkok fallback
  const view = new ol.View({ center, zoom: hasLocations ? 16 : 6 });

  _summaryMapInstance = new ol.Map({
    target: 'smbMap',
    layers: [
      // CARTO Streets (voyager) — locked, same basemap as the main Map
      // page's "STREETS" option. No provider/style toggle here.
      new ol.layer.Tile({
        source: new ol.source.XYZ({
          url: 'https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          attributions: '© OpenStreetMap, © CARTO',
        }),
      }),
      _summaryHeatLayer,
      _summaryMarkerLayer,
    ],
    view,
    controls: ol.control.defaults.defaults({ attribution: false, zoom: true }),
  });

  // Click a marker → popup with camera details (same fields as main Map page).
  _summaryMapInstance.on('singleclick', (evt) => {
    const feat = _summaryMapInstance.forEachFeatureAtPixel(evt.pixel, f => f);
    if (feat && feat.get('cam')) _summaryShowMapPopup(feat.get('cam'), evt.pixel);
    else _summaryHideMapPopup();
  });
  _summaryMapInstance.on('pointermove', (evt) => {
    const hit = _summaryMapInstance.hasFeatureAtPixel(evt.pixel);
    _summaryMapInstance.getTargetElement().style.cursor = hit ? 'pointer' : '';
  });

  if (hasLocations) _summaryMapCentered = true;
  setTimeout(() => _summaryMapInstance && _summaryMapInstance.updateSize(), 100);
}

// Focus (pan + zoom) on the most recently added camera. locations[0] is it —
// the endpoint orders by created_at DESC.
function _summaryFocusNewestCamera(locations) {
  if (!_summaryMapInstance || !locations || !locations.length) return;
  const newest = locations[0];
  _summaryMapInstance.getView().animate({
    center: ol.proj.fromLonLat([parseFloat(newest.lon), parseFloat(newest.lat)]),
    zoom: 16,
    duration: 400,
  });
  _summaryMapCentered = true;
}

// Heatmap ON/OFF toggle — the only map control on the Executive Summary.
function toggleSummaryHeatmap() {
  _summaryShowHeat = !_summaryShowHeat;
  if (_summaryHeatLayer) _summaryHeatLayer.setVisible(_summaryShowHeat);
  const btn = document.getElementById('smbHeatToggle');
  if (btn) {
    btn.classList.toggle('heat-off', !_summaryShowHeat);
    btn.textContent = I18N.t(_summaryShowHeat ? 'smb.heatmapOn' : 'smb.heatmapOff');
  }
}

function _summaryShowMapPopup(cam, pixel) {
  const popup = document.getElementById('summaryMapPopup');
  if (!popup) return;
  const online = !!cam.online;
  const statusCls = online ? 'online' : 'offline';
  const lastSeen = cam.last_seen_at
    ? new Date(cam.last_seen_at).toLocaleString('th-TH', { hour12: false })
    : '—';
  popup.innerHTML = `
    <div class="smp-name">${escapeHtml(cam.camera_name || cam.camera_id)}</div>
    <div class="smp-row"><span class="smp-label">CAMERA ID</span><span class="smp-val">${escapeHtml(cam.camera_id)}</span></div>
    <div class="smp-row"><span class="smp-label">IP</span><span class="smp-val">${escapeHtml(cam.ip_address || '—')}</span></div>
    <div class="smp-row"><span class="smp-label">LOCATION</span><span class="smp-val">${escapeHtml(cam.location || '—')}</span></div>
    <div class="smp-row"><span class="smp-label">STATUS</span><span class="smp-val ${statusCls}">${online ? 'ONLINE' : 'OFFLINE'}</span></div>
    <div class="smp-row"><span class="smp-label">EVENTS 24H</span><span class="smp-val">${cam.event_count || 0}</span></div>
    <div class="smp-row"><span class="smp-label">LAST SEEN</span><span class="smp-val">${escapeHtml(lastSeen)}</span></div>`;
  popup.classList.remove('hidden');
  const h = popup.offsetHeight;
  popup.style.left = `${Math.max(4, pixel[0] - 120)}px`;
  popup.style.top  = `${Math.max(4, pixel[1] - h - 18)}px`;
}

function _summaryHideMapPopup() {
  const popup = document.getElementById('summaryMapPopup');
  if (popup) popup.classList.add('hidden');
}

// Banner overlaid on top of the map when no camera has lat/lon. Tells the
// user how to fix it instead of leaving a featureless dark rectangle.
function _summaryToggleMapEmptyState(empty) {
  const wrap = document.getElementById('smbMap');
  if (!wrap) return;
  let hint = document.getElementById('summaryMapEmptyHint');
  if (empty) {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'summaryMapEmptyHint';
      hint.style.cssText =
        'position:absolute;top:10px;left:10px;right:10px;' +
        'background:var(--surface-elevated);border:1px solid var(--warn);' +
        'color:var(--text-primary);font-size:12px;line-height:1.5;' +
        'padding:8px 12px;border-radius:7px;z-index:10;pointer-events:auto';
      hint.innerHTML =
        '<strong style="color:var(--warn)">No GPS coordinates set</strong> · ' +
        'set lat/lon on each camera in <em>Settings</em> → Camera → edit.';
      wrap.style.position = wrap.style.position || 'relative';
      wrap.appendChild(hint);
    }
    hint.style.display = '';
  } else if (hint) {
    hint.style.display = 'none';
  }
}

function _summaryShowError(err, hadDataBefore) {
  let banner = document.getElementById('summaryErrorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'summaryErrorBanner';
    banner.style.cssText =
      'background:var(--status-bad);color:#fff;padding:10px 14px;font-size:13px;' +
      'border-radius:8px;margin:10px 0 14px;display:flex;align-items:center;' +
      'gap:10px;line-height:1.4';
    const page = document.getElementById('page-summary');
    if (page) page.insertBefore(banner, page.firstChild);
  }
  const detail = (err && err.message) || 'unknown error';
  banner.innerHTML =
    `<span><strong>Live data unavailable.</strong> ` +
    (hadDataBefore
      ? `Showing the most recent successful load. Auto-retrying every 30s. `
      : `No data has loaded yet. Auto-retrying every 30s. `) +
    `<span style="opacity:.85">Reason: ${escapeHtml(detail)}</span></span>`;
  banner.style.display = 'flex';
}

function _summaryHideError() {
  const banner = document.getElementById('summaryErrorBanner');
  if (banner) banner.style.display = 'none';
}

function startSummaryAutoRefresh() {
  if (_summaryRefreshTimer) return;
  _summaryRefreshTimer = setInterval(() => {
    if (!document.hidden &&
        document.getElementById('page-summary')?.classList.contains('active')) {
      loadSummary();
    }
  }, _SUMMARY_REFRESH_MS);
}
function stopSummaryAutoRefresh() {
  if (_summaryRefreshTimer) { clearInterval(_summaryRefreshTimer); _summaryRefreshTimer = null; }
}
