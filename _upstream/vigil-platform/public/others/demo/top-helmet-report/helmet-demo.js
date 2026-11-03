/* ============================================================
   Vigil Platform — Live Demo · อันดับไม่สวมหมวกนิรภัย
   CSP: script-src 'self' — ไม่มี inline handler เลย ใช้ data-action delegation
   ข้อมูลทั้งหมดมาจาก helmet-data.js (mock) — ไม่มี fetch ออกไปไหน
   ============================================================ */
'use strict';

const CAMS    = window.HELMET_CAMS;
const HOURLY  = window.HELMET_HOURLY;
const REPEAT  = window.HELMET_REPEAT;
const PERIODS = window.HELMET_PERIODS;
const ROWS    = window.HELMET_ROWS;
const DETAIL  = window.HELMET_DETAIL;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf  = (n) => Number(n).toLocaleString('th-TH');
const $   = (id) => document.getElementById(id);

// อ่านสีจาก token จริงของ design system — ห้าม hardcode hex ในกราฟ
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

let period   = 'day';
const expanded = new Set();   // อันดับที่กดขยาย "+N ป้าย" ไว้

// ── อันดับป้ายทะเบียน ──────────────────────────────────────
function plateBtn(plate) {
  const [num, prov] = plate.split(/\s+(?=[^\s]+$)/).length === 2
    ? [plate, 'ภูเก็ต'] : [plate, 'ภูเก็ต'];
  return `<button type="button" class="plate" data-action="hmOpen" data-plate="${esc(plate)}">
    <strong>${esc(num)}</strong><small>${esc(prov)}</small></button>`;
}

function renderRanks() {
  const scale = PERIODS[period].scale;
  const maxN  = Number($('hmTopN').value);
  const rows  = ROWS.filter((r) => r.rank <= maxN);
  const max   = Math.round(ROWS[0].count * scale);
  $('hmRange').textContent = PERIODS[period].label;

  $('hmList').innerHTML = rows.map((row) => {
    const count = Math.round(row.count * scale);
    const open  = expanded.has(row.rank);
    const shown = open ? row.plates : row.plates.slice(0, 2);
    const more  = row.plates.length > 2
      ? `<button type="button" class="plate-more" data-action="hmMore" data-rank="${row.rank}">${
          open ? 'ย่อ' : '+' + (row.plates.length - 2) + ' ป้าย'}</button>`
      : '';
    return `<div class="rank-row" data-top="${row.rank}">
      <div class="rank-cell-medal"><span class="rank-medal">${row.rank}</span></div>
      <div class="plate-wrap">${shown.map(plateBtn).join('')}${more}</div>
      <div class="bar-wrap"><div class="bar-bg"><div class="bar" style="width:${
        Math.max(6, count / max * 100).toFixed(1)}%"></div></div></div>
      <div class="rank-total"><strong>${nf(count)}</strong><span>ครั้ง</span></div>
    </div>`;
  }).join('');
}

// ── KPI ────────────────────────────────────────────────────
function renderKpi() {
  const scale = PERIODS[period].scale;
  const total = CAMS.reduce((s, c) => s + c.count, 0);
  const moto  = CAMS.reduce((s, c) => s + c.moto, 0);
  const worst = CAMS.slice().sort((a, b) => b.rate - a.rate)[0];
  const repeat = REPEAT.filter((r) => r.band !== '1 ครั้ง').reduce((s, r) => s + r.plates, 0);

  $('hmKpiTotal').textContent  = nf(Math.round(total * scale / 19.4));
  $('hmKpiRate').textContent   = (total / moto * 100).toFixed(1) + '%';
  $('hmKpiRepeat').textContent = nf(repeat);
  $('hmKpiWorst').textContent  = worst.name;
  $('hmKpiWorstFoot').textContent = `${worst.id} · ${worst.rate}% ของมอเตอร์ไซค์ที่ผ่าน`;
}

// ── กราฟ ───────────────────────────────────────────────────
const charts = {};
function makeChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), cfg);
}

// แถบแนวนอนแบบรายการ ไม่ใช้ Chart.js — ตำรวจอ่านชื่อสถานที่ ไม่ใช่รหัสกล้อง
// และเห็น "จำนวนครั้ง" กับ "อัตรา %" พร้อมกันในบรรทัดเดียว ไม่ต้องสลับกราฟไปมา
function renderCamChart() {
  const sorted = CAMS.slice().sort((a, b) => b.count - a.count);
  const max = sorted[0].count;

  $('hmCamList').innerHTML = sorted.map((c, i) => {
    const pct = Math.max(4, c.count / max * 100).toFixed(1);
    // ฐานน้อย = เปอร์เซ็นต์แกว่งง่าย · ต้องเตือนไม่งั้นจะไปตั้งด่านผิดจุดเพราะเห็นแต่ %
    const thin = c.moto < 1000
      ? `<span class="cam-thin" title="มอเตอร์ไซค์ผ่านน้อย อัตราจึงแกว่งง่าย">ฐานน้อย ${nf(c.moto)} คัน/วัน</span>`
      : '';
    return `<div class="cam-row${i < 3 ? ' hot' : ''}">
      <div class="cam-rank">${i + 1}</div>
      <div class="cam-name"><b>${esc(c.name)}</b><small>${esc(c.id)}${thin}</small></div>
      <div class="cam-bar-wrap"><div class="cam-bar-bg"><div class="cam-bar" style="width:${pct}%"></div></div></div>
      <div class="cam-val"><b>${nf(c.count)}</b><small>ครั้ง</small></div>
      <div class="cam-rate"><b>${c.rate}%</b><small>ของมอเตอร์ไซค์</small></div>
    </div>`;
  }).join('');

  const top = sorted[0];
  $('hmCamNote').innerHTML = `<b>${esc(top.name)}</b> ตรวจพบมากที่สุด ${nf(top.count)} ครั้ง ·
    คอลัมน์ขวาบอกว่าคิดเป็นกี่ % ของมอเตอร์ไซค์ที่ผ่านจุดนั้น
    — จุดที่รถผ่านน้อยจะขึ้นป้าย <b>“ฐานน้อย”</b> เพราะเปอร์เซ็นต์แกว่งง่าย เชื่อไม่ได้เท่าจุดที่รถเยอะ`;
}

function renderHourChart() {
  const warn = cssVar('--warn', '#8a5210');
  const bad  = cssVar('--status-bad', '#a32626');
  const grid = cssVar('--border-hairline', '#d8dee6');
  const ink  = cssVar('--text-secondary', '#667085');
  const peak = HOURLY.indexOf(Math.max(...HOURLY));

  makeChart('hmHourChart', {
    type: 'bar',
    data: {
      labels: HOURLY.map((_, h) => String(h).padStart(2, '0')),
      datasets: [{
        data: HOURLY,
        backgroundColor: HOURLY.map((v) => (v > 90 ? bad : warn)),
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { title: (c) => `เวลา ${c[0].label}:00 น.` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink, font: { size: 9 }, autoSkip: false, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { color: ink, font: { size: 11 } } },
      },
    },
  });

  const am = HOURLY.slice(6, 9).reduce((a, b) => a + b, 0);
  const pm = HOURLY.slice(16, 19).reduce((a, b) => a + b, 0);
  $('hmHourNote').innerHTML = `พีคสองช่วงชัดเจน — เช้า <b>06:00–08:00</b> (${nf(am)} ครั้ง)
    และเย็น <b>16:00–18:00</b> (${nf(pm)} ครั้ง) · สูงสุดคือ <b>${String(peak).padStart(2, '0')}:00 น.</b>
    ⇒ ตั้งด่าน 2 ช่วงสั้น ๆ ได้ผลกว่าตั้งทั้งวัน`;
}

function renderRepeatChart() {
  const accent = cssVar('--accent', '#1678d4');
  const bad    = cssVar('--status-bad', '#a32626');
  const grid   = cssVar('--border-hairline', '#d8dee6');
  const ink    = cssVar('--text-secondary', '#667085');

  makeChart('hmRepeatChart', {
    type: 'bar',
    data: {
      labels: REPEAT.map((r) => r.band),
      datasets: [{
        data: REPEAT.map((r) => r.plates),
        backgroundColor: REPEAT.map((r, i) => (i >= 3 ? bad : accent)),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${nf(c.raw)} ป้ายทะเบียน` } } },
      scales: {
        x: { beginAtZero: true, grid: { color: grid }, ticks: { color: ink, font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: ink, font: { size: 11 } } },
      },
    },
  });

  const hard  = REPEAT.slice(3).reduce((s, r) => s + r.plates, 0);
  const all   = REPEAT.reduce((s, r) => s + r.plates, 0);
  const hits  = REPEAT.slice(3).reduce((s, r) => s + r.plates, 0) * 10;
  $('hmRepeatNote').innerHTML = `กลุ่มที่ทำผิด <b>ตั้งแต่ 8 ครั้งขึ้นไป</b> มีแค่ ${nf(hard)} ป้าย
    (${(hard / all * 100).toFixed(1)}% ของทั้งหมด) แต่สร้างเหตุรวมกันหลักพันครั้ง
    ⇒ <b>ตามผู้ทำผิดซ้ำกลุ่มเล็กนี้คุ้มกว่าการไล่ทุกคัน</b> (≈${nf(hits)} ครั้ง)`;
}

// ── modal รายละเอียดรถ ─────────────────────────────────────
function detailFor(plate) {
  if (DETAIL[plate]) return DETAIL[plate];
  // ป้ายที่ไม่ได้กำหนดรายละเอียดไว้ — สร้างจากค่ากลางให้ demo กดได้ทุกใบ
  const cam = CAMS[plate.length % CAMS.length];
  return {
    plate: plate.replace(/\s/g, ''), province: 'ภูเก็ต', vtype: 'จักรยานยนต์',
    vcolor: 'ไม่ทราบ', pcolor: 'ป้ายขาว (ส่วนบุคคล)', lane: 1,
    confidence: 86 + (plate.length % 9), helmet: false, brand: 'ไม่ทราบ',
    cam: cam.id, camName: cam.name, time: '15 ส.ค. 13:20',
    history: [
      { time: '15 ส.ค. 13:20', vtype: 'จักรยานยนต์', vcolor: 'ไม่ทราบ', brand: 'ไม่ทราบ', cam: cam.id, helmet: false },
      { time: '15 ส.ค. 08:41', vtype: 'จักรยานยนต์', vcolor: 'ไม่ทราบ', brand: 'ไม่ทราบ', cam: CAMS[0].id, helmet: false },
    ],
  };
}

function openModal(plate) {
  const d = detailFor(plate);
  // ป้ายไทยมีทั้ง "1กท1545" และ "ขขค719" — ตัด 3 ตัวแรกเป็นหมวด ที่เหลือเป็นเลข
  // ใช้จุดตัดเดียวกันทั้ง CROP และ plaque ไม่งั้นสองกล่องแสดงไม่ตรงกัน
  const pre = d.plate.slice(0, 3);
  const num = d.plate.slice(3);

  $('hmCrop').textContent = `${pre} ${num}`;
  $('hmPlaque').innerHTML = `<b>${esc(pre)}</b>
    <small>${esc(d.province)}</small><i>${esc(num)}</i>`;
  $('hmSnap').innerHTML = `<span>ภาพเต็มจากกล้อง ${esc(d.cam)}<br>
    <b>${esc(d.camName)}</b><br>${esc(d.time)}<br>
    <small>(demo — ยังไม่ต่อภาพจริง)</small></span>`;

  const facts = [
    ['ป้ายทะเบียน', esc(d.plate), ''],
    ['จังหวัด', esc(d.province), ''],
    ['ประเภทรถ', esc(d.vtype), ''],
    ['สีรถ', esc(d.vcolor), ''],
    ['สีป้าย', `<span class="hm-swatch"></span>${esc(d.pcolor)}`, ''],
    ['เลน', String(d.lane), ''],
    ['ความมั่นใจ', d.confidence + '%', ''],
    ['หมวกกันน็อค', d.helmet ? 'สวมหมวก' : 'ไม่ใส่หมวก', d.helmet ? 'ok' : 'bad'],
    ['ยี่ห้อ', esc(d.brand), ''],
    ['กล้อง', esc(d.cam), ''],
    ['จุดติดตั้ง', esc(d.camName), ''],
    ['เวลา', esc(d.time), ''],
  ];
  $('hmFacts').innerHTML = facts.map(([k, v, cls]) =>
    `<div><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`).join('');

  $('hmHistBody').innerHTML = d.history.map((h) =>
    `<tr><td>${esc(h.time)}</td><td>${esc(h.vtype)}</td><td>${esc(h.vcolor)}</td>
     <td>${esc(h.brand)}</td>
     <td class="${h.helmet ? 'ok' : 'bad'}">${h.helmet ? 'สวมหมวก' : 'ไม่ใส่หมวก'}</td>
     <td>${esc(h.cam)}</td></tr>`).join('');

  $('hmModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('hmModal').hidden = true;
  document.body.style.overflow = '';
}

// ── event delegation (CSP: ไม่มี inline handler) ───────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) {
    const a = el.dataset.action;
    if (a === 'hmOpen')  return openModal(el.dataset.plate);
    if (a === 'hmClose') return closeModal();
    if (a === 'hmMore') {
      const r = Number(el.dataset.rank);
      if (expanded.has(r)) expanded.delete(r); else expanded.add(r);
      return renderRanks();
    }
    if (a === 'hmPeriod') {
      period = el.dataset.period;
      document.querySelectorAll('#hmPeriodSeg .segbtn')
        .forEach((b) => b.classList.toggle('active', b === el));
      renderRanks(); renderKpi();
      return;
    }
    if (a === 'hmReport') {
      // ของจริงอยู่ที่ /api/traffic/helmet-top/report.pdf (หน้ากวดขันวินัยจราจร)
      // demo ไม่แนบไฟล์ตัวอย่างไว้ เพราะมีป้ายทะเบียนและภาพบุคคลจริง (PDPA)
      alert('ในระบบจริงปุ่มนี้จะสร้างรายงาน PDF ตามช่วงเวลาและกล้องที่เลือก\n' +
            '(หน้า demo ไม่แนบไฟล์ตัวอย่างไว้ เพราะมีข้อมูลส่วนบุคคล)');
      return;
    }
    if (a === 'hmNoop') return;   // ปุ่มใน demo ที่ยังไม่ผูกงานจริง
  }
  // คลิกพื้นหลัง modal = ปิด
  if (e.target.id === 'hmModal') closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('hmModal').hidden) closeModal();
});

$('hmTopN').addEventListener('change', renderRanks);

// ── boot ───────────────────────────────────────────────────
renderRanks();
renderKpi();
renderCamChart();
renderHourChart();
renderRepeatChart();
