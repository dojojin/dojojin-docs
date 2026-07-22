// ============================================================
// Vigil Platform — Media Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// Media Page (Pre-alarm video clips — Phase 6.1.3)
// ============================================================
//
// Reuses the Snapshot page filter pattern but with /api/events?hasClip=true
// + <video controls> for inline playback. Filters: camera, category (Stats v2),
// rule_name, datetime range. Only shows events where the camera had
// enable_clip_capture=true AND the recorder finished writing the clip.
//
let mediaList = [];

async function populateMediaFilters() {
  fillCameraSelect('mediaFilterCam', siteScopedCams(getActiveGroupCameras(), _opActiveSiteId), { allOption: true });

  // Reuse the cached facets/categories from Snapshot page (loaded once per session)
  const [facets, cats] = await Promise.all([_loadSnapFacets(), _loadSnapCategories()]);

  const ruleSel = document.getElementById('mediaFilterType');
  const rules = facets.rule_names || [];
  ruleSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
    (rules.length
      ? rules.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')
      : `<option value="" disabled>${I18N.t('snap.noRules')}</option>`);

  const catSel = document.getElementById('mediaFilterCategory');
  if (catSel) {
    catSel.innerHTML = `<option value="">${I18N.t('common.all')}</option>` +
      (cats || []).map(c => `<option value="${c.id}">${escapeHtml((c.icon || '') + ' ' + c.name).trim()}</option>`).join('');
  }
}

function resetMediaFilters() {
  document.getElementById('mediaFilterCam').value = '';
  document.getElementById('mediaFilterType').value = '';
  const catSel = document.getElementById('mediaFilterCategory');
  if (catSel) catSel.value = '';
  clearDtValue('mediaFilterFrom');
  clearDtValue('mediaFilterTo');
  loadMedia(1);
}

// Phase 6.1.7 — server-side pagination: 20/page, no hard cap
let _mediaPage = 1;
let _mediaTotal = 0;

async function loadMedia(page = 1) {
  _mediaPage = page;
  const cam = document.getElementById('mediaFilterCam').value;
  const rule = document.getElementById('mediaFilterType').value;
  const catSel = document.getElementById('mediaFilterCategory');
  const categoryId = catSel ? catSel.value : '';
  const from = getDtValue('mediaFilterFrom');
  const to   = getDtValue('mediaFilterTo');
  const toIso = s => s ? new Date(s).toISOString() : '';

  const offset = (_mediaPage - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    hasClip: 'true',
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (cam) params.set('camera', cam);
  if (!cam) {
    const ids = getActiveScopedCameraIds();
    if (ids) params.set('cameras', ids.length ? ids.join(',') : '__none__');
  }
  if (rule) params.set('rule_name', rule);
  if (categoryId) params.set('category_id', categoryId);
  if (from) params.set('from', toIso(from));
  if (to)   params.set('to',   toIso(to));

  const container = document.getElementById('mediaContainer');
  if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading'))}</div>`;
  document.getElementById('mediaCount').textContent = '…';

  try {
    const res = await fetch(`${API}/api/events?${params.toString()}`, { cache: 'no-store' });
    _mediaTotal = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    mediaList = await res.json();
    document.getElementById('mediaCount').textContent = _mediaTotal.toLocaleString();
    renderMedia();
    renderPagination('mediaPagination', _mediaPage, _mediaTotal, PAGE_SIZE,
      (p) => loadMedia(p), 'clip');
  } catch (e) {
    console.error(e);
    if (container) container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--status-bad)">${escapeHtml(I18N.t('common.loadFailedShort'))}</div>`;
    document.getElementById('mediaCount').textContent = '0';
  }
}

function renderMedia() {
  const c = document.getElementById('mediaContainer');
  if (mediaList.length === 0) {
    c.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-secondary)">
      ${I18N.t('media.noMatch')}<br>
      <span style="font-size:11px">${I18N.t('media.emptyHint')}</span>
    </div>`;
    return;
  }

  c.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${mediaList.map((ev, idx) => {
    const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
    const dur = ev.clip_duration_sec ? `${parseFloat(ev.clip_duration_sec).toFixed(1)}s` : '—';
    return `
      <div class="media-card" style="background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:8px;overflow:hidden;cursor:pointer" data-action="showMediaClip" data-source="media" data-idx="${idx}">
        <div style="position:relative;background:#000;aspect-ratio:16/9">
          <video src="${API}/media/${ev.clip_file}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:contain"></video>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25);pointer-events:none">
            <div style="background:rgba(0,0,0,0.7);color:#fff;border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:18px">▶</div>
          </div>
          <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;font-family:monospace">${dur}</div>
        </div>
        <div style="padding:10px">
          <div style="font-weight:600;font-size:12px">${escapeHtml(ev.rule_name || eventDisplayName(ev))}</div>
          <div style="color:var(--text-secondary);font-size:10px;margin-top:3px">${escapeHtml(ev.camera_id)} · ${escapeHtml(ev.object_class || '—')}</div>
          <div style="color:var(--muted);font-size:10px;margin-top:2px">${time}</div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

function showMediaClip(ev) {
  window._currentMediaEv = ev;
  const modal = document.getElementById('mediaModal');
  const time = new Date(ev.event_time).toLocaleString('th-TH', {hour12:false});
  document.getElementById('mediaModalTitle').textContent = `${ev.rule_name || eventDisplayName(ev)} — ${ev.camera_id}`;
  const dur = ev.clip_duration_sec ? `${parseFloat(ev.clip_duration_sec).toFixed(1)}s` : '—';
  const fields = [
    [I18N.t('evt.colTime'), time],
    [I18N.t('common.camera'), ev.camera_id],
    ['Rule', ev.rule_name || '—'],
    ['Object', ev.object_class || '—'],
    ['Confidence', ev.likelihood ? `${(ev.likelihood*100).toFixed(1)}%` : '—'],
    ['Duration', dur],
  ];
  document.getElementById('mediaModalBody').innerHTML = `
    <video src="${API}/media/${ev.clip_file}" controls autoplay style="width:100%;max-height:560px;background:#000;border-radius:8px"></video>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px">
      ${fields.map(([k, v]) => `<div><div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase">${k}</div><div style="font-size:13px;margin-top:2px">${escapeHtml(String(v))}</div></div>`).join('')}
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <a href="${API}/media/${ev.clip_file}" download class="btn btn-secondary" style="font-size:11px">⬇ Download MP4</a>
      ${ev.snapshot_file ? `<button class="btn btn-secondary" data-action="showSnapFromMedia" style="font-size:11px">${I18N.t('media.viewSnap')}</button>` : ''}
    </div>`;
  modal.classList.remove('hidden');
}

function closeMediaModal() {
  const modal = document.getElementById('mediaModal');
  // Stop playback when closing — otherwise audio keeps going in background
  const v = modal.querySelector('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  modal.classList.add('hidden');
}
