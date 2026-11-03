// ============================================================
// Vigil Platform — Blacklist Database (LPR) DRAFT demo
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// DRAFT/DEMO ONLY. All data below is synthetic/mock — see banner in index.html.
// Mirrors the data model in docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md:
// blacklist.sources -> blacklist.source_records -> blacklist.master -> blacklist.master_links
// -> bridge -> lpr_watchlist (origin/blacklist_master_id) -> existing F3 LINE alert path.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const SOURCES = {
    gurusquare: { name: 'GuruSquare',        chip: 'chip-src-gurusquare' },
    hcp_phuket: { name: 'HCP — Site ภูเก็ต', chip: 'chip-src-hcp' },
  };

  function avatarSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>';
  }

  const MASTER = [
    {
      id: 'M-1001', name: 'ธนกร ไพศาล (สมมติ)', idType: 'national_id', idNum: '1-2xxx-64000-xx-7',
      status: 'active',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2024-0118', note: 'ต้องสงสัยคดียาเสพติด', importedAt: '2026-05-14', nameRaw: 'ธนกร ไพศาล', plate: '1กข 4521 กทม' },
        { source: 'hcp_phuket', caseRef: 'PKT-2025-0401', note: 'คดีลักทรัพย์ยานพาหนะ', importedAt: '2026-06-30', nameRaw: 'ธนกร ไพศาล', plate: 'ผข 8832 ภูเก็ต' },
      ],
    },
    {
      id: 'M-1002', name: 'สมหญิง แสงทอง (สมมติ)', idType: 'national_id', idNum: '1-3xxx-29000-xx-5',
      status: 'active',
      links: [
        { source: 'hcp_phuket', caseRef: 'PKT-2025-0287', note: 'ฝ่าฝืนคำสั่งศาล', importedAt: '2026-04-02', nameRaw: 'สมหญิง แสงทอง', plate: '3กค 9012 ภูเก็ต' },
      ],
    },
    {
      id: 'M-1003', name: 'David Smith (สมมติ)', idType: 'passport', idNum: 'GB · P-y7y8y9y',
      status: 'active',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2024-0166', note: 'เช่ารถแล้วไม่คืน', importedAt: '2026-03-19', nameRaw: 'David Smith', plate: 'ฮต 1120 กทม' },
      ],
    },
    {
      id: 'M-1004', name: 'ไม่ทราบชื่อ #229 (สมมติ)', idType: null, idNum: null,
      status: 'active',
      links: [
        { source: 'gurusquare', caseRef: 'KDD-2024-0210', note: 'สังเกตการณ์ — ยังไม่ยืนยันทะเบียนชัดเจน', importedAt: '2026-06-05', nameRaw: '(ไม่ระบุ)', plate: null },
      ],
    },
    {
      id: 'M-1005', name: 'อนุชา บุญมี (สมมติ)', idType: 'national_id', idNum: '1-4xxx-51000-xx-3',
      status: 'inactive',
      links: [
        { source: 'hcp_phuket', caseRef: 'PKT-2025-0099', note: 'คดีปิดแล้ว — เก็บไว้อ้างอิงประวัติ', importedAt: '2025-10-21', nameRaw: 'อนุชา บุญมี', plate: '8ขค 3345 ภูเก็ต' },
      ],
    },
  ];

  // Mock lpr_watchlist rows AFTER the bridge sync — demonstrates origin-safety:
  // bridge only ever touches origin='blacklist_bridge' rows; the manual row is untouched.
  const BRIDGE_ROWS = [
    { plate: '1กข 4521 กทม', label: 'Blacklist: GuruSquare (KDD-2024-0118)', origin: 'bridge', master: 'M-1001', synced: '4 นาทีที่แล้ว', status: 'synced' },
    { plate: 'ผข 8832 ภูเก็ต', label: 'Blacklist: HCP ภูเก็ต (PKT-2025-0401)', origin: 'bridge', master: 'M-1001', synced: '4 นาทีที่แล้ว', status: 'synced' },
    { plate: '3กค 9012 ภูเก็ต', label: 'Blacklist: HCP ภูเก็ต (PKT-2025-0287)', origin: 'bridge', master: 'M-1002', synced: '4 นาทีที่แล้ว', status: 'synced' },
    { plate: 'ฮต 1120 กทม', label: 'Blacklist: GuruSquare (KDD-2024-0166)', origin: 'bridge', master: 'M-1003', synced: '4 นาทีที่แล้ว', status: 'synced' },
    { plate: '8ขค 3345 ภูเก็ต', label: 'Blacklist: HCP ภูเก็ต (PKT-2025-0099)', origin: 'bridge', master: 'M-1005', synced: '4 นาทีที่แล้ว', status: 'pending-removal' },
    { plate: 'กก 9999 กทม', label: 'รถต้องสงสัย (เพิ่มโดย operator)', origin: 'manual', master: '—', synced: '—', status: 'synced' },
  ];

  function renderKpi() {
    const totalMaster = MASTER.length;
    const totalRecords = MASTER.reduce((n, m) => n + m.links.length, 0);
    const bridgedPlates = BRIDGE_ROWS.filter(r => r.origin === 'bridge' && r.status === 'synced').length;
    const multiSource = MASTER.filter(m => new Set(m.links.map(l => l.source)).size > 1).length;
    const items = [
      { ka: 'var(--accent)', label: 'Master Identity ทั้งหมด', val: String(totalMaster),
        icon: '<circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>' },
      { ka: 'var(--purple, #a855f7)', label: 'Source Record นำเข้าแล้ว', val: String(totalRecords),
        icon: '<path d="M4 6h16M4 12h16M4 18h16"/>' },
      { ka: 'var(--status-ok)', label: 'ทะเบียนที่ Bridge เข้า Watchlist', val: String(bridgedPlates),
        icon: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/>' },
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
    if (!ctx || typeof Chart === 'undefined') return;
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
      rows = rows.filter(m => m.name.toLowerCase().includes(q) || (m.idNum || '').toLowerCase().includes(q) ||
        m.links.some(l => (l.plate || '').toLowerCase().includes(q)));
    }
    if (!rows.length) { $('blList').innerHTML = '<div class="bl-empty">ไม่พบข้อมูลที่ตรงเงื่อนไข</div>'; return; }
    $('blList').innerHTML = rows.map(m => {
      const srcSet = [...new Set(m.links.map(l => l.source))];
      const plates = [...new Set(m.links.map(l => l.plate).filter(Boolean))];
      return `
      <div class="bl-row" data-id="${m.id}">
        <div class="bl-avatar">${avatarSvg()}</div>
        <div class="bl-main">
          <div class="bl-name">${m.name}</div>
          <div class="bl-idnum">${idHtml(m)}</div>
          <div class="bl-plates">${plates.map(p => `<span class="plate-chip">${p}</span>`).join('') || '<span class="chip chip-case">ยังไม่มีทะเบียน</span>'}</div>
          <div class="bl-chips">${srcSet.map(s => `<span class="chip ${SOURCES[s].chip}">${SOURCES[s].name}</span>`).join('')}</div>
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
      </div>` : ''}
      <div class="bl-section-label">เชื่อมโยงจาก Source Record <span class="cnt">${m.links.length}</span></div>
      ${m.links.map(l => `
        <div class="case-card">
          <div class="case-head">
            <span class="case-ref">${l.caseRef}</span>
            <span class="chip ${SOURCES[l.source].chip}">${SOURCES[l.source].name}</span>
          </div>
          <div class="case-note">${l.note}</div>
          <div class="case-meta">ทะเบียน: ${l.plate || '(ยังไม่ระบุ)'} · นำเข้าเมื่อ ${l.importedAt} · ชื่อดิบจาก source: "${l.nameRaw}"</div>
        </div>`).join('')}
      <div style="font-size:11px;color:var(--text-secondary);margin-top:10px;line-height:1.6">
        คนคนเดียวกันที่มีทะเบียนต่างคันจากหลาย source (เช่นกรณีนี้) จะเห็นเป็น master เดียวและมีทะเบียนทั้งหมดผูกไว้ —
        ทะเบียนทุกคันจะถูก bridge เข้า <code>lpr_watchlist</code> เพื่อให้แจ้งเตือนจริงได้ครบ ไม่ใช่แค่คันแรก
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
        <td>${r.plate || '—'}</td>
        <td>${r.caseRef}</td>
        <td>${r.importedAt}</td>
        <td><span class="link-yes">✓ เชื่อมกับ ${r.master.id}</span></td>
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">ไม่มีข้อมูล</td></tr>';
  }

  function renderBridge() {
    $('bridgeBody').innerHTML = BRIDGE_ROWS.map(r => `
      <tr>
        <td><span class="plate-chip">${r.plate}</span></td>
        <td style="font-size:11px">${r.label}</td>
        <td><span class="origin-badge ${r.origin}">${r.origin === 'bridge' ? 'blacklist_bridge' : 'manual'}</span></td>
        <td style="font-family:monospace;font-size:11px">${r.master}</td>
        <td style="font-size:11px;color:var(--text-secondary)">${r.synced}</td>
        <td>${r.status === 'pending-removal'
          ? '<span class="link-no">รอลบ (master ปิดใช้งานแล้ว)</span>'
          : '<span class="link-yes">✓ synced</span>'}</td>
      </tr>`).join('');
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
    ['overview', 'master', 'bridge', 'buckets', 'settings'].forEach(n => { $('tab-' + n).style.display = n === t ? '' : 'none'; });
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
  renderBridge();
})();
