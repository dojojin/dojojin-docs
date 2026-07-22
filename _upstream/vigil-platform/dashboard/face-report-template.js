// ============================================================
// Vigil Platform — Person Report Template (shared preview ↔ print)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Pure builder for the dedicated Person report. Used by the Puppeteer print
// page (report-face-print.html) to render the SAME class-based HTML + Chart.js
// charts as the on-screen preview, so the PNG/PDF download matches the preview.
// Relies on index.css (.rpt-* / .cmp-* classes + design tokens) being loaded.
//
// buildHtml(data, brand, opts) → full report HTML string
//   opts: { mode:'screen'|'print', lang, sections:{peak,demographics,trend,persons,suspects},
//           suspectPage, suspectPerPage, snapWidth }
// initCharts(data, opts) → init Chart.js (call AFTER the HTML is in the DOM)
//   opts: { animation:false } for Puppeteer capture.

(function (root) {
  'use strict';

  const esc = (v) => (typeof escapeHtml === 'function'
    ? escapeHtml(v == null ? '' : String(v))
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const fmt   = (n) => (Number(n) || 0).toLocaleString();
  const label = (k, fb) => (typeof I18N !== 'undefined' ? I18N.t(k, fb) : fb);
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const getLang = () => (typeof I18N !== 'undefined' && I18N.getLang ? I18N.getLang() : 'th');
  const remapDays = (labels) => {
    if (getLang() === 'en') return labels;
    const M = { Sun: 'อา.', Mon: 'จ.', Tue: 'อ.', Wed: 'พ.', Thu: 'พฤ.', Fri: 'ศ.', Sat: 'ส.' };
    return (labels || []).map(l => M[l] || l);
  };

  let _charts = [];
  function destroyCharts() { _charts.forEach(c => { try { c.destroy(); } catch (e) {} }); _charts = []; }

  // value-above-bar plugin (no external dep)
  const barLabelPlugin = {
    id: 'rpt-barlabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, i) => {
        chart.getDatasetMeta(i).data.forEach((bar, j) => {
          const v = ds.data[j];
          if (!v) return;
          ctx.save();
          ctx.fillStyle = Chart.defaults.color || '#718096';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(v, bar.x, bar.y - 2);
          ctx.restore();
        });
      });
    },
  };

  function chart(canvasId, type, labels, datasets, extra, animation) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const grid = token('--border-hairline');
    Chart.defaults.color = token('--text-secondary');
    _charts.push(new Chart(canvas, {
      type,
      data: { labels, datasets },
      plugins: type === 'bar' ? [barLabelPlugin] : [],
      options: Object.assign({
        maintainAspectRatio: false,
        animation: animation === false ? false : undefined,
        plugins: { legend: { display: datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: type === 'doughnut' ? undefined : {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { grid: { color: grid }, ticks: { font: { size: 11 } } },
        },
      }, extra || {}),
    }));
  }

  // ── HTML sections ─────────────────────────────────────────
  function header(title, meta, brand) {
    const brandName = brand?.name || 'Vigil Platform';
    const tagline = brand?.tagline || '';
    const logoUrl = brand?.logo_url ? `${brand.logo_url}?v=1` : null;
    const genLocale = getLang() === 'en' ? 'en-GB' : 'th-TH';
    const genStr = `${label('rpt.generatedAt', 'สร้างเมื่อ')} ${new Date().toLocaleString(genLocale, { hour12: false })}`;
    const logo = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="logo" class="rpt-logo-img">`
      : `<span class="rpt-logo">${esc(brandName.slice(0, 1) || 'V')}</span>`;
    return `<div class="rpt-head">
      <div class="rpt-brand">${logo}<div><div class="rpt-title-doc">${esc(title)}</div><div class="rpt-muted">${esc(meta)}</div></div></div>
      <div class="rpt-head-meta"><div class="rpt-brand-name">${esc(brandName)}</div>${tagline ? `<div class="rpt-brand-sub">${esc(tagline)}</div>` : ''}<div class="rpt-muted">${esc(genStr)}</div></div>
    </div>`;
  }

  function kpis(items) {
    return `<div class="rpt-execrow">${items.map(t => `<div class="rpt-exec" style="--ka:${esc(t.color)}"><div class="rpt-exec-v">${fmt(t.value)}</div><div class="rpt-exec-k">${esc(t.label)}</div></div>`).join('')}</div>`;
  }

  function peakSection(peak, lbl) {
    const max = peak?.max || 0;
    const idx = peak?.index ?? -1;
    const peakLabel = idx >= 0 ? (peak.labels || [])[idx] : '-';
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent)"></span>${esc(lbl)} <span class="rpt-pill">${esc(peakLabel)} · ${fmt(max)}</span></div><div class="rpt-chartbox"><canvas id="rptFacePeakChart"></canvas></div></div>`;
  }

  function demoSection() {
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-ok)"></span>${esc(label('rpt.demographics', 'ข้อมูลประชากร'))}</div>
      <div class="rpt-2col">
        <div class="rpt-chartbox sm"><div class="rpt-chart-cap">${esc(label('rpt.gender', 'เพศ'))}</div><canvas id="rptFaceGenderChart"></canvas></div>
        <div class="rpt-chartbox sm"><div class="rpt-chart-cap">${esc(label('rpt.ageGroup', 'ช่วงอายุ (ปี)'))}</div><canvas id="rptFaceAgeChart"></canvas></div>
      </div>
    </div>`;
  }

  function accessoriesSection(accessories, captures) {
    const a = accessories || {};
    const pct = n => captures > 0 ? ' · ' + Math.round(n / captures * 100) + '%' : '';
    const items = [
      { label: label('rpt.wearGlasses', 'แว่นตา'), count: a.glass || 0, color: 'var(--accent)' },
      { label: label('rpt.wearMask', 'หน้ากาก'),   count: a.mask || 0,  color: 'var(--warn)' },
      { label: label('rpt.wearHat', 'หมวก'),        count: a.hat || 0,   color: 'var(--status-ok)' },
      { label: label('rpt.carryBag', 'กระเป๋า'),    count: a.bag || 0,   color: 'var(--accent-muted)' },
    ];
    const html = items.map(it => `<div class="rpt-acc-item"><div class="rpt-acc-val" style="color:${it.color}">${fmt(it.count)}</div><div class="rpt-acc-sub">${esc(pct(it.count))}</div><div class="rpt-acc-label">${esc(it.label)}</div></div>`).join('');
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent-muted)"></span>${esc(label('rpt.accessories', 'ลักษณะ/ของติดตัว'))}</div><div class="rpt-acc-grid">${html}</div></div>`;
  }

  function trendSection(lbl) {
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--warn)"></span>${esc(lbl)}</div><div class="rpt-chartbox"><canvas id="rptFaceTrendChart"></canvas></div></div>`;
  }

  function personsSection(rows) {
    const body = rows.length
      ? rows.map(p => `<tr><td><span class="rpt-ava">${esc((p.name || '?').slice(0, 1))}</span>${esc(p.name || 'Unknown')} <span class="rpt-muted">${esc(p.group_name || '')}</span></td><td class="rpt-num">${fmt(p.hits)}</td></tr>`).join('')
      : `<tr><td colspan="2" class="rpt-muted">${esc(label('rpt.noData', 'ไม่มีข้อมูล'))}</td></tr>`;
    return `<div class="rpt-section"><div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--accent-muted)"></span>${esc(label('rpt.topPersons', 'บุคคลที่พบบ่อย'))}</div><table class="rpt-table">${body}</table></div>`;
  }

  function suspectCard(r, snapWidth) {
    const thumb = (f) => f ? `<img src="/snapshots/${encodeURIComponent(f)}?w=${snapWidth}" alt="" style="max-width:100%;max-height:80px;border-radius:5px;object-fit:cover;margin-bottom:4px">` : '';
    const score = r.score_pct != null ? String(r.score_pct) : (r.score != null ? String(Math.round(Number(r.score) * 100)) : '-');
    const dt = r.event_time ? new Date(r.event_time).toLocaleString('th-TH', { hour12: false }) : '-';
    return `<div class="cmp-card" style="--gc:var(--status-bad)">
      <div class="cmp-imgs">
        <div class="cmp-box">${thumb(r.snapshot)}<span class="cmp-cap">${esc(label('rpt.captured', 'ภาพจากกล้อง'))}</span><span class="rpt-muted">#${esc(String(r.id))}</span></div>
        <div class="cmp-box ref">${thumb(r.ref_snapshot)}<span class="cmp-cap">${esc(label('rpt.reference', 'ภาพอ้างอิง'))}</span><span class="rpt-muted">${esc(r.human_id || '-')}</span></div>
      </div>
      <span class="rpt-badge" style="background:var(--status-bad);margin-top:8px;display:inline-block">${esc(r.group_name || 'blackList')}</span>
      <div class="cmp-name">${esc(r.name || 'Unknown')}</div>
      <div class="rpt-muted" style="font-size:11px">${esc(dt)}</div>
      <div class="rpt-muted">${esc(r.camera_id)} · ${esc(score)}%</div>
    </div>`;
  }

  function suspectsSection(rows, opts) {
    const head = `<div class="rpt-sec-head"><span class="rpt-sec-dot" style="background:var(--status-bad)"></span>${esc(label('rpt.suspectHits', 'ผู้ต้องสงสัย/เฝ้าระวัง'))}</div>`;
    if (!rows.length) {
      return `<div class="rpt-section">${head}<div class="rpt-muted">${esc(label('rpt.noSuspects', 'ไม่พบบุคคลเฝ้าระวังตามเงื่อนไข'))}</div></div>`;
    }
    // 160 = smallest server-allowed thumbnail width (THUMB_WIDTHS). 120 is not
    // a valid preset → the route would fall back to the FULL image (multi-MB).
    const snapWidth = opts.snapWidth || 160;
    let shown = rows;
    let pager = '';
    if (opts.mode === 'screen') {
      const per = opts.suspectPerPage || 12;
      const page = Math.max(1, opts.suspectPage || 1);
      shown = rows.slice((page - 1) * per, page * per);
      pager = `<div id="rptSuspectPager"></div>`;
    }
    const cards = `<div class="cmp-grid">${shown.map(r => suspectCard(r, snapWidth)).join('')}</div>`;
    return `<div class="rpt-section">${head}${cards}${pager}</div>`;
  }

  // ── public: build full report HTML ────────────────────────
  function buildHtml(data, brand, opts) {
    opts = opts || {};
    const mode = opts.mode || 'print';
    const sec = opts.sections || { peak: true, demographics: true, trend: true, persons: true, suspects: true };
    const k = data.kpi || {};
    const meta = `${label('rpt.period', 'ช่วงข้อมูล')}: ${esc(data.period)} · ${label('rpt.minScore', 'ความมั่นใจขั้นต่ำ')} ${fmt(data.min_score)}%`;
    if (data.peak?.labels)  data.peak.labels  = remapDays(data.peak.labels);
    if (data.trend?.labels) data.trend.labels = remapDays(data.trend.labels);

    const parts = [];
    if (sec.peak)         parts.push(peakSection(data.peak, label('rpt.peak', 'ช่วงหนาแน่น')));
    if (sec.demographics) { parts.push(demoSection()); parts.push(accessoriesSection(data.demographics?.accessories, k.captures || 0)); }
    if (sec.trend)        parts.push(trendSection(label('rpt.trend', 'แนวโน้ม')));
    if (sec.persons)      parts.push(personsSection(data.top_persons || []));
    if (sec.suspects)     parts.push(suspectsSection(data.suspects || [], Object.assign({ mode }, opts)));

    const title = (opts.title && String(opts.title).trim()) || label('rpt.faceTitle', 'รายงานบุคคล');
    return header(title, meta, brand)
      + kpis([
        { label: label('rpt.captures', 'ใบหน้าทั้งหมด'), value: k.captures, color: 'var(--accent)' },
        { label: label('rpt.known', 'จดจำได้'),          value: k.known,    color: 'var(--accent-muted)' },
        { label: label('rpt.unknown', 'ไม่รู้จัก'),       value: k.unknown,  color: 'var(--warn)' },
        { label: label('rpt.watch', 'เฝ้าระวัง'),         value: k.watch,    color: 'var(--status-bad)' },
      ])
      + (parts.length ? parts.join('') : `<div class="rpt-empty">${esc(label('rpt.pickOneSection', 'เลือกเนื้อหาอย่างน้อย 1 หมวด'))}</div>`)
      + `<div class="rpt-foot"><span>${esc(label('rpt.pdpaFace', 'เอกสารลับ · ข้อมูลใบหน้าเป็นข้อมูลอ่อนไหว'))}</span><span>${esc(brand?.name || 'Vigil Platform')}</span></div>`;
  }

  // ── public: init Chart.js (call after HTML is in DOM) ──────
  function initCharts(data, opts) {
    opts = opts || {};
    const anim = opts.animation;
    const sec = opts.sections || { peak: true, demographics: true, trend: true };
    const acc = token('--accent');
    const warn = token('--warn');
    const bad = token('--status-bad');
    const ok = token('--status-ok');
    if (sec.peak && data.peak) {
      chart('rptFacePeakChart', 'bar', data.peak.labels, [{ data: data.peak.values, backgroundColor: data.peak.values.map((_, i) => i === data.peak.index ? bad : acc), borderRadius: 3 }], { plugins: { legend: { display: false } } }, anim);
    }
    if (sec.demographics) {
      const g = data.demographics?.gender || {};
      const a = data.demographics?.age || {};
      chart('rptFaceGenderChart', 'doughnut', [label('rpt.male', 'ชาย'), label('rpt.female', 'หญิง'), label('rpt.unknown', 'ไม่ทราบ')], [{ data: [g.male || 0, g.female || 0, g.unknown || 0], backgroundColor: [acc, bad, token('--text-secondary')], borderWidth: 0 }], { cutout: '60%', plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }, anim);
      chart('rptFaceAgeChart', 'bar', ['0-19', '20-39', '40-59', '60+'], [{ data: [a.teen || 0, a.young || 0, a.mid || 0, a.senior || 0], backgroundColor: ok, borderRadius: 3 }], { plugins: { legend: { display: false } } }, anim);
    }
    if (sec.trend && data.trend) {
      chart('rptFaceTrendChart', 'line', data.trend.labels, [
        { label: label('rpt.known', 'จดจำได้'), data: data.trend.known, borderColor: acc, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
        { label: label('rpt.watch', 'เฝ้าระวัง'), data: data.trend.watch, borderColor: bad, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
        { label: label('rpt.unknown', 'ไม่รู้จัก'), data: data.trend.unknown, borderColor: warn, backgroundColor: 'transparent', tension: .35, pointRadius: 0 },
      ], undefined, anim);
    }
  }

  root.FaceReport = { buildHtml, initCharts, destroyCharts };
})(typeof window !== 'undefined' ? window : this);
