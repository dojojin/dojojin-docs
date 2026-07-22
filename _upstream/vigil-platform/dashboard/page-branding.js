// ============================================================
// Vigil Platform — Branding Page
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ============================================================
// 🎨 Branding (white-label) — applies to sidebar / title / accent
// ============================================================
let _brand = null;

async function loadBrand() {
  try {
    const res = await fetch(`${API}/api/branding`, { cache: 'no-store' });
    if (!res.ok) return;
    _brand = await res.json();
    applyBrandToDom();
  } catch (e) { console.warn('loadBrand:', e.message); }
}

function applyBrandToDom() {
  if (!_brand) return;
  const logoIcon = document.getElementById('brandLogoIcon');
  if (logoIcon) {
    if (_brand.logo_url) {
      const url = `${_brand.logo_url}?v=${Date.now()}`;
      logoIcon.innerHTML = `<img src="${escapeHtml(url)}" alt="logo" style="width:36px;height:36px;object-fit:contain;display:block">`;
    } else {
      logoIcon.innerHTML = '<svg aria-hidden="true" width="28" height="28" style="opacity:0.5"><use href="#icon-camera"/></svg>';
    }
  }
  const nameEl = document.getElementById('brandName');
  if (nameEl)    nameEl.textContent = _brand.name || 'Vigil Platform';
  const tagEl = document.getElementById('brandTagline');
  if (tagEl)     tagEl.textContent = _brand.tagline || '';
  const footerName = document.getElementById('brandFooterName');
  if (footerName) footerName.textContent = _brand.name || 'Vigil Platform';
  if (_brand.name) document.title = _brand.name;
  if (_brand.primary_color) {
    document.documentElement.style.setProperty('--accent', _brand.primary_color);
  }
  const fav = document.getElementById('brandFavicon');
  if (fav) fav.href = '/favicon.ico?v=' + Date.now();
}

// Upload a new logo file (admin only). The server resizes & saves it.
async function uploadBrandLogo(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert(I18N.t('sys.logoTooBig')); fileInput.value = ''; return; }
  const fd = new FormData();
  fd.append('logo', file);
  try {
    const res = await fetch(`${API}/api/branding/logo`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const body = await res.json();
    await loadBrand();
    // also refresh preview in settings modal
    const prev = document.getElementById('brandLogoPreview');
    if (prev) prev.src = body.logo_url;
  } catch (e) {
    alert(I18N.t('sys.logoUploadFailed') + e.message);
  } finally {
    fileInput.value = '';
  }
}

async function clearBrandLogo() {
  if (!confirm(I18N.t('sys.confirmClearLogo'))) return;
  try {
    const res = await fetch(`${API}/api/branding/logo`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadBrand();
    const prev = document.getElementById('brandLogoPreview');
    if (prev) prev.removeAttribute('src');
  } catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
}
