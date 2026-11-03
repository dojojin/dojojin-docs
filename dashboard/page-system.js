// ============================================================
// Vigil Platform — System Settings Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// ⚙️ System Settings
// ============================================================
const SETTING_LABELS = {
  data_retention_days:         { label: I18N.t('sys.dataRetentionLabel'),    input: 'number', min: 1, max: 730, hint: I18N.t('sys.dataRetentionHint') },
  appearances_retention_days:  { label: I18N.t('sys.appRetentionLabel'),     input: 'number', min: 1, max: 730, hint: I18N.t('sys.appRetentionHint') },
  snapshot_retention_days: { label: I18N.t('sys.snapRetentionLabel'), input: 'number',  min: 1, max: 365, hint: I18N.t('sys.snapRetentionHint') },
  clip_retention_days:     { label: I18N.t('sys.clipRetentionLabel'), input: 'number',  min: 1, max: 90,  hint: I18N.t('sys.clipRetentionHint') },
  custom_range_max_days:   { label: I18N.t('sys.customRangeLabel'),   input: 'number',  min: 1, max: 730, hint: I18N.t('sys.customRangeHint') },
  display_timezone:        { label: I18N.t('sys.timezoneLabel'),      input: 'select',  options: ['Asia/Bangkok','UTC','Asia/Tokyo','Asia/Singapore'], hint: I18N.t('sys.timezoneHint') },
  counter_dedup_mode:      { label: I18N.t('sys.dedupLabel'),         input: 'select',  options: ['state','object_window','none'], hint: I18N.t('sys.dedupHint') },
  comparison_mode:         { label: I18N.t('sys.comparisonLabel'),    input: 'select',  options: ['rolling','calendar'], hint: I18N.t('sys.comparisonHint') },
  // ข้อความที่ผู้ใช้ที่ถูกจำกัดสิทธิ์เห็น (decision #251/#254) — ชุดเดียวทั้งระบบตามที่เจ้าของเลือก
  restricted_view_message: { label: I18N.t('set.restrictedMsgLabel'), input: 'text', maxlength: 300, hint: I18N.t('set.restrictedMsgHint') },
  // นโยบายล็อคบัญชีเมื่อ login ผิดซ้ำ (migration 196, owner ask 2026-09-03) —
  // ขอบเขตต้องตรงกับ validator ใน routes/settings.js
  login_max_failed:      { label: I18N.t('sys.loginMaxFailedLabel'), input: 'number', min: 3, max: 20,   hint: I18N.t('sys.loginMaxFailedHint') },
  login_lockout_minutes: { label: I18N.t('sys.loginLockoutLabel'),   input: 'number', min: 1, max: 1440, hint: I18N.t('sys.loginLockoutHint') },
  // migration 236 — backup.sh / backup-offsite.sh อ่านค่าพวกนี้ตรง ๆ ผ่าน psql ก่อน
  // รันทุกครั้ง (สคริปต์เป็น bash ไม่ผ่าน getSystemSetting) ขอบเขตต้องตรงกับ validator
  // ใน routes/settings.js — ดู GOTCHAS #212
  backup_local_retain_days: { label: I18N.t('sys.backupLocalRetainLabel'), input: 'number', min: 1, max: 90, hint: I18N.t('sys.backupLocalRetainHint') },
  backup_cloud_retain_days: { label: I18N.t('sys.backupCloudRetainLabel'), input: 'number', min: 1, max: 90, hint: I18N.t('sys.backupCloudRetainHint') },
  backup_schedule_time:     { label: I18N.t('sys.backupScheduleLabel'),   input: 'text', maxlength: 5, hint: I18N.t('sys.backupScheduleHint') },
};

function openSystemSettings() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('system');
}
function closeSystemSettings() { /* system is a Settings Workspace section now — no modal */ }

function _renderSitesBlock(sites) {
  _ssSites = sites;
  const rows = sites.map((s, i) => {
    const canDelete = s.code !== 'main' && s.camera_count === 0;
    // ปุ่มเลื่อนอยู่ "ซ้ายสุด" ติดจุดสี ไม่ใช่ต่อท้ายกลุ่มปุ่มขวา — แถวนี้กว้างที่สุด
    // ในหน้า Settings อยู่แล้ว กลุ่มขวาคือส่วนที่ล้นก่อนเพื่อนเมื่อจอแคบ
    const arrow = (dir, disabled, label) =>
      `<button class="btn btn-secondary" style="font-size:11px;padding:1px 5px;line-height:1.2;min-width:20px${disabled ? ';opacity:.35;cursor:default' : ''}"
        ${disabled ? 'disabled' : `data-action="moveSite" data-id="${s.id}" data-dir="${dir}"`}
        title="${escapeHtml(label)}">${dir < 0 ? '\u25B2' : '\u25BC'}</button>`;
    const isArch = s.status === 'archived';
    const inMaint = !!s.status && s.status !== 'active';
    const maintTip = inMaint ? [
      s.status_since ? new Date(s.status_since).toLocaleString('th-TH', { hour12: false }) : '',
      s.status_by ? `${I18N.t('sys.maintBy', 'โดย')} ${s.status_by}` : '',
      s.status_note || '',
    ].filter(Boolean).join(' · ') : '';
    const chipColor = isArch ? 'var(--text-secondary)' : 'var(--warn)';
    const chipLabel = isArch ? I18N.t('sys.archivedChip', 'เก็บถาวร') : I18N.t('sys.maintChip', 'ปิดปรับปรุง');
    const maintChip = inMaint
      ? ` <span title="${escapeHtml(maintTip)}" style="display:inline-block;margin-left:4px;padding:1px 7px;border:1px solid ${chipColor};border-radius:99px;color:${chipColor};font-size:10px;font-weight:700;white-space:nowrap">${escapeHtml(chipLabel)}</span>`
      : '';
    // archived ไปทาง active อย่างเดียว (เลิกเก็บถาวร) · archive ได้เฉพาะจาก maintenance — active ต้องผ่าน maintenance ก่อน
    const maintBtn = s.code !== 'main' && !isArch
      ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="siteMaintenance" data-id="${s.id}">${escapeHtml(inMaint ? I18N.t('sys.maintEndBtn', 'เลิกปิดปรับปรุง') : I18N.t('sys.maintBtn', 'ปิดปรับปรุง'))}</button>`
      : '';
    const archiveBtn = s.code === 'main' ? ''
      : isArch ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="siteUnarchive" data-id="${s.id}">${escapeHtml(I18N.t('sys.unarchiveBtn', 'เลิกเก็บถาวร'))}</button>`
      : s.status === 'maintenance' ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="siteArchive" data-id="${s.id}">${escapeHtml(I18N.t('sys.archiveBtn', 'เก็บถาวร'))}</button>`
      : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-hairline);flex-wrap:wrap">
      <span style="display:flex;gap:2px;flex-shrink:0">
        ${arrow(-1, i === 0, I18N.t('sys.moveUp', 'เลื่อนขึ้น'))}${arrow(1, i === sites.length - 1, I18N.t('sys.moveDown', 'เลื่อนลง'))}
      </span>
      <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(s.color)};flex-shrink:0"></span>
      <span style="flex:1;font-size:12px;font-weight:600">${escapeHtml(s.name)}${maintChip}</span>
      <span style="font-size:10px;color:var(--text-secondary)">${escapeHtml(s.code)}</span>
      <span style="font-size:10px;color:var(--text-secondary);min-width:48px;text-align:right">${s.camera_count} ${I18N.t('sys.camerasUnit','กล้อง')}</span>
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="provisionSiteEdge" data-id="${s.id}" data-code="${escapeHtml(s.code)}" title="${escapeHtml(I18N.t('sys.provisionEdge','สร้าง credentials สำหรับ edge bridge'))}">${escapeHtml(I18N.t('sys.provisionEdgeBtn', 'ออกรหัส Edge ใหม่'))}</button>
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="pushSiteConfig" data-id="${s.id}" data-code="${escapeHtml(s.code)}" title="${escapeHtml(I18N.t('sys.pushConfig','ส่ง camera config ปัจจุบันไปที่ edge (bootstrap ครั้งแรก / force-resync)'))}">Push Config ↻</button>
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="siteRetention" data-id="${s.id}" title="${escapeHtml(I18N.t('sys.retTitle','อายุการเก็บรูปที่ edge ของไซต์นี้'))}">${I18N.t('sys.retBtn','อายุรูป')} ${_retSummary(s)}</button>
      ${maintBtn}
      ${archiveBtn}
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="editSite" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-color="${escapeHtml(s.color)}" data-code="${escapeHtml(s.code)}">${I18N.t('common.edit','แก้ไข')}</button>
      ${s.code !== 'main' && inMaint
        ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" data-action="sitePurgeOpen" data-id="${s.id}">${escapeHtml(I18N.t('sys.purgeBtn', 'ลบไซต์'))}</button>`
        : canDelete ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" data-action="deleteSite" data-id="${s.id}" data-name="${escapeHtml(s.name)}">${I18N.t('common.delete','ลบ')}</button>` : ''}
    </div>`;
  }).join('');
  return `<div style="margin-bottom:14px;padding:12px;background:var(--surface-overlay);border-radius:8px">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">${I18N.t('sys.sitesSection','จัดการ Sites')}</div>
    <div id="ss_sites_list">${rows}</div>
    <div id="ss_site_form" style="display:none;margin-top:10px;padding:10px;background:var(--surface-base);border-radius:6px">
      <input type="hidden" id="ss_site_edit_id">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
        <div><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${I18N.t('sys.siteCodeLabel','รหัส (code)')}</div>
          <input type="text" class="form-input" id="ss_site_code" placeholder="${escapeHtml(I18N.t('sys.siteCodePh','เช่น phuket'))}" style="font-size:12px;max-width:120px"></div>
        <div><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${I18N.t('sys.siteNameLabel','ชื่อ')}</div>
          <input type="text" class="form-input" id="ss_site_name" placeholder="${escapeHtml(I18N.t('sys.siteNamePh','ชื่อ Site'))}" style="font-size:12px;max-width:150px"></div>
        <div><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${I18N.t('sys.siteColorLabel','สี')}</div>
          <input type="color" id="ss_site_color" value="#6366f1" style="width:36px;height:30px;padding:2px;border:1px solid var(--border-hairline);border-radius:4px;cursor:pointer"></div>
        <button class="btn btn-primary" style="font-size:11px;padding:5px 10px" data-action="saveSiteForm">${I18N.t('common.save','บันทึก')}</button>
        <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" data-action="cancelSiteForm">${I18N.t('common.cancel','ยกเลิก')}</button>
      </div>
    </div>
    <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px;margin-top:8px" data-action="addSite">${I18N.t('sys.addSite','+ เพิ่ม Site')}</button>
  </div>`;
}

// สลับสองแถวที่ติดกันแล้วส่ง "ทั้งรายการ" กลับไป · ทาสีทันทีก่อนรอ network เพราะ
// การกดเลื่อนที่ค้างครึ่งวินาทีรู้สึกเหมือนปุ่มเสีย · ถ้าเซิร์ฟเวอร์ปฏิเสธ เราโหลดใหม่
// ทั้งบล็อกเพื่อไม่ให้หน้าจอค้างอยู่กับลำดับที่ยังไม่ได้บันทึก
async function moveSite(el) {
  const id  = parseInt(el.dataset.id, 10);
  const dir = parseInt(el.dataset.dir, 10);
  const arr = Array.isArray(_ssSites) ? _ssSites.slice() : [];
  const i = arr.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];

  const list = document.getElementById('ss_sites_list');
  _ssSites = arr;
  if (list) {
    // _renderSitesBlock คืนทั้งกล่อง เอาเฉพาะรายการแถวมาใส่กลับ
    const tmp = document.createElement('div');
    tmp.innerHTML = _renderSitesBlock(arr);
    const fresh = tmp.querySelector('#ss_sites_list');
    if (fresh) list.innerHTML = fresh.innerHTML;
  }

  try {
    const r = await fetch(`${API}/api/sites/order`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: arr.map(x => x.id) }),
    });
    if (!r.ok) {
      const j2 = await r.json().catch(() => ({}));
      alert(I18N.t('sys.orderFailed', 'บันทึกลำดับไม่สำเร็จ: ') + (j2.error || `HTTP ${r.status}`));
      loadSystemSettings();
    }
  } catch (e) {
    alert(I18N.t('sys.orderFailed', 'บันทึกลำดับไม่สำเร็จ: ') + e.message);
    loadSystemSettings();
  }
}

// ── ซ่อน/แสดงเมนู sidebar (migration 141) ────────────────────────────
// อ่านรายการเมนูจาก DOM จริง ไม่ hardcode — เพิ่มเมนูใหม่ในอนาคตจะโผล่มาเองที่นี่
// โดยไม่ต้องมาแก้ไฟล์นี้ซ้ำ (จุดที่ลิสต์ซ้ำกันสองที่คือจุดที่ดริฟต์เงียบ)
function _navItemsForVisibility() {
  return [...document.querySelectorAll('.sidebar .nav-item[data-page]')].map(el => ({
    page: el.dataset.page,
    label: el.querySelector('[data-i18n]')?.textContent?.trim() || el.dataset.page,
    adminOnly: el.classList.contains('admin-only'),
  }));
}

function _renderNavVisibilityBlock(settings) {
  let hidden = [];
  try { hidden = JSON.parse(settings.nav_hidden_pages?.value || '[]'); } catch { hidden = []; }
  const items = _navItemsForVisibility();
  if (!items.length) return '';
  const rows = items.map(it => {
    const locked = it.page === 'settings';   // ซ่อนแล้วกลับมาเปิดไม่ได้ — ล็อกไว้
    const on = !hidden.includes(it.page);
    return `<label class="navvis-row${locked ? ' locked' : ''}">
      <input type="checkbox" data-navvis="${escapeHtml(it.page)}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      <span class="navvis-name">${escapeHtml(it.label)}</span>
      ${it.adminOnly ? `<span class="navvis-tag">admin</span>` : ''}
      ${locked ? `<span class="navvis-tag warn">${escapeHtml(I18N.t('sys.navLocked', 'ซ่อนไม่ได้'))}</span>` : ''}
    </label>`;
  }).join('');
  return `
    <div style="margin-top:18px;padding:14px;background:var(--surface-overlay);border:1px solid var(--border-hairline);border-radius:8px">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px">
        <svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px;margin-right:4px"><use href="#icon-settings"/></svg>
        ${escapeHtml(I18N.t('sys.navVisTitle', 'เมนูที่แสดงในแถบด้านซ้าย'))}
      </div>
      <div style="font-size:10px;color:var(--text-secondary);margin-bottom:10px">
        ${escapeHtml(I18N.t('sys.navVisHint', 'ติ๊กออกเพื่อซ่อนเมนูที่ไม่ได้ใช้ · มีผลกับผู้ใช้ทุกคน · การซ่อนไม่ได้ปิดสิทธิ์เข้าถึง เป็นการจัดหน้าจอเท่านั้น'))}
      </div>
      <div class="navvis-grid">${rows}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveNavVisibility">
          <svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> ${escapeHtml(I18N.t('common.save', 'Save'))}
        </button>
        <span id="navVisMsg" style="font-size:11px;color:var(--text-secondary)"></span>
      </div>
    </div>`;
}

// เก็บรายการที่ "ซ่อน" ไม่ใช่ที่ "แสดง" — เมนูใหม่ที่เพิ่มมาทีหลังจะแสดงโดยอัตโนมัติ
// ถ้าเก็บกลับกัน เมนูใหม่จะหายไปเงียบ ๆ ทุกครั้งที่ deploy
async function saveNavVisibility() {
  const msg = document.getElementById('navVisMsg');
  const hidden = [...document.querySelectorAll('[data-navvis]')]
    .filter(cb => !cb.checked && !cb.disabled)
    .map(cb => cb.dataset.navvis);
  try {
    const r = await fetch(`${API}/api/settings/nav_hidden_pages`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(hidden) }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    applyNavVisibility(hidden);
    msg.textContent = I18N.t('sys.navVisSaved', 'บันทึกแล้ว');
    msg.style.color = 'var(--status-ok)';
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = 'var(--status-bad)';
  }
}

// ใช้จริงกับ DOM — เรียกทั้งตอนบูตและหลังบันทึก จะได้ไม่ต้อง reload
// hidden        = nav_hidden_pages (ค่ากลางทั้งระบบ) — ห้ามซ่อน settings กัน admin ล็อกตัวเอง
// perUserHidden = หน้าที่ user คนนี้ไม่มีสิทธิ์ (decision #251) — **ไม่มีข้อยกเว้น settings**
//                 เพราะ operator ที่ถูกจำกัดไม่ควรเห็นหน้าตั้งค่าตั้งแต่ต้น
function applyNavVisibility(hidden, perUserHidden) {
  const set = new Set((hidden || []).filter(p => p !== 'settings'));
  for (const p of (perUserHidden || [])) set.add(p);
  document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(el => {
    el.hidden = set.has(el.dataset.page);
  });
  // เมนูที่จัดกลุ่มแล้ว (decision #245) — ถ้าซ่อนหมดทุกตัวในกลุ่ม หัวกลุ่มก็ต้อง
  // ซ่อนด้วย ไม่งั้นเหลือกลุ่มว่างเปล่าที่กดขยายแล้วไม่มีอะไรอยู่ข้างใน
  // จำกัด: เช็คแค่ el.hidden — รายการที่ถูกซ่อนด้วย CSS ล้วน (license gate เช่น
  // body.no-face/.no-appearance/.no-lpr ใน index.css) จะไม่ถูกนับว่าซ่อน จึงอาจ
  // เหลือกลุ่มว่างได้ถ้าวันหนึ่ง license gate ปิดตัวสุดท้ายที่ไม่ผ่าน nav_hidden_pages
  document.querySelectorAll('.nav-group').forEach(g => {
    const items = g.querySelectorAll('.nav-item[data-page]');
    const allHidden = items.length > 0 && [...items].every(el => el.hidden);
    const head = g.querySelector('.nav-group-head');
    if (head) head.hidden = allHidden;
  });
}
window.applyNavVisibility = applyNavVisibility;

async function loadSystemSettings() {
  try {
    const [res, sitesRes] = await Promise.all([
      fetch(`${API}/api/settings`),
      fetch(`${API}/api/sites`),
    ]);
    if (!res.ok) throw new Error('failed');
    const settings = await res.json();
    const sysSites = sitesRes.ok ? await sitesRes.json() : [];
    const list = document.getElementById('systemSettingsList');

    // ── Branding section (always shown first) ─────────────────
    const brandName    = settings.brand_name?.value          || 'Vigil Platform';
    const brandTagline = settings.brand_tagline?.value       || '';
    const brandLogo    = settings.brand_logo_path?.value     || '';
    const brandFooterLogo = settings.brand_footer_logo_path?.value || '';
    const brandColor   = settings.brand_primary_color?.value || '#5b8def';
    const logoUrl      = brandLogo ? `/branding/${escapeHtml(brandLogo)}?v=${Date.now()}` : '';
    const footerLogoUrl = brandFooterLogo ? `/branding/${escapeHtml(brandFooterLogo)}?v=${Date.now()}` : '';
    const brandingBlock = `
      <div style="margin-bottom:18px;padding:14px;background:var(--surface-overlay);border:1px solid var(--accent);border-radius:8px">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px"><svg aria-hidden="true" width="14" height="14" style="vertical-align:-2px;margin-right:4px"><use href="#icon-settings"/></svg>Branding</div>

        <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px">
          <div style="width:96px;height:96px;background:var(--surface-elevated);border:1px dashed var(--border-hairline);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${logoUrl
              ? `<img id="brandLogoPreview" src="${logoUrl}" style="max-width:100%;max-height:100%;object-fit:contain">`
              : `<img id="brandLogoPreview" style="max-width:100%;max-height:100%;object-fit:contain;display:none">
                 <span style="color:var(--text-secondary);font-size:10px">no logo</span>`}
          </div>
          <div style="flex:1">
            <label class="form-label">Logo</label>
            <input type="file" id="brandLogoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="font-size:11px;width:100%" data-change="uploadBrandLogo">
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">PNG / JPG / WebP / SVG (max 5MB) — server resize to 256×256</div>
            ${brandLogo ? `<button class="csv-btn" style="margin-top:6px" data-action="clearBrandLogo"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px;margin-right:3px"><use href="#icon-trash"/></svg>Remove logo</button>` : ''}
          </div>
        </div>

        <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px">
          <div style="width:96px;height:96px;background:var(--surface-elevated);border:1px dashed var(--border-hairline);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${footerLogoUrl
              ? `<img id="brandFooterLogoPreview" src="${footerLogoUrl}" style="max-width:100%;max-height:100%;object-fit:contain">`
              : `<img id="brandFooterLogoPreview" style="max-width:100%;max-height:100%;object-fit:contain;display:none">
                 <span style="color:var(--text-secondary);font-size:10px">no logo</span>`}
          </div>
          <div style="flex:1">
            <label class="form-label">${escapeHtml(I18N.t('sys.footerLogo'))}</label>
            <input type="file" id="brandFooterLogoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="font-size:11px;width:100%" data-change="uploadBrandFooterLogo">
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${escapeHtml(I18N.t('sys.footerLogoHint'))}</div>
            ${brandFooterLogo ? `<button class="csv-btn" style="margin-top:6px" data-action="clearBrandFooterLogo"><svg aria-hidden="true" width="12" height="12" style="vertical-align:-1px;margin-right:3px"><use href="#icon-trash"/></svg>Remove logo</button>` : ''}
          </div>
        </div>

        <div style="margin-bottom:10px">
          <label class="form-label">Product Name</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" class="form-input" id="ss_brand_name" value="${escapeHtml(brandName)}" maxlength="100" style="font-size:12px">
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="brand_name"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
        </div>

        <div style="margin-bottom:10px">
          <label class="form-label">Tagline</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" class="form-input" id="ss_brand_tagline" value="${escapeHtml(brandTagline)}" maxlength="200" style="font-size:12px">
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="brand_tagline"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
        </div>

        <div>
          <label class="form-label">Accent Color</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" class="form-input" id="ss_brand_primary_color" value="${escapeHtml(brandColor)}" style="height:38px;width:60px;padding:0">
            <input type="text" class="form-input" id="ss_brand_primary_color_text" value="${escapeHtml(brandColor)}" pattern="^#[0-9a-fA-F]{6}$" style="font-size:12px;font-family:monospace;flex:0 0 110px"
              data-input="syncBrandColor">
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveBrandColor"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${escapeHtml(I18N.t('sys.accentHint'))}</div>
        </div>

        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-hairline);font-size:10px;color:var(--text-secondary)">
          ${escapeHtml(I18N.t('sys.footerLocked'))}
        </div>
      </div>
    `;

    // ── Other settings (using SETTING_LABELS) ────────────────
    const others = Object.entries(SETTING_LABELS).map(([key, def]) => {
      const cur = settings[key]?.value || '';
      let inputHtml;
      if (def.input === 'select') {
        inputHtml = `<select class="form-input" id="ss_${key}" style="font-size:12px">
          ${def.options.map(o => `<option value="${escapeHtml(o)}" ${o===cur?'selected':''}>${escapeHtml(o)}</option>`).join('')}
        </select>`;
      } else if (def.input === 'text') {
        inputHtml = `<input type="text" class="form-input" id="ss_${key}" value="${escapeHtml(cur)}" maxlength="${def.maxlength || 300}" style="font-size:12px">`;
      } else {
        inputHtml = `<input type="number" class="form-input" id="ss_${key}" value="${escapeHtml(cur)}" min="${def.min}" max="${def.max}" style="font-size:12px">`;
      }
      return `
        <div style="padding:12px;background:var(--surface-overlay);border-radius:8px">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">${def.label}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-bottom:8px">${def.hint}</div>
          <div style="display:flex;gap:8px;align-items:center">
            ${inputHtml}
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="${escapeHtml(key)}"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:5px">key: <code>${key}</code></div>
        </div>
      `;
    }).join('');

    // ── Camera Analytics Events section (Phase 7.1) ───────────
    // These events fire automatically from the camera (not IVA rules).
    // Each checkbox = "show this type in the Events feed". Stored as a CSV
    // in system_settings.analytics_event_display. Default (when the row
    // hasn't been touched) = image-quality + scene-change on, I/O off.
    const analyticsDefault = 'ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange';
    const analyticsEnabled = new Set(
      (settings.analytics_event_display?.value ?? analyticsDefault)
        .split(',').map(s => s.trim()).filter(Boolean)
    );
    const ANALYTICS_OPTS = [
      { key: 'ImageTooBright',        label: I18N.t('sys.optBright') },
      { key: 'ImageTooBlurry',        label: I18N.t('sys.optBlurry') },
      { key: 'ImageTooDark',          label: I18N.t('sys.optDark') },
      { key: 'GlobalSceneChange',     label: I18N.t('sys.optScene') },
      { key: 'Trigger/DigitalInput',  label: I18N.t('sys.optDigitalIn') },
      { key: 'Trigger/Relay',         label: I18N.t('sys.optRelay') },
    ];
    const analyticsBlock = `
      <div style="margin-bottom:14px;padding:12px;background:var(--surface-overlay);border-radius:8px">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">Camera Analytics Events</div>
        <div style="font-size:10px;color:var(--text-secondary);margin-bottom:8px">
          ${escapeHtml(I18N.t('sys.analyticsDesc'))}
        </div>
        ${ANALYTICS_OPTS.map(o => `
          <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer">
            <input type="checkbox" class="ss-analytics-cb" value="${escapeHtml(o.key)}" ${analyticsEnabled.has(o.key) ? 'checked' : ''}>
            <span>${escapeHtml(o.label)}</span>
          </label>`).join('')}
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveAnalyticsDisplay"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          <span style="font-size:10px;color:var(--text-secondary)">key: <code>analytics_event_display</code></span>
        </div>
        <div style="font-size:10px;color:var(--text-secondary);display:block;margin-top:3px" data-i18n="sys.ignoreEvNote">ต้องการปิดทั้งหมดบางกล้อง → ใช้ "Suppress Event Types" ในหน้าตั้งค่ากล้อง</div>
      </div>`;

    // ── Face system settings (FACE-UI FP6) ───────────────────
    const faceSimVal  = settings.face_similarity_min?.value  || '80';
    const faceExprVal = settings.face_show_expression?.value ?? '1';
    const faceBlock = `
      <div style="margin-bottom:14px;padding:12px;background:var(--surface-overlay);border-radius:8px">
        <div style="font-size:13px;font-weight:700;margin-bottom:4px">${escapeHtml(I18N.t('sys.faceSection','การตั้งค่าระบบใบหน้า'))}</div>
        <div style="font-size:10px;color:var(--text-secondary);margin-bottom:10px">${escapeHtml(I18N.t('sys.faceSectionDesc','มีผลกับ KPI/กราฟหน้าภาพรวม และการจัดหมวดหน้าแจ้งเตือนบุคคล'))}</div>
        <div style="margin-bottom:10px">
          <div style="font-size:12px;font-weight:600;margin-bottom:2px">${escapeHtml(I18N.t('sys.faceSimLabel','เกณฑ์ความเหมือนขั้นต่ำ (%)'))}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px">${escapeHtml(I18N.t('sys.faceSimHint','ต่ำกว่านี้ถือว่า "ไม่พบในระบบ" — ปรับย้อนกลับได้ ไม่แก้ประวัติ'))}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" class="form-input" id="ss_face_similarity_min" value="${escapeHtml(faceSimVal)}" min="50" max="99" style="font-size:12px;max-width:110px">
            <span style="color:var(--text-secondary)">%</span>
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="face_similarity_min"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:12px;font-weight:600;margin-bottom:2px">${escapeHtml(I18N.t('sys.faceExprLabel','แสดงสีหน้า / อารมณ์'))}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px">${escapeHtml(I18N.t('sys.faceExprHint','ปิดได้หากไม่ต้องการกราฟ/ป้ายอารมณ์'))}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <select class="form-input" id="ss_face_show_expression" style="font-size:12px;max-width:110px">
              <option value="1" ${faceExprVal !== '0' ? 'selected' : ''}>${escapeHtml(I18N.t('common.on','เปิด'))}</option>
              <option value="0" ${faceExprVal === '0' ? 'selected' : ''}>${escapeHtml(I18N.t('common.off','ปิด'))}</option>
            </select>
            <button class="btn btn-primary" style="font-size:11px;padding:7px 12px" data-action="saveSetting" data-key="face_show_expression"><svg aria-hidden="true" width="12" height="12"><use href="#icon-save"/></svg> Save</button>
          </div>
        </div>
        <div style="font-size:10px;color:var(--text-secondary)">${escapeHtml(I18N.t('sys.facePerCamNote','เปิด/ปิดบันทึก-จดจำใบหน้าต่อกล้อง → ตั้งที่หน้าตั้งค่ากล้อง (Suppress Event Types)'))}</div>
      </div>`;

    list.innerHTML = brandingBlock + '<div class="ss-grid">' + others + '</div>'
      + _renderNavVisibilityBlock(settings) + faceBlock + analyticsBlock + _renderSitesBlock(sysSites);

    // Sync color picker with text field
    const colorPicker = document.getElementById('ss_brand_primary_color');
    if (colorPicker) {
      colorPicker.addEventListener('input', () => {
        document.getElementById('ss_brand_primary_color_text').value = colorPicker.value;
      });
    }
  } catch (e) { console.error('loadSystemSettings:', e); }
}

// Save brand_primary_color from either the picker or the hex text input
async function saveBrandColor() {
  const v = document.getElementById('ss_brand_primary_color').value;
  document.getElementById('ss_brand_primary_color_text').value = v;
  try {
    const res = await fetch(`${API}/api/settings/brand_primary_color`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: v }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await loadBrand();    // immediate effect on dashboard accent
  } catch (e) { alert(I18N.t('sys.colorSaveFailed') + e.message); }
}

// btn = ปุ่มที่ถูกกดจริง (dispatcher ส่งมาให้) — **ห้ามใช้ `document.activeElement` แทน**
// ถ้าไม่มีอะไรถูกโฟกัส activeElement คือ `<body>` แล้ว `btn.textContent = '✓ Saved'`
// จะล้าง DOM ทั้งหน้าทิ้งทันที (เจอจริงตอนทดสอบ P8 — หน้าเหลือแค่คำว่า Saved)
async function saveSetting(key, btn) {
  const value = document.getElementById('ss_' + key).value;
  try {
    const res = await fetch(`${API}/api/settings/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (key.startsWith('brand_')) await loadBrand();   // live-update sidebar / title / accent
    const el = (btn && btn.tagName === 'BUTTON') ? btn
      : (document.activeElement?.tagName === 'BUTTON' ? document.activeElement : null);
    if (el) { const orig = el.textContent; el.textContent = '✓ Saved'; setTimeout(() => el.textContent = orig, 1500); }
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

// Save the analytics-event display toggles — collects the checked boxes
// into a CSV and PUTs system_settings.analytics_event_display. The server
// validates against its known key list and refreshes its in-memory filter
// set immediately, so the Events feed reflects the change without a reload.
async function saveAnalyticsDisplay() {
  const checked = [...document.querySelectorAll('.ss-analytics-cb:checked')]
    .map(cb => cb.value);
  try {
    const res = await fetch(`${API}/api/settings/analytics_event_display`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: checked.join(',') }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const btn = document.activeElement;
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = orig, 1500); }
  } catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
}

// Per-site image retention (R1/R2). Rendered inline under the site row rather
// than in a modal: it is three numbers, and the operator is comparing them
// against the OTHER sites listed right there — three sites whose disks differ
// by 31x is the entire reason this setting exists.
let _ssSites = [];
function _retSummary(s) {
  const p = ['retention_events_days', 'retention_lpr_days', 'retention_face_days']
    .map(k => s[k] ? s[k] + 'd' : '—');
  return `E ${p[0]} · L ${p[1]} · F ${p[2]}`;
}

// How many day-folders a proposed retention would remove, from what the site
// says it actually holds. Derived on the page rather than asked of the edge:
// a simulate-a-delete mode on a remote box is one more thing that can be wrong
// in the direction that destroys data, and the inventory is already in hand.
function _retWouldDelete(inv, folder, days) {
  const f = inv && inv[folder];
  if (!f || !Array.isArray(f.dates) || !f.dates.length) return null;
  const d = Number(days);
  if (!Number.isFinite(d) || d < 1) return null;
  const cutoff = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const gone = f.dates.filter(x => x < cutoff);
  return { gone: gone.length, total: f.dates.length, oldest: f.dates[0], keeps: f.dates.length - gone.length };
}

function siteRetention(el) {
  const id = el.dataset.id;
  const s = _ssSites.find(x => String(x.id) === String(id));
  if (!s) return;
  const open = document.getElementById('ss_ret_form');
  if (open && open.dataset.id === String(id)) { open.remove(); return; }   // toggle
  if (open) open.remove();

  const t = (k, fb) => escapeHtml(I18N.t(k, fb));
  const inv = s.edge_inventory || null;
  const num = (idAttr, val, ph) =>
    `<input type="number" min="1" class="form-input" id="${idAttr}" value="${val ?? ''}" placeholder="${ph}" style="font-size:12px;max-width:110px" data-input="retPreview" data-folder="${idAttr.replace('ss_ret_','')}">`;

  const held = (folder) => {
    const f = inv && inv[folder];
    if (!f) return `<span style="color:var(--text-secondary)">${t('sys.retNoData','ยังไม่มีข้อมูลจากไซต์')}</span>`;
    return `${f.dirs} ${t('sys.retDays','วัน')} · ${t('sys.retOldest','เก่าสุด')} ${escapeHtml(f.oldest || '—')}`;
  };

  const box = document.createElement('div');
  box.id = 'ss_ret_form';
  box.dataset.id = String(id);
  box.style.cssText = 'margin:6px 0 10px;padding:10px;background:var(--surface-base);border-radius:6px';
  box.innerHTML = `
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">${t('sys.retTitle','อายุการเก็บรูปที่ edge ของไซต์นี้')} — ${escapeHtml(s.name)}</div>
    <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;line-height:1.5">${t('sys.retNote','เว้นว่าง = ใช้ค่าเดิมของ edge (7 วัน) · มีผลกับรูปบนดิสก์ของ edge เท่านั้น ข้อมูล event/ป้ายทะเบียนที่ส่งเข้า central ไม่กระทบ')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">
      <div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${t('sys.retEvents','Events snapshot (วัน)')}</div>
        ${num('ss_ret_events', s.retention_events_days, '7')}
        <div style="font-size:10px;color:var(--text-secondary);margin-top:3px">${held('events')}</div>
        <div style="font-size:11px;margin-top:2px" id="ss_prev_events"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${t('sys.retLpr','ภาพป้ายทะเบียน (วัน)')}</div>
        ${num('ss_ret_lpr', s.retention_lpr_days, '—')}
        <div style="font-size:10px;color:var(--text-secondary);margin-top:3px">${held('lpr')}</div>
        <div style="font-size:11px;margin-top:2px" id="ss_prev_lpr"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${t('sys.retFace','ภาพใบหน้า (วัน)')}</div>
        ${num('ss_ret_face', s.retention_face_days, '—')}
        <div style="font-size:10px;color:var(--text-secondary);margin-top:3px">${held('face')}</div>
        <div style="font-size:11px;margin-top:2px" id="ss_prev_face"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">${t('sys.retMinFree','กันดิสก์เต็ม — เหลืออย่างน้อย (GB)')}</div>
        ${num('ss_ret_minfree', s.retention_min_free_gb, '—')}
        <div style="font-size:10px;color:var(--text-secondary);margin-top:3px">${s.edge_free_gb != null ? t('sys.retFreeNow','ตอนนี้ว่าง') + ' ' + s.edge_free_gb + ' GB' : ''}</div>
      </div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:11px;padding:5px 10px" data-action="saveSiteRetention" data-id="${id}">${t('common.save','บันทึก')}</button>
      <span style="font-size:11px;color:var(--warn)">${t('sys.retFaceHeld','ภาพใบหน้ายังไม่ลบจริง — รอตรวจสอบ PDPA กับฝ่ายกฎหมายก่อน ตั้งค่าไว้ได้แต่ยังไม่มีผล')}</span>
    </div>
    <div id="ss_ret_msg" style="font-size:11px;margin-top:6px"></div>`;
  el.closest('div').after(box);
  ['events', 'lpr', 'face'].forEach(f => retPreview({ dataset: { folder: f } }));
}

// Live "what this number costs" under each input, recomputed as it is typed.
function retPreview(el) {
  const f = el.dataset.folder;
  if (!f || f === 'minfree') return;
  const form = document.getElementById('ss_ret_form');
  if (!form) return;
  const s = _ssSites.find(x => String(x.id) === String(form.dataset.id));
  const out = document.getElementById('ss_prev_' + f);
  if (!out || !s) return;
  const r = _retWouldDelete(s.edge_inventory, f, document.getElementById('ss_ret_' + f).value);
  if (!r) { out.textContent = ''; return; }
  out.style.color = r.gone ? 'var(--status-bad)' : 'var(--status-ok)';
  out.textContent = r.gone
    ? `${I18N.t('sys.retWillDelete','จะลบ')} ${r.gone}/${r.total} ${I18N.t('sys.retDays','วัน')} (${I18N.t('sys.retKeepFrom','เหลือ')} ${r.keeps})`
    : `${I18N.t('sys.retNoDelete','ยังไม่มีวันไหนถึงกำหนดลบ')}`;
}

async function saveSiteRetention(el) {
  const id = el.dataset.id;
  const val = (i) => { const v = document.getElementById(i).value.trim(); return v === '' ? null : Number(v); };
  const msg = document.getElementById('ss_ret_msg');
  try {
    const r = await fetch(`${API}/api/sites/${id}/retention`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        events_days: val('ss_ret_events'), lpr_days: val('ss_ret_lpr'),
        face_days: val('ss_ret_face'), min_free_gb: val('ss_ret_minfree'),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    // Saved and published are different outcomes and the operator needs to know
    // which one they got — a saved-but-unpublished policy is not in effect.
    msg.style.color = j.publish_error ? 'var(--warn)' : 'var(--status-ok)';
    msg.textContent = j.publish_error
      ? I18N.t('sys.retSavedNoPush', 'บันทึกแล้ว แต่ส่งไป edge ไม่สำเร็จ — จะส่งใหม่ตอนบันทึกครั้งถัดไป') + ': ' + j.publish_error
      : I18N.t('sys.retSaved', 'บันทึกและส่งไปที่ edge แล้ว');
    await loadSystemSettings();
  } catch (e) {
    msg.style.color = 'var(--status-bad)';
    msg.textContent = I18N.t('common.saveFailed', 'บันทึกไม่สำเร็จ: ') + e.message;
  }
}

// ปิดปรับปรุงไซต์ (migration 285) — เข้า: ฟอร์มหมายเหตุใต้แถว (แบบเดียวกับ siteRetention)
// ออก: confirm() ธรรมดา · server เป็นคนหยุด/เปิดกล้องและเงียบแจ้งเตือน หน้านี้แค่ส่งสถานะ
function siteMaintenance(el) {
  const id = el.dataset.id;
  const s = _ssSites.find(x => String(x.id) === String(id));
  if (!s) return;
  if (s.status === 'maintenance') {
    if (!confirm(I18N.t('sys.maintEndConfirm', 'กล้องที่ระบบหยุดไว้จะกลับมารับข้อมูล · แจ้งเตือนกลับมาทำงาน'))) return;
    _putSiteStatus(id, { status: 'active' });
    return;
  }
  const open = document.getElementById('ss_maint_form');
  if (open && open.dataset.id === String(id)) { open.remove(); return; }   // toggle
  if (open) open.remove();
  const box = document.createElement('div');
  box.id = 'ss_maint_form';
  box.dataset.id = String(id);
  box.style.cssText = 'margin:6px 0 10px;padding:10px;background:var(--surface-base);border-radius:6px';
  box.innerHTML = `
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">${escapeHtml(s.name)}</div>
    <textarea id="ss_maint_note" class="form-input" maxlength="500" rows="2" placeholder="${escapeHtml(I18N.t('sys.maintNotePh', 'หมายเหตุ (ไม่บังคับ)'))}" style="font-size:12px;width:100%;box-sizing:border-box;resize:vertical"></textarea>
    <div style="font-size:11px;color:var(--warn);margin:6px 0 8px;line-height:1.5">${escapeHtml(I18N.t('sys.maintConsequence', 'กล้องทุกตัวของไซต์นี้จะหยุดรับข้อมูลและไม่แจ้งเตือน · ข้อมูลเดิมยังค้นหาได้'))}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:11px;padding:5px 10px" data-action="confirmSiteMaintenance" data-id="${id}">${escapeHtml(I18N.t('sys.maintConfirm', 'ยืนยันปิดปรับปรุง'))}</button>
      <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" data-action="cancelSiteMaintenance">${escapeHtml(I18N.t('common.cancel', 'ยกเลิก'))}</button>
    </div>`;
  el.closest('div').after(box);
}

function cancelSiteMaintenance() { document.getElementById('ss_maint_form')?.remove(); }

function confirmSiteMaintenance(el) {
  const note = (document.getElementById('ss_maint_note')?.value || '').trim().slice(0, 500);
  _putSiteStatus(el.dataset.id, note ? { status: 'maintenance', note } : { status: 'maintenance' });
}

// เก็บถาวร (archived) — ต้องผ่าน maintenance ก่อน · server ถอนรหัส edge + ซ่อนจากหน้าสด
function siteArchive(el) {
  if (!confirm(I18N.t('sys.archiveConfirm', 'ถอนรหัส Edge ของไซต์นี้ (edge ต่อเข้ามาไม่ได้อีกจนกว่าจะออกรหัสใหม่) · ซ่อนจากหน้าจอสด · ข้อมูลเดิมยังค้นหาได้และไม่ถูกลบ'))) return;
  _putSiteStatus(el.dataset.id, { status: 'archived' });
}

function siteUnarchive(el) {
  if (!confirm(I18N.t('sys.unarchiveConfirm', 'ไซต์นี้จะกลับมาแสดงบนหน้าจอสด · กล้องที่ระบบหยุดไว้จะกลับมารับข้อมูล · แจ้งเตือนกลับมาทำงาน'))) return;
  _putSiteStatus(el.dataset.id, { status: 'active' });
}

async function _putSiteStatus(id, body) {
  try {
    const r = await fetch(`${API}/api/sites/${id}/status`, { method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    await loadSystemSettings();
    let msg = j.unchanged ? I18N.t('sys.maintNoChange', 'สถานะไซต์เป็นแบบนี้อยู่แล้ว')
      : j.cameras_paused != null ? I18N.t('sys.maintPaused', 'หยุดกล้องแล้ว {n} ตัว').replace('{n}', j.cameras_paused)
      : I18N.t('sys.maintResumed', 'เปิดกล้องกลับแล้ว {n} ตัว').replace('{n}', j.cameras_resumed ?? 0);
    if (j.edge_revoked) msg += '\n' + I18N.t('sys.edgeRevoked', 'ถอนรหัส Edge แล้ว');
    if (j.warning) msg += '\n' + j.warning;
    if (j.needs_edge_provision) msg += '\n' + I18N.t('sys.needsEdgeProvision', "ต้องกด 'ออกรหัส Edge ใหม่' ก่อน edge จะต่อได้");
    alert(msg);
  } catch (e) { alert(I18N.t('sys.maintFailed', 'เปลี่ยนสถานะไซต์ไม่สำเร็จ: ') + e.message); }
}

function addSite() {
  const f = document.getElementById('ss_site_form');
  if (!f) return;
  document.getElementById('ss_site_edit_id').value = '';
  document.getElementById('ss_site_code').value = '';
  document.getElementById('ss_site_code').disabled = false;
  document.getElementById('ss_site_name').value = '';
  document.getElementById('ss_site_color').value = '#6366f1';
  f.style.display = 'block';
}

function editSite(el) {
  const f = document.getElementById('ss_site_form');
  if (!f) return;
  document.getElementById('ss_site_edit_id').value = el.dataset.id;
  document.getElementById('ss_site_code').value = el.dataset.code || '';
  document.getElementById('ss_site_code').disabled = true;
  document.getElementById('ss_site_name').value = el.dataset.name || '';
  document.getElementById('ss_site_color').value = el.dataset.color || '#6366f1';
  f.style.display = 'block';
}

function cancelSiteForm() {
  const f = document.getElementById('ss_site_form');
  if (f) f.style.display = 'none';
}

async function saveSiteForm() {
  const id    = document.getElementById('ss_site_edit_id').value;
  const code  = document.getElementById('ss_site_code').value.trim();
  const name  = document.getElementById('ss_site_name').value.trim();
  const color = document.getElementById('ss_site_color').value;
  if (!name) { alert(I18N.t('sys.siteNameRequired', 'กรุณาใส่ชื่อ Site')); return; }
  const isEdit = !!id;
  const url  = isEdit ? `${API}/api/sites/${id}` : `${API}/api/sites`;
  const body = isEdit ? { name, color } : { code, name, color };
  try {
    const r = await fetch(url, { method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    await loadSystemSettings();
  } catch (e) { alert(I18N.t('common.saveFailed', 'บันทึกไม่สำเร็จ: ') + e.message); }
}

async function deleteSite(el) {
  if (!confirm(I18N.t('sys.deleteSiteConfirm', 'ลบ Site "{name}"?').replace('{name}', el.dataset.name))) return;
  try {
    const r = await fetch(`${API}/api/sites/${el.dataset.id}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    await loadSystemSettings();
  } catch (e) { alert(I18N.t('common.deleteFailed', 'ลบไม่สำเร็จ: ') + e.message); }
}

// ── ลบไซต์พร้อมข้อมูลทั้งหมด (S5) — เฉพาะไซต์ที่ปิดปรับปรุง/เก็บถาวร ─────────────
// โหลด purge-plan → แสดงยอด + ตัวบล็อก → พิมพ์รหัสไซต์ให้ตรงจึงกดได้ → POST → poll ทุก 3 วิ
const _SITE_PURGE_GROUPS = [
  ['sys.purgeGrpEvents', 'เหตุการณ์', ['events', 'face_event_notes', 'face_event_acks', 'lpr_alert_acks']],
  ['sys.purgeGrpLpr', 'ป้ายทะเบียน', ['license_plates', 'lpr_gates', 'lpr_watchlist', 'lpr_watchlist_groups']],
  ['sys.purgeGrpPerson', 'ลักษณะบุคคล', ['appearances']],
  ['sys.purgeGrpFace', 'ใบหน้า', ['face_embeddings', 'face_embed_queue', 'face_blacklist_hits', 'face_blacklist', 'face_blacklist_groups', 'hcp_camera_map', 'hcp_camera_map_site']],
  ['sys.purgeGrpStats', 'สถิติสรุป', ['traffic_hourly_stats', 'traffic_daily_stats', 'event_kpi_hourly', 'event_dim_bucket', 'lpr_hourly_stats', 'lpr_dim_daily', 'appearance_dim_hourly', 'appearance_dim_daily', 'camera_event_baseline']],
  ['sys.purgeGrpAlerts', 'แจ้งเตือน', ['alert_logs', 'camera_offline_alerts', 'camera_quiet_alerts']],
];
const _SITE_PURGE_STEPS = {
  queued: ['sys.purgeStQueued', 'รอเริ่ม'], edge_media: ['sys.purgeStEdge', 'สั่ง edge ลบรูป'],
  broker: ['sys.purgeStBroker', 'ถอนรหัส broker'], config: ['sys.purgeStConfig', 'ไฟล์ตั้งค่า'],
  events_and_tables: ['sys.purgeStData', 'ลบข้อมูล'], cameras: ['sys.purgeStCameras', 'ลบกล้อง'],
  site_rows: ['sys.purgeStSite', 'ลบข้อมูลไซต์'], central_files: ['sys.purgeStFiles', 'ลบรูปบน central'],
  audit: ['sys.purgeStAudit', 'บันทึก audit'],
};
let _sitePurgeTimer = null;
let _sitePurgeCode = null;

function _sitePurgeModal() {
  let m = document.getElementById('sitePurgeModal');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'modal-bg hidden';
  m.id = 'sitePurgeModal';
  m.innerHTML = `<div class="modal" style="max-width:560px">
    <div class="modal-head"><h3 id="spTitle"></h3><button class="modal-close" data-action="sitePurgeClose" aria-label="${escapeHtml(I18N.t('common.close', 'ปิด'))}">✕</button></div>
    <div class="modal-body" id="spBody" style="font-size:12px;line-height:1.6"></div></div>`;
  document.body.appendChild(m);
  return m;
}

function _sitePurgeList(key, fb, items) {
  if (!items || !items.length) return '';
  return `<div style="margin-top:4px">${escapeHtml(I18N.t(key, fb).replace('{list}', items.join(', ')))}</div>`;
}

async function sitePurgeOpen(el) {
  const m = _sitePurgeModal();
  const s = (_ssSites || []).find(x => String(x.id) === String(el.dataset.id));
  _sitePurgeCode = null;
  document.getElementById('spTitle').textContent = I18N.t('sys.purgeTitle', 'ลบไซต์ {name}').replace('{name}', s ? s.name : '');
  const body = document.getElementById('spBody');
  body.textContent = I18N.t('common.loading', 'กำลังโหลด...');
  m.classList.remove('hidden');
  try {
    const r = await fetch(`${API}/api/sites/${el.dataset.id}/purge-plan`, { credentials: 'include' });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p.error || `HTTP ${r.status}`);
    _sitePurgeRender(p);
  } catch (e) { body.textContent = I18N.t('sys.purgeLoadFail', 'โหลดไม่สำเร็จ: ') + e.message; }
}

function _sitePurgeRender(p) {
  const t = (k, fb) => I18N.t(k, fb);
  const c = p.counts || {};
  const used = new Set();
  const rows = [[t('sys.camerasUnit', 'กล้อง'), p.cameras.length, false]];
  for (const [k, fb, tables] of _SITE_PURGE_GROUPS) {
    tables.forEach(x => used.add(x));
    const vals = tables.map(x => c[x]);
    rows.push([t(k, fb), vals.reduce((a, v) => a + (v || 0), 0), vals.some(v => v === null)]);
  }
  const other = Object.keys(c).filter(k => !used.has(k) && !/bridge_rules/.test(k));
  rows.push([t('sys.purgeGrpOther', 'อื่น ๆ'), other.reduce((a, k) => a + (c[k] || 0), 0), other.some(k => c[k] === null)]);
  const table = rows.filter(([, n, unk]) => n > 0 || unk).map(([label, n, unk]) =>
    `<tr><td style="padding:3px 8px 3px 0">${escapeHtml(label)}</td><td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">${Number(n).toLocaleString()}${unk ? ` <span style="color:var(--warn)">(${escapeHtml(t('sys.purgeUnknown', 'บางตารางนับไม่ทัน'))})</span>` : ''}</td></tr>`).join('');

  const f = p.files || {};
  const files = [
    f.central && f.central.dirs ? t('sys.purgeCentralFiles', 'รูปบน central {n} โฟลเดอร์').replace('{n}', f.central.dirs) : '',
    f.edge === 'pending' ? t('sys.purgeEdgePending', 'ไฟล์บน edge จะถูกสั่งลบถ้า edge ออนไลน์') : '',
    f.edge === 'unreachable' ? t('sys.purgeEdgeUnreachable', 'รหัส edge ถูกถอนแล้ว ไฟล์บน edge ต้องลบที่เครื่องเอง') : '',
  ].filter(Boolean).map(x => `<div>${escapeHtml(x)}</div>`).join('')
    + _sitePurgeList('sys.purgeCollisions', 'ชื่อโฟลเดอร์ชนกับกล้องอื่น ไม่ลบรูป: {list}', f.name_collisions);

  const st = p.settings || {};
  const changes = _sitePurgeList('sys.purgeRulesOff', 'กฎแจ้งเตือนที่จะถูกปิด: {list}', (st.alert_rules || []).filter(r => r.disable).map(r => r.name))
    + _sitePurgeList('sys.purgeRecipOff', 'ผู้รับที่จะถูกปิดรับแจ้งเตือนป้าย: {list}', [...(st.line_recipients || []), ...(st.telegram_chats || [])].filter(r => r.disable).map(r => r.name || r.id))
    + _sitePurgeList('sys.purgeConsumers', 'API consumer ที่ถูกตัดไซต์นี้ออก: {list}', st.api_consumers)
    + _sitePurgeList('sys.purgeSources', 'แหล่ง blacklist ที่ดึงผ่านไซต์นี้ (ไม่ลบ): {list}', (st.blacklist_sources || []).map(x => x.label || x.id))
    + (st.face_blacklist_site_rows ? `<div style="margin-top:4px">${escapeHtml(t('sys.purgeFaceSiteRows', 'รายชื่อใบหน้าที่ประมวลผลที่ไซต์นี้ {n} รายการ (ไม่ลบ)').replace('{n}', st.face_blacklist_site_rows))}</div>` : '');

  const u = p.users || {};
  const users = _sitePurgeList('sys.purgeOnlySite', 'ผู้ใช้ที่จะไม่เหลือสิทธิ์ไซต์ใดเลย: {list}', (u.onlySite || []).map(x => x.username))
    + `<div style="color:var(--status-bad)">${_sitePurgeList('sys.purgeWidened', 'ผู้ใช้ที่จะเห็นกล้องกว้างขึ้น ต้องแก้สิทธิ์รายกล้องก่อน: {list}', (u.widened || []).map(x => x.username))}</div>`;

  const blocked = (p.blockers || []).length > 0;
  const blockers = blocked
    ? `<div style="margin-top:10px;padding:8px 10px;border:1px solid var(--status-bad);border-radius:6px;color:var(--status-bad)"><b>${escapeHtml(t('sys.purgeBlocked', 'ลบไม่ได้ตอนนี้'))}</b>${p.blockers.map(b => `<div>${escapeHtml(b.message)}</div>`).join('')}</div>`
    : '';

  _sitePurgeCode = p.site.code;
  const confirmBox = blocked ? '' : `
    <div style="margin-top:12px;font-weight:600;color:var(--status-bad)">${escapeHtml(t('sys.purgeIrreversible', 'ลบแล้วกู้คืนไม่ได้'))}</div>
    <label for="spConfirmInput" style="display:block;margin-top:6px;color:var(--text-secondary)">${escapeHtml(t('sys.purgeTypeCode', 'พิมพ์รหัสไซต์ {code} เพื่อยืนยัน').replace('{code}', p.site.code))}</label>
    <input id="spConfirmInput" class="form-input" type="text" autocomplete="off" spellcheck="false" data-input="sitePurgeInput" style="font-size:13px;width:100%;box-sizing:border-box;margin-top:4px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button id="spConfirmBtn" class="btn btn-danger" style="font-size:12px" data-action="sitePurgeConfirm" data-id="${p.site.id}" disabled>${escapeHtml(t('sys.purgeConfirmBtn', 'ลบไซต์และข้อมูลทั้งหมด'))}</button>
      <button class="btn btn-secondary" style="font-size:12px" data-action="sitePurgeClose">${escapeHtml(t('common.cancel', 'ยกเลิก'))}</button>
    </div>`;

  document.getElementById('spBody').innerHTML =
    `<table style="width:100%;border-collapse:collapse">${table}</table>
     <div style="margin-top:8px;color:var(--text-secondary)">${files}${changes}</div>
     <div style="margin-top:8px">${users}</div>${blockers}${confirmBox}
     <div id="spProgress" style="margin-top:10px"></div>`;
}

function sitePurgeInput(el) {
  const btn = document.getElementById('spConfirmBtn');
  if (btn) btn.disabled = !_sitePurgeCode || el.value !== _sitePurgeCode;
}

async function sitePurgeConfirm(el) {
  const input = document.getElementById('spConfirmInput');
  if (!input || input.value !== _sitePurgeCode) return;
  el.disabled = true; input.disabled = true;
  try {
    const r = await fetch(`${API}/api/sites/${el.dataset.id}/purge`, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: input.value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    _sitePurgeShowJob(j.job);
    clearInterval(_sitePurgeTimer);
    _sitePurgeTimer = setInterval(_sitePurgePoll, 3000);
  } catch (e) {
    el.disabled = false; input.disabled = false;
    alert(I18N.t('sys.purgeStartFail', 'เริ่มลบไม่สำเร็จ: ') + e.message);
  }
}

function _sitePurgeShowJob(job) {
  const box = document.getElementById('spProgress');
  if (!box || !job) return;
  const [k, fb] = _SITE_PURGE_STEPS[job.step] || ['', job.step || ''];
  let html = `<div>${escapeHtml(I18N.t('sys.purgeStep', 'ขั้น {i}/{n}: {step}').replace('{i}', job.step_index || 0).replace('{n}', job.step_total || 8).replace('{step}', k ? I18N.t(k, fb) : fb))}</div>`;
  if (job.progress && job.progress.table) html += `<div style="color:var(--text-secondary)">${escapeHtml(job.progress.table)} · ${Number(job.progress.deleted || 0).toLocaleString()} ${escapeHtml(I18N.t('sys.purgeRows', 'แถว'))}</div>`;
  if (job.status === 'done') html = `<div style="color:var(--status-ok);font-weight:600">${escapeHtml(I18N.t('sys.purgeDone', 'ลบไซต์เสร็จแล้ว'))}</div>`;
  if (job.status === 'failed') html += `<div style="color:var(--status-bad);font-weight:600">${escapeHtml(I18N.t('sys.purgeFailed', 'ลบไซต์ไม่สำเร็จ: ') + (job.error || ''))}</div>`;
  box.innerHTML = html;
}

async function _sitePurgePoll() {
  const m = document.getElementById('sitePurgeModal');
  if (!m || m.classList.contains('hidden')) { clearInterval(_sitePurgeTimer); _sitePurgeTimer = null; return; }
  if (document.hidden) return;
  try {
    const r = await fetch(`${API}/api/sites/purge-job`, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.job) return;
    _sitePurgeShowJob(j.job);
    if (j.job.status !== 'running') {
      clearInterval(_sitePurgeTimer); _sitePurgeTimer = null;
      loadSystemSettings();
    }
  } catch (e) { /* เครือข่ายสะดุด — รอบถัดไปลองใหม่ */ }
}

function sitePurgeClose() {
  clearInterval(_sitePurgeTimer); _sitePurgeTimer = null;
  document.getElementById('sitePurgeModal')?.classList.add('hidden');
}

// Phase C — provision the site's edge MQTT bridge identity (broker user + ACL,
// EMQX or Mosquitto per BROKER_KIND) from the UI, reusing the same engine as
// the CLI. Creds shown once.
async function provisionSiteEdge(el) {
  const id = el.dataset.id, code = el.dataset.code;
  if (!confirm(I18N.t('sys.provisionEdgeConfirm', 'ออกรหัสใหม่ให้ edge ของไซต์นี้ · รหัสเดิมจะใช้ไม่ได้ทันที (edge ต้องได้รหัสใหม่ก่อนจึงจะต่อได้)'))) return;
  try {
    const r = await fetch(`${API}/api/sites/${id}/provision-edge`, { method: 'POST' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    _showEdgeCredsModal(await r.json());
  } catch (e) { alert(I18N.t('sys.provisionEdgeFail', 'Provision ไม่สำเร็จ') + ': ' + e.message); }
}

// Task #21 — manual trigger for POST /api/sites/:id/push-config (existed since
// multi-site but had no UI). Safe/idempotent (just re-publishes the current
// camera list retained), so no confirm dialog like provisionSiteEdge needs.
async function pushSiteConfig(el) {
  const id = el.dataset.id;
  const prevText = el.textContent;
  try {
    const r = await fetch(`${API}/api/sites/${id}/push-config`, { method: 'POST' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    const out = await r.json();
    el.textContent = I18N.t('sys.pushConfigDone', 'ส่งแล้ว ✓') + ` (${out.count})`;
    setTimeout(() => { el.textContent = prevText; }, 2000);
  } catch (e) { alert(I18N.t('sys.pushConfigFail', 'Push config ไม่สำเร็จ') + ': ' + e.message); }
}

function _showEdgeCredsModal(out) {
  window._edgeCreds = out;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('seBroker', out.brokerUrl);
  set('seUser', out.mqtt.username);
  set('sePass', out.mqtt.password);
  set('seTopic', out.topicPrefix + '#');
  document.getElementById('siteEdgeModal')?.classList.remove('hidden');
}

function closeSiteEdgeModal() {
  document.getElementById('siteEdgeModal')?.classList.add('hidden');
  window._edgeCreds = null;  // drop the password from memory
}

function copySiteEdgeCreds() {
  const o = window._edgeCreds; if (!o) return;
  const txt = `broker=${o.brokerUrl}\nusername=${o.mqtt.username}\npassword=${o.mqtt.password}\ntopic=${o.topicPrefix}#\nkeepalive=30-60s`;
  navigator.clipboard?.writeText(txt).then(() => {
    const b = document.querySelector('[data-action="copySiteEdgeCreds"]');
    if (b) { const t = b.textContent; b.textContent = I18N.t('common.copied', 'คัดลอกแล้ว ✓'); setTimeout(() => { b.textContent = t; }, 1500); }
  });
}
