// ============================================================
// Vigil Platform — Face Gallery
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// Face gallery (MV.3b) — Hikvision Face Capture events
// ============================================================
// Face helpers — i18n-aware labels for age, gender, expression, duration.
// Age → 10-year band (decision: show a band, not the raw estimate —
// face age estimation carries ±5-10y error). 0-12 / 13-19 / decade / 60+.
function faceAgeBucket(age) {
  const a = parseInt(age, 10);
  if (!Number.isFinite(a)) return I18N.t('face.ageUnknown');
  const yr = I18N.t('face.yrs');
  if (a <= 12) return `0-12${yr}`;
  if (a <= 19) return `13-19${yr}`;
  if (a >= 60) return `60+${yr}`;
  const lo = Math.floor(a / 10) * 10;
  return `${lo}-${lo + 9}${yr}`;
}
function faceGenderLabel(g) {
  return g === 'male' ? I18N.t('face.male') : g === 'female' ? I18N.t('face.female') : '—';
}
function faceExprLabel(e) {
  if (!e) return '—';
  return I18N.t('faceExpr.' + e, e);
}
function faceDurationLabel(ms) {
  const s = Math.round((parseInt(ms, 10) || 0) / 1000);
  if (s < 60) return `${s}${I18N.t('face.sec')}`;
  const m = Math.floor(s / 60), rem = s % 60;
  return rem ? `${m}${I18N.t('face.min')} ${rem}${I18N.t('face.sec')}` : `${m}${I18N.t('face.min')}`;
}

let _facesData = [];

// Collect the Face page filter bar into URLSearchParams — shared by
// the gallery query (/api/faces) and the demographic summary
// (/api/faces/summary) so both always see the same filter set.
function _faceFilterParams() {
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const params = new URLSearchParams();
  const gender = val('faceFilterGender');
  const ageRng = val('faceFilterAge');
  const expr   = val('faceFilterExpr');
  const glass  = val('faceFilterGlass');
  const mask   = val('faceFilterMask');
  const hat    = val('faceFilterHat');
  const from   = getDtValue('faceFilterFrom');
  const to     = getDtValue('faceFilterTo');
  if (gender) params.set('gender', gender);
  if (expr)   params.set('expression', expr);
  if (glass)  params.set('glass', glass);
  if (mask)   params.set('mask', mask);
  if (hat)    params.set('hat', hat);
  if (ageRng) {
    const [lo, hi] = ageRng.split('-');
    params.set('age_min', lo);
    params.set('age_max', hi);
  }
  // datetime-local is naive local time → convert to UTC ISO for TIMESTAMPTZ
  if (from) params.set('from', new Date(from).toISOString());
  if (to)   params.set('to',   new Date(to).toISOString());
  return params;
}

async function loadFaces() {
  const params = _faceFilterParams();
  const jumpCam = _faceJumpCamera;
  _faceJumpCamera = null;
  const extra = jumpCam ? `&camera=${encodeURIComponent(jumpCam)}` : '';
  try {
    const res = await fetch(`${API}/api/faces?${params}${extra}`);
    const faces = await res.json();
    _facesData = Array.isArray(faces) ? faces : [];
    const total = res.headers.get('X-Total-Count') || _facesData.length;
    document.getElementById('faceCount').textContent = total;
    renderFaceGrid(_facesData);
  } catch (e) {
    console.error('loadFaces:', e);
  }
  loadFaceSummary();
}

// Demographic summary bar — gender split, age bands, mask count,
// scoped to the active filters.
async function loadFaceSummary() {
  try {
    const res = await fetch(`${API}/api/faces/summary?${_faceFilterParams()}`);
    renderFaceSummary(await res.json());
  } catch (e) {
    console.error('loadFaceSummary:', e);
  }
}

function renderFaceSummary(s) {
  const el = document.getElementById('faceSummary');
  if (!el) return;
  if (!s || !s.total) { el.innerHTML = ''; return; }
  const pct = (n) => s.total ? Math.round((n / s.total) * 100) : 0;
  const stat = (val, lbl) =>
    `<div class="face-stat"><div class="fs-val">${val}</div><div class="fs-lbl">${lbl}</div></div>`;
  el.innerHTML =
    stat(s.total, I18N.t('face.total')) +
    stat(`${s.male} · ${pct(s.male)}%`,     I18N.t('face.male')) +
    stat(`${s.female} · ${pct(s.female)}%`, I18N.t('face.female')) +
    stat(s.age_teen,   I18N.t('face.ageTeen')) +
    stat(s.age_young,  I18N.t('face.ageYoung')) +
    stat(s.age_mid,    I18N.t('face.ageMid')) +
    stat(s.age_senior, I18N.t('face.ageSenior')) +
    stat(`${s.masked} · ${pct(s.masked)}%`, I18N.t('face.masked'));
}

function renderFaceGrid(faces) {
  const grid = document.getElementById('faceGrid');
  if (!grid) return;
  if (!faces.length) {
    grid.innerHTML = `<div class="face-empty">${escapeHtml(I18N.t('face.empty'))}</div>`;
    return;
  }
  const noImg = escapeHtml(I18N.t('face.noImage'));
  grid.innerHTML = faces.map(f => {
    const img = f.snapshot
      ? `<img src="${API}/snapshots/${encodeURIComponent(f.snapshot)}" loading="lazy" decoding="async" alt="" data-err="face-noimg">`
      : `<div class="face-noimg">${noImg}</div>`;
    const t = f.event_time
      ? new Date(f.event_time).toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false })
      : '—';
    const wear = [];
    // กล้องส่ง glass = no / yes / sunglasses — แยก label แว่นกันแดด
    if (f.glass === 'sunglasses') wear.push(I18N.t('face.wearSunglasses'));
    else if (f.glass === 'yes')   wear.push(I18N.t('face.wearGlasses'));
    if (f.mask  === 'yes') wear.push(I18N.t('face.wearMask'));
    if (f.hat   === 'yes') wear.push(I18N.t('face.wearHat'));
    const wearHtml = wear.length
      ? wear.map(w => `<span class="face-chip">${escapeHtml(w)}</span>`).join('')
      : `<span class="face-chip" style="color:var(--text-secondary)">${escapeHtml(I18N.t('face.nothingWorn'))}</span>`;
    return `<div class="face-card" data-action="openFaceModal" data-id="${f.id}">
      ${img}
      <div class="face-card-body">
        <div style="font-size:10px;color:var(--text-secondary);margin-bottom:3px">${t} · ${escapeHtml(f.camera_id || '')}</div>
        <div>
          <span class="face-chip">${escapeHtml(faceGenderLabel(f.gender))}</span>
          <span class="face-chip">${escapeHtml(faceAgeBucket(f.age))}</span>
          <span class="face-chip">${escapeHtml(faceExprLabel(f.expression))}</span>
        </div>
        <div>${wearHtml}</div>
        <div style="font-size:10px;color:var(--text-secondary);margin-top:5px">
          ⏱ ${escapeHtml(faceDurationLabel(f.stay_duration))} · ${escapeHtml(I18N.t('face.quality'))} ${f.face_score || '—'}%
        </div>
      </div>
    </div>`;
  }).join('');
}

function resetFaceFilters() {
  ['faceFilterGender', 'faceFilterAge', 'faceFilterExpr', 'faceFilterGlass',
   'faceFilterMask', 'faceFilterHat']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // from/to are AirDatepicker-enhanced — clearDtValue clears the picker instance.
  clearDtValue('faceFilterFrom');
  clearDtValue('faceFilterTo');
  loadFaces();
}

// Face detail modal (Face Capture) — full-frame scene + face crop + attributes.
// Gallery card click → here.
function openFaceModal(id) {
  // events.id is BIGSERIAL → node-pg returns it as a STRING, but the
  // inline onclick="openFaceModal(24812)" passes a numeric literal —
  // compare as strings so the lookup doesn't silently miss.
  const f = _facesData.find(x => String(x.id) === String(id))
    || (typeof _faceTab2Data !== 'undefined' && _faceTab2Data.find(x => String(x.id) === String(id)))
    || (typeof _faceOvLatestData !== 'undefined' && _faceOvLatestData.find(x => String(x.id) === String(id)));
  if (!f) return;

  const t = f.event_time
    ? new Date(f.event_time).toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'medium' })
    : '—';
  const wear = [];
  if (f.glass === 'sunglasses') wear.push(I18N.t('face.wearSunglasses'));
  else if (f.glass === 'yes')   wear.push(I18N.t('face.wearGlasses'));
  if (f.mask  === 'yes') wear.push(I18N.t('face.wearMask'));
  if (f.hat   === 'yes') wear.push(I18N.t('face.wearHat'));

  // scene (16:9 full frame) + crop (1:1) side by side — demo-parity layout.
  // _faceImgBox handles deleted snapshots: real <img data-err=face-swap> reveals a
  // metadata-reconstructed avatar + recon tag on 404, so no extra deleted-state branch.
  const sceneBox = f.snapshot_full || f.snapshot
    ? _faceImgBox(f.snapshot_full || f.snapshot, 'scene', f, 'faceModalFullImg')
    : `<div style="width:100%;aspect-ratio:16/9;border-radius:8px;background:#000;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('face.noFullImg'))}</div>`;

  const cropBox = f.snapshot
    ? _faceImgBox(f.snapshot, 'face', f)
    : `<div style="width:100%;aspect-ratio:1/1;border-radius:8px;background:#000;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:11px">${escapeHtml(I18N.t('face.noImage'))}</div>`;

  // Data rows (fm-data-grid style, shared with recognition modal)
  const showExpr = (typeof _faceShowExpr === 'undefined') || _faceShowExpr;
  const rows = [
    [I18N.t('evt.colTime'),    escapeHtml(t)],
    [I18N.t('common.camera'),  escapeHtml(f.camera_id || '—')],
    [I18N.t('face.gender'),    escapeHtml(faceGenderLabel(f.gender))],
    [I18N.t('face.age'),       escapeHtml(faceAgeBucket(f.age))],
    ...(showExpr && f.expression ? [[I18N.t('face.emotion'), escapeHtml(faceExprLabel(f.expression))]] : []),
    [I18N.t('face.wearing'),   wear.length ? wear.map(w => escapeHtml(w)).join('  ') : escapeHtml(I18N.t('face.nothingWorn'))],
    [I18N.t('face.duration'),  escapeHtml(faceDurationLabel(f.stay_duration))],
    [I18N.t('face.quality'),   `${f.face_score || '—'}%`],
  ];
  const dataHtml = `<div class="fm-data-grid">${rows.map(([k, v]) =>
    `<div class="fm-data-row"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`
  ).join('')}</div>`;

  // Body appearance (reuse recognition-modal builder; empty → section hidden)
  const bodyChips = (typeof _matchBodyChips === 'function') ? _matchBodyChips(f) : [];
  const bodyHtml = bodyChips.length
    ? `<div class="fm-section-label">${escapeHtml(I18N.t('body.title','รูปพรรณ / Body Appearance'))}</div>
       <div class="fm-chip-row">${bodyChips.map(([k,v]) => `<div class="fm-chip"><div>${k}</div><div>${v}</div></div>`).join('')}</div>`
    : '';

  document.getElementById('faceModalBody').innerHTML = `
    <div class="fc-img-pair">
      <div>
        <div class="fm-section-label" style="margin-top:0;padding-top:0;border-top:none">${escapeHtml(I18N.t('fmatch.cropLabel','ใบหน้า (CROP)'))}</div>
        <div class="fc-imgwrap">${cropBox}</div>
      </div>
      <div>
        <div class="fm-section-label" style="margin-top:0;padding-top:0;border-top:none">${escapeHtml(I18N.t('fmatch.sceneLabel','ภาพฉากเต็ม (SNAPSHOT)'))}</div>
        <div class="fc-imgwrap">${sceneBox}</div>
      </div>
    </div>
    <div class="fm-section-label" style="margin-top:18px">${escapeHtml(I18N.t('face.detailSection','รายละเอียด'))}</div>
    ${dataHtml}
    ${bodyHtml}
    ${(typeof clipBlock === 'function') ? clipBlock(f) : ''}`;
  document.getElementById('faceModal').classList.remove('hidden');

  // faceRect (normalized 0–1) ชี้ตำแหน่งบนรูป full frame เท่านั้น —
  // ถ้าไม่มี snapshot_full ห้ามวาด.
  // กรอบหน้านับเป็น BBox → เคารพ overlay_show_bbox ของกล้อง
  const fr = f.face_rect;
  if (f.snapshot_full && fr && fr.width > 0 && fr.height > 0
      && _camOverlayFlags(f.camera_id).bbox) {
    attachSnapOverlay(document.getElementById('faceModalFullImg'),
      [{ kind: 'box', x1: fr.x, y1: fr.y, x2: fr.x + fr.width, y2: fr.y + fr.height }]);
  }
}

function closeFaceModal() {
  const m = document.getElementById('faceModal');
  if (m) m.classList.add('hidden');
  const v = document.querySelector('#faceModalBody video');
  if (v) v.pause();
}
