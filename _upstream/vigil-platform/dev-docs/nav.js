// ============================================================
// Vigil Platform Dev Portal — Shared Navigation
// Single source of truth for all dev-docs pages.
// To add/rename a page: edit NAV_ITEMS here only.
//
// Language: Thai-first prose + English technical terms
// This portal is for the developer/owner only — not deployed publicly.
// Open via file:// or local server.
// ============================================================

const NAV_ITEMS = [
  { section: 'ภาพรวม' },
  { href: 'index.html',               label: 'แผนที่โค้ด (Navigator)' },
  { href: 'file-navigator.html',      label: 'File Navigator (สารบัญไฟล์)' },
  { href: 'api-routes.html',          label: 'API Routes Reference' },
  { href: 'doc-browser.html',         label: 'เอกสารหลัก (Curated)' },
  { href: 'all-docs.html',            label: 'ไฟล์ .md ทั้งหมด (50)' },
  { section: 'คู่มือ' },
  { href: 'install.html',             label: 'ติดตั้งระบบ' },
  { href: 'troubleshoot.html',        label: 'แก้ปัญหาเบื้องต้น' },
  { href: 'faq.html',                 label: 'FAQ' },
  { href: 'devops.html',              label: 'DevOps Reference' },
  { section: 'How-to Recipes' },
  { href: 'add-route.html',           label: 'เพิ่ม REST Route' },
  { href: 'add-migration.html',       label: 'เพิ่ม Migration' },
  { href: 'add-i18n.html',            label: 'เพิ่ม i18n String' },
  { href: 'add-dashboard-page.html',  label: 'เพิ่ม Dashboard Page' },
  { href: 'restart-services.html',    label: 'Restart Services (LNP)' },
  { section: 'อ้างอิง' },
  { href: 'md-viewer.html?src=../ARCHITECTURE.md',            label: 'ARCHITECTURE.md' },
  { href: 'md-viewer.html?src=../DESIGN.md',                  label: 'DESIGN.md' },
  { href: 'md-viewer.html?src=../GOTCHAS.md',                 label: 'GOTCHAS.md' },
  { href: 'md-viewer.html?src=../docs/REF_api-reference.md',  label: 'REF_api-reference.md' },
  { href: 'md-viewer.html?src=../docs/REF_database-schema.md',label: 'REF_database-schema.md' },
  { href: 'md-viewer.html?src=../service_start.md',           label: 'service_start.md' },
];

const NAV_LOGO = '<div class="nav-logo"><h1>Dev Portal</h1><p>Vigil Platform — Internal</p></div>';

function buildNav() {
  const navEl = document.getElementById('nav');
  if (!navEl) return;

  const current = (location.pathname.split('/').pop() || 'index.html') + location.search;

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
