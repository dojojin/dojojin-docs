// ============================================================
// Vigil Platform — Categories Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// 🏷️ Category Manager (Stats v2 — Phase 1)
// ============================================================

let _categoriesCache = [];
let _catSiteId = null;
let _catScopeBarReady = false;
let _catSites = [];
let _crCamListFull = [];   // site-scoped camera list for the rule editor, unfiltered by cam type
let _catRulesCache = [];   // last-loaded rules for the open category (delete-all / group-delete)

async function _initCatScopeBar() {
  if (_catScopeBarReady) return;
  _catScopeBarReady = true;
  const bar = document.getElementById('catScopeBar');
  const siteBar = document.getElementById('catSiteBar');
  if (!bar || !siteBar) return;
  try {
    const res = await fetch(`${API}/api/sites`, { cache: 'no-store' });
    if (!res.ok) return;
    const sites = await res.json();
    _catSites = Array.isArray(sites) ? sites : [];
    if (!Array.isArray(sites) || sites.length <= 1) {
      if (sites.length === 1) _catSiteId = sites[0].id; // auto-select only site
      return;
    }
    bar.style.display = '';
    siteBar.innerHTML =
      `<button class="site-tag all active" data-site-id="">${escapeHtml(I18N.t('common.all'))}</button>` +
      sites.map(s => `<button class="site-tag" data-site-id="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}</button>`).join('');
    siteBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.site-tag');
      if (!btn) return;
      siteBar.querySelectorAll('.site-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _catSiteId = btn.dataset.siteId ? parseInt(btn.dataset.siteId) : null;
      loadCategories();
    });
  } catch {}
}

function openCategoryManager() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('categories');
}
function closeCategoryManager() { /* categories is a Settings Workspace section now — no modal */ }

async function loadCategories() {
  await _initCatScopeBar();
  try {
    const siteQ = _catSiteId ? `?site_id=${_catSiteId}` : '';
    const res = await fetch(`${API}/api/categories${siteQ}`);
    if (!res.ok) throw new Error('Failed to load');
    _categoriesCache = await res.json();
    renderCategoriesList();
  } catch (e) { console.error('loadCategories:', e); }
}

function renderCategoriesList() {
  const cats = _categoriesCache;
  const lockedCount = cats.filter(c => c.is_locked).length;
  document.getElementById('catCount').textContent = cats.length;
  document.getElementById('catBuiltinCount').textContent = lockedCount;

  const list = document.getElementById('categoriesList');
  if (!cats.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('cat.noCategories'))}</div>`;
    return;
  }
  list.innerHTML = cats.map(c => {
    const lockIcon = c.is_locked ? `<svg aria-hidden="true" width="10" height="10" style="vertical-align:-1px;margin-right:3px;opacity:.6"><use href="#icon-lock"/></svg>` : '';
    const kindBadge = c.kind === 'people_counter'  ? '<span style="background:#22c55e30;color:var(--status-ok);padding:2px 6px;border-radius:4px;font-size:10px">PEOPLE</span>'
                    : c.kind === 'vehicle_counter' ? '<span style="background:#5b8def30;color:var(--accent);padding:2px 6px;border-radius:4px;font-size:10px">VEHICLE</span>'
                    : '<span style="background:#ef444430;color:var(--status-bad);padding:2px 6px;border-radius:4px;font-size:10px">EVENT</span>';
    return `
      <div class="cat-list-row">
        <div style="font-size:22px;line-height:1">${escapeHtml(c.icon || '')}</div>
        <div>
          <div style="font-weight:600;color:var(--text-primary)">${lockIcon}${escapeHtml(c.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary)">sort: ${c.sort_order}</div>
        </div>
        <div class="cat-col-kind">${kindBadge}</div>
        <div class="cat-col-color" style="display:flex;align-items:center;gap:5px">
          <div style="width:14px;height:14px;border-radius:3px;background:${escapeHtml(c.color || '#5b8def')}"></div>
          <span style="font-size:10px;color:var(--text-secondary);font-family:monospace">${escapeHtml(c.color || '')}</span>
        </div>
        <div class="cat-col-rules" style="font-size:11px;color:var(--text-secondary)">${c.rule_count} rules</div>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-secondary" style="font-size:11px;padding:5px 9px" data-action="openCatRules" data-id="${c.id}"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px;margin-right:4px"><use href="#icon-list"/></svg>Rules</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:5px 9px" data-action="openCatEditor" data-id="${c.id}"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px;margin-right:4px"><use href="#icon-edit"/></svg>Edit</button>
          <button class="btn btn-secondary" style="font-size:11px;padding:5px 9px;${c.is_locked?'opacity:0.4;pointer-events:none':''}" data-action="deleteCat" data-id="${c.id}" aria-label="Delete"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px"><use href="#icon-trash"/></svg></button>
        </div>
      </div>
    `;
  }).join('');
}

const _ICON_PRESETS = ['🚨','⚠️','🚶','🚗','🔥','🚦','📦','👁','🔔','🚧','🛑','🎯'];

function _renderIconPresets(selected) {
  const container = document.getElementById('ceIconPresets');
  if (!container) return;
  container.innerHTML = _ICON_PRESETS.map(e =>
    `<button type="button" class="icon-preset-btn${e === selected ? ' active' : ''}"
       data-action="selectIconPreset" data-preset="${e}" title="${e}">${e}</button>`
  ).join('');
}
function selectIconPreset(emoji) {
  document.getElementById('ceIcon').value = emoji;
  _renderIconPresets(emoji);
}
function syncIconPresets() {
  _renderIconPresets(document.getElementById('ceIcon').value.trim());
}

function openCategoryEditor(id) {
  const c = id ? _categoriesCache.find(x => x.id === id) : null;
  const locked = !!c?.is_locked;
  document.getElementById('categoryEditorTitle').textContent = c ? I18N.t('cat.editorEdit') : I18N.t('cat.editorAdd');

  // site note
  const siteId = c?.site_id ?? _catSiteId;
  const site = _catSites.find(s => s.id === siteId);
  const siteNote = document.getElementById('ceSiteNote');
  if (siteNote) {
    siteNote.style.display = site ? '' : 'none';
    const sn = document.getElementById('ceSiteName');
    if (sn) sn.textContent = site ? site.name : '';
  }

  document.getElementById('ceCatId').value = c ? c.id : '';
  document.getElementById('ceLockToggle').checked = locked;
  document.getElementById('ceName').value  = c?.name  || '';
  document.getElementById('ceIcon').value  = c?.icon  || '';
  document.getElementById('ceColor').value = (c?.color && /^#[0-9a-f]{6}$/i.test(c.color)) ? c.color : '#5b8def';
  document.getElementById('ceSort').value  = c?.sort_order ?? 0;
  document.getElementById('ceName').disabled = locked;
  document.getElementById('ceIcon').disabled = locked;
  document.getElementById('ceNameLockNote').style.display = locked ? 'block' : 'none';
  document.querySelectorAll('#ceIconPresets .icon-preset-btn').forEach(b => b.disabled = locked);
  _renderIconPresets(c?.icon || '');
  document.getElementById('categoryEditorModal').classList.remove('hidden');
}
function closeCategoryEditor() {
  document.getElementById('categoryEditorModal').classList.add('hidden');
}

async function saveCategory() {
  const id   = document.getElementById('ceCatId').value;
  const name = document.getElementById('ceName').value.trim();
  const icon = document.getElementById('ceIcon').value.trim();
  const color = document.getElementById('ceColor').value;
  const sort_order = parseInt(document.getElementById('ceSort').value, 10) || 0;
  if (!name) return alert(I18N.t('cat.needName'));
  if (!id && !_catSiteId) return alert(I18N.t('cat.needSite') || 'กรุณาเลือก Site ก่อนสร้างหมวดหมู่');
  const is_locked = document.getElementById('ceLockToggle').checked;
  const payload = { name, icon, color, sort_order, is_locked };
  if (!id) payload.site_id = _catSiteId;
  const body = JSON.stringify(payload);
  const url    = id ? `${API}/api/categories/${id}` : `${API}/api/categories`;
  const method = id ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    closeCategoryEditor();
    await loadCategories();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

async function deleteCategory(id) {
  const c = _categoriesCache.find(x => x.id === id);
  if (!c) return;
  if (c.is_locked) return alert(I18N.t('cat.builtinNoDelete'));
  if (!confirm(I18N.t('cat.confirmDelete').replace('{name}', c.name))) return;
  try {
    const res = await fetch(`${API}/api/categories/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await loadCategories();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}

// ── Mapping Rules ───────────────────────────────────────────
async function openCategoryRules(catId) {
  const c = _categoriesCache.find(x => x.id === catId);
  document.getElementById('crCatId').value = catId;
  document.getElementById('catRulesTitle').textContent = `Mapping Rules — ${c ? (`${c.icon || ''} ${c.name}`.trim()) : ''}`;
  // populate camera picker — scoped to the category's site (a site-specific
  // category only maps its own site's cameras; a global category maps any).
  // MultiPicker (search + multi-select + select-all/clear) — 0 selected = "any
  // camera" (matches the old single "* any" option); N selected = the Add
  // button below creates one rule per selected camera in a single click,
  // instead of repeating the whole pick-one/Add cycle per camera.
  _crCamListFull = siteScopedCams((typeof cameras !== 'undefined' ? cameras : []), c?.site_id || null);
  const camTypeSel = document.getElementById('crCamType');
  if (camTypeSel) {
    camTypeSel.value = '';
    if (!camTypeSel._crWired) {
      camTypeSel.addEventListener('change', _renderCrCameraOptions);
      camTypeSel._crWired = true;
    }
  }
  _renderCrCameraOptions();
  // reset form
  document.getElementById('crRule').value = '';
  document.getElementById('crEventType').value = '';
  document.getElementById('crObjClass').value = '';
  { const el = document.getElementById('crVehicleType'); if (el) el.value = ''; }
  document.getElementById('crState').value = 'true';
  document.getElementById('crPri').value = 0;
  await Promise.all([loadCategoryRules(), loadFacets()]);
  document.getElementById('categoryRulesModal').classList.remove('hidden');
}

// Rebuild the crCamera picker from _crCamListFull, narrowed by crCamType
// (all/standard/lpr/face) — re-run on every type-filter change.
function _renderCrCameraOptions() {
  const camSel = document.getElementById('crCamera');
  if (!camSel) return;
  const typeFilter = document.getElementById('crCamType')?.value || '';
  const list = typeFilter
    ? _crCamListFull.filter(cam => (cam.cam_role || 'standard') === typeFilter)
    : _crCamListFull;
  camSel.innerHTML = '';
  list.forEach(cam => {
    const id = cam.camera_id || cam.id;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id} (${cam.camera_name || cam.name || ''})`;
    camSel.appendChild(opt);
  });
  if (typeof MultiPicker !== 'undefined') MultiPicker.refresh('crCamera');
}


// Populate <datalist> for rule_name + event_type from real DB values.
// Optionally narrow to the camera currently picked in the form.
async function loadFacets() {
  // narrow the datalist by camera only when exactly one is picked — with 0 or
  // several selected there's no single camera to scope by, so show all values.
  const camIds = (typeof MultiPicker !== 'undefined') ? MultiPicker.values('crCamera') : [];
  const camId = camIds.length === 1 ? camIds[0] : '';
  const url = camId
    ? `${API}/api/events/facets?camera_id=${encodeURIComponent(camId)}`
    : `${API}/api/events/facets`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const f = await res.json();
    const fill = (id, items) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = (items || []).map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
    };
    fill('ruleNamesList',  f.rule_names);
    fill('eventTypesList', f.event_types);
    _fillObjClassOptions(f.object_classes);
    _fillVehicleTypeOptions(f.vehicle_types);
  } catch (e) { console.warn('loadFacets:', e.message); }
}

// Object Class select — real distinct values seen in `events` (not a static
// guess list). Kept flat (no synthetic "Vehicle" parent grouping): the rule
// matcher does exact string equality against events.object_class (see
// src/routes/stats.js), so offering a parent value here would create rules
// that silently don't match the child classes a user expects.
function _fillObjClassOptions(classes) {
  const el = document.getElementById('crObjClass');
  if (!el || !Array.isArray(classes)) return;
  const cur = el.value;
  el.innerHTML = `<option value="">* (any)</option>` +
    classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (classes.includes(cur)) el.value = cur;
}

// Vehicle-type select — LPR sub-types seen in license_plates (facet). Labels go
// through _lprVType() (page-lpr.js) so raw codes like 'threeWheelVehicle' never
// show; value stays the raw code (what the rule matcher compares).
function _fillVehicleTypeOptions(vtypes) {
  const el = document.getElementById('crVehicleType');
  if (!el || !Array.isArray(vtypes)) return;
  const cur = el.value;
  const label = c => (typeof _lprVType === 'function' ? _lprVType(c) : c) || c;
  el.innerHTML = `<option value="">* (any)</option>` +
    vtypes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(label(c))}</option>`).join('');
  if (vtypes.includes(cur)) el.value = cur;
}
function closeCategoryRules() {
  document.getElementById('categoryRulesModal').classList.add('hidden');
  loadCategories();  // refresh rule_count badges
}

async function loadCategoryRules() {
  const catId = document.getElementById('crCatId').value;
  const list  = document.getElementById('categoryRulesList');
  const delAllBtn = document.getElementById('deleteAllCatRulesBtn');
  if (!list) return;
  if (!catId) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--status-bad)">${escapeHtml(I18N.t('cat.ruleIdMissing'))}</div>`;
    return;
  }
  try {
    const res = await fetch(`${API}/api/categories/${encodeURIComponent(catId)}/rules?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
    }
    const rules = await res.json();
    console.log(`[Rules] cat=${catId} count=${Array.isArray(rules) ? rules.length : '?'}`, rules);
    if (!Array.isArray(rules)) {
      throw new Error('unexpected response (not an array)');
    }
    _catRulesCache = rules;
    if (delAllBtn) delAllBtn.disabled = !rules.length;
    if (!rules.length) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-secondary)">
        ${escapeHtml(I18N.t('cat.noRules'))}
        <div style="font-size:10px;margin-top:6px;opacity:0.6">category id = ${escapeHtml(catId)}</div>
      </div>`;
      return;
    }

    // Bulk-add (addCategoryRule) creates one rule per selected camera, all
    // sharing the same rule_name/event_type/object_class/state/priority — with
    // a large fleet that's dozens of near-identical rows. Group by that
    // signature so they collapse into one expandable row instead of a wall of
    // duplicates (a lone/manually-added rule renders exactly as before).
    const w = v => v == null || v === '' ? '<span style="color:var(--text-secondary)">*</span>' : escapeHtml(v);
    const objCell = s => {
      const base = w(s.object_class);
      if (!s.vehicle_type) return base;
      const vl = (typeof _lprVType === 'function' ? _lprVType(s.vehicle_type) : s.vehicle_type) || s.vehicle_type;
      return `${base} · <span style="color:var(--accent)">${escapeHtml(vl)}</span>`;
    };
    const groups = new Map();
    rules.forEach(r => {
      const key = [r.rule_name, r.event_type, r.object_class, r.vehicle_type, r.match_state, r.priority]
        .map(v => v == null ? ' ' : v).join('');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    const rowsHtml = [...groups.values()].map(grp => {
      const s = grp[0];
      if (grp.length === 1) {
        return `
        <div class="cat-rule-grid" style="padding:9px 12px;border-bottom:1px solid var(--border-hairline);font-size:11px">
          <div class="cat-rule-list-cell">${w(s.camera_id)}</div>
          <div class="cat-rule-list-cell">${w(s.rule_name)}</div>
          <div class="cat-rule-list-cell">${w(s.event_type)}</div>
          <div class="cat-rule-list-cell">${objCell(s)}</div>
          <div class="cat-rule-list-cell">${w(s.match_state)}</div>
          <div class="cat-rule-list-cell">${s.priority}</div>
          <div><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px" data-action="deleteCatRule" data-id="${s.id}">🗑️</button></div>
        </div>`;
      }
      const ids = grp.map(r => r.id).join(',');
      const gid = `catGrp${s.id}`;
      return `
        <div class="cat-rule-grid" data-action="toggleCatRuleGroup" data-group="${gid}" style="cursor:pointer;padding:9px 12px;border-bottom:1px solid var(--border-hairline);font-size:11px;background:var(--surface-overlay)">
          <div class="cat-rule-list-cell">▾ <b>${grp.length}</b> ${escapeHtml(I18N.t('cat.camerasUnit'))}</div>
          <div class="cat-rule-list-cell">${w(s.rule_name)}</div>
          <div class="cat-rule-list-cell">${w(s.event_type)}</div>
          <div class="cat-rule-list-cell">${objCell(s)}</div>
          <div class="cat-rule-list-cell">${w(s.match_state)}</div>
          <div class="cat-rule-list-cell">${s.priority}</div>
          <div><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px;color:var(--status-bad)" data-action="deleteCatRuleGroup" data-ids="${ids}" data-count="${grp.length}" title="${escapeHtml(I18N.t('cat.deleteGroup'))}">🗑️×${grp.length}</button></div>
        </div>
        <div class="cat-rule-group-body hidden" id="${gid}">${grp.map(r => `
          <div class="cat-rule-grid" style="padding:6px 12px 6px 26px;border-bottom:1px solid var(--border-hairline);font-size:11px;opacity:.85">
            <div class="cat-rule-list-cell">${w(r.camera_id)}</div>
            <div></div><div></div><div></div><div></div><div></div>
            <div><button class="btn btn-secondary" style="font-size:10px;padding:3px 7px" data-action="deleteCatRule" data-id="${r.id}">🗑️</button></div>
          </div>`).join('')}</div>`;
    }).join('');

    list.innerHTML = `
      <div class="cat-rule-grid cat-rule-head" style="padding:10px 12px;background:var(--surface-overlay);font-size:10px;color:var(--text-secondary);border-bottom:1px solid var(--border-hairline)">
        <div>Camera</div><div>Rule</div><div>Event Type</div><div>Object Class</div><div>State</div><div>Pri</div><div></div>
      </div>
    ` + rowsHtml;
  } catch (e) {
    console.error('loadCategoryRules:', e);
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--status-bad)">
      ${escapeHtml(I18N.t('cat.rulesLoadFailed'))}${escapeHtml(e.message || String(e))}
      <div style="font-size:10px;margin-top:6px;opacity:0.7">category id = ${escapeHtml(catId)}</div>
    </div>`;
  }
}

function toggleCatRuleGroup(groupId) {
  document.getElementById(groupId)?.classList.toggle('hidden');
}

async function deleteCategoryRuleGroup(ids, count) {
  if (!confirm(I18N.t('cat.confirmDeleteGroup').replace('{n}', count))) return;
  try {
    await Promise.allSettled(ids.map(id => fetch(`${API}/api/category-rules/${id}`, { method: 'DELETE' })));
    await loadCategoryRules();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function deleteAllCategoryRules() {
  if (!_catRulesCache.length) return;
  if (!confirm(I18N.t('cat.confirmDeleteAllRules').replace('{n}', _catRulesCache.length))) return;
  try {
    await Promise.allSettled(_catRulesCache.map(r => fetch(`${API}/api/category-rules/${r.id}`, { method: 'DELETE' })));
    await loadCategoryRules();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function addCategoryRule() {
  const catId = document.getElementById('crCatId').value;
  const btn   = document.querySelector('#categoryRulesModal button.btn-primary');
  const camIds = (typeof MultiPicker !== 'undefined') ? MultiPicker.values('crCamera') : [];
  // 0 selected = the old "* any" wildcard rule (single row, camera_id='').
  // N selected = one rule per camera in one click — this is the whole point:
  // no more repeating pick-one/Add for every camera in a long fleet.
  const targets = camIds.length ? camIds : [''];
  const base = {
    rule_name:    document.getElementById('crRule').value.trim(),
    event_type:   document.getElementById('crEventType').value.trim(),
    object_class: document.getElementById('crObjClass').value,
    vehicle_type: document.getElementById('crVehicleType').value,
    match_state:  document.getElementById('crState').value,
    priority:     parseInt(document.getElementById('crPri').value, 10) || 0,
  };
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  console.log(`[Rule Add] cat=${catId} cameras=${targets.length} base=${JSON.stringify(base)}`);
  try {
    const results = await Promise.allSettled(targets.map(camera_id =>
      fetch(`${API}/api/categories/${catId}/rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_id, ...base }),
      }).then(async res => {
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
        return res.json();
      })
    ));
    const failed = results.filter(r => r.status === 'rejected');
    console.log(`[Rule Add] ${targets.length - failed.length}/${targets.length} ok`, failed);
    document.getElementById('crRule').value = '';
    document.getElementById('crEventType').value = '';
    await loadCategoryRules();
    invalidateStats();             // refresh KPIs/charts when stats page next opens
    if (btn) {
      if (failed.length) {
        btn.textContent = '+ Add';
        alert(`${I18N.t('cat.addRuleFailed')}${targets.length - failed.length}/${targets.length} — ${failed[0].reason?.message || ''}`);
      } else {
        btn.textContent = targets.length > 1 ? `✓ Added (${targets.length})` : '✓ Added';
        setTimeout(() => { btn.textContent = '+ Add'; }, 900);
      }
      btn.disabled = false;
    }
  } catch (e) {
    if (btn) { btn.textContent = '+ Add'; btn.disabled = false; }
    alert(I18N.t('cat.addRuleFailed') + e.message);
  }
}

async function deleteCategoryRule(ruleId) {
  if (!confirm(I18N.t('cat.confirmDeleteRule'))) return;
  try {
    await fetch(`${API}/api/category-rules/${ruleId}`, { method: 'DELETE' });
    await loadCategoryRules();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

// Mark Stats page as needing a refresh — runs immediately if Stats is the
// active page (so the user sees their change reflected without clicking
// a period button), otherwise the refresh happens next time they switch
// to Stats. activePage / loadStats are defined elsewhere in this file.
function invalidateStats() {
  if (typeof activePage !== 'undefined' && activePage === 'stats' && typeof loadStats === 'function') {
    loadStats();
  }
}
