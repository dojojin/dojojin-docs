// ============================================================
// Vigil Platform — สถิติการทิ้งขยะ (livetrashbin)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// ทุกตัวเลขนับจาก window.TRASH_DATA.events (ภาพจริงที่คัดแล้ว) — ไม่มีค่าที่พิมพ์ไว้เอง
// CSP: ไม่มี inline handler — ทุก event ผ่าน data-action · สีกราฟอ่านจาก token CSS
// ============================================================
(function () {
  'use strict';
  const D = window.TRASH_DATA;
  const $ = (id) => document.getElementById(id);
  const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const imgUrl = (ts) => D.imgBase + ts + '.jpg';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (t) => t.slice(0, 5);
  const pad = (n) => String(n).padStart(2, '0');
  const isDay = (t) => hm(t) < D.dayEnds;

  let current = 'all';
  const charts = {};
  const PERIOD = { all: 'ทั้งหมด', day: 'กลางวัน', night: 'กลางคืน' };
  const selected = () => D.events.filter(([t]) => current === 'all' || (current === 'day') === isDay(t));

  // ชั่วโมงแรกถึงชั่วโมงสุดท้ายที่มีข้อมูล (คงที่ ไม่เปลี่ยนตามตัวกรอง จะได้เทียบกันได้)
  const hours = (() => {
    const hs = D.events.map(([t]) => Number(t.slice(0, 2)));
    const out = []; for (let h = Math.min(...hs); h <= Math.max(...hs); h++) out.push(h);
    return out;
  })();
  const bins10 = () => hours.flatMap((h) => [0, 10, 20, 30, 40, 50].map((m) => `${pad(h)}:${pad(m)}`));
  const inBin = (t, b) => t.slice(0, 4) === b.slice(0, 4);

  // ── KPI ───────────────────────────────────────────────────
  function renderKpis() {
    const ev = selected();
    const first = ev.length ? hm(ev[0][0]) : '—', last = ev.length ? hm(ev[ev.length - 1][0]) : '—';
    $('kTotal').textContent = ev.length;
    $('kTotalFoot').textContent = `ครั้ง · ${D.date} · ${first}–${last} น.`;

    const byHour = {}; ev.forEach(([t]) => { byHour[t.slice(0, 2)] = (byHour[t.slice(0, 2)] || 0) + 1; });
    const peak = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
    $('kPeak').textContent = peak ? `${peak[0]}:00–${pad(Number(peak[0]) + 1)}:00` : '—';
    $('kPeakFoot').textContent = peak ? `${peak[1]} ครั้ง` : '';

    const day = D.events.filter(([t]) => isDay(t)).length;
    $('kDay').textContent = day;
    $('kDayFoot').textContent = `ครั้ง · ก่อน ${D.dayEnds} น.`;
    $('kNight').textContent = D.events.length - day;
    $('kNightFoot').textContent = `ครั้ง · ตั้งแต่ ${D.dayEnds} น.`;

    const scope = `${D.date} · ${PERIOD[current]}`;
    $('tbMinuteScope').textContent = scope;
    $('tbLogScope').textContent = `${scope} · ${ev.length} ครั้ง`;
    $('tbHourScope').textContent = `${D.date} · ${pad(hours[0])}:00–${pad(hours[hours.length - 1] + 1)}:00 น.`;
  }

  // ── ราย 10 นาที + ยอดสะสม ─────────────────────────────────
  function renderTimeline() {
    const labels = bins10();
    const ev = selected();
    const counts = labels.map((b) => ev.filter(([t]) => inBin(t, b)).length);
    let run = 0; const cum = counts.map((c) => (run += c));
    const ok = token('--status-ok'), sec = token('--text-secondary'), acc = token('--accent'), line = token('--border-hairline');
    const data = {
      labels,
      datasets: [
        { type: 'bar', label: 'จำนวนครั้ง', data: counts, backgroundColor: ok, borderRadius: 3, barPercentage: .8, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'ยอดสะสม', data: cum, borderColor: acc, backgroundColor: acc, borderWidth: 2.5, pointRadius: 0, tension: .3, yAxisID: 'y2', order: 1 },
      ],
    };
    if (charts.timeline) { charts.timeline.data = data; charts.timeline.update(); return; }
    charts.timeline = new Chart($('cMinute'), {
      data,
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (it) => `${it[0].label}–${it[0].label.slice(0, 3)}${pad(Number(it[0].label.slice(3)) + 9)} น.` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: sec, maxRotation: 0, autoSkip: false,
               callback: (v, i) => (labels[i].endsWith(':00') ? labels[i] : '') } },
          y: { beginAtZero: true, ticks: { color: sec, precision: 0 }, grid: { color: line },
               title: { display: true, text: 'ครั้ง / 10 นาที', color: sec } },
          y2: { position: 'right', beginAtZero: true, ticks: { color: acc, precision: 0 }, grid: { display: false },
                title: { display: true, text: 'สะสม', color: acc } },
        },
      },
    });
  }

  // ── รายชั่วโมง (เขียว = กลางวัน · น้ำเงิน = กลางคืน) ────
  function renderHourly() {
    const ok = token('--status-ok'), acc = token('--accent'), sec = token('--text-secondary'), line = token('--border-hairline');
    const labels = hours.map((h) => `${pad(h)}:00`);
    const counts = hours.map((h) => D.events.filter(([t]) => Number(t.slice(0, 2)) === h).length);
    charts.hourly = new Chart($('cCompare'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'จำนวนครั้ง', data: counts, backgroundColor: labels.map((l) => (l < D.dayEnds ? ok : acc)), borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (it) => `${it[0].label}–${pad(Number(it[0].label.slice(0, 2)) + 1)}:00 น.` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: sec } },
          y: { beginAtZero: true, ticks: { color: sec, precision: 0 }, grid: { color: line } },
        },
      },
      plugins: [{
        id: 'valueLabel',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save(); ctx.fillStyle = token('--text-primary'); ctx.textAlign = 'center';
          ctx.font = '700 12px ' + getComputedStyle(document.body).fontFamily;
          chart.getDatasetMeta(0).data.forEach((bar, i) => { if (counts[i]) ctx.fillText(counts[i], bar.x, bar.y - 6); });
          ctx.restore();
        },
      }],
    });
  }

  // ── ความหนาแน่น: แถว = ชั่วโมง · ช่อง = 10 นาที ──────────
  function renderHeat() {
    const ev = selected();
    const n = (b) => ev.filter(([t]) => inBin(t, b)).length;
    const max = Math.max(1, ...bins10().map(n));
    const rows = hours.map((h) => {
      const cells = [0, 10, 20, 30, 40, 50].map((m) => {
        const b = `${pad(h)}:${pad(m)}`, c = n(b);
        const lvl = c === 0 ? 0 : Math.max(1, Math.ceil((c / max) * 4));
        return `<span class="cell" data-lvl="${lvl}" title="${b} · ${c} ครั้ง">${c || ''}</span>`;
      }).join('');
      return `<div class="heat-row"><div class="heat-name">${pad(h)}:00</div><div class="heat-cells">${cells}</div></div>`;
    }).join('');
    const axis = `<div class="heat-axis"><span></span><div>${[':00', ':10', ':20', ':30', ':40', ':50'].map((x) => `<span>${x}</span>`).join('')}</div></div>`;
    $('tbHeat').innerHTML = rows + axis;
  }

  // ── รายการเหตุการณ์ ───────────────────────────────────────
  function renderLog() {
    $('tbLog').innerHTML = selected().map(([t, ts], i) =>
      `<tr><td class="num">${i + 1}</td><td>${esc(t.slice(0, 8))}</td><td>${isDay(t) ? 'กลางวัน' : 'กลางคืน'}</td>
       <td><button class="linkbtn" data-action="open" data-ts="${ts}">ดูภาพ</button></td></tr>`).join('');
  }

  // ── ภาพเหตุการณ์ล่าสุด (เล่นต่อเนื่อง) ────────────────────
  const byTs = Object.fromEntries(D.events.map(([t, ts]) => [ts, t]));
  const featured = D.featured.filter((ts) => byTs[ts]);
  const order = [...featured, ...D.events.map((e) => e[1]).filter((ts) => !featured.includes(ts)).reverse()];
  let pos = 0; const recent = [];

  function showLive(ts, animate) {
    const img = $('tbLiveImg');
    const apply = () => { img.src = imgUrl(ts); img.dataset.ts = ts; img.classList.remove('fading'); };
    if (animate) { img.classList.add('fading'); setTimeout(apply, 250); } else apply();
    $('tbLiveTime').textContent = byTs[ts] ? byTs[ts].slice(0, 8) : '';
    $('tbLiveMeta').textContent = `${D.camera} · ${D.cameraModel}`;
    recent.unshift(ts); if (recent.length > 8) recent.length = 8;
    $('tbStrip').innerHTML = recent.map((t, i) =>
      `<button class="thumb${i === 0 ? ' current enter' : ''}" data-action="open" data-ts="${t}" aria-label="ภาพเวลา ${byTs[t]}"><img loading="lazy" src="${imgUrl(t)}" alt=""></button>`).join('');
  }
  function tick() { pos = (pos + 1) % order.length; showLive(order[pos], true); }

  // ── คลังภาพ ──────────────────────────────────────────────
  const PAGE = 24; let shown = PAGE;
  function renderGallery() {
    const list = selected().slice().reverse();
    $('tbGalleryCount').textContent = `${list.length} ครั้ง`;
    $('tbGalleryScope').textContent = list.length
      ? `${D.camera} · ${D.date} · ${hm(list[list.length - 1][0])}–${hm(list[0][0])} น.` : '—';
    $('tbGallery').innerHTML = list.slice(0, shown).map(([t, ts]) =>
      `<button class="thumb" data-action="open" data-ts="${ts}" aria-label="ภาพเวลา ${t}"><img loading="lazy" src="${imgUrl(ts)}" alt=""><span>${t.slice(0, 8)}</span></button>`).join('');
    $('tbMore').hidden = shown >= list.length;
  }

  // ── lightbox ─────────────────────────────────────────────
  function openLb(ts) {
    $('tbLbImg').src = imgUrl(ts);
    $('tbLbCap').textContent = `${D.camera} · ${D.place} · ${D.date} ${byTs[ts] ? byTs[ts].slice(0, 8) : ''}`;
    $('tbLightbox').hidden = false;
  }
  const closeLb = () => { $('tbLightbox').hidden = true; $('tbLbImg').removeAttribute('src'); };

  // ── events ───────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) { if (e.target.id === 'tbLightbox') closeLb(); return; }
    const a = el.dataset.action;
    if (a === 'session') {
      current = el.dataset.session;
      document.querySelectorAll('#tbSeg .segbtn').forEach((b) => b.classList.toggle('active', b === el));
      shown = PAGE;
      renderKpis(); renderTimeline(); renderHeat(); renderLog(); renderGallery();
    } else if (a === 'open') openLb(el.dataset.ts);
    else if (a === 'openLive') openLb($('tbLiveImg').dataset.ts);
    else if (a === 'closeLb') closeLb();
    else if (a === 'more') { shown += PAGE; renderGallery(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });

  $('tbSub').textContent = `${D.camera} · ${D.place} · ${D.site}`;
  renderKpis(); renderTimeline(); renderHourly(); renderHeat(); renderLog(); renderGallery();
  featured.slice().reverse().forEach((ts) => showLive(ts, false));
  pos = featured.length - 1;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(tick, 5000);
}());
