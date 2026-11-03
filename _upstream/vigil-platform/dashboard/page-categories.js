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
let _crEditing = null;     // {ids, cams} — โหมดแก้ rule: สร้างชุดใหม่สำเร็จก่อน แล้วค่อยลบชุดเดิม

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

// ปุ่ม "ลบทั้งหมด" — ลบหมวดทุกใบที่แสดงอยู่ (ตามขอบเขต Site ที่เลือก) เพื่อเริ่ม
// สร้างชุดใหม่ (เจ้าของสั่ง 2026-08-29) · ตาม pattern ของ wlPurge ในหน้า LPR:
// บอกจำนวน+ขอบเขตให้เห็นก่อน แล้วต้องพิมพ์ CONFIRM · rules ในหมวดหายตามหมวด
async function catDeleteAll() {
  const all = _categoriesCache || [];
  const rows = all.filter((c) => !c.is_locked);
  const locked = all.length - rows.length;
  if (!rows.length) { alert(I18N.t('cat.delAllEmpty')); return; }
  const site = _catSiteId ? _catSites.find((s) => s.id === _catSiteId) : null;
  const typed = prompt(
    `${I18N.t('cat.delAllWarn')}\n\n` +
    `${I18N.t('cat.delAllCount')}: ${rows.length} ` +
    (site ? `(Site: ${site.name})` : I18N.t('cat.delAllAllSites')) + '\n' +
    (locked ? `${I18N.t('cat.delAllLocked')}: ${locked}\n` : '') +
    `\n${I18N.t('blset.typeConfirm')}`);
  if (typed !== 'CONFIRM') return;
  try {
    const r = await fetch(`${API}/api/categories/bulk-delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ ids: rows.map((c) => c.id), confirm: 'CONFIRM' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    alert(`${I18N.t('cat.delAllDone')} ${j.deleted}`);
    loadCategories();
    invalidateStats();
  } catch (e) { alert(`${I18N.t('cat.delAllFail')}: ${e.message}`); }
}

async function loadCategories() {
  await _initCatScopeBar();
  _updateCatBackupRestoreUI();
  // dropdown กลุ่มบนหน้าสถิติ (migration 183) — ผูกครั้งเดียวบน container
  const listEl = document.getElementById('categoriesList');
  if (listEl && !listEl._grpWired) {
    listEl._grpWired = true;
    listEl.addEventListener('change', async (e) => {
      const sel = e.target.closest('.cat-group-sel');
      if (!sel) return;
      try {
        const res = await fetch(`${API}/api/categories/${sel.dataset.catid}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stat_group: sel.value || null }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        invalidateStats();
      } catch (err) { alert(I18N.t('common.saveFailed') + err.message); loadCategories(); }
    });
  }
  try {
    const siteQ = _catSiteId ? `?site_id=${_catSiteId}` : '';
    const res = await fetch(`${API}/api/categories${siteQ}`);
    if (!res.ok) throw new Error('Failed to load');
    _categoriesCache = await res.json();
    renderCategoriesList();
    loadCatDiscovery();   // แผง rule ที่ยังไม่ถูก map — ~5s ไม่บล็อกรายการหมวด
  } catch (e) { console.error('loadCategories:', e); }
}

// ── Rule Discovery — rule บนกล้องที่ยิง event จริงแต่ยังไม่มีหมวดรับ ─────────
// endpoint: /api/categories/rule-discovery (LATERAL 2,000 เหตุการณ์ล่าสุด/กล้อง)
// จับคู่ฝั่งนี้ด้วย wildcard matcher ชุดเดียวกับของจริง — ต้องเทียบ vehicle_type
// เสมอ (หมวด LPR ตั้ง rule ด้วย vehicle_type ล้วน ข้ามแล้วทุกอย่างดูเหมือน map แล้ว)
// rule ที่ระบบมีท่อของตัวเองรับอยู่แล้ว ไม่ต้องสร้างหมวดมารับ จึงไม่ใช่ "สถิติเงียบ"
// แบบ rule อื่นในรายการนี้ · ทั้งสองกลุ่มกินรายการจนล้น (ที่ hkt ใบหน้าอย่างเดียว
// 69 กล้อง × 2,000 event) ⇒ ซ่อนเป็นค่าเริ่มต้น เปิดดูได้เมื่อต้องการ (เจ้าของสั่ง
// 2026-09-04 — opt-in ทั้งคู่)
//   ป้ายทะเบียน = anprAlarm       → นับผ่านการ์ดยานพาหนะ (license_plates)
//   ใบหน้า      = FaceCapture / FaceDetector/* / FaceRecognition → มีหน้าใบหน้าของตัวเอง
const _CAT_DISC_KEYS = { lpr: 'vigil_cat_disc_lpr', face: 'vigil_cat_disc_face' };
const _catDiscShow = {
  lpr:  localStorage.getItem(_CAT_DISC_KEYS.lpr) === '1',
  face: localStorage.getItem(_CAT_DISC_KEYS.face) === '1',
};
const _catAutoKind = (c) => (c.event_type === 'anprAlarm' ? 'lpr'
  : /^Face/i.test(c.event_type || '') ? 'face' : null);
function catDiscToggleAuto(kind, on) {
  if (!(kind in _catDiscShow)) return;
  _catDiscShow[kind] = !!on;
  localStorage.setItem(_CAT_DISC_KEYS[kind], on ? '1' : '0');
  loadCatDiscovery();          // ใช้ combos ที่โหลดไว้แล้ว ไม่ยิง endpoint ซ้ำ
}

let _catDiscCombos = null;
const _CAT_COLORS = ['#e05d44', '#3564d6', '#1d9d57', '#d68a1f', '#8b5cf6', '#0ea5b7',
  '#d6456f', '#6b8e23', '#f59e0b', '#2563eb', '#10b981', '#c2410c', '#7c3aed', '#0891b2'];
async function _catAllRules() {
  const withRules = _categoriesCache.filter(c => c.rule_count > 0);
  const map = new Map();
  for (let i = 0; i < withRules.length; i += 8) {
    await Promise.all(withRules.slice(i, i + 8).map(async (c) => {
      try {
        const r = await fetch(`${API}/api/categories/${c.id}/rules`);
        map.set(c.id, r.ok ? await r.json() : []);
      } catch { map.set(c.id, []); }
    }));
  }
  return map;
}
function _comboMapped(combo, ruleMap) {
  for (const rules of ruleMap.values()) {
    for (const r of rules) {
      if ((!r.camera_id || r.camera_id === combo.camera_id)
        && (!r.rule_name || r.rule_name === combo.rule_name)
        && (!r.event_type || r.event_type === combo.event_type)
        && (!r.object_class || r.object_class === combo.object_class)
        && (!r.vehicle_type || r.vehicle_type === combo.vehicle_type)) return true;
    }
  }
  return false;
}
async function loadCatDiscovery(force) {
  const box = document.getElementById('catDiscovery');
  const list = document.getElementById('catDiscList');
  if (!box || !list) return;
  try {
    if (force || !_catDiscCombos) {
      box.style.display = '';
      list.innerHTML = `<div style="padding:10px;font-size:11px;color:var(--text-secondary)">${escapeHtml(I18N.t('cat.discScanning'))}</div>`;
      const r = await fetch(`${API}/api/categories/rule-discovery`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _catDiscCombos = (await r.json()).combos;
    }
    const ruleMap = await _catAllRules();
    Object.entries({ lpr: 'catDiscLpr', face: 'catDiscFace' }).forEach(([k, id]) => {
      const box = document.getElementById(id);
      if (box) box.checked = _catDiscShow[k];
    });
    const un = _catDiscCombos
      .filter(c => !_catSiteId || c.site_id === _catSiteId)
      .filter(c => { const k = _catAutoKind(c); return !k || _catDiscShow[k]; })
      .filter(c => !_comboMapped(c, ruleMap))
      .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    document.getElementById('catDiscCount').textContent = un.length ? `(${un.length})` : '';
    if (!un.length) {
      list.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--status-ok)">${escapeHtml(I18N.t('cat.discEmpty'))}</div>`;
      return;
    }
    const CAP = 20;
    _catDiscShown = un.slice(0, CAP);
    const age = (t) => {
      const h = Math.round((Date.now() - new Date(t)) / 3600e3);
      return h < 1 ? I18N.t('cat.discThisHour') : h < 24 ? `${h} ${I18N.t('cat.discHrsAgo')}` : `${Math.round(h / 24)} ${I18N.t('cat.discDaysAgo')}`;
    };
    list.innerHTML = _catDiscShown.map((c, i) => `
      <div class="cat-disc-row">
        <span style="font-weight:600;color:var(--text-primary)">${escapeHtml(c.rule_name || c.event_type || '?')}</span>
        <span style="color:var(--text-secondary)">${escapeHtml(c.camera_id)}</span>
        <span style="color:var(--text-secondary)">${c.object_class ? `class=${escapeHtml(c.object_class)} · ` : ''}${c.vehicle_type ? `vtype=${escapeHtml(c.vehicle_type)} · ` : ''}${Number(c.n).toLocaleString()} · ${age(c.last_seen)}</span>
        <button class="btn btn-primary" style="font-size:10px;padding:4px 9px" data-action="catDiscCreate" data-i="${i}">${escapeHtml(I18N.t('cat.discCreate'))}</button>
      </div>`).join('')
      + (un.length > CAP ? `<div style="padding:6px 10px;font-size:10px;color:var(--text-secondary)">${CAP} / ${un.length}</div>` : '');
  } catch (e) {
    list.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--status-bad)">${escapeHtml(e.message)}</div>`;
  }
}
let _catDiscShown = [];
async function catDiscCreate(i) {
  const c = _catDiscShown[i];
  if (!c) return;
  const name = (c.rule_name || c.event_type || '').trim();
  if (!name) return alert(I18N.t('cat.discNoName'));
  if (!confirm(I18N.t('cat.discConfirm').replace('{name}', name).replace('{cam}', c.camera_id))) return;
  try {
    // ชื่อซ้ำในไซต์เดียวกัน → ไม่สร้างซ้ำ เอา rule เข้าหมวดเดิม
    let cat = _categoriesCache.find(x => x.name === name && x.site_id === c.site_id);
    if (!cat) {
      const used = new Set(_categoriesCache.map(x => (x.color || '').toLowerCase()));
      const color = _CAT_COLORS.find(x => !used.has(x)) || _CAT_COLORS[_categoriesCache.length % _CAT_COLORS.length];
      const res = await fetch(`${API}/api/categories`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, sort_order: 0, site_id: c.site_id }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
      cat = await res.json();
    }
    const res2 = await fetch(`${API}/api/categories/${cat.id}/rules`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: c.camera_id, rule_name: c.rule_name || '',
        event_type: c.event_type || '', object_class: c.object_class || '',
        vehicle_type: c.vehicle_type || '', match_state: '', priority: 0 }) });
    if (!res2.ok) { const err = await res2.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res2.status}`); }
    await loadCategories();
    invalidateStats();
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
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
    const g = c.stat_group || '';
    const gOpt = (v, key) => `<option value="${v}" ${g === v ? 'selected' : ''}>${escapeHtml(I18N.t(key))}</option>`;
    return `
      <div class="cat-list-row">
        <!-- จุดสีแทน emoji (decision #144) — ค่า icon ใน DB คงอยู่ ไม่ถูกแตะ -->
        <div style="display:flex;justify-content:center"><span style="width:14px;height:14px;border-radius:50%;background:${escapeHtml(c.color || '#5b8def')}"></span></div>
        <div>
          <div style="font-weight:600;color:var(--text-primary)">${lockIcon}${escapeHtml(c.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary)">sort: ${c.sort_order}</div>
        </div>
        <div class="cat-col-kind">${kindBadge}</div>
        <div class="cat-col-group"><select class="cat-group-sel" data-catid="${c.id}"
            title="${escapeHtml(I18N.t('cat.groupTitle'))}"
            style="width:100%;font-size:11px;padding:4px 6px;border-radius:6px;border:1px solid var(--border-hairline);background:var(--surface-elevated);color:var(--text-primary)">
          ${gOpt('', 'cat.groupAuto')}${gOpt('vehicle', 'cat.groupVehicle')}${gOpt('people', 'cat.groupPeople')}${gOpt('identify', 'cat.groupIdentify')}${gOpt('watch', 'cat.groupWatch')}${gOpt('standalone', 'cat.groupStandalone')}
        </select></div>
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

// (2026-08-29) icon emoji ถูกถอดจากฟอร์มตาม demo (decision #144) — ไม่ส่ง field icon
// อีกต่อไป ค่าเดิมใน DB คงอยู่ (PUT ฝั่ง server ใช้ icon ?? ค่าเดิม)

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
  document.getElementById('ceColor').value = (c?.color && /^#[0-9a-f]{6}$/i.test(c.color)) ? c.color : '#5b8def';
  document.getElementById('ceSort').value  = c?.sort_order ?? 0;
  document.getElementById('ceName').disabled = locked;
  document.getElementById('ceNameLockNote').style.display = locked ? 'block' : 'none';
  // สี: หมวดใหม่ = อัตโนมัติ (กันซ้ำ — condition อยู่ใน saveCategory) ปรับได้ทีหลังตอนแก้ไข
  document.getElementById('ceColor').style.display = c ? '' : 'none';
  document.getElementById('ceColorAuto').style.display = c ? 'none' : 'block';
  document.getElementById('categoryEditorModal').classList.remove('hidden');
}
function closeCategoryEditor() {
  document.getElementById('categoryEditorModal').classList.add('hidden');
}

async function saveCategory() {
  const id   = document.getElementById('ceCatId').value;
  const name = document.getElementById('ceName').value.trim();
  const sort_order = parseInt(document.getElementById('ceSort').value, 10) || 0;
  if (!name) return alert(I18N.t('cat.needName'));
  if (!id && !_catSiteId) return alert(I18N.t('cat.needSite') || 'กรุณาเลือก Site ก่อนสร้างหมวดหมู่');
  const is_locked = document.getElementById('ceLockToggle').checked;
  // สีหมวดใหม่ = อัตโนมัติ: เลือกตัวแรกใน palette ที่ยังไม่ถูกใช้ · ต้องเทียบกับ
  // หมวด **ทุกไซต์** ไม่ใช่แค่ไซต์ที่เลือกอยู่ — หน้าสถิติแสดงรวมทุกไซต์ สีที่ว่าง
  // ในไซต์นี้อาจชนกับการ์ด/เส้นกราฟของไซต์อื่น (เจอจริงตอน verify: ได้ #e05d44
  // ซ้ำกับหมวดไซต์อื่น) · หมด palette ค่อยวนซ้ำ modulo · แก้ไข = ใช้ค่าจาก picker
  let color = document.getElementById('ceColor').value;
  if (!id) {
    let allCats = _categoriesCache;
    try {
      const r = await fetch(`${API}/api/categories`);
      if (r.ok) allCats = await r.json();
    } catch { /* เน็ตสะดุดก็ยังได้ dedupe ระดับไซต์จาก cache */ }
    const used = new Set(allCats.map(x => (x.color || '').toLowerCase()));
    color = _CAT_COLORS.find(x => !used.has(x)) || _CAT_COLORS[allCats.length % _CAT_COLORS.length];
  }
  const payload = { name, color, sort_order, is_locked };
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
  document.getElementById('catRulesTitle').textContent = `Mapping Rules — ${c ? c.name : ''}`;
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
  _crCancelEdit();
  // loadFacets() hits /api/events/facets, an unbounded DISTINCT scan over the
  // whole events table (no time filter, by design — mapping rules need every
  // rule_name/object_class ever seen, not just recent ones) — measured 11s+
  // on real data. Awaiting it before showing the modal made every click feel
  // stuck. The rules list is on an indexed, tiny table (event_category_rules)
  // and stays awaited so it's already in place when the modal appears; facets
  // only feed a <datalist> autocomplete, so they can populate after the modal
  // is already visible and usable.
  await loadCategoryRules();
  document.getElementById('categoryRulesModal').classList.remove('hidden');
  loadFacets();
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
}


// Populate <datalist> for rule_name + event_type from real DB values.
// Optionally narrow to the camera currently picked in the form.
async function loadFacets() {
  // narrow the datalist by camera only when exactly one is picked — with 0 or
  // several selected there's no single camera to scope by, so show all values.
  const camIds = [...(document.getElementById('crCamera')?.selectedOptions || [])].map(o => o.value);
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
        .map(v => v == null ? '\0' : v).join('\x01');
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
          <div style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px" data-action="editCatRule" data-ids="${s.id}">${escapeHtml(I18N.t('cat.editRule'))}</button><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px" data-action="deleteCatRule" data-id="${s.id}">${escapeHtml(I18N.t('cat.delRule'))}</button></div>
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
          <div style="display:flex;gap:4px;justify-content:flex-end"><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px" data-action="editCatRule" data-ids="${ids}">${escapeHtml(I18N.t('cat.editRule'))}</button><button class="btn btn-secondary" style="font-size:10px;padding:4px 8px;color:var(--status-bad)" data-action="deleteCatRuleGroup" data-ids="${ids}" data-count="${grp.length}" title="${escapeHtml(I18N.t('cat.deleteGroup'))}">${escapeHtml(I18N.t('cat.delRule'))} ×${grp.length}</button></div>
        </div>
        <div class="cat-rule-group-body hidden" id="${gid}">${grp.map(r => `
          <div class="cat-rule-grid" style="padding:6px 12px 6px 26px;border-bottom:1px solid var(--border-hairline);font-size:11px;opacity:.85">
            <div class="cat-rule-list-cell">${w(r.camera_id)}</div>
            <div></div><div></div><div></div><div></div><div></div>
            <div><button class="btn btn-secondary" style="font-size:10px;padding:3px 7px" data-action="deleteCatRule" data-id="${r.id}">${escapeHtml(I18N.t('cat.delRule'))}</button></div>
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

// เริ่มแก้ rule: เติมค่า signature เดิมลงฟอร์ม · กล้องใช้ชุดเดิมของ rule นั้น
// (ไม่แตะ MultiPicker — เปลี่ยนกล้อง = ลบแล้วเพิ่มใหม่ตามเดิม)
function startEditCatRule(ids) {
  const grp = _catRulesCache.filter(r => ids.includes(r.id));
  if (!grp.length) return;
  const sRule = grp[0];
  const ensure = (id, val) => {
    if (!val) return;
    const el = document.getElementById(id);
    if (el && ![...el.options].some(o => o.value === val)) {
      const o = document.createElement('option'); o.value = val; o.textContent = val; el.appendChild(o);
    }
  };
  document.getElementById('crRule').value = sRule.rule_name || '';
  document.getElementById('crEventType').value = sRule.event_type || '';
  ensure('crObjClass', sRule.object_class);
  ensure('crVehicleType', sRule.vehicle_type);
  document.getElementById('crObjClass').value = sRule.object_class || '';
  { const el = document.getElementById('crVehicleType'); if (el) el.value = sRule.vehicle_type || ''; }
  document.getElementById('crState').value = sRule.match_state ?? '';
  document.getElementById('crPri').value = sRule.priority ?? 0;
  _crEditing = { ids, cams: grp.map(r => r.camera_id || '') };
  document.getElementById('crEditBar').style.display = 'flex';
  const btn = document.getElementById('addCategoryRuleBtn');
  if (btn) btn.textContent = I18N.t('cat.editSaveReplace');
}
function _crCancelEdit() {
  _crEditing = null;
  const bar = document.getElementById('crEditBar');
  if (bar) bar.style.display = 'none';
  const btn = document.getElementById('addCategoryRuleBtn');
  if (btn) btn.textContent = I18N.t('cat.addRule');
}

async function addCategoryRule() {
  const catId = document.getElementById('crCatId').value;
  const btn   = document.querySelector('#categoryRulesModal button.btn-primary');
  const camIds = [...(document.getElementById('crCamera')?.selectedOptions || [])].map(o => o.value);
  // 0 selected = the old "* any" wildcard rule (single row, camera_id='').
  // N selected = one rule per camera in one click — this is the whole point:
  // no more repeating pick-one/Add for every camera in a long fleet.
  // โหมดแก้ (_crEditing): ใช้กล้องชุดเดิมของ rule ที่แก้ ไม่อ่านจาก picker
  const editing = _crEditing;
  const targets = editing ? editing.cams : (camIds.length ? camIds : ['']);
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
    if (editing && !failed.length) {
      // ชุดใหม่ครบแล้วจึงลบชุดเดิม — พลาดกลางทางของเดิมยังอยู่ ไม่มีจังหวะ rule หาย
      await Promise.allSettled(editing.ids.map(id =>
        fetch(`${API}/api/category-rules/${id}`, { method: 'DELETE' })));
      _crCancelEdit();
    }
    document.getElementById('crRule').value = '';
    document.getElementById('crEventType').value = '';
    await loadCategoryRules();
    invalidateStats();             // refresh KPIs/charts when stats page next opens
    if (btn) {
      if (failed.length) {
        btn.textContent = I18N.t('cat.addRule');
        alert(`${I18N.t('cat.addRuleFailed')}${targets.length - failed.length}/${targets.length} — ${failed[0].reason?.message || ''}`);
      } else {
        btn.textContent = `${I18N.t('cat.added')} (${targets.length})`;
        setTimeout(() => { btn.textContent = I18N.t('cat.addRule'); }, 900);
      }
      btn.disabled = false;
    }
  } catch (e) {
    if (btn) { btn.textContent = I18N.t('cat.addRule'); btn.disabled = false; }
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

// ── Backup / Restore ────────────────────────────────────────────
// Show/hide backup/restore buttons based on site selection
function _updateCatBackupRestoreUI() {
  const backupBtn = document.getElementById('catBackupBtn');
  const restoreBtn = document.getElementById('catRestoreBtn');
  if (backupBtn) backupBtn.style.display = _catSiteId ? '' : 'none';
  if (restoreBtn) restoreBtn.style.display = _catSiteId ? '' : 'none';
}

async function catBackup() {
  if (!_catSiteId) return;
  const site = _catSites.find((s) => s.id === _catSiteId);
  if (!site) return;
  try {
    const res = await fetch(`${API}/api/categories/backup?site_id=${_catSiteId}`, { cache: 'no-store' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vigil-categories-${site.code || site.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert(`${I18N.t('common.error')}: ${e.message}`); }
}

async function catRestore() {
  if (!_catSiteId) return;
  const site = _catSites.find((s) => s.id === _catSiteId);
  if (!site) return;
  const fileInput = document.getElementById('catRestoreFile');
  if (!fileInput) return;
  fileInput.value = '';
  fileInput.click();
  fileInput.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version || !Array.isArray(data.categories)) {
        throw new Error(I18N.t('cat.restoreBadFile'));
      }
      const msg = I18N.t('cat.restoreConfirm')
        .replace('{n}', data.categories.length)
        .replace('{m}', data.categories.reduce((s, c) => s + (c.rules?.length || 0), 0))
        .replace('{site}', site.name);
      if (!confirm(msg)) return;
      const res = await fetch(`${API}/api/categories/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: _catSiteId, mode: 'replace', data }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      alert(I18N.t('cat.restoreDone')
        .replace('{c}', j.created)
        .replace('{u}', j.updated)
        .replace('{d}', j.deleted)
        .replace('{r}', j.rules));
      await loadCategories();
      invalidateStats();
    } catch (err) { alert(`${I18N.t('common.error')}: ${err.message}`); }
  };
}
