// ============================================================
// Vigil Platform Live Docs v2 — Shared Navigation
// Single source of truth for all doc pages.
// To add/rename a page: edit NAV_ITEMS here only.
//
// LANGUAGE RULE (บังคับทุกครั้งที่อัพเดท):
//   - เนื้อหาทุกหน้าเป็นภาษาไทยเป็นหลัก
//   - Technical terms (MQTT, JWT, API, Docker ฯลฯ) คงไว้เป็นอังกฤษ
//   - Code block / file path / command ไม่แปล
//   - ดูกฎเต็มใน docs/ARCH_documentation-governance.md
//     section "vigil-docs-v2 language style"
// ============================================================

const NAV_ITEMS = [
  { section: 'ภาพรวม' },
  { href: 'index.html',               label: 'สารบัญหลัก' },
  { section: 'เนื้อหา' },
  { href: '01-purpose.html',          label: '01 จุดประสงค์โครงการ' },
  { href: '02-capabilities.html',     label: '02 สิ่งที่ทำได้' },
  { href: '03-benefits.html',         label: '03 4P · SWOT · จุดเด่น' },
  { href: '04-components.html',       label: '04 องค์ประกอบระบบ' },
  { href: '05-security.html',         label: '05 Security Audit' },
  { href: '06-bugs-fixed.html',       label: '06 Bugs ที่แก้แล้ว' },
  { href: '07-competitive.html',      label: '07 Architecture Decisions' },
  { href: '08-mobile-app.html',       label: '08 Vigil Mobile App' },
  { href: '09-line-api.html',         label: '09 LINE API' },
  { href: '10-maps-api.html',         label: '10 Maps API' },
  { href: '11-company-view.html',     label: '11 มุมมององค์กร' },
  { href: '12-scale-up.html',         label: '12 Scale Up' },
  { href: '13-procurement-tor.html',  label: '13 TOR ภาครัฐ' },
  { href: '14-appearances.html',      label: '14 Appearances' },
  { section: 'อ้างอิง' },
  { href: '../vendor-comparison.html', label: '↗ Vendor Comparison', target: '_blank' },
];

const NAV_LOGO = '<div class="nav-logo"><h1>Vigil Platform</h1><p>Live Docs v1.5.1</p></div>';

function buildNav() {
  const navEl = document.getElementById('nav');
  if (!navEl) return;

  const current = location.pathname.split('/').pop() || 'index.html';

  let html = NAV_LOGO;
  for (const item of NAV_ITEMS) {
    if (item.section) {
      html += `<div class="nav-sec">${item.section}</div>`;
    } else {
      const isActive = item.href === current;
      const cls = isActive ? ' class="active"' : '';
      const tgt = item.target ? ` target="${item.target}"` : '';
      html += `<a href="${item.href}"${cls}${tgt}>${item.label}</a>`;
    }
  }
  navEl.innerHTML = html;

  const ham = document.getElementById('ham');
  const overlay = document.getElementById('overlay');
  if (ham) ham.onclick = () => {
    navEl.classList.toggle('open');
    if (overlay) overlay.style.display = navEl.classList.contains('open') ? 'block' : 'none';
  };
  if (overlay) overlay.onclick = () => {
    navEl.classList.remove('open');
    overlay.style.display = 'none';
  };
}

document.addEventListener('DOMContentLoaded', buildNav);
