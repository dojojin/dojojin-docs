// ============================================================
// Vigil Platform — ปริมาณยานพาหนะเข้า–ออก
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// อ่านชุดข้อมูลจริงจาก vehiclecount-data.js (10 วัน · ถัง 5 นาที · 07:00–18:00)
// "สด" = เดินตามเวลาปัจจุบันของวัน (นอก 07:00–18:00 แสดงทั้งวัน) · "เล่นซ้ำ" = เร่งความเร็วตั้งแต่ 07:00
// CSP: script-src 'self' — ไม่มี inline handler · ทุกปุ่มใช้ data-action ผ่าน listener เดียว
// ============================================================
(function () {
  'use strict';
  const DATA = window.VEHICLE_COUNT;
  if (!DATA || !window.Chart) return;

  const NB = 132, BIN_MIN = DATA.binMinutes, START_MIN = 7 * 60;
  const PEAKS = { am: [6, 30], pm: [102, 126] };           // [เริ่ม, จบ) หน่วยถัง · 07:30–09:30 / 15:30–17:30
  const CLASSES = DATA.classes;
  const $ = (id) => document.getElementById(id);
  const wrap = document.querySelector('.vc-wrap');
  const css = (name) => getComputedStyle(wrap).getPropertyValue(name).trim();
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { sel: 'avg-weekday', cls: 'all', mode: REDUCED ? 'full' : 'live', speed: 5, pos: NB, hold: 0 };
  let view = null, tlChart = null, hrChart = null, lastTick = 0, galReady = false, galBin = -1;

  // ── ข้อมูลของตัวเลือกปัจจุบัน ──────────────────────────────
  const zeros = () => new Array(NB).fill(0);
  function seriesFor(days) {
    const byClass = {};
    for (const c of CLASSES) {
      const inn = zeros(), out = zeros();
      for (const d of days) for (let i = 0; i < NB; i++) { inn[i] += d.bins[c.key + '_in'][i]; out[i] += d.bins[c.key + '_out'][i]; }
      byClass[c.key] = { in: inn.map((v) => v / days.length), out: out.map((v) => v / days.length) };
    }
    return byClass;
  }
  function build() {
    const days = state.sel === 'avg-weekday' ? DATA.days.filter((d) => d.kind === 'weekday')
      : state.sel === 'avg-weekend' ? DATA.days.filter((d) => d.kind === 'weekend')
      : DATA.days.filter((d) => d.id === state.sel);
    const byClass = seriesFor(days);
    const keys = state.cls === 'all' ? CLASSES.map((c) => c.key) : [state.cls];
    const inn = zeros(), out = zeros();
    for (const k of keys) for (let i = 0; i < NB; i++) { inn[i] += byClass[k].in[i]; out[i] += byClass[k].out[i]; }
    const hIn = new Array(11).fill(0), hOut = new Array(11).fill(0);
    for (let i = 0; i < NB; i++) { hIn[Math.floor(i / 12)] += inn[i]; hOut[Math.floor(i / 12)] += out[i]; }
    view = { days, byClass, in: inn, out, hIn, hOut, nDays: days.length };
  }

  // ── รวมยอดถึงตำแหน่งเวลา pos (ถังที่กำลังเดินนับตามสัดส่วน) ────
  const part = (arr, from, to, pos) => { let s = 0; for (let i = from; i < to; i++) s += arr[i] * Math.min(1, Math.max(0, pos - i)); return s; };
  const fmt = (n) => Math.round(n).toLocaleString('th-TH');
  const pct = (a, b) => { const t = a + b; if (!t) return ['—', '—', null]; const p = Math.round((a / t) * 1000) / 10; return [p.toFixed(1) + '%', (Math.round((100 - p) * 10) / 10).toFixed(1) + '%', p]; };

  // ── เวลา ────────────────────────────────────────────────────
  const clockOf = (pos) => { const m = START_MIN + Math.min(NB, pos) * BIN_MIN; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'); };
  function livePos() {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
    const g = (t) => Number(p.find((x) => x.type === t).value);
    const min = g('hour') * 60 + g('minute') + g('second') / 60;
    return min >= START_MIN && min < START_MIN + NB * BIN_MIN ? (min - START_MIN) / BIN_MIN : NB;
  }
  const dayLabel = (id) => new Date(id + 'T12:00:00+07:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

  // ── วาด ─────────────────────────────────────────────────────
  function renderNums() {
    const pos = state.pos;
    const tin = part(view.in, 0, NB, pos), tout = part(view.out, 0, NB, pos);
    const [pi, po, pn] = pct(tin, tout);
    $('kpiIn').textContent = fmt(tin); $('kpiOut').textContent = fmt(tout); $('kpiTotal').textContent = fmt(tin + tout);
    $('kpiInPct').textContent = pi; $('kpiOutPct').textContent = po;
    const bar = $('kpiBar').children; bar[0].style.width = pn == null ? '0%' : pn + '%'; bar[1].style.width = pn == null ? '0%' : (100 - pn) + '%';
    const fullTotal = part(view.in, 0, NB, NB) + part(view.out, 0, NB, NB);
    for (const [key, id] of [['am', 'Am'], ['pm', 'Pm']]) {
      const [s, e] = PEAKS[key];
      const a = part(view.in, s, e, pos), b = part(view.out, s, e, pos);
      const [qi, qo, qn] = pct(a, b);
      $('peak' + id + 'In').textContent = fmt(a); $('peak' + id + 'Out').textContent = fmt(b); $('peak' + id + 'Total').textContent = fmt(a + b);
      $('peak' + id + 'InPct').textContent = qi; $('peak' + id + 'OutPct').textContent = qo;
      $('peak' + id + 'BarIn').style.width = qn == null ? '0%' : qn + '%'; $('peak' + id + 'BarOut').style.width = qn == null ? '0%' : (100 - qn) + '%';
      const st = $('peak' + id + 'State');
      if (state.mode === 'full') { st.textContent = ''; st.removeAttribute('data-s'); }
      else if (pos < s) { st.textContent = 'รอ'; st.removeAttribute('data-s'); }
      else if (pos < e) { st.textContent = 'กำลังเกิด'; st.setAttribute('data-s', 'on'); }
      else { st.textContent = 'สิ้นสุด'; st.removeAttribute('data-s'); }
      const done = pos >= e && fullTotal > 0;
      $('peak' + id + 'Share').innerHTML = done ? 'คิดเป็น <b>' + (((a + b) / fullTotal) * 100).toFixed(1) + '%</b> ของปริมาณทั้งวัน' : '';
    }
    // ตารางแยกประเภท (ไม่ผูกกับตัวกรองประเภท)
    const rows = []; let sIn = 0, sOut = 0;
    for (const c of CLASSES) {
      const a = part(view.byClass[c.key].in, 0, NB, pos), b = part(view.byClass[c.key].out, 0, NB, pos);
      sIn += a; sOut += b; const [qi, qo] = pct(a, b);
      rows.push('<tr><td>' + c.label + '</td><td class="num in">' + fmt(a) + '</td><td class="num out">' + fmt(b) + '</td><td class="num">' + fmt(a + b) + '</td><td class="num">' + qi + '</td><td class="num">' + qo + '</td></tr>');
    }
    const [ti, to] = pct(sIn, sOut);
    rows.push('<tr><td><b>รวม</b></td><td class="num in">' + fmt(sIn) + '</td><td class="num out">' + fmt(sOut) + '</td><td class="num"><b>' + fmt(sIn + sOut) + '</b></td><td class="num">' + ti + '</td><td class="num">' + to + '</td></tr>');
    document.querySelector('#vcTable tbody').innerHTML = rows.join('');
  }

  const bandsPlugin = {
    id: 'vcBands',
    beforeDatasetsDraw(chart) {
      const x = chart.scales.x, a = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.globalAlpha = 0.1; ctx.fillStyle = css('--vc-in');
      for (const k of ['am', 'pm']) { const x0 = x.getPixelForValue(PEAKS[k][0]), x1 = x.getPixelForValue(PEAKS[k][1]); ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top); }
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      if (state.mode === 'full' || state.pos >= NB) return;
      const x = chart.scales.x, a = chart.chartArea, ctx = chart.ctx, px = x.getPixelForValue(state.pos);
      ctx.save(); ctx.strokeStyle = css('--text-secondary'); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore();
    },
  };

  // แกนเวลาต้องไปจบที่ 18:00: ถังสุดท้ายเริ่ม 17:55 จึงเติมป้ายปลายแกน (ไม่มีข้อมูล) · แท่งรายชั่วโมงใช้ช่วง 07–08 … 17–18
  const labels5 = Array.from({ length: NB + 1 }, (_, i) => clockOf(i));
  const labelsH = Array.from({ length: 11 }, (_, i) => String(7 + i).padStart(2, '0') + '–' + String(8 + i).padStart(2, '0'));
  function makeCharts() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = css('--text-secondary');
    const grid = { color: css('--border-hairline') };
    tlChart = new Chart($('vcChartTimeline'), {
      type: 'line', plugins: [bandsPlugin],
      data: { labels: labels5, datasets: [
        { label: 'เข้า', data: [], borderColor: css('--vc-in'), backgroundColor: css('--vc-in'), cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, spanGaps: false },
        { label: 'ออก', data: [], borderColor: css('--vc-out'), backgroundColor: css('--vc-out'), cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 2, spanGaps: false } ] },
      options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + c.dataset.label + ' ' + fmt(c.parsed.y) } } },
        scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => { const narrow = tlChart && tlChart.width < 600; return (i === NB || i % (narrow ? 36 : 12) === 0) ? labels5[i] : ''; } } },
                  y: { beginAtZero: true, grid, ticks: { precision: 0 } } } },
    });
    hrChart = new Chart($('vcChartHourly'), {
      type: 'bar',
      data: { labels: labelsH, datasets: [
        { label: 'เข้า', data: [], backgroundColor: css('--vc-in'), borderRadius: 3 },
        { label: 'ออก', data: [], backgroundColor: css('--vc-out'), borderRadius: 3 } ] },
      options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + c.dataset.label + ' ' + fmt(c.parsed.y) } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid, ticks: { precision: 0 } } } },
    });
  }
  function renderCharts() {
    const n = Math.min(NB, Math.floor(state.pos));
    const cut = (arr) => arr.map((v, i) => (i < n ? Math.round(v) : null));
    tlChart.data.datasets[0].data = cut(view.in); tlChart.data.datasets[1].data = cut(view.out);
    const yMax = Math.max(1, ...view.in, ...view.out); tlChart.options.scales.y.max = Math.ceil(yMax * 1.12);
    tlChart.update('none');
    const hMax = Math.max(1, ...view.hIn, ...view.hOut);
    hrChart.data.datasets[0].data = view.hIn.map((_, h) => Math.round(part(view.in, h * 12, h * 12 + 12, state.pos)));
    hrChart.data.datasets[1].data = view.hOut.map((_, h) => Math.round(part(view.out, h * 12, h * 12 + 12, state.pos)));
    hrChart.options.scales.y.max = Math.ceil(hMax * 1.12);
    hrChart.update('none');
  }
  function renderHead() {
    const live = $('vcLive');
    const label = state.sel === 'avg-weekday' ? 'เฉลี่ยวันทำการ ' + view.nDays + ' วัน' : state.sel === 'avg-weekend' ? 'เฉลี่ยวันหยุด ' + view.nDays + ' วัน' : dayLabel(state.sel);
    $('vcSub').textContent = label + ' · ช่วงเวลา 07:00–18:00';
    const running = state.mode === 'replay' || (state.mode === 'live' && state.pos < NB);
    live.dataset.state = running ? 'run' : 'idle';
    $('vcLiveTag').textContent = state.mode === 'live' ? 'LIVE' : state.mode === 'replay' ? 'เล่นซ้ำ' : 'ทั้งวัน';
    $('vcClock').textContent = state.mode === 'full' ? '07:00–18:00' : clockOf(state.pos);
  }
  function renderAll() { renderHead(); renderNums(); renderCharts(); }

  // ── ปุ่มและตัวเลือก ─────────────────────────────────────────
  function press(containerId, attr, value) {
    for (const b of $(containerId).querySelectorAll('[aria-pressed]')) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
  }
  function syncControls() {
    press('vcDaysWeekday', 'sel', state.sel); press('vcDaysWeekend', 'sel', state.sel);
    press('vcMode', 'mode', state.mode); press('vcSpeed', 'speed', String(state.speed)); press('vcClasses', 'cls', state.cls);
    $('vcSpeed').hidden = state.mode !== 'replay';
  }
  function buildControls() {
    const chip = (sel, text, cls) => '<button class="vc-chip' + (cls ? ' ' + cls : '') + '" data-action="vcDay" data-sel="' + sel + '" aria-pressed="false">' + text + '</button>';
    for (const kind of ['weekday', 'weekend']) {
      $(kind === 'weekday' ? 'vcDaysWeekday' : 'vcDaysWeekend').innerHTML =
        DATA.days.filter((d) => d.kind === kind).map((d) => chip(d.id, dayLabel(d.id))).join('') + chip('avg-' + kind, 'เฉลี่ย', 'avg');
    }
    $('vcClasses').innerHTML = [{ key: 'all', label: 'ทั้งหมด' }, ...CLASSES].map((c) =>
      '<button class="vc-chip" data-action="vcClass" data-cls="' + c.key + '" aria-pressed="false">' + c.label + '</button>').join('');
  }
  function setMode(mode) {
    state.mode = mode;
    state.hold = 0;
    state.pos = mode === 'live' ? livePos() : mode === 'replay' ? 0 : NB;
    syncControls(); renderAll();
    if (galReady) gal.reload(1);
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    const a = el.dataset.action;
    if (a === 'vcDay') { state.sel = el.dataset.sel; build(); syncControls(); renderAll(); gal.syncDay(); }
    else if (a === 'vcClass') { state.cls = el.dataset.cls; build(); syncControls(); renderAll(); gal.reload(1); }
    else if (a.startsWith('gal') || a.startsWith('lb')) gal.act(a, el);
    else if (a === 'vcMode') setMode(el.dataset.mode);
    else if (a === 'vcSpeed') { state.speed = Number(el.dataset.speed); syncControls(); }
  });

  // ── จังหวะเดิน ──────────────────────────────────────────────
  function tick(ts) {
    const dt = lastTick ? Math.min(1, (ts - lastTick) / 1000) : 0; lastTick = ts;
    if (state.mode === 'live') state.pos = livePos();
    else if (state.mode === 'replay') {
      if (state.pos >= NB) { state.hold += dt; if (state.hold > 4) { state.pos = 0; state.hold = 0; } }
      else state.pos = Math.min(NB, state.pos + (state.speed / BIN_MIN) * dt);
    }
    if (state.mode !== 'full') renderAll();
    const bin = state.mode === 'full' ? -1 : Math.floor(state.pos);
    if (galReady && bin !== galBin) { galBin = bin; if (state.mode === 'live' && $('vcLb').hidden) gal.reload(1); }
  }
  setInterval(() => tick(performance.now()), 500);

  buildControls(); build(); makeCharts(); setMode(state.mode);

  // ── แกลเลอรีภาพเหตุการณ์ (ข้อมูลจริงจาก /api/events · ต้องล็อกอินเหมือนหน้าอื่นใน /others/) ──────────
  // ค้นตามวัน + ช่วงเวลา + ทิศทาง + ประเภท (ประเภทใช้ชิปเดียวกับกราฟ) · แบ่งหน้าฝั่งเซิร์ฟเวอร์ (limit/offset)
  const gal = (() => {
    const SIZE = 24;
    const g = { day: null, range: 'day', from: '07:00', to: '18:00', dir: 'all', page: 1, total: 0, rows: [], seq: 0, lb: -1 };
    const CLS_OF = { Car: 'car', Motorcycle: 'moto', Bicycle: 'moto', Truck: 'truck', Bus: 'bus' };
    const clsLabel = (k) => (CLASSES.find((c) => c.key === k) || {}).label || '';
    const hmOf = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const cls = (r) => CLS_OF[r.object_class] || '';
    const dirOf = (r) => (/OUT/i.test(r.rule_name || '') ? 'out' : 'in');
    const snap = (r, w) => '/snapshots/' + encodeURIComponent(r.snapshot_file) + '?w=' + w;
    const rangeOf = () => g.range === 'am' ? ['07:30', '09:30'] : g.range === 'pm' ? ['15:30', '17:30'] : g.range === 'custom' ? [g.from, g.to] : ['07:00', '18:00'];
    // โหมดสด/เล่นซ้ำ: แสดงเฉพาะภาพที่เกิดก่อนเวลาที่กราฟเดินมาถึง
    const capHm = () => (state.mode === 'full' ? null : clockOf(state.pos));
    const isoAt = (day, hm) => new Date(day + 'T' + hm + ':00+07:00').toISOString();
    const ids = () => {
      const keys = state.cls === 'all' ? CLASSES.map((c) => c.key) : [state.cls];
      const out = [];
      for (const k of keys) for (const d of ['in', 'out']) if (g.dir === 'all' || g.dir === d) out.push(DATA.catIds[k + '_' + d]);
      return out.filter(Boolean);
    };
    const groupDays = () => (state.sel === 'avg-weekend' ? DATA.days.filter((d) => d.kind === 'weekend') : DATA.days.filter((d) => d.kind === 'weekday'));
    const pages = () => Math.max(1, Math.ceil(g.total / SIZE));

    function syncDay() {
      g.day = DATA.days.some((d) => d.id === state.sel) ? state.sel : groupDays()[0].id;
      $('galDay').value = g.day;
      reload(1);
    }
    async function reload(page) {
      g.page = page; const my = ++g.seq;
      let [f, t] = rangeOf(); { const cap = capHm(); if (cap && cap < t) t = cap; }
      if (f >= t && capHm() && f < rangeOf()[1]) { g.total = 0; g.rows = []; render(); $('galState').textContent = 'ยังไม่ถึงช่วงเวลานี้'; return; }
      const state_ = $('galState'), grid = $('galGrid');
      state_.className = 'vc-gal-state'; state_.textContent = 'กำลังโหลด…';
      if (f >= t) { g.total = 0; g.rows = []; render(); state_.textContent = 'ช่วงเวลาไม่ถูกต้อง'; return; }
      const q = new URLSearchParams({ category_ids: ids().join(','), from: isoAt(g.day, f), to: isoAt(g.day, t), hasSnapshot: 'true', limit: String(SIZE), offset: String((page - 1) * SIZE) });
      try {
        const r = await fetch('/api/events?' + q.toString(), { credentials: 'same-origin' });
        if (my !== g.seq) return;
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'auth' : 'http');
        const rows = await r.json();
        if (my !== g.seq) return;
        g.total = Number(r.headers.get('X-Total-Count')) || rows.length; g.rows = rows;
        state_.textContent = '';
        render();
        if (!rows.length) state_.textContent = 'ไม่พบภาพในช่วงที่เลือก';
      } catch (e) {
        if (my !== g.seq) return;
        g.total = 0; g.rows = []; render();
        state_.className = 'vc-gal-state err';
        state_.textContent = e.message === 'auth' ? 'ไม่มีสิทธิ์ดูภาพ — เข้าสู่ระบบอีกครั้ง' : 'โหลดภาพไม่สำเร็จ';
      }
    }
    function card(r, i) {
      const d = dirOf(r), c = cls(r);
      return '<button class="vc-gal-card" data-action="galOpen" data-i="' + i + '"><span class="vc-gal-img"><img src="' + snap(r, 400) + '" loading="lazy" decoding="async" alt="" data-miss="1"></span>'
        + '<span class="vc-gal-meta"><span class="vc-gal-time">' + hmOf(r.event_time) + '</span><span class="vc-gal-tags"><span class="vc-tag ' + d + '">' + (d === 'in' ? 'เข้า' : 'ออก') + '</span>'
        + (c ? '<span class="vc-tag cls">' + clsLabel(c) + '</span>' : '') + '</span></span></button>';
    }
    function pager() {
      const n = pages(), cur = g.page, el = $('galPager');
      if (!g.total) { el.innerHTML = ''; return; }
      const btn = (label, p, o) => '<button class="vc-pg" data-action="galPage" data-p="' + p + '"' + (o && o.cur ? ' aria-current="page"' : '') + (o && o.dis ? ' disabled' : '') + (o && o.aria ? ' aria-label="' + o.aria + '"' : '') + '>' + label + '</button>';
      const set = new Set([1, n, cur - 1, cur, cur + 1]); if (cur <= 3) { set.add(2); set.add(3); } if (cur >= n - 2) { set.add(n - 1); set.add(n - 2); }
      const list = [...set].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
      let html = btn('&#8249;', cur - 1, { dis: cur <= 1, aria: 'หน้าก่อนหน้า' }), prev = 0;
      for (const p of list) { if (p - prev > 1) html += '<span class="vc-pg-gap">…</span>'; html += btn(p, p, { cur: p === cur }); prev = p; }
      html += btn('&#8250;', cur + 1, { dis: cur >= n, aria: 'หน้าถัดไป' });
      const a = (cur - 1) * SIZE + 1, b = Math.min(g.total, cur * SIZE);
      el.innerHTML = html + '<div class="vc-pg-sum">' + a.toLocaleString('th-TH') + '–' + b.toLocaleString('th-TH') + ' จาก ' + g.total.toLocaleString('th-TH') + ' ภาพ</div>';
    }
    function render() {
      $('galCount').textContent = g.total ? g.total.toLocaleString('th-TH') + ' ภาพ' : '';
      $('galGrid').innerHTML = g.rows.map(card).join('');
      pager();
    }
    function press2() {
      for (const b of $('galRange').children) b.setAttribute('aria-pressed', String(b.dataset.r === g.range));
      for (const b of $('galDir').children) b.setAttribute('aria-pressed', String(b.dataset.d === g.dir));
      $('galCustom').hidden = g.range !== 'custom';
    }
    // ดูภาพขยาย
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const VERB = { Crossed: 'ข้ามเส้น' };
    const SRC = { 'edge-meta': 'กล้อง (metadata)', mqtt: 'กล้อง (MQTT)', 'edge-http': 'กล้อง (HTTP)' };
    const HDG = ['ไปทางขวา', 'ขวาเฉียงขึ้น', 'ขึ้นบน', 'ซ้ายเฉียงขึ้น', 'ไปทางซ้าย', 'ซ้ายเฉียงลง', 'ลงล่าง', 'ขวาเฉียงลง'];
    const okN = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
    function overlay(raw) {
      const b = raw && raw._bbox, t = raw && raw._trail; let o = '';
      if (b && okN(b.x) && okN(b.y) && b.w > 0 && b.h > 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001) {
        const x1 = b.x * 100, y1 = b.y * 100, x2 = (b.x + b.w) * 100, y2 = (b.y + b.h) * 100, l = Math.min(x2 - x1, y2 - y1) * 0.28;
        for (const [cx, cy, sx, sy] of [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]])
          o += '<path class="bk" d="M' + (cx + sx * l) + ',' + cy + ' L' + cx + ',' + cy + ' L' + cx + ',' + (cy + sy * l) + '"/>';
      }
      const pts = Array.isArray(t) ? t.filter((p) => Array.isArray(p) && okN(p[0]) && okN(p[1])) : [];
      if (pts.length >= 2) o += '<polyline class="tr" points="' + pts.map((p) => (p[0] * 100).toFixed(2) + ',' + (p[1] * 100).toFixed(2)).join(' ') + '"/>';
      return o ? '<svg class="ovl" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + o + '</svg>' : '';
    }
    function spark(series) {
      const v = Array.isArray(series) ? series.filter(Number.isFinite) : [];
      if (v.length < 2) return '';
      const mn = Math.min(...v), mx = Math.max(...v), sp = (mx - mn) || 1, W = 100, H = 30;
      const pts = v.map((y, i) => [+(i * W / (v.length - 1)).toFixed(2), +(H - ((y - mn) / sp) * H).toFixed(2)]);
      const line = pts.map((p) => p.join(',')).join(' '), avg = v.reduce((a, c) => a + c, 0) / v.length, k = (x) => (x * 3.6).toFixed(0);
      return '<div><div class="vc-spark-cap"><span>ความเร็วตลอดช่วงที่เห็น</span><span>' + v.length + ' จุด</span></div>'
        + '<svg class="vc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><line class="b" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '"/>'
        + '<polygon class="f" points="0,' + H + ' ' + line + ' ' + W + ',' + H + '"/><polyline class="l" points="' + line + '"/></svg>'
        + '<div class="vc-sstats"><span>ต่ำสุด <b>' + k(mn) + '</b> กม./ชม.</span><span>เฉลี่ย <b>' + k(avg) + '</b> กม./ชม.</span><span>สูงสุด <b>' + k(mx) + '</b> กม./ชม.</span></div></div>';
    }
    function lbShow(i) {
      const r = g.rows[i]; if (!r) return; g.lb = i;
      const rj = r.raw_json || {}, full = rj._snapshot_full, src = r.snapshot_source || rj._snapshot_source || '';
      const crop = src === 'edge-meta' || src === 'mqtt';
      const pic = (f, w, ov) => '<span class="pic"><img src="/snapshots/' + encodeURIComponent(f) + '?w=' + w + '" alt="" data-miss="1">' + ov + '</span>';
      const box = (cap, inner, only) => '<div class="vc-lb-box' + (only ? ' only' : '') + '"><span class="vc-lb-cap">' + cap + '</span><div class="vc-lb-img">' + inner + '</div></div>';
      let imgs;
      if (full && r.snapshot_file && full !== r.snapshot_file) imgs = box('ภาพวัตถุ (crop)', pic(r.snapshot_file, 400, '')) + box('ภาพเต็ม', pic(full, 1280, overlay(rj)));
      else imgs = box(crop ? 'ภาพวัตถุ (crop)' : 'ภาพเต็ม', pic(full || r.snapshot_file, crop ? 400 : 1280, crop ? '' : overlay(rj)), true);
      const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
      const avg = num(rj._speed_avg), inst = num(rj.Data && rj.Data.Object && rj.Data.Object.Object && rj.Data.Object.Object.Behaviour && rj.Data.Object.Object.Behaviour.Speed), sp = avg != null ? avg : inst;
      const hd = Number.isFinite(rj._heading) ? rj._heading : null;
      const rows = [
        ['เวลา', new Date(r.event_time).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false })],
        ['กล้อง', esc(r.camera_id)],
        r.rule_name ? ['กฎที่ทำงาน', esc(r.rule_name)] : null,
        r.event_type ? ['ประเภท', esc(VERB[r.event_type.split('/').pop()] || r.event_type.split('/').pop())] : null,
        r.object_class ? ['ชนิดวัตถุ', esc(clsLabel(cls(r)) || r.object_class)] : null,
        r.likelihood ? ['ความมั่นใจ', (r.likelihood * 100).toFixed(1) + '%'] : null,
        sp != null ? [avg != null ? 'ความเร็วเฉลี่ย' : 'ความเร็ว', (sp * 3.6).toFixed(0) + ' กม./ชม. (' + sp.toFixed(1) + ' ม./วินาที)'] : null,
        Number.isFinite(rj._area) ? ['ขนาดวัตถุ', rj._area + ' ตร.ม.'] : null,
        hd != null ? ['ทิศทาง', '<span class="vc-hdg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(' + (-hd) + 'deg)"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13,6 19,12 13,18"/></svg>' + HDG[Math.round(((hd % 360) + 360) % 360 / 45) % 8] + '</span>'] : null,
        r.object_id ? ['รหัสวัตถุ', esc(r.object_id)] : null,
        src ? ['แหล่งภาพ', esc(SRC[src] || src)] : null,
      ].filter(Boolean);
      $('lbTitle').textContent = (r.rule_name || 'เหตุการณ์') + ' - ' + r.camera_id;
      $('lbBody').innerHTML = '<div class="vc-lb-grid">' + imgs + '</div><div class="vc-lb-data">'
        + rows.map((x) => '<div class="vc-lb-row"><span class="k">' + x[0] + '</span><span class="v">' + x[1] + '</span></div>').join('') + '</div>' + spark(rj._speed_series);
      $('vcLb').hidden = false;
      document.querySelector('#vcLb [data-action="lbPrev"]').disabled = i <= 0;
      document.querySelector('#vcLb [data-action="lbNext"]').disabled = i >= g.rows.length - 1;
      document.querySelector('#vcLb [data-action="lbClose"]').focus();
    }
    function lbClose() { $('vcLb').hidden = true; $('lbBody').textContent = ''; const c = document.querySelector('.vc-gal-card[data-i="' + g.lb + '"]'); if (c) c.focus(); g.lb = -1; }
    function act(a, el) {
      if (a === 'galRange') { g.range = el.dataset.r; press2(); if (g.range !== 'custom') reload(1); else { g.from = $('galFrom').value || '07:00'; g.to = $('galTo').value || '18:00'; reload(1); } }
      else if (a === 'galDir') { g.dir = el.dataset.d; press2(); reload(1); }
      else if (a === 'galPage') { const p = Number(el.dataset.p); if (p >= 1 && p <= pages()) { reload(p); $('vcGal').scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); } }
      else if (a === 'galOpen') lbShow(Number(el.dataset.i));
      else if (a === 'lbClose') lbClose();
      else if (a === 'lbPrev') lbShow(g.lb - 1);
      else if (a === 'lbNext') lbShow(g.lb + 1);
    }
    function init() {
      $('galDay').innerHTML = DATA.days.map((d) => '<option value="' + d.id + '">' + dayLabel(d.id) + (d.kind === 'weekend' ? ' · วันหยุด' : '') + '</option>').join('');
      $('galDay').addEventListener('change', (e) => { g.day = e.target.value; reload(1); });
      for (const id of ['galFrom', 'galTo']) $(id).addEventListener('change', () => { g.from = $('galFrom').value; g.to = $('galTo').value; if (g.range === 'custom') reload(1); });
      // ภาพที่โหลดไม่ได้ (ไฟล์ถูกลบตามรอบเก็บ) — แสดงช่องว่างแทนไอคอนแตก
      document.addEventListener('error', (e) => { const im = e.target; if (im && im.dataset && im.dataset.miss) { im.replaceWith(Object.assign(document.createElement('span'), { className: 'miss', textContent: 'ไม่มีภาพ' })); } }, true);
      document.addEventListener('keydown', (e) => {
        if ($('vcLb').hidden) return;
        if (e.key === 'Escape') lbClose(); else if (e.key === 'ArrowLeft') lbShow(g.lb - 1); else if (e.key === 'ArrowRight') lbShow(g.lb + 1);
      });
      $('vcLb').addEventListener('click', (e) => { if (e.target === $('vcLb')) lbClose(); });
      press2(); syncDay();
    }
    return { init, act, reload, syncDay };
  })();
  gal.init(); galReady = true;
})();
