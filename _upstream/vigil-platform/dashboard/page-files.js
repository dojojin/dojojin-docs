// ============================================================
// Vigil Platform — File Service Management Page
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';


// Format date in local convention (Thai/English)
function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString((I18N.getLang?.() || 'th') === 'th' ? 'th-TH' : 'en-GB');
}

// Get status pill color and text
function getStatusDisplay(file) {
  if (file.revoked_at) {
    return { status: I18N.t('fsvc.statusRevoked'), color: 'var(--status-bad)', tone: '--status-bad' };
  }
  if (file.expires_at && new Date(file.expires_at) < new Date()) {
    return { status: I18N.t('fsvc.statusExpired'), color: 'var(--warn)', tone: '--warn' };
  }
  return { status: I18N.t('fsvc.statusActive'), color: 'var(--status-ok)', tone: '--status-ok' };
}

// Copy to clipboard with fallback for non-HTTPS
async function copyToClipboard(text, button) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      showCopySuccess(button);
    } else {
      // Fallback for HTTP or unsupported browsers
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showCopySuccess(button);
    }
  } catch (e) {
    console.warn('Copy failed:', e);
  }
}

// Show brief "copied" state on button
function showCopySuccess(button) {
  const originalText = button.textContent;
  button.textContent = I18N.t('fsvc.copied');
  button.disabled = true;
  setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 2000);
}

// ลิงก์ภายนอก (migration 287) — ชื่อผู้ให้บริการจากโฮสต์ ใช้แทนขนาดไฟล์ในรายการ/รายละเอียด
function fsvcLinkDesc(file) {
  let host = '';
  try { host = new URL(file.target_url).hostname; } catch { return ''; }
  return `${I18N.t(/(^|\.)google\.com$/.test(host) ? 'fsvc.provGdrive' : 'fsvc.provOnedrive')} · ${host}`;
}
const fsvcChip = () => ` <span class="fsvc-pill fsvc-pill-link">${escapeHtml(I18N.t('fsvc.linkChip'))}</span>`;

// Render upload card (left column)
function renderUploadCard() {
  return `<section class="fsvc-card">
    <h3 class="fsvc-card-h">${escapeHtml(I18N.t('fsvc.uploadTitle'))}</h3>
    <div class="seg fsvc-mode" role="group">
      <button type="button" class="active" data-action="fsvcMode" data-mode="file" aria-pressed="true">${escapeHtml(I18N.t('fsvc.modeFile'))}</button>
      <button type="button" data-action="fsvcMode" data-mode="link" aria-pressed="false">${escapeHtml(I18N.t('fsvc.modeLink'))}</button>
    </div>
    <p class="fsvc-note" data-fsvc-mode="file">${escapeHtml(I18N.t('fsvc.uploadHint'))}</p>
    <p class="fsvc-note" data-fsvc-mode="link" hidden>${escapeHtml(I18N.t('fsvc.linkHint'))}</p>

    <div class="fsvc-upload-form">
      <div class="fsvc-field" data-fsvc-mode="file">
        <label for="fsvcFileInput">${escapeHtml(I18N.t('fsvc.fileInput'))}</label>
        <input id="fsvcFileInput" type="file" class="form-input" accept=".png,.jpg,.jpeg,.pdf,.docx,.xlsx,.html,.htm" />
      </div>

      <div class="fsvc-field" data-fsvc-mode="link" hidden>
        <label for="fsvcUrlInput">${escapeHtml(I18N.t('fsvc.urlLabel'))}</label>
        <input id="fsvcUrlInput" type="url" class="form-input" inputmode="url" maxlength="2048" placeholder="https://drive.google.com/file/d/…/view" />
      </div>

      <div class="fsvc-field" data-fsvc-mode="link" hidden>
        <label for="fsvcNameInput">${escapeHtml(I18N.t('fsvc.displayName'))}</label>
        <input id="fsvcNameInput" type="text" class="form-input" maxlength="200" placeholder="${escapeHtml(I18N.t('fsvc.displayNamePh'))}" />
      </div>

      <div class="fsvc-field">
        <label for="fsvcExpiresInput" data-fsvc-mode="file">${escapeHtml(I18N.t('fsvc.expiresLabel'))}</label>
        <label for="fsvcExpiresInput" data-fsvc-mode="link" hidden>${escapeHtml(I18N.t('fsvc.expiresLabelLink'))}</label>
        <div class="fsvc-inline">
          <input id="fsvcExpiresInput" type="number" class="form-input" min="1" max="3650" placeholder="${escapeHtml(I18N.t('fsvc.expiresPlaceholder'))}" />
          <span class="fsvc-unit">${escapeHtml(I18N.t('fsvc.unitDays'))}</span>
        </div>
      </div>

      <div class="fsvc-field">
        <label for="fsvcNoteInput">${escapeHtml(I18N.t('fsvc.noteLabel'))}</label>
        <input id="fsvcNoteInput" type="text" class="form-input" placeholder="${escapeHtml(I18N.t('fsvc.notePlaceholder'))}" />
      </div>

      <div class="fsvc-field" data-fsvc-mode="file">
        <label class="fsvc-check" for="fsvcAllowScripts">
          <input id="fsvcAllowScripts" type="checkbox" />
          <span>${escapeHtml(I18N.t('fsvc.allowScripts'))}</span>
        </label>
        <span class="fsvc-check-hint">${escapeHtml(I18N.t('fsvc.allowScriptsHint'))}</span>
      </div>

      <div class="fsvc-actions">
        <button class="btn btn-primary admin-only" data-action="fsvcUpload" data-fsvc-mode="file">${escapeHtml(I18N.t('fsvc.uploadBtn'))}</button>
        <button class="btn btn-primary admin-only" data-action="fsvcCreateLink" data-fsvc-mode="link" hidden>${escapeHtml(I18N.t('fsvc.createLinkBtn'))}</button>
        <span id="fsvcUploadMsg" class="fsvc-msg"></span>
      </div>
    </div>

    <div id="fsvcUploadResult" class="fsvc-upload-result"></div>
  </section>`;
}

// Render file list (right column)
function renderFileListCard(files) {
  if (!files || files.length === 0) {
    return `<section class="fsvc-card">
      <h3 class="fsvc-card-h">${escapeHtml(I18N.t('fsvc.listTitle'))}</h3>
      <div class="fsvc-empty">${escapeHtml(I18N.t('fsvc.noFiles'))}</div>
    </section>`;
  }

  // 5 คอลัมน์แทน 8 (เดิมล้นกรอบ + td.fsvc-actions เป็น display:flex ซึ่งหลุดจากโครงตาราง) —
  // ขนาด · ผู้อัป · วันที่อัป รวมเป็นบรรทัดรองใต้ชื่อไฟล์
  const T = (k) => escapeHtml(I18N.t(k));
  const rows = files.map(file => {
    const { status, tone } = getStatusDisplay(file);
    const isLink = file.kind === 'link';
    const canCopy = (file.short_url || file.url) && !file.revoked_at && (!file.expires_at || new Date(file.expires_at) > new Date());
    const meta = [isLink ? fsvcLinkDesc(file) : formatBytes(file.bytes), file.uploaded_by, formatDate(file.uploaded_at)].filter(Boolean).map(escapeHtml).join(' · ');
    // data-label ใช้ตอนจอ ≤768px ที่ตารางกลายเป็นการ์ด — หัวตารางหายไป จึงพกป้ายกำกับมากับ cell เอง
    return `<tr>
      <td class="fsvc-name" data-label="${T('fsvc.colName')}">
        <div class="fsvc-name-t">${escapeHtml(file.original_name)}${isLink ? fsvcChip() : ''}${file.allow_scripts ? ` <span class="fsvc-pill fsvc-pill-js">${T('fsvc.scriptsBadge')}</span>` : ''}</div>
        <div class="fsvc-meta">${meta}</div>
        ${file.short_url ? `<div class="fsvc-short">${escapeHtml(file.short_url.replace(/^https?:\/\//, ''))}</div>` : ''}
      </td>
      <td class="fsvc-num" data-label="${T('fsvc.colClicks')}">${(file.clicks || 0).toLocaleString()}</td>
      <td class="fsvc-date" data-label="${T('fsvc.colExpires')}">${file.expires_at ? formatDate(file.expires_at) : '—'}</td>
      <td class="fsvc-status" data-label="${T('fsvc.colStatus')}">
        <span class="fsvc-pill" style="background:${token(tone)}26;color:var(${tone})">${escapeHtml(status)}</span>
      </td>
      <td class="fsvc-act-cell"><div class="fsvc-act">
        <button class="btn-mini admin-only" data-action="fsvcDetail" data-id="${file.id}">${T('fsvc.detailBtn')}</button>
        <button class="btn-mini admin-only" data-action="fsvcCopyLink" data-url="${escapeHtml(file.short_url || file.url || '')}" ${!canCopy ? 'disabled' : ''}
          title="${T('fsvc.copyLink')}">${T('fsvc.copyBtn')}</button>
        ${file.revoked_at ? '' : `<button class="btn-mini btn-danger admin-only" data-action="fsvcRevoke" data-id="${file.id}"
          title="${T('fsvc.revoke')}">${T('fsvc.revokeBtn')}</button>`}
      </div></td>
    </tr>`;
  }).join('');

  return `<section class="fsvc-card">
    <h3 class="fsvc-card-h">${T('fsvc.listTitle')}</h3>
    <div class="fsvc-table-wrap"><table class="fsvc-table fsvc-files">
      <thead>
        <tr>
          <th>${T('fsvc.colName')}</th>
          <th class="fsvc-num">${T('fsvc.colClicks')}</th>
          <th class="fsvc-date">${T('fsvc.colExpires')}</th>
          <th class="fsvc-status">${T('fsvc.colStatus')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

// Load files from backend
async function loadFileList() {
  try {
    const res = await fetch(`${API}/api/files`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Unknown error');

    const container = document.getElementById('filesListContainer');
    if (container) {
      container.innerHTML = renderFileListCard(data.files);
      attachFileListeners();
    }
  } catch (e) {
    const container = document.getElementById('filesListContainer');
    if (container) {
      container.innerHTML = `<section class="fsvc-card"><div style="color:var(--status-bad);padding:var(--space-4)">${escapeHtml(I18N.t('fsvc.loadFailed'))} ${escapeHtml(e.message)}</div></section>`;
    }
  }
}

// Handle file upload
async function handleFileUpload() {
  const fileInput = document.getElementById('fsvcFileInput');
  const expiresInput = document.getElementById('fsvcExpiresInput');
  const noteInput = document.getElementById('fsvcNoteInput');
  const msgEl = document.getElementById('fsvcUploadMsg');
  const resultEl = document.getElementById('fsvcUploadResult');

  if (!fileInput.files || !fileInput.files[0]) {
    if (msgEl) msgEl.textContent = I18N.t('fsvc.selectFile');
    if (msgEl) msgEl.style.color = 'var(--status-bad)';
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  if (expiresInput.value) {
    const days = parseInt(expiresInput.value, 10);
    if (Number.isFinite(days) && days >= 1 && days <= 3650) {
      formData.append('expires_days', days);
    }
  }

  if (noteInput.value) {
    formData.append('note', noteInput.value);
  }
  // HTML แบบโต้ตอบได้ (migration 265) — เซิร์ฟเวอร์รับเฉพาะไฟล์ HTML ชนิดอื่นไม่มีผล
  if (document.getElementById('fsvcAllowScripts')?.checked) formData.append('allow_scripts', 'true');

  if (msgEl) msgEl.textContent = I18N.t('fsvc.uploading');
  if (msgEl) msgEl.style.color = 'var(--text-secondary)';

  try {
    const res = await fetch(`${API}/api/files`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    if (!data.ok) throw new Error(data.error || 'Unknown error');

    // Success
    if (msgEl) msgEl.textContent = I18N.t('fsvc.uploadSuccess');
    if (msgEl) msgEl.style.color = 'var(--status-ok)';

    // Show copy link for the new file
    if (data.short_url) data.url = data.short_url;   // แชร์ลิงก์สั้น (มีบันทึกการกด + ภาพพรีวิว)
    if (resultEl && data.url) {
      resultEl.innerHTML = `<div style="margin-top:var(--space-3);padding:var(--space-2);background:var(--surface-overlay);border-radius:4px">
        <div style="font-size:var(--fs-caption);color:var(--text-secondary);margin-bottom:var(--space-1)">${escapeHtml(I18N.t('fsvc.uploadResultLabel'))}</div>
        <div style="display:flex;gap:var(--space-2);align-items:center;word-break:break-all;font-family:monospace;font-size:11px;color:var(--text-primary)">
          ${escapeHtml(data.url)}
          <button class="btn-mini admin-only" data-action="fsvcCopyResultLink" data-url="${escapeHtml(data.url)}">${escapeHtml(I18N.t('fsvc.copyBtn'))}</button>
        </div>
      </div>`;
    }

    // Clear inputs
    fileInput.value = '';
    expiresInput.value = '';
    noteInput.value = '';

    // Reload list
    await loadFileList();
  } catch (e) {
    if (msgEl) msgEl.textContent = I18N.t('fsvc.uploadFailed') + e.message;
    if (msgEl) msgEl.style.color = 'var(--status-bad)';
  }
}

// สร้างลิงก์สั้นไปไฟล์ภายนอก (POST /api/files/link) · ข้อความ error ของเซิร์ฟเวอร์แสดงตรงนี้
async function handleCreateLink() {
  const urlInput = document.getElementById('fsvcUrlInput');
  const nameInput = document.getElementById('fsvcNameInput');
  const expiresInput = document.getElementById('fsvcExpiresInput');
  const noteInput = document.getElementById('fsvcNoteInput');
  const msgEl = document.getElementById('fsvcUploadMsg');
  const resultEl = document.getElementById('fsvcUploadResult');
  const say = (t, tone) => { msgEl.textContent = t; msgEl.style.color = `var(${tone})`; };
  const url = urlInput.value.trim();
  if (!url) { say(I18N.t('fsvc.enterUrl'), '--status-bad'); return urlInput.focus(); }
  const days = parseInt(expiresInput.value, 10);
  say(I18N.t('fsvc.creating'), '--text-secondary');
  try {
    const res = await fetch(`${API}/api/files/link`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name: nameInput.value.trim() || undefined, note: noteInput.value.trim() || undefined,
        expiry_days: Number.isFinite(days) && days >= 1 && days <= 3650 ? days : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    say(I18N.t('fsvc.linkCreated'), '--status-ok');
    if (data.short_url) {
      resultEl.innerHTML = `<div class="fsvc-result-box">
        <div class="fsvc-caption">${escapeHtml(I18N.t('fsvc.uploadResultLabel'))}</div>
        <div class="fsvc-result-url">${escapeHtml(data.short_url)}
          <button class="btn-mini admin-only" data-action="fsvcCopyResultLink" data-url="${escapeHtml(data.short_url)}">${escapeHtml(I18N.t('fsvc.copyBtn'))}</button>
        </div></div>`;
    }
    urlInput.value = nameInput.value = expiresInput.value = noteInput.value = '';
    await loadFileList();
  } catch (e) {
    say(I18N.t('fsvc.linkFailed') + e.message, '--status-bad');
  }
}

// Handle revoke button
async function handleRevoke(fileId) {

  try {
    const res = await fetch(`${API}/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    if (!data.ok) throw new Error(data.error || 'Unknown error');

    // Reload list
    await loadFileList();
  } catch (e) {
    alert(I18N.t('fsvc.revokeFailed') + e.message);
  }
}

// Attach event listeners to file list
function attachFileListeners() {
  const container = document.getElementById('filesListContainer');
  if (!container) return;

  if (container.dataset.bound) return;   // เดิมผูกซ้ำทุกครั้งที่โหลดรายการ = กดหนึ่งครั้งทำงานหลายรอบ
  container.dataset.bound = '1';
  container.addEventListener('click', (e) => {
    const det = e.target.closest('[data-action^="fsvcD"]');
    if (det) { fsvcDetailAction(det); return; }
    const copyBtn = e.target.closest('[data-action="fsvcCopyLink"]');
    if (copyBtn) {
      const url = copyBtn.dataset.url;
      if (url) copyToClipboard(url, copyBtn);
      return;
    }

    const revokeBtn = e.target.closest('[data-action="fsvcRevoke"]');
    if (revokeBtn) {
      const id = revokeBtn.dataset.id;
      if (id && fsvcArmed(revokeBtn)) handleRevoke(id);
      return;
    }
  });
}

// Render main page
function renderFilesPage() {
  const main = document.getElementById('filesMain');
  if (!main) return;

  main.innerHTML =
    `<div class="fsvc-cols">
       <div class="fsvc-col">
         ${renderUploadCard()}
       </div>
       <div class="fsvc-col" id="filesListContainer"></div>
     </div>`;

  // Attach upload handler
  const uploadBtn = main.querySelector('[data-action="fsvcUpload"]');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', handleFileUpload);
  }

  main.querySelector('[data-action="fsvcCreateLink"]')?.addEventListener('click', handleCreateLink);

  // Handle copy link in upload result
  main.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-action="fsvcMode"]');
    if (mode) {   // ไฟล์ / ลิงก์ภายนอก — สลับช่องที่แสดง (อายุ + หมายเหตุใช้ร่วมกัน)
      main.querySelectorAll('[data-action="fsvcMode"]').forEach((b) => {
        const on = b === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
      });
      main.querySelectorAll('[data-fsvc-mode]').forEach((el) => { el.hidden = el.dataset.fsvcMode !== mode.dataset.mode; });
      document.getElementById('fsvcUploadMsg').textContent = '';
      return;
    }
    const btn = e.target.closest('[data-action="fsvcCopyResultLink"]');
    if (btn) {
      const url = btn.dataset.url;
      if (url) copyToClipboard(url, btn);
    }
  });

  // Load initial file list
  loadFileList();
}

// Global entry point called by dashboard.js
function loadFiles() {
  renderFilesPage();
}

// Init on page show (called by showPage in dashboard.js)
function initFilesPageOnce() {
  renderFilesPage();
}


// ── รายละเอียดรายไฟล์: ลิงก์สั้น/ลิงก์ต่อผู้รับ · ภาพพรีวิว Social · สถิติการเปิด (migration 266) ──────────
let _fsvcOpenId = null;
const _FSVC_DEV = { mobile: 'fsvc.dev_mobile', tablet: 'fsvc.dev_tablet', desktop: 'fsvc.dev_desktop', unknown: 'fsvc.dev_unknown' };
const _fsvcName = (n) => (_FSVC_DEV[n] ? I18N.t(_FSVC_DEV[n]) : n);
const _fsvcBar = (rows, total) => rows.length
  ? rows.slice(0, 8).map((r) => `<div class="fsvc-bar"><span class="fsvc-bar-k">${escapeHtml(r.day || _fsvcName(r.name))}</span>
      <span class="fsvc-bar-t"><span style="width:${Math.max(3, Math.round((r.n / Math.max(1, total)) * 100))}%"></span></span>
      <span class="fsvc-bar-n">${r.n.toLocaleString()}</span></div>`).join('')
  : `<div class="fsvc-empty">—</div>`;
const _fsvcTime = (t) => t ? new Date(t).toLocaleString((I18N.getLang?.() || 'th') === 'th' ? 'th-TH' : 'en-GB', { hour12: false }) : '—';

// ── ป้องกันการกดพลาด ───────────────────────────────────────────────
// ปุ่มลบ/เพิกถอน: กดครั้งแรก = ปุ่มเปลี่ยนเป็น "กดอีกครั้งเพื่อยืนยัน" 4 วินาที · กดซ้ำในเวลานั้นจึงทำจริง
function fsvcArmed(btn) {
  if (btn.dataset.armed === '1') { clearTimeout(btn._disarm); btn.dataset.armed = ''; return true; }
  btn.dataset.armed = '1';
  btn._label = btn._label || btn.textContent;
  btn.textContent = I18N.t('fsvc.confirmAgain');
  btn.classList.add('fsvc-armed');
  btn._disarm = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = btn._label; btn.classList.remove('fsvc-armed'); }, 4000);
  return false;
}

// ── Modal รายละเอียด ─────────────────────────────────────────────────
// ปิดได้ 3 ทาง: ปุ่ม × · ปุ่ม "ปิด" · Esc — คลิกพื้นหลังไม่ปิด (กันปิดพลาด) ·
// มีหัวข้อ/คำอธิบายที่ยังไม่บันทึก → ถามก่อนปิด
let _fsvcDirty = false;
function fsvcModal() {
  let m = document.getElementById('fsvcModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'fsvcModal';
  m.className = 'modal-bg hidden fsvc-modal-bg';
  m.innerHTML = `<div class="modal lg fsvc-modal" role="dialog" aria-modal="true" aria-labelledby="fsvcModalTitle">
      <div class="modal-header">
        <h2 id="fsvcModalTitle"></h2>
        <button class="modal-close" data-action="fsvcDClose" aria-label="${escapeHtml(I18N.t('fsvc.close'))}">&times;</button>
      </div>
      <div class="modal-body" id="fsvcModalBody"></div>
      <div class="modal-footer"><button class="btn btn-secondary" data-action="fsvcDClose">${escapeHtml(I18N.t('fsvc.close'))}</button></div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => {
    const det = e.target.closest('[data-action^="fsvcD"]');
    if (det) { fsvcDetailAction(det); return; }
    const copyBtn = e.target.closest('[data-action="fsvcCopyLink"]');
    if (copyBtn && copyBtn.dataset.url) copyToClipboard(copyBtn.dataset.url, copyBtn);
  });
  m.addEventListener('input', (e) => { if (e.target.id === 'fsvcOgTitle' || e.target.id === 'fsvcOgDesc') _fsvcDirty = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.classList.contains('hidden')) fsvcCloseModal(); });
  return m;
}
function fsvcCloseModal() {
  const m = document.getElementById('fsvcModal');
  if (!m || m.classList.contains('hidden')) return;
  if (_fsvcDirty && !confirm(I18N.t('fsvc.unsavedClose'))) return;
  _fsvcDirty = false;
  _fsvcOpenId = null;
  m.classList.add('hidden');
  document.body.classList.remove('fsvc-modal-open');
  loadFileList();   // ยอดการเปิด/ลิงก์ในตารางให้ตรงกับที่เพิ่งแก้
}

async function fsvcLoadDetail(id) {
  _fsvcOpenId = id;
  const m = fsvcModal();
  const body = document.getElementById('fsvcModalBody');
  if (m.classList.contains('hidden')) {
    m.classList.remove('hidden');
    document.body.classList.add('fsvc-modal-open');
    _fsvcDirty = false;
    m.querySelector('.modal-close').focus();
  }
  body.innerHTML = `<div class="fsvc-empty">${escapeHtml(I18N.t('common.loading', 'กำลังโหลด…'))}</div>`;
  try {
    const r = await fetch(`${API}/api/files/${encodeURIComponent(id)}/clicks`, { credentials: 'include', cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    document.getElementById('fsvcModalTitle').textContent = d.file.original_name;
    body.innerHTML = fsvcRenderDetail(d);
    _fsvcDirty = false;
  } catch (e) {
    body.innerHTML = `<div class="fsvc-empty">${escapeHtml(I18N.t('fsvc.loadFailed') + e.message)}</div>`;
  }
}

function fsvcRenderDetail(d) {
  const f = d.file, s = d.summary, T = (k) => escapeHtml(I18N.t(k));
  const links = d.links.map((l) => `<tr>
      <td data-label="${T('fsvc.linkLabel')}">${escapeHtml(l.label || I18N.t('fsvc.linkDefault'))}</td>
      <td class="fsvc-short" data-label="${T('fsvc.colLink')}">${escapeHtml((l.short_url || '').replace(/^https?:\/\//, ''))}</td>
      <td data-label="${T('fsvc.colClicks')}">${l.clicks.toLocaleString()}</td>
      <td data-label="${T('fsvc.colLastClick')}">${_fsvcTime(l.last_click_at)}</td>
      <td class="fsvc-actions">${l.revoked_at ? `<span class="fsvc-pill" style="color:var(--status-bad)">${T('fsvc.statusRevoked')}</span>` : `
        <button class="btn-mini" data-action="fsvcCopyLink" data-url="${escapeHtml(l.short_url || '')}">${T('fsvc.copyBtn')}</button>
        <button class="btn-mini btn-danger" data-action="fsvcDLinkRevoke" data-link="${l.id}">${T('fsvc.revokeBtn')}</button>`}</td></tr>`).join('');
  const recent = d.recent.slice(0, 100).map((c) => `<tr class="${c.bot || c.status !== 200 ? 'fsvc-dim' : ''}">
      <td data-label="${T('fsvc.colTime')}">${_fsvcTime(c.clicked_at)}</td>
      <td data-label="${T('fsvc.linkLabel')}">${escapeHtml(c.link_label || (c.via === 'signed' ? I18N.t('fsvc.viaSigned') : I18N.t('fsvc.linkDefault')))}</td>
      <td data-label="${T('fsvc.colOpenedWith')}">${escapeHtml(c.bot ? I18N.t('fsvc.botLabel') : [c.app, c.browser].filter(Boolean).join(' · ') || '—')}</td>
      <td data-label="${T('fsvc.colDevice')}">${escapeHtml([c.os, c.device && _fsvcName(c.device)].filter(Boolean).join(' · ') || '—')}</td>
      <td data-label="${T('fsvc.colCountry')}">${escapeHtml(c.country || '—')}</td>
      <td class="fsvc-mono" data-label="IP">${escapeHtml(c.ip || '—')}</td>
      <td class="fsvc-ua" data-label="User agent" title="${escapeHtml(c.user_agent || '')}">${escapeHtml((c.user_agent || '').slice(0, 60))}</td></tr>`).join('');
  const st = getStatusDisplay(f);
  const live = !f.revoked_at;
  const isLink = !!f.target_url;
  const ymd = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const vers = (d.versions || []).map((v) => `<tr>
      <td data-label="${T('fsvc.colVersion')}">v${v.version}</td>
      <td data-label="${T('fsvc.colSize')}">${escapeHtml(formatBytes(v.bytes))}</td>
      <td data-label="${T('fsvc.colReplacedBy')}">${escapeHtml(v.replaced_by || '—')}</td>
      <td data-label="${T('fsvc.colReplacedAt')}">${_fsvcTime(v.replaced_at)}</td>
      <td class="fsvc-actions">${live ? `<button class="btn-mini" data-action="fsvcDRestore" data-id="${f.id}" data-v="${v.version}">${T('fsvc.restoreBtn')}</button>` : ''}</td></tr>`).join('');
  return `<div class="fsvc-detail">
    <div class="fsvc-detail-meta"><span class="fsvc-pill" style="background:${token(st.tone)}26;color:var(${st.tone})">${escapeHtml(st.status)}</span>
      ${isLink ? fsvcChip() : ''}
      <span>${escapeHtml([isLink ? fsvcLinkDesc(f) : formatBytes(f.bytes), f.uploaded_by, formatDate(f.uploaded_at)].filter(Boolean).join(' · '))}</span>
      ${f.allow_scripts ? `<span class="fsvc-pill fsvc-pill-js">${T('fsvc.scriptsBadge')}</span>` : ''}</div>
    <div class="fsvc-stats">
      <div><b>${s.opens.toLocaleString()}</b><span>${T('fsvc.statOpens')}</span></div>
      <div><b>${s.visitors.toLocaleString()}</b><span>${T('fsvc.statVisitors')}</span></div>
      <div><b>${s.bots.toLocaleString()}</b><span>${T('fsvc.statBots')}</span></div>
      <div><b>${_fsvcTime(s.last_at)}</b><span>${T('fsvc.statLast')}</span></div>
    </div>

    ${isLink ? `<h4 class="fsvc-sub">${T('fsvc.targetTitle')}</h4>
    ${live ? `<div class="fsvc-inline fsvc-wrap">
      <input id="fsvcTarget" type="url" class="form-input" inputmode="url" maxlength="2048" value="${escapeHtml(f.target_url)}" aria-label="${T('fsvc.urlLabel')}">
      <button class="btn btn-secondary" data-action="fsvcDTarget" data-id="${f.id}">${T('fsvc.save')}</button>
      <span id="fsvcTargetMsg" class="fsvc-msg"></span>
    </div>` : `<div class="fsvc-short">${escapeHtml(f.target_url)}</div>`}` : ''}

    ${live ? `<h4 class="fsvc-sub">${isLink ? T('fsvc.expiryTitle') : T('fsvc.verTitle')}</h4>
    <div class="fsvc-inline fsvc-wrap">
      ${isLink ? '' : `<span>${T('fsvc.verCurrent')} <b>v${f.version || 1}</b></span>`}
      <label for="fsvcExpiry">${T('fsvc.expiresOn')}</label>
      <input id="fsvcExpiry" type="date" class="form-input" min="${ymd(Date.now() + 86400000)}" value="${f.expires_at ? ymd(f.expires_at) : ''}">
      <button class="btn btn-secondary" data-action="fsvcDExpiry" data-id="${f.id}">${T('fsvc.save')}</button>
      ${isLink ? '<span id="fsvcVerMsg" class="fsvc-msg"></span>' : ''}
    </div>
    ${isLink ? '' : `<div class="fsvc-inline fsvc-wrap">
      <label for="fsvcReplaceFile">${T('fsvc.replacePick')}</label>
      <input id="fsvcReplaceFile" type="file" class="form-input">
      ${f.mime === 'text/html' ? `<label class="fsvc-check" for="fsvcReplaceScripts"><input id="fsvcReplaceScripts" type="checkbox" ${f.allow_scripts ? 'checked' : ''}> ${T('fsvc.allowScripts')}</label>
      <label class="fsvc-check" for="fsvcReplacePreview"><input id="fsvcReplacePreview" type="checkbox" checked> ${T('fsvc.refreshPreview')}</label>` : ''}
      <button class="btn btn-primary" data-action="fsvcDReplace" data-id="${f.id}">${T('fsvc.replaceBtn')}</button>
      <span id="fsvcVerMsg" class="fsvc-msg"></span>
    </div>`}
    ${vers ? `<div class="fsvc-table-wrap"><table class="fsvc-table"><thead><tr><th>${T('fsvc.colVersion')}</th><th>${T('fsvc.colSize')}</th><th>${T('fsvc.colReplacedBy')}</th><th>${T('fsvc.colReplacedAt')}</th><th></th></tr></thead><tbody>${vers}</tbody></table></div>` : ''}` : ''}

    <h4 class="fsvc-sub">${T('fsvc.previewTitle')}</h4>
    <div class="fsvc-og${isLink ? ' fsvc-og-noimg' : ''}">
      ${isLink ? '' : `<div class="fsvc-og-img">${f.has_preview ? `<img src="${API}/api/files/${f.id}/preview.png?t=${Date.now()}" alt="">` : `<span>${T('fsvc.noPreview')}</span>`}</div>`}
      <div class="fsvc-og-form">
        <label for="fsvcOgTitle">${T('fsvc.ogTitle')}</label>
        <input id="fsvcOgTitle" class="form-input" maxlength="200" value="${escapeHtml(f.og_title || '')}" placeholder="${escapeHtml(f.original_name)}">
        <label for="fsvcOgDesc">${T('fsvc.ogDesc')}</label>
        <input id="fsvcOgDesc" class="form-input" maxlength="500" value="${escapeHtml(f.og_description || '')}" placeholder="${escapeHtml(f.note || '')}">
        <div class="fsvc-inline fsvc-wrap">
          <button class="btn btn-primary" data-action="fsvcDMetaSave" data-id="${f.id}">${T('fsvc.save')}</button>
          ${isLink ? '' : `<label class="btn btn-secondary" for="fsvcOgFile">${T('fsvc.uploadPreview')}</label>
          <input id="fsvcOgFile" type="file" accept="image/png,image/jpeg,image/webp" hidden data-id="${f.id}">`}
          ${f.mime === 'text/html' ? `<button class="btn btn-secondary" data-action="fsvcDAutoPreview" data-id="${f.id}">${T('fsvc.autoPreview')}</button>` : ''}
          <span id="fsvcOgMsg" class="fsvc-msg"></span>
        </div>
      </div>
    </div>

    <h4 class="fsvc-sub">${T('fsvc.linksTitle')}</h4>
    <div class="fsvc-table-wrap"><table class="fsvc-table"><thead><tr><th>${T('fsvc.linkLabel')}</th><th>${T('fsvc.colLink')}</th><th>${T('fsvc.colClicks')}</th><th>${T('fsvc.colLastClick')}</th><th></th></tr></thead><tbody>${links}</tbody></table></div>
    <div class="fsvc-inline fsvc-wrap">
      <input id="fsvcLinkLabel" class="form-input" maxlength="120" placeholder="${T('fsvc.linkLabelPh')}">
      <button class="btn btn-secondary" data-action="fsvcDLinkAdd" data-id="${f.id}">${T('fsvc.linkAdd')}</button>
    </div>

    ${s.opens || s.bots ? `<div class="fsvc-breakdown">
      <div><h4 class="fsvc-sub">${T('fsvc.byApp')}</h4>${_fsvcBar(d.by_app, s.opens)}</div>
      <div><h4 class="fsvc-sub">${T('fsvc.byBrowser')}</h4>${_fsvcBar(d.by_browser, s.opens)}</div>
      <div><h4 class="fsvc-sub">${T('fsvc.byOs')}</h4>${_fsvcBar(d.by_os, s.opens)}</div>
      <div><h4 class="fsvc-sub">${T('fsvc.byDevice')}</h4>${_fsvcBar(d.by_device, s.opens)}</div>
      <div><h4 class="fsvc-sub">${T('fsvc.byCountry')}</h4>${_fsvcBar(d.by_country, s.opens)}</div>
      <div><h4 class="fsvc-sub">${T('fsvc.perDay')}</h4>${_fsvcBar(d.per_day.slice(-8).reverse(), Math.max(1, ...d.per_day.map((x) => x.n)))}</div>
    </div>` : ''}

    <h4 class="fsvc-sub">${T('fsvc.recentTitle')}</h4>
    ${recent ? `<div class="fsvc-table-wrap fsvc-scroll"><table class="fsvc-table fsvc-clicks"><thead><tr><th>${T('fsvc.colTime')}</th><th>${T('fsvc.linkLabel')}</th><th>${T('fsvc.colOpenedWith')}</th><th>${T('fsvc.colDevice')}</th><th>${T('fsvc.colCountry')}</th><th>IP</th><th>User agent</th></tr></thead><tbody>${recent}</tbody></table></div>` : `<div class="fsvc-empty">${T('fsvc.noClicks')}</div>`}
  </div>`;
}

async function fsvcDetailAction(el) {
  const a = el.dataset.action, id = el.dataset.id;
  const msg = (t, bad) => { const m = document.getElementById('fsvcOgMsg'); if (m) { m.textContent = t; m.style.color = bad ? 'var(--status-bad)' : 'var(--text-secondary)'; } };
  const vmsg = (t, bad) => { const m = document.getElementById('fsvcVerMsg'); if (m) { m.textContent = t; m.style.color = bad ? 'var(--status-bad)' : 'var(--text-secondary)'; } };
  const call = async (url, opts) => { const r = await fetch(url, { credentials: 'include', ...opts }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
  try {
    if (a === 'fsvcDetail') return fsvcLoadDetail(id);
    if (a === 'fsvcDClose') return fsvcCloseModal();
    if (a === 'fsvcDMetaSave') {
      await call(`${API}/api/files/${id}/meta`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ og_title: document.getElementById('fsvcOgTitle').value, og_description: document.getElementById('fsvcOgDesc').value }) });
      _fsvcDirty = false;
      msg(I18N.t('fsvc.saved'));
      return;
    }
    if (a === 'fsvcDAutoPreview') { msg(I18N.t('fsvc.previewMaking')); await call(`${API}/api/files/${id}/preview?auto=1`, { method: 'POST' }); return fsvcLoadDetail(id); }
    if (a === 'fsvcDLinkAdd') {
      const label = document.getElementById('fsvcLinkLabel').value.trim();
      if (!label) return document.getElementById('fsvcLinkLabel').focus();
      await call(`${API}/api/files/${id}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) });
      return fsvcLoadDetail(id);
    }
    if (a === 'fsvcDExpiry') {
      const v = document.getElementById('fsvcExpiry').value;
      if (!v) return document.getElementById('fsvcExpiry').focus();
      await call(`${API}/api/files/${id}/expiry`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_at: `${v}T23:59:59+07:00` }) });   // สิ้นวันตามเวลาไทย
      await fsvcLoadDetail(id);
      return vmsg(I18N.t('fsvc.expirySaved'));
    }
    if (a === 'fsvcDReplace') {
      const file = document.getElementById('fsvcReplaceFile').files[0];
      if (!file) return document.getElementById('fsvcReplaceFile').focus();
      if (!fsvcArmed(el)) return;
      const fd = new FormData();
      fd.append('file', file);
      const js = document.getElementById('fsvcReplaceScripts');
      if (js) fd.append('allow_scripts', js.checked ? 'true' : 'false');
      if (document.getElementById('fsvcReplacePreview')?.checked) fd.append('refresh_preview', '1');
      vmsg(I18N.t('fsvc.uploading'));
      await call(`${API}/api/files/${id}/replace`, { method: 'POST', body: fd });
      await fsvcLoadDetail(id);
      return vmsg(I18N.t('fsvc.replaced'));
    }
    if (a === 'fsvcDTarget') {
      const tm = document.getElementById('fsvcTargetMsg');
      try {
        await call(`${API}/api/files/${id}/target`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: document.getElementById('fsvcTarget').value.trim() }) });
      } catch (err) { tm.textContent = I18N.t('fsvc.saveFailed') + err.message; tm.style.color = 'var(--status-bad)'; return; }
      await fsvcLoadDetail(id);
      const m2 = document.getElementById('fsvcTargetMsg'); if (m2) m2.textContent = I18N.t('fsvc.targetSaved');
      return;
    }
    if (a === 'fsvcDRestore') {
      if (!fsvcArmed(el)) return;
      await call(`${API}/api/files/${id}/versions/${el.dataset.v}/restore`, { method: 'POST' });
      await fsvcLoadDetail(id);
      return vmsg(I18N.t('fsvc.restored'));
    }
    if (a === 'fsvcDLinkRevoke') {
      if (!fsvcArmed(el)) return;
      await call(`${API}/api/files/links/${el.dataset.link}`, { method: 'DELETE' });
      return fsvcLoadDetail(_fsvcOpenId);
    }
  } catch (e) {
    const ver = /^fsvcD(Expiry|Replace|Restore)$/.test(a);
    (ver ? vmsg : msg)((ver ? '' : I18N.t('fsvc.uploadFailed')) + e.message, true);
    if (!document.getElementById(ver ? 'fsvcVerMsg' : 'fsvcOgMsg')) alert(e.message);
  }
}

// อัปภาพพรีวิวเอง — input[type=file] อยู่ในแผงรายละเอียด
document.addEventListener('change', async (e) => {
  if (e.target?.id !== 'fsvcOgFile' || !e.target.files?.[0]) return;
  const fd = new FormData(); fd.append('file', e.target.files[0]);
  const m = document.getElementById('fsvcOgMsg'); if (m) m.textContent = I18N.t('fsvc.uploading');
  try {
    const r = await fetch(`${API}/api/files/${e.target.dataset.id}/preview`, { method: 'POST', credentials: 'include', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    fsvcLoadDetail(e.target.dataset.id);
  } catch (err) { if (m) { m.textContent = I18N.t('fsvc.uploadFailed') + err.message; m.style.color = 'var(--status-bad)'; } }
});
