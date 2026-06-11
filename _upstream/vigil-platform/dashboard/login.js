// ============================================================
// Vigil Platform — Login Page Script (CSP-safe: externalised from login.html)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// ตรวจว่ายอมรับ disclaimer แล้วหรือยัง — ถ้ายัง → redirect กลับไป
if (sessionStorage.getItem('disclaimer_accepted') !== '1') {
  window.location.href = '/disclaimer.html';
}

// Apply customer's branding (public endpoint, no auth)
(async () => {
  try {
    const r = await fetch('/api/branding', { cache: 'no-store' });
    if (!r.ok) return;
    const b = await r.json();
    if (b.name) {
      document.title = `${b.name} — Login`;
      const t = document.getElementById('brandTitle');
      if (t) t.textContent = b.name;
    }
    if (b.logo_url) {
      const icon = document.getElementById('brandLogoIcon');
      if (icon) icon.innerHTML = `<img src="${b.logo_url}?v=${Date.now()}" alt="logo" style="width:64px;height:64px;object-fit:contain">`;
      const fav = document.getElementById('brandFavicon');
      if (fav) fav.href = '/favicon.ico?v=' + Date.now();
    }
    if (b.primary_color) document.documentElement.style.setProperty('--accent', b.primary_color);
  } catch {}
})();

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btnLogin');
  const errEl = document.getElementById('errorMsg');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  btn.disabled = true;
  btn.textContent = I18N.t('login.signingIn');
  errEl.classList.remove('show');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || I18N.t('login.failed');
      errEl.classList.add('show');
      btn.disabled = false;
      btn.textContent = I18N.t('login.signIn');
      return;
    }

    // เก็บ token ใน localStorage + sessionStorage (กัน Safari ITP ลบ localStorage)
    if (data.token) {
      try { localStorage.setItem('bosch_session_token', data.token); } catch {}
      try { sessionStorage.setItem('bosch_session_token', data.token); } catch {}
    }

    // Pass token ทาง URL hash (ไม่ส่งไป server, browser ไม่แชร์ออก) — กัน Safari ITP
    // Dashboard JS จะอ่าน hash → set localStorage แล้ว clean URL
    setTimeout(() => {
      window.location.href = '/#t=' + encodeURIComponent(data.token);
    }, 100);
  } catch (err) {
    errEl.textContent = I18N.t('login.connErr') + err.message;
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = I18N.t('login.signIn');
  }
}

// Bind form + lang buttons — CSP-safe (no inline handlers)
document.getElementById('loginForm').addEventListener('submit', doLogin);
document.getElementById('langTh').addEventListener('click', () => I18N.setLang('th'));
document.getElementById('langEn').addEventListener('click', () => I18N.setLang('en'));

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

// ถ้า login อยู่แล้ว → redirect ไป dashboard
(async () => {
  try {
    const token = localStorage.getItem('bosch_session_token');
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api/auth/me', {
      credentials: 'include',
      headers,
    });
    if (res.ok) window.location.href = '/';
  } catch {}
})();
