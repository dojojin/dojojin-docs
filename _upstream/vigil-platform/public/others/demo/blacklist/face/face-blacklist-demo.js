// ============================================================
// Vigil Platform — Blacklist Database (Face) DRAFT demo
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// DRAFT/DEMO ONLY. All data below is synthetic/mock — see banner in index.html.
// Mirrors the data model in docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md:
// blacklist.sources -> blacklist.source_records -> blacklist.master -> blacklist.master_links
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const SOURCES = {
    gurusquare:  { name: 'GuruSquare',        chip: 'chip-src-gurusquare' },
    hcp_phuket:  { name: 'HCP — Site ภูเก็ต', chip: 'chip-src-hcp' },
  };

  // avatarSvg — generic silhouette icon, deliberately not a face (no PII risk)
  function avatarSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
  }

  // MASTER — the reservoir. id_num is a deliberately-malformed fake (not a valid Thai
  // national ID checksum / real passport format) per PDPA guardrail in the spec.
  const MASTER = [
    {
      id: 'M-0001', name: 'สมชาย ใจดี (สมมติ)', idType: 'national_id', idNum: '1-2xxx-90000-xx-1',
      status: 'active',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2024-0091', note: 'คดีลักทรัพย์ในเคหสถาน — พบเห็นครั้งล่าสุดที่สาขาสีลม', importedAt: '2026-05-02', nameRaw: 'สมชาย ใจดี' },
        { source: 'hcp_phuket', caseRef: 'PKT-2025-0334', note: 'คดีทำร้ายร่างกาย — เฝ้าระวังพื้นที่สนามบิน', importedAt: '2026-06-18', nameRaw: 'สมชาย ใจดี๊' },
      ],
    },
    {
      id: 'M-0002', name: 'วิภา รักชาติ (สมมติ)', idType: 'national_id', idNum: '1-3xxx-11000-xx-4',
      status: 'active',
      links: [
        { source: 'hcp_phuket', caseRef: 'PKT-2025-0210', note: 'ต้องสงสัยคดีฉ้อโกง', importedAt: '2026-04-11', nameRaw: 'วิภา รักชาติ' },
      ],
    },
    {
      id: 'M-0003', name: 'John Doe (สมมติ)', idType: 'passport', idNum: 'US · P-x1x2x3x',
      status: 'active',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2024-0155', note: 'วีซ่าหมดอายุ + ต้องสงสัยคดีบุกรุก', importedAt: '2026-03-22', nameRaw: 'John Doe' },
      ],
    },
    {
      id: 'M-0004', name: 'ไม่ทราบชื่อ #4127 (สมมติ)', idType: null, idNum: null,
      status: 'active',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2024-0201', note: 'ไม่มีเอกสารยืนยันตัวตน — เก็บจากภาพเท่านั้น (no-ID identity)', importedAt: '2026-06-01', nameRaw: '(ไม่ระบุ)' },
      ],
    },
    {
      id: 'M-0005', name: 'อรุณ ศรีสุข (สมมติ)', idType: 'national_id', idNum: '1-4xxx-77000-xx-9',
      status: 'inactive',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2023-0087', note: 'คดีปิดแล้ว — เก็บไว้เพื่ออ้างอิงประวัติ', importedAt: '2025-11-09', nameRaw: 'อรุณ ศรีสุข' },
      ],
    },
    {
      id: 'M-0006', name: 'พงศ์เทพ วงศ์ไพร (สมมติ)', idType: 'national_id', idNum: '1-5xxx-32000-xx-2',
      status: 'active',
      links: [
        { source: 'hcp_phuket', caseRef: 'PKT-2026-0042', note: 'ต้องสงสัยคดียาเสพติด', importedAt: '2026-07-10', nameRaw: 'พงศ์เทพ วงษ์ไพร' },
      ],
    },
  ];

  function renderKpi() {
    const totalMaster = MASTER.length;
    const totalRecords = MASTER.reduce((n, m) => n + m.links.length, 0);
    const multiSource = MASTER.filter(m => new Set(m.links.map(l => l.source)).size > 1).length;
    const items = [
      { ka: 'var(--accent)', label: 'Master Identity ทั้งหมด', val: String(totalMaster),
        icon: '<circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>' },
      { ka: 'var(--purple, #a855f7)', label: 'Source Record นำเข้าแล้ว', val: String(totalRecords),
        icon: '<path d="M4 6h16M4 12h16M4 18h16"/>' },
      { ka: 'var(--status-ok)', label: 'Source ที่เชื่อมต่อ', val: '2 / 3',
        icon: '<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>' },
      { ka: 'var(--warn)', label: 'พบมากกว่า 1 Source (คนละคดี)', val: String(multiSource),
        icon: '<circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M3 3l18 18" stroke-opacity=".5"/>' },
    ];
    $('kpiGrid').innerHTML = items.map(k => `
      <div class="kpi" style="--ka:${k.ka}">
        <div class="ki" style="color:${k.ka}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${k.icon}</svg></div>
        <div class="kl">${k.label}</div>
        <div class="kv">${k.val}</div>
      </div>`).join('');
  }

  function renderSrcGrid() {
    $('srcGrid').innerHTML = `
      <div class="src-card">
        <div class="src-head"><div class="src-name"><span class="src-dot ok"></span>GuruSquare</div><span class="chip chip-src-gurusquare">openapi_pull</span></div>
        <div class="src-meta"><span>Record</span><span>${MASTER.reduce((n,m)=>n+m.links.filter(l=>l.source==='gurusquare').length,0)}</span></div>
        <div class="src-meta"><span>Sync ล่าสุด</span><span>2 นาทีที่แล้ว</span></div>
      </div>
      <div class="src-card">
        <div class="src-head"><div class="src-name"><span class="src-dot ok"></span>HCP — ภูเก็ต</div><span class="chip chip-src-hcp">openapi_pull</span></div>
        <div class="src-meta"><span>Record</span><span>${MASTER.reduce((n,m)=>n+m.links.filter(l=>l.source==='hcp_phuket').length,0)}</span></div>
        <div class="src-meta"><span>Sync ล่าสุด</span><span>18 นาทีที่แล้ว</span></div>
      </div>
      <div class="src-card off">
        <div class="src-head"><div class="src-name"><span class="src-dot off"></span>HCP — Site อื่น</div><span class="chip chip-case">ยังไม่ตั้งค่า</span></div>
        <div class="src-meta"><span colspan="2">รอ AppKey จากไซต์ใหม่</span></div>
      </div>`;
  }

  function renderImportFeed() {
    const all = MASTER.flatMap(m => m.links.map(l => ({ ...l, master: m.name })))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 6);
    $('importFeed').innerHTML = all.map(r => `
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border-hairline)">
        <span><span class="chip ${SOURCES[r.source].chip}">${SOURCES[r.source].name}</span> ${r.master}</span>
        <span style="color:var(--text-secondary);white-space:nowrap">${r.importedAt}</span>
      </div>`).join('');
  }

  let chart = null;
  function renderChart() {
    const ctx = $('chSource');
    if (!ctx || typeof Chart === 'undefined') { ctx.replaceWith(Object.assign(document.createElement('div'), {
      style: 'font-size:12px;color:var(--text-secondary);text-align:center;padding:60px 0', textContent: '(Chart.js ไม่ได้โหลด — ตัวเลข: GuruSquare ' +
        MASTER.reduce((n,m)=>n+m.links.filter(l=>l.source==='gurusquare').length,0) + ' · HCP ภูเก็ต ' +
        MASTER.reduce((n,m)=>n+m.links.filter(l=>l.source==='hcp_phuket').length,0) + ')' })); return; }
    if (chart) chart.destroy();
    const style = getComputedStyle(document.documentElement);
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['GuruSquare', 'HCP — ภูเก็ต'],
        datasets: [{
          data: [
            MASTER.reduce((n, m) => n + m.links.filter(l => l.source === 'gurusquare').length, 0),
            MASTER.reduce((n, m) => n + m.links.filter(l => l.source === 'hcp_phuket').length, 0),
          ],
          backgroundColor: [style.getPropertyValue('--accent').trim(), 'rgba(168,85,247,.8)'],
          borderRadius: 6, maxBarThickness: 60,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: style.getPropertyValue('--text-secondary').trim() } },
          y: { beginAtZero: true, ticks: { precision: 0, color: style.getPropertyValue('--text-secondary').trim() }, grid: { color: style.getPropertyValue('--border-hairline').trim() } },
        },
      },
    });
  }

  function idHtml(m) {
    if (!m.idType) return '<span class="chip chip-noid">ไม่มีเลขบัตร (no-ID)</span>';
    return m.idNum;
  }

  function renderMasterList(filterText, filterSrc) {
    let rows = MASTER;
    if (filterSrc) rows = rows.filter(m => m.links.some(l => l.source === filterSrc));
    if (filterText) {
      const q = filterText.toLowerCase();
      rows = rows.filter(m => m.name.toLowerCase().includes(q) || (m.idNum || '').toLowerCase().includes(q));
    }
    if (!rows.length) { $('blList').innerHTML = '<div class="bl-empty">ไม่พบข้อมูลที่ตรงเงื่อนไข</div>'; return; }
    $('blList').innerHTML = rows.map(m => {
      const srcSet = [...new Set(m.links.map(l => l.source))];
      return `
      <div class="bl-row" data-id="${m.id}">
        <div class="bl-avatar">${avatarSvg()}</div>
        <div class="bl-main">
          <div class="bl-name">${m.name}</div>
          <div class="bl-idnum">${idHtml(m)}</div>
          <div class="bl-chips">
            ${srcSet.map(s => `<span class="chip ${SOURCES[s].chip}">${SOURCES[s].name}</span>`).join('')}
          </div>
        </div>
        <div class="bl-side">
          <div class="bl-casecount">คดี <b>${m.links.length}</b></div>
          <span class="bl-status ${m.status}">${m.status === 'active' ? 'active' : 'inactive'}</span>
        </div>
      </div>`;
    }).join('');
  }

  function openMasterModal(id) {
    const m = MASTER.find(x => x.id === id);
    if (!m) return;
    const names = [...new Set(m.links.map(l => l.nameRaw))];
    $('blModalBody').innerHTML = `
      <div class="bl-detail-head">
        <div class="bl-detail-avatar">${avatarSvg()}</div>
        <div>
          <div class="bl-detail-name">${m.name}</div>
          <div class="bl-detail-idnum">${idHtml(m)}</div>
        </div>
      </div>
      ${names.length > 1 ? `
      <div class="conflict-box">
        <div class="lbl">ชื่อสะกดต่างกันระหว่าง source (singular-attribute conflict)</div>
        ${m.links.map(l => `<div class="row"><span>${l.nameRaw}</span><span class="src">${SOURCES[l.source].name}</span></div>`).join('')}
        <div style="font-size:11px;color:var(--text-secondary);margin-top:6px">ใช้ค่าตามลำดับความน่าเชื่อถือของ source เป็นชื่อแสดงผลหลัก — เก็บค่าดิบทุกอันไว้ใน source_records ไม่ทับกัน</div>
      </div>` : ''}
      <div class="bl-section-label">เชื่อมโยงจาก Source Record <span class="cnt">${m.links.length}</span></div>
      ${m.links.map(l => `
        <div class="case-card">
          <div class="case-head">
            <span class="case-ref">${l.caseRef}</span>
            <span class="chip ${SOURCES[l.source].chip}">${SOURCES[l.source].name}</span>
          </div>
          <div class="case-note">${l.note}</div>
          <div class="case-meta">นำเข้าเมื่อ ${l.importedAt} · ชื่อดิบจาก source: "${l.nameRaw}"</div>
        </div>`).join('')}
      <div style="font-size:11px;color:var(--text-secondary);margin-top:10px;line-height:1.6">
        ระบบไม่ต่อ field หรือทับข้อมูลกัน — คนคนเดียวกันที่มีหลายคดีจากหลาย source จะเห็นเป็น master เดียว
        แต่มี source record แยกตามจริงเสมอ ย้อนดูที่มาแต่ละคดีได้ครบ ไม่สูญหาย
      </div>`;
    $('blModal').classList.remove('hidden');
  }

  function renderBucket(src) {
    $('bucketTitle').textContent = 'ถังข้อมูลดิบ — ' + SOURCES[src].name;
    const rows = MASTER.flatMap(m => m.links.filter(l => l.source === src).map(l => ({ ...l, master: m })));
    $('bucketBody').innerHTML = rows.map(r => `
      <tr>
        <td>${src.toUpperCase()}-${r.caseRef}</td>
        <td>${r.nameRaw}</td>
        <td>${r.caseRef}</td>
        <td>${r.importedAt}</td>
        <td><span class="link-yes">✓ เชื่อมกับ ${r.master.id}</span></td>
      </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary)">ไม่มีข้อมูล</td></tr>';
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    if (cur === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    renderChart();
  }

  // ───────── bindings ─────────
  $('tabBar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab[data-tab]'); if (!b) return;
    document.querySelectorAll('#tabBar .tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.tab;
    ['overview', 'master', 'buckets', 'settings'].forEach(n => { $('tab-' + n).style.display = n === t ? '' : 'none'; });
  });

  $('blList').addEventListener('click', (e) => {
    const row = e.target.closest('.bl-row[data-id]'); if (!row) return;
    openMasterModal(row.dataset.id);
  });
  $('blSearch').addEventListener('input', () => renderMasterList($('blSearch').value, $('blFilterSrc').value));
  $('blFilterSrc').addEventListener('change', () => renderMasterList($('blSearch').value, $('blFilterSrc').value));

  $('bucketSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-b]'); if (!b) return;
    document.querySelectorAll('#bucketSeg button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    renderBucket(b.dataset.b);
  });

  $('blModalX').addEventListener('click', () => $('blModal').classList.add('hidden'));
  $('blModal').addEventListener('click', (e) => { if (e.target.id === 'blModal') $('blModal').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('blModal').classList.add('hidden'); });

  $('btnTheme').addEventListener('click', toggleTheme);

  // ───────── init ─────────
  renderKpi();
  renderSrcGrid();
  renderImportFeed();
  renderChart();
  renderMasterList('', '');
  renderBucket('gurusquare');
})();
