// ============================================================
// Vigil Platform — DEMO: Emission Rate (RMUTR-V)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ข้อมูลจริงจาก /api/stats/vehicle-classes (event ดิบ แยก rule × object_class)
// จงใจไม่อ่านผ่านหมวด Event เพราะหมวดจักรยานยนต์รวม Bicycle ไว้แล้วตามผล RCA
// ⇒ ถ้าอ่านผ่านหมวด ตัวเลือก "ไม่นับ Bicycle เป็นจักรยานยนต์" จะทำงานไม่ได้จริง
//
// ⚠️ ทิศทางกลับด้าน: rule บนกล้อง Bosch ตัวนี้ตั้งชื่อสวนกับความจริง —
//    'Vehicle Count (OUT)' คือรถ **ขาเข้า** · 'Vehicle Count (IN)' คือรถ **ขาออก**
//    (เจ้าของยืนยัน 2026-08-29 · หมวด Event ของไซต์ก็ผูกกลับด้านแบบเดียวกัน)
'use strict';

const API = '';
const SITE_ID = 20;                     // RMUTR-V
const RULE_IN  = 'Vehicle Count (OUT)'; // ← ขาเข้าจริง
const RULE_OUT = 'Vehicle Count (IN)';  // ← ขาออกจริง
const LINE_MOVED = '2026-08-28';        // ย้ายเส้นตรวจจับเพื่อ RCA Bosch — ห้ามเฉลี่ยคร่อมเงียบ ๆ

// EF ตามไฟล์ Traffic_CO2_Emission_Calculator.xlsx (คอลัมน์ B)
// สีต้องตรงกับ _ES_VT_COLOR ในหน้า Statistics (dashboard/page-stats.js) —
// ผู้ใช้ข้ามหน้าไปมา ถ้าจักรยานยนต์คนละสีจะอ่านผิดทันที
const CLASSES = [
  { key: 'bicycle', th: 'รถจักรยาน', en: 'Bicycle', ef: 0,      color: '#9aa5b1', src: ['Bicycle'] },
  { key: 'moto',    th: 'รถจักรยานยนต์', en: 'Motorcycle', ef: 43.31,  color: '#1f77b4', src: ['Motorcycle'] },
  { key: 'car',     th: 'รถยนต์นั่ง / กระบะ / VAN / SUV', en: 'Car', ef: 281.67, color: '#2ca02c', src: ['Car'] },
  { key: 'bus',     th: 'รถโดยสารประจำทาง', en: 'Bus', ef: 707.3,  color: '#d62728', src: ['Bus'] },
  { key: 'truck',   th: 'รถบรรทุกขนส่งสินค้า', en: 'Truck', ef: 548.44, color: '#6d4c41', src: ['Truck'] },
];
const UNKNOWN = { key: 'unknown', th: 'ไม่ระบุประเภท', en: 'unclassified', ef: null, color: '#c8cfd4' };

// ตัวคูณของค่าเทียบเท่า — ต้องพิมพ์กำกับบนหน้าจอทุกตัว ไม่ใช่ตัวเลขลอย
const EQ = {
  treeKgYear: 9.5,      // ต้นไม้ยืนต้น 1 ต้นดูดซับ CO2 ~9.5 kg/ปี (ค่าที่ อบก. ใช้สื่อสารทั่วไป)
  petrolGperL: 2310,    // เบนซิน 1 ลิตร ≈ 2,310 gCO2 (ค่าอ้างอิงสากล)
};

const PERIODS = [
  { key: 'yday',  name: 'เมื่อวาน' },
  { key: 'today', name: 'วันนี้ (ถึงตอนนี้)' },
  { key: 'w7',    name: 'เฉลี่ย/วัน · 7 วัน' },
  { key: 'w30',   name: 'เฉลี่ย/วัน · 30 วัน' },
];

let period = 'yday';
let raw = null;           // ผลจาก endpoint
let charts = [];
const $ = (s) => document.querySelector(s);
const fmt = (n, d = 0) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

function windowFor(p) {
  const d0 = (off) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
  if (p === 'today') return { from: d0(0), to: new Date(), days: Math.max((Date.now() - d0(0)) / 86400e3, 1 / 24) };
  if (p === 'yday')  return { from: d0(-1), to: d0(0), days: 1 };
  if (p === 'w7')    return { from: d0(-7), to: d0(0), days: 7 };
  return { from: d0(-30), to: d0(0), days: 30 };
}

async function load() {
  const w = windowFor(period);
  const u = `${API}/api/stats/vehicle-classes?from=${w.from.toISOString()}&to=${w.to.toISOString()}`
    + `&site_id=${SITE_ID}&trunc=hour&rules=${encodeURIComponent(RULE_IN + ',' + RULE_OUT)}`;
  const r = await fetch(u, { credentials: 'include' });
  if (!r.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (HTTP ${r.status})`);
  raw = await r.json();
  raw._win = w;
  render();
}

// รวม event ดิบ → ตารางต่อประเภท ตามตัวแปรที่ผู้ใช้ตั้ง
function compute() {
  const dist = Math.max(0.001, Number($('#inpDist').value) || 0);
  const evPct = Math.min(100, Math.max(0, Number($('#inpEv').value) || 0));
  const foldBike = $('#chkBike').checked;
  const days = raw._win.days;

  const byClass = new Map();
  const put = (key, dir, n, series) => {
    if (!byClass.has(key)) byClass.set(key, { key, in: 0, out: 0, hours: new Map(), cams: new Set() });
    const c = byClass.get(key);
    c[dir] += n;
    for (const s of series || []) {
      const h = new Date(s.t).getHours();
      c.hours.set(h, (c.hours.get(h) || 0) + s.n);
    }
  };
  const bikeRaw = { in: 0, out: 0 };   // จำนวน Bicycle ตามที่กล้องแจ้ง เก็บไว้เสมอ
  for (const row of raw.rows || []) {
    const dir = row.rule_name === RULE_IN ? 'in' : row.rule_name === RULE_OUT ? 'out' : null;
    if (!dir) continue;
    const oc = row.object_class || '';
    if (oc === 'Bicycle') bikeRaw[dir] += row.n;
    let cls = CLASSES.find((c) => c.src.includes(oc));
    // Bicycle: กล้อง 5100i แยกจาก Motorcycle ไม่ได้ (RCA — lk 0.90-0.99 บนรถที่วิ่ง
    // >20 km/h) ค่าตั้งต้นจึงนับรวมเป็นจักรยานยนต์ · ปิดได้เพื่อดูตัวเลข "ตามที่กล้องแจ้ง"
    if (foldBike && oc === 'Bicycle') cls = CLASSES.find((c) => c.key === 'moto');
    put(cls ? cls.key : UNKNOWN.key, dir, row.n, row.series);
    (row.cameras_seen || []).forEach((x) => byClass.get(cls ? cls.key : UNKNOWN.key).cams.add(x));
  }

  const rows = [];
  for (const def of CLASSES.concat([UNKNOWN])) {
    const c = byClass.get(def.key);
    if (!c && def.key === UNKNOWN.key) continue;          // ไม่มี event ไร้คลาส = ไม่ต้องโชว์แถว
    const inN = (c?.in || 0) / days, outN = (c?.out || 0) / days;
    const tripsRaw = (inN + outN) / 2;                     // สูตรตารางต้นฉบับ: (In+Out)/2
    // EV: หักเฉพาะรถยนต์และจักรยานยนต์ (บัส/บรรทุกไฟฟ้ายังแทบไม่มีในพื้นที่)
    const evApplies = def.key === 'car' || def.key === 'moto';
    const trips = evApplies ? tripsRaw * (1 - evPct / 100) : tripsRaw;
    const g = def.ef == null ? null : trips * def.ef * dist;
    rows.push({ def, in: inN, out: outN, tripsRaw, trips, g,
      hours: c?.hours || new Map(), cams: [...(c?.cams || [])] });
  }
  const totalG = rows.reduce((a, r) => a + (r.g || 0), 0);
  return { rows, totalG, dist, evPct, foldBike, days,
    bikeRaw: { in: bikeRaw.in / days, out: bikeRaw.out / days } };
}

function render() {
  charts.forEach((c) => c.destroy()); charts = [];
  const m = compute();
  const w = raw._win;
  const dfmt = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  $('#rangeNote').textContent = `ช่วงข้อมูล ${dfmt(w.from)} – ${dfmt(new Date(w.to.getTime() - 1))}`
    + (m.days > 1 ? ` · เฉลี่ยเป็นรายวันจาก ${m.days} วัน` : '');

  // ── KPI ──
  const kg = m.totalG / 1000, t = kg / 1000;
  const trips = m.rows.reduce((a, r) => a + r.trips, 0);
  $('#kpis').innerHTML = [
    { c: '#1d7a52', l: 'ปล่อย CO₂ ต่อวัน', v: fmt(kg, 1), u: 'kgCO₂', n: `${fmt(m.totalG, 0)} gCO₂ · ${t.toFixed(4)} tCO₂` },
    { c: '#2563eb', l: 'ประมาณการต่อปี', v: fmt(kg * 365 / 1000, 2), u: 'tCO₂/ปี', n: 'คูณเชิงเส้น ×365 จากค่าต่อวัน' },
    { c: '#c2410c', l: 'รถที่นับได้ (เฉลี่ย/วัน)', v: fmt(trips, 0), u: 'คัน', n: `จาก (ขาเข้า+ขาออก)÷2${m.evPct ? ` · หัก EV ${m.evPct}%` : ''}` },
    { c: '#d68a1f', l: 'ปล่อยเฉลี่ยต่อคัน', v: trips ? fmt(m.totalG / trips, 1) : '—', u: 'gCO₂/คัน', n: `ระยะทางในพื้นที่ ${m.dist} km/trip` },
  ].map((k) => `<div class="kpi" style="--kc:${k.c}">
      <div class="kpi-lbl">${k.l}</div>
      <div class="kpi-val">${k.v}<small>${k.u}</small></div>
      <div class="kpi-note">${k.n}</div></div>`).join('');

  // ── ตาราง ──
  $('#tblBody').innerHTML = m.rows.map((r, i) => {
    const share = m.totalG ? (r.g || 0) / m.totalG * 100 : 0;
    const flag = r.def.key === 'bus' ? '<span class="flag">RCA: อาจปนกระบะ</span>'
      : r.def.key === 'bicycle' && !m.foldBike ? '<span class="flag">RCA: ส่วนใหญ่คือ จยย.</span>'
      : r.def.key === 'unknown' ? '<span class="flag">ไม่คิดคำนวณ</span>' : '';
    // แถวจักรยานตอนเปิด "นับรวมเป็นจักรยานยนต์": ห้ามโชว์ 0 เฉย ๆ เพราะจะอ่านว่า
    // "ไม่มีจักรยานเลย" ทั้งที่กล้องแจ้งเข้ามาจริงและถูกย้ายไปอีกแถว
    if (r.def.key === 'bicycle' && m.foldBike) {
      const n = m.bikeRaw.in + m.bikeRaw.out;
      return `<tr><td><div class="vt"><span class="dot" style="background:${r.def.color}"></span>
        <span><span class="vt-name">${r.def.th}</span> <span class="vt-en">(${r.def.en})</span></span></div></td>
        <td colspan="7" style="text-align:left;color:var(--dim);font-size:12px">
          กล้องแจ้งเข้ามา ${fmt(n, m.days > 1 ? 1 : 0)} ครั้ง/วัน (เข้า ${fmt(m.bikeRaw.in, 0)} · ออก ${fmt(m.bikeRaw.out, 0)})
          — ถูกนับรวมอยู่ในแถวจักรยานยนต์แล้วตามผล RCA</td><td></td></tr>`;
    }
    return `<tr>
      <td><div class="vt"><span class="dot" style="background:${r.def.color}"></span>
        <span><span class="vt-name">${r.def.th}</span> <span class="vt-en">(${r.def.en})</span> ${flag}</span></div></td>
      <td>${r.def.ef == null ? '—' : fmt(r.def.ef, 2)}</td>
      <td>${fmt(r.in, m.days > 1 ? 1 : 0)}</td>
      <td>${fmt(r.out, m.days > 1 ? 1 : 0)}</td>
      <td>${fmt(r.trips, m.days > 1 ? 1 : 0)}</td>
      <td>${r.def.ef == null ? '—' : m.dist}</td>
      <td><b>${r.g == null ? '—' : fmt(r.g, 0)}</b></td>
      <td><div class="bar"><i style="width:${share.toFixed(1)}%;background:${r.def.color}"></i></div>
          <span class="hint">${share.toFixed(1)}%</span></td>
      <td><button class="info-btn" data-row="${i}">รายละเอียด</button></td>
    </tr>`;
  }).join('') + `
    <tr class="tot"><td>รวมปริมาณการปล่อยเฉลี่ย</td><td colspan="5"></td>
      <td>${fmt(m.totalG, 0)} g</td><td colspan="2">${fmt(m.totalG / 1000, 2)} kg · ${(m.totalG / 1e6).toFixed(5)} t</td></tr>`;
  $('#tblBody').querySelectorAll('[data-row]').forEach((b) =>
    b.addEventListener('click', () => openModal(m, Number(b.dataset.row))));

  // ── กราฟรายชั่วโมง (กอง stack เป็น kgCO2) ──
  const hours = [...Array(24).keys()];
  const ds = m.rows.filter((r) => r.def.ef).map((r) => {
    const perTrip = r.def.ef * m.dist / 1000;             // kgCO2 ต่อคัน
    const evAdj = (r.def.key === 'car' || r.def.key === 'moto') ? (1 - m.evPct / 100) : 1;
    return { label: r.def.th, backgroundColor: r.def.color, borderRadius: 3,
      // event รายชั่วโมงคือ "การผ่านกล้อง" ทั้งสองทิศ ⇒ หาร 2 ให้เป็นจำนวนคันเท่ากับสูตรตาราง
      data: hours.map((h) => (r.hours.get(h) || 0) / 2 / m.days * perTrip * evAdj) };
  });
  charts.push(new Chart($('#hrChart'), { type: 'bar',
    data: { labels: hours.map((h) => String(h).padStart(2, '0') + ':00'), datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (x) => ` ${x.dataset.label}: ${fmt(x.parsed.y, 2)} kg` } } },
      scales: { x: { stacked: true, grid: { display: false }, border: { display: false },
                     ticks: { maxTicksLimit: 12, color: '#61736c', font: { size: 10 } } },
                y: { stacked: true, beginAtZero: true, border: { display: false },
                     grid: { color: '#e8efec' },
                     ticks: { color: '#61736c', font: { size: 10 }, callback: (v) => fmt(v, 1) } } } } }));

  // ── โดนัทสัดส่วน ──
  const pieRows = m.rows.filter((r) => (r.g || 0) > 0);
  charts.push(new Chart($('#pieChart'), { type: 'doughnut',
    data: { labels: pieRows.map((r) => r.def.th),
      datasets: [{ data: pieRows.map((r) => r.g), backgroundColor: pieRows.map((r) => r.def.color),
        borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '58%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 }, color: '#17241f' } },
        tooltip: { callbacks: { label: (x) => ` ${x.label}: ${fmt(x.parsed / 1000, 2)} kg (${(x.parsed / m.totalG * 100).toFixed(1)}%)` } } } } }));

  // ── เทียบเท่า ──
  const kgYear = kg * 365;
  const carEf = CLASSES.find((c) => c.key === 'car').ef;
  $('#eqBox').innerHTML = [
    { v: fmt(kgYear / EQ.treeKgYear, 0), l: 'ต้นไม้ยืนต้นที่ต้องปลูกเพื่อดูดซับเท่ายอดทั้งปี',
      fx: `ตัวคูณ: 1 ต้น ดูดซับ ${EQ.treeKgYear} kgCO₂/ปี` },
    { v: fmt(m.totalG / carEf, 0), l: 'ระยะทางรถยนต์เทียบเท่า (km ต่อวัน)',
      fx: `ตัวคูณ: EF รถยนต์ ${carEf} gCO₂/km จากตารางเดียวกัน` },
    { v: fmt(m.totalG / EQ.petrolGperL, 0), l: 'น้ำมันเบนซินเทียบเท่า (ลิตรต่อวัน)',
      fx: `ตัวคูณ: 1 ลิตร ≈ ${fmt(EQ.petrolGperL)} gCO₂` },
    { v: fmt(kg * 30, 0), l: 'ประมาณการต่อเดือน (kgCO₂)', fx: 'ตัวคูณ: ×30 วัน' },
  ].map((e) => `<div class="eq-item"><div class="eq-val">${e.v}</div>
      <div class="eq-lbl">${e.l}</div><div class="eq-fx">${e.fx}</div></div>`).join('');

  // ── สมมติฐาน ──
  const crossesMove = w.from < new Date(LINE_MOVED + 'T00:00:00+07:00') && w.to > new Date(LINE_MOVED + 'T00:00:00+07:00');
  $('#assumeBox').innerHTML = `
    ${crossesMove ? `<div class="warn-box"><b>ช่วงนี้คร่อมวันที่ย้ายเส้นตรวจจับ (${LINE_MOVED})</b> —
      เส้นถูกย้ายเพื่อการวัดซ้ำของ RCA Bosch 5100i จำนวนนับก่อน/หลังจึงไม่ควรนำมาเฉลี่ยรวมกันเพื่ออ้างอิงงานวิจัย</div>` : ''}
    <div><b>สูตร</b> — ตามไฟล์ Traffic_CO2_Emission_Calculator.xlsx ของโครงการ:
      รถสุทธิ = (ขาเข้า + ขาออก) ÷ 2 · การปล่อย = รถสุทธิ × EF × ระยะทางเฉลี่ย</div>
    <div><b>ระยะทางเฉลี่ย ${m.dist} km/trip</b> — ค่านี้ต้องหมายถึงระยะทาง <b>ตลอดเส้นทางที่รถอยู่ในพื้นที่
      (เข้า→ออก)</b> ถ้าเป็นระยะทางเที่ยวเดียว ตัวเลขทั้งหน้าจะต่ำกว่าจริงประมาณ 2 เท่า — จุดนี้ยังไม่ได้ยืนยัน</div>
    <div><b>สัดส่วน EV ${m.evPct}%</b> — กล้องแยกรถไฟฟ้าไม่ได้ ค่านี้เป็นการกรอกด้วยมือ
      และหักเฉพาะรถยนต์กับจักรยานยนต์ (ตารางต้นฉบับมีหัวคอลัมน์ "ไม่รวม EV" แต่สูตรเดิมไม่ได้หักออก)</div>
    <div><b>ค่า EF</b> — ใช้ตามคอลัมน์ B ของไฟล์ต้นฉบับทุกค่า ยังไม่มีการอ้างอิงแหล่งที่มากำกับในไฟล์
      (แถวจักรยานยนต์มีหมายเหตุ "ตัวเลขสมมุติ") — ก่อนนำไปใช้ในเอกสารวิจัยควรระบุที่มา เช่น อบก. หรือ IPCC</div>
    <div><b>ข้อจำกัดจากการจำแนกของกล้อง</b> (จาก RCA Bosch 5100i ที่ไซต์นี้):
      <ul>
        <li>Bicycle: กล้องแยกจากจักรยานยนต์ไม่ได้ (likelihood 0.90–0.99 บนรถที่วิ่งเร็วกว่า 20 km/h)
          — หน้านี้จึงตั้งต้นนับรวมเป็นจักรยานยนต์ ${m.foldBike ? '<b>(กำลังเปิดอยู่)</b>' : '<b>(ปิดอยู่ — ตัวเลขจะต่ำกว่าจริง)</b>'}</li>
        <li>Bus: ค่ามัธยฐานพื้นที่วัตถุ 13.45 m² เทียบกับรถบัสจริง 24.6–33.2 m² แปลว่าส่วนใหญ่คือกระบะ/สองแถวที่ถูกจัดเป็น Bus
          — EF ของบัสสูงเป็นอันดับสอง ตัวเลขแถวนี้จึงสูงเกินจริง</li>
        <li>Car: กล้องส่งคลาสเดียวคือ Car ซึ่งตรงกับกลุ่ม "รถยนต์นั่ง/กระบะ/VAN/SUV" ของตารางพอดี ไม่มีการสูญเสียจากการ map</li>
      </ul></div>
    <div><b>ขอบเขต</b> — เฉพาะไซต์ RMUTR-V กล้อง Bosch 5100i และเฉพาะรถที่ผ่านเส้นตรวจจับเท่านั้น
      ไม่รวมรถที่จอดค้างในพื้นที่ รถที่กล้องนับไม่ติด และไม่รวมการปล่อยจากแหล่งอื่น (อาคาร ไฟฟ้า)</div>`;
}

function openModal(m, i) {
  const r = m.rows[i];
  const evAdj = (r.def.key === 'car' || r.def.key === 'moto') && m.evPct;
  const lim = { bus: 'จากผล RCA: ค่ามัธยฐานพื้นที่วัตถุที่กล้องจัดเป็น Bus คือ 13.45 m² ขณะที่รถบัสจริง 24.6–33.2 m² — ส่วนใหญ่จึงน่าจะเป็นกระบะหลังคาสูงหรือสองแถว ทำให้ค่าปล่อยของแถวนี้สูงเกินจริง',
    bicycle: 'กล้อง 5100i แยกจักรยานจากจักรยานยนต์ไม่ได้ (likelihood สูงถึง 0.99 บนรถที่วิ่ง >20 km/h) แถวนี้จึงไม่ควรตีความว่าเป็นจักรยานจริงทั้งหมด',
    moto: 'ค่าตั้งต้นของหน้านี้รวม Bicycle ที่กล้องรายงานเข้ามาด้วย ตามผล RCA — ปิดได้ที่ตัวแปรด้านบน',
    unknown: 'event ที่กล้องไม่ได้ระบุ object_class — ไม่นำมาคำนวณ CO₂ เพราะไม่รู้ประเภท แต่แสดงไว้ให้เห็นว่ามีอยู่จริง',
    car: 'กล้องส่งคลาสเดียวคือ Car ตรงกับกลุ่มของตารางต้นฉบับ (รถยนต์นั่ง/กระบะ/VAN/SUV) พอดี',
    truck: 'ปริมาณน้อยมากในไซต์นี้ ค่าที่ได้จึงไวต่อการนับผิดเพียงไม่กี่คัน' }[r.def.key] || '';
  $('#modal').innerHTML = `
    <button class="modal-x" id="mx">✕</button>
    <h3><span class="dot" style="background:${r.def.color};width:12px;height:12px"></span>
      ${r.def.th} <span class="vt-en">(${r.def.en})</span></h3>
    <div class="m-sec">
      <div class="m-grid">
        <div class="m-cell"><div class="l">Fleet Emission Factor</div>
          <div class="v">${r.def.ef == null ? '—' : fmt(r.def.ef, 2)} <span class="vt-en">gCO₂/km</span></div></div>
        <div class="m-cell"><div class="l">ปล่อยต่อคันในพื้นที่</div>
          <div class="v">${r.def.ef == null ? '—' : fmt(r.def.ef * m.dist, 1)} <span class="vt-en">gCO₂</span></div></div>
        <div class="m-cell"><div class="l">ขาเข้า / ขาออก (เฉลี่ยต่อวัน)</div>
          <div class="v">${fmt(r.in, 0)} / ${fmt(r.out, 0)}</div></div>
        <div class="m-cell"><div class="l">รถสุทธิที่ใช้คำนวณ</div>
          <div class="v">${fmt(r.trips, 1)} <span class="vt-en">คัน/วัน</span></div></div>
      </div>
    </div>
    <div class="m-sec">
      <div class="m-sec-t">สูตรที่แทนค่าจริงแล้ว</div>
      <div class="formula">
        รถสุทธิ = (ขาเข้า <em>${fmt(r.in, 1)}</em> + ขาออก <em>${fmt(r.out, 1)}</em>) ÷ 2 = <em>${fmt(r.tripsRaw, 1)}</em> คัน<br>
        ${evAdj ? `หัก EV ${m.evPct}% → <em>${fmt(r.trips, 1)}</em> คัน<br>` : ''}
        ${r.def.ef == null ? 'ไม่คิดคำนวณ (ไม่ทราบประเภท)'
          : `CO₂ = <em>${fmt(r.trips, 1)}</em> × <em>${fmt(r.def.ef, 2)}</em> gCO₂/km × <em>${m.dist}</em> km
             = <em>${fmt(r.g, 0)}</em> gCO₂/วัน (${fmt(r.g / 1000, 2)} kg)`}
      </div>
    </div>
    ${lim ? `<div class="m-sec"><div class="m-sec-t">ข้อจำกัดของแถวนี้</div>
      <div class="warn-box">${lim}</div></div>` : ''}
    <div class="m-sec">
      <div class="m-sec-t">ที่มาของข้อมูล</div>
      <div class="note-list">
        <div>นับจาก event จริงของกล้อง ${r.cams.length ? r.cams.join(', ') : '—'}
          · rule <b>${RULE_IN}</b> = ขาเข้า และ <b>${RULE_OUT}</b> = ขาออก (ชื่อ rule บนกล้องกลับทิศกับความจริง)</div>
        <div>ช่วงข้อมูล ${new Date(raw.from).toLocaleString('th-TH')} ถึง ${new Date(raw.to).toLocaleString('th-TH')}
          ${m.days > 1 ? `· หารเฉลี่ยด้วย ${m.days} วัน` : ''}</div>
      </div>
    </div>`;
  $('#mask').classList.add('on');
  $('#mx').onclick = () => $('#mask').classList.remove('on');
}

function csv() {
  const m = compute();
  const head = ['ประเภท', 'EF_gCO2_km', 'ขาเข้า', 'ขาออก', 'รถสุทธิ', 'ระยะทาง_km', 'gCO2_ต่อวัน'];
  const lines = [head.join(',')].concat(m.rows.map((r) => [
    `"${r.def.th}"`, r.def.ef ?? '', r.in.toFixed(1), r.out.toFixed(1), r.trips.toFixed(1),
    r.def.ef == null ? '' : m.dist, r.g == null ? '' : r.g.toFixed(1)].join(',')));
  lines.push(['"รวม"', '', '', '', '', '', m.totalG.toFixed(1)].join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `emission-rmutr-v-${period}.csv`;
  a.click();
}

// ── boot ──
$('#periodBar').innerHTML = PERIODS.map((p) =>
  `<button data-p="${p.key}" class="${p.key === period ? 'on' : ''}">${p.name}</button>`).join('');
$('#periodBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  period = b.dataset.p;
  $('#periodBar').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  load().catch((err) => alert(err.message));
});
['#inpDist', '#inpEv'].forEach((s) => $(s).addEventListener('input', () => raw && render()));
$('#chkBike').addEventListener('change', () => raw && render());
$('#btnCsv').addEventListener('click', csv);
$('#mask').addEventListener('click', (e) => { if (e.target.id === 'mask') $('#mask').classList.remove('on'); });

load().catch((err) => {
  document.getElementById('kpis').innerHTML =
    `<div class="card" style="grid-column:1/-1;color:#b3261e">${err.message} — ต้องเข้าสู่ระบบก่อนใช้งานหน้านี้</div>`;
});
