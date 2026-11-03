// ============================================================
// Vigil Platform — User Management Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// 🔐 USER AUTHENTICATION & MANAGEMENT
// ============================================================

// ── Init: load current user info on page load ───────────────
async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) {
      console.log('🔐 Not authenticated, redirecting...');
      window.location.href = '/login.html';
      return false;
    }
    if (!res.ok) {
      throw new Error(`Auth check failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.user) {
      window.location.href = '/login.html';
      return false;
    }
    currentUser = data.user;

    // Update topbar UI (defensive — DOM อาจยังไม่ render)
    const initial = (currentUser.full_name || currentUser.username).charAt(0).toUpperCase();
    const $ = (id) => document.getElementById(id);
    if ($('userAvatar')) $('userAvatar').textContent = initial;
    if ($('userName')) $('userName').textContent = currentUser.full_name || currentUser.username;
    if ($('userRole')) {
      $('userRole').textContent = currentUser.role;
      $('userRole').classList.toggle('viewer', currentUser.role === 'viewer');
    }
    if ($('ddName')) $('ddName').textContent = currentUser.full_name || currentUser.username;
    if ($('ddEmail')) $('ddEmail').textContent = currentUser.email || I18N.t('aux.noEmail');

    // Apply role-based UI — one explicit class per role (admin / viewer /
    // auditor). admin-only is hidden from role-viewer only, so an auditor
    // sees every page; the auditor write-block is enforced server-side.
    document.body.classList.remove('role-admin', 'role-viewer', 'role-auditor', 'role-site_admin');
    document.body.classList.add('role-' + (currentUser.role || 'viewer'));
    _isAuditor = currentUser.role === 'auditor';

    await _applyCapabilityNav();

    // Force change password ถ้าเป็นครั้งแรก
    if (currentUser.must_change_password) {
      setTimeout(() => openChangePassword(true), 500);
    }
    return true;
  } catch (e) {
    console.error('🔐 Auth error:', e);
    // Network error, etc — แสดงข้อความให้รู้ ไม่ redirect
    const userName = document.getElementById('userName');
    if (userName) userName.textContent = 'Auth error';
    return false;
  }
}

// Site capability list, cached from /api/sites (already scoped to the
// current user's allowedSites) — shared with page-reports.js so the reports
// scope bar doesn't need a second fetch for the same has_face/has_lpr data.
window._siteCapabilities = [];

// Hide Face/Person/LPR nav pages when NONE of the sites this user can see
// have that camera type — session-static (computed once at login), not tied
// to any in-page scope-bar selection. admin/auditor see every site, so this
// is a no-op for them unless the whole platform truly has no such camera.
// Face and Person are independently gated: Person/appearance data comes from
// cam_role='standard' cameras' VCA, not from face-recognition cameras.
async function _applyCapabilityNav() {
  try {
    const res = await fetch(`${API}/api/sites`, { cache: 'no-store' });
    if (!res.ok) return;
    const sites = await res.json();
    window._siteCapabilities = Array.isArray(sites) ? sites : [];
    const hasFace       = window._siteCapabilities.some(s => s.has_face);
    const hasLpr         = window._siteCapabilities.some(s => s.has_lpr);
    const hasAppearance  = window._siteCapabilities.some(s => s.has_appearance);
    document.body.classList.toggle('no-face', !hasFace);
    document.body.classList.toggle('no-lpr', !hasLpr);
    document.body.classList.toggle('no-appearance', !hasAppearance);
  } catch (e) { console.warn('_applyCapabilityNav:', e.message); }
}

// ── User dropdown ───────────────────────────────────────────
function toggleUserDropdown(e) {
  e?.stopPropagation();
  document.getElementById('userDropdown').classList.toggle('hidden');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('userDropdown')?.classList.add('hidden');
  }
});

// ── Logout ──────────────────────────────────────────────────
async function doLogout() {
  if (!confirm(I18N.t('aux.confirmLogout'))) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  setStoredToken(null);  // 🆕 Clear localStorage token
  sessionStorage.removeItem('disclaimer_accepted');
  window.location.href = '/login.html';
}

// ── Change Password Modal ───────────────────────────────────
function openChangePassword(forced = false) {
  document.getElementById('userDropdown')?.classList.add('hidden');
  document.getElementById('changePasswordModal').classList.remove('hidden');
  document.getElementById('cpForceWarning').style.display = forced ? 'block' : 'none';
  document.getElementById('cpOldPassword').value = '';
  document.getElementById('cpNewPassword').value = '';
  document.getElementById('cpConfirmPassword').value = '';
  setTimeout(() => document.getElementById('cpOldPassword').focus(), 50);
}

function closeChangePassword() {
  // ถ้า must_change_password อยู่ → ห้ามปิด
  if (currentUser?.must_change_password) {
    alert(I18N.t('cp.mustChangeFirst'));
    return;
  }
  document.getElementById('changePasswordModal').classList.add('hidden');
}

async function submitChangePassword() {
  const oldPw = document.getElementById('cpOldPassword').value;
  const newPw = document.getElementById('cpNewPassword').value;
  const conf  = document.getElementById('cpConfirmPassword').value;
  if (!oldPw || !newPw) return alert(I18N.t('cp.fillAll'));
  if (newPw.length < 8) return alert(I18N.t('cp.newPwMin'));
  if (newPw !== conf) return alert(I18N.t('cp.confirmMismatch'));

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (currentUser) currentUser.must_change_password = false;
    alert(I18N.t('cp.changeOk'));
    document.getElementById('changePasswordModal').classList.add('hidden');
  } catch (e) { alert(e.message); }
}

// ── User Manager (admin) ────────────────────────────────────
let usersCache = [];
let _sitesForEditor = [];  // cached for user editor multi-select
let _siteNameMap = {};     // id -> name, for the users list role column

function openUserManager() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('users');
}
function closeUserManager() { /* users is a Settings Workspace section now — no modal */ }

async function loadUsers() {
  try {
    if (!Object.keys(_siteNameMap).length) {
      try {
        const sr = await fetch(`${API}/api/sites`);
        if (sr.ok) (await sr.json()).forEach(s => { _siteNameMap[s.id] = s.name; });
      } catch {}
    }
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error(I18N.t('us.loadFailed'));
    usersCache = await res.json();
    renderUsersList();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

// viewer และ site_admin ถูกจำกัดด้วย Site (user_sites) · site_admin ต้องมีอย่างน้อย 1 Site
const _scoped = (r) => r === 'viewer' || r === 'site_admin';

// Role badge + (for viewers) which sites they're scoped to.
function _roleCell(u) {
  const label = u.role === 'admin' ? 'Admin' : u.role === 'site_admin' ? 'Site Admin' : u.role === 'auditor' ? 'Auditor' : 'Viewer';
  const chip = `<span class="chip ${u.role === 'admin' || u.role === 'site_admin' ? 'accent' : ''}">${label}</span>`;
  if (!_scoped(u.role)) return chip;
  const ids = u.site_ids || [];
  const sites = ids.length
    ? ids.map(id => `<span class="chip" style="font-size:9px;padding:1px 6px">${escapeHtml(_siteNameMap[id] || ('#' + id))}</span>`).join(' ')
    : `<span style="font-size:9px;color:var(--warn)">${escapeHtml(I18N.t('us.noSite'))}</span>`;
  return `${chip}<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${sites}</div>`;
}

function renderUsersList() {
  document.getElementById('userCount').textContent = usersCache.length;
  const el = document.getElementById('usersList');
  if (!usersCache.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('us.noUsers'))}</div>`;
    return;
  }
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 100px 120px 140px 200px;gap:10px;padding:10px 14px;background:var(--surface-overlay);font-size:10px;color:var(--text-secondary);font-weight:600;border-bottom:1px solid var(--border-hairline)">
      <div>Username / Name</div>
      <div>Email</div>
      <div>Role</div>
      <div>Status</div>
      <div>Last Login</div>
      <div style="text-align:right">Actions</div>
    </div>
    ${usersCache.map(u => {
      const isMe = u.id === currentUser?.id;
      const status = !u.enabled ? '<span style="color:var(--status-bad)"><svg aria-hidden="true" width="11" height="11" style="vertical-align:-1px"><use href="#icon-offline"/></svg> Disabled</span>' :
                     u.locked_until && new Date(u.locked_until) > new Date() ? '<span style="color:var(--warn)"><svg aria-hidden="true" width="11" height="11" style="vertical-align:-1px"><use href="#icon-lock"/></svg> Locked</span>' :
                     '<span style="color:var(--status-ok)">✓ Active</span>';
      const lastLogin = u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH', {dateStyle:'short', timeStyle:'short', hour12:false}) : '—';
      return `
      <div style="display:grid;grid-template-columns:1fr 1fr 100px 120px 140px 200px;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border-hairline);font-size:11px;align-items:center">
        <div>
          <div style="font-weight:600">${u.username} ${isMe ? '<span style="color:var(--accent);font-size:10px">(YOU)</span>' : ''}</div>
          <div style="color:var(--text-secondary);font-size:10px">${u.full_name || '—'}</div>
        </div>
        <div style="font-size:10px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.email || '—'}</div>
        <div>${_roleCell(u)}</div>
        <div>${status}</div>
        <div style="font-size:10px;color:var(--text-secondary)">${lastLogin}<br><span style="font-family:monospace;font-size:9px">${u.last_login_ip || ''}</span></div>
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" style="padding:3px 8px;font-size:10px" data-action="openUserEditor" data-id="${u.id}">${escapeHtml(I18N.t('common.edit'))}</button>
          <button class="btn btn-secondary" style="padding:3px 8px;font-size:10px" data-action="resetUserPassword" data-id="${u.id}">Reset</button>
          ${!isMe ? `<button class="btn btn-danger" style="padding:3px 8px;font-size:10px" data-action="deleteUserConfirm" data-id="${u.id}">${escapeHtml(I18N.t('common.delete'))}</button>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

// ── User Editor ─────────────────────────────────────────────
async function openUserEditor(id) {
  const u = id ? usersCache.find(x => x.id === id) : null;
  // full page แทน modal (2026-08-12) — โครงเดียวกับหน้าเพิ่มกล้อง: ซ่อนรายชื่อ
  // แล้วแสดงฟอร์มเต็มพื้นที่ ไม่ใช่กล่องซ้อนกล่องที่เลื่อนยากบนมือถือ
  document.getElementById('userForm').classList.remove('hidden');
  document.getElementById('set-users')?.classList.add('user-editing');
  document.getElementById('userForm').scrollIntoView({ block: 'start' });
  document.getElementById('userEditorTitle').textContent = id ? I18N.t('us.editorEdit') : I18N.t('us.editorAdd');
  document.getElementById('ueUserId').value = id || '';
  document.getElementById('ueUsername').value = u?.username || '';
  document.getElementById('ueUsername').disabled = !!id;  // ห้ามแก้ username
  document.getElementById('uePassword').value = '';
  document.getElementById('uePasswordGroup').style.display = id ? 'none' : '';
  document.getElementById('ueFullName').value = u?.full_name || '';
  document.getElementById('ueEmail').value = u?.email || '';
  document.getElementById('ueRole').value = u?.role || 'viewer';
  document.getElementById('ueEnabled').checked = u?.enabled !== false;
  // Sites multi-select — load once, show only for viewer role
  if (!_sitesForEditor.length) {
    try { const r = await fetch(`${API}/api/sites`); _sitesForEditor = r.ok ? await r.json() : []; } catch {}
  }
  _renderUeSites(u?.role || 'viewer', u?.site_ids || []);
  await _renderUeViews(u?.role || 'viewer', u);
  _ueHint(u?.role || 'viewer');
  // ⚠️ ห้ามส่ง [] / null ตอนสลับ role — ช่องพวกนี้ซ่อนสำหรับ admin/auditor
  // ถ้า render ใหม่ด้วยค่าว่าง แล้วผู้ใช้สลับกลับมาเป็น viewer สิทธิ์ที่เคยตั้งไว้
  // จะหายเงียบ ๆ แล้วกดบันทึกก็ทับของจริงทันที (reproduce 2026-08-16:
  // viewer ที่มี 2 Site + 2 หน้า → สลับเป็น auditor แล้วกลับมา เหลือ 0 และติ๊ก
  // "ไม่จำกัด" ให้เอง) · จำสิ่งที่เลือกไว้ก่อนซ่อน แล้วคืนค่าเมื่อกลับมา
  let stash = null;
  document.getElementById('ueRole').onchange = async (e) => {
    const role = e.target.value;
    _ueHint(role);
    if (_scoped(role)) {
      const keep = stash || u || null;
      _renderUeSites(role, (keep && keep.site_ids) || []);
      await _renderUeViews(role, keep);
    } else {
      stash = _ueSnapshotScope() || stash || u;
      _renderUeSites(role, []);
      await _renderUeViews(role, null);
    }
  };
}

// อ่านสิ่งที่เลือกอยู่บนฟอร์มตอนนี้ ให้มีรูปร่างเดียวกับ object ผู้ใช้
// (ต้องเก็บ "ของบนจอ" ไม่ใช่ "ของใน DB" ไม่งั้นสิ่งที่เพิ่งแก้ก่อนสลับ role หายไปด้วย)
function _ueSnapshotScope() {
  const sitesEl = document.getElementById('ueSites');
  const group = document.getElementById('ueViewsGroup');
  if (!sitesEl || !group || group.style.display === 'none') return null;
  const unrestricted = document.getElementById('ueViewsUnrestricted')?.checked;
  return {
    site_ids: [...sitesEl.selectedOptions].map(o => Number(o.value)),
    allowed_views: unrestricted ? null
      : [...document.querySelectorAll('.ue-view:checked')].map(c => c.dataset.key),
    landing_view: document.getElementById('ueLanding')?.value || null,
    camera_ids: [..._ueCamChosen],
  };
}

// admin/auditor ไม่มีช่องจำกัดสิทธิ์ให้เห็น — ถ้าไม่บอกเหตุผล คนใช้จะนึกว่าหน้าแก้ไขพัง
// (เจ้าของถามตรง ๆ 2026-08-16 ว่าทำไมหน้าแก้ไขไม่มีส่วนพวกนี้เหมือนหน้าเพิ่ม)
function _ueHint(role) {
  let el = document.getElementById('ueScopeHint');
  if (!el) {
    const anchor = document.getElementById('ueSitesGroup');
    if (!anchor) return;
    el = document.createElement('div');
    el.id = 'ueScopeHint';
    el.className = 'form-hint';
    el.style.cssText = 'margin:-4px 0 14px;color:var(--text-secondary)';
    anchor.parentNode.insertBefore(el, anchor);
  }
  const restricted = _scoped(role);
  el.style.display = restricted ? 'none' : '';
  el.textContent = restricted ? ''
    : I18N.t('us.scopeHintAll');
}

// ── สิทธิ์ระดับหน้า/แท็บ + กล้อง (decision #251/#253) ────────────────
// รายการหน้า/แท็บมาจาก GET /api/views เสมอ — ห้าม hardcode ไม่งั้นเพิ่มหน้าใหม่แล้วลืมมาแก้ที่นี่
let _ueViewCatalog = null;

async function _renderUeViews(role, u) {
  const group = document.getElementById('ueViewsGroup');
  if (!group) return;
  // admin/auditor เห็นทุกอย่างอยู่แล้วโดยนิยาม (getAllowedSites คืน null) จำกัดไม่ได้
  const show = _scoped(role);
  group.style.display = show ? '' : 'none';
  if (!show) return;

  if (!_ueViewCatalog) {
    try {
      const r = await fetch(`${API}/api/views`, { credentials: 'include' });
      _ueViewCatalog = r.ok ? (await r.json()).views || [] : [];
    } catch { _ueViewCatalog = []; }
  }

  const allowed = u?.allowed_views ?? null;   // null = ไม่จำกัด
  const chosen = new Set(Array.isArray(allowed) ? allowed : []);
  const unrestricted = document.getElementById('ueViewsUnrestricted');
  unrestricted.checked = !Array.isArray(allowed);

  const tree = document.getElementById('ueViewsTree');
  // ชื่อหน้า/แท็บผ่าน I18N เสมอ (registry ส่ง i18n key มาด้วย, label ไทยเป็น fallback) —
  // ก่อนหน้านี้ใช้ label ตรงๆ ทำให้ UI ภาษาอังกฤษยังเห็นรายการเป็นไทย (owner แจ้ง 2026-09-02)
  const _ueName = (x) => (x.i18n ? I18N.t(x.i18n, x.label) : x.label);
  tree.innerHTML = _ueViewCatalog.map(v => {
    const tabs = (v.tabs || []).map(t => `
      <label><input type="checkbox" class="ue-view" data-key="${escapeHtml(t.key)}"
        ${chosen.has(t.key) ? 'checked' : ''}>
        <span>${escapeHtml(_ueName(t))}</span>
        ${t.enforceable ? '' : `<span class="ue-uionly" title="${escapeHtml(I18N.t('us.uiOnlyHint'))}">${escapeHtml(I18N.t('us.uiOnly'))}</span>`}
      </label>`).join('');
    return `<div class="ue-page">
      <label><input type="checkbox" class="ue-view" data-key="${escapeHtml(v.key)}"
        ${chosen.has(v.key) ? 'checked' : ''}>
        <span>${escapeHtml(_ueName(v))}</span></label>
      ${tabs ? `<div class="ue-tabs">${tabs}</div>` : ''}
    </div>`;
  }).join('');

  const sync = () => {
    tree.hidden = unrestricted.checked;
    _ueSyncLanding(u?.landing_view || null);
  };
  unrestricted.onchange = sync;
  tree.onchange = () => _ueSyncLanding(document.getElementById('ueLanding').value || null);
  sync();

  await _ueRenderCameras(u);
  // เปลี่ยน Site ในฟอร์มแล้วตัวเลือกกล้องต้องตามทันที — ไม่งั้นแอดมินเพิ่ม Site
  // แล้วเลือกกล้องของ Site นั้นไม่ได้ (ตัวเลือกยังเป็นชุดเดิม) หรือเลือกกล้องที่ค้างอยู่
  // จาก Site เดิมแล้วโดน 400 จาก validator ของเราเองโดยไม่มีคำอธิบายบนหน้าจอ
  const siteSel = document.getElementById('ueSites');
  if (siteSel) siteSel.onchange = () => _uePaintCameras();
}

// dropdown "หน้าแรก" ต้องมีเฉพาะสิ่งที่ติ๊กไว้ — ไม่งั้นตั้งไปแล้ว login มาเจอการ์ด "ไม่มีสิทธิ์"
// (server ก็ปฏิเสธด้วย 400 อยู่แล้ว แต่ปล่อยให้เลือกผิดได้ก่อนคือ UX ที่แย่)
function _ueSyncLanding(current) {
  const sel = document.getElementById('ueLanding');
  if (!sel) return;
  const unrestricted = document.getElementById('ueViewsUnrestricted').checked;
  const picked = _ueCheckedViews();
  const opts = [`<option value="">${escapeHtml(I18N.t('us.landingDefault'))}</option>`];
  const name = (x) => (x.i18n ? I18N.t(x.i18n, x.label) : x.label);
  for (const v of (_ueViewCatalog || [])) {
    if (unrestricted || picked.includes(v.key)) opts.push(`<option value="${escapeHtml(v.key)}">${escapeHtml(name(v))}</option>`);
    for (const t of (v.tabs || [])) {
      if (unrestricted || picked.includes(t.key) || picked.includes(v.key)) {
        opts.push(`<option value="${escapeHtml(t.key)}">— ${escapeHtml(name(v))} › ${escapeHtml(name(t))}</option>`);
      }
    }
  }
  sel.innerHTML = opts.join('');
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

function _ueCheckedViews() {
  return [...document.querySelectorAll('#ueViewsTree .ue-view:checked')].map(el => el.dataset.key);
}

let _ueCamAll = [];      // กล้องทั้งหมดที่ดึงมา (ใช้กรองซ้ำตอนพิมพ์ค้นหา)
let _ueCamChosen = new Set();

async function _ueRenderCameras(u) {
  const box = document.getElementById('ueCamList');
  if (!box) return;
  try {
    const r = await fetch(`${API}/api/cameras`, { credentials: 'include' });
    _ueCamAll = r.ok ? await r.json() : [];
  } catch { _ueCamAll = []; }
  _ueCamChosen = new Set(u?.camera_ids || []);
  // ไม่มีค่า = multi (พฤติกรรมเดิมของทุกคน) — ห้าม default เป็น single ไม่งั้น
  // แค่เปิดฟอร์มดูแล้วกดบันทึก จะไปจำกัดคนที่ไม่มีใครสั่งให้จำกัด
  const _modeEl = document.getElementById('ueCamMode');
  if (_modeEl) _modeEl.value = u?.camera_select_mode === 'single' ? 'single' : 'multi';
  const search = document.getElementById('ueCamSearch');
  if (search) { search.value = ''; search.oninput = () => _uePaintCameras(); }
  box.onchange = (e) => {
    const cb = e.target.closest('input[type=checkbox][data-cam]');
    if (!cb) return;
    if (cb.checked) _ueCamChosen.add(cb.dataset.cam); else _ueCamChosen.delete(cb.dataset.cam);
    _ueUpdateCamCount();
  };
  box.onclick = (e) => {
    // "เลือกทั้ง Site" — ติ๊ก/เอาออกทั้งกลุ่มในคลิกเดียว ซึ่งเป็นเหตุผลหลักที่
    // ต้องจัดกลุ่มตาม Site ตั้งแต่แรก (ผู้ใช้ส่วนใหญ่ให้สิทธิ์ทั้ง Site หรือไม่ก็ไม่กี่ตัว)
    const btn = e.target.closest('[data-site-all]');
    if (!btn) return;
    const ids = JSON.parse(btn.dataset.siteAll);
    const allOn = ids.every(id => _ueCamChosen.has(id));
    ids.forEach(id => allOn ? _ueCamChosen.delete(id) : _ueCamChosen.add(id));
    _uePaintCameras();
  };
  _uePaintCameras();
}

function _uePaintCameras() {
  const box = document.getElementById('ueCamList');
  if (!box) return;
  // จำกัดตาม Site ที่ติ๊กไว้ในฟอร์ม — server ปฏิเสธกล้องนอก Site อยู่แล้ว (400)
  // การโชว์ตัวเลือกที่บันทึกไม่ได้คือกับดัก
  const siteIds = new Set(Array.from(document.getElementById('ueSites')?.selectedOptions || [])
    .map(o => parseInt(o.value)));
  const q = (document.getElementById('ueCamSearch')?.value || '').trim().toLowerCase();
  const list = _ueCamAll
    .filter(c => !siteIds.size || siteIds.has(c.site_id))
    .filter(c => !q || String(c.camera_name || '').toLowerCase().includes(q)
                    || String(c.camera_id || '').toLowerCase().includes(q));

  if (!list.length) {
    box.innerHTML = `<div class="ue-cams-empty">${escapeHtml(I18N.t('us.camNone', 'ไม่พบกล้องที่ตรงกับที่ค้นหา'))}</div>`;
    return _ueUpdateCamCount();
  }
  // จัดกลุ่มด้วย site_id เสมอ ไม่ใช่ค่า `site` ที่ /api/cameras ส่งมา —
  // field นั้นมาจาก label ใน cameras-config.json ซึ่ง **มีแค่บางกล้อง**
  // (วัดจริง 2026-08-12: site_id=18 มี 84 กล้อง แต่มี `site` แค่ 17)
  // ผลคือ Site เดียวถูกแยกเป็น 2 กลุ่ม และกลุ่มที่ไม่มี label โชว์เลข id ดิบ ("18")
  // ให้ผู้ใช้เห็น · ชื่อที่แสดงต้องมาจากตาราง sites เท่านั้น
  const siteName = new Map((_sitesForEditor || []).map(s => [s.id, s.name || s.code]));
  const bySite = new Map();
  for (const c of list) {
    const key = c.site_id ?? '';
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(c);
  }
  box.innerHTML = [...bySite.entries()].map(([siteId, cams]) => {
    const site = siteName.get(siteId) || I18N.t('us.camNoSite', '— ไม่ระบุ Site —');
    const ids = cams.map(c => c.camera_id);
    const allOn = ids.every(id => _ueCamChosen.has(id));
    return `<div class="ue-site">
        <span class="ue-site-name">${escapeHtml(String(site))}</span>
        <button type="button" class="ue-site-all" data-site-all='${escapeHtml(JSON.stringify(ids))}'>${
          escapeHtml(allOn ? I18N.t('us.camClearSite', 'เอาออกทั้งหมด') : I18N.t('us.camAllSite', 'เลือกทั้งหมด'))}</button>
      </div>` +
      cams.map(c => `<label class="ue-cam">
        <input type="checkbox" data-cam="${escapeHtml(c.camera_id)}" ${_ueCamChosen.has(c.camera_id) ? 'checked' : ''}>
        <span>${escapeHtml(c.camera_name || c.camera_id)}</span>
        <span class="cid">${escapeHtml(c.camera_id)}</span>
      </label>`).join('');
  }).join('');
  _ueUpdateCamCount();
}

function _ueUpdateCamCount() {
  const el = document.getElementById('ueCamCount');
  if (!el) return;
  const n = _ueCamChosen.size;
  el.textContent = n ? I18N.t('us.camPicked', 'เลือกไว้ {n}').replace('{n}', n)
                     : I18N.t('us.camAll', 'ทุกกล้อง');
}


function _renderUeSites(role, selectedIds) {
  const group = document.getElementById('ueSitesGroup');
  const sel = document.getElementById('ueSites');
  const show = _scoped(role) && _sitesForEditor.length > 0;
  group.style.display = show ? '' : 'none';
  if (!show) return;
  sel.innerHTML = _sitesForEditor.map(s =>
    `<option value="${s.id}" ${selectedIds.includes(s.id) ? 'selected' : ''}>${escapeHtml(s.name || s.code)}</option>`
  ).join('');
}

function closeUserEditor() {
  document.getElementById('userForm').classList.add('hidden');
  document.getElementById('set-users')?.classList.remove('user-editing');
}

// ปุ่มลูกตาบนช่องรหัสผ่าน (owner ask 2026-09-03) — สลับ type ไปมา ไม่แตะค่าใดๆ
window.ueTogglePw = function (btn) {
  const inp = document.getElementById('uePassword');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.style.color = inp.type === 'text' ? 'var(--accent)' : 'var(--text-secondary)';
};

async function saveUser() {
  const id = document.getElementById('ueUserId').value;
  const data = {
    full_name: document.getElementById('ueFullName').value.trim() || null,
    email: document.getElementById('ueEmail').value.trim() || null,
    role: document.getElementById('ueRole').value,
    enabled: document.getElementById('ueEnabled').checked,
  };
  if (!id) {
    data.username = document.getElementById('ueUsername').value.trim();
    data.password = document.getElementById('uePassword').value;
    // ค่า default = บังคับเปลี่ยนตอน login แรก — ส่ง false เฉพาะเมื่อ admin เอาติ๊กออกเอง
    data.must_change_password = document.getElementById('ueMustChange')?.checked !== false;
    if (!data.username) return alert(I18N.t('us.needUsername'));
    if (!data.password || data.password.length < 8) return alert(I18N.t('us.passwordMin'));
  }
  // site_admin ไม่มี Site = ฝั่งเซิร์ฟเวอร์ปฏิเสธทั้งบัญชี (NO_SITE_ASSIGNED) — กันตั้งแต่หน้าจอ
  if (data.role === 'site_admin' && !Array.from(document.getElementById('ueSites').selectedOptions).length) {
    return alert(I18N.t('us.siteAdminNeedSite'));
  }
  try {
    const url = id ? `${API}/api/users/${id}` : `${API}/api/users`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const e = await res.json();
      const known = { EMAIL_TAKEN: 'us.errEmailTaken', USERNAME_TAKEN: 'us.errUsernameTaken' }[e.code];
      throw new Error(known ? I18N.t(known) : e.error);
    }
    const saved = await res.json();
    const userId = id || saved.id;
    // Save site assignments for viewer role
    if (_scoped(data.role) && document.getElementById('ueSitesGroup').style.display !== 'none') {
      const sel = document.getElementById('ueSites');
      const siteIds = Array.from(sel.selectedOptions).map(o => parseInt(o.value));
      await fetch(`${API}/api/users/${userId}/sites`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_ids: siteIds }),
      });
    }
    // สิทธิ์ระดับหน้า/แท็บ + กล้อง — เฉพาะ viewer (admin/auditor จำกัดไม่ได้อยู่แล้ว)
    if (_scoped(data.role) && document.getElementById('ueViewsGroup').style.display !== 'none') {
      const unrestricted = document.getElementById('ueViewsUnrestricted').checked;
      const vr = await fetch(`${API}/api/users/${userId}/views`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowed_views: unrestricted ? null : _ueCheckedViews(),
          landing_view: document.getElementById('ueLanding').value || null,
        }),
      });
      if (!vr.ok) throw new Error((await vr.json()).error || 'save views failed');

      const cr = await fetch(`${API}/api/users/${userId}/cameras`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_ids: [..._ueCamChosen] }),
      });
      if (!cr.ok) throw new Error((await cr.json()).error || 'save cameras failed');

        // คนละ endpoint กับรายการกล้องโดยตั้งใจ — /cameras คุมว่า *ตัวไหน*
        // อันนี้คุมว่า *กี่ตัวพร้อมกัน* · รวมกันแล้วตอน audit จะแยกไม่ออกว่าแก้อะไร
        const modeEl = document.getElementById('ueCamMode');
        if (modeEl) {
          const mr = await fetch(`${API}/api/users/${userId}/camera-mode`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ camera_select_mode: modeEl.value }),
          });
          if (!mr.ok) throw new Error((await mr.json()).error || 'save camera mode failed');
        }
    }
    closeUserEditor();
    loadUsers();
  } catch (e) { alert(e.message); }
}

async function resetUserPassword(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  const newPw = prompt(I18N.t('us.resetPrompt').replace('{u}', u.username));
  if (!newPw) return;
  if (newPw.length < 8) return alert(I18N.t('us.passwordMin'));
  try {
    const res = await fetch(`/api/users/${id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPw }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    alert(I18N.t('us.resetDone').replace('{u}', u.username).replace('{pw}', newPw));
  } catch (e) { alert(e.message); }
}

async function deleteUserConfirm(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;
  if (!confirm(I18N.t('us.confirmDelete').replace('{u}', u.username))) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    loadUsers();
  } catch (e) { alert(e.message); }
}

// ── Audit Log Modal ─────────────────────────────────────────
function openAuditLog() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  const nav = document.querySelector('.nav-item[data-page="history"]');
  showPage('history', nav || undefined);
  historyNav('audit');
}
function closeAuditLog() { /* audit log is a History Workspace section now — no modal */ }

async function loadAuditLog() {
  try {
    populateAuditCameraFilter();
    const action = document.getElementById('auditFilterAction').value;
    const cameraId = document.getElementById('auditFilterCamera')?.value || '';
    const qs = new URLSearchParams();
    if (action) qs.set('action', action);
    if (cameraId) qs.set('targetCameraId', cameraId);
    const params = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`/api/audit-log${params}`);
    if (!res.ok) throw new Error(I18N.t('aud.loadFailed'));
    const logs = await res.json();
    renderAuditLog(logs);
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

function populateAuditCameraFilter() {
  const sel = document.getElementById('auditFilterCamera');
  if (!sel || sel.dataset.loaded === String((cameras || []).length)) return;
  const selected = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(I18N.t('aud.allCameras'))}</option>`
    + (cameras || []).map(c => {
      const id = c.camera_id || c.id || '';
      const label = c.camera_name || c.name || id;
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)} (${escapeHtml(id)})</option>`;
    }).join('');
  sel.value = selected;
  sel.dataset.loaded = String((cameras || []).length);
}

function renderAuditLog(logs) {
  const el = document.getElementById('auditLogList');
  if (!logs.length) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('aud.noLogs'))}</div>`;
    return;
  }
  const actionIcons = {
    login_success: '✓', login_failed: '✗', login_locked: '🔒', logout: '🚪',
    password_change: '🔑', password_reset: '🔓',
    user_create: '➕', user_update: '✏️', user_delete: '🗑',
    camera_create: '📷', camera_update: '✏️', camera_delete: '🗑',
    camera_offline_alert_update: '🔔',
    camera_group_assign: '🗂', camera_group_remove: '🗂',
    group_create: '🗂', group_update: '🗂', group_delete: '🗂',
    session_revoke: '🚫',
  };
  const actionColors = {
    login_success: 'var(--status-ok)', login_failed: 'var(--status-bad)', login_locked: 'var(--status-bad)',
    logout: 'var(--text-secondary)', password_change: 'var(--accent)', password_reset: 'var(--warn)',
    user_create: 'var(--status-ok)', user_delete: 'var(--status-bad)',
    camera_create: 'var(--status-ok)', camera_delete: 'var(--status-bad)',
    camera_group_assign: 'var(--accent)', camera_group_remove: 'var(--warn)',
  };
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:160px 130px 1fr 130px 100px;gap:10px;padding:10px 14px;background:var(--surface-overlay);font-size:10px;color:var(--text-secondary);font-weight:600;border-bottom:1px solid var(--border-hairline)">
      <div>${escapeHtml(I18N.t('evt.colTime'))}</div><div>User</div><div>Action / Details</div><div>IP</div><div>Target</div>
    </div>
    ${logs.map(l => `
      <div style="display:grid;grid-template-columns:160px 130px 1fr 130px 100px;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border-hairline);font-size:11px;align-items:center">
        <div style="font-size:10px;color:var(--text-secondary)">${new Date(l.created_at).toLocaleString('th-TH', {hour12:false})}</div>
        <div style="font-weight:600">${l.username || '—'}</div>
        <div>
          <span style="color:${actionColors[l.action] || 'var(--text-primary)'};font-weight:600">
            ${actionIcons[l.action] || '•'} ${l.action}
          </span>
          ${Object.keys(l.details || {}).length ? `<span style="color:var(--text-secondary);font-size:10px;margin-left:6px">${JSON.stringify(l.details)}</span>` : ''}
        </div>
        <div style="font-family:monospace;font-size:10px;color:var(--text-secondary)">${l.ip_address || '—'}</div>
        <div style="font-size:10px">${escapeHtml(l.target_camera_id || l.target_username || '—')}</div>
      </div>`).join('')}`;
}

// ── Sessions Manager ────────────────────────────────────────
function openSessionManager() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  const nav = document.querySelector('.nav-item[data-page="history"]');
  showPage('history', nav || undefined);
  historyNav('sessions');
}
function closeSessionManager() { /* sessions is a History Workspace section now — no modal */ }

// ── About Modal ─────────────────────────────────────────────
function openAboutModal() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  document.getElementById('aboutModal').classList.remove('hidden');
}
function closeAboutModal() {
  document.getElementById('aboutModal').classList.add('hidden');
}

async function loadSessions() {
  try {
    const res = await fetch('/api/auth/sessions');
    const sessions = await res.json();
    const el = document.getElementById('sessionsList');
    if (!sessions.length) {
      el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-secondary)">${escapeHtml(I18N.t('ses.noSessions'))}</div>`;
      return;
    }
    el.innerHTML = sessions.map(s => {
      const ua = s.user_agent || '';
      const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : ua.includes('Firefox') ? 'Firefox' : 'Other';
      const os = ua.includes('Mac') ? 'macOS' : ua.includes('Windows') ? 'Windows' : ua.includes('Linux') ? 'Linux' : ua.includes('iPhone') ? 'iOS' : ua.includes('Android') ? 'Android' : '';
      return `
      <div style="background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:6px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px">${browser} ${os ? `· ${os}` : ''} ${s.is_current ? '<span style="color:var(--status-ok);font-size:10px">(THIS DEVICE)</span>' : ''}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:3px">
            IP: <span style="font-family:monospace">${s.ip_address || '—'}</span> ·
            Created: ${new Date(s.created_at).toLocaleString('th-TH', {hour12:false})} ·
            Last used: ${new Date(s.last_used_at).toLocaleString('th-TH', {hour12:false})}
          </div>
        </div>
        ${!s.is_current ? `<button class="btn btn-danger" style="padding:5px 12px;font-size:11px" data-action="revokeSession" data-id="${escapeHtml(s.id)}">Revoke</button>` : ''}
      </div>`;
    }).join('');
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}

async function revokeSession(id) {
  if (!confirm(I18N.t('ses.confirmRevoke'))) return;
  try {
    await fetch(`/api/auth/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
    loadSessions();
  } catch (e) { alert(I18N.t('common.error') + e.message); }
}
