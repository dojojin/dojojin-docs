// ============================================================
// Vigil Platform — Disclaimer Page Script (CSP-safe: externalised from disclaimer.html)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// Apply customer's branding
(async () => {
  try {
    const r = await fetch('/api/branding', { cache: 'no-store' });
    if (!r.ok) return;
    const b = await r.json();
    if (b.name) {
      document.title = b.name + I18N.t('dc.titleSuffix');
      const sub = document.getElementById('brandSubName');
      if (sub) sub.textContent = '· ' + b.name;
    }
    if (b.logo_url) {
      const seal = document.getElementById('brandSeal');
      if (seal) seal.innerHTML = `<img src="${b.logo_url}?v=${Date.now()}" alt="logo" style="width:48px;height:48px;object-fit:contain">`;
      const fav = document.getElementById('brandFavicon');
      if (fav) fav.href = '/favicon.ico?v=' + Date.now();
    }
    if (b.primary_color) document.documentElement.style.setProperty('--accent', b.primary_color);
  } catch {}
})();

function toggleAccept(cb) {
  const btn = document.getElementById('acceptBtn');
  if (cb.checked) btn.classList.add('active');
  else btn.classList.remove('active');
}

// Bind lang + agree — CSP-safe (no inline handlers)
document.getElementById('agree').addEventListener('change', function() { toggleAccept(this); });
document.getElementById('langTh').addEventListener('click', () => I18N.setLang('th'));
document.getElementById('langEn').addEventListener('click', () => I18N.setLang('en'));

// ถ้าเคยยอมรับแล้ว — redirect ไป login ทันที
// ใช้ sessionStorage เพื่อให้ user ยอมรับใหม่ทุกครั้งที่เปิด browser ใหม่
if (sessionStorage.getItem('disclaimer_accepted') === '1') {
  window.location.href = '/login.html';
}

document.getElementById('acceptBtn').addEventListener('click', function() {
  if (!this.classList.contains('active')) {
    alert(I18N.t('dc.alertMustRead'));
    return;
  }
  this.textContent = I18N.t('dc.entering');
  this.style.background = 'linear-gradient(135deg, #2ecc71 0%, #1a8a4a 100%)';
  this.disabled = true;

  // เก็บ flag ใน sessionStorage (จะหายเมื่อปิด browser tab)
  sessionStorage.setItem('disclaimer_accepted', '1');
  sessionStorage.setItem('disclaimer_accepted_at', new Date().toISOString());

  setTimeout(() => {
    window.location.href = '/login.html';
  }, 600);
});

// Theme toggle — top-right button (mirrors dashboard_theme key, applies live without reload)
(function() {
  var MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  var SUN  = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  function updateBtn(currentTheme) {
    var icon = document.getElementById('themeIcon');
    var label = document.getElementById('themeLabel');
    if (!icon || !label) return;
    if (currentTheme === 'dark') { icon.innerHTML = SUN;  label.textContent = 'Light'; }
    else                         { icon.innerHTML = MOON; label.textContent = 'Dark'; }
  }
  var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  updateBtn(current);
  var btn = document.getElementById('themeToggleBtn');
  if (btn) btn.addEventListener('click', function() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('dashboard_theme', next); } catch(e) {}
    updateBtn(next);
  });
}());

// Cancel button
document.querySelector('.btn-cancel').addEventListener('click', function(e) {
  e.preventDefault();
  if (confirm(I18N.t('dc.confirmReject'))) {
    // Clear ทุกอย่าง + ไปหน้าว่างหรือ about:blank
    sessionStorage.clear();
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--navy);color:var(--text-primary);font-family:'Noto Sans Thai',sans-serif;text-align:center;padding:40px">
        <div>
          <div style="font-size:48px;margin-bottom:20px">⛔</div>
          <h2 style="color:var(--gold);margin-bottom:14px">${I18N.t('dc.rejectedTitle')}</h2>
          <p style="color:var(--text-secondary);margin-bottom:24px">${I18N.t('dc.rejectedMsg')}</p>
          <button id="rejectedBackBtn" style="padding:10px 24px;background:var(--gold);color:var(--gold-text);border:none;border-radius:6px;font-weight:700;cursor:pointer">${I18N.t('dc.rejectedBack')}</button>
        </div>
      </div>`;
    document.getElementById('rejectedBackBtn').addEventListener('click', () => window.location.reload());
  }
});
