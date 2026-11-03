// ============================================================
// Vigil Platform — Live Demo · กวดขันวินัยจราจร
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// CSP: script-src 'self' — ไม่มี inline handler เลย ใช้ data-action delegation
// ข้อมูลทั้งหมด mock (accumulative-data.js) แต่รูปทรงถอดจากของจริง
// ============================================================
'use strict';

const D = window.AC_DATA;
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const DOW = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

// ── สถานะหน้าจอ ─────────────────────────────────────────────
const S = {
  tab: 'volume',
  rangeDays: 28,
  volMode: 'cum',
  effWin: 14,
  gran: 'day',                                   // day | week | month
  effKind: 'helmet',                             // แท็บก่อน-หลัง วัดเรื่องอะไร
  dows: new Set([1, 2, 3, 4, 5, 6, 7]),          // วันในสัปดาห์ที่เลือกดู
  cams: new Set(D.REAL_CAMERAS.map(c => c.id)),
  types: new Set(D.REAL_VEHICLE_TYPES.map(t => t.raw)),
  groups: JSON.parse(JSON.stringify(D.DEFAULT_GROUPS)),
};
const selDows = () => [...S.dows].sort((a, b) => a - b);
const charts = {};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmt = (n) => Math.round(n).toLocaleString('th-TH');
const pct1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// กล้องที่ตรวจวินัยจราจรได้จริงเท่านั้น — กล้องที่ยังไม่เปิดฟังก์ชันตรวจจับ
// ต้องไม่ถูกนับเป็น "0% = วินัยดี" ไม่งั้นค่าเฉลี่ยเพี้ยนลงทั้งระบบ
const selectedCams   = () => D.REAL_CAMERAS.filter(c => S.cams.has(c.id));
const detectingCams  = () => selectedCams().filter(c => c.detect);
const noDetectCams   = () => D.REAL_CAMERAS.filter(c => !c.detect);

// น้ำหนักของกล้องที่เลือก เทียบกับทั้งหมด — ใช้สเกลปริมาณรถให้สมจริง
function camShare() {
  const all = D.REAL_CAMERAS.reduce((a, c) => a + c.moto, 0);
  const sel = selectedCams().reduce((a, c) => a + c.moto, 0);
  return all ? sel / all : 0;
}
// อัตราฝ่าฝืนเฉลี่ยถ่วงน้ำหนักด้วยปริมาณรถของกล้องที่เลือก
function weightedHelmetPct() {
  const cams = detectingCams();
  const tot = cams.reduce((a, c) => a + c.moto, 0);
  if (!tot) return null;
  return cams.reduce((a, c) => a + c.pct * c.moto, 0) / tot;
}
// สัดส่วนของกลุ่มประเภทรถที่ถูกเลือก (ใช้สเกลกราฟปริมาณ)
function typeShare(groupIds) {
  const all = D.REAL_VEHICLE_TYPES.reduce((a, t) => a + t.n, 0);
  const sel = D.REAL_VEHICLE_TYPES
    .filter(t => S.types.has(t.raw) && (!groupIds || groupIds.includes(groupOf(t.raw))))
    .reduce((a, t) => a + t.n, 0);
  return all ? sel / all : 0;
}
function groupOf(raw) {
  const g = S.groups.find(g => g.types.includes(raw));
  return g ? g.id : 'other';
}

// อัตราฝ่าฝืนรายชั่วโมง ปรับตามกล้องที่เลือก — คงรูปทรงรายชั่วโมงของจริงไว้
// แล้วเลื่อนทั้งเส้นตามระดับของกล้องที่เลือก (ของจริงเฉลี่ย 20.66%)
function helmetSeries(base) {
  const w = weightedHelmetPct();
  if (w == null) return base.map(() => null);
  const scale = w / 20.66;
  return base.map(v => Math.min(95, v * scale));
}

// ── แท็บ ────────────────────────────────────────────────────
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#acTabBar .tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  ['volume', 'violation', 'effect', 'deploy', 'report', 'settings'].forEach(t => {
    const el = document.getElementById('acPanel-' + t);
    if (el) el.hidden = (t !== tab);
  });
  document.getElementById('acScopeBar').hidden = (tab === 'settings' || tab === 'report');
  // ซ่อนตัวกรองที่แท็บนี้ไม่ได้ใช้ — ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้นแย่กว่าไม่มีปุ่ม
  document.querySelectorAll('#acScopeBar .scope-group[data-scope]').forEach(g => {
    g.hidden = !g.dataset.scope.split(' ').includes(tab);
  });
  render();
}

// ── กราฟ ────────────────────────────────────────────────────
function mkChart(id, cfg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el.getContext('2d'), cfg);
}
const gridColor = () => cssVar('--border-hairline') || '#e3e5e8';
const textColor = () => cssVar('--text-secondary') || '#6b7280';

function baseScales(yLabel, isPct) {
  return {
    x: { grid: { color: gridColor() }, ticks: { color: textColor(), font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
    y: {
      grid: { color: gridColor() }, beginAtZero: true,
      title: { display: !!yLabel, text: yLabel, color: textColor(), font: { size: 10 } },
      ticks: { color: textColor(), font: { size: 10 },
        callback: (v) => isPct ? v + '%' : (v >= 1000 ? (v / 1000) + 'k' : v) },
    },
  };
}
const legendCfg = { labels: { color: textColor(), font: { size: 11 }, boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded' } };

// ── แท็บ 1 · ปริมาณรถสะสม ──────────────────────────────────
// 3 ระดับ: รายวัน = แกน X เป็นชั่วโมง เส้นละวัน · รายสัปดาห์ = แกน X เป็น จ..อา
// เส้นละสัปดาห์ · รายเดือน = แกน X เป็นสัปดาห์ที่ เส้นละเดือน
const cum = (arr) => arr.reduce((a, v) => (a.push((a.length ? a[a.length - 1] : 0) + v), a), []);
// ── "ช่วงเวลา" คือหน้าต่างข้อมูลย้อนหลังที่เอามาเฉลี่ย ─────────────────
// ทำไมต้อง 7 / 28 / 90 ไม่ใช่ 7 / 30 / 90:
//   7  = 1 สัปดาห์เต็ม — ทุกวันในสัปดาห์ปรากฏวันละ 1 ครั้งพอดี
//   28 = 4 สัปดาห์เต็ม — ทุกวันปรากฏ 4 ครั้ง**เท่ากันหมด**
//   90 = 1 ไตรมาส (~13 สัปดาห์) สำหรับดูแนวโน้มยาว
// 🔴 เหตุผลที่ไม่ใช้ 30 วัน: 30 วันจะมีบางวันปรากฏ 5 ครั้ง บางวัน 4 ครั้ง
// พอเอามาเฉลี่ยรวม วันที่ปรากฏบ่อยกว่าจะถ่วงผลมากกว่าโดยไม่ตั้งใจ ซึ่งพังทั้งหน้านี้
// เพราะหน้านี้ทั้งหน้าเทียบกันรายวันในสัปดาห์ (จันทร์ vs อังคาร) — ตัวเลขจริงที่ผม
// query มาก็ใช้ 28 วันด้วยเหตุผลเดียวกัน
const RANGE_INFO = {
  7:  { weeks: 1,  label: '1 สัปดาห์',  note: 'ไวต่อการเปลี่ยนแปลง แต่แกว่งง่าย — วันเดียวที่ผิดปกติก็ดึงค่าเฉลี่ยได้ทั้งสัปดาห์' },
  28: { weeks: 4,  label: '4 สัปดาห์',  note: 'สมดุลที่สุด ทุกวันในสัปดาห์ปรากฏ 4 ครั้งเท่ากัน จึงเทียบวันต่อวันได้ตรง' },
  90: { weeks: 13, label: '~13 สัปดาห์', note: 'เห็นแนวโน้มยาว กลบความแกว่างรายวัน แต่ตอบสนองต่อการกวดขันครั้งล่าสุดช้า' },
};
const MONTH_LABELS = ['มิ.ย.', 'ก.ค.', 'ส.ค.'];
// ตัวคูณจำลองแนวโน้มข้ามสัปดาห์/เดือน (คงที่ ไม่สุ่ม เพื่อให้ภาพนิ่ง)
const MONTH_TREND = [1.06, 1.00, 0.92];
// จำนวนสัปดาห์ที่แสดงผันตามช่วงเวลาที่เลือก (90 วันแสดงแค่ 6 เส้นล่าสุด ไม่งั้นอ่านไม่ออก)
function weekLabels() {
  const n = Math.min(6, RANGE_INFO[S.rangeDays].weeks);
  return Array.from({ length: n }, (_, i) => `สัปดาห์ที่ ${i + 1}`);
}
// แนวโน้มค่อย ๆ ดีขึ้น — ยืดให้ครอบคลุมจำนวนสัปดาห์ที่แสดงจริง
function weekTrend() {
  const n = weekLabels().length;
  return Array.from({ length: n }, (_, i) => 1 - (i / Math.max(1, n - 1)) * 0.14);
}
// หน้าต่างสั้น = ตัวอย่างน้อย = เส้นแกว่งมากกว่า (สะท้อนความจริงทางสถิติ)
const noiseFactor = () => ({ 7: 2.2, 28: 1.0, 90: 0.45 }[S.rangeDays] ?? 1);

// ── ผลของ "ช่วงเวลา" ต่อค่าที่แสดง ───────────────────────────────────
// นี่คือส่วนที่ทำให้ปุ่มนี้มีความหมายจริง ไม่ใช่แค่เปลี่ยนจำนวนเส้น:
// หน้าต่างที่เลือก = ช่วงที่เอามาเฉลี่ย ⇒ เลือกสั้น = เห็นเฉพาะของใหม่
// เลือกยาว = เฉลี่ยรวมของเก่าที่แย่กว่าเข้ามาด้วย ค่าที่ได้จึงต่างกันจริง
//   7 วัน  = เฉพาะสัปดาห์ล่าสุด (หลังกวดขันรอบล่าสุด) → อัตราต่ำสุด
//   28 วัน = เฉลี่ย 4 สัปดาห์ → ค่ากลาง
//   90 วัน = รวมของเก่าเมื่อ 3 เดือนก่อนที่ยังไม่ได้กวดขัน → อัตราสูงสุด
const RANGE_RATE  = { 7: 0.88, 28: 1.00, 90: 1.11 };   // ตัวคูณอัตราฝ่าฝืน
const RANGE_VOL   = { 7: 1.05, 28: 1.00, 90: 0.94 };   // ตัวคูณปริมาณรถ (จราจรโตขึ้นเรื่อย ๆ)
const rangeRate = () => RANGE_RATE[S.rangeDays] ?? 1;
const rangeVol  = () => RANGE_VOL[S.rangeDays] ?? 1;

function renderVolume() {
  const share = camShare() * typeShare() * rangeVol();
  const isCum = S.volMode === 'cum';
  const dows = selDows();
  let cfgData, yLabel, insight;

  if (S.gran === 'day') {
    yLabel = isCum ? 'คันสะสม' : 'คัน/ชั่วโมง';
    cfgData = {
      labels: HOURS,
      datasets: dows.map(d => {
        // หน้าต่างสั้น = ตัวอย่างน้อย = เส้นไม่เรียบเท่า สะท้อนความไม่แน่นอนที่มีจริง
        const nf = noiseFactor();
        const raw = D.DOW_VOL[d].map((v, h) => v * share * (1 + Math.sin(h * 2.3 + d) * 0.035 * (nf - 1)));
        return { label: D.DOW_NAMES[d], data: isCum ? cum(raw) : raw,
          borderColor: D.DOW_COLORS[d], backgroundColor: D.DOW_COLORS[d] + '20',
          borderWidth: 2, fill: false, tension: .3, pointRadius: 0, pointHoverRadius: 4 };
      }),
    };
    const totals = dows.map(d => D.DOW_VOL[d].reduce((a, b) => a + b, 0) * share);
    const hi = dows[totals.indexOf(Math.max(...totals))], lo = dows[totals.indexOf(Math.min(...totals))];
    insight = `เลือกไว้ ${dows.length} วัน · รถมากสุด <b>${D.DOW_NAMES[hi]}</b> ` +
      `(${fmt(Math.max(...totals))} คัน/วัน) · น้อยสุด <b>${D.DOW_NAMES[lo]}</b> (${fmt(Math.min(...totals))} คัน/วัน) · ` +
      `แต่ละวันมีรูปทรงของตัวเอง — วันทำงานพุ่งเป็นพีคแคบตอนเข้า-เลิกงาน ` +
      `ส่วนเสาร์-อาทิตย์กระจายทั้งวันและลากยาวถึงดึก`;
  } else if (S.gran === 'week') {
    yLabel = isCum ? 'คันสะสม' : 'คัน/วัน';
    cfgData = {
      labels: dows.map(d => D.DOW_NAMES[d]),
      datasets: weekLabels().map((wk, i) => {
        const WT = weekTrend();
        const raw = dows.map(d => D.DOW_DAILY[d].vol * share * WT[i]);
        return { label: wk, data: isCum ? cum(raw) : raw,
          borderColor: ['#1971c2', '#2f9e44', '#f08c00', '#c2255c'][i],
          borderWidth: 2, fill: false, tension: .25, pointRadius: 3 };
      }),
    };
    insight = `แกนนอนคือวันในสัปดาห์ เส้นละสัปดาห์ — ใช้ดูว่า<b>สัปดาห์นี้ดีขึ้นกว่าสัปดาห์ก่อนไหม</b> ` +
      `เมื่อเทียบวันเดียวกัน (จันทร์เทียบจันทร์ อังคารเทียบอังคาร) ซึ่งเป็นวิธีเทียบที่ถูกต้อง ` +
      `เพราะแต่ละวันมีฐานไม่เท่ากันอยู่แล้ว`;
  } else {
    yLabel = isCum ? 'คันสะสม' : 'คัน/วัน';
    cfgData = {
      labels: weekLabels(),
      datasets: MONTH_LABELS.map((mn, i) => {
        const base = dows.reduce((a, d) => a + D.DOW_DAILY[d].vol, 0) / (dows.length || 1) * share;
        const raw = weekTrend().map(t => base * t * MONTH_TREND[i]);
        return { label: mn, data: isCum ? cum(raw) : raw,
          borderColor: ['#868e96', '#1971c2', '#e8590c'][i],
          borderWidth: 2, fill: false, tension: .25, pointRadius: 3 };
      }),
    };
    insight = `แกนนอนคือสัปดาห์ที่ เส้นละเดือน — ใช้ดูแนวโน้มระยะยาว ว่าการกวดขันสะสมแล้ว ` +
      `<b>ทำให้ภาพรวมดีขึ้นจริงหรือไม่</b> หรือแค่ดีเป็นช่วง ๆ แล้วกลับมาเท่าเดิม`;
  }

  mkChart('acChartVolume', {
    type: 'line', data: cfgData,
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendCfg,
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} คัน` } } },
      scales: baseScales(yLabel, false) },
  });
  document.getElementById('acVolInsight').innerHTML = insight;
  // หัวการ์ดต้องบอกให้ตรงว่ากราฟข้างล่างแบ่งเส้นด้วยอะไร ไม่งั้นอ่านผิดได้ทันที
  const T = { day: ['ปริมาณรถรายชั่วโมง — แยกเส้นตามวันในสัปดาห์',
                    'แกนนอน = ชั่วโมง · เส้นละวัน · ' + (isCum ? 'ค่าสะสมตั้งแต่ 00:00' : 'ค่าต่อชั่วโมง') + ' · เฉลี่ยต่อวัน'],
              week: ['ปริมาณรถรายสัปดาห์ — เทียบวันเดียวกันข้ามสัปดาห์',
                    'แกนนอน = วันในสัปดาห์ · เส้นละสัปดาห์ · ' + (isCum ? 'ค่าสะสม' : 'คันต่อวัน')],
              month: ['ปริมาณรถรายเดือน — เทียบสัปดาห์เดียวกันข้ามเดือน',
                    'แกนนอน = สัปดาห์ที่ · เส้นละเดือน · ' + (isCum ? 'ค่าสะสม' : 'คันต่อวันเฉลี่ย')] }[S.gran];
  document.getElementById('acVolTitle').textContent = T[0];
  document.getElementById('acVolSub').textContent = T[1];

  // แยกตามกลุ่มประเภทรถ
  const groups = S.groups.filter(g => g.types.some(t => S.types.has(t)));
  const gTot = groups.map(g => g.types.filter(t => S.types.has(t))
    .reduce((a, t) => a + (D.REAL_VEHICLE_TYPES.find(v => v.raw === t)?.n || 0), 0) / 7 * camShare());
  mkChart('acChartByType', {
    type: 'bar',
    data: { labels: groups.map(g => g.th),
      datasets: [{ label: 'คัน/วัน', data: gTot, backgroundColor: groups.map(g => g.color), borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.x)} คัน/วัน` } } },
      scales: { x: { grid: { color: gridColor() }, ticks: { color: textColor(), font: { size: 10 }, callback: (v) => v >= 1000 ? (v / 1000) + 'k' : v } },
        y: { grid: { display: false }, ticks: { color: textColor(), font: { size: 11 } } } } },
  });

  mkChart('acChartSplit', {
    type: 'bar',
    data: { labels: ['จันทร์-ศุกร์', 'เสาร์-อาทิตย์'],
      datasets: groups.map((g, i) => ({
        label: g.th, backgroundColor: g.color, borderRadius: 4,
        data: [gTot[i] * 1.06, gTot[i] * 0.82],
      })) },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: legendCfg, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} คัน/วัน` } } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { color: textColor(), font: { size: 11 } } },
        y: { stacked: true, grid: { color: gridColor() }, ticks: { color: textColor(), font: { size: 10 }, callback: (v) => v >= 1000 ? (v / 1000) + 'k' : v } } } },
  });
}

// ── แท็บ 2 · วินัยจราจร ─────────────────────────────────────
function renderViolation() {
  const cams = detectingCams();
  const w0 = weightedHelmetPct();
  const w = w0 == null ? null : w0 * rangeRate();
  const share = camShare() * rangeVol();
  const motoPerDay = (D.REAL_MOTO_WEEKDAY_28D.reduce((a, b) => a + b, 0) / D.WEEKDAY_DAYS) * share;
  const beltTot = D.REAL_BELT_BY_TYPE.reduce((a, t) => a + t.total, 0);
  const beltBad = D.REAL_BELT_BY_TYPE.reduce((a, t) => a + t.bad, 0);
  const beltPct = beltTot ? beltBad / beltTot * 100 : 0;

  document.getElementById('acHelmetDenom').innerHTML =
    `ตัวหาร = <b>รถ 2-3 ล้อเท่านั้น</b> (จักรยานยนต์ + สามล้อ) ไม่ใช่รถทุกคัน · ` +
    `นับจาก <code>no_helmet</code> ของจริง · ใช้กล้องที่ตรวจจับได้ ${cams.length} ตัว`;
  document.getElementById('acBeltDenom').innerHTML =
    `ตัวหาร = <b>รถ 4 ล้อขึ้นไปเท่านั้น</b> · จักรยานยนต์ไม่เคยติดธงนี้เลย · นับจาก <code>no_seatbelt</code>`;

  const kpis = [
    { label: 'ไม่สวมหมวกนิรภัย', num: w == null ? '—' : pct1(w) + '<span class="u">%</span>',
      sub: w == null ? 'กล้องที่เลือกยังตรวจจับไม่ได้'
        : `≈ ${fmt(motoPerDay * w / 100)} คัน/วัน จาก ${fmt(motoPerDay)} คัน · ` +
          `สูงกว่าค่าเฉลี่ยรวมทั้งระบบ (20.5%) เพราะกันกล้องที่ยังตรวจจับไม่ได้ออกแล้ว`,
      c: 'var(--status-bad)', delta: '+2.4% จากเดือนก่อน', dcls: 'up' },
    { label: 'ไม่คาดเข็มขัดนิรภัย', num: pct1(beltPct) + '<span class="u">%</span>',
      sub: `≈ ${fmt(beltBad / 7)} คัน/วัน จากรถ 4 ล้อ ${fmt(beltTot / 7)} คัน`,
      c: 'var(--warn)', delta: '-0.1% จากเดือนก่อน', dcls: 'down' },
    { label: 'ซ้อน 3 คนขึ้นไป', num: fmt(motoPerDay * 0.006) + '<span class="u"> คัน/วัน</span>',
      sub: 'นับจาก rider_count ≥ 3', c: 'var(--accent)', delta: '+0.3% จากเดือนก่อน', dcls: 'up' },
    // เดิมมี KPI "กล้องที่ตรวจจับไม่ได้" ตรงนี้ — ย้ายไปแท็บตั้งค่าแล้ว (2026-08-11)
    // เพราะเป็นปัญหาการติดตั้ง/ตั้งค่าของเราเอง ไม่ใช่ข้อมูลจราจรที่ตำรวจต้องเห็น
    // และการโชว์ให้คนนอกเห็นทำให้เข้าใจว่าระบบเราไม่สมบูรณ์ทั้งที่แก้ได้ที่หลังบ้าน
  ];
  document.getElementById('acViolKpis').innerHTML = kpis.map(k =>
    `<div class="kpi" style="--kc:${k.c}">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-num">${k.num}</div>
      <div class="kpi-sub">${esc(k.sub)}</div>
      ${k.delta ? `<div class="kpi-delta ${k.dcls}">${esc(k.delta)}</div>` : ''}
    </div>`).join('');

  const dows = selDows();
  const rScale = (weightedHelmetPct() ?? 20.66) / 20.66 * rangeRate();
  let hData, hInsight;

  if (S.gran === 'day') {
    hData = { labels: HOURS, datasets: dows.map(d => ({
      type: 'line', label: D.DOW_NAMES[d], data: D.DOW_PCT[d].map(v => Math.min(95, v * rScale)),
      borderColor: D.DOW_COLORS[d], borderWidth: 2.5, tension: .3, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y' })) };
    if (dows.length === 1) {
      hData.datasets.push({ type: 'bar', label: 'ปริมาณรถ', order: 9, yAxisID: 'y1',
        data: D.DOW_VOL[dows[0]].map(v => v * share), backgroundColor: 'rgba(134,142,150,.22)', borderRadius: 3 });
    }
    const dayAvg = dows.map(d => D.DOW_DAILY[d].pct * rScale);
    const worst = dows[dayAvg.indexOf(Math.max(...dayAvg))], best = dows[dayAvg.indexOf(Math.min(...dayAvg))];
    const gap = Math.max(...dayAvg) - Math.min(...dayAvg);
    hInsight = `แย่สุดคือ<b>วัน${D.DOW_NAMES[worst]}</b> (${pct1(Math.max(...dayAvg))}%) ` +
      `ดีสุดคือ<b>วัน${D.DOW_NAMES[best]}</b> (${pct1(Math.min(...dayAvg))}%) ห่างกัน <b>${pct1(gap)} จุด</b> · ` +
      `<b>ความต่างระหว่างวันนี่แหละคือสิ่งที่การรวมเป็น "จ-ศ" ก้อนเดียวกลบหายไป</b> — ` +
      `ถ้าวันไหนอัตราตกลงผิดจากเพื่อนบ้านชัด ๆ นั่นคือร่องรอยว่ามีการกวดขันวันนั้น ` +
      `และถ้าวันถัดมายังต่ำอยู่ แปลว่าคนยังจำได้`;
  } else if (S.gran === 'week') {
    hData = { labels: dows.map(d => D.DOW_NAMES[d]),
      datasets: weekLabels().map((wk, i) => ({
        type: 'line', label: wk, data: dows.map(d => D.DOW_DAILY[d].pct * rScale * weekTrend()[i]),
        borderColor: ['#1971c2', '#2f9e44', '#f08c00', '#c2255c'][i],
        borderWidth: 2.5, tension: .25, pointRadius: 3, yAxisID: 'y' })) };
    hInsight = `เทียบ<b>วันเดียวกันข้ามสัปดาห์</b> — เส้นที่ต่ำลงเรื่อย ๆ แปลว่าการกวดขันสะสมได้ผลจริง ` +
      `ถ้าเส้นทับกันหมดแปลว่ายังไม่มีอะไรเปลี่ยน · วิธีนี้ตัดผลของ "วันไหนของสัปดาห์" ออกไปแล้ว ` +
      `จึงเทียบกันได้ตรง ๆ ไม่เหมือนการเอาทั้งสัปดาห์มาเฉลี่ยรวม`;
  } else {
    hData = { labels: weekLabels(),
      datasets: MONTH_LABELS.map((mn, i) => {
        const base = dows.reduce((a, d) => a + D.DOW_DAILY[d].pct, 0) / (dows.length || 1) * rScale;
        return { type: 'line', label: mn, data: weekTrend().map(t => base * t * MONTH_TREND[i]),
          borderColor: ['#868e96', '#1971c2', '#e8590c'][i],
          borderWidth: 2.5, tension: .25, pointRadius: 3, yAxisID: 'y' };
      }) };
    hInsight = `ภาพระยะยาวข้ามเดือน — ใช้ตอบผู้บังคับบัญชาว่าทั้งไตรมาสดีขึ้นกี่จุด ` +
      `และ<b>ผลของการกวดขันอยู่ถาวรหรือแค่ชั่วคราว</b>`;
  }

  mkChart('acChartHelmet', {
    data: hData,
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendCfg,
        tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === 'y1'
          ? `${c.dataset.label}: ${fmt(c.parsed.y)} คัน` : `${c.dataset.label}: ${pct1(c.parsed.y)}%` } } },
      scales: {
        x: { grid: { color: gridColor() }, ticks: { color: textColor(), font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { position: 'left', beginAtZero: true, grid: { color: gridColor() },
          title: { display: true, text: 'อัตราฝ่าฝืน (%)', color: textColor(), font: { size: 10 } },
          ticks: { color: textColor(), font: { size: 10 }, callback: (v) => v + '%' } },
        y1: { display: S.gran === 'day' && dows.length === 1, position: 'right', beginAtZero: true, grid: { display: false },
          title: { display: true, text: 'ปริมาณรถ', color: textColor(), font: { size: 10 } },
          ticks: { color: textColor(), font: { size: 10 }, callback: (v) => v >= 1000 ? (v / 1000) + 'k' : v } },
      } },
  });

  document.getElementById('acHelmetInsight').innerHTML = w == null
    ? `กล้องที่เลือกไว้ยังไม่เปิดฟังก์ชันตรวจจับหมวกนิรภัย จึงไม่มีอัตราให้แสดง — <b>ไม่ได้แปลว่าไม่มีคนฝ่าฝืน</b>`
    : hInsight;
  const volWd = D.REAL_MOTO_WEEKDAY_28D.map(v => v / D.WEEKDAY_DAYS * share);

  mkChart('acChartBelt', {
    type: 'bar',
    data: { labels: D.REAL_BELT_BY_TYPE.map(t => t.th),
      datasets: [{ label: 'อัตราไม่คาดเข็มขัด (%)', data: D.REAL_BELT_BY_TYPE.map(t => t.pct),
        backgroundColor: '#f59f00', borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => {
          const t = D.REAL_BELT_BY_TYPE[c.dataIndex];
          return `${pct1(t.pct)}% (${fmt(t.bad)} จาก ${fmt(t.total)} คัน)`; } } } },
      scales: { x: { grid: { color: gridColor() }, beginAtZero: true, ticks: { color: textColor(), font: { size: 10 }, callback: (v) => v + '%' } },
        y: { grid: { display: false }, ticks: { color: textColor(), font: { size: 11 } } } } },
  });

  const riders = HOURS.map((_, h) => volWd[h] * (0.004 + (h >= 21 || h <= 4 ? 0.006 : 0.001)));
  mkChart('acChartRiders', {
    type: 'bar',
    data: { labels: HOURS, datasets: [{ label: 'คัน/ชั่วโมง', data: riders, backgroundColor: '#7048e8', borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.y)} คัน` } } },
      scales: baseScales('คัน/ชั่วโมง', false) },
  });

  const rows = selectedCams().slice().sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const maxPct = Math.max(...rows.map(r => r.pct || 0), 1);
  document.getElementById('acCamTable').innerHTML =
    `<thead><tr><th>จุดติดตั้ง</th><th>Site</th><th class="num">รถ 2-3 ล้อ (7 วัน)</th>
      <th class="num">อัตราไม่สวมหมวก</th><th class="bar-cell">เทียบกัน</th><th class="num">คาดว่าฝ่าฝืน</th></tr></thead>
     <tbody>${rows.map(c => `<tr>
        <td>${esc(c.th)}</td>
        <td class="dim">${esc(c.site)}</td>
        <td class="num">${fmt(c.moto)}</td>
        <td class="num ${c.detect ? (c.pct >= 30 ? 'bad' : c.pct >= 18 ? '' : 'ok') : ''}">${
          c.detect ? pct1(c.pct) + '%' : '<span class="tag-nodetect">ยังตรวจจับไม่ได้</span>'}</td>
        <td class="bar-cell">${c.detect
          ? `<div class="minibar"><i style="width:${(c.pct / maxPct * 100).toFixed(1)}%"></i></div>` : '<span class="dim">—</span>'}</td>
        <td class="num">${c.detect ? fmt(c.moto * c.pct / 100) : '<span class="dim">—</span>'}</td>
      </tr>`).join('')}</tbody>`;
}

// ── แท็บ 3 · ก่อน-หลังกวดขัน ────────────────────────────────
// แต่ละเรื่องมีฐาน/หน่วย/ตัวหารคนละแบบ — ห้ามเอามารวมเป็น "อัตราฝ่าฝืนโดยรวม"
// ตัวเดียว เพราะไม่สวมหมวกหารด้วยรถ 2-3 ล้อ ส่วนไม่คาดเข็มขัดหารด้วยรถ 4 ล้อ
// การบวกกันจะได้ตัวเลขที่ไม่มีความหมายทางสถิติ
const EFF_KINDS = {
  helmet: { th: 'ไม่สวมหมวกนิรภัย', denom: 'รถ 2-3 ล้อ (จักรยานยนต์ + สามล้อ)',
            col: 'no_helmet', unit: '%', drop: 9.4 },
  belt:   { th: 'ไม่คาดเข็มขัดนิรภัย', denom: 'รถ 4 ล้อขึ้นไป',
            col: 'no_seatbelt', unit: '%', drop: 0.09 },
  riders: { th: 'ซ้อน 3 คนขึ้นไป', denom: 'รถ 2-3 ล้อ',
            col: 'rider_count ≥ 3', unit: '%', drop: 0.28 },
};

function renderEffect() {
  const win = S.effWin;
  const kind = EFF_KINDS[S.effKind];
  const helmetW = weightedHelmetPct();
  // ── ทุกเรื่องต้องขยับตามกล้องที่เลือก ไม่ใช่แค่เรื่องหมวก ──────────────
  // ของจริงผมวัดอัตราเข็มขัด/ซ้อน 3 มาได้แค่ระดับ "ทั้งระบบ" (0.22% และ ~0.60%)
  // ยังไม่มีตัวเลขรายกล้อง จึงประมาณด้วยสมมติฐานว่า **จุดที่วินัยหมวกแย่
  // มักวินัยเรื่องอื่นแย่ตามไปด้วย** แล้วปรับตามสัดส่วนอัตราหมวกของกล้องที่เลือก
  // เทียบกับค่าเฉลี่ยทั้งระบบ — เขียนกำกับไว้บนหน้าจอด้วยว่าเป็นการประมาณ
  const camFactor = helmetW == null ? 1 : helmetW / 20.66;
  const w = S.effKind === 'helmet' ? (helmetW ?? 20.66)
          : (S.effKind === 'belt' ? 0.22 : 0.60) * camFactor;
  // วันที่เลือกมีผลจริง — วันหยุดอัตราสูงกว่าวันทำงาน ถ้าเลือกเฉพาะวันหยุด
  // ค่าฐานต้องขยับขึ้นตาม ไม่ใช่โชว์ชื่อวันเฉย ๆ แล้วคำนวณเหมือนเดิม
  const dows = selDows();
  const dowFactor = dows.reduce((a, d) => a + D.DOW_DAILY[d].pct, 0)
                  / (dows.length || 1) / 15.65;   // 15.65 = ค่าเฉลี่ยทั้ง 7 วันของจริง
  const wAdj = w * dowFactor;
  const drop = kind.drop * (wAdj / (w || 1));

  document.getElementById('acEffTitle').textContent =
    `วัดผลการกวดขัน — ${kind.th}`;
  document.getElementById('acEffSub').innerHTML =
    `วัดเรื่องเดียวต่อครั้ง <b>ไม่ใช่การฝ่าฝืนรวมทุกเรื่อง</b> เพราะแต่ละเรื่องมีตัวหารคนละชุด ` +
    `· ตัวหารของหน้านี้ = <b>${esc(kind.denom)}</b> · นับจาก <code>${esc(kind.col)}</code> ` +
    `· วันที่นับ: ${dows.map(d => D.DOW_NAMES[d]).join(', ')}` +
    (S.effKind === 'helmet' ? '' :
      ` · <b>หมายเหตุ:</b> อัตรารายกล้องของเรื่องนี้ยังไม่มีข้อมูลจริงแยกกล้อง ` +
      `จึงประมาณจากอัตราหมวกของกล้องที่เลือก`);

  // จำลอง: ก่อนกวดขันคงที่รอบ ๆ ค่าจริง · หลังตั้งด่านลดลงแล้วค่อย ๆ ไต่กลับ
  const before = [], after = [];
  const amp = wAdj * 0.05;
  for (let i = 0; i < win; i++) {
    const weekendBump = ((i % 7 === 5) || (i % 7 === 6)) ? wAdj * 0.16 : 0;
    before.push(wAdj + weekendBump + Math.sin(i * 1.7) * amp);
  }
  for (let i = 0; i < win; i++) {
    const weekendBump = ((i % 7 === 5) || (i % 7 === 6)) ? wAdj * 0.16 : 0;
    const recover = drop * (1 - Math.exp(-i / 9));   // ผลจางลงตามเวลา
    after.push(Math.max(0, wAdj - drop + recover + weekendBump + Math.sin(i * 1.7) * amp));
  }
  const avgB = before.reduce((a, b) => a + b, 0) / before.length;
  const avgA = after.reduce((a, b) => a + b, 0) / after.length;
  const delta = avgA - avgB;
  const rel = avgB ? (delta / avgB * 100) : 0;
  const good = delta < 0;
  // อัตราต่ำ ๆ อย่างเข็มขัด (0.22%) ทศนิยมตำแหน่งเดียวจะกลายเป็น 0.0 หมด
  const p = (v) => (wAdj < 2 ? v.toFixed(2) : pct1(v));

  document.getElementById('acEffVerdict').className = 'eff-verdict ' + (good ? 'good' : 'bad');
  document.getElementById('acEffVerdict').innerHTML =
    `<div><div class="ev-head">${esc(kind.th)} ${good ? 'ดีขึ้น' : 'แย่ลง'} ${p(Math.abs(delta))} จุด (${pct1(Math.abs(rel))}%)</div>
      <div class="ev-detail">ก่อนกวดขัน <b>${p(avgB)}%</b> → หลังกวดขัน <b>${p(avgA)}%</b>
        · เทียบหน้าต่าง ${win} วันก่อนและหลังวันที่เลือก · กล้องที่ตรวจจับได้ ${detectingCams().length} ตัว</div></div>`;

  const labels = [...Array(win).keys()].map(i => `-${win - i}`).concat([...Array(win).keys()].map(i => `+${i + 1}`));
  mkChart('acChartEffect', {
    type: 'line',
    data: { labels,
      datasets: [
        { label: 'ก่อนกวดขัน', data: before.concat(Array(win).fill(null)), borderColor: '#868e96',
          borderWidth: 2, tension: .25, pointRadius: 2 },
        { label: 'หลังกวดขัน', data: Array(win).fill(null).concat(after), borderColor: '#2f9e44',
          backgroundColor: 'rgba(47,158,68,.12)', borderWidth: 2.5, tension: .25, pointRadius: 2, fill: true },
        { label: 'ค่าเฉลี่ยก่อน', data: Array(win * 2).fill(avgB), borderColor: '#adb5bd',
          borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 },
      ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendCfg,
        tooltip: { callbacks: { label: (c) => c.parsed.y == null ? null : `${c.dataset.label}: ${pct1(c.parsed.y)}%` } } },
      scales: { x: { grid: { color: gridColor() }, title: { display: true, text: 'วันเทียบกับวันเริ่มกวดขัน', color: textColor(), font: { size: 10 } }, ticks: { color: textColor(), font: { size: 10 }, maxTicksLimit: 14 } },
        y: { grid: { color: gridColor() }, title: { display: true, text: 'อัตราไม่สวมหมวก (%)', color: textColor(), font: { size: 10 } }, ticks: { color: textColor(), font: { size: 10 }, callback: (v) => v + '%' } } } },
  });

  document.getElementById('acEffInsight').innerHTML =
    `วันแรกหลังตั้งด่านลดแรงที่สุด แล้ว<b>ค่อย ๆ ไต่กลับ</b>เมื่อเลิกตั้ง — ` +
    `ตัวเลขนี้ตอบได้ว่า “กวดขันได้ผล” จริงหรือไม่ และ<b>ผลอยู่ได้กี่วัน</b> ` +
    `ซึ่งใช้วางแผนความถี่ในการตั้งด่านครั้งต่อไปได้ · ` +
    `<b>ข้อควรระวัง:</b> ต้องเทียบวันทำงานกับวันทำงาน วันหยุดกับวันหยุด ไม่งั้นจะเข้าใจผิด ` +
    `เพราะวันหยุดอัตราฝ่าฝืนสูงกว่าอยู่แล้วประมาณ 3 จุด`;

  const effRows = detectingCams().slice(0, 8).map((c, i) => {
    const isTarget = i < 2;
    const d = isTarget ? -(7 + Math.random() * 5) : -(0.3 + Math.random() * 1.4);
    return { ...c, before: c.pct, after: c.pct + d, delta: d, isTarget };
  });
  document.getElementById('acEffTable').innerHTML =
    `<thead><tr><th>จุดติดตั้ง</th><th class="num">ก่อน</th><th class="num">หลัง</th>
      <th class="num">เปลี่ยนแปลง</th><th>ตั้งด่าน</th></tr></thead>
     <tbody>${effRows.map(r => `<tr>
        <td>${esc(r.th)}</td>
        <td class="num">${pct1(r.before)}%</td>
        <td class="num">${pct1(r.after)}%</td>
        <td class="num ${r.delta < -3 ? 'ok' : ''}">${r.delta < 0 ? '' : '+'}${pct1(r.delta)}</td>
        <td>${r.isTarget ? '<b>ตั้งด่าน</b>' : '<span class="dim">ไม่ได้ตั้ง</span>'}</td>
      </tr>`).join('')}</tbody>`;

  const weeks = ['สัปดาห์ 1', 'สัปดาห์ 2', 'สัปดาห์ 3', 'สัปดาห์ 4', 'สัปดาห์ 5', 'สัปดาห์ 6'];
  mkChart('acChartDecay', {
    type: 'line',
    data: { labels: weeks,
      datasets: [
        { label: 'อัตราไม่สวมหมวก', data: weeks.map((_, i) => w - drop * Math.exp(-i / 2.1)),
          borderColor: '#e03131', backgroundColor: 'rgba(224,49,49,.1)', borderWidth: 2.5, tension: .3, pointRadius: 3, fill: true },
        { label: 'ระดับก่อนกวดขัน', data: weeks.map(() => w), borderColor: '#adb5bd',
          borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 },
      ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: legendCfg, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${pct1(c.parsed.y)}%` } } },
      scales: baseScales('อัตราไม่สวมหมวก (%)', true) },
  });
}

// ── แท็บ 4 · จุดที่ควรตั้งด่าน ──────────────────────────────
function renderDeploy() {
  const w = weightedHelmetPct() ?? 20.66;
  const scale = w / 20.66;
  // แต่ละวันไม่ควรเท่ากันเป๊ะ — ของจริงวันศุกร์/เสาร์แย่กว่าเพื่อน และวันจันทร์ดีที่สุด
  // ใช้ตัวคูณคงที่ (ไม่สุ่ม) เพื่อให้ภาพนิ่งทุกครั้งที่ render ไม่กระพริบ
  const DAY_BIAS = [0.94, 0.97, 0.99, 1.02, 1.08, 1.03, 0.97];
  // รูปทรงรายชั่วโมงต่างกันตามกล้อง ไม่ใช่แค่ระดับ — วัดของจริงมาแล้วว่า
  // "ดึก ÷ กลางวัน" อยู่ระหว่าง 1.26 (C32 แบน) ถึง 3.28 (C17 ชัน)
  // ถ้าเลื่อนทั้งตารางเท่ากันหมด แท็บนี้จะตอบไม่ได้ว่า "จุดนี้ควรไปกี่โมง"
  const cams = detectingCams();
  const wTot = cams.reduce((a, c) => a + c.moto, 0);
  const nightF = wTot ? cams.reduce((a, c) => a + (c.night || 1.9) * c.moto, 0) / wTot : 1.9;
  const BASE_NIGHT = 1.87;   // ค่าเฉลี่ยรวมทุกกล้องของจริง (ดึก ÷ กลางวัน)
  const steep = nightF / BASE_NIGHT;
  const isNight = (h) => h >= 21 || h <= 5;
  const grid = [];
  for (let d = 0; d < 7; d++) {
    const base = d >= 5 ? D.REAL_HELMET_PCT_WEEKEND : D.REAL_HELMET_PCT_WEEKDAY;
    grid.push(base.map((v, h) => {
      // ยืด/บีบความต่างระหว่างกลางคืนกับกลางวันตามความชันของกล้องที่เลือก
      const shaped = isNight(h) ? v * steep : v / Math.max(1, steep) * (steep > 1 ? 1 : steep);
      return shaped * scale * DAY_BIAS[d];
    }));
  }
  const flat = grid.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const shade = (v) => {
    const t = hi > lo ? (v - lo) / (hi - lo) : 0;
    return `background:color-mix(in srgb, var(--status-bad) ${Math.round(8 + t * 72)}%, transparent)`;
  };

  let html = '<div class="hm-lbl"></div>' + HOURS.map((h, i) =>
    `<div class="hm-hdr">${i % 2 === 0 ? h.slice(0, 2) : ''}</div>`).join('');
  grid.forEach((row, d) => {
    html += `<div class="hm-lbl">${DOW[d].slice(0, 2)}</div>`;
    html += row.map((v, h) =>
      `<div class="hm-cell" style="${shade(v)}" title="${DOW[d]} ${HOURS[h]} — ${pct1(v)}%">${v >= hi * 0.92 ? pct1(v) : ''}</div>`).join('');
  });
  document.getElementById('acHeatmap').innerHTML = html;

  let worst = { v: -1 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > worst.v) worst = { v, d, h }; }));
  document.getElementById('acHeatInsight').innerHTML =
    `ช่องที่แย่ที่สุดคือ <b>${DOW[worst.d]} ${HOURS[worst.h]}</b> ที่ <b>${pct1(worst.v)}%</b> · ` +
    `จะเห็นแถบเข้มพาดตอนกลางคืนถึงเช้ามืดทุกวัน และ<b>เข้มขึ้นอีกในวันเสาร์-อาทิตย์</b> · ` +
    `ส่วนช่วงกลางวันของวันทำงานสีอ่อนที่สุด แม้จะเป็นเวลาที่รถเยอะที่สุด`;

  // จัดอันดับด้วย "จำนวนคันที่คาดว่าจะพบฝ่าฝืน" ไม่ใช่อัตราอย่างเดียว
  const share = camShare();
  const rows = [];
  detectingCams().forEach(c => {
    [7, 8, 17, 18, 22, 23, 0, 1].forEach(h => {
      const isNight = h >= 21 || h <= 4;
      const volWd = D.REAL_MOTO_WEEKDAY_28D[h] / D.WEEKDAY_DAYS * (c.moto / D.REAL_CAMERAS.reduce((a, x) => a + x.moto, 0));
      const rate = D.REAL_HELMET_PCT_WEEKDAY[h] * (c.pct / 20.66);
      rows.push({ cam: c.th, hour: HOURS[h], vol: volWd, rate, expect: volWd * rate / 100, isNight });
    });
  });
  rows.sort((a, b) => b.expect - a.expect);
  document.getElementById('acDeployTable').innerHTML =
    `<thead><tr><th>จุดติดตั้ง</th><th>ช่วงเวลา</th><th class="num">รถ/ชั่วโมง</th>
      <th class="num">อัตราฝ่าฝืน</th><th class="num">คาดว่าพบ (คัน/ชม.)</th></tr></thead>
     <tbody>${rows.slice(0, 12).map(r => `<tr>
        <td>${esc(r.cam)}</td>
        <td>${esc(r.hour)}${r.isNight ? ' <span class="dim">(กลางคืน)</span>' : ''}</td>
        <td class="num">${fmt(r.vol)}</td>
        <td class="num ${r.rate >= 30 ? 'bad' : ''}">${pct1(r.rate)}%</td>
        <td class="num"><b>${fmt(r.expect)}</b></td>
      </tr>`).join('')}</tbody>`;
}

// ── แท็บ 5 · ตั้งค่า ────────────────────────────────────────
function renderSettings() {
  document.getElementById('acGroupEditor').innerHTML = S.groups.map(g => `
    <div class="grp-row" style="--gc:${g.color}">
      <div class="grp-name">${esc(g.th)}</div>
      <div class="grp-types">
        ${g.types.map(t => {
          const v = D.REAL_VEHICLE_TYPES.find(x => x.raw === t);
          return `<span class="type-chip">${esc(v ? v.th : t)}
            <span class="cnt">${v ? fmt(v.n) : 0}</span></span>`;
        }).join('') || '<span class="save-note">ยังไม่มีประเภทในกลุ่มนี้</span>'}
      </div>
    </div>`).join('');

  const rules = [
    { on: true,  t: 'ไม่สวมหมวกนิรภัย', d: 'มีคอลัมน์ no_helmet ของจริงแล้ว · ตัวหารคือรถ 2-3 ล้อ' },
    { on: true,  t: 'ไม่คาดเข็มขัดนิรภัย', d: 'มีคอลัมน์ no_seatbelt ของจริงแล้ว · ตัวหารคือรถ 4 ล้อขึ้นไป' },
    { on: true,  t: 'ซ้อน 3 คนขึ้นไป', d: 'มีคอลัมน์ rider_count ของจริงแล้ว' },
    { on: false, t: 'ป้ายทะเบียนไม่ตรงกับตัวรถ', d: 'มีข้อมูลอยู่แล้ว (10,890 รายการ/วัน) แต่ยังไม่ได้ทำหน้าสรุป' },
    { on: false, t: 'ขับย้อนศร', d: 'ต้องใช้ lpr_direction เทียบกับทิศทางที่ตั้งไว้ของกล้อง — ยังไม่ได้ทำ' },
    { on: false, t: 'ความเร็วเกินกำหนด', d: 'ยังไม่มีข้อมูลความเร็วในระบบ · ต้องใช้กล้องที่รองรับหรือคำนวณจากสองจุด' },
  ];
  document.getElementById('acRuleList').innerHTML = rules.map(r => `
    <label class="opt">
      <input type="checkbox" ${r.on ? 'checked' : ''} ${r.on ? '' : 'disabled'}>
      <span><span>${esc(r.t)}</span><span class="od">${esc(r.d)}</span></span>
    </label>`).join('');

  document.getElementById('acNoDetectTable').innerHTML =
    `<thead><tr><th>จุดติดตั้ง</th><th>Site</th><th class="num">รถ 2-3 ล้อ (7 วัน)</th><th class="num">ฝ่าฝืนที่ตรวจพบ</th><th>สถานะ</th></tr></thead>
     <tbody>${noDetectCams().map(c => `<tr>
        <td>${esc(c.th)}</td><td class="dim">${esc(c.site)}</td>
        <td class="num">${fmt(c.moto)}</td>
        <td class="num">0</td>
        <td><span class="tag-nodetect">ยังไม่เปิดตรวจจับ</span></td>
      </tr>`).join('')}</tbody>`;
}

// ── modal เลือกกล้อง / ประเภท ───────────────────────────────
let pendCams = null, pendTypes = null;

function openCams() {
  pendCams = new Set(S.cams);
  drawCamList();
  document.getElementById('acCamModal').hidden = false;
}
function drawCamList() {
  const q = (document.getElementById('acCamSearch').value || '').trim().toLowerCase();
  const list = D.REAL_CAMERAS.filter(c => !q || c.th.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  document.getElementById('acCamList').innerHTML = list.map(c => `
    <label class="cam-opt">
      <input type="checkbox" data-action="acCamToggle" data-id="${esc(c.id)}" ${pendCams.has(c.id) ? 'checked' : ''}>
      <span class="cname">${esc(c.th)}<br><span class="cmeta">${esc(c.id)} · ${esc(c.site)} · ${fmt(c.moto)} คัน</span></span>
      <span class="cpct">${c.detect ? pct1(c.pct) + '%' : '<span class="tag-nodetect">ยังตรวจจับไม่ได้</span>'}</span>
    </label>`).join('') || '<div class="save-note">ไม่พบกล้องที่ตรงกับคำค้น</div>';
  document.getElementById('acCamCount').textContent = `เลือกไว้ ${pendCams.size} จาก ${D.REAL_CAMERAS.length} กล้อง`;
}
function openTypes() {
  pendTypes = new Set(S.types);
  document.getElementById('acTypeList').innerHTML = D.REAL_VEHICLE_TYPES.map(t => `
    <label class="cam-opt">
      <input type="checkbox" data-action="acTypeToggle" data-raw="${esc(t.raw)}" ${pendTypes.has(t.raw) ? 'checked' : ''}>
      <span class="cname">${esc(t.th)}<br><span class="cmeta">${esc(t.raw)}</span></span>
      <span class="cpct">${fmt(t.n)}</span>
    </label>`).join('');
  document.getElementById('acTypeCount').textContent = `เลือกไว้ ${pendTypes.size} จาก ${D.REAL_VEHICLE_TYPES.length} ประเภท`;
  document.getElementById('acTypeModal').hidden = false;
}

function syncScopeLabels() {
  const n = S.cams.size, all = D.REAL_CAMERAS.length;
  const camLabel = n === all ? `ทุกกล้อง (${all})` : n === 1
    ? (D.REAL_CAMERAS.find(c => S.cams.has(c.id))?.th || '1 กล้อง')
    : `เลือกไว้ ${n} กล้อง`;
  document.getElementById('acCamBtn').textContent = camLabel;
  const t = S.types.size, allT = D.REAL_VEHICLE_TYPES.length;
  document.getElementById('acTypeBtn').textContent = t === allT ? 'ทุกประเภท' : `เลือกไว้ ${t} ประเภท`;

  document.getElementById('acDowChips').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(d =>
    `<button type="button" class="dow-chip" data-action="acDow" data-dow="${d}"
      style="--dc:${D.DOW_COLORS[d]}" aria-pressed="${S.dows.has(d)}">${D.DOW_NAMES[d].slice(0, 2)}</button>`).join('');
  // ระดับสัปดาห์/เดือนใช้วันเป็นแกน/ตัวเฉลี่ย จึงยังเลือกวันได้อยู่ ไม่ซ่อน
  const dows = selDows();
  const gran = { day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' }[S.gran];
  const sum = document.getElementById('acScopeSummary');
  if (sum) {
    sum.hidden = (S.tab === 'settings' || S.tab === 'report');
    // สรุปต้องพูดถึงเฉพาะตัวกรองที่แท็บนี้ใช้จริง — ถ้าซ่อนปุ่มไปแล้วแต่ยังสรุปว่า
    // "ระดับ: รายวัน" ผู้ใช้จะนึกว่ามันมีผลอยู่
    const useGran  = ['volume', 'violation'].includes(S.tab);
    const useRange = ['volume', 'violation', 'deploy'].includes(S.tab);
    const parts = [`วัน : <b>${dows.length ? dows.map(d => D.DOW_NAMES[d]).join(', ') : 'ยังไม่ได้เลือกวัน'}</b>`];
    if (useGran)  parts.push(`ระดับ : <b>${gran}</b>`);
    if (useRange) parts.push(`ช่วง : <b>${S.rangeDays} วันล่าสุด</b> (${RANGE_INFO[S.rangeDays].label}` +
      ` — แต่ละวันในสัปดาห์ถูกนับ ${RANGE_INFO[S.rangeDays].weeks} ครั้ง)`);
    if (S.tab === 'effect') parts.push(`หน้าต่างเทียบ : <b>${S.effWin} วัน</b> ก่อน/หลัง`);
    sum.innerHTML =
      `ชุดข้อมูลที่เลือก : <b>${esc(camLabel)}</b><br>` +
      parts.join(' &nbsp;·&nbsp; ') +
      (useRange ? `<br><span class="ss-note">${esc(RANGE_INFO[S.rangeDays].note)}</span>` : '');
  }
}

// ── render ตามแท็บ ──────────────────────────────────────────
function render() {
  syncScopeLabels();
  if (S.tab === 'volume')    renderVolume();
  if (S.tab === 'violation') renderViolation();
  if (S.tab === 'effect')    renderEffect();
  if (S.tab === 'deploy')    renderDeploy();
  if (S.tab === 'settings')  renderSettings();
}

// ── delegation เดียว (CSP: ห้าม inline handler) ─────────────
const ACTIONS = {
  acTab:       (el) => setTab(el.dataset.tab),
  acRange:     (el) => { S.rangeDays = Number(el.dataset.range);
    el.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b === el)); render(); },
  acVolMode:   (el) => { S.volMode = el.dataset.mode;
    el.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b === el)); render(); },
  // ต้องลงทะเบียนทุกปุ่มที่มี data-action ไม่งั้นกดแล้วเงียบ ไม่มี error ให้เห็นด้วย
  // (พลาดตรงนี้มาแล้วกับ acEffKind — ปุ่มขึ้นครบแต่กดไม่ติด)
  acEffKind:   (el) => { S.effKind = el.dataset.kind;
    el.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b === el)); render(); },
  acEffWin:    (el) => {
    const custom = document.getElementById('acEffCustom');
    if (!custom) {   // HTML เก่าค้างใน cache — อย่าปล่อยให้ NaN หลุดไปถึงกราฟ
      S.effWin = Number(el.dataset.win) || 14;
      el.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b === el));
      return render();
    }
    if (el.dataset.win === 'custom') {
      custom.hidden = false;
      S.effWin = Math.max(1, Math.min(60, Number(document.getElementById('acEffCustomN').value) || 21));
    } else {
      custom.hidden = true;
      S.effWin = Number(el.dataset.win);
    }
    el.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b === el));
    render();
  },
  acGran:      (el) => { S.gran = el.dataset.gran;
    el.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b === el)); render(); },
  // ต้องเหลืออย่างน้อย 1 วันเสมอ — ไม่งั้นกราฟว่างเปล่าโดยไม่มีคำอธิบายว่าทำไม
  acDow:       (el) => { const d = Number(el.dataset.dow);
    if (S.dows.has(d)) { if (S.dows.size === 1) return; S.dows.delete(d); } else S.dows.add(d);
    render(); },
  acDowAll:    () => { S.dows = new Set([1, 2, 3, 4, 5, 6, 7]); render(); },
  acOpenCams:  () => openCams(),
  acCloseCams: () => { document.getElementById('acCamModal').hidden = true; },
  acCamAll:    () => { pendCams = new Set(D.REAL_CAMERAS.map(c => c.id)); drawCamList(); },
  acCamNone:   () => { pendCams = new Set(); drawCamList(); },
  acCamToggle: (el) => { el.checked ? pendCams.add(el.dataset.id) : pendCams.delete(el.dataset.id);
    document.getElementById('acCamCount').textContent = `เลือกไว้ ${pendCams.size} จาก ${D.REAL_CAMERAS.length} กล้อง`; },
  acApplyCams: () => { if (pendCams.size) S.cams = new Set(pendCams);
    document.getElementById('acCamModal').hidden = true; render(); },
  acOpenTypes: () => openTypes(),
  acCloseTypes:() => { document.getElementById('acTypeModal').hidden = true; },
  acTypeToggle:(el) => { el.checked ? pendTypes.add(el.dataset.raw) : pendTypes.delete(el.dataset.raw);
    document.getElementById('acTypeCount').textContent = `เลือกไว้ ${pendTypes.size} จาก ${D.REAL_VEHICLE_TYPES.length} ประเภท`; },
  acApplyTypes:() => { if (pendTypes.size) S.types = new Set(pendTypes);
    document.getElementById('acTypeModal').hidden = true; render(); },
  acAddGroup:  () => { document.getElementById('acSaveNote').textContent = 'MOCKUP — ยังเพิ่มกลุ่มจริงไม่ได้'; },
  acSaveGroups:() => { document.getElementById('acSaveNote').textContent = 'MOCKUP — ยังไม่บันทึกลงฐานข้อมูล'; },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'acCamSearch') drawCamList();
  if (e.target.id === 'acEffCustomN') {
    S.effWin = Math.max(1, Math.min(60, Number(e.target.value) || 1));
    render();
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
  if (e.target.id === 'acEffDate') render();
});

setTab('volume');
