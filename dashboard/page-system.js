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
};

function openSystemSettings() {
  document.getElementById('userDropdown')?.classList.add('hidden');
  openSettings();
  settingsNav('system');
}
function closeSystemSettings() { /* system is a Settings Workspace section now — no modal */ }

function _renderSitesBlock(sites) {
  const rows = sites.map(s => {
    const canDelete = s.code !== 'main' && s.camera_count === 0;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-hairline);flex-wrap:wrap">
      <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(s.color)};flex-shrink:0"></span>
      <span style="flex:1;font-size:12px;font-weight:600">${escapeHtml(s.name)}</span>
      <span style="font-size:10px;color:var(--text-secondary)">${escapeHtml(s.code)}</span>
      <span style="font-size:10px;color:var(--text-secondary);min-width:48px;text-align:right">${s.camera_count} กล้อง</span>
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="provisionSiteEdge" data-id="${s.id}" data-code="${escapeHtml(s.code)}" title="${escapeHtml(I18N.t('sys.provisionEdge','สร้าง credentials สำหรับ edge bridge'))}">Edge ↗</button>
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="pushSiteConfig" data-id="${s.id}" data-code="${escapeHtml(s.code)}" title="${escapeHtml(I18N.t('sys.pushConfig','ส่ง camera config ปัจจุบันไปที่ edge (bootstrap ครั้งแรก / force-resync)'))}">Push Config ↻</button>
      <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" data-action="editSite" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-color="${escapeHtml(s.color)}" data-code="${escapeHtml(s.code)}">แก้ไข</button>
      ${canDelete ? `<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" data-action="deleteSite" data-id="${s.id}" data-name="${escapeHtml(s.name)}">ลบ</button>` : ''}
    </div>`;
  }).join('');
  return `<div style="margin-bottom:14px;padding:12px;background:var(--surface-overlay);border-radius:8px">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">${I18N.t('sys.sitesSection','จัดการ Sites')}</div>
    <div id="ss_sites_list">${rows}</div>
    <div id="ss_site_form" style="display:none;margin-top:10px;padding:10px;background:var(--surface-base);border-radius:6px">
      <input type="hidden" id="ss_site_edit_id">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
        <div><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">รหัส (code)</div>
          <input type="text" class="form-input" id="ss_site_code" placeholder="เช่น phuket" style="font-size:12px;max-width:120px"></div>
        <div><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">ชื่อ</div>
          <input type="text" class="form-input" id="ss_site_name" placeholder="ชื่อ Site" style="font-size:12px;max-width:150px"></div>
        <div><div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">สี</div>
          <input type="color" id="ss_site_color" value="#6366f1" style="width:36px;height:30px;padding:2px;border:1px solid var(--border-hairline);border-radius:4px;cursor:pointer"></div>
        <button class="btn btn-primary" style="font-size:11px;padding:5px 10px" data-action="saveSiteForm">บันทึก</button>
        <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px" data-action="cancelSiteForm">ยกเลิก</button>
      </div>
    </div>
    <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px;margin-top:8px" data-action="addSite">+ เพิ่ม Site</button>
  </div>`;
}

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
    const brandColor   = settings.brand_primary_color?.value || '#5b8def';
    const logoUrl      = brandLogo ? `/branding/${escapeHtml(brandLogo)}?v=${Date.now()}` : '';
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

    list.innerHTML = brandingBlock + '<div class="ss-grid">' + others + '</div>' + faceBlock + analyticsBlock + _renderSitesBlock(sysSites);

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

async function saveSetting(key) {
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
    const btn = document.activeElement;
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = orig, 1500); }
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
  if (!name) { alert('กรุณาใส่ชื่อ Site'); return; }
  const isEdit = !!id;
  const url  = isEdit ? `${API}/api/sites/${id}` : `${API}/api/sites`;
  const body = isEdit ? { name, color } : { code, name, color };
  try {
    const r = await fetch(url, { method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    await loadSystemSettings();
  } catch (e) { alert('บันทึกไม่สำเร็จ: ' + e.message); }
}

async function deleteSite(el) {
  if (!confirm(`ลบ Site "${el.dataset.name}"?`)) return;
  try {
    const r = await fetch(`${API}/api/sites/${el.dataset.id}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    await loadSystemSettings();
  } catch (e) { alert('ลบไม่สำเร็จ: ' + e.message); }
}

// Phase C — provision the site's edge MQTT bridge identity (EMQX user + ACL)
// from the UI, reusing the same engine as the CLI. Creds shown once.
async function provisionSiteEdge(el) {
  const id = el.dataset.id, code = el.dataset.code;
  if (!confirm(I18N.t('sys.provisionEdgeConfirm', `สร้าง/รีเซ็ต credentials edge ของ Site "${code}"?\n(ถ้าเคยตั้งแล้ว รหัสเดิมจะใช้ไม่ได้ — ต้องอัปเดตที่ edge)`).replace('{code}', code))) return;
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
