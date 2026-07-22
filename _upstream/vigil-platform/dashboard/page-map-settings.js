// ============================================================
// Vigil Platform — Map Settings Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// MAP CACHE MANAGER (Offline Tiles)
// ============================================================

let mapMgrPollTimer = null;
let mapMgrPreviewMap = null;


// ============================================================
// Settings › Map (decision #171)
// ============================================================
async function onShowMapSettings() {
  const inp = document.getElementById('fldMapboxToken');
  if (inp) inp.value = '';  // SEC-017: token stays server-side; field shows empty (type a new token to replace)
  await updateOfflineButtonState();
  loadMapMgrPanel();
}

function toggleMapboxTokenVis() {
  const inp = document.getElementById('fldMapboxToken');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const btn = inp.nextElementSibling;
  if (btn) btn.setAttribute('data-i18n', inp.type === 'password' ? 'set.showToken' : 'set.hideToken');
  I18N.apply();
}

async function saveMapboxToken() {
  const inp = document.getElementById('fldMapboxToken');
  const msg = document.getElementById('mapboxTokenMsg');
  if (!inp || !msg) return;
  const val = inp.value.trim();
  msg.textContent = '';
  try {
    const r = await fetch(`${API}/api/settings/map`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapboxToken: val }),
    });
    const j = await r.json();
    if (!r.ok) {
      msg.style.color = 'var(--status-bad)';
      msg.textContent = j.error === 'invalid_token_format'
        ? I18N.t('set.tokenInvalid') : (j.error || 'Error');
      return;
    }
    msg.style.color = 'var(--status-ok)';
    msg.textContent = I18N.t('set.tokenSaved');
    await reloadMapboxTokenFromConfig();
  } catch (e) {
    msg.style.color = 'var(--status-bad)';
    msg.textContent = String(e);
  }
}

async function reloadMapboxTokenFromConfig() {
  try {
    const cfg = await fetch(`${API}/api/config`).then(r => r.json());
    mapLayers._mapboxAvailable = cfg.mapboxAvailable || false;
    if (cfg.mapboxAvailable) {
      mapLayers._tileUrls.online.mapbox.streets = `${API}/api/map/tiles/mapbox/streets/{z}/{x}/{y}.png`;
      mapLayers._tileUrls.online.mapbox.light   = `${API}/api/map/tiles/mapbox/light/{z}/{x}/{y}.png`;
      if (mapLayers._currentProvider === 'mapbox' && mapLayers._currentSource === 'online') {
        applyMapTileSource();
      }
    }
    await updateOfflineButtonState();
  } catch {}
}

async function updateOfflineButtonState() {
  try {
    const { cachedTiles } = await fetch(`${API}/api/map/areas`).then(r => r.json());
    const btn = document.getElementById('togSource');
    if (!btn) return;
    const hasCache = cachedTiles > 0;
    btn.disabled = !hasCache;
    btn.title = hasCache ? I18N.t('map.tipSource') : I18N.t('map.offlineDisabledTooltip');
    if (!hasCache && mapLayers._currentSource === 'offline') {
      mapLayers._currentSource = 'online';
      localStorage.setItem('mapSource', 'online');
      applyMapTileSource();
    }
  } catch {}
}

function loadMapMgrPanel() {
  const panel = document.getElementById('mapMgrPanelContent');
  if (!panel) return;
  // Re-use existing map manager init — target the panel instead of modal
  initMapMgrPreview();
  loadSavedAreas();
  pollDownloadStatus();
  if (!document.getElementById('bboxNorth')?.value) {
    document.getElementById('bboxNorth') && (document.getElementById('bboxNorth').value = 14.0);
    document.getElementById('bboxSouth') && (document.getElementById('bboxSouth').value = 13.5);
    document.getElementById('bboxEast')  && (document.getElementById('bboxEast').value  = 100.85);
    document.getElementById('bboxWest')  && (document.getElementById('bboxWest').value  = 100.30);
    document.getElementById('zoomMin')   && (document.getElementById('zoomMin').value   = 8);
    document.getElementById('zoomMax')   && (document.getElementById('zoomMax').value   = 16);
    setTimeout(() => { updateBboxPreview && updateBboxPreview(); estimateDownload && estimateDownload(); }, 200);
  }
}

function initMapMgrPreview() {
  if (mapMgrPreviewMap) return;
  setTimeout(() => {
    mapMgrPreviewMap = new ol.Map({
      target: 'mapMgrPreview',
      layers: [new ol.layer.Tile({
        source: new ol.source.OSM({
          url: 'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
        })
      })],
      view: new ol.View({ center: ol.proj.fromLonLat([100.5018, 13.7563]), zoom: 9 })
    });
    const vectorSource = new ol.source.Vector();
    mapMgrPreviewMap.addLayer(new ol.layer.Vector({
      source: vectorSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({ color: token('--accent'), width: 2 }),
        fill: new ol.style.Fill({ color: token('--accent') + '33' })
      })
    }));
    mapMgrPreviewMap._bboxSource = vectorSource;

    // Shift+drag เพื่อกำหนด bbox
    let dragStart = null;
    mapMgrPreviewMap.on('pointerdown', (e) => {
      if (!e.originalEvent.shiftKey) return;
      dragStart = ol.proj.toLonLat(e.coordinate);
      e.preventDefault();
    });
    mapMgrPreviewMap.on('pointerup', (e) => {
      if (!dragStart) return;
      const end = ol.proj.toLonLat(e.coordinate);
      document.getElementById('bboxNorth').value = Math.max(dragStart[1], end[1]).toFixed(4);
      document.getElementById('bboxSouth').value = Math.min(dragStart[1], end[1]).toFixed(4);
      document.getElementById('bboxEast').value  = Math.max(dragStart[0], end[0]).toFixed(4);
      document.getElementById('bboxWest').value  = Math.min(dragStart[0], end[0]).toFixed(4);
      dragStart = null;
      updateBboxPreview();
      estimateDownload();
    });

    updateBboxPreview();
  }, 100);
}

function updateBboxPreview() {
  if (!mapMgrPreviewMap || !mapMgrPreviewMap._bboxSource) return;
  const n = parseFloat(document.getElementById('bboxNorth').value);
  const s = parseFloat(document.getElementById('bboxSouth').value);
  const e = parseFloat(document.getElementById('bboxEast').value);
  const w = parseFloat(document.getElementById('bboxWest').value);
  if (isNaN(n) || isNaN(s) || isNaN(e) || isNaN(w)) return;

  const coords = [[w, s], [e, s], [e, n], [w, n], [w, s]].map(c => ol.proj.fromLonLat(c));
  const polygon = new ol.geom.Polygon([coords]);
  const feature = new ol.Feature({ geometry: polygon });
  mapMgrPreviewMap._bboxSource.clear();
  mapMgrPreviewMap._bboxSource.addFeature(feature);
  mapMgrPreviewMap.getView().fit(polygon, { padding: [40, 40, 40, 40], duration: 300 });
}

async function estimateDownload() {
  const bbox = {
    north: parseFloat(document.getElementById('bboxNorth').value),
    south: parseFloat(document.getElementById('bboxSouth').value),
    east:  parseFloat(document.getElementById('bboxEast').value),
    west:  parseFloat(document.getElementById('bboxWest').value),
  };
  const zoomMin = parseInt(document.getElementById('zoomMin').value);
  const zoomMax = parseInt(document.getElementById('zoomMax').value);
  const styles = [];
  if (document.getElementById('styleStreets').checked) styles.push('streets');
  if (document.getElementById('styleLight').checked) styles.push('light');
  const providers = [];
  if (document.getElementById('provCarto')?.checked) providers.push('carto');
  if (document.getElementById('provMapbox')?.checked) providers.push('mapbox');
  if (providers.length === 0) providers.push('carto'); // fallback

  if (isNaN(bbox.north) || styles.length === 0) {
    document.getElementById('estimateInfo').innerHTML =
      `<span style="color:var(--warn)">${I18N.t('mapMgr.needCoordsStyle')}</span>`;
    return;
  }
  try {
    const res = await fetch(`${API}/api/map/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, zoomMin, zoomMax, styles, providers }),
    });
    const data = await res.json();
    const sizeMB = (data.estimatedSize / 1024 / 1024).toFixed(0);
    const sizeGB = (data.estimatedSize / 1024 / 1024 / 1024).toFixed(2);
    const display = data.estimatedSize > 1024*1024*1024 ? `${sizeGB} GB` : `${sizeMB} MB`;
    const minutes = Math.ceil(data.totalTiles / 8 / 60);

    let warning = '';
    if (providers.includes('mapbox') && !data.providers.includes('mapbox')) {
      warning = `<div style="color:var(--warn);font-size:10px;margin-top:4px">${I18N.t('mapMgr.mapboxSkipped')}</div>`;
    }

    document.getElementById('estimateInfo').innerHTML = `
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:11px;">
        <div><span style="color:var(--text-secondary)">Total tiles:</span> <strong style="color:var(--accent)">${data.totalTiles.toLocaleString()}</strong></div>
        <div><span style="color:var(--text-secondary)">Per style:</span> <strong>${data.tilesPerStyle.toLocaleString()}</strong></div>
        <div><span style="color:var(--text-secondary)">Providers:</span> <strong>${data.providers.join(', ')}</strong></div>
        <div><span style="color:var(--text-secondary)">Size:</span> <strong style="color:var(--warn)">${display}</strong></div>
        <div><span style="color:var(--text-secondary)">Time:</span> <strong>~${minutes}${I18N.t('mapMgr.minUnit')}</strong></div>
      </div>${warning}`;
  } catch (e) { console.error(e); }
}

async function startDownload() {
  const name = document.getElementById('areaName').value.trim() ||
               'Bangkok ' + new Date().toLocaleDateString('th-TH');
  const bbox = {
    north: parseFloat(document.getElementById('bboxNorth').value),
    south: parseFloat(document.getElementById('bboxSouth').value),
    east:  parseFloat(document.getElementById('bboxEast').value),
    west:  parseFloat(document.getElementById('bboxWest').value),
  };
  const zoomMin = parseInt(document.getElementById('zoomMin').value);
  const zoomMax = parseInt(document.getElementById('zoomMax').value);
  const styles = [];
  if (document.getElementById('styleStreets').checked) styles.push('streets');
  if (document.getElementById('styleLight').checked) styles.push('light');
  const providers = [];
  if (document.getElementById('provCarto')?.checked) providers.push('carto');
  if (document.getElementById('provMapbox')?.checked) providers.push('mapbox');
  if (styles.length === 0) { alert(I18N.t('mapMgr.pickStyle')); return; }
  if (providers.length === 0) { alert(I18N.t('mapMgr.pickProvider')); return; }

  try {
    const res = await fetch(`${API}/api/map/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bbox, zoomMin, zoomMax, styles, providers }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(I18N.t('mapMgr.downloadFailed') + err.error);
      return;
    }
    pollDownloadStatus();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function cancelDownload() {
  if (!confirm(I18N.t('mapMgr.confirmCancel'))) return;
  await fetch(`${API}/api/map/cancel`, { method: 'POST' });
}

function pollDownloadStatus() {
  if (mapMgrPollTimer) clearInterval(mapMgrPollTimer);
  const update = async () => {
    try {
      const res = await fetch(`${API}/api/map/progress`);
      const s = await res.json();
      const progEl = document.getElementById('downloadProgress');
      if (!progEl) return;
      if (s.active) {
        progEl.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:var(--status-ok)">${I18N.t('mapMgr.downloading')}</strong>
            <span style="color:var(--text-secondary);font-size:10px">${s.current || ''}</span>
          </div>
          <div style="background:var(--surface-overlay);border-radius:4px;height:14px;overflow:hidden;margin-bottom:6px;">
            <div style="background:var(--status-ok);height:100%;width:${s.progressPercent}%;transition:width .3s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary)">
            <span>${s.done.toLocaleString()} / ${s.total.toLocaleString()} tiles</span>
            <span>${s.progressPercent}%${s.failed > 0 ? ` · ${s.failed} failed` : ''}</span>
          </div>
          <button class="btn btn-danger" style="width:100%;margin-top:8px;padding:5px" data-action="cancelDownload">${I18N.t('mapMgr.cancel')}</button>`;
      } else if (s.startedAt && s.finishedAt) {
        progEl.innerHTML = `
          <div style="color:var(--status-ok);font-size:11px">
            ${I18N.t('mapMgr.doneLabel')} ${s.done.toLocaleString()}/${s.total.toLocaleString()} tiles
            ${s.failed > 0 ? ` (${s.failed} failed)` : ''}
          </div>`;
        loadSavedAreas();
      } else {
        progEl.innerHTML = `<div style="color:var(--text-secondary);font-size:11px">${I18N.t('mapMgr.noDownload')}</div>`;
      }
    } catch (e) { /* ignore */ }
  };
  update();
  mapMgrPollTimer = setInterval(update, 1500);
}

async function loadSavedAreas() {
  try {
    const res = await fetch(`${API}/api/map/areas`);
    const data = await res.json();
    const sizeGB = (data.cacheSize / 1024 / 1024 / 1024).toFixed(2);
    const sizeMB = (data.cacheSize / 1024 / 1024).toFixed(0);
    const sizeStr = data.cacheSize > 1024*1024*1024 ? `${sizeGB} GB` : `${sizeMB} MB`;

    document.getElementById('cacheStats').innerHTML = `
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:11px;">
        <div><span style="color:var(--text-secondary)">Cache Size:</span> <strong style="color:var(--accent)">${sizeStr}</strong></div>
        <div><span style="color:var(--text-secondary)">Cached Tiles:</span> <strong>${data.cachedTiles.toLocaleString()}</strong></div>
      </div>`;

    const areasEl = document.getElementById('savedAreas');
    if (!data.areas || data.areas.length === 0) {
      areasEl.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-secondary);font-size:11px">${I18N.t('mapMgr.noSavedAreas')}</div>`;
      return;
    }
    areasEl.innerHTML = data.areas.map(a => `
      <div style="padding:8px 12px;border-bottom:1px solid var(--border-hairline);display:flex;justify-content:space-between;align-items:center;font-size:11px">
        <div>
          <div style="font-weight:600">${a.name}</div>
          <div style="color:var(--text-secondary);font-size:10px">
            Z${a.zoomMin}-${a.zoomMax} · ${a.styles.join(', ')} · ${new Date(a.createdAt).toLocaleString('th-TH', {hour12:false})}
          </div>
        </div>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" data-action="deleteArea" data-id="${escapeHtml(a.id)}">${I18N.t('mapMgr.delete')}</button>
      </div>`).join('');
  } catch (e) { console.error(e); }
}

async function deleteArea(id) {
  if (!confirm(I18N.t('mapMgr.confirmDeleteArea'))) return;
  await fetch(`${API}/api/map/areas/${id}`, { method: 'DELETE' });
  loadSavedAreas();
}

async function clearAllCache() {
  if (!confirm(I18N.t('mapMgr.confirmClearCache'))) return;
  await fetch(`${API}/api/map/cache`, { method: 'DELETE' });
  loadSavedAreas();
  if (map && mapLayers._currentSource === 'offline') applyMapTileSource();
}

// Hook input events for live update
document.addEventListener('input', (e) => {
  if (e.target.matches('#bboxNorth, #bboxSouth, #bboxEast, #bboxWest')) {
    updateBboxPreview();
  }
  if (e.target.matches('#bboxNorth, #bboxSouth, #bboxEast, #bboxWest, #zoomMin, #zoomMax')) {
    estimateDownload();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('#styleStreets, #styleLight, #provCarto, #provMapbox')) estimateDownload();
});
