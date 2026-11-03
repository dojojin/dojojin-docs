// ============================================================
// Vigil Platform — Lab Test tab: AuraFace-v1 Blacklist (Internal Test & Development)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// Lives inside page-face-matches.js's tab bar (faceTabLab / faceTabPanelLab)
// but keeps its own data path: /api/face-blacklist/* — the main Face
// Recognition feed can't show these rows (event_type filter mismatch, see
// src/routes/face-blacklist.js header), so this stays its own render/fetch
// cycle even though it now shares the page container.
'use strict';

let _afbTab = 'hits';

function afbInit() {
  fetch(`${API}/api/settings`).then((r) => r.json()).then((s) => {
    const el = document.getElementById('ss_auraface_match_threshold');
    if (el) el.value = s.auraface_match_threshold?.value || '60';
  }).catch(() => {});
  afbLoadHits();
}

function afbTab(el) {
  _afbTab = el.dataset.tab;
  document.querySelectorAll('#faceTabPanelLab > .tabs .tab').forEach((t) => t.classList.toggle('active', t === el));
  document.getElementById('afbPanelHits')?.classList.toggle('hidden', _afbTab !== 'hits');
  document.getElementById('afbPanelRoster')?.classList.toggle('hidden', _afbTab !== 'roster');
  if (_afbTab === 'hits') afbLoadHits();
  else _afbSwitchRosterTab(document.querySelector('#afbRosterSubTabBar button.active')?.dataset.tab || 'add');
}

async function afbLoadHits() {
  const el = document.getElementById('afbBody');
  if (!el) return;
  el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading', 'กำลังโหลด...'))}</div>`;
  try { await afbRenderHits(el); }
  catch (e) { el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--status-bad)">${escapeHtml(e.message)}</div>`; }
}

async function afbRenderHits(el) {
  const rows = await fetch(`${API}/api/face-blacklist/hits?limit=100`).then((r) => r.json());
  if (!rows.length) {
    el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('afb.hitsEmpty', 'ยังไม่พบใครในบัญชีดำ'))}</div>`;
    return;
  }
  el.innerHTML = rows.map((r) => `
    <div class="wl-row">
      <div class="wl-row-main" data-action="afbOpenDetail" data-id="${r.id}">
        <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--surface-overlay);flex-shrink:0">
          ${r.snapshot_filename ? `<img src="${API}/snapshots/${encodeURIComponent(r.snapshot_filename)}" loading="lazy" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover" data-err="hide">` : ''}
        </div>
        <div class="wl-info">
          <div class="l1"><strong>${escapeHtml(r.label)}</strong><span class="wl-mode">${(r.similarity * 100).toFixed(1)}%</span></div>
          <div class="note">${escapeHtml(r.camera_name || r.camera_id || '-')} · ${escapeHtml(new Date(r.event_time).toLocaleString('th-TH', { hour12: false }))}</div>
        </div>
      </div>
    </div>`).join('');
}

// ── Roster sub-tabs: เพิ่ม/จัดการกลุ่ม vs รายการทั้งหมด — same shape as
// Settings › ระบบ LPR › รายการเฝ้าระวัง (_switchWlSetTab in page-lpr-settings.js).
function _afbSwitchRosterTab(tab) {
  document.querySelectorAll('#afbRosterSubTabBar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('afbRosterSubPanelAdd')?.classList.toggle('hidden', tab !== 'add');
  document.getElementById('afbRosterSubPanelList')?.classList.toggle('hidden', tab !== 'list');
  if (tab === 'add') _loadListSites(() => _afbLoadGroups(() => { _afbFillGroupSelect(); _afbRenderGroupMgr(); }));
  else { _afbLoadGroups(() => { _afbRenderGroupBar(); }); _fbBridgePendingStart(); }
}

let _afbGroups = [];
function _afbLoadGroups(cb) {
  fetch(`${API}/api/face-blacklist/groups`).then((r) => r.json())
    .then((rows) => { _afbGroups = Array.isArray(rows) ? rows : []; if (cb) cb(); })
    .catch(() => { if (cb) cb(); });
}

function _afbFillGroupSelect() {
  const sel = document.getElementById('afbAddGroup');
  if (!sel) return;
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('common.notSpecified', '— ไม่ระบุ —'))}</option>`
    + _afbGroups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')
    + `<option value="__add">${escapeHtml(I18N.t('lpr.wlAddGroup', '+ เพิ่มกลุ่ม'))}</option>`;
}

function _afbRenderGroupMgr() {
  const el = document.getElementById('afbGroupMgr');
  if (!el) return;
  el.innerHTML = _afbGroups.map((g) => `
    <div class="wl-grp-row">
      <input type="color" value="${escapeHtml(g.color || '#5b8def')}" data-change="afbGroupColor" data-gid="${escapeHtml(g.id)}">
      <input class="form-input" value="${escapeHtml(g.name)}" data-input="afbGroupRename" data-gid="${escapeHtml(g.id)}">
      ${_listScopeSelect('afbGroupSite', g)}
      <label class="wl-grp-line" title="${escapeHtml(I18N.t('lpr.wlNotifyLineHint', 'ส่ง LINE เมื่อพบในกลุ่มนี้'))}">
        <input type="checkbox" ${g.notify_line ? 'checked' : ''} data-change="afbGroupNotify" data-gid="${escapeHtml(g.id)}">
        <span>${escapeHtml(I18N.t('lpr.wlNotifyLine', 'ส่ง LINE'))} (${g.member_count})</span>
      </label>
      <button class="btn btn-secondary" style="color:var(--status-bad)" data-action="afbGroupDelete" data-gid="${escapeHtml(g.id)}">${escapeHtml(I18N.t('common.delete', 'ลบ'))}</button>
    </div>`).join('')
    + `<button class="btn btn-secondary wl-grp-add" data-action="afbGroupAddNew">${escapeHtml(I18N.t('lpr.wlAddGroup', '+ เพิ่มกลุ่ม'))}</button>`;
}

function afbGroupAddNew() {
  const name = prompt(I18N.t('lpr.wlGroupPrompt', 'ชื่อกลุ่มเฝ้าระวังใหม่'));
  if (!name || !name.trim()) return;
  fetch(`${API}/api/face-blacklist/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), site_id: _newListSiteId() }) })
    .then(() => _afbLoadGroups(() => { _afbFillGroupSelect(); _afbRenderGroupMgr(); }))
    .catch(console.error);
}
function afbGroupSite(el) {
  _patchListScope(`${API}/api/face-blacklist/groups/${el.dataset.gid}`, el, () => _afbLoadGroups(() => _afbRenderGroupMgr()));
}
let _afbGrpRenameTimers = {};
function afbGroupRename(el) {
  const gid = el.dataset.gid, v = el.value;
  clearTimeout(_afbGrpRenameTimers[gid]);
  _afbGrpRenameTimers[gid] = setTimeout(() => {
    fetch(`${API}/api/face-blacklist/groups/${gid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v }) })
      .then(() => _afbLoadGroups(() => _afbFillGroupSelect())).catch(console.error);
  }, 500);
}
function afbGroupColor(el) {
  const gid = el.dataset.gid;
  fetch(`${API}/api/face-blacklist/groups/${gid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: el.value }) })
    .then(() => _afbLoadGroups(() => _afbRenderGroupMgr())).catch(console.error);
}
function afbGroupNotify(el) {
  const gid = el.dataset.gid, on = el.checked;
  fetch(`${API}/api/face-blacklist/groups/${gid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify_line: on }),
  }).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = _afbGroups.find((x) => x.id === gid);
    if (g) g.notify_line = on;
  }).catch((err) => {
    el.checked = !on; // put the box back — this one decides whether phones buzz
    alert(I18N.t('lpr.wlNotifySaveFail', 'บันทึกไม่สำเร็จ: ') + err.message);
  });
}
function afbGroupDelete(el) {
  const gid = el.dataset.gid;
  if (!confirm(I18N.t('lpr.wlGroupDelConfirm', 'ลบกลุ่มนี้? (คนในกลุ่มจะไม่ถูกลบ)'))) return;
  fetch(`${API}/api/face-blacklist/groups/${gid}`, { method: 'DELETE' })
    .then(() => _afbLoadGroups(() => { _afbFillGroupSelect(); _afbRenderGroupMgr(); }))
    .catch(console.error);
}

// ── Reference-photo upload for the add form — magic bytes checked server-side
// (routes/face-blacklist.js). Embeds via the edge immediately so the form
// can tell "no face in this photo" before you even fill in a name.
let _afbPendingImg = null; // { ref_image, embedding, dim }
function _afbShowDropPreview(url) {
  const inner = document.getElementById('afbDropInner');
  if (!inner) return;
  inner.innerHTML = url
    ? `<img class="wl-drop-prev" src="${url}" alt=""><button type="button" class="wl-drop-clear" data-action="afbDropClear">${escapeHtml(I18N.t('common.clear', 'ล้าง'))}</button>`
    : `<span class="wl-drop-hint">${escapeHtml(I18N.t('lpr.wlDropHint', 'ลากรูปมาวาง หรือคลิกเพื่อเลือก'))}</span>`;
}
function _afbUploadFile(file) {
  if (!file || !/^image\//.test(file.type || '')) return;
  _afbShowDropPreview(URL.createObjectURL(file));
  const drop = document.getElementById('afbDrop'); if (drop) drop.classList.add('uploading');
  const fd = new FormData(); fd.append('image', file);
  fetch(`${API}/api/face-blacklist/roster/upload`, { method: 'POST', body: fd })
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok) { alert(d.error || I18N.t('common.saveFailed')); _afbResetDrop(); return; }
      _afbPendingImg = d;
    })
    .catch(() => { _afbResetDrop(); })
    .finally(() => { if (drop) drop.classList.remove('uploading'); });
}
function afbUploadImg(input) { _afbUploadFile(input.files && input.files[0]); }
function afbDropClear() { _afbResetDrop(); }
function _afbResetDrop() {
  _afbPendingImg = null;
  const fi = document.getElementById('afbAddImg'); if (fi) fi.value = '';
  _afbShowDropPreview(null);
}

function afbRosterAdd() {
  const label = (document.getElementById('afbAddLabel')?.value || '').trim();
  if (!label) { document.getElementById('afbAddLabel')?.focus(); return; }
  if (!_afbPendingImg) { alert(I18N.t('afb.needPhoto', 'อัปโหลดรูปก่อน')); return; }
  const group = document.getElementById('afbAddGroup')?.value || '';
  const body = {
    label,
    group_id: group && group !== '__add' ? group : null,
    notes: document.getElementById('afbAddNotes')?.value?.trim() || '',
    notify_line: !!document.getElementById('afbAddNotify')?.checked,
    ref_image: _afbPendingImg.ref_image, embedding: _afbPendingImg.embedding, dim: _afbPendingImg.dim,
  };
  const msg = document.getElementById('afbAddMsg');
  fetch(`${API}/api/face-blacklist/roster`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok) { if (msg) { msg.textContent = d.error || I18N.t('common.saveFailed'); msg.style.color = 'var(--status-bad)'; } return; }
      ['afbAddLabel', 'afbAddNotes'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
      _afbResetDrop();
      if (msg) { msg.textContent = I18N.t('common.saved', 'บันทึกแล้ว'); msg.style.color = 'var(--status-ok)'; }
    })
    .catch((e) => { if (msg) { msg.textContent = e.message; msg.style.color = 'var(--status-bad)'; } });
}

// ── Roster list — รายการทั้งหมด: search + group filter + pagination ──
let _afbSearch = '';
let _afbGroupFilter = 'all';
let _afbRosterPage = 1;
const _AFB_PAGE_SIZE = 50;

function _afbRenderGroupBar() {
  const bar = document.getElementById('afbGroupBar');
  if (!bar) return;
  bar.innerHTML = `<span class="wl-gchip ${_afbGroupFilter === 'all' ? 'active' : ''}" ${_afbGroupFilter === 'all' ? 'style="background:var(--accent)"' : ''} data-action="afbFilterGroup" data-gid="all">${escapeHtml(I18N.t('lpr.wlAllGroups', 'ทั้งหมด'))}</span>`
    + _afbGroups.map((g) => `<span class="wl-gchip ${_afbGroupFilter === g.id ? 'active' : ''}" ${_afbGroupFilter === g.id ? `style="background:${escapeHtml(g.color)};border-color:${escapeHtml(g.color)}"` : ''} data-action="afbFilterGroup" data-gid="${escapeHtml(g.id)}"><span class="wl-gdot" style="background:${escapeHtml(g.color)}"></span>${escapeHtml(g.name)} <b>${g.member_count}</b></span>`).join('');
  afbRosterList();
}

function afbFilterGroup(el) {
  _afbGroupFilter = el.dataset.gid;
  _afbRosterPage = 1;
  _afbRenderGroupBar();
}

function afbRosterSearch(el) {
  _afbSearch = (el.value || '').trim();
  _afbRosterPage = 1;
  afbRosterList();
}

function afbPageRoster(el) {
  _afbRosterPage = parseInt(el.dataset.page, 10) || 1;
  afbRosterList();
}

async function afbRosterList() {
  const el = document.getElementById('afbBody2');
  if (!el) return;
  el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('common.loading', 'กำลังโหลด...'))}</div>`;
  const params = new URLSearchParams({ limit: _AFB_PAGE_SIZE, offset: (_afbRosterPage - 1) * _AFB_PAGE_SIZE });
  if (_afbSearch) params.set('q', _afbSearch);
  if (_afbGroupFilter !== 'all') params.set('group', _afbGroupFilter);
  let rows, total;
  try {
    const res = await fetch(`${API}/api/face-blacklist/roster?${params}`);
    rows = await res.json();
    total = parseInt(res.headers.get('X-Total-Count'), 10) || rows.length;
  } catch (e) { el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(e.message)}</div>`; return; }

  if (!rows.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('afb.rosterEmpty', 'ไม่พบรายการ'))}</div>`;
    document.getElementById('afbRosterPager').innerHTML = '';
    return;
  }
  el.innerHTML = rows.map((r) => {
    const thumbSrc = r.ref_image ? `${API}/snapshots/${encodeURIComponent(r.ref_image)}`
      : r.ref_photo_path ? `${API}/api/blacklist/photo/${escapeHtml(r.ref_photo_path)}` : null;
    return `
    <div class="wl-row">
      <div class="wl-row-main" data-action="afbOpenRosterDetail" data-id="${r.id}">
        <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--surface-overlay);flex-shrink:0">
          ${thumbSrc ? `<img src="${thumbSrc}" loading="lazy" decoding="async" alt="" style="width:100%;height:100%;object-fit:cover${_afbRefHidden ? ';filter:blur(6px)' : ''}" data-err="hide">` : ''}
        </div>
        <div class="wl-info">
          <div class="l1">
            <strong style="${r.active ? '' : 'color:var(--text-secondary)'}">${escapeHtml(r.label)}</strong>
            ${r.group_name ? `<span class="wl-badge" style="background:${escapeHtml(r.group_color)};color:#fff">${escapeHtml(r.group_name)}</span>` : ''}
            ${!r.notify_line ? `<span class="wl-mode">${escapeHtml(I18N.t('afb.muted', 'ไม่ส่ง LINE'))}</span>` : ''}
            ${!r.active ? `<span class="wl-mode">${escapeHtml(I18N.t('common.disabled', 'ปิดอยู่'))}</span>` : ''}
          </div>
          ${r.notes ? `<div class="note">${escapeHtml(r.notes)}</div>` : ''}
        </div>
      </div>
      <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px;flex-shrink:0" data-action="afbToggleActive" data-id="${r.id}" data-active="${r.active ? '0' : '1'}">
        ${r.active ? escapeHtml(I18N.t('common.disable', 'ปิดใช้งาน')) : escapeHtml(I18N.t('common.enable', 'เปิดใช้งาน'))}
      </button>
    </div>`;
  }).join('');

  const pager = document.getElementById('afbRosterPager');
  const totalPages = Math.max(1, Math.ceil(total / _AFB_PAGE_SIZE));
  if (pager) {
    const info = `<span style="color:var(--text-secondary);font-size:12px;padding:0 8px">${escapeHtml(I18N.t('lpr.page', 'หน้า'))} ${_afbRosterPage}/${totalPages} · ${total.toLocaleString()} ${escapeHtml(I18N.t('lpr.items', 'รายการ'))}</span>`;
    const prev = _afbRosterPage > 1 ? `<button class="pg-btn" data-action="afbPageRoster" data-page="${_afbRosterPage - 1}">‹</button>` : '';
    const next = _afbRosterPage < totalPages ? `<button class="pg-btn" data-action="afbPageRoster" data-page="${_afbRosterPage + 1}">›</button>` : '';
    pager.innerHTML = totalPages > 1 ? `${prev}${info}${next}` : info;
  }
}

async function afbToggleActive(el) {
  const id = el.dataset.id;
  const active = el.dataset.active === '1';
  try {
    const res = await fetch(`${API}/api/face-blacklist/roster/${id}/active`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    afbRosterList();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

// ── Reference photo — blurred by default, same privacy convention as the
// ฐานข้อมูลใบหน้า page (_blFaceHidden in page-blacklist.js): a client-side
// blur, not an access restriction, session-wide so it stays hidden across
// records once someone hides it. Own small copy of the eye icons rather
// than reaching into page-blacklist.js's file-scoped consts.
const _AFB_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const _AFB_EYE_OFF  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
let _afbRefHidden = true;

function _afbRefBox(refImage, photoPath) {
  // refImage = manually uploaded (served via /snapshots/), photoPath = HCP-
  // sourced via enrolled_ref backfill (served via /api/blacklist/photo/) —
  // different storage, different serving route, see routes/face-blacklist.js.
  const src = refImage ? `${API}/snapshots/${encodeURIComponent(refImage)}`
    : photoPath ? `${API}/api/blacklist/photo/${escapeHtml(photoPath)}` : null;
  if (!src) return `<div class="fm-img-box"><div class="fm-img-empty">${escapeHtml(I18N.t('fmatch.noRef'))}</div></div>`;
  return `<div class="fm-img-box">
    <img id="afbRefImg" src="${src}" alt="" data-err="hide" style="${_afbRefHidden ? 'filter:blur(18px)' : ''}">
    <button type="button" data-action="afbToggleRefBlur" title="${escapeHtml(I18N.t('bl.togglePhoto', 'ซ่อน / แสดงภาพ'))}"
      style="position:absolute;top:6px;right:6px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);border:none;border-radius:6px;color:#fff;cursor:pointer;z-index:2">${_afbRefHidden ? _AFB_EYE_OFF : _AFB_EYE_OPEN}</button>
    <div class="fm-img-label">${escapeHtml(I18N.t('fmatch.snapRef', 'ภาพอ้างอิง'))}</div>
  </div>`;
}

function afbToggleRefBlur() {
  _afbRefHidden = !_afbRefHidden;
  const img = document.getElementById('afbRefImg');
  if (img) img.style.filter = _afbRefHidden ? 'blur(18px)' : '';
  const btn = document.querySelector('#afbDetailModalBody [data-action="afbToggleRefBlur"]');
  if (btn) btn.innerHTML = _afbRefHidden ? _AFB_EYE_OFF : _AFB_EYE_OPEN;
}

// ── Detail modal — same visual template as openFaceMatchModal (fmatch),
// minus note/ack (no ack backend applies to this data — see routes/face-blacklist.js).
async function afbOpenDetail(el) {
  const id = el.dataset.id;
  let m;
  try {
    m = await fetch(`${API}/api/face-blacklist/hits/${id}`).then((r) => r.json());
  } catch (e) { return; }
  if (!m || m.error) return;

  const t = m.event_time ? new Date(m.event_time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
  const sim = m.similarity != null ? `${(m.similarity * 100).toFixed(1)}%` : '—';

  const faceBox = m.snapshot_filename
    ? `<div class="fm-img-box"><img src="${API}/snapshots/${encodeURIComponent(m.snapshot_filename)}" alt="" data-err="hide"><div class="fm-img-label">${escapeHtml(I18N.t('fmatch.cropLabel', 'ที่ตรวจพบ'))}</div></div>`
    : `<div class="fm-img-box"><div class="fm-img-empty">${escapeHtml(I18N.t('face.noImage'))}</div></div>`;
  const sceneFile = m.snapshot_full;
  const sceneFullUrl = sceneFile ? `${API}/snapshots/${encodeURIComponent(sceneFile)}` : '';
  const sceneHtml = sceneFile
    ? `<div class="fm-scene"><span class="fm-scene-inner">
         <img id="afbSceneImg" src="${sceneFullUrl}?w=${SNAP_W.scene}" loading="lazy" decoding="async" alt="" data-err="hide">
         <button type="button" data-action="openUrl" data-url="${sceneFullUrl}" title="${escapeHtml(I18N.t('snap.viewFull', 'ดูรูปเต็ม'))}"
           style="position:absolute;bottom:8px;right:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);border:none;border-radius:6px;color:#fff;cursor:pointer;z-index:2">
           <svg width="16" height="16" aria-hidden="true"><use href="#icon-search"/></svg>
         </button>
       </span></div>`
    : '';

  const rows = [
    [I18N.t('fmatch.person'), escapeHtml(m.label)],
    [I18N.t('fmatch.similarity'), sim],
    [I18N.t('evt.colTime'), escapeHtml(t)],
    [I18N.t('common.camera'), escapeHtml(m.camera_name || m.camera_id || '—')],
  ];
  if (m.gender) rows.push([I18N.t('face.gender'), escapeHtml(faceGenderLabel(m.gender))]);
  if (m.age)    rows.push([I18N.t('face.age'), escapeHtml(faceAgeBucket(m.age))]);
  if (m.expression) rows.push([I18N.t('face.emotion'), escapeHtml(faceExprLabel(m.expression))]);
  const dataHtml = `<div class="fm-data-grid">${rows.map(([k, v]) => `<div class="fm-data-row"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`).join('')}</div>`;

  document.getElementById('afbDetailModalBody').innerHTML = `
    <div class="fm-top-grid">
      <div class="fm-col-media">
        <div class="fm-img-pair">${faceBox}${_afbRefBox(m.ref_image, m.ref_photo_path)}</div>
        ${sceneHtml}
      </div>
      <div class="fm-col-data">${dataHtml}<div id="afbAppearanceSection" data-eid="${m.event_id ?? ''}"></div></div>
    </div>
    ${m.event_id != null ? `<div style="display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-hairline);flex-wrap:wrap">
      <button class="btn btn-secondary" style="font-size:12px" data-action="notifyFaceMatch" data-id="${m.event_id}">
        <svg aria-hidden="true" width="13" height="13" style="vertical-align:-2px;margin-right:5px"><use href="#icon-send"/></svg>${escapeHtml(I18N.t('lpr.amNotify', 'ส่งเข้า LINE'))}
        <span class="am-manual-badge">${escapeHtml(I18N.t('lpr.amManual', 'ระบุเอง'))}</span>
      </button>
    </div>` : ''}`;
  document.getElementById('afbDetailModal').classList.remove('hidden');

  // IVA Pro appearance (appearances table, matched via event_id) — same
  // lazy fetch+render as the normal Face Recognition modal (decision #241).
  // Uses m.event_id, NOT m.id — m.id is the face_blacklist_hits row, m.event_id
  // is the real events.id the appearance table is keyed on (see backend SELECT).
  if (m.event_id != null) {
    fetch(`${API}/api/events/${m.event_id}/appearance`)
      .then(r => r.ok ? r.json() : null)
      .then(ap => {
        if (!ap) return;
        const sec = document.getElementById('afbAppearanceSection');
        if (!sec || sec.dataset.eid !== String(m.event_id)) return;
        sec.innerHTML = _renderAppearanceSection(ap);
      })
      .catch(() => {});
  }

  // Red blinking box on the scene image — real faceRect from Hikvision's own
  // event payload (raw_json.faceRect, 0-1 normalized), not an estimate.
  if (m.face_rect && typeof attachSnapOverlay === 'function') {
    const r = m.face_rect;
    attachSnapOverlay(document.getElementById('afbSceneImg'),
      [{ kind: 'face-box', x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height }]);
  }
}

function afbCloseDetail() {
  document.getElementById('afbDetailModal').classList.add('hidden');
}

// ── Roster detail modal — reuses the same #afbDetailModal shell as the hit
// modal above, PDPA hide-face toggle via _afbRefBox/afbToggleRefBlur (same
// session-wide blur state, so hiding it here also hides it in the hit modal
// and the small list thumbnails until switched back).
async function afbOpenRosterDetail(el) {
  const id = el.dataset.id;
  let m;
  try { m = await fetch(`${API}/api/face-blacklist/roster/${id}`).then((r) => r.json()); }
  catch (e) { return; }
  if (!m || m.error) return;

  const rows = [
    [I18N.t('fmatch.person'), escapeHtml(m.label)],
    [I18N.t('lpr.wlGroup', 'กลุ่มเฝ้าระวัง'), m.group_name ? escapeHtml(m.group_name) : '—'],
    [I18N.t('lpr.wlNotifyLine', 'ส่ง LINE'), m.notify_line ? escapeHtml(I18N.t('common.enable', 'เปิด')) : escapeHtml(I18N.t('common.disable', 'ปิด'))],
    [I18N.t('common.status', 'สถานะ'), m.active ? escapeHtml(I18N.t('common.enable', 'เปิด')) : escapeHtml(I18N.t('common.disabled', 'ปิดอยู่'))],
    [I18N.t('lpr.watchlistLabel', 'หมายเหตุ'), m.notes ? escapeHtml(m.notes) : '—'],
  ];
  const dataHtml = `<div class="fm-data-grid">${rows.map(([k, v]) => `<div class="fm-data-row"><span>${escapeHtml(k)}</span><strong>${v}</strong></div>`).join('')}</div>`;

  document.getElementById('afbDetailModalBody').innerHTML = `
    <div class="fm-top-grid">
      <div class="fm-col-media">
        <div class="fm-img-pair">${_afbRefBox(m.ref_image, m.ref_photo_path)}</div>
      </div>
      <div class="fm-col-data">${dataHtml}</div>
    </div>`;
  document.getElementById('afbDetailModal').classList.remove('hidden');
}

// ============================================================
// FB5 — blacklist reservoir -> face_blacklist bridge (Lab Test)
// Same shape as page-blacklist.js's B3 bridge (blOpenBridge etc.) for LPR —
// see blacklistFaceBridge.js's header for what genuinely differs server-side.
// Reuses the .brg-* / .cfg-type-toggle CSS classes as-is (index.css) since
// they were never LPR-specific by name.
// ============================================================
let _fbBridge = null;
let _fbSources = [];

async function fbOpenBridge() {
  const body = document.getElementById('fbBridgeBody');
  body.innerHTML = `<div class="inline-note">${escapeHtml(I18N.t('common.loading', 'กำลังโหลด...'))}</div>`;
  document.getElementById('fbBridgeModal').classList.remove('hidden');
  try {
    const [rr, sr] = await Promise.all([
      fetch(`${API}/api/face-blacklist/bridge/rules`, { credentials: 'include' }),
      fetch(`${API}/api/blacklist/sources`, { credentials: 'include' }),
    ]);
    const j = await rr.json();
    if (!rr.ok) throw new Error(j.error || `HTTP ${rr.status}`);
    _fbSources = sr.ok ? (await sr.json()).filter((s) => (s.data_types || []).includes('face')) : [];
    _fbBridge = { ...j, preview: null };
    _fbRenderBridge();
  } catch (e) {
    body.innerHTML = `<div class="cfg-result err"><div class="cfg-result-head">${escapeHtml(I18N.t('common.error', 'ผิดพลาด'))}</div>${escapeHtml(e.message)}</div>`;
  }
}

function _fbRenderBridge() {
  const b = _fbBridge;
  const groupsFor = (sid) => b.facets.filter((f) => String(f.source_id) === String(sid) && f.group_name !== '__none__');

  const ruleRows = b.rules.length ? b.rules.map((r) => {
    const n = b.facets.filter((f) => String(f.source_id) === String(r.source_id) &&
      (!r.group_names?.length || r.group_names.includes(f.group_name)))
      .reduce((s, f) => s + f.n, 0);
    const scope = r.external_ids?.length
      ? `${I18N.t('blbr.picked', 'เลือกเอง')} ${r.external_ids.length}`
      : (r.group_names?.length ? r.group_names.join(', ') : I18N.t('blbr.allOf', 'ทั้งหมด'));
    const wild = !r.external_ids?.length && !r.group_names?.length;
    return `<div class="brg-rule ${r.active ? '' : 'off'}">
        <div class="brg-rule-main">
          <div class="brg-rule-name">${escapeHtml(r.source_label)}<span class="brg-scope">${escapeHtml(scope)}</span>${
            wild ? `<span class="brg-scope wild">${escapeHtml(I18N.t('blbr.autoNew', 'รับหมวดใหม่อัตโนมัติ'))}</span>` : ''}</div>
          <div class="inline-note">→ ${escapeHtml(r.target_group_name || I18N.t('blbr.noGroup', 'ไม่ระบุกลุ่ม'))}
            ${r.external_ids?.length ? '' : `· ~${n.toLocaleString()} ${escapeHtml(I18N.t('blset.records', 'ระเบียน'))}`}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="fbBridgeToggle" data-id="${r.id}" data-on="${r.active}">
          ${escapeHtml(r.active ? I18N.t('blbr.pause', 'พัก') : I18N.t('blbr.resume', 'ใช้งาน'))}</button>
        <button class="btn btn-ghost btn-sm" data-action="fbBridgeDelRule" data-id="${r.id}">${escapeHtml(I18N.t('common.delete', 'ลบ'))}</button>
      </div>`;
  }).join('') : `<div class="bl-empty">${escapeHtml(I18N.t('blbr.noRules', 'ยังไม่มีกติกา — เพิ่มด้านล่างเพื่อเริ่ม'))}</div>`;

  const unmapped = b.facets.filter((f) =>
    f.group_name !== '__none__' &&
    _fbSources.some((s) => String(s.id) === String(f.source_id)) &&
    !b.rules.some((r) => r.active && String(r.source_id) === String(f.source_id) &&
      !r.external_ids?.length &&
      (!r.group_names?.length || r.group_names.includes(f.group_name))));
  const srcLabel = (id) => (_fbSources.find((s) => String(s.id) === String(id)) || {}).label || id;

  const unmappedBlock = unmapped.length ? `
    <div class="brg-sec-title">${escapeHtml(I18N.t('blbr.unmapped', 'หมวดที่ยังไม่ได้จับคู่'))}</div>
    <div class="brg-unmapped-list">
      ${unmapped.map((f) => `<button class="brg-unmapped" data-action="fbBridgeMapFacet"
          data-sid="${escapeHtml(String(f.source_id))}" data-g="${escapeHtml(f.group_name)}">
          <span class="brg-unmapped-src">${escapeHtml(srcLabel(f.source_id))}</span>
          <span class="brg-unmapped-g">${escapeHtml(f.group_name)}</span>
          <span class="brg-unmapped-n">${f.n.toLocaleString()}</span></button>`).join('')}
    </div>
    <div class="inline-note">${escapeHtml(I18N.t('blbr.unmappedHint',
      'กดเพื่อกรอกฟอร์มด้านล่างให้ — เลือกกลุ่มปลายทางเองแล้วกดเพิ่มกติกา'))}</div>` : '';

  const first = _fbSources[0];
  const fg = first ? groupsFor(first.id) : [];
  const p = b.preview;

  const pendingBadge = document.getElementById('fbBridgePendingBadge');
  if (pendingBadge) {
    const n = b.pending?.count || 0;
    pendingBadge.textContent = n > 99 ? '99+' : String(n);
    pendingBadge.classList.toggle('show', n > 0);
  }
  const statusLine = `
    <div class="brg-status">
      <span>${escapeHtml(I18N.t('blbr.lastSync', 'sync อัตโนมัติล่าสุด'))}: <strong>${
        b.last_sync_at ? escapeHtml(new Date(b.last_sync_at).toLocaleString('th-TH', { hour12: false })) : escapeHtml(I18N.t('blbr.neverSynced', 'ยังไม่เคย'))}</strong></span>
      ${b.pending?.count ? `<span class="brg-pending-warn">${b.pending.count} ${
        escapeHtml(I18N.t('blbr.pendingCount', 'ป้ายรอตรวจ (บล็อก sync อัตโนมัติ)'))}</span>` : ''}
    </div>
    <div class="brg-status">
      <span><strong>${b.roster.bridged.toLocaleString()}</strong> ${escapeHtml(I18N.t('blbr.fromRoster', 'จากฐานข้อมูล'))}</span>
      <span><strong>${b.roster.manual.toLocaleString()}</strong> ${escapeHtml(I18N.t('blbr.manual', 'กรอกเอง'))}</span>
      <span class="inline-note">${escapeHtml(I18N.t('blbr.manualSafe', 'ระบบไม่แตะรายการที่กรอกเองเลย'))}</span>
    </div>`;

  document.getElementById('fbBridgeBody').innerHTML = `
    ${statusLine}

    <div class="brg-sec-title">${escapeHtml(I18N.t('blbr.rules', 'กติกาที่ใช้อยู่'))}</div>
    ${ruleRows}
    ${unmappedBlock}

    <div class="brg-sec-title">${escapeHtml(I18N.t('blbr.addRule', 'เพิ่มกติกา'))}</div>
    <div class="brg-form">
      <div class="cfg-row">
        <label>${escapeHtml(I18N.t('bl.source', 'แหล่งข้อมูล'))}</label>
        <select class="form-input" id="fbrgSource" data-change="fbBridgeSrcChange">
          ${_fbSources.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>
      <div class="cfg-row" id="fbrgGroupRow" ${fg.length ? '' : 'hidden'}>
        <label>${escapeHtml(I18N.t('afb.groupFilter', 'กรองตามคลัง'))}</label>
        <div class="cfg-type-toggles" id="fbrgGroups">
          ${fg.map((f) => `<span class="cfg-type-toggle" data-action="fbToggleType" data-dt="${escapeHtml(f.group_name)}">${escapeHtml(f.group_name)} (${f.n.toLocaleString()})</span>`).join('')}
        </div>
        <div class="inline-note">${escapeHtml(I18N.t('blbr.riskHint', 'ไม่เลือก = เอาทั้งหมดจากแหล่งนี้'))}</div>
      </div>
      <div class="cfg-row" id="fbrgNoGroupNote" ${fg.length ? 'hidden' : ''}>
        <div class="placeholder-note">${escapeHtml(I18N.t('blbr.noGroups', 'แหล่งนี้ไม่ได้ส่งระดับเฝ้าระวังมา — เลือกได้เฉพาะ "ทั้งหมด"'))}</div>
      </div>
      <div class="cfg-row">
        <label>${escapeHtml(I18N.t('blbr.target', 'ส่งเข้ากลุ่มเฝ้าระวัง'))}</label>
        <select class="form-input" id="fbrgTarget">
          ${b.groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="inline-note" style="margin:2px 0 8px">${escapeHtml(I18N.t('fbbr.embedNote',
        'รูปอ้างอิงของแต่ละคนจะถูกส่งไปคำนวณ embedding ที่ edge ตอนกด "ยืนยันนำไปใช้" — ถ้าหาใบหน้าในรูปไม่เจอจะข้ามคนนั้นไว้ก่อน ลองใหม่ได้ในรอบถัดไป'))}</div>
      <button class="btn btn-secondary btn-sm" data-action="fbBridgeAddRule">${escapeHtml(I18N.t('blbr.addRule', 'เพิ่มกติกา'))}</button>
    </div>

    <div class="brg-sec-title">${escapeHtml(I18N.t('blbr.applyTitle', 'ตรวจสอบแล้วนำไปใช้'))}</div>
    ${p ? `
      <div class="brg-diff">
        <span class="brg-cnt add">+${p.counts.add.toLocaleString()} ${escapeHtml(I18N.t('blbr.willAdd', 'เพิ่ม'))}</span>
        <span class="brg-cnt upd">~${p.counts.update.toLocaleString()} ${escapeHtml(I18N.t('blbr.willUpdate', 'แก้ไข'))}</span>
        <span class="brg-cnt del">−${p.counts.remove.toLocaleString()} ${escapeHtml(I18N.t('blbr.willRemove', 'ถอนออก'))}</span>
        ${p.counts.skipped_manual ? `<span class="brg-cnt skip">${p.counts.skipped_manual} ${escapeHtml(I18N.t('blbr.skipManual', 'ข้าม (กรอกเอง)'))}</span>` : ''}
      </div>
      ${p.partial ? `<div class="brg-partial">${escapeHtml(I18N.t('blbr.partialNote', 'รอบนี้ดูเฉพาะบางกติกา จึงจะไม่ถอนรายชื่อใดออกเลย — การถอนต้องดูทุกกติกาพร้อมกัน'))}</div>` : ''}
      ${p.add.length ? `<div class="brg-list"><div class="brg-list-h">${escapeHtml(I18N.t('blbr.willAdd', 'เพิ่ม'))}</div>${p.add.slice(0, 40).map((r) => `<span class="brg-plate">${escapeHtml(r.label)}</span>`).join('')}${p.counts.add > 40 ? `<span class="inline-note">… ${escapeHtml(I18N.t('blbr.andMore', 'และอีก'))} ${(p.counts.add - 40).toLocaleString()}</span>` : ''}</div>` : ''}
      ${p.remove.length ? `<div class="brg-list"><div class="brg-list-h">${escapeHtml(I18N.t('blbr.willRemove', 'ถอนออก'))}</div>${p.remove.slice(0, 40).map((r) => `<span class="brg-plate del">${escapeHtml(r.label)}</span>`).join('')}${p.counts.remove > 40 ? `<span class="inline-note">… ${escapeHtml(I18N.t('blbr.andMore', 'และอีก'))} ${(p.counts.remove - 40).toLocaleString()}</span>` : ''}</div>` : ''}
      <div style="margin-top:12px">
        <button class="btn btn-primary" data-action="fbBridgeSync"
          ${(p.counts.add || p.counts.update || p.counts.remove) ? '' : 'disabled'}>
          ${escapeHtml(I18N.t('blbr.apply', 'ยืนยันนำไปใช้'))}</button>
        <button class="btn btn-secondary" data-action="fbBridgePreview">${escapeHtml(I18N.t('blbr.recheck', 'ตรวจใหม่'))}</button>
      </div>`
    : `<div class="inline-note">${escapeHtml(I18N.t('blbr.previewFirst', 'กดตรวจสอบเพื่อดูว่าจะเพิ่ม/ถอนอะไรบ้าง — ยังไม่มีการเปลี่ยนแปลงใดๆ จนกว่าจะยืนยัน'))}</div>
       <div style="margin-top:10px"><button class="btn btn-secondary" data-action="fbBridgePreview">${escapeHtml(I18N.t('blbr.preview', 'ตรวจสอบ (ยังไม่เขียน)'))}</button></div>`}`;
}

function fbBridgeSrcChange() {
  const sid = document.getElementById('fbrgSource').value;
  const fg = _fbBridge.facets.filter((f) => String(f.source_id) === String(sid) && f.group_name !== '__none__');
  document.getElementById('fbrgGroups').innerHTML = fg.map((f) =>
    `<span class="cfg-type-toggle" data-action="fbToggleType" data-dt="${escapeHtml(f.group_name)}">${escapeHtml(f.group_name)} (${f.n.toLocaleString()})</span>`).join('');
  document.getElementById('fbrgGroupRow').hidden = !fg.length;
  document.getElementById('fbrgNoGroupNote').hidden = !!fg.length;
}

function fbBridgeMapFacet(el) {
  const sel = document.getElementById('fbrgSource');
  sel.value = el.dataset.sid;
  fbBridgeSrcChange();
  const chip = document.querySelector(`#fbrgGroups .cfg-type-toggle[data-dt="${CSS.escape(el.dataset.g)}"]`);
  if (chip) chip.classList.add('on');
  document.getElementById('fbrgTarget').focus();
  sel.closest('.brg-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function fbBridgeAddRule() {
  const groups = Array.from(document.querySelectorAll('#fbrgGroups .cfg-type-toggle.on')).map((el) => el.dataset.dt);
  try {
    const r = await fetch(`${API}/api/face-blacklist/bridge/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        source_id: document.getElementById('fbrgSource').value,
        group_names: groups.length ? groups : null,
        target_group_id: document.getElementById('fbrgTarget').value || null,
      }),
    });
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    fbOpenBridge();
  } catch (e) { alert(I18N.t('blset.saveFail', 'บันทึกไม่สำเร็จ') + ': ' + e.message); }
}

async function fbBridgeToggle(el) {
  await fetch(`${API}/api/face-blacklist/bridge/rules/${el.dataset.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ active: el.dataset.on !== 'true' }),
  }).catch(() => {});
  fbOpenBridge();
}

async function fbBridgeDelRule(el) {
  if (!confirm(I18N.t('blbr.delRuleConfirm', 'ลบกติกานี้? รายชื่อที่กติกานี้ส่งเข้าไปจะยังอยู่จนกว่าคุณจะกดนำไปใช้อีกครั้ง'))) return;
  await fetch(`${API}/api/face-blacklist/bridge/rules/${el.dataset.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
  fbOpenBridge();
}

async function fbBridgePreview() {
  try {
    const r = await fetch(`${API}/api/face-blacklist/bridge/preview`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _fbBridge.preview = j;
    _fbRenderBridge();
  } catch (e) { alert(I18N.t('common.error', 'ผิดพลาด') + ': ' + e.message); }
}

async function fbBridgeSync() {
  const c = _fbBridge.preview.counts;
  if (!confirm(`${I18N.t('blbr.applyConfirm', 'ยืนยันนำไปใช้กับระบบเฝ้าระวัง?')}\n\n` +
               `${I18N.t('blbr.willAdd', 'เพิ่ม')}: ${c.add}\n${I18N.t('blbr.willRemove', 'ถอนออก')}: ${c.remove}\n\n` +
               `${I18N.t('fbbr.applyWarn', 'คนที่เพิ่มจะเริ่มถูกเทียบกับกล้องทันที (ต้องตั้งค่าให้ส่ง LINE เองที่กลุ่มด้วย)')}`)) return;
  try {
    const r = await fetch(`${API}/api/face-blacklist/bridge/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ confirm: { add: c.add, remove: c.remove } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    alert(`${I18N.t('blbr.done', 'นำไปใช้เรียบร้อย')}\n\n` +
          `${I18N.t('blbr.willAdd', 'เพิ่ม')}: ${j.added} · ${I18N.t('blbr.willUpdate', 'แก้ไข')}: ${j.updated} · ` +
          `${I18N.t('blbr.willRemove', 'ถอนออก')}: ${j.removed}` +
          (j.embed_failed ? `\n${I18N.t('fbbr.embedFailed', 'หาใบหน้าในรูปไม่เจอ (ข้ามไว้)')}: ${j.embed_failed}` : '') +
          (j.skipped_manual ? `\n${I18N.t('blbr.skipManual', 'ข้าม (กรอกเอง)')}: ${j.skipped_manual}` : ''));
    fbOpenBridge();
  } catch (e) { alert(I18N.t('common.error', 'ผิดพลาด') + ': ' + e.message); }
}

// Badge poller — mirrors _blBridgePendingStart() (page-blacklist.js). Started
// once the roster's "list" sub-tab is first shown (afbTab/_afbSwitchRosterTab).
let _fbBridgePendingTimer = null;

async function _fbBridgePendingCheck() {
  const badge = document.getElementById('fbBridgePendingBadge');
  if (!badge) return;
  try {
    const r = await fetch(`${API}/api/face-blacklist/bridge/rules`, { credentials: 'include' });
    if (!r.ok) return;
    const j = await r.json();
    const n = j.pending?.count || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('show', n > 0);
  } catch (e) { /* a missed badge refresh is not worth surfacing */ }
}

function _fbBridgePendingStart() {
  if (_fbBridgePendingTimer) return;
  _fbBridgePendingCheck();
  _fbBridgePendingTimer = setInterval(_fbBridgePendingCheck, 10 * 60 * 1000);
}
