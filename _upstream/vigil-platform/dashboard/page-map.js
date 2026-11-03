// ============================================================
// Vigil Platform — Map Page (OpenLayers)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

// MAP — with toggle and hover popup
// ============================================================

// CARTO ต้องมี ?key= ตั้งแต่ 2026 (ไม่มี = ได้ tile ลายน้ำ "API KEY REQUIRED")
// key นี้ตั้งใจส่งถึง browser — ต่างจาก mapbox token ที่ proxy ไว้ (SEC-017)
let _cartoKeyPromise = null;
function cartoKey() {                       // → Promise<string>
  if (!_cartoKeyPromise) {
    // r.ok ต้องเช็ค — ถ้า 401/500 แล้วปล่อยผ่าน cfg.cartoKey จะเป็น undefined
    // แล้วเราจะเขียน '' ทับ seed ใน localStorage = รอบหน้าได้ลายน้ำวาบอีก
    _cartoKeyPromise = fetch(`${API}/api/config`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(cfg => { const k = cfg.cartoKey || '';
                     localStorage.setItem('cartoKey', k); return k; })
      .catch(() => localStorage.getItem('cartoKey') || '');
  }
  return _cartoKeyPromise;
}
function cartoUrl(style, key) {             // style: 'streets' | 'light'
  const path = style === 'light' ? 'light_all' : 'rastertiles/voyager';
  return `https://{a-c}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png`
       + (key ? `?key=${encodeURIComponent(key)}` : '');
}

function initMap() {
  // 🆕 Map providers — Carto (default, free) + Mapbox (POI ละเอียด, ต้อง token)
  const seedKey = localStorage.getItem('cartoKey') || '';
  const tileUrls = {
    online: {
      carto: {
        streets: cartoUrl('streets', seedKey),
        light:   cartoUrl('light', seedKey),
      },
      mapbox: {
        // จะถูก replace ด้วย token จริงตอน apply
        streets: '__MAPBOX_STREETS__',
        light:   '__MAPBOX_LIGHT__',
      },
    },
    offline: {
      carto: {
        streets: '/tiles/carto/streets/{z}/{x}/{y}.png',
        light:   '/tiles/carto/light/{z}/{x}/{y}.png',
      },
      mapbox: {
        streets: '/tiles/mapbox/streets/{z}/{x}/{y}.png',
        light:   '/tiles/mapbox/light/{z}/{x}/{y}.png',
      },
    },
  };

  // โหลดค่าจาก localStorage
  let savedStyle = localStorage.getItem('mapStyle') || 'streets';
  if (savedStyle === 'dark') savedStyle = 'streets';
  const savedSource   = localStorage.getItem('mapSource')   || 'online';
  const savedProvider = localStorage.getItem('mapProvider') || 'carto';

  // เก็บ reference สำหรับ toggle
  mapLayers._tileUrls = tileUrls;
  mapLayers._currentStyle    = savedStyle;
  mapLayers._currentSource   = savedSource;
  mapLayers._currentProvider = savedProvider;
  mapLayers._mapboxAvailable = false;

  // โหลด mapbox + carto config จาก backend (async)
  // SEC-017: mapbox token stays server-side; CARTO key is public by design
  let needsApply = false;
  fetch(`${API}/api/config`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(cfg => {
      mapLayers._mapboxAvailable = cfg.mapboxAvailable || false;
      // CARTO: เก็บ key ลง localStorage เพื่อให้ initMap รอบหน้า seed URL ได้ตั้งแต่
      // ตอนสร้าง layer — ไม่งั้นทุกครั้งที่เปิดหน้าแผนที่จะยิง tile ลายน้ำหนึ่งชุดก่อน
      // แล้วยิงซ้ำอีกชุดหลัง config มาถึง (เห็นลายน้ำวาบ + จำนวน request เป็นสองเท่า)
      const freshKey = cfg.cartoKey || '';
      localStorage.setItem('cartoKey', freshKey);
      if (freshKey !== seedKey) {   // steady state = ไม่ rebuild เลย
        tileUrls.online.carto.streets = cartoUrl('streets', freshKey);
        tileUrls.online.carto.light   = cartoUrl('light', freshKey);
        needsApply = needsApply || (mapLayers._currentProvider === 'carto' && mapLayers._currentSource === 'online');
      }
      // Mapbox: setup proxy URLs if available
      if (cfg.mapboxAvailable) {
        // SEC-017: proxy URLs — token never leaves the server
        tileUrls.online.mapbox.streets = `${API}/api/map/tiles/mapbox/streets/{z}/{x}/{y}.png`;
        tileUrls.online.mapbox.light   = `${API}/api/map/tiles/mapbox/light/{z}/{x}/{y}.png`;
        needsApply = needsApply || (mapLayers._currentProvider === 'mapbox' && mapLayers._currentSource === 'online');
      } else if (savedProvider === 'mapbox') {
        mapLayers._currentProvider = 'carto';
        localStorage.setItem('mapProvider', 'carto');
        needsApply = true;
      }
      if (needsApply) applyMapTileSource();
    }).catch(() => {});

  // Helper: get current URL safely (handles mapbox token not loaded yet)
  const getCurrentUrl = () => {
    const url = tileUrls[savedSource][savedProvider]?.[savedStyle];
    // ถ้าเป็น mapbox แต่ token ยังไม่โหลด → ใช้ carto ก่อน
    if (url && url.startsWith('__MAPBOX')) {
      return tileUrls[savedSource].carto[savedStyle];
    }
    return url;
  };

  // สร้าง base layer
  mapLayers.base = new ol.layer.Tile({
    source: new ol.source.XYZ({
      url: getCurrentUrl(),
      crossOrigin: 'anonymous',
      attributions: getAttribution(savedSource, savedProvider),
    })
  });

  map = new ol.Map({
    target: 'map',
    layers: [mapLayers.base],
    view: new ol.View({ center: ol.proj.fromLonLat([100.5018, 13.7563]), zoom: 12 })
  });

  // ปรับ background ของ #map (ทั้ง 2 style พื้นหลังสว่าง)
  document.getElementById('map').style.background = '#f5f5f5';

  // Heatmap layer
  mapLayers.heat = new ol.layer.Heatmap({
    source: new ol.source.Vector(),
    blur: 25,
    radius: 18,
    weight: (f) => f.get('weight') || 0.5,
  });
  map.addLayer(mapLayers.heat);

  // Camera markers layer with clustering — at 100+ cameras in a building
  // the individual markers crowd together and the text labels overlap into
  // unreadable mush. Cluster source groups features within 40 px of each
  // other into a single bubble; zoom in to break them apart. Hover-popup
  // still works on single-feature clusters; clicking a multi-feature
  // cluster zooms the view to the bounding box of its children.
  mapLayers._camRawSrc = new ol.source.Vector();
  const camClusterSrc = new ol.source.Cluster({
    distance: 40,
    source: mapLayers._camRawSrc,
  });
  function camMarkerStyle(feature) {
    const fs = feature.get('features') || [];
    // Multi-feature cluster — fill = online mix; stroke = group color if
    // all features share one group, neutral gray if mixed groups.
    if (fs.length > 1) {
      const onlineN = fs.filter(f => f.get('online')).length;
      const fill = onlineN === fs.length ? token('--status-ok')
                 : onlineN === 0         ? token('--muted')
                                         : token('--warn');
      const groupIdSet = new Set(fs.map(f => f.get('group_id')));
      const strokeColor = groupIdSet.size === 1
        ? (fs[0].get('group_color') || token('--muted'))
        : token('--muted');
      return new ol.style.Style({
        image: new ol.style.Circle({
          radius: 14 + Math.min(fs.length, 30) * 0.4,
          fill: new ol.style.Fill({ color: fill }),
          stroke: new ol.style.Stroke({ color: strokeColor, width: 3 }),
        }),
        text: new ol.style.Text({
          text: String(fs.length),
          fill: new ol.style.Fill({ color: '#fff' }),
          font: 'bold 13px sans-serif',
        }),
      });
    }
    // Single feature — fill = online/offline status; stroke = group color.
    const f = fs[0] || feature;
    const online = f.get('online');
    const camName = f.get('name') || '';
    const count = f.get('eventCount') || 0;
    const groupColor = f.get('group_color') || token('--muted');
    const label = count > 0 ? `${camName} (${count})` : camName;
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: 9,
        fill: new ol.style.Fill({ color: online ? token('--status-ok') : token('--muted') }),
        stroke: new ol.style.Stroke({ color: groupColor, width: 3 }),
      }),
      text: new ol.style.Text({
        text: label, offsetY: -20,
        fill: new ol.style.Fill({ color: '#fff' }),
        stroke: new ol.style.Stroke({ color: '#0a0e1a', width: 3 }),
        font: 'bold 11px sans-serif',
      }),
    });
  }
  mapLayers.cams = new ol.layer.Vector({ source: camClusterSrc, style: camMarkerStyle });
  map.addLayer(mapLayers.cams);

  // Hover popup — features delivered here are cluster wrappers. Only show
  // the popup when the wrapper holds exactly one underlying feature; for
  // multi-feature clusters, just hide the popup (the count is on the bubble).
  map.on('pointermove', (e) => {
    if (e.dragging) return;
    const pixel = map.getEventPixel(e.originalEvent);
    const feature = map.forEachFeatureAtPixel(pixel, (f, layer) => layer === mapLayers.cams ? f : null);
    const fs = feature ? (feature.get('features') || []) : [];
    if (fs.length === 1) showCamPopup(fs[0], pixel);
    else hidePopup();
  });

  map.on('click', (e) => {
    map.forEachFeatureAtPixel(e.pixel, (f, layer) => {
      if (layer !== mapLayers.cams) return;
      const fs = f.get('features') || [];
      if (fs.length > 1) {
        // Multi-feature cluster — zoom in to spread its children apart.
        const ext = ol.extent.createEmpty();
        fs.forEach(child => ol.extent.extend(ext, child.getGeometry().getExtent()));
        map.getView().fit(ext, { padding: [80, 80, 80, 80], maxZoom: 19, duration: 400 });
      } else if (fs.length === 1 && fs[0].get('camera_id')) {
        // Single — pin popup on click; auto-hide after 3s.
        clearTimeout(mapPopupTimer);
        mapPopupTimer = setTimeout(hidePopup, 3000);
      }
    });
  });
}

function toggleMapLayer(which, btn) {
  if (which === 'heat') {
    mapShowHeat = !mapShowHeat;
    mapLayers.heat.setVisible(mapShowHeat);
  } else {
    mapShowCams = !mapShowCams;
    mapLayers.cams.setVisible(mapShowCams);
  }
  btn.classList.toggle('active');
}

// Set a map-toggle button's label without wiping its <svg><use> icon —
// btn.textContent = '...' used to erase the icon child on every toggle
// AND on every page-load sync (dashboard.js showPage('map')), leaving
// STREETS/CARTO/ONLINE permanently blank (ROADMAP icon-sprite backlog audit,
// 2026-07-03 — the symbols were never missing, this clobber was the bug).
function setMapToggleLabel(btn, iconId, label) {
  if (!btn) return;
  btn.innerHTML = `<svg width="13" height="13" aria-hidden="true"><use href="#${iconId}"/></svg> ${label}`;
}

// 🆕 Toggle Streets / Light map style
function toggleMapStyle() {
  if (!map || !mapLayers.base) return;
  const newStyle = mapLayers._currentStyle === 'streets' ? 'light' : 'streets';
  mapLayers._currentStyle = newStyle;
  applyMapTileSource();
  setMapToggleLabel(document.getElementById('togStyle'), 'icon-layers', newStyle === 'streets' ? 'STREETS' : 'LIGHT');
  localStorage.setItem('mapStyle', newStyle);
}

// 🆕 Toggle Online / Offline tile source
function toggleMapSource() {
  if (!map || !mapLayers.base) return;
  const newSource = mapLayers._currentSource === 'online' ? 'offline' : 'online';
  mapLayers._currentSource = newSource;
  applyMapTileSource();
  setMapToggleLabel(document.getElementById('togSource'), 'icon-globe', newSource === 'online' ? 'ONLINE' : 'OFFLINE');
  localStorage.setItem('mapSource', newSource);
}

// 🆕 Toggle Carto / Mapbox provider
function toggleMapProvider() {
  if (!map || !mapLayers.base) return;
  const current = mapLayers._currentProvider || 'carto';
  const newProvider = current === 'carto' ? 'mapbox' : 'carto';

  if (newProvider === 'mapbox' && !mapLayers._mapboxAvailable) {
    alert(I18N.t('map.noMapboxToken'));
    return;
  }

  mapLayers._currentProvider = newProvider;
  applyMapTileSource();
  setMapToggleLabel(document.getElementById('togProvider'), 'icon-layers', newProvider === 'carto' ? 'CARTO' : 'MAPBOX');
  localStorage.setItem('mapProvider', newProvider);
}

// Helper: build attribution string
function getAttribution(source, provider) {
  if (source === 'offline') return 'Offline cache · © OpenStreetMap contributors';
  if (provider === 'mapbox') return '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  return '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>';
}

// Apply current style + source + provider combination to map
function applyMapTileSource() {
  const style    = mapLayers._currentStyle;
  const source   = mapLayers._currentSource;
  const provider = mapLayers._currentProvider || 'carto';

  let url = mapLayers._tileUrls[source][provider]?.[style];
  // Fallback ถ้าไม่มี url (เช่น mapbox token ยังไม่โหลด)
  if (!url || url.startsWith('__MAPBOX')) {
    url = mapLayers._tileUrls[source].carto[style];
  }

  mapLayers.base.setSource(new ol.source.XYZ({
    url,
    crossOrigin: 'anonymous',
    attributions: getAttribution(source, provider),
  }));
}

// Auto-refresh "EVENTS 24H" + heatmap while user is on the map page.
// Without this, the rolling-24h number could be 30+ minutes stale before the
// user navigates away and comes back. 60s matches the today-counts cadence.
let _mapRefreshTimer = null;
function startMapAutoRefresh() {
  if (_mapRefreshTimer) return;
  _mapRefreshTimer = setInterval(() => {
    if (document.getElementById('page-map')?.classList.contains('active')) refreshMap();
  }, 60_000);
}
function stopMapAutoRefresh() {
  if (_mapRefreshTimer) { clearInterval(_mapRefreshTimer); _mapRefreshTimer = null; }
}

async function refreshMap() {
  if (!map) return;

  // Build camera_id → group lookup from groups[] (cameraIds membership).
  // Cameras not in any group get group_id=null (always visible).
  const camGroupMap = {};
  groups.forEach(g => {
    (g.cameraIds || []).forEach(cid => { camGroupMap[cid] = g; });
  });

  // All cameras with coordinates; filter by legend visibility + site pill.
  const allCams = cameras.filter(c => c.latitude && c.longitude);
  const visCams = allCams.filter(c => {
    const g = camGroupMap[c.camera_id];
    if (g && hiddenGroupIds.has(g.id)) return false;
    if (_mapActiveSiteId && c.site_id !== _mapActiveSiteId) return false;
    return true;
  });

  try {
    const res = await fetch(`${API}/api/heatmap?hours=24`);
    const data = await res.json();
    const counts = {};
    data.forEach(d => { counts[d.camera_id] = d.count; });

    const heatSrc = mapLayers.heat.getSource();
    // Features go into the RAW vector source; the Cluster source wraps it
    // and exposes groupings to the layer. Calling .getSource() on the
    // layer would return the Cluster (clearing it isn't supported).
    const camSrc = mapLayers._camRawSrc;
    heatSrc.clear();
    camSrc.clear();

    const maxCount = Math.max(1, ...Object.values(counts));

    // Spread co-located cameras: several cameras at the SAME lat/long (e.g. a
    // gate imported from one CSV row-set) would stack into a single point the
    // Cluster can never split — zooming to a degenerate bbox does nothing. Fan
    // each shared-coordinate group into a small ring (~15 m) around the true
    // point at RENDER time only; the stored lat/long is never changed.
    const _coKey = (c) => `${parseFloat(c.longitude).toFixed(6)},${parseFloat(c.latitude).toFixed(6)}`;
    const _coGroups = new Map();
    visCams.forEach(c => { const k = _coKey(c); if (!_coGroups.has(k)) _coGroups.set(k, []); _coGroups.get(k).push(c); });
    const _spreadCoord = (c) => {
      let lng = parseFloat(c.longitude), lat = parseFloat(c.latitude);
      const grp = _coGroups.get(_coKey(c));
      if (grp && grp.length > 1) {
        const i = grp.indexOf(c), R = 0.00014;   // ~15 m in degrees latitude
        const ang = 2 * Math.PI * i / grp.length;
        lat += R * Math.sin(ang);
        lng += R * Math.cos(ang) / Math.max(0.2, Math.cos(lat * Math.PI / 180));
      }
      return ol.proj.fromLonLat([lng, lat]);
    };

    visCams.forEach(c => {
      const count = counts[c.camera_id] || 0;
      const coord = _spreadCoord(c);
      const grp = camGroupMap[c.camera_id];

      camSrc.addFeature(new ol.Feature({
        geometry: new ol.geom.Point(coord),
        camera_id: c.camera_id,
        name: c.camera_name || c.camera_id,
        ip: c.ip_address,
        location: c.location,
        status: c.status,
        online: c.status === 'online',
        eventCount: count,
        cam: c,
        group_id: grp ? grp.id : null,
        group_color: grp ? (grp.color || '#94a3b8') : '#94a3b8',
      }));

      if (count > 0) {
        const f = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        f.set('weight', Math.max(0.3, count / maxCount));
        heatSrc.addFeature(f);
      }
    });

    if (visCams.length > 0 && !_mapWallOn) {
      const ext = camSrc.getExtent();
      if (ext[0] !== Infinity) {
        map.getView().fit(ext, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 400 });
      }
    }

    document.getElementById('mapCamLabel').textContent =
      I18N.t('map.nCameras').replace('{n}', visCams.length);

    // Stats bar — counts based on visible cameras only.
    const online = visCams.filter(c => c.status === 'online').length;
    const offline = visCams.length - online;
    const totalEvents = visCams.reduce((s, c) => s + (counts[c.camera_id] || 0), 0);
    document.getElementById('mapStatsBar').innerHTML = `
      <div class="ms-item"><div class="ms-dot" style="background:var(--status-ok)"></div><div><div class="ms-txt">ONLINE</div><div class="ms-val" style="color:var(--status-ok)">${online}</div></div></div>
      <div class="ms-item"><div class="ms-dot" style="background:var(--status-bad)"></div><div><div class="ms-txt">OFFLINE</div><div class="ms-val" style="color:var(--status-bad)">${offline}</div></div></div>
      <div class="ms-item" title="${I18N.t('map.events24hTip')}"><div class="ms-dot" style="background:var(--accent)"></div><div><div class="ms-txt">EVENTS 24H (rolling)</div><div class="ms-val" style="color:var(--accent)">${totalEvents}</div></div></div>
    `;
  } catch (e) { console.error('refreshMap:', e); }
}

// Inline site filter, appended after the map title — own state, separate
// from page-cameras.js's _activeSiteId (sharing would make picking a site
// on one page silently re-filter the other). Auto-hides for single-site
// deployments/scoped viewers — same as renderSiteTabs() on Camera Status.
let _mapActiveSiteId = null;

function renderMapSiteFilter() {
  renderSitePills('mapSitePills', _mapActiveSiteId, 'setMapActiveSite');
}

function setMapActiveSite(sid) {
  _mapActiveSiteId = sid ? Number(sid) : null;
  renderMapSiteFilter();
  // grpBarMap is usually hidden (renderMapLegend() uses its own site-scoped
  // legend instead whenever groups exist) but is now site-scoped too, same
  // as grpBar/grpBarEvents/grpBarSnap/grpBarMedia — keep it consistent for
  // the groups.length === 0 case where it's the one shown.
  renderGroupBars();
  renderMapLegend();
  refreshMap();
}

// On mobile the legend becomes a full-width bar along the BOTTOM of the map,
// and its height depends on how many camera groups wrap onto how many lines —
// 240px of a 460px map with six groups. The plate list is anchored to the top,
// so without knowing that height it grows straight into the legend. Measure it
// instead of picking another magic number: this is the same class of bug as the
// top:150px it replaces, just pointing the other way.
let _mapLegendRO = null;
function _watchMapLegendHeight() {
  const legend = document.getElementById('mapLegendPanel');
  const wrap = legend?.closest('.map-wrapper') || legend?.parentElement?.parentElement;
  if (!legend || !wrap || _mapLegendRO) return;
  const apply = () => wrap.style.setProperty('--map-legend-h', `${Math.ceil(legend.getBoundingClientRect().height)}px`);
  _mapLegendRO = new ResizeObserver(apply);
  _mapLegendRO.observe(legend);
  apply();
}

// The toolbar overlays the map at top-right on desktop, which is where the face
// stack was moved to on 2026-08-02 — straight underneath it. Its height is not a
// constant: the secondary row wraps, and below 769px the whole bar drops out of
// the overlay into normal flow. Measured rather than guessed, same as the legend
// above; the var is 0 when the bar is not overlaying, so the stack sits at the
// top on phones where nothing is in its way.
let _mapCtrlRO = null;
function _watchMapControlsHeight() {
  const ctrl = document.getElementById('mapControls');
  const wrap = ctrl?.closest('.map-wrapper');
  if (!ctrl || !wrap || _mapCtrlRO) return;
  const apply = () => {
    const overlaying = getComputedStyle(ctrl).position === 'absolute';
    wrap.style.setProperty('--map-ctrl-h',
      overlaying ? `${Math.ceil(ctrl.getBoundingClientRect().height)}px` : '0px');
  };
  _mapCtrlRO = new ResizeObserver(apply);
  _mapCtrlRO.observe(ctrl);
  // position flips at the 768px breakpoint, which resizing the bar alone does
  // not always report — watch the wrapper too.
  _mapCtrlRO.observe(wrap);
  apply();
}

function renderMapLegend() {
  _watchMapLegendHeight();
  _watchMapControlsHeight();
  _bindMapLprPause();
  const el = document.getElementById('mapLegendPanel');
  if (!el) return;
  const grpBar = document.getElementById('grpBarMap');
  if (grpBar) grpBar.style.display = groups.length > 0 ? 'none' : '';

  // Site-scope the legend the same way refreshMap() scopes the markers — a
  // group with zero cameras in the currently selected site has nothing to
  // show here either. Display-only, like the search filter below: never
  // touches hiddenGroupIds, so a group hidden on "All" stays hidden when
  // the user switches site and back.
  const siteCamIds = _mapActiveSiteId
    ? new Set(cameras.filter(c => c.site_id === _mapActiveSiteId).map(c => c.camera_id))
    : null;
  const inSite = g => !siteCamIds || (g.cameraIds || []).some(id => siteCamIds.has(id));
  const siteGroups = groups.filter(inSite);

  const N = siteGroups.length;

  // Ungrouped = cameras with coords not in any group, scoped to the active site.
  const groupedCamIds = new Set(groups.flatMap(g => g.cameraIds || []));
  const ungroupedCount = cameras.filter(c => c.latitude && c.longitude && !groupedCamIds.has(c.camera_id)
    && (!_mapActiveSiteId || c.site_id === _mapActiveSiteId)).length;

  if (N === 0 && ungroupedCount === 0) { el.innerHTML = ''; return; }

  // Nothing to choose between: with no groups defined the panel showed a single
  // greyed, unclickable "ไม่มีกลุ่ม (80)" chip and took a corner of the map to
  // say it. A legend is for telling colours apart; one entry is not a legend.
  // Reappears the moment a group exists, and the ungrouped chip comes back with
  // it because then it does distinguish something.
  if (N === 0) { el.innerHTML = ''; return; }

  // Mode threshold: measure on total N, NOT on search-filtered count
  const mode = N < 6 ? 'compact' : N <= 20 ? 'scroll' : 'drawer';

  const q = (el.dataset.legendQ || '').toLowerCase();
  const collapsed = el.dataset.legendCollapsed === '1';
  const allHidden = N > 0 && siteGroups.every(g => hiddenGroupIds.has(g.id));

  // Search filters chip display only — does NOT affect hiddenGroupIds or refreshMap()
  const visGroups = q ? siteGroups.filter(g => g.name.toLowerCase().includes(q)) : siteGroups;

  const chipsHtml = visGroups.map(g => {
    const hidden = hiddenGroupIds.has(g.id);
    const swatch = g.color || '#94a3b8';
    return `<label class="ml-chip${hidden ? ' ml-chip-off' : ''}">
      <input type="checkbox" ${hidden ? '' : 'checked'} data-change="toggleMapGroup" data-gid="${g.id}">
      <span class="ml-swatch" style="background:${swatch}"></span>
      <span class="ml-name">${escapeHtml(g.name)}</span>
    </label>`;
  }).join('');

  const ungroupedChip = ungroupedCount > 0
    ? `<div class="ml-chip ml-chip-ungroup">
        <span class="ml-swatch" style="background:#94a3b8"></span>
        <span class="ml-name">${I18N.t('map.ungrouped')} (${ungroupedCount})</span>
       </div>`
    : '';

  if (mode === 'drawer') {
    // Panel = trigger button only; chips live inside drawer
    el.innerHTML = `<button class="map-legend-drawer-btn" data-action="toggleMapDrawer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      ${I18N.t('map.legendGroups')} (${N})
    </button>`;
    const drawer = document.getElementById('mapLegendDrawer');
    if (drawer) {
      drawer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="ml-title">${I18N.t('map.legendGroups')}</div>
          <button data-action="toggleMapDrawer" style="background:none;border:none;cursor:pointer;color:var(--text-primary);font-size:14px;">&#x2715;</button>
        </div>
        <input class="ml-search" type="search" placeholder="${I18N.t('map.legendSearch')}" value="${escapeHtml(q)}" data-input="legendSearch">
        <div class="ml-controls">
          <button class="ml-hide-all-btn" data-action="${allHidden ? 'legendShowAll' : 'legendHideAll'}">${I18N.t(allHidden ? 'map.legendShowAll' : 'map.legendHideAll')}</button>
        </div>
        <div class="ml-chips-wrap scrollable">${chipsHtml}${ungroupedChip}</div>`;
    }
    return;
  }

  // Overlay modes (compact / scroll)
  const showControls = mode === 'scroll';
  el.innerHTML = `
    <div class="ml-title" style="display:flex;align-items:center;justify-content:space-between;">
      <span>Groups</span>
      ${showControls ? `<button class="ml-collapse-btn" data-action="legendCollapse">${I18N.t(collapsed ? 'map.legendExpand' : 'map.legendCollapse')}</button>` : ''}
    </div>
    ${showControls ? `<input class="ml-search" type="search" placeholder="${I18N.t('map.legendSearch')}" value="${escapeHtml(q)}" data-input="legendSearch">` : ''}
    ${showControls ? `<div class="ml-controls">
      <button class="ml-hide-all-btn" data-action="${allHidden ? 'legendShowAll' : 'legendHideAll'}">${I18N.t(allHidden ? 'map.legendShowAll' : 'map.legendHideAll')}</button>
    </div>` : ''}
    <div class="ml-chips-wrap${mode === 'scroll' ? ' scrollable' : ''}${collapsed ? ' collapsed' : ''}">
      ${chipsHtml}${ungroupedChip}
    </div>`;
}

function toggleMapGroup(gid) {
  if (hiddenGroupIds.has(gid)) hiddenGroupIds.delete(gid);
  else hiddenGroupIds.add(gid);
  renderMapLegend();
  refreshMap();
}

function _legendSearch(q) {
  const el = document.getElementById('mapLegendPanel');
  if (el) { el.dataset.legendQ = q; renderMapLegend(); }
  // NO refreshMap() — search is legend-UI-only, does not affect map markers
}

function _legendHideAll() {
  groups.forEach(g => hiddenGroupIds.add(g.id));
  renderMapLegend();
  refreshMap();
}

function _legendShowAll() {
  hiddenGroupIds.clear();
  renderMapLegend();
  refreshMap();
}

function _legendCollapse() {
  const el = document.getElementById('mapLegendPanel');
  if (!el) return;
  el.dataset.legendCollapsed = el.dataset.legendCollapsed === '1' ? '0' : '1';
  renderMapLegend();
}

function toggleMapDrawer() {
  const drawer = document.getElementById('mapLegendDrawer');
  if (!drawer) return;
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open');
  // Re-render drawer content when opening (picks up latest hiddenGroupIds state)
  if (opening) renderMapLegend();
}

// ── Live Pulse (T2) ──────────────────────────────────────────────────────────

function toggleMapPulse() {
  _mapPulseOn = !_mapPulseOn;
  localStorage.setItem('mapLivePulseOn', JSON.stringify(_mapPulseOn));
  const btn = document.getElementById('btnMapPulse');
  if (btn) { btn.setAttribute('aria-pressed', String(_mapPulseOn)); btn.classList.toggle('active', _mapPulseOn); }
  if (!_mapPulseOn) _clearAllMapPulseCards();  _syncMapMuteBtn();
}

// ── Mute all live cards (B1) ─────────────────────────────────────
// LIVE, FACE and LPR each have their own button, and the common wish is not to
// tune one of them but to make the map hold still — three clicks to read a map,
// three more to get the feed back. This does it in one, and restores exactly
// what was on rather than turning everything on, so a deliberately-off overlay
// stays off.
function _mapAnyLiveOn() { return _mapPulseOn || _mapFaceOn || _mapLprOn; }

function _syncMapMuteBtn() {
  const btn = document.getElementById('btnMapMute');
  if (!btn) return;
  const muted = !_mapAnyLiveOn();
  btn.classList.toggle('active', muted);
  btn.setAttribute('aria-pressed', String(muted));
  const lbl = btn.querySelector('.mtbtn-label');
  if (lbl) lbl.textContent = muted ? I18N.t('map.unmute', 'เปิดการ์ด') : I18N.t('map.mute', 'หยุดการ์ด');
}

function toggleMapMuteAll() {
  if (_mapAnyLiveOn()) {
    localStorage.setItem('mapLiveMutedPrev', JSON.stringify(
      { pulse: _mapPulseOn, face: _mapFaceOn, lpr: _mapLprOn }));
    if (_mapPulseOn) toggleMapPulse();
    if (_mapFaceOn)  toggleMapFaceOverlay();
    if (_mapLprOn)   toggleMapLprOverlay();
  } else {
    let prev = { pulse: true, face: true, lpr: true };
    try { prev = JSON.parse(localStorage.getItem('mapLiveMutedPrev')) || prev; } catch { /* default */ }
    // All three off before muting means there is nothing to restore — fall back
    // to turning everything on, or the button would do nothing visible.
    if (!prev.pulse && !prev.face && !prev.lpr) prev = { pulse: true, face: true, lpr: true };
    if (prev.pulse && !_mapPulseOn) toggleMapPulse();
    if (prev.face  && !_mapFaceOn)  toggleMapFaceOverlay();
    if (prev.lpr   && !_mapLprOn)   toggleMapLprOverlay();
  }
  _syncMapMuteBtn();
}

function setMapPulseDebounce(ms) {
  _mapPulseDebounceMs = parseInt(ms, 10);
  localStorage.setItem('mapLivePulseDebounceMs', String(_mapPulseDebounceMs));
}

// ── F: jump to a camera by name ──────────────────────────────────
// 80 cameras on one map, most of them clustered in the same few streets. FIT
// shows all of them and the clusters collapse the rest, so finding one by eye
// means zooming around until it appears. Typing its name is the shortest path,
// and the data is already in memory — no endpoint, no index.
const _MAP_SEARCH_MAX = 8;
let _mapSearchHits = [];

function _mapSearchMatches(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return cameras
    // A camera with no coordinates cannot be jumped to; offering it would give
    // a result that does nothing when clicked.
    .filter(c => c.latitude && c.longitude)
    .filter(c => !_mapActiveSiteId || c.site_id === _mapActiveSiteId)
    .filter(c => (c.camera_name || '').toLowerCase().includes(needle)
              || (c.camera_id   || '').toLowerCase().includes(needle)
              || (c.location    || '').toLowerCase().includes(needle))
    .slice(0, _MAP_SEARCH_MAX);
}

function mapSearchInput(el) {
  const box = document.getElementById('mapCamSearchResults');
  if (!box) return;
  _mapSearchHits = _mapSearchMatches(el.value);
  if (!_mapSearchHits.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = _mapSearchHits.map((c, i) => `
    <button class="mcs-hit" data-action="mapSearchGo" data-idx="${i}">
      <span class="mcs-name">${escapeHtml(c.camera_name || c.camera_id)}</span>
      ${c.location ? `<span class="mcs-loc">${escapeHtml(c.location)}</span>` : ''}
    </button>`).join('');
  box.classList.remove('hidden');
}

function mapSearchGo(el) {
  const cam = _mapSearchHits[parseInt(el.dataset.idx, 10)];
  if (!cam || !map) return;
  _mapSearchClose();
  const coord = ol.proj.fromLonLat([Number(cam.longitude), Number(cam.latitude)]);
  map.getView().animate({ center: coord, zoom: 18, duration: 500 }, () => {
    // Open the popup only after the camera is on screen: showCamPopup positions
    // itself from a pixel, and a pixel taken mid-flight lands where the camera
    // used to be. The feature is looked up after the move for the same reason —
    // clustering regroups as the zoom changes.
    let feat = null;
    mapLayers._camRawSrc?.forEachFeature(f => { if (f.get('camera_id') === cam.camera_id) feat = f; });
    if (!feat) return;
    const pixel = map.getPixelFromCoordinate(feat.getGeometry().getCoordinates());
    if (pixel) showCamPopup(feat, pixel);
  });
}

function _mapSearchClose() {
  const box = document.getElementById('mapCamSearchResults');
  const inp = document.getElementById('mapCamSearch');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  if (inp) inp.value = '';
  _mapSearchHits = [];
}

function recenterMap() {
  if (!map || !mapLayers._camRawSrc) return;
  const ext = mapLayers._camRawSrc.getExtent();
  if (ext[0] === Infinity) return;
  map.getView().fit(ext, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 400 });
}

function toggleMapSecondary() {
  const sec = document.getElementById('mapSecondary');
  const btn = document.getElementById('btnMapMore');
  if (!sec) return;
  const open = sec.classList.toggle('open');
  if (btn) {
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  }
}

function toggleWallMode() {
  _mapWallOn = !_mapWallOn;
  localStorage.setItem('mapWallMode', JSON.stringify(_mapWallOn));
  document.body.classList.toggle('map-wall-mode', _mapWallOn);
  document.getElementById('btnWallMode')?.classList.toggle('active', _mapWallOn);
  if (_mapWallOn) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  setTimeout(() => map && map.updateSize(), 50);
}

function _positionPulseCard(el, pixel, wrapper) {
  const mapH = document.getElementById('map')?.offsetHeight || 400;
  const wW = wrapper.offsetWidth || 400;
  const cW = el.offsetWidth || 180;
  const cH = el.offsetHeight || 80;
  const markerR = 9;
  const flipDown = pixel[1] < mapH * 0.2;
  el.style.left = `${Math.max(4, Math.min(pixel[0] - cW / 2, wW - cW - 4))}px`;
  el.style.top  = flipDown ? `${pixel[1] + markerR + 5}px` : `${pixel[1] - cH - markerR - 5}px`;
}

function _removeMapPulseCard(cid) {
  const s = _mapPulseState.get(cid);
  if (!s) return;
  clearTimeout(s.fadeId);
  clearTimeout(s.expireId);
  s.el.remove();
  _mapPulseState.delete(cid);
}

function _clearAllMapPulseCards() {
  for (const cid of [..._mapPulseState.keys()]) _removeMapPulseCard(cid);
}

// ── Map Face Overlay ────────────────────────────────────────────

// Per-camera state for face cards, keyed the same way the pulse cards are:
// { el, lastAt, bumpCount, timeoutId }. Face cards used to have no rate control
// at all — no per-camera debounce and no global throttle — while the plate list
// beside them had both. Measured 2026-08-02: 817 captures in ten minutes, so a
// stack of four with an 8s life turned over completely every three seconds and
// could not be read. The debounce select in the toolbar now drives this too,
// which is what most people assumed it already did.
const _mapFaceState = new Map();

function _handleMapFaceCard(event) {
  if (!_mapFaceOn || !map || event?.lite) return;   // P5: lite carries no face snapshot/attrs
  if (!document.getElementById('page-map')?.classList.contains('active')) return;

  const cid = event.camera_id;

  // Same camera again inside the debounce window: count it on the card that is
  // already there rather than pushing a new one in and shoving the rest along.
  const nowMs = Date.now();
  const prev = _mapFaceState.get(cid);
  if (prev && (nowMs - prev.lastAt) < _mapPulseDebounceMs && prev.el.isConnected) {
    prev.bumpCount += 1;
    prev.lastAt = nowMs;
    clearTimeout(prev.timeoutId);
    const b = prev.el.querySelector('.mfc-bump');
    if (b) { b.style.display = ''; b.textContent = `+${prev.bumpCount}`; }
    prev.timeoutId = setTimeout(() => _retireMapFaceCard(cid), _mapPulseDebounceMs);
    return;
  }
  let feat = null;
  mapLayers._camRawSrc?.forEachFeature(f => { if (f.get('camera_id') === cid) feat = f; });
  if (!feat) return;

  // Strict viewport check — pixel must land within map element bounds.
  const pixel = map.getPixelFromCoordinate(feat.getGeometry().getCoordinates());
  if (!pixel) return;
  const mapEl = document.getElementById('map');
  if (!mapEl || pixel[0] < 0 || pixel[1] < 0 || pixel[0] > mapEl.offsetWidth || pixel[1] > mapEl.offsetHeight) return;

  // Evict oldest card if at capacity.
  if (_mapFaceCardList.length >= 4) {
    const oldest = _mapFaceCardList.shift();
    // Retire through the map as well — dropping only the DOM node would leave a
    // state entry whose debounce still swallows that camera's next events.
    if (oldest) { clearTimeout(oldest.timeoutId); oldest.el.remove(); _mapFaceState.delete(oldest.camera_id); }
  }

  const cam = cameras.find(c => c.camera_id === cid);
  const camName = escapeHtml(cam?.camera_name || cid);
  const rj = event.raw_json || {};
  const snapFile = rj._snapshot;
  const snapUrl = snapFile ? `${API}/snapshots/${encodeURIComponent(snapFile)}?w=${SNAP_W.pin}` : null;
  const genderTxt = faceGenderLabel(rj.gender);
  const ageTxt = faceAgeBucket(rj.age);
  const attr = [genderTxt, ageTxt].filter(Boolean).join(' · ');

  const thumb = snapUrl
    ? `<img class="mfc-crop" src="${snapUrl}" alt="" data-err="hide">`
    : `<div class="mfc-no-crop"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`;

  const el = document.createElement('div');
  el.className = 'map-face-card';
  el.innerHTML = `${thumb}<div class="mfc-body"><div class="mfc-name">${camName}</div>${attr ? `<div class="mfc-attr">${escapeHtml(attr)}</div>` : ''}<div class="mfc-bump" style="display:none"></div></div>`;
  el.addEventListener('click', () => { _faceJumpCamera = cid; showPage('face-matches', document.querySelector('.nav-item[data-page="face-matches"]')); if (typeof _switchFaceTab === 'function') _switchFaceTab('allFaces'); });

  const stack = document.getElementById('mapFaceStack');
  if (!stack) return;
  stack.insertBefore(el, stack.firstChild); // newest at top

  const entry = { el, camera_id: cid, timeoutId: null };
  // Life is the debounce window, not a separate 8s: a card that vanished while
  // its own camera was still inside the window would let the next event build a
  // fresh card, which is the churn this was meant to stop.
  entry.timeoutId = setTimeout(() => _retireMapFaceCard(cid), _mapPulseDebounceMs);
  _mapFaceCardList.push(entry);
  _mapFaceState.set(cid, { el, lastAt: nowMs, bumpCount: 0, timeoutId: entry.timeoutId, entry });
}

function _retireMapFaceCard(cid) {
  const st = _mapFaceState.get(cid);
  if (!st) return;
  clearTimeout(st.timeoutId);
  st.el.remove();
  const idx = _mapFaceCardList.indexOf(st.entry);
  if (idx !== -1) _mapFaceCardList.splice(idx, 1);
  _mapFaceState.delete(cid);
}

function _clearAllMapFaceCards() {
  for (const c of _mapFaceCardList) { clearTimeout(c.timeoutId); c.el.remove(); }
  _mapFaceCardList.length = 0;
  _mapFaceState.clear();
}

function toggleMapFaceOverlay() {
  _mapFaceOn = !_mapFaceOn;
  localStorage.setItem('mapFaceOverlayOn', JSON.stringify(_mapFaceOn));
  const btn = document.getElementById('btnMapFace');
  if (btn) { btn.setAttribute('aria-pressed', String(_mapFaceOn)); btn.classList.toggle('active', _mapFaceOn); }
  if (!_mapFaceOn) _clearAllMapFaceCards();  _syncMapMuteBtn();
}

// DLT province code → Thai name (mirror of src/helpers/dltProvince.js — the live
// WS event carries only raw_json's short code, not the parsed region name).
const _DLT_PROVINCE = { ACR:'อำนาจเจริญ',BTG:'เบตง',ATG:'อ่างทอง',AYA:'พระนครศรีอยุธยา',BKK:'กรุงเทพมหานคร',BKN:'บึงกาฬ',BRM:'บุรีรัมย์',CBI:'ชลบุรี',CCO:'ฉะเชิงเทรา',CMI:'เชียงใหม่',CNT:'ชัยนาท',CPM:'ชัยภูมิ',CPN:'ชุมพร',CRI:'เชียงราย',CTI:'จันทบุรี',KBI:'กระบี่',KKN:'ขอนแก่น',KPT:'กำแพงเพชร',KRI:'กาญจนบุรี',KSN:'กาฬสินธุ์',LEI:'เลย',LPG:'ลำปาง',LPN:'ลำพูน',LRI:'ลพบุรี',MDH:'มุกดาหาร',MKM:'มหาสารคาม',MSN:'แม่ฮ่องสอน',NAN:'น่าน',NBI:'นนทบุรี',NBP:'หนองบัวลำภู',NKI:'หนองคาย',NMA:'นครราชสีมา',NPM:'นครพนม',NPT:'นครปฐม',NRT:'นครศรีธรรมราช',NSN:'นครสวรรค์',NWT:'นราธิวาส',NYK:'นครนายก',PBI:'เพชรบุรี',PCT:'พิจิตร',PKN:'ประจวบคีรีขันธ์',PKT:'ภูเก็ต',PLG:'พัทลุง',PLK:'พิษณุโลก',PNA:'พังงา',PNB:'เพชรบูรณ์',PRE:'แพร่',PRI:'ปราจีนบุรี',PTE:'ปทุมธานี',PTN:'ปัตตานี',PYO:'พะเยา',RBR:'ราชบุรี',RET:'ร้อยเอ็ด',RNG:'ระนอง',RYG:'ระยอง',SBR:'สิงห์บุรี',SKA:'สงขลา',SKM:'สมุทรสงคราม',SKN:'สมุทรสาคร',SKW:'สระแก้ว',SNI:'สุราษฎร์ธานี',SNK:'สกลนคร',SPB:'สุพรรณบุรี',SPK:'สมุทรปราการ',SRI:'สระบุรี',SRN:'สุรินทร์',SSK:'ศรีสะเกษ',STI:'สุโขทัย',STN:'สตูล',TAK:'ตาก',TRG:'ตรัง',TRT:'ตราด',UBN:'อุบลราชธานี',UDN:'อุดรธานี',UTI:'อุทัยธานี',UTT:'อุตรดิตถ์',YLA:'ยะลา',YST:'ยโสธร' };
function _dltProvince(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return null;
  if (c === 'UNKN' || c === '0') return I18N.t('lpr.unknown', 'ไม่ทราบ');
  const th = _DLT_PROVINCE[c];
  return th ? provinceLabel(th) : null;
}

// Plate colour → registration type code (mirror of src/helpers/plateType.js).
// Returns a stable code — never a translated string — so callers can compare
// it (e.g. "hide the common default") without breaking under English UI.
const _PLATE_TYPE_LABEL = {
  private: 'รถส่วนบุคคล', publicHire: 'รถสาธารณะ/รับจ้าง', redPlate: 'ป้ายแดง',
  rental: 'รถบริการให้เช่า', diplomat: 'ทางการทูต/องค์กรระหว่างประเทศ', foreignGov: 'ป้ายต่างประเทศ/รถราชการ',
};
function _plateType(rgba) {
  if (!Array.isArray(rgba) || rgba.length < 3) return null;
  const r = +rgba[0], g = +rgba[1], b = +rgba[2];
  if (![r, g, b].every(Number.isFinite)) return null;
  const hi = (v) => v >= 170, lo = (v) => v <= 90;
  if (hi(r) && hi(g) && hi(b)) return 'private';
  if (hi(r) && hi(g) && lo(b)) return 'publicHire';
  if (hi(r) && lo(g) && lo(b)) return 'redPlate';
  if (lo(r) && hi(g) && lo(b)) return 'rental';
  if (lo(r) && lo(g) && hi(b)) return 'diplomat';
  if (lo(r) && lo(g) && lo(b)) return 'foreignGov';
  return null;
}
function _plateTypeLabel(code) { return code ? I18N.t('map.ptype.' + code, _PLATE_TYPE_LABEL[code]) : ''; }

// ── Map LPR Plate-Read List (left) ──────────────────────────────
// Plain plate reads no longer pulse at the camera point (that flooded the map);
// they drop as plaques into a left-hand list — plate + province + colour swatch
// + camera/time. Watch-list ALERTS still pulse at the camera (routed separately).
// Mirrors the face overlay: capped, newest on top, auto-expire.
// MEASURED 2026-07-26: plates arrive at 5.6/s across the ANPR fleet (7.7/s at
// peak). With a 6-card list that gave each card 1.1 SECONDS on screen before the
// next read pushed it out — the 8s expiry never even fired. Slowing the
// animation cannot fix that; the list has to accept fewer cards.
//
// One card per SHOW_EVERY_MS turns 5.6/s into ~0.8/s, so a card survives the
// full list depth (~7s) and is actually readable. Nothing is lost: this widget
// is an ambient "plates are flowing" indicator — the LPR page is where reads are
// searched. Skipped reads are counted and shown, so the sampling is never silent.
const _MLP_SHOW_EVERY_MS = 1200;
const _MLP_MAX_CARDS = 6;
const _MLP_DWELL_MS = 12000;   // > list depth, so eviction (not the timer) is the
                               // exception rather than the rule
let _mlpLastShownAt = 0;
let _mlpSkipped = 0;
let _mlpPaused = false;

function _handleMapLprCard(event) {
  if (!_mapLprOn || !map || event?.lite) return;   // P5: lite carries no plate/vehicle detail
  if (!document.getElementById('page-map')?.classList.contains('active')) return;
  const stack = document.getElementById('mapLprStack');
  if (!stack) return;

  // Reading is impossible while the list keeps moving. Hovering freezes it —
  // reads still arrive, they just queue as a count instead of shoving the card
  // out from under the pointer.
  if (_mlpPaused) { _mlpSkipped++; _mlpUpdateSkipBadge(); return; }
  const now = Date.now();
  if (now - _mlpLastShownAt < _MLP_SHOW_EVERY_MS) { _mlpSkipped++; _mlpUpdateSkipBadge(); return; }
  _mlpLastShownAt = now;

  const cid = event.camera_id;
  const cam = cameras.find(c => c.camera_id === cid);
  const camName = escapeHtml(cam?.camera_name || cid);
  const rj = event.raw_json || {};
  const obj = rj.data?.Object || {};
  // Read the normalised top-level fields first. `data.Object` is Dahua's own
  // TrafficJunction envelope and Hikvision events simply do not have it — every
  // Phuket camera showed "—" because of that, 65.6% of plates in a two-hour
  // sample (measured 2026-08-02: data.Object.Text present on 16,266 of 47,271
  // events, raw_json.plate on 46,192). Both ingesters already write `plate` and
  // `region` at the top level, so that is the field to trust; the envelope stays
  // as the fallback rather than being removed, since older rows only have it.
  const plate = escapeHtml(rj.plate || obj.Text || '—');
  // region is already a Thai province name from both ingesters ("ภูเก็ต",
  // "กระบี่"). The DLT lookup is only needed for Dahua's raw code ("KBI").
  const prov = escapeHtml(rj.region || _dltProvince(obj.Province) || obj.Province || '');
  // Vehicle colour = Vehicle.MainColor (obj is the Plate, so obj.MainColor is the
  // plate colour, not the car's). Plate type comes from the plate colour instead.
  // Both are Dahua RGB triples; Hikvision reports colour as a word
  // (vehicleColor:"black", plateColor:"white") and gets no swatch — a named
  // colour cannot be rendered as the exact shade the swatch promises.
  const vmc = rj.data?.Vehicle?.MainColor;
  const swatch = (Array.isArray(vmc) && vmc.length >= 3) ? `<span class="mlp-color" style="background:rgb(${vmc[0] | 0},${vmc[1] | 0},${vmc[2] | 0})" title="${escapeHtml(I18N.t('lpr.vehicleColor','สีรถ'))}"></span>` : '';
  const ptype = _plateType(obj.MainColor);
  const pmc = Array.isArray(obj.MainColor) ? obj.MainColor : [];
  const pchip = (ptype && ptype !== 'private')   // hide the common default, flag the notable ones
    ? `<div class="mlp-ptype" style="border-left:3px solid rgb(${(pmc[0] | 0)},${(pmc[1] | 0)},${(pmc[2] | 0)})">${escapeHtml(_plateTypeLabel(ptype))}</div>` : '';
  const tt = event.event_time ? new Date(event.event_time).toLocaleTimeString('th-TH', { hour12: false }) : '';

  if (_mapLprCardList.length >= _MLP_MAX_CARDS) {
    const oldest = _mapLprCardList.shift();
    if (oldest) { clearTimeout(oldest.timeoutId); _retireMapLprCard(oldest.slot); }
  }

  // The card sits inside a slot the CSS can collapse. Animating the slot's row
  // instead of the card means the cards below move with it, rather than
  // snapping to their new position the moment this one is inserted.
  const slot = document.createElement('div');
  slot.className = 'mlp-slot';
  const el = document.createElement('div');
  el.className = 'map-lpr-plaque';
  // Left edge carries the plate-type colour when the source reported one — the
  // one glanceable signal on a card this small.
  if (pmc.length >= 3) el.style.setProperty('--mlp-accent', `rgb(${pmc[0] | 0},${pmc[1] | 0},${pmc[2] | 0})`);
  el.innerHTML =
    `<div class="mlp-top"><span class="mlp-plate">${plate}</span>${prov ? `<span class="mlp-prov">${prov}</span>` : ''}</div>` +
    `<div class="mlp-meta">${swatch}<span class="mlp-cam">${camName}</span>${tt ? `<span class="mlp-time">${tt}</span>` : ''}</div>` +
    pchip;
  el.addEventListener('click', () => _openMapLprDetail(event.id, el));
  slot.appendChild(el);
  // The skip badge is the stack's first child and must stay pinned at the top,
  // so new cards go after it rather than at index 0.
  const badge = document.getElementById('mlpSkipBadge');
  stack.insertBefore(slot, badge ? badge.nextSibling : stack.firstChild);

  // Next frame, not this one: the browser has to see the collapsed state first
  // or there is nothing to transition FROM and the card simply appears.
  requestAnimationFrame(() => requestAnimationFrame(() => slot.classList.add('in')));

  const entry = { slot, timeoutId: null };
  entry.timeoutId = setTimeout(() => {
    _retireMapLprCard(slot);
    const i = _mapLprCardList.indexOf(entry);
    if (i !== -1) _mapLprCardList.splice(i, 1);
  }, _MLP_DWELL_MS);
  _mapLprCardList.push(entry);
  _mlpSkipped = 0;
  _mlpUpdateSkipBadge();
}

// Open the same detail modal the LPR page uses, rather than navigating away and
// making the operator find the read again. The card only carries the WS event
// row, so fetch the enriched one (plate crop, scene, colour, brand) by event id
// — reusing /api/lpr keeps one source of truth for what a read looks like.
// Falls back to the LPR page if the row cannot be fetched: leaving the operator
// on a dead click is worse than a page change they did not ask for.
async function _openMapLprDetail(eventId, cardEl) {
  if (!eventId || typeof _lprOpenModal !== 'function') {
    showPage('lpr', document.querySelector('.nav-item[data-page="lpr"]'));
    return;
  }
  if (cardEl?.dataset.loading) return;      // double-click guard
  if (cardEl) cardEl.dataset.loading = '1';
  cardEl?.classList.add('mlp-loading');
  try {
    const r = await fetch(`${API}/api/lpr?event_id=${encodeURIComponent(eventId)}&limit=1`, { credentials: 'include' });
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : (j.rows || [])[0];
    if (!row) throw new Error('row not found');
    _lprOpenModal(row);
  } catch {
    showPage('lpr', document.querySelector('.nav-item[data-page="lpr"]'));
  } finally {
    cardEl?.classList.remove('mlp-loading');
    if (cardEl) delete cardEl.dataset.loading;
  }
}

// "+N" — how many reads happened between the two cards on screen. Without it the
// list looks like the only traffic there was, which at 5.6/s is badly wrong.
function _mlpUpdateSkipBadge() {
  const el = document.getElementById('mlpSkipBadge');
  if (!el) return;
  el.textContent = _mlpSkipped > 0 ? `+${_mlpSkipped}` : '';
  el.classList.toggle('on', _mlpSkipped > 0);
  el.classList.toggle('paused', _mlpPaused);
}

function _bindMapLprPause() {
  const stack = document.getElementById('mapLprStack');
  if (!stack || stack.dataset.pauseBound) return;
  stack.dataset.pauseBound = '1';
  const set = (v) => { _mlpPaused = v; _mlpUpdateSkipBadge(); };
  stack.addEventListener('mouseenter', () => set(true));
  stack.addEventListener('mouseleave', () => set(false));
  // Touch has no hover: tapping the list body (not a card) toggles the freeze.
  stack.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.map-lpr-plaque')) set(!_mlpPaused);
  }, { passive: true });
}

// Collapse, then remove. Removing outright made the remaining cards jump up.
// transitionend is not guaranteed (a hidden tab never fires it), so a timer
// backstops the removal — a card that never leaves the DOM is a slow leak.
function _retireMapLprCard(slot) {
  if (!slot || slot.dataset.leaving) return;
  slot.dataset.leaving = '1';
  slot.classList.remove('in');
  slot.classList.add('out');
  const done = () => slot.remove();
  slot.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 500);
}

function _clearAllMapLprCards() {
  // Toggling the layer off is not an animation moment — drop them immediately.
  for (const c of _mapLprCardList) { clearTimeout(c.timeoutId); c.slot.remove(); }
  _mapLprCardList.length = 0;
  _mlpSkipped = 0; _mlpLastShownAt = 0;
  _mlpUpdateSkipBadge();
}

function toggleMapLprOverlay() {
  _mapLprOn = !_mapLprOn;
  localStorage.setItem('mapLprOverlayOn', JSON.stringify(_mapLprOn));
  const btn = document.getElementById('btnMapLpr');
  if (btn) { btn.setAttribute('aria-pressed', String(_mapLprOn)); btn.classList.toggle('active', _mapLprOn); }
  if (!_mapLprOn) _clearAllMapLprCards();  _syncMapMuteBtn();
  // The plate side-list is the only map consumer of the full LPR row — turning
  // it off drops this tab back to the lite stream.
  if (typeof wsSubscribe === 'function') wsSubscribe();
}

function _handleMapPulse(event) {
  if (!_mapPulseOn || !map) return;
  if (!document.getElementById('page-map')?.classList.contains('active')) return;

  const cid = event.camera_id;
  // Find the OL feature for this camera in the raw (pre-cluster) source.
  let feat = null;
  mapLayers._camRawSrc?.forEachFeature(f => { if (f.get('camera_id') === cid) feat = f; });
  if (!feat) return;

  const pixel = map.getPixelFromCoordinate(feat.getGeometry().getCoordinates());
  if (!pixel) return;

  const now = Date.now();
  const existing = _mapPulseState.get(cid);

  if (existing && (now - existing.lastAt) < _mapPulseDebounceMs) {
    // Bump: reset both timers; revive card if it has already faded from DOM.
    existing.bumpCount += 1;
    existing.lastAt = now;
    clearTimeout(existing.fadeId);
    clearTimeout(existing.expireId);
    const wrapper = document.querySelector('.map-wrapper');
    if (wrapper && !existing.el.isConnected) {
      wrapper.appendChild(existing.el);
      _positionPulseCard(existing.el, pixel, wrapper);
    }
    const bumpEl = existing.el.querySelector('.mpc-bump');
    if (bumpEl) { bumpEl.style.display = ''; bumpEl.textContent = `+${existing.bumpCount} more`; }
    existing.fadeId   = setTimeout(() => existing.el.remove(), 5000);
    existing.expireId = setTimeout(() => _removeMapPulseCard(cid), _mapPulseDebounceMs);
    return;
  }

  // R7 suppress: skip new cards while camera popup is open (deliberate simplification
  // vs spec's per-overlap check — easier and avoids race with 3s popup auto-close).
  const popup = document.getElementById('mapPopup');
  if (popup && !popup.classList.contains('hidden')) return;

  // Evict oldest entry when at capacity.
  if (_mapPulseState.size >= 6) _removeMapPulseCard(_mapPulseState.keys().next().value);

  // Build card.
  const cam = cameras.find(c => c.camera_id === cid);
  const camName = escapeHtml(cam?.camera_name || cam?.camera_id || cid);
  const loc = cam?.location ? ' · ' + escapeHtml(cam.location) : '';
  const rule = event.rule_name ? `<div class="mpc-rule">${escapeHtml(event.rule_name)}</div>` : '';
  const snapFile = event.snapshot_file || event.snapshot_filename;
  const snapUrl = snapFile
    ? `${API}/snapshots/${encodeURIComponent(snapFile)}?w=${SNAP_W.pin}`
    : null;
  const thumb = snapUrl
    ? `<img class="mpc-thumb" src="${snapUrl}" alt="" data-err="hide">`
    : `<div class="mpc-thumb mpc-no-snap"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M2 20c0-3.5 4-6 10-6s10 2.5 10 6"/></svg></div>`;

  const el = document.createElement('div');
  el.className = 'map-pulse-card';
  el.style.cursor = 'pointer';
  el.style.pointerEvents = 'auto';
  el.innerHTML = `${thumb}<div class="mpc-body"><div class="mpc-name">${camName}${loc}</div>${rule}<div class="mpc-bump" style="display:none"></div></div>`;
  el.addEventListener('click', () => showSnapshot(event));

  const wrapper = document.querySelector('.map-wrapper');
  if (!wrapper) return;
  wrapper.appendChild(el);
  _positionPulseCard(el, pixel, wrapper);

  const fadeId   = setTimeout(() => el.remove(), 5000);
  const expireId = setTimeout(() => _removeMapPulseCard(cid), _mapPulseDebounceMs);
  _mapPulseState.set(cid, { el, lastAt: now, bumpCount: 0, fadeId, expireId });
}

async function showCamPopup(feat, pixel) {
  const popup = document.getElementById('mapPopup');
  const cam = feat.get('cam');
  const count = feat.get('eventCount') || 0;
  const camId = cam.camera_id;
  const statusCls = cam.status === 'online' ? 'mp-status-online' : 'mp-status-offline';

  // Show static camera info immediately; rules section filled async below.
  popup.innerHTML = `
    <div class="mp-name" style="display:flex;align-items:center;gap:6px">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;opacity:0.7"><rect x="1" y="8" width="15" height="8" rx="2.5"/><rect x="16" y="10" width="5" height="4" rx="1.5"/><circle cx="21.5" cy="12" r="1.5"/><line x1="7" y1="16" x2="7" y2="22"/><line x1="3" y1="22" x2="11" y2="22"/></svg>
      ${escapeHtml(cam.camera_name || cam.camera_id)}
    </div>
    <div class="mp-row"><span class="mp-label">CAMERA ID</span><span class="mp-val">${escapeHtml(cam.camera_id)}</span></div>
    <div class="mp-row"><span class="mp-label">IP</span><span class="mp-val" style="font-family:monospace">${escapeHtml(cam.ip_address || '—')}</span></div>
    <div class="mp-row"><span class="mp-label">LOCATION</span><span class="mp-val">${escapeHtml(cam.location || '—')}</span></div>
    <div class="mp-row"><span class="mp-label">STATUS</span><span class="mp-val ${statusCls}">${escapeHtml((cam.status || 'unknown').toUpperCase())}</span></div>
    <div class="mp-row"><span class="mp-label">EVENTS 24H</span><span class="mp-val" style="color:var(--accent)">${count} detected</span></div>
    ${count > 0 ? `<div id="mp-rules" style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-hairline);color:var(--text-secondary);font-size:10px">...</div>` : ''}`;

  popup.style.display = 'block';
  popup.classList.remove('hidden');
  const popHeight = popup.offsetHeight;
  popup.style.left = `${Math.max(0, pixel[0] - 130)}px`;
  popup.style.top  = `${Math.max(0, pixel[1] - popHeight - 24)}px`;

  if (count === 0) return;

  // Fetch top rules on-demand — avoids dependency on Events page being visited first
  // (previously used allEvents[] which is empty until loadEvents() runs).
  try {
    const to  = new Date().toISOString();
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await fetch(`${API}/api/events?camera=${encodeURIComponent(camId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=50`);
    if (!res.ok) throw new Error('fetch');
    const events = await res.json();

    const rulesEl = document.getElementById('mp-rules');
    if (!rulesEl || popup.classList.contains('hidden')) return;

    const ruleCount = {};
    events.forEach(e => {
      const k = e.rule_name || e.event_type?.split('/').pop() || 'Unknown';
      ruleCount[k] = (ruleCount[k] || 0) + 1;
    });
    const topRules = Object.entries(ruleCount).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (topRules.length === 0) { rulesEl.remove(); return; }

    const maxRule = Math.max(1, ...topRules.map(r => r[1]));
    rulesEl.innerHTML = topRules.map(([rule, cnt], i) => {
      const color = COLORS[i % COLORS.length];
      return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:3px 0">
        <span style="flex:1;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(rule)}</span>
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${cnt / maxRule * 100}%;background:${color};border-radius:2px"></div>
        </div>
        <span style="color:${color};font-family:monospace;min-width:24px;text-align:right">${cnt}</span>
      </div>`;
    }).join('');
  } catch (_) {
    const rulesEl = document.getElementById('mp-rules');
    if (rulesEl) rulesEl.remove();
  }
}

function hidePopup() {
  const popup = document.getElementById('mapPopup');
  popup.classList.add('hidden');
  popup.style.display = 'none';
}

