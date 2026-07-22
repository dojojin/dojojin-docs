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
    document.body.classList.remove('role-admin', 'role-viewer', 'role-auditor');
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

// Role badge + (for viewers) which sites they're scoped to.
function _roleCell(u) {
  const label = u.role === 'admin' ? 'Admin' : u.role === 'auditor' ? 'Auditor' : 'Viewer';
  const chip = `<span class="chip ${u.role === 'admin' ? 'accent' : ''}">${label}</span>`;
  if (u.role !== 'viewer') return chip;
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
  document.getElementById('userEditorModal').classList.remove('hidden');
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
  document.getElementById('ueRole').onchange = (e) => _renderUeSites(e.target.value, []);
}

function _renderUeSites(role, selectedIds) {
  const group = document.getElementById('ueSitesGroup');
  const sel = document.getElementById('ueSites');
  const show = role === 'viewer' && _sitesForEditor.length > 0;
  group.style.display = show ? '' : 'none';
  if (!show) return;
  sel.innerHTML = _sitesForEditor.map(s =>
    `<option value="${s.id}" ${selectedIds.includes(s.id) ? 'selected' : ''}>${escapeHtml(s.name || s.code)}</option>`
  ).join('');
}

function closeUserEditor() {
  document.getElementById('userEditorModal').classList.add('hidden');
}

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
    if (!data.username) return alert(I18N.t('us.needUsername'));
    if (!data.password || data.password.length < 8) return alert(I18N.t('us.passwordMin'));
  }
  try {
    const url = id ? `${API}/api/users/${id}` : `${API}/api/users`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    const saved = await res.json();
    const userId = id || saved.id;
    // Save site assignments for viewer role
    if (data.role === 'viewer' && document.getElementById('ueSitesGroup').style.display !== 'none') {
      const sel = document.getElementById('ueSites');
      const siteIds = Array.from(sel.selectedOptions).map(o => parseInt(o.value));
      await fetch(`${API}/api/users/${userId}/sites`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_ids: siteIds }),
      });
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
